import lock from '../../engine.lock.json' with { type: 'json' }

export type RuntimeKind = 'editor' | 'player'

// ---------------------------------------------------------------------------
// 托管 Web 引擎（.NET browser-wasm 拥有最终模块）暴露的契约。
// 与旧版 Emscripten 模块工厂（window.TomCatEditorModule + ccall）不同：
//   - main.js 以 ES 模块方式加载，成功后派发 tomcat-web-ready 并挂载 globalThis.TomCatWeb；
//   - 引擎入口是 [JSExport] 包装（engine.Editor* / engine.Player*），不需要 ccall / _malloc；
//   - 文件系统在 web.runtime.Module.FS；
//   - C# 编译走 web.compileAndInstall(...)。
// ---------------------------------------------------------------------------

export interface EngineFileSystem {
  readFile(path: string, options?: { encoding?: string }): Uint8Array | string
  writeFile(path: string, data: Uint8Array | string): void
  mkdirTree(path: string): void
  readdir(path: string): string[]
  stat(path: string): { mode: number }
  isDir(mode: number): boolean
  unlink(path: string): void
  rmdir(path: string): void
  analyzePath?(path: string): { exists: boolean }
}

export interface EngineExports {
  PlayerBoot(width: number, height: number, packageBytes: Uint8Array): number
  PlayerFrame(delta: number): void
  PlayerResize(width: number, height: number): void
  PlayerShutdown(): void
  PlayerError(): string
  PlayerStats?(): string
  EditorBoot(width: number, height: number): number
  EditorFrame(delta: number): void
  EditorResize(width: number, height: number): void
  EditorShutdown(): void
  EditorError(): string
  EditorRpc(request: string): string
  EditorState(): string
  EditorTakeActions(): number
  /** 界面所在表面的显示比例（浏览器设备像素比）。引擎据此重烘焙字体图集与样式尺寸。 */
  EditorSetUiScale(scale: number): void
  /** 工作区 blob：引擎段（schema 版本 + 面板可见性掩码）后接 ImGui 的托管段。 */
  EditorSaveLayout(): string
  /** 应用工作区；数据不可用（版本不符、缺少 ImGui 托管段）时返回 0 并沿用默认布局。 */
  EditorLoadLayout(settings: string): number
}

export interface CompileSource { path: string; text: string }
export interface CompileReference { name: string; base64: string }
export interface CompileRequest { sources: CompileSource[]; references: CompileReference[]; scriptAssetsJson: string }
export interface CompileDiagnostic { severity: string; code: string; message: string; file: string | null; line: number; column: number }
export interface CompileResult { succeeded: boolean; assembly?: string | null; pdb?: string | null; diagnostics: CompileDiagnostic[] }

/**
 * 构造源生成器读取的 ScriptAssets.json（源码路径 → 资产 Handle）。
 *
 * Handle 是 uint64，源生成器用 `GetUInt64()` 精确解析；而 JS 的 Number 在 2^53 以上
 * 会丢精度（例如 5478837881518915558 会变成 …5584），导致引擎报
 * "Missing C# script asset <handle>…the attachment was skipped"。因此这里手工拼接
 * JSON，保留十进制原文，绝不经过 Number。
 */
export function scriptAssetsJson(entries: { path: string; handle: string }[]) {
  for (const entry of entries) {
    if (!/^[1-9]\d*$/.test(entry.handle)) throw new Error(`脚本 Handle 必须是十进制 uint64：${entry.path}`)
    if (BigInt(entry.handle) > 18446744073709551615n) throw new Error(`脚本 Handle 超出 uint64：${entry.path}`)
  }
  return `{"version":1,"assets":{${entries.map(entry => `${JSON.stringify(entry.path)}:${entry.handle}`).join(',')}}}`
}

export interface TomCatWebRuntime {
  Module: { FS: EngineFileSystem; canvas?: HTMLCanvasElement; PThread?: { terminateAllThreads(): void } }
  getConfig(): { mainAssemblyName: string }
}

/** main.js 直接暴露的 Roslyn 编译器（只编译、不安装），用于在已安装过程序集的会话里继续拿诊断。 */
export interface BrowserCompiler {
  Compile(requestJson: string): string
}

export interface TomCatWeb {
  engine: EngineExports
  runtime: TomCatWebRuntime
  compiler?: BrowserCompiler
  compileAndInstall(request: CompileRequest | string): CompileResult
}

export interface EngineManifest {
  commit: string
  kind?: string
  entry?: string
  framework?: string
  refs?: string
  refsList?: string[]
}

