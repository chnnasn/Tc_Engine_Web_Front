import assert from 'node:assert/strict'
import { readScripts } from '../src/engine/scene-archive.ts'
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { engineRpc, engineState, nativeClick, openNativeScripts, dragFirstNativeScript } from './engine-browser-helpers.mjs'

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Run script fixtures against a local development server only')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('dialog', dialog => dialog.accept())
await page.addInitScript(() => localStorage.setItem('tomcat-ui-projects-v2-sidebar-test', JSON.stringify([
  { id: 'sidebar', name: '沿着风走', description: '一个正在制作的 2D 小游戏', template: '2D', image: '', status: 'draft', updated: '今天' },
])))
await page.route('**/v1/**', route => {
  const request = route.request(), path = new URL(request.url()).pathname
  if (path === '/v1/auth/me') return route.fulfill({ json: { id: 'sidebar-test', email: 'test@example.com', emailVerified: true } })
  if (path.endsWith('/sync-config')) return route.fulfill({ json: { enabled: false } })
  if (path === '/v1/projects' && request.method() === 'GET') return route.fulfill({ json: [] })
  if (path.includes('/uploads/')) return route.fulfill({ json: { uploadId: 'a'.repeat(32), contentHash: path.split('/').pop(), size: request.postDataBuffer().length } })
  if (path.endsWith('/revisions')) return route.fulfill({ json: { etag: '"' + 'b'.repeat(32) + '"' }, headers: { etag: '"' + 'b'.repeat(32) + '"' } })
  return route.fulfill({ json: { id: 'cloud-sidebar', currentRevisionId: null, etag: null } })
})
const button = name => page.getByRole('button', { name, exact: true })
const ready = () => page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'C# 脚本' && !b.disabled), null, { timeout: 120000 })
try {
  mkdirSync('.engine', { recursive: true })
  await page.goto(`${base}/editor/sidebar`)
  await ready()
  await button('C# 脚本').click()
  await page.getByPlaceholder('新脚本类名').fill('InspectorSmoke')
  await button('新建').click()
  await page.locator('.script-panel .list button', { hasText: 'InspectorSmoke.cs' }).waitFor()
  await button('收起 C# 脚本').click()
  await openNativeScripts(page)
  const snapshot = () => engineState(page).then(state => engineRpc(page, 'scene.snapshot', { sceneHandle: state.sceneHandle }))
  const player = (await snapshot()).entities.find(entity => entity.name === 'Player')
  const attachments = async () => readScripts((await snapshot()).archive, player.id)
  await dragFirstNativeScript(page)
  assert.equal((await attachments()).length, 1, 'uncompiled source attaches through the native Inspector')
  await dragFirstNativeScript(page)
  const pair = await attachments()
  assert.equal(pair.length, 2)
  assert.notEqual(pair[0].attachmentId, pair[1].attachmentId, 'each component owns a distinct attachment')
  await nativeClick(page, 1424, 429)
  await page.screenshot({ path: '.engine/inspector-script-remove-menu.png' })
  await nativeClick(page, 1330, 467) // Remove Component, even without managed metadata
  assert.deepEqual(await attachments(), [pair[1]], 'remove only the selected component')
  await page.keyboard.press('Control+z'); await page.waitForTimeout(250)
  assert.deepEqual(await attachments(), pair, 'native component removal is undoable')
  await page.keyboard.press('Control+y'); await page.waitForTimeout(250)
  assert.deepEqual(await attachments(), [pair[1]], 'native removal can be redone')
  await nativeClick(page, 1424, 429)
  await nativeClick(page, 1330, 467)
  assert.deepEqual(await attachments(), [], 'the final script component can be removed')
  await page.screenshot({ path: '.engine/inspector-script-removed.png' })
  await button('C# 脚本').click()
  await page.locator('.script-panel .list button', { hasText: 'InspectorSmoke.cs' }).waitFor()
  assert.equal(await button('挂载当前脚本').count(), 0)
  await button('收起 C# 脚本').click()
  await button('保存到云端').click()
  await page.getByText('完整项目已保存到云端', { exact: true }).waitFor()
  await page.reload(); await ready()
  assert.deepEqual(await attachments(), [], 'removed components stay removed after reload')
  await button('C# 脚本').click()
  await page.locator('.script-panel .list button', { hasText: 'InspectorSmoke.cs' }).waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS: native drag without metadata; distinct attachments; Remove Component; undo/redo; source retained; cloud fixture save/reload')
} catch (error) {
  await page.screenshot({ path: '.engine/inspector-script-failure.png' })
  throw error
} finally { await browser.close() }
