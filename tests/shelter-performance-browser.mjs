// Standalone performance observation of the real Shelter package. Gameplay is
// advanced only through ordinary UI controls; no model state is injected.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { readLoadedEngine } from './engine-provenance.mjs'

const startedAt = new Date().toISOString()
const output = resolve(process.env.TEST_SHELTER_PERFORMANCE_OUTPUT || `.engine/shelter-performance-qa/${startedAt.replaceAll(':', '-')}-${process.pid}`)
assert.ok(!existsSync(`${output}/evidence.json`), 'Never overwrite previous measurement evidence')
mkdirSync(output, { recursive: true })
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5199'
const viewport = { width: 1440, height: 1000 }, deviceScaleFactor = Number(process.env.TEST_DEVICE_SCALE || 1)
const configuredBudget = process.env.TEST_SHELTER_CPU_P95_MS
const cpuP95BudgetMs = configuredBudget === undefined ? null : Number(configuredBudget)
assert.ok(cpuP95BudgetMs === null || (Number.isFinite(cpuP95BudgetMs) && cpuP95BudgetMs > 0), 'TEST_SHELTER_CPU_P95_MS must be positive')
const manifest = JSON.parse(readFileSync('public/samples/shelter/manifest.json', 'utf8'))
const engineLock = JSON.parse(readFileSync('engine.lock.json', 'utf8'))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const testSha256 = sha256(readFileSync(fileURLToPath(import.meta.url)))
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: process.env.TEST_HEADED !== '1', args: ['--enable-webgl'] })
const page = await browser.newPage({ viewport, deviceScaleFactor })
const logs = [], errors = [], phases = [], snapshots = [], screenshots = [], budgetFailures = []
let frame, canvas, provenance, renderer, failure, cleanup, packageReceipt
page.on('console', message => { const value = message.text(); logs.push(value); if (value.includes('[Shelter]')) console.log(value) })
page.on('pageerror', error => errors.push(error.message))
await page.route('**/v1/**', route => route.fulfill({ status: route.request().url().includes('/auth/me') ? 401 : 200, json: [] }))
await page.addInitScript(() => {
  if (window === top) window.__shelterPerfAudio = []
  const Native = window.AudioContext
  if (Native) window.AudioContext = class extends Native {
    constructor(...args) { super(...args); top.__shelterPerfAudio.push(this) }
  }
})
const wait = milliseconds => page.waitForTimeout(milliseconds)
const count = text => logs.filter(line => line.includes(text)).length
function healthy() {
  assert.deepEqual(errors, [], 'browser has no uncaught errors')
  assert.deepEqual(logs.filter(line => /Unhandled exception|callback.*threw|\[tomcat-host\] fail|Deferred.*(?:failed|aborted)/i.test(line)), [], 'native scripts have no faults')
}
async function cue(text, previous = 0, timeout = 30000, reportProgress = false) {
  const begin = Date.now(), until = begin + timeout
  let nextProgress = begin + 15000
  while (count(text) <= previous && Date.now() < until) {
    healthy()
    if (reportProgress && Date.now() >= nextProgress) { console.log(`Waiting for first storm through normal 16x play: ${Math.round((Date.now() - begin) / 1000)}s elapsed`); nextProgress += 15000 }
    await wait(100)
  }
  assert.ok(count(text) > previous, `Expected normal gameplay event: ${text}`)
}
async function click(x, y) {
  const box = await canvas.boundingBox(), scale = Math.min(box.width / 1920, box.height / 1080)
  await page.mouse.click(box.x + box.width / 2 + (x - 960) * scale, box.y + box.height / 2 + (y - 540) * scale, { delay: 60 })
  await wait(180)
}
async function build(index) {
  const dx = (index % 5 - 2) * 129.6, dy = (Math.floor(index / 5) - 2) * 129.6
  await click(960 + dx, 540 + dy)
  await click(1193.5 + Math.max(-780, Math.min(530, dx)), 651.5 + Math.max(-400, Math.min(250, dy)))
  await cue(`[Shelter] build:${index}`)
}
async function capture(name) {
  await canvas.screenshot({ path: `${output}/${name}.png` })
  screenshots.push(`${name}.png`)
}
async function snapshot(label) {
  const value = await frame.evaluate(() => {
    const web = window.TomCatWeb, module = web.runtime.Module, gl = document.querySelector('canvas').getContext('webgl2')
    return { heapBytes: module.HEAPU8?.buffer?.byteLength ?? module.wasmMemory?.buffer?.byteLength ?? null,
      jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
      stats: web.engine.PlayerStats ? JSON.parse(web.engine.PlayerStats()) : null,
      audioStates: top.__shelterPerfAudio.map(context => context.state),
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], hidden: document.hidden }
  })
  assert.equal(value.hidden, false, 'measured game tab must remain visible')
  snapshots.push({ label, ...value })
}
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return { count: sorted.length, mean: sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : null,
    p50: sorted[Math.floor(sorted.length * .5)] ?? null, p95: sorted[Math.floor(sorted.length * .95)] ?? null,
    p99: sorted[Math.floor(sorted.length * .99)] ?? null, max: sorted.at(-1) ?? null,
    over33_84ms: sorted.filter(value => value > 33.84).length, over50ms: sorted.filter(value => value > 50).length }
}
async function measure(name, action = () => wait(3000)) {
  healthy(); await snapshot(`${name}:before`)
  await frame.evaluate(() => { window.__shelterPerfSamples = []; window.__shelterPerfRecording = true })
  try { await action() } finally { await frame.evaluate(() => { window.__shelterPerfRecording = false }) }
  const samples = await frame.evaluate(() => window.__shelterPerfSamples)
  const intervals = samples.slice(1).map((sample, index) => sample.at - samples[index].at)
  const phase = { name, cpu: stats(samples.map(sample => sample.ms)), intervals: stats(intervals),
    cadenceHz: intervals.length ? 1000 * intervals.length / intervals.reduce((sum, value) => sum + value, 0) : null, samples }
  phases.push(phase)
  console.log(JSON.stringify({ ...phase, samples: undefined }))
  assert.ok(samples.length > 0, `${name} has PlayerFrame samples`)
  if (cpuP95BudgetMs !== null && phase.cpu.p95 > cpuP95BudgetMs) budgetFailures.push({ name, actualCpuP95Ms: phase.cpu.p95, maximumCpuP95Ms: cpuP95BudgetMs })
  healthy(); await snapshot(`${name}:after`)
}

