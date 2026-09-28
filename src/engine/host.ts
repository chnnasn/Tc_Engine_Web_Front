import { currentUser, getCloudProject } from './cloud'
import { EditorProtocol, EngineError, type SceneState, type Snapshot, type Operation } from './protocol'
import { assertDocument, engineCommit, projectRoot, validFilePath, type EngineDocument } from './storage'
import { attachScripts, detachScripts, readScripts } from './scene-archive'
import {
  loadEngine, engineFilesystem, bootPlayer, shutdown, compileAndInstall, compileOnly, needsRuntimeRebuild, scriptAssetsJson,
  type CompileDiagnostic, type CompileRequest, type LoadedEngine, type RuntimeKind,
} from './runtime'

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!
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
// C# 程序集是会话级的：browser-wasm 没有可回收 ALC，原生 WebEditorSession 每会话只接受
// 一代程序集。assemblyLoaded 记录“本模块已安装过”，一旦为真就不能再替换，只能重建承载页面。
let assemblyLoaded = false
// 已安装程序集对应的源码签名；用来判断磁盘上的脚本是否还和已安装的一致。
let installedSignature = ''
let scriptDiagnostics: CompileDiagnostic[] = []

function send(message: unknown) { port?.postMessage(message) }
function exports() { return engine!.web.engine }
function filesystem() { return engineFilesystem(engine!.web) }
function state(): SceneState { return JSON.parse(exports().EditorState()) }
function dimensions() { return [Math.max(1, Math.min(8192, Math.round(innerWidth * devicePixelRatio))), Math.max(1, Math.min(8192, Math.round(innerHeight * devicePixelRatio)))] }
/**
 * 把引擎视口切成“设备像素”大小。
 *
 * 引擎侧（Emscripten GLFW）在 glfwCreateWindow 收尾时会调用 adjustCanvasDimensions()，
 * 用画布的 **CSS 尺寸**（clientWidth/clientHeight）覆盖绘制缓冲，并把它同时当作 WebGL viewport
 * 与鼠标坐标空间；而 glfwSetWindowSize 也会照这个尺寸重设缓冲。若把设备像素直接交给引擎，
 * 两者就差一个 devicePixelRatio：viewport 按设备像素铺开、缓冲只有 CSS 尺寸，画面被放大 dpr 倍
 * 并锚定在左下角（高 DPI 屏幕上表现为内容偏到右下且被裁切，DPR=1 时恰好看不出问题）。
 *
 * 因此让舞台的布局尺寸等于设备像素、再缩放回视口：画布 clientWidth、引擎窗口尺寸、鼠标坐标空间
 * 三者始终一致，绘制缓冲也保持设备像素（高 DPI 下依旧清晰）。
 */
function applyViewport(w: number, h: number) {
  width = w; height = h
  // 正常情况 innerWidth/w 就是 1/devicePixelRatio；设备像素被 8192 上限夹住时它也仍然铺满视口宽度。
  const scale = innerWidth / w
  stage.style.width = `${w}px`
  stage.style.height = `${h}px`
  stage.style.transform = scale === 1 ? '' : `scale(${scale})`
  canvas.width = w; canvas.height = h
}
function resize() {
  const [w, h] = dimensions()
  if (width === w && height === h) return
  applyViewport(w!, h!)
  if (kind === 'editor') exports().EditorResize(width, height)
  else exports().PlayerResize(width, height)
}
function dispose() {
  if (stopped) return
  stopped = true; cancelAnimationFrame(frame); observer?.disconnect()
  try { if (engine) shutdown(engine.web, kind) } finally { engine = undefined; port?.close() }
}
addEventListener('pagehide', dispose)
canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); fail(new Error('图形上下文丢失，请重新打开会话')) })
canvas.addEventListener('pointerdown', () => canvas.focus())
canvas.addEventListener('contextmenu', event => event.preventDefault())
canvas.addEventListener('wheel', event => event.preventDefault(), { passive: false })
addEventListener('keydown', event => {
  if ([' ', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace'].includes(event.key) || ((event.ctrlKey || event.metaKey) && ['s', 'z', 'y'].includes(event.key.toLowerCase()))) event.preventDefault()
})
function fail(error: unknown) { send({ event: 'fatal', message: error instanceof Error ? error.message : String(error) }); dispose() }
function tick(time: number) {
  if (stopped || !engine) return
  try {
    resize()
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
  assertDocument(document, { allowLegacy: true })
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
  assertDocument(document, { allowLegacy: true })
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
/** 源码签名：路径 + 内容，用于判断磁盘脚本是否仍与已安装程序集一致。 */
function signatureOf(scripts: ScriptEntry[]) {
  let hash = 0x811c9dc5
  for (const script of scripts) {
    const text = `${script.path}\u0000${script.text}\u0000`
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
  if (typeof payload.text !== 'string') throw new Error('脚本内容无效')
  if (payload.text.length > 512 * 1024) throw new Error('单个脚本不能超过 512 KiB')
  const fs = filesystem()
  const path = normalizeScriptPath(payload.path)
  const full = `${projectRoot}/${path}`
  const handle = (typeof payload.handle === 'string' && /^[1-9]\d*$/.test(payload.handle) ? payload.handle : undefined) ?? readHandle(`${full}.tcmeta`) ?? newHandle()
  fs.mkdirTree(full.slice(0, full.lastIndexOf('/')))
  fs.writeFile(full, payload.text)
  fs.writeFile(`${full}.tcmeta`, scriptMeta(handle))
  return { path, handle, className: classNameOf(path), text: payload.text }
}
function deleteScript(payload: { path: unknown }) {
  const fs = filesystem()
  const path = normalizeScriptPath(payload.path)
  const full = `${projectRoot}/${path}`
  try { fs.unlink(full) } catch { /* 文件已不存在。 */ }
  try { fs.unlink(`${full}.tcmeta`) } catch { /* 元数据已不存在。 */ }
}
async function buildCompileRequest(): Promise<{ request: CompileRequest; scripts: ScriptEntry[] }> {
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
      references: await engine!.references(),
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
async function compileScripts(): Promise<CompileOutcome> {
  const mode = state().mode
  if (mode && mode !== 'edit') throw new EngineError('PREVIEW_RUNNING', '请先停止运行预览，再编译 C# 脚本')
  const { request, scripts } = await buildCompileRequest()
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
  if (type === 'snapshot') return protocol.snapshot(state().sceneHandle)
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
    } else {
      bootPlayer(loaded.web, event.data.bytes, width, height)
    }
    observer = new ResizeObserver(resize); observer.observe(document.documentElement)
    send({ event: 'ready', snapshot }); frame = requestAnimationFrame(tick)
  } catch (error) { fail(error) }
})
