// Exercise the native editor contract; webpage duplicates of these controls were removed.
export const engineState = page => page.evaluate(() => JSON.parse(document.querySelector('iframe').contentWindow.TomCatWeb.engine.EditorState()))
export const engineRpc = (page, type, payload = {}) => page.evaluate(({ type, payload }) => {
  const reply = JSON.parse(document.querySelector('iframe').contentWindow.TomCatWeb.engine.EditorRpc(JSON.stringify({ protocol: 'tomcat.web.v1', requestId: 'browser-test', type, payload })))
  if (!reply.ok) throw new Error(JSON.stringify(reply.error))
  return reply.result
}, { type, payload })
export async function addEntity(page) {
  const state = await engineState(page)
  const entityId = String(BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000)))
  await engineRpc(page, 'scene.transact', { sceneHandle: state.sceneHandle, baseRevision: state.revision, label: 'Browser fixture', operations: [{ op: 'entity.create', entityId, name: 'New Entity' }] })
  return entityId
}
export async function preview(page, command) {
  await engineRpc(page, 'preview.control', { command })
  await waitMode(page, command === 'stop' ? 'edit' : ['pause', 'step'].includes(command) ? 'pause' : 'play')
}
export const waitMode = (page, mode) => page.waitForFunction(mode => JSON.parse(document.querySelector('iframe').contentWindow.TomCatWeb.engine.EditorState()).mode === mode, mode)
