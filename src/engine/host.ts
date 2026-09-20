import { EditorProtocol, EngineError, type SceneState, type Snapshot, type Operation } from './protocol'
import { assertDocument, engineCommit, projectRoot, validFilePath, type EngineDocument } from './storage'
import { loadModule, bootPlayer, shutdown, type EngineModule, type RuntimeKind } from './runtime'

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!
let module: EngineModule | undefined
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
function send(message: unknown) { port?.postMessage(message) }
function state(): SceneState { return JSON.parse(module!.ccall('tc_web_editor_state', 'string', [], [])) }
function dimensions() { return [Math.max(1, Math.min(8192, Math.round(innerWidth * devicePixelRatio))), Math.max(1, Math.min(8192, Math.round(innerHeight * devicePixelRatio)))] }
function resize() {
  const [w, h] = dimensions()
  if (width === w && height === h) return
  width = w!; height = h!; canvas.width = width; canvas.height = height
  module?.ccall(`tc_web_${kind}_resize`, null, ['number', 'number'], [width, height])
}
function dispose() {
  if (stopped) return
  stopped = true; cancelAnimationFrame(frame); observer?.disconnect()
  try { if (module) shutdown(module, kind) } finally { module = undefined; port?.close() }
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
  if (stopped || !module) return
  try {
    resize()
    module.ccall(`tc_web_${kind}_frame`, null, ['number'], [lastTime ? Math.min((time - lastTime) / 1000, .1) : 0]); lastTime = time
    const error = module.ccall(`tc_web_${kind}_error`, 'string', [], [])
    if (error) throw new Error(error)
    if (kind === 'editor') {
      const actions = module.ccall('tc_web_editor_take_actions', 'number', [], [])
      if (actions) send({ event: 'actions', actions })
      if (time - lastPoll > 100) {
        const current = module.ccall('tc_web_editor_state', 'string', [], [])
        if (current !== previousState) { previousState = current; send({ event: 'state', state: JSON.parse(current) }) }
        lastPoll = time
      }
    }
    frame = requestAnimationFrame(tick)
  } catch (error) { fail(error) }
}
function encode(bytes: Uint8Array) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}
function restore(document: EngineDocument) {
  assertDocument(document)
  if (document.version === 2) {
    // Fresh MEMFS only: replace the bundled source tree, never merge stale assets into a restored revision.
    const removeTree = (path: string) => {
      for (const name of module!.FS.readdir(path).filter(name => name !== '.' && name !== '..')) {
        const child = `${path}/${name}`
        if (module!.FS.isDir(module!.FS.stat(child).mode)) { removeTree(child); module!.FS.rmdir(child) }
        else module!.FS.unlink(child)
      }
    }
    removeTree(`${projectRoot}/Assets`); removeTree(`${projectRoot}/ProjectSettings`)
  }
  for (const [path, data] of Object.entries(document.files)) {
    const full = `${projectRoot}/${path}`
    module!.FS.mkdirTree(full.slice(0, full.lastIndexOf('/')))
    module!.FS.writeFile(full, Uint8Array.from(atob(data), c => c.charCodeAt(0)))
  }
}
function capture(): EngineDocument {
  const snapshot = protocol!.snapshot(state().sceneHandle)
  const files: Record<string, string> = {}
  const collect = (folder: string) => {
    for (const name of module!.FS.readdir(`${projectRoot}/${folder}`).filter(name => name !== '.' && name !== '..')) {
      const relative = `${folder}/${name}`
      if (module!.FS.isDir(module!.FS.stat(`${projectRoot}/${relative}`).mode)) collect(relative)
      else {
        if (!validFilePath(relative)) throw new Error(`不支持的项目文件路径：${relative}`)
        files[relative] = encode(module!.FS.readFile(`${projectRoot}/${relative}`))
      }
    }
  }
  collect('ProjectSettings'); collect('Assets')
  files['Project.tcproj'] = encode(module!.FS.readFile(`${projectRoot}/Project.tcproj`))
  const document: EngineDocument = { format: 'tomcat-engine-project', version: 2, engineCommit, sceneHandle: snapshot.sceneHandle, archive: snapshot.archive, files }
  assertDocument(document)
  return document
}
function command(type: string, payload: any) {
  if (!module || !protocol) throw new Error('编辑器尚未就绪')
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
    module.FS.mkdirTree(`${projectRoot}/Assets/WebImports`)
    module.FS.writeFile(`${projectRoot}/Assets/WebImports/${payload.name}`, payload.bytes)
    return protocol.request('asset.import', { name: payload.name })
  }
  throw new Error('Unknown host command')
}
addEventListener('message', async event => {
  if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'tomcat-connect' || port) return
  port = event.ports[0]
  kind = event.data.kind
  if (!port || !['editor', 'player'].includes(kind)) return
  port.onmessage = event => {
    const { id, type, payload } = event.data
    if (type === 'dispose') { dispose(); return }
    try { send({ id, result: command(type, payload) }) }
    catch (error) { send({ id, error: { code: error instanceof EngineError ? error.code : 'HOST_ERROR', message: error instanceof Error ? error.message : String(error) } }) }
  }
  try {
    const loaded = await loadModule(kind, canvas)
    if (stopped) { shutdown(loaded, kind); return }
    module = loaded
    ;[width, height] = dimensions() as [number, number]
    canvas.width = width; canvas.height = height
    let snapshot: Snapshot | undefined
    if (kind === 'editor') {
      if (module.ccall('tc_web_editor_boot', 'number', ['number', 'number'], [width, height]) !== 0) throw new Error(module.ccall('tc_web_editor_error', 'string', [], []))
      protocol = new EditorProtocol(json => module!.ccall('tc_web_editor_rpc', 'string', ['string'], [json]))
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
      bootPlayer(module, event.data.bytes, width, height)
    }
    observer = new ResizeObserver(resize); observer.observe(document.documentElement)
    send({ event: 'ready', snapshot }); frame = requestAnimationFrame(tick)
  } catch (error) { fail(error) }
})
