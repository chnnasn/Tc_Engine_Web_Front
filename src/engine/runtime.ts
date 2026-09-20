import lock from '../../engine.lock.json' with { type: 'json' }

export type RuntimeKind = 'editor' | 'player'
export interface EngineModule {
  ccall(name: string, result: 'number' | 'string' | null, types: string[], args: unknown[]): any
  _malloc(size: number): number
  _free(pointer: number): void
  HEAPU8: Uint8Array
  FS: { readFile(path: string): Uint8Array; writeFile(path: string, bytes: Uint8Array): void; mkdirTree(path: string): void; readdir(path: string): string[]; stat(path: string): { mode: number }; isDir(mode: number): boolean; unlink(path: string): void; rmdir(path: string): void }
  PThread: { terminateAllThreads(): void }
}
export function capabilityErrors(): string[] {
  const errors: string[] = []
  if (!globalThis.isSecureContext) errors.push('请使用 HTTPS 或 localhost')
  if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') errors.push('页面缺少跨源隔离，请检查 COOP/COEP 响应头')
  if (typeof Worker === 'undefined') errors.push('浏览器不支持 Worker')
  if (typeof WebAssembly === 'undefined') errors.push('浏览器不支持 WebAssembly')
  const probe = document.createElement('canvas')
  const gl = probe.getContext('webgl2')
  if (!gl) errors.push('浏览器无法创建 WebGL2 上下文')
  gl?.getExtension('WEBGL_lose_context')?.loseContext()
  return errors
}
export async function loadModule(kind: RuntimeKind, canvas: HTMLCanvasElement): Promise<EngineModule> {
  const failures = capabilityErrors()
  if (failures.length) throw new Error(failures.join('；'))
  const base = `${import.meta.env.BASE_URL}engine/${lock.commit}/`
  try {
    const manifest = await fetch(`${base}manifest.json`)
    if (!manifest.ok || (await manifest.json()).commit !== lock.commit) throw new Error('manifest mismatch')
  } catch { throw new Error('未找到匹配版本的引擎，请先运行 npm run engine:build') }
  const name = kind === 'editor' ? 'TomCatEditorModule' : 'TomCatPlayerModule'
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `${base}tomcat_${kind}.js`
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('引擎脚本加载失败'))
    document.head.append(script)
  })
  const factory = (window as unknown as Record<string, (options: unknown) => Promise<EngineModule>>)[name]
  if (typeof factory !== 'function') throw new Error(`Missing ${name}`)
  return factory({ canvas, locateFile: (file: string) => `${base}${file}`, printErr: (text: string) => console.error(text) })
}
export function bootPlayer(module: EngineModule, bytes: Uint8Array, width: number, height: number) {
  if (!bytes.length || bytes.length > 256 * 1024 * 1024) throw new Error('TCPAK 必须为 1 字节至 256 MiB')
  const pointer = module._malloc(bytes.length)
  if (!pointer) throw new Error('无法分配资源包内存')
  try {
    // malloc can grow memory: always obtain the current heap afterwards.
    module.HEAPU8.set(bytes, pointer)
    if (module.ccall('tc_web_player_boot', 'number', ['number', 'number', 'number', 'number'], [width, height, pointer, bytes.length]) !== 0) throw new Error(module.ccall('tc_web_player_error', 'string', [], []))
  } finally { module._free(pointer) }
}
export function shutdown(module: EngineModule, kind: RuntimeKind) {
  try { module.ccall(`tc_web_${kind}_shutdown`, null, [], []) }
  finally { module.PThread.terminateAllThreads() }
}