export interface LoadedEngine {
  web: TomCatWeb
  manifest: EngineManifest
  /** C# 编译所需的引用程序集（元数据引用），按需从引擎产物加载。 */
  references(): Promise<CompileReference[]>
}

declare global {
  var TomCatWeb: TomCatWeb | undefined
  var TomCatWebCanvas: HTMLCanvasElement | undefined
}

// import.meta.env 只在 Vite 下存在；做成函数以便单元测试在 Node 中直接导入本模块。
export function engineBase() { return `${import.meta.env.BASE_URL}engine/${lock.commit}/` }
export function engineManifestUrl() { return `${engineBase()}manifest.json` }

export function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192))
  return btoa(binary)
}

/**
 * 托管构建是单线程（WasmEnableThreads=false，产物中不含 SharedArrayBuffer/pthread），
 * 因此不再要求跨源隔离；只需安全上下文、WebAssembly 与 WebGL2。
 */
export function capabilityErrors(): string[] {
  const errors: string[] = []
  if (!globalThis.isSecureContext) errors.push('请使用 HTTPS 或 localhost')
  if (typeof WebAssembly === 'undefined') errors.push('浏览器不支持 WebAssembly')
  const probe = document.createElement('canvas')
  const gl = probe.getContext('webgl2')
  if (!gl) errors.push('浏览器无法创建 WebGL2 上下文')
  gl?.getExtension('WEBGL_lose_context')?.loseContext()
  return errors
}

async function prepareCachedEngine(): Promise<{ manifest: EngineManifest; baseUrl: string }> {
  if (!('serviceWorker' in navigator) || !('caches' in globalThis) || !crypto.subtle) throw new Error('浏览器不支持引擎本地缓存，请使用支持 Service Worker 的浏览器并允许网站存储')
  const base = new URL(import.meta.env.BASE_URL, location.href)
  const scriptUrl = new URL('engine-cache-sw.js', base).href
  const registration = await navigator.serviceWorker.getRegistration(base.href)
  if (!registration || registration.active?.scriptURL !== scriptUrl) {
    await navigator.serviceWorker.register(scriptUrl, { type: 'module', scope: base.pathname, updateViaCache: 'none' })
  }
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 30000
    const poll = () => {
      if (navigator.serviceWorker.controller?.scriptURL === scriptUrl) resolve()
      else if (Date.now() >= deadline) reject(new Error('引擎缓存服务启动超时，请刷新页面重试'))
      else setTimeout(poll, 50)
    }
    poll()
  })
  // Denial is harmless; missing or evicted files are repaired on next open.
  void navigator.storage?.persist?.().catch(() => false)
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('引擎缓存准备超时，旧版本缓存已保留，请重试')) }, 600000)
    channel.port1.onmessage = event => {
      const data = event.data
      if (data.type === 'progress') {
        dispatchEvent(new CustomEvent('tomcat-web-download-progress', { detail: data.detail }))
      } else {
        clearTimeout(timer); channel.port1.close()
        if (data.type === 'ready') resolve(data.result)
        else reject(new Error(data.message || '引擎缓存准备失败'))
      }
    }
    navigator.serviceWorker.controller!.postMessage({ type: 'tomcat-engine-prepare', commit: lock.commit }, [channel.port2])
  })
}

/**
 * 加载托管引擎模块。模块在每个页面里是单例（globalThis.TomCatWeb），
 * 因此重新编译 C# 之后必须重建承载页面（编辑器宿主 iframe），不能原地重载。
 *
 * 用 <script type="module"> 而不是 import()：产物位于 public/engine 下，
 * Vite 明确拒绝把 /public 里的文件拉进模块图（"It can only be referenced via HTML tags"），
 * 而 <script> 标签请求会由静态中间件原样返回，模块内的相对导入
 * （./_framework/dotnet.js）也能按脚本 URL 正确解析。
 */
