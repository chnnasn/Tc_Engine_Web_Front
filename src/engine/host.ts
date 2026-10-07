import { currentUser, getCloudProject } from './cloud'
import { PROTOCOL, EditorProtocol, EngineError, type SceneState, type Snapshot, type Operation } from './protocol'
import { assertDocument, engineCommit, projectRoot, validFilePath, type EngineDocument } from './storage'
import engineLock from '../../engine.lock.json'
import { executeScriptTool } from './script-automation'
import { attachScripts, detachScripts, readScripts } from './scene-archive'
import {
  loadEngine, engineFilesystem, bootPlayer, shutdown, compileAndInstall, compileOnly, needsRuntimeRebuild, scriptAssetsJson,
  type CompileDiagnostic, type CompileRequest, type LoadedEngine, type RuntimeKind,
} from './runtime'

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!
addEventListener('tomcat-web-download-progress', event => {
  send({ event: 'download', ...(event as CustomEvent).detail })
})
const stage = document.querySelector<HTMLElement>('#stage')!
let engine: LoadedEngine | undefined
let protocol: EditorProtocol | undefined
let port: MessagePort | undefined
let kind: RuntimeKind = 'editor'
let stopped = false
let frame = 0
let observer: ResizeObserver | undefined
let previousState = ''
let lastTime = 0
let lastPoll = 0
let width = 0, height = 0
// 工作区按布局格式持久化；兼容的引擎更新不会丢弃用户偏好。
let lastAutoSave = 0
// 已经通知引擎的显示比例，用来识别"只换了 DPR、CSS 尺寸没变"的情况。
let appliedScale = 0
// C# 程序集是会话级的：browser-wasm 没有可回收 ALC，原生 WebEditorSession 每会话只接受
// 一代程序集。assemblyLoaded 记录“本模块已安装过”，一旦为真就不能再替换，只能重建承载页面。
let assemblyLoaded = false
// 已安装程序集对应的源码签名；用来判断磁盘上的脚本是否还和已安装的一致。
let installedSignature = ''
let scriptDiagnostics: CompileDiagnostic[] = []

function send(message: unknown) { port?.postMessage(message) }
function exports() { return engine!.web.engine }
/**
 * 引擎 RPC。显示比例与工作区都走这条通道：引擎的原生导出面只有一个入口
 * （tc_web_editor_rpc），新增导出意味着托管 WASM 多一个原生 import，而 import 在模块实例化时
 * 解析——名字对不上会让整个编辑器起不来，代价与"两个非热路径调用"不相称。
 */
function checkReply(reply: string, description: string): string {
  let parsed: any
  try { parsed = JSON.parse(reply) } catch { throw new Error(`${description}：引擎返回了无法解析的应答`) }
  if (parsed?.protocol !== 'tomcat.web.v1' || parsed?.ok !== true) {
    throw new Error(`${description}：${parsed?.error?.message || '引擎拒绝了该请求'}`)
  }
  return parsed.result
}
function rpc(type: string, payload: Record<string, unknown>, description: string) {
  const value = exports()
  // 直接导出优先：宿主不需要为它们解析应答。
  if (type === 'editor.setDisplayScale' && typeof value.EditorSetUiScale === 'function') {
    value.EditorSetUiScale((payload as { scale: number }).scale)
    return undefined
  }
  if (type === 'editor.saveLayout' && typeof value.EditorSaveLayout === 'function') {
    return { settings: value.EditorSaveLayout() }
  }
  if (type === 'editor.loadLayout' && typeof value.EditorLoadLayout === 'function') {
    return { applied: value.EditorLoadLayout((payload as { settings: string }).settings) !== 0 }
  }
  return checkReply(value.EditorRpc(JSON.stringify({ protocol: PROTOCOL, requestId: `host-${++rpcSequence}`, type, payload })), description)
}
let rpcSequence = 0
function filesystem() { return engineFilesystem(engine!.web) }
function state(): SceneState { return JSON.parse(exports().EditorState()) }
function viewportScale() { return Math.max(1, Math.min(2.5, devicePixelRatio || 1)) }
function cssSize(): [number, number] { return [Math.max(1, Math.round(innerWidth)), Math.max(1, Math.round(innerHeight))] }
function dimensions(): [number, number] {
  // 引擎坐标系是 CSS 像素：ImGui 的 DisplaySize 取自画布的 CSS 盒子，字号也按 CSS 像素定尺。
  // 设备像素只体现在绘制缓冲上。
  return cssSize()
}
/**
 * 让引擎的坐标系等于 CSS 像素坐标系。
 *
 * 引擎侧（Emscripten GLFW）用画布的 CSS 盒子同时当窗口尺寸、鼠标坐标空间与 ImGui 的
 * DisplaySize，并把绘制缓冲（glfwGetFramebufferSize）当作 OpenGL 视口；ImGui 的
 * DisplayFramebufferScale 就是这两者的比值。GLFW 还有一层行为要照顾：glfwCreateWindow 与
 * 浏览器尺寸变化时它会用 **clientWidth/clientHeight** 覆盖绘制缓冲与画布内联样式
 * （GLFW.adjustCanvasDimensions）。所以宿主不能自己给画布定尺寸——那样会在引擎启动时被覆盖掉，
 * 而且一旦让 1 CSS 像素 = 1 设备像素去迎合它，DPR=2 的屏幕上 ImGui 就在设备像素坐标系里排版，
 * 字号与所有面板都只剩应有的一半。
 */
