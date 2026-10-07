import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { engineRpc, engineState, waitMode, fillCode, visibleCode } from './engine-browser-helpers.mjs'

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Run publication fixtures against a local development server only')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('dialog', dialog => dialog.accept())
let publication, publishRequests = 0, withdrawals = 0
await page.addInitScript(() => localStorage.setItem('tomcat-ui-projects-v2-sidebar-test', JSON.stringify([
  { id: 'sidebar', name: '沿着风走', description: '一个正在制作的 2D 小游戏', template: '2D', image: '', status: 'draft', updated: '今天' },
])))
await page.route('**/v1/**', route => {
  const request = route.request(), path = new URL(request.url()).pathname
  if (path === '/v1/auth/me') return route.fulfill({ json: { id: 'sidebar-test', email: 'test@example.com', emailVerified: true } })
  if (path.endsWith('/sync-config')) return route.fulfill({ json: { enabled: false } })
  if (path === '/v1/projects' && request.method() === 'GET') return route.fulfill({ json: [] })
  if (path.endsWith('/publish')) {
    assert.equal(path, '/v1/projects/cloud-sidebar/publish', 'publish must use the cloud id, not the local project id')
    if (request.method() === 'POST') {
      publishRequests++
      assert.equal(request.postDataJSON().title, '沿着风走')
      publication = { ...request.postDataJSON(), projectId: 'cloud-sidebar', status: 'pending' }
      return route.fulfill({ json: publication })
    }
    if (request.method() === 'DELETE') { withdrawals++; publication = undefined; return route.fulfill({ status: 204 }) }
    if (!publication) return route.fulfill({ status: 404, json: {} })
    publication.status = 'published'
    return route.fulfill({ json: publication })
  }
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
  for (const name of ['添加对象', '撤销', '重做', '运行预览', '云端', '发布']) assert.equal(await page.locator('.native-toolbar').getByRole('button', { name, exact: true }).count(), 0)
  // Click the shared native Play/Pause/Step/Stop toolbar, not replacement webpage controls.
  await page.waitForTimeout(250)
  const native = await page.locator('iframe').boundingBox()
  const nativeControl = offset => page.mouse.click(native.x + native.width / 2 + offset, native.y + 41)
  await nativeControl(-28); await waitMode(page, 'play')
  await nativeControl(0); await waitMode(page, 'pause')
  await nativeControl(28); await waitMode(page, 'pause')
  await nativeControl(-28); await waitMode(page, 'edit')
  const canvasBefore = await page.locator('iframe').boundingBox()
  await button('C# 脚本').click()
  assert.deepEqual(await page.locator('iframe').boundingBox(), canvasBefore, 'opening scripts must not resize the engine')
  await page.getByPlaceholder('新脚本类名').fill('PlayerMovement')
  await button('新建').click()
  await page.locator('.script-panel .list button', { hasText: 'PlayerMovement.cs' }).waitFor()
  const source = 'using TomCat;\n\npublic sealed class PlayerMovement : TomCatBehaviour\n{\n    protected override void OnUpdate(float deltaTime)\n    {\n        // 在这里编写角色的移动逻辑\n    }\n}\n'
  await fillCode(page, source)
  const codeInput = page.getByRole('textbox', { name: 'C# 脚本源码', exact: true })
  await codeInput.press('Control+Home')
  await codeInput.press('Tab')
  assert.match(await visibleCode(page), /^ {4}using TomCat;/, 'Tab inserts indentation in the code editor')
  await codeInput.press('Control+z')
  assert.equal(await visibleCode(page), source.trimEnd(), 'code undo restores the draft without changing the scene')
  await button('AI 助手').click()
  assert.equal(await page.locator('.script-panel').isVisible(), false)
  assert.equal(await page.locator('.agent-panel').isVisible(), true)
  assert.deepEqual(await page.locator('iframe').boundingBox(), canvasBefore, 'opening AI must not resize the engine')
  await page.screenshot({ path: '.engine/agent-floating-desktop.png' })
  await button('C# 脚本').click()
  assert.equal(await page.locator('.agent-panel').isVisible(), false)
  assert.equal(await visibleCode(page), source.trimEnd(), 'switching to AI must preserve the script draft')
  await button('收起 C# 脚本').click()
  assert.equal(await button('C# 脚本').evaluate(element => element === document.activeElement), true)
  await button('C# 脚本').click()
  assert.equal(await visibleCode(page), source.trimEnd())
  const state = await engineState(page)
  const snapshot = await engineRpc(page, 'scene.snapshot', { sceneHandle: state.sceneHandle })
  const player = snapshot.entities.find(entity => entity.name === 'Player')
  await engineRpc(page, 'scene.select', { sceneHandle: state.sceneHandle, entityId: player.id })
  await page.locator('.attach-heading strong', { hasText: 'Player' }).waitFor()
  const canvas = await page.locator('iframe').boundingBox(), panel = await page.locator('.script-panel').boundingBox()
  assert.deepEqual(canvas, canvasBefore, 'switching panels must preserve engine geometry')
  assert.ok(panel.x > canvas.x && panel.x + panel.width < canvas.x + canvas.width && panel.y > canvas.y, 'script panel must float over the engine')
  assert.ok(await page.locator('.code-editor .line-numbers').count() > 1, 'code editor shows line numbers')
  const colors = await page.locator('.code-editor .view-line span').evaluateAll(spans => [...new Set(spans.filter(span => span.textContent.trim()).map(span => getComputedStyle(span).color))])
  assert.ok(colors.length >= 3, 'keywords, comments and identifiers have distinct highlighting')
  await page.screenshot({ path: '.engine/script-sidebar-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.script-panel').scrollIntoViewIfNeeded()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'narrow screen must not overflow horizontally')
  await page.screenshot({ path: '.engine/script-sidebar-mobile.png' })
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.getByLabel('C# 脚本源码').press('Control+s')
  await page.getByText('脚本已写入项目文件，请编译并保存项目', { exact: true }).waitFor()
  await button('保存到云端').click()
  await page.getByText('完整项目已保存到云端', { exact: true }).waitFor()
  await button('返回项目').click()
  await page.getByRole('heading', { name: '我的项目' }).waitFor()
  await page.locator('.project-card').getByRole('button', { name: '发布', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '发布', exact: true }).click()
  await dialog.getByText('已发布', { exact: true }).waitFor()
  assert.equal(publishRequests, 1)
  await dialog.getByRole('button', { name: '更新发布', exact: true }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('dialog button')].some(button => button.textContent.trim() === '更新发布' && !button.disabled))
  await dialog.getByText('已发布', { exact: true }).waitFor()
  assert.equal(publishRequests, 2)
  await dialog.getByRole('button', { name: '取消发布', exact: true }).click()
  await page.getByText('已取消发布', { exact: true }).waitFor()
  assert.equal(withdrawals, 1)
  await button('关闭对话框').click()
  await page.screenshot({ path: '.engine/projects-publish.png' })
  // A locally pending project cannot silently publish a stale cloud revision.
  await page.evaluate(async () => {
    const db = await new Promise(resolve => { const request = indexedDB.open('tomcat-engine-v1'); request.onsuccess = () => resolve(request.result) })
    await new Promise(resolve => { const tx = db.transaction('cloudLinks', 'readwrite'); const store = tx.objectStore('cloudLinks'); const read = store.get('sidebar'); read.onsuccess = () => store.put({ ...read.result, pending: true }, 'sidebar'); tx.oncomplete = resolve })
    db.close()
  })
  await page.locator('.project-card').getByRole('button', { name: '发布', exact: true }).click()
  assert.equal(await dialog.getByRole('button', { name: '发布', exact: true }).isDisabled(), true)
  assert.match(await dialog.textContent(), /尚未同步/)
  assert.equal(publishRequests, 2)
  assert.deepEqual(errors, [])
  console.log('PASS: removed toolbar controls; floating panels and highlighted C#; AI/collapse draft retention; native selection; narrow layout; shortcut save; project publish/update/withdraw; stale draft blocked')
} catch (error) {
  console.error(await page.locator('body').innerText())
  await page.screenshot({ path: '.engine/sidebar-test-failure.png' })
  throw error
} finally { await browser.close() }
