import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '0'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let browser, releaseUpload
try {
  const base = await new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error(output || 'Vite did not start')), 30000)
    const read = data => { output += data; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]) } }
    server.stdout.on('data', read); server.stderr.on('data', read); server.once('error', reject)
  })
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('tomcat-ui-projects-v2-save-test', JSON.stringify([{ id: 'save-test', name: '保存状态检查', template: '2D', image: '', status: 'draft', updated: '今天', description: '' }]))
    window.captureCount = 0
    const send = MessagePort.prototype.postMessage
    MessagePort.prototype.postMessage = function(message, ...args) {
      // Make the periodic capture long enough for transient disabled-state regressions to surface.
      if (message?.type === 'capture') { window.captureCount++; setTimeout(() => send.call(this, message, ...args), 300); return }
      return send.call(this, message, ...args)
    }
  })
  const uploadGate = new Promise(resolve => { releaseUpload = resolve })
  let workingWrites = 0, manualWrites = 0, etag = null
  await page.route('**/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === '/v1/auth/me') return route.fulfill({ json: { id: 'save-test', email: 'test@example.com', emailVerified: true } })
    if (path.endsWith('/sync-config')) return route.fulfill({ json: { enabled: true } })
    if (path.includes('/uploads/by-hash/')) return route.fulfill({ status: 404, json: {} })
    if (path.includes('/uploads/')) return route.fulfill({ json: { uploadId: 'a'.repeat(32), contentHash: path.split('/').pop(), size: request.postDataBuffer().length } })
    if (path.endsWith('/working-state')) {
      workingWrites++
      await uploadGate
      etag = '"' + 'b'.repeat(32) + '"'
      return route.fulfill({ status: 202, json: { etag }, headers: { etag } })
    }
    if (path.endsWith('/revisions')) {
      manualWrites++
      assert.equal(request.headers()['if-match'], etag, 'queued manual save uses acknowledged automatic ETag')
      etag = '"' + 'c'.repeat(32) + '"'
      return route.fulfill({ json: { etag }, headers: { etag } })
    }
    if (path.endsWith('/sync-status')) return route.fulfill({ json: { etag, persisted: true } })
    return route.fulfill({ json: { id: 'cloud-save-test', currentRevisionId: null, etag: null } })
  })
  const uploadStarted = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/working-state'), { timeout: 120000 })
  await page.goto(`${base}/editor/save-test`)
  await uploadStarted
  await page.getByText('自动保存中…', { exact: true }).waitFor({ timeout: 120000 })
  const save = page.getByRole('button', { name: '保存到云端', exact: true })
  for (const name of ['保存到云端', '导出项目', 'C# 脚本', 'AI 助手']) assert.equal(await page.getByRole('button', { name, exact: true }).isEnabled(), true, `${name} stays enabled during automatic upload`)
  assert.equal(workingWrites, 1)
  await save.click()
  assert.equal(manualWrites, 0, 'manual save waits rather than overlapping the upload')
  releaseUpload()
  await page.getByText('完整项目已保存到云端', { exact: true }).waitFor()
  assert.equal(manualWrites, 1, 'manual save was not silently dropped')
  const before = await page.locator('.native-toolbar button').evaluateAll(buttons => buttons.map(button => ({ text: button.textContent, x: button.getBoundingClientRect().x, width: button.getBoundingClientRect().width })))
  const captures = await page.evaluate(() => {
    window.toolbarDisabledChanges = []
    new MutationObserver(records => { for (const r of records) if (r.attributeName === 'disabled') window.toolbarDisabledChanges.push(r.target.textContent) }).observe(document.querySelector('.native-toolbar'), { subtree: true, attributes: true, attributeFilter: ['disabled'] })
    return window.captureCount
  })
  await page.waitForFunction(n => window.captureCount >= n + 3, captures, { timeout: 15000 })
  assert.deepEqual(await page.evaluate(() => window.toolbarDisabledChanges), [], 'idle polling never toggles toolbar disabled states')
  const after = await page.locator('.native-toolbar button').evaluateAll(buttons => buttons.map(button => ({ text: button.textContent, x: button.getBoundingClientRect().x, width: button.getBoundingClientRect().width })))
  assert.deepEqual(after, before, 'toolbar geometry remains stable over multiple polls')
  await mkdir('docs/interaction-preview', { recursive: true })
  await page.screenshot({ path: 'docs/interaction-preview/save-toolbar.png' })
  assert.deepEqual(errors, [])
  console.log('PASS: automatic upload keeps controls enabled; queued manual save uses current ETag; three idle polls cause no disabled-state changes or layout shifts')
} finally {
  releaseUpload?.()
  await browser?.close()
  if (server.exitCode === null) server.kill()
}