function applyViewport(w: number, h: number) {
  width = w; height = h
  stage.style.width = `${w}px`
  stage.style.height = `${h}px`
  stage.style.transform = ''
  // 画布的尺寸由引擎拥有：宿主把舞台设成 CSS 尺寸、让画布铺满它（engine-host.html 的
  // #stage>canvas 规则），GLFW 据此把缓冲也设成 CSS 尺寸，ImGui 的 DisplaySize 与
  // DisplayFramebufferScale 随之都是 CSS 像素下的正确值，界面单位与设备像素比无关。
  //
  // 代价：高 DPI 屏上绘制缓冲是 CSS 分辨率、由浏览器放大。要做到既正确又逐物理像素清晰，
  // 需要引擎按 devicePixelRatio 设置 ImGui 的 framebuffer scale——仅靠宿主改画布无法绕过
  // GLFW 的这次覆盖（已实测）。
  canvas.style.width = ''
  canvas.style.height = ''
  canvas.style.transform = ''
  canvas.style.transformOrigin = ''
}
function resize() {
  const [w, h] = dimensions()
  const scale = viewportScale()
  if (width === w && height === h && scale === appliedScale) return
  applyViewport(w, h)
  appliedScale = scale
  // 缩放必须在尺寸之前告知引擎：它决定字体图集与样式尺寸的重烘焙。
  try { rpc('editor.setDisplayScale', { scale }, '设置显示比例') } catch { /* 引擎尚未就绪。 */ }
  if (kind === 'editor') exports().EditorResize(width, height)
  else exports().PlayerResize(width, height)
}
const layoutKey = 'tomcat.web-editor-layout.v1'
/** 上一次落盘的工作区内容，用来判断是否真的变了。 */
let savedLayout = ''
/** 退出前把工作区交给宿主存储；玩家会话没有布局，失败也不影响关闭。 */
function flushLayout() {
  if (kind !== 'editor' || !engine || stopped) return
  try {
    const result = rpc('editor.saveLayout', {}, '保存工作区') as { settings?: string } | undefined
    const settings = result?.settings
    if (settings && settings !== savedLayout) { localStorage.setItem(layoutKey, settings); savedLayout = settings }
  } catch { /* 引擎不可用或存储被禁用。 */ }
}
function restoreLayout() {
  if (kind !== 'editor') return
  try {
    const previousKeys = [engineCommit, ...[...engineLock.legacyCommits].reverse()].map(commit => `${layoutKey}.${commit}`)
    for (const key of [layoutKey, ...previousKeys]) {
      const settings = localStorage.getItem(key)
      if (!settings) continue
      const result = rpc('editor.loadLayout', { settings }, '恢复工作区') as { applied?: boolean } | undefined
      if (result?.applied) { localStorage.setItem(layoutKey, settings); savedLayout = settings; break }
    }
  } catch { /* 损坏的数据不应阻止编辑器启动。 */ }
}
/**
 * 周期性落盘。引擎不暴露"布局脏了"的标记，所以这里取一次当前工作区与上次落盘的内容比较；
 * 每两秒比对一次，并在手动保存、隐藏页面及退出前立即落盘。
 */