try {
  // Hashes and actual loaded provenance are checked before any measurement.
  const packageResponse = await page.request.get(`${base}/samples/shelter/shelter.tcpak`)
  assert.equal(packageResponse.status(), 200)
  const packageBytes = await packageResponse.body()
  packageReceipt = { url: packageResponse.url(), byteLength: packageBytes.length, sha256: sha256(packageBytes) }
  assert.equal(packageReceipt.byteLength, manifest.byteLength)
  assert.equal(packageReceipt.sha256, manifest.sha256)
  assert.equal(manifest.engineCommit, engineLock.commit)
  await page.route(url => new URL(url).pathname === '/samples/shelter/shelter.tcpak', route => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: packageBytes }))
  await page.goto(`${base}/games/shelter`)
  await page.getByRole('button', { name: '开始游玩', exact: true }).first().click()
  await page.locator('.player-status').filter({ hasText: '已就绪' }).waitFor({ timeout: 180000 })
  await cue('[Shelter] ready')
  frame = page.frames().find(value => value !== page.mainFrame()); canvas = frame.locator('canvas')
  provenance = await readLoadedEngine(frame)
  assert.equal(provenance.manifest.commit, engineLock.commit)
  renderer = await frame.evaluate(() => { const gl = document.querySelector('canvas').getContext('webgl2'), extension = gl.getExtension('WEBGL_debug_renderer_info'); return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown' })
  console.log(`Renderer: ${renderer}`)
  await frame.evaluate(() => {
    const engine = window.TomCatWeb.engine, original = engine.PlayerFrame
    window.__shelterPerfSamples = []; window.__shelterPerfRecording = false
    engine.PlayerFrame = function (...args) {
      if (!window.__shelterPerfRecording) return original.apply(this, args)
      const at = performance.now()
      try { return original.apply(this, args) }
      finally { if (window.__shelterPerfSamples.length < 30000) window.__shelterPerfSamples.push({ at, ms: performance.now() - at }) }
    }
  })
  await capture('menu')
  await click(960, 600); await cue('[Shelter] start'); await wait(1000)
  await measure('initial-1x')
  await capture('initial')
  await click(1855, 94); await cue('[Shelter] window:Settings')
  await measure('settings-paused')
  await click(960, 380)
  // Two food buildings and two walls are affordable from the original initial
  // resources. They exercise production without granting extra resources.
  for (const index of [7, 6, 0, 1]) await build(index)
  await click(1855, 94); await click(820, 845); await cue('[Shelter] speed:4')
  await click(820, 845); await cue('[Shelter] speed:16'); await click(960, 380)
  await measure('production-16x')
  await page.getByRole('button', { name: '全屏游玩', exact: true }).click(); await wait(500)
  await capture('settlement-fullscreen')
  await measure('fullscreen-16x')
  await measure('storm-entry-16x', () => cue('[Shelter] storm:5', 0, 240000, true))
  await capture('storm')
  await measure('storm', () => wait(6000))
  await measure('result-transition', async () => {
    await cue('[Shelter] storm result:', 0, 20000)
    // Keep recording the first result frames to include popup/font uploads.
    await wait(1000)
  })
  await capture('storm-result')
  await snapshot('result')
  await page.evaluate(() => document.exitFullscreen()); await wait(250)
  await page.getByRole('button', { name: '关闭播放器', exact: true }).click()
  cleanup = { iframeCount: await page.locator('iframe').count(), audioStates: await page.evaluate(() => window.__shelterPerfAudio.map(context => context.state)) }
  assert.equal(cleanup.iframeCount, 0)
  assert.ok(cleanup.audioStates.every(state => state === 'closed'), 'all created audio contexts close with the player')
  healthy()
  assert.deepEqual(budgetFailures, [], 'configured PlayerFrame CPU P95 budget')
  console.log('Shelter performance observation completed')
} catch (error) {
  failure = error.stack || String(error)
  try { await page.screenshot({ path: `${output}/failure-page.png`, fullPage: true }) } catch {}
  if (canvas) { try { await capture('failure') } catch {} }
  throw error
} finally {
  writeFileSync(`${output}/evidence.json`, JSON.stringify({ status: failure ? 'failed' : 'passed', startedAt, testSha256, failure, base, browser: browser.version(), viewport, deviceScaleFactor,
    package: manifest, packageReceipt, provenance, renderer, cpuP95BudgetMs, budgetFailures, phases, snapshots, screenshots, cleanup, logs, errors,
    notes: 'Run this script alone, without another GPU/browser benchmark or DevTools profiler. API auth/list calls are mocked; the verified native TCPAK and locked engine are real. All game progress uses normal mouse UI controls, including the 16x setting; no private state or resource injection. Hashing, GPU queries, screenshots and heap/stat snapshots are outside timed phases. CPU is synchronous PlayerFrame submission and can include driver waits; intervals are observed call cadence, not direct GPU/compositor frame-time measurements. A passed run without a configured CPU budget means observation/functional completion, not a universal FPS guarantee.' }, null, 2))
  await browser.close()
  console.log(`Evidence: ${output}`)
}
