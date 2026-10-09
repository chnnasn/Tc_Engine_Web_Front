// Run the real backend cook/worker.mjs against the locked engine's CoinRunner first.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const bytes = readFileSync(process.env.TEST_COOKED_PACKAGE || '.engine/upgrade-v6-coinrunner.tcpak')
const { commit } = JSON.parse(readFileSync('engine.lock.json', 'utf8'))
const debug = (...values) => { if (process.env.TEST_DEBUG) console.log(...values) }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
debug('browser started')
try {
  const page = await browser.newPage()
  page.on('dialog', dialog => dialog.accept())
  const errors = [], logs = []
  page.on('pageerror', error => { errors.push(error.message); debug('pageerror', error.message) })
  page.on('console', message => { if (!message.text().includes('GL_INVALID_OPERATION')) { logs.push(message.text()); debug(message.text()) } })
  await page.route('**/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/package')) return route.fulfill({ contentType: 'application/octet-stream', body: bytes })
    if (path === '/v1/games/published/cook-smoke') return route.fulfill({ json: { id: 'cook-smoke', title: 'CoinRunner', description: '', engineCommit: commit, byteLength: bytes.length, etag: 'test', publishedAt: new Date().toISOString() } })
    if (path === '/v1/auth/me') return route.fulfill({ status: 401, json: { error: 'guest' } })
    return route.fulfill({ json: [] })
  })
  await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/play/cook-smoke`)
  debug('page loaded')
  const running = page.getByText('作品正在运行，Esc 无法退出；关闭页面即可结束。', { exact: true })
  try { await running.or(page.getByRole('alert')).first().waitFor({ timeout: 60000 }) }
  catch (cause) { throw new Error(`${cause}\n${await page.locator('body').innerText()}\n${logs.slice(-40).join('\n')}\n${errors.join('\n')}`) }
  assert.ok(await running.isVisible(), `${await page.locator('body').innerText()}\n${logs.slice(-30).join('\n')}`)
  for (let i = 0; i < 100 && !logs.some(text => text.includes('[CoinRunner] started:')); i++) await new Promise(resolve => setTimeout(resolve, 100))
  assert.ok(logs.some(text => text.includes('[CoinRunner] started:')), `server-compiled C# Awake did not run: ${JSON.stringify(logs.slice(-30))}`)
  assert.deepEqual(errors, [])
  await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/play`)
  assert.equal(await page.locator('iframe').count(), 0)
  console.log('PASS: server-compiled MonoBehaviour payload runs in the matching browser player and closes cleanly')
} finally { await browser.close() }