function maybeAutoSaveLayout(time: number) {
  if (kind !== 'editor' || !engine || stopped || time - lastAutoSave < 2000) return
  lastAutoSave = time
  flushLayout()
}
function dispose() {
  if (stopped) return
  flushLayout()
  stopped = true; cancelAnimationFrame(frame); observer?.disconnect()
  try { if (engine) shutdown(engine.web, kind) } finally { engine = undefined; port?.close() }
}
addEventListener('pagehide', dispose)
addEventListener('tomcat-save-layout', flushLayout)
document.addEventListener('visibilitychange', () => { if (document.hidden) flushLayout() })
canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); fail(new Error('图形上下文丢失，请重新打开会话')) })
canvas.addEventListener('pointerdown', () => canvas.focus())
canvas.addEventListener('contextmenu', event => event.preventDefault())
canvas.addEventListener('wheel', event => event.preventDefault(), { passive: false })
addEventListener('keydown', event => {
  if ([' ', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace'].includes(event.key) || ((event.ctrlKey || event.metaKey) && ['s', 'z', 'y'].includes(event.key.toLowerCase()))) event.preventDefault()
})
function fail(error: unknown) {
  // 这类失败往往只以退出码的形式出现，所以尽量把原因变成可读的一句话。
  const message = error instanceof Error ? error.message : (() => {
    const value = error as { message?: string; status?: number }
    if (value && typeof value.message === 'string') return value.status === undefined ? value.message : `${value.message}（status ${value.status}）`
    return String(error)
  })()
  console.error('[tomcat-host] fail:', message, error)
  send({ event: 'fatal', message })
  dispose()
}
function tick(time: number) {
  if (stopped || !engine) return
  try {
    resize()
    maybeAutoSaveLayout(time)
    const delta = lastTime ? Math.min((time - lastTime) / 1000, .1) : 0
    lastTime = time
    if (kind === 'editor') exports().EditorFrame(delta)
    else exports().PlayerFrame(delta)
    const error = kind === 'editor' ? exports().EditorError() : exports().PlayerError()
    if (error) throw new Error(error)
    if (kind === 'editor') {
      const actions = exports().EditorTakeActions()
      if (actions) send({ event: 'actions', actions })
      if (time - lastPoll > 100) {
        const current = exports().EditorState()
        if (current !== previousState) { previousState = current; send({ event: 'state', state: JSON.parse(current) }) }
        lastPoll = time
      }
    }
    frame = requestAnimationFrame(tick)
  } catch (error) { fail(error) }
}

// ---------------------------------------------------------------------------
// 项目文件系统（MEMFS）
// ---------------------------------------------------------------------------
function restore(document: EngineDocument) {
  assertDocument(document)
  const fs = filesystem()
  if (document.version === 2) {
    // 只在新 MEMFS 上工作：替换随包分发的源目录，绝不把陈旧资源并入恢复出的修订。
    const removeTree = (path: string) => {
      for (const name of fs.readdir(path).filter(name => name !== '.' && name !== '..')) {
        const child = `${path}/${name}`
        if (fs.isDir(fs.stat(child).mode)) { removeTree(child); fs.rmdir(child) }
        else fs.unlink(child)
      }
    }
    removeTree(`${projectRoot}/Assets`); removeTree(`${projectRoot}/ProjectSettings`)
  }
  for (const [path, data] of Object.entries(document.files)) {
    const full = `${projectRoot}/${path}`
    fs.mkdirTree(full.slice(0, full.lastIndexOf('/')))
    fs.writeFile(full, Uint8Array.from(atob(data), char => char.charCodeAt(0)))
  }
}
function capture(): EngineDocument {
  flushLayout()
  const fs = filesystem()
  const snapshot = protocol!.snapshot(state().sceneHandle)
  const files: Record<string, string> = {}
  const encode = (bytes: Uint8Array) => {
    let binary = ''
    for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192))
    return btoa(binary)
  }
  const collect = (folder: string) => {
    for (const name of fs.readdir(`${projectRoot}/${folder}`).filter(name => name !== '.' && name !== '..')) {
      const relative = `${folder}/${name}`
      if (fs.isDir(fs.stat(`${projectRoot}/${relative}`).mode)) collect(relative)
      else {
        if (!validFilePath(relative)) throw new Error(`不支持的项目文件路径：${relative}`)
        files[relative] = encode(fs.readFile(`${projectRoot}/${relative}`) as Uint8Array)
      }
    }
  }
  collect('ProjectSettings'); collect('Assets')
  files['Project.tcproj'] = encode(fs.readFile(`${projectRoot}/Project.tcproj`) as Uint8Array)
  const document: EngineDocument = { format: 'tomcat-engine-project', version: 2, engineCommit, sceneHandle: snapshot.sceneHandle, archive: snapshot.archive, files }
  assertDocument(document)
  return document
}