export async function loadEngine(canvas: HTMLCanvasElement): Promise<LoadedEngine> {
  const failures = capabilityErrors()
  if (failures.length) throw new Error(failures.join('；'))
  const { manifest, baseUrl } = await prepareCachedEngine()
  if (!globalThis.TomCatWeb) {
    globalThis.TomCatWebCanvas = canvas
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.type = 'module'
      script.src = `${baseUrl}${manifest.entry || 'main.js'}`
      const timer = setTimeout(() => { cleanup(); reject(new Error('引擎模块启动超时，请检查网络后重试')) }, 600000)
      const onReady = () => { cleanup(); resolve() }
      const onFailure = (event: PromiseRejectionEvent | ErrorEvent) => {
        cleanup()
        const reason = 'reason' in event ? event.reason : event.error || event.message
        reject(new Error(`引擎启动失败：${reason instanceof Error ? reason.message : String(reason)}`))
      }
      const cleanup = () => {
        clearTimeout(timer)
        removeEventListener('tomcat-web-ready', onReady)
        removeEventListener('unhandledrejection', onFailure)
        removeEventListener('error', onFailure)
      }
      script.onerror = () => { cleanup(); reject(new Error('引擎模块加载失败，请检查资源部署')) }
      addEventListener('tomcat-web-ready', onReady)
      addEventListener('unhandledrejection', onFailure)
      addEventListener('error', onFailure)
      document.head.append(script)
    })
  }
  const web = globalThis.TomCatWeb
  if (!web || typeof web.engine?.EditorBoot !== 'function') throw new Error('引擎模块已加载但未暴露 TomCatWeb.engine')
  return {
    web,
    manifest,
    async references() {
      const names = manifest.refsList
      if (!names?.length) throw new Error('引擎产物未提供 C# 引用程序集，请重新运行 npm run engine:build')
      const directory = manifest.refs || 'refs'
      return Promise.all(names.map(async (name) => {
        const response = await fetch(`${baseUrl}${directory}/${encodeURIComponent(name)}`)
        if (!response.ok) throw new Error(`引用程序集缺失：${name}`)
        return { name, base64: bytesToBase64(new Uint8Array(await response.arrayBuffer())) }
      }))
    },
  }
}

export function engineFilesystem(web: TomCatWeb): EngineFileSystem {
  return web.runtime.Module.FS
}

export function bootPlayer(web: TomCatWeb, bytes: Uint8Array, width: number, height: number) {
  if (!bytes.length || bytes.length > 256 * 1024 * 1024) throw new Error('TCPAK 必须为 1 字节至 256 MiB')
  const status = web.engine.PlayerBoot(width, height, bytes)
  if (status !== 0) throw new Error(web.engine.PlayerError() || `播放器启动失败（状态 ${status}）`)
}

export function shutdown(web: TomCatWeb, kind: RuntimeKind) {
  try {
    if (kind === 'editor') web.engine.EditorShutdown()
    else web.engine.PlayerShutdown()
  } finally {
    // 单线程构建没有 pthread 池；若某个构建启用了线程，则在这里一并回收。
    try { web.runtime?.Module?.PThread?.terminateAllThreads?.() } catch { /* 单线程构建。 */ }
  }
}

/**
 * main.js 在“编译成功但安装被拒”时注入的诊断码。
 * 原生 WebEditorSession::SetManagedAssembly 每会话只接受一代程序集，第二次会以
 * “A C# assembly generation is already loaded; recreate the browser runtime before recompiling”
 * 拒绝——此时必须重建承载页面（编辑器宿主 iframe），不能原地替换。
 */
export const INSTALL_REJECTED = 'TCWEB0002'

/** 在浏览器内编译并安装 C# 脚本程序集；诊断直接来自 Roslyn 与 TomCat 源生成器。 */
export function compileAndInstall(web: TomCatWeb, request: CompileRequest): CompileResult {
  if (typeof web.compileAndInstall !== 'function') throw new Error('当前引擎模块不支持浏览器内 C# 编译')
  const result = web.compileAndInstall(request)
  if (!result || typeof result.succeeded !== 'boolean') throw new Error('C# 编译返回了无法识别的结果')
  return result
}

/**
 * 只编译并返回 Roslyn 诊断，不安装程序集。可在同一会话内重复调用，
 * 因此“已经安装过一代程序集”时用它继续给出最新源码的诊断。
 */
export function compileOnly(web: TomCatWeb, request: CompileRequest): CompileResult {
  if (typeof web.compiler?.Compile !== 'function') throw new Error('当前引擎模块未暴露浏览器内编译器')
  let result: CompileResult
  try { result = JSON.parse(web.compiler.Compile(JSON.stringify(request))) as CompileResult }
  catch { throw new Error('C# 编译器返回了无法识别的结果') }
  if (!result || typeof result.succeeded !== 'boolean') throw new Error('C# 编译返回了无法识别的结果')
  return result
}

/** 判断一次编译结果是否属于“程序集已加载、必须重建运行时”的情况。 */
export function needsRuntimeRebuild(result: CompileResult) {
  return !result.succeeded && result.diagnostics.some(diagnostic => diagnostic.code === INSTALL_REJECTED)
}
