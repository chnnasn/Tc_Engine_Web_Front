import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { engineRpc, engineState, nativeClick, addEntity, fillCode, visibleCode } from './engine-browser-helpers.mjs'

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Run script fixtures against a local development server only')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
const dialogs = []; page.on('dialog', dialog => { dialogs.push(dialog.type()); void dialog.accept() })
await page.addInitScript(() => localStorage.setItem('tomcat-ui-projects-v2-sidebar-test', JSON.stringify([
  { id: 'sidebar', name: '沿着风走', description: '一个正在制作的 2D 小游戏', template: '2D', image: '', status: 'draft', updated: '今天' },
])))
let revisionGate, rejectSave = false, lastManifest, revisions = 0, etag = null
await page.route('**/v1/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname
  if (path === '/v1/auth/me') return route.fulfill({ json: { id: 'sidebar-test', email: 'test@example.com', emailVerified: true } })
  if (path.endsWith('/sync-config')) return route.fulfill({ json: { enabled: false } })
  if (path === '/v1/projects' && request.method() === 'GET') return route.fulfill({ json: [] })
  if (path.includes('/uploads/')) return route.fulfill({ json: { uploadId: 'a'.repeat(32), contentHash: path.split('/').pop(), size: request.postDataBuffer().length } })
  if (path.endsWith('/revisions')) {
    revisions++
    if (revisionGate) await revisionGate
    if (rejectSave) return route.fulfill({ status: 503, json: { error: '测试保存失败' } })
    lastManifest = request.postDataJSON()
    etag = '"' + String(revisions).padStart(32, '0') + '"'
    return route.fulfill({ json: { etag }, headers: { etag } })
  }
  return route.fulfill({ json: { id: 'cloud-sidebar', currentRevisionId: null, etag } })
})
const button = name => page.getByRole('button', { name, exact: true })
const ready = () => page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'C# 脚本' && !b.disabled), null, { timeout: 120000 })
const layoutKey = 'tomcat.web-editor-layout.v1'
const layout = async () => (await engineRpc(page, 'editor.saveLayout')).settings
const storedLayout = () => page.evaluate(key => localStorage.getItem(key), layoutKey)
const reopen = async () => { await page.goto(`${base}/editor/sidebar`); await ready(); await page.waitForTimeout(200) }
try {
  mkdirSync('.engine', { recursive: true })
  await reopen()
  await nativeClick(page, 320, 675)
  await nativeClick(page, 968, 675)
  await nativeClick(page, 1002, 720) // One Column, through the actual menu
  assert.match(await layout(), /Layout=OneColumn/)
  await page.waitForFunction(key => localStorage.getItem(key)?.includes('Layout=OneColumn'), layoutKey)
  await page.reload(); await ready(); await page.waitForTimeout(200)
  assert.match(await layout(), /Layout=OneColumn/, 'automatic layout save survives refresh')
  // Move the dock splitter and switch back; return immediately, without waiting for the periodic flush.
  await page.mouse.move(979,400); await page.waitForTimeout(180); await page.mouse.down(); await page.mouse.move(900,400,{steps:12}); await page.mouse.up(); await page.waitForTimeout(200)
  const resized = await layout()
  assert.match(resized, /SizeRef=5\d\d,866/, 'Inspector width changed')
  await engineRpc(page, 'editor.loadLayout', { settings: resized.replace('Layout=OneColumn', 'Layout=TwoColumn') })
  await page.waitForTimeout(100)
  await addEntity(page)
  let release
  revisionGate = new Promise(resolve => { release = resolve })
  const started = page.waitForRequest(r => new URL(r.url()).pathname.endsWith('/revisions'))
  await button('返回项目').click(); await started
  assert.equal(await page.locator('iframe').count(), 1, 'editor remains mounted until the cloud revision is acknowledged')
  await page.getByText('正在保存，完成后返回…', { exact: true }).waitFor()
  release(); revisionGate = undefined
  await page.getByRole('heading', { name: '我的项目' }).waitFor()
  assert.match(lastManifest.archive, /New Entity/, 'return saves recent native edits')
  assert.match(await storedLayout(), /Layout=TwoColumn/)
  const saved = await storedLayout()
  await reopen()
  assert.match(await layout(), /Layout=TwoColumn/)
  assert.equal((await layout()).match(/DockNode +ID=0x00000004[^\n]+/)?.[0], saved.match(/DockNode +ID=0x00000004[^\n]+/)?.[0], 'dock width is restored')
  // Dispose used to skip its flush because stopped was set first. Exercise it before the timer runs.
  await engineRpc(page, 'editor.loadLayout', { settings: (await layout()).replace('Layout=TwoColumn', 'Layout=OneColumn') })
  await page.evaluate(() => document.querySelector('iframe').contentWindow.dispatchEvent(new Event('pagehide')))
  assert.match(await storedLayout(), /Layout=OneColumn/, 'shutdown flush occurs before the engine stops')
  await page.reload(); await ready()
  // Existing layout keys migrate across a format-compatible engine upgrade.
  const current = await storedLayout()
  await page.goto(`${base}/projects`)
  await page.evaluate(({key, current}) => { localStorage.removeItem(key); localStorage.setItem(`${key}.41708b6c756d530a1c71f0e0ef2539a1df1bb03e`, current.replace('OneColumn', 'TwoColumn')); localStorage.setItem(`${key}.2ee941e6ad50e5797ec91bbfb90d0d29a0ece30e`, current) }, { key: layoutKey, current })
  await reopen()
  assert.match(await layout(), /Layout=OneColumn/)
  assert.ok(await storedLayout(), 'legacy layout migrated to the stable key')
  // Draft source is flushed too. A failed save must keep both the editor and draft available.
  await button('C# 脚本').click()
  await page.getByPlaceholder('新脚本类名').fill('LeaveSmoke')
  await button('新建').click()
  await page.locator('.script-panel .list button', {hasText:'LeaveSmoke.cs'}).waitFor()
  const source = 'using TomCat;\npublic sealed class LeaveSmoke : TomCatBehaviour { /* EXIT_DRAFT */ }'
  await fillCode(page, source)
  rejectSave = true
  await button('返回项目').click()
  await page.getByText('测试保存失败', { exact: true }).waitFor()
  assert.equal(await page.locator('iframe').count(), 1)
  assert.equal(await visibleCode(page), source)
  rejectSave = false
  await button('返回项目').click()
  await page.getByRole('heading', { name: '我的项目' }).waitFor()
  assert.ok(lastManifest.files.some(file => file.path === 'Assets/Scripts/LeaveSmoke.cs'))
  await reopen(); await button('C# 脚本').click()
  await page.locator('.script-panel .list button', {hasText:'LeaveSmoke.cs'}).waitFor()
  await page.getByRole('textbox', { name: 'C# 脚本源码', exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('.code-editor .view-lines')?.textContent.includes('EXIT_DRAFT'))
  assert.equal(await visibleCode(page), source, 'unsaved source draft survives exit and reopen')
  await button('收起 C# 脚本').click()
  // Browser Back uses the same asynchronous save guard.
  await page.goto(`${base}/projects`)
  await page.locator('.project-card').getByRole('link', { name: '打开编辑器', exact: true }).click()
  await ready(); await addEntity(page)
  const before = revisions
  await page.goBack()
  await page.getByRole('heading', { name: '我的项目' }).waitFor()
  assert.ok(revisions > before, 'Back saved a durable revision')
  assert.equal(dialogs.includes('confirm'), false, 'normal exits no longer ask to discard edits')
  assert.deepEqual(errors, [])
  console.log('PASS: native column mode, automatic layout save, dock widths, shutdown flush, version migration, exit waits for cloud, failure stays open, source drafts, browser Back')
} catch (error) {
  await page.screenshot({ path: '.engine/layout-exit-failure.png' }); throw error
} finally { await browser.close() }