// ---------------------------------------------------------------------------
// C# 脚本：源文件、元数据、浏览器内编译与安装
// ---------------------------------------------------------------------------
const scriptFolder = `${projectRoot}/Assets/Scripts`
export interface ScriptEntry { path: string; handle: string; className: string; text: string }

function newHandle() {
  const bits = crypto.getRandomValues(new Uint32Array(2))
  const value = ((BigInt(bits[0]!) << 32n) | BigInt(bits[1]!)) || 1n
  return value.toString()
}
function scriptMeta(handle: string) {
  // 与上游 Web/tests/managed-browser-smoke.html 使用的 .tcmeta 结构保持一致。
  return `SchemaVersion: 2
Asset:
  Handle: ${handle}
  Type: CSharpScript
  ImportSettings:
    {}
  SubAssets:
    []
`
}
function readHandle(metaPath: string): string | undefined {
  try {
    const text = String(filesystem().readFile(metaPath, { encoding: 'utf8' }))
    const match = /^\s*Handle:\s*(\d+)\s*$/m.exec(text)
    return match && match[1] !== '0' ? match[1] : undefined
  } catch { return undefined }
}
function normalizeScriptPath(value: unknown) {
  if (typeof value !== 'string') throw new Error('脚本路径无效')
  const relative = value.replace(/\\/g, '/').replace(/^\.?\//, '')
  if (!/^Assets\/Scripts\/[A-Za-z0-9][A-Za-z0-9_.\-/]*\.cs$/.test(relative) || relative.includes('..')) throw new Error('脚本路径必须位于 Assets/Scripts 下并以 .cs 结尾')
  if (!validFilePath(relative)) throw new Error('脚本路径不合法')
  return relative
}
function classNameOf(path: string) { return path.slice(path.lastIndexOf('/') + 1, -3) }
/** Include identity: deleting/recreating identical source still needs a new assembly manifest. */
function signatureOf(scripts: ScriptEntry[]) {
  let hash = 0x811c9dc5
  for (const script of scripts) {
    const text = `${script.path}\u0000${script.handle}\u0000${script.text}\u0000`
    for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193) }
  }
  return `${scripts.length}:${(hash >>> 0).toString(16)}`
}

