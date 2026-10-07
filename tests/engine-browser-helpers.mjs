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
export async function fillCode(page, source) {
  const input = page.getByRole('textbox', { name: 'C# 脚本源码', exact: true })
  await input.press('Control+a')
  await input.evaluate((element, text) => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', text)
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  }, source)
}
export const visibleCode = page => page.locator('.code-editor .view-line').evaluateAll(lines => lines.map(line => line.textContent.replaceAll('\u00a0', ' ').trimEnd()).join('\n').trimEnd())

// Native ImGui consumes hover and button events across frames. These coordinates
// target the default dock layout at the browser suites' 1440 x 960 viewport.
export async function nativeClick(page, x, y) {
  await page.mouse.move(x, y)
  await page.waitForTimeout(180)
  await page.mouse.click(x, y, { delay: 80 })
  await page.waitForTimeout(180)
}
export async function openNativeScripts(page) {
  await nativeClick(page, 320, 675) // Project tab
  await nativeClick(page, 375, 767) // Assets/Scripts
  await nativeClick(page, 100, 233) // Player entity; clear asset inspection
}
export async function dragFirstNativeScript(page) {
  await page.mouse.move(620, 810)
  await page.waitForTimeout(180)
  await page.mouse.down()
  await page.mouse.move(660, 790, { steps: 5 })
  await page.waitForTimeout(180)
  await page.mouse.move(1150, 550, { steps: 15 })
  await page.waitForTimeout(180)
  await page.mouse.up()
  await page.waitForTimeout(250)
}
