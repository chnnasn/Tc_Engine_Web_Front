// Run the real backend cook/worker.mjs against the locked engine's CoinRunner first.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { readLoadedEngine } from './rougelike-performance-probe.mjs'

const bytes = readFileSync(process.env.TEST_COOKED_PACKAGE || '.engine/upgrade-v6-coinrunner.tcpak')
const pin = JSON.parse(readFileSync('engine.lock.json', 'utf8'))
const { commit } = pin
const packageSha256 = createHash('sha256').update(bytes).digest('hex')
const manifest = process.env.TEST_COOKED_MANIFEST ? JSON.parse(readFileSync(process.env.TEST_COOKED_MANIFEST, 'utf8')) : null
if (manifest) {
  assert.equal(bytes.length, manifest.byteLength, 'legacy package length must match its retained manifest')
  assert.equal(packageSha256, manifest.sha256, 'legacy package bytes must match their retained manifest')
  assert.match(manifest.engineCommit, /^[a-f0-9]{40}$/, 'retained manifest must identify its engine revision')
  if (process.env.TEST_PACKAGE_ENGINE_COMMIT) assert.equal(manifest.engineCommit, process.env.TEST_PACKAGE_ENGINE_COMMIT, 'requested revision must agree with the retained manifest')
}
const packageCommit = manifest?.engineCommit || process.env.TEST_PACKAGE_ENGINE_COMMIT || commit
assert.match(packageCommit, /^[a-f0-9]{40}$/)
assert.ok([commit, ...(pin.legacyCommits || [])].includes(packageCommit), 'package revision must be explicitly supported by the locked runtime')
const title = process.env.TEST_PACKAGE_TITLE || 'CoinRunner'
const readyLog = process.env.TEST_PACKAGE_READY_LOG || '[CoinRunner] started:'
const debug = (...values) => { if (process.env.TEST_DEBUG) console.log(...values) }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
debug('browser started')
try {
  const page = await browser.newPage()
  page.on('dialog', dialog => dialog.accept())
  const errors = [], logs = []
  let packageRequests = 0
  page.on('pageerror', error => { errors.push(error.message); debug('pageerror', error.message) })
  page.on('console', message => { if (!message.text().includes('GL_INVALID_OPERATION')) { logs.push(message.text()); debug(message.text()) } })
  await page.route('**/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/v1/games/published/cook-smoke/package') {
      packageRequests++
      return route.fulfill({ contentType: 'application/octet-stream', body: bytes })
    }
    if (path === '/v1/games/published/cook-smoke') return route.fulfill({ json: { id: 'cook-smoke', title, description: '', engineCommit: packageCommit, byteLength: bytes.length, etag: 'test', publishedAt: new Date().toISOString() } })
    if (path === '/v1/auth/me') return route.fulfill({ status: 401, json: { error: 'guest' } })
    return route.fulfill({ json: [] })
  })
  await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/play/cook-smoke`)
  debug('page loaded')
  const running = page.getByText('作品正在运行，Esc 无法退出；关闭页面即可结束。', { exact: true })
  try { await running.or(page.getByRole('alert')).first().waitFor({ timeout: 60000 }) }
  catch (cause) { throw new Error(`${cause}\n${await page.locator('body').innerText()}\n${logs.slice(-40).join('\n')}\n${errors.join('\n')}`) }
  assert.ok(await running.isVisible(), `${await page.locator('body').innerText()}\n${logs.slice(-30).join('\n')}`)
  for (let i = 0; i < 100 && !logs.some(text => text.includes(readyLog)); i++) await new Promise(resolve => setTimeout(resolve, 100))
  assert.ok(logs.some(text => text.includes(readyLog)), `server-compiled C# Awake did not run: ${JSON.stringify(logs.slice(-30))}`)
  assert.equal(packageRequests, 1, 'player must request the exact supplied package')
  const frame = page.frames().find(item => item !== page.mainFrame())
  assert.ok(frame, 'running player iframe must exist')
  const loadedEngine = await readLoadedEngine(frame)
  assert.equal(loadedEngine.manifest.commit, commit, 'verify the actual browser runtime, not only the local lock file')
  assert.ok([commit, ...(loadedEngine.manifest.legacyCommits || [])].includes(packageCommit), 'loaded runtime must explicitly accept this package revision')
  const hooked = await frame.evaluate(() => {
    const engine = window.TomCatWeb.engine, original = engine.PlayerFrame
    window.__compatFrames = 0
    const wrapped = function (...args) {
      const result = original.apply(this, args)
      window.__compatFrames++
      return result
    }
    engine.PlayerFrame = wrapped
    return engine.PlayerFrame === wrapped
  })
  assert.ok(hooked, 'observe actual engine frames after package startup')
  await frame.waitForFunction(() => window.__compatFrames >= 5, null, { timeout: 30000 })
  await page.waitForTimeout(1000)
  assert.ok(!logs.some(value => /callback \w+ threw|MissingMethodException|aborted before live mutation|Unhandled exception|\[tomcat-host\] fail:/.test(value)), `Managed/host failure after startup: ${logs.slice(-30).join('\n')}`)
  assert.deepEqual(errors, [])
  await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/play`)
  assert.equal(await page.locator('iframe').count(), 0)
  console.log(`PASS: MonoBehaviour package (${packageCommit}, sha256 ${packageSha256}) starts and advances in verified browser player (${loadedEngine.manifest.commit}); player route unloads`)
} finally { await browser.close() }