function listScripts(): ScriptEntry[] {
  const fs = filesystem()
  const results: ScriptEntry[] = []
  const walk = (folder: string) => {
    let entries: string[]
    try { entries = fs.readdir(folder) } catch { return }
    for (const name of entries.filter(name => name !== '.' && name !== '..')) {
      const full = `${folder}/${name}`
      if (fs.isDir(fs.stat(full).mode)) { walk(full); continue }
      if (!name.endsWith('.cs')) continue
      const path = full.slice(projectRoot.length + 1)
      if (!validFilePath(path)) continue
      results.push({
        path,
        handle: readHandle(`${full}.tcmeta`) ?? '',
        className: classNameOf(path),
        text: String(fs.readFile(full, { encoding: 'utf8' })),
      })
    }
  }
  walk(scriptFolder)
  return results.sort((a, b) => a.path.localeCompare(b.path))
}
function writeScript(payload: { path: unknown; text: unknown; handle?: unknown }): ScriptEntry {
  requireEditMode()
  if (typeof payload.text !== 'string') throw new Error('脚本内容无效')
  if (payload.text.length > 512 * 1024) throw new Error('单个脚本不能超过 512 KiB')
  const fs = filesystem()
  const path = normalizeScriptPath(payload.path)
  const full = `${projectRoot}/${path}`
  const handle = (typeof payload.handle === 'string' && /^[1-9]\d*$/.test(payload.handle) ? payload.handle : undefined) ?? readHandle(`${full}.tcmeta`) ?? newHandle()
  fs.mkdirTree(full.slice(0, full.lastIndexOf('/')))
  fs.writeFile(full, payload.text)
  fs.writeFile(`${full}.tcmeta`, scriptMeta(handle))
  protocol!.request('asset.refresh')
  return { path, handle, className: classNameOf(path), text: payload.text }
}
function deleteScript(payload: { path: unknown }) {
  requireEditMode()
  const fs = filesystem()
  const path = normalizeScriptPath(payload.path)
  const full = `${projectRoot}/${path}`
  try { fs.unlink(full) } catch { /* 文件已不存在。 */ }
  try { fs.unlink(`${full}.tcmeta`) } catch { /* 元数据已不存在。 */ }
  protocol!.request('asset.refresh')
}
async function buildCompileRequest(validate?: () => void): Promise<{ request: CompileRequest; scripts: ScriptEntry[] }> {
  const references = await engine!.references()
  validate?.()
  const scripts = listScripts()
  if (!scripts.length) throw new Error('Assets/Scripts 下没有 .cs 文件')
  const fs = filesystem()
  // 保证每个脚本都有元数据，并让 Handle 与编译清单一致。
  for (const script of scripts) {
    const handle = script.handle || newHandle()
    fs.writeFile(`${projectRoot}/${script.path}.tcmeta`, scriptMeta(handle))
    script.handle = handle
  }
  return {
    scripts,
    request: {
      sources: scripts.map(script => ({ path: script.path, text: script.text })),
      references,
      scriptAssetsJson: scriptAssetsJson(scripts.map(script => ({ path: script.path, handle: script.handle }))),
    },
  }
}
export interface CompileOutcome { succeeded: boolean; restartRequired: boolean; diagnostics: CompileDiagnostic[]; scripts: number }
/**
 * 编译 Assets/Scripts 下的 C# 脚本。
 * - 本会话尚未安装程序集：直接 compileAndInstall，成功后即可运行预览。
 * - 本会话已安装过一代程序集：原生侧会拒绝替换，改为只编译取诊断；
 *   若源码本身编译通过，则返回 restartRequired，由宿主页面重建引擎会话后恢复项目。
 */
async function compileScripts(validate?: () => void): Promise<CompileOutcome> {
  const mode = state().mode
  if (mode && mode !== 'edit') throw new EngineError('PREVIEW_RUNNING', '请先停止运行预览，再编译 C# 脚本')
  const { request, scripts } = await buildCompileRequest(validate)
  if (assemblyLoaded && signatureOf(scripts) === installedSignature) {
    scriptDiagnostics = []
    return { succeeded: true, restartRequired: false, diagnostics: [], scripts: scripts.length }
  }
  if (assemblyLoaded) {
    const probe = compileOnly(engine!.web, request)
    scriptDiagnostics = probe.diagnostics ?? []
    return { succeeded: false, restartRequired: probe.succeeded, diagnostics: scriptDiagnostics, scripts: scripts.length }
  }
  const result = compileAndInstall(engine!.web, request)
  scriptDiagnostics = result.diagnostics ?? []
  assemblyLoaded = result.succeeded
  if (result.succeeded) installedSignature = signatureOf(scripts)
  return { succeeded: result.succeeded, restartRequired: needsRuntimeRebuild(result), diagnostics: scriptDiagnostics, scripts: scripts.length }
}
/** 运行预览前确保 C# 脚本已在本会话编译安装，否则引擎会明确拒绝含 C# 的场景。 */
async function ensureScriptsInstalled() {
  const scripts = listScripts()
  if (!scripts.length || (assemblyLoaded && signatureOf(scripts) === installedSignature)) return
  const result = await compileScripts()
  if (result.succeeded) return
  if (result.restartRequired) throw new EngineError('SESSION_RESTART_REQUIRED', 'C# 程序集已在当前会话安装，需重建引擎会话后才能运行最新脚本')
  const first = result.diagnostics.find(diagnostic => diagnostic.severity === 'error') ?? result.diagnostics[0]
  throw new EngineError('SCRIPT_COMPILE_FAILED', first ? `脚本编译失败：${first.code} ${first.message}` : '脚本编译失败')
}
/** 当前磁盘脚本是否与已安装程序集一致。 */
function scriptsInstalled() { return assemblyLoaded && signatureOf(listScripts()) === installedSignature }
/** 脚本面板统一使用的回复形状（scripts 列表 + 安装状态 + 诊断）。 */
function scriptsReply() { return { scripts: listScripts(), installed: scriptsInstalled(), assemblyLoaded, diagnostics: scriptDiagnostics } }

// ---------------------------------------------------------------------------
// 脚本挂载：CSharpScripts 组件只能经场景归档注入（引擎未开放 inspector 添加）。
// ---------------------------------------------------------------------------
function requireEditMode() {
  const mode = state().mode
  if (mode && mode !== 'edit') throw new EngineError('PREVIEW_RUNNING', '请先停止运行预览，再修改脚本挂载')
}
/** 收集选中实体当前挂载的脚本名，供 UI 回显。 */
function entityScripts(entityId: string) {
  const snapshot = protocol!.snapshot(state().sceneHandle)
  return { attachments: readScripts(snapshot.archive, entityId), entityId }
}
function attachToEntity(payload: { entityId: unknown; paths: unknown }) {
  requireEditMode()
  if (typeof payload.entityId !== 'string' || !/^[1-9]\d*$/.test(payload.entityId)) throw new Error('请先在层级中选中一个实体')
  if (!Array.isArray(payload.paths) || !payload.paths.length || payload.paths.length > 32) throw new Error('请选择 1-32 个脚本')
  const scripts = listScripts()
  const attachments = payload.paths.map(value => {
    const path = normalizeScriptPath(value)
    const script = scripts.find(item => item.path === path)
    if (!script) throw new Error(`脚本未保存：${path}`)
    if (!script.handle) throw new Error(`脚本缺少 Handle，请先保存：${path}`)
    return { handle: script.handle, className: script.className }
  })
  const snapshot = protocol!.snapshot(state().sceneHandle)
  const archive = attachScripts(snapshot.archive, payload.entityId, attachments)
  const next = protocol!.loadArchive(snapshot, archive)
  return { entityId: payload.entityId, attachments: readScripts(next.archive, payload.entityId), snapshot: next }
}
function detachFromEntity(payload: { entityId: unknown }) {
  requireEditMode()
  if (typeof payload.entityId !== 'string' || !/^[1-9]\d*$/.test(payload.entityId)) throw new Error('请先在层级中选中一个实体')
  const snapshot = protocol!.snapshot(state().sceneHandle)
  const archive = detachScripts(snapshot.archive, payload.entityId)
  if (archive === snapshot.archive) return { entityId: payload.entityId, attachments: [], snapshot }
  const next = protocol!.loadArchive(snapshot, archive)
  return { entityId: payload.entityId, attachments: [], snapshot: next }
}

// ---------------------------------------------------------------------------
// 宿主命令
// ---------------------------------------------------------------------------
function command(type: string, payload: any): unknown {
  if (!engine || !protocol) throw new Error('编辑器尚未就绪')
  if (type === 'capture') return { document: capture(), state: state() }
  if (type === 'snapshot') return { ...protocol.snapshot(state().sceneHandle), mode: state().mode }
  if (type === 'transact') return protocol.transact(payload.state, payload.label, payload.operations as Operation[])
  if (type === 'history') return protocol.history(payload.state, payload.direction)
  if (type === 'markSaved') {
    if (JSON.stringify(capture()) !== JSON.stringify(payload.document)) throw new EngineError('REVISION_CONFLICT', '保存期间项目已变化，已保存较早快照，请再次保存最新内容')
    return protocol.request('scene.markSaved', { sceneHandle: payload.state.sceneHandle, baseRevision: payload.state.revision })
  }
  if (type === 'preview') return protocol.request('preview.control', { command: payload.command })
  if (type === 'select') return protocol.request('scene.select', { sceneHandle: state().sceneHandle, entityId: payload.entityId })
  if (type === 'importImage') {
    if (!/^[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|tga)$/.test(payload.name) || !(payload.bytes instanceof Uint8Array) || payload.bytes.length > 2 * 1024 * 1024) throw new Error('请选择不超过 2 MiB 的 PNG/JPEG/TGA')
    const fs = filesystem()
    fs.mkdirTree(`${projectRoot}/Assets/WebImports`)
    fs.writeFile(`${projectRoot}/Assets/WebImports/${payload.name}`, payload.bytes)
    return protocol.request('asset.import', { name: payload.name })
  }
  if (type === 'scripts') return scriptsReply()
  if (type === 'scriptWrite') return { script: writeScript(payload), ...scriptsReply() }
  if (type === 'scriptDelete') { deleteScript(payload); return scriptsReply() }
  if (type === 'scriptAttach') return attachToEntity(payload)
  if (type === 'scriptDetach') return detachFromEntity(payload)
  if (type === 'scriptEntity') return entityScripts(typeof payload.entityId === 'string' ? payload.entityId : '')
  throw new Error('Unknown host command')
}

addEventListener('message', async event => {
  if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'tomcat-connect' || port) return
  port = event.ports[0]
  kind = event.data.kind
  if (!port || !['editor', 'player'].includes(kind)) return
  port.onmessage = async message => {
    const { id, type, payload } = message.data
    if (type === 'dispose') { dispose(); return }
    try {
      if (type === 'automationScript') {
        const result = await executeScriptTool(payload.name, payload.arguments, {
          snapshot: () => ({ ...protocol!.snapshot(state().sceneHandle), mode: state().mode || 'edit' }),
          scripts: listScripts, write: writeScript, compile: compileScripts,
          load: (snapshot, archive) => protocol!.loadArchive(snapshot, archive), installed: scriptsInstalled,
        })
        send({ id, result }); return
      }
      if (type === 'scriptCompile') { send({ id, result: await compileScripts() }); return }
      if (type === 'preview' && payload?.command === 'play') await ensureScriptsInstalled()
      send({ id, result: command(type, payload) })
    }
    catch (error) { send({ id, error: { code: error instanceof EngineError ? error.code : 'HOST_ERROR', message: error instanceof Error ? error.message : String(error) } }) }
  }
  try {
    if (kind === 'editor') {
      await currentUser()
      if (typeof event.data.cloudProjectId !== 'string' || !event.data.cloudProjectId) throw new Error('编辑器必须关联云端项目')
      await getCloudProject(event.data.cloudProjectId)
    }
    if (stopped) return
    const loaded = await loadEngine(canvas)
    if (stopped) { shutdown(loaded.web, kind); return }
    engine = loaded
    // 必须在 boot 之前完成：glfwCreateWindow 会按画布的 CSS 尺寸定缓冲，舞台此时就得是对的尺寸。
    const [initialWidth, initialHeight] = dimensions() as [number, number]
    applyViewport(initialWidth, initialHeight)
    let snapshot: Snapshot | undefined
    if (kind === 'editor') {
      if (exports().EditorBoot(width, height) !== 0) throw new Error(exports().EditorError() || '编辑器启动失败')
      protocol = new EditorProtocol(json => exports().EditorRpc(json))
      const capabilities = protocol.request<{ capabilities: string[] }>('system.capabilities')
      for (const required of ['scene.transact', 'component.schema', 'scene.archive', 'history.undo', 'history.redo']) if (!capabilities.capabilities.includes(required)) throw new Error(`Missing capability: ${required}`)
      const document = event.data.document as EngineDocument | undefined
      if (document) restore(document)
      snapshot = protocol.request<Snapshot>('project.new', { name: event.data.name, template: event.data.template })
      if (document) {
        snapshot = protocol.request<Snapshot>('scene.loadArchive', { sceneHandle: snapshot.sceneHandle, baseRevision: snapshot.revision, archive: document.archive })
        snapshot = protocol.request<Snapshot>('scene.markSaved', { sceneHandle: snapshot.sceneHandle, baseRevision: snapshot.revision })
      }
      // 工作区必须在引擎启动后、第一次绘制前恢复：载入会重置停靠树，晚于首帧就会闪一下默认布局。
      restoreLayout()
    } else {
      bootPlayer(loaded.web, event.data.bytes, width, height)
    }
    observer = new ResizeObserver(resize); observer.observe(document.documentElement)
    send({ event: 'ready', snapshot }); frame = requestAnimationFrame(tick)
  } catch (error) { fail(error) }
})
