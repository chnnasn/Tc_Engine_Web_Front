// One separate QA fixture covers every source stage/realm using private F9/F10
// navigation in a project copy; this is not evidence of
// naturally completing all puzzles. The production smoke uses return-browser.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { buildFixture, productionReceipt, root } from './return-fixture.mjs'
import { readLoadedEngine } from './engine-provenance.mjs'

const startedAt = new Date().toISOString()
const testSha256 = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex')
const output = resolve(process.env.TEST_RETURN_LEVELS_OUTPUT || `${root}/.engine/return-levels-qa/${startedAt.replace(/[:.]/g, '-')}-${process.pid}`)
assert.ok(!existsSync(`${output}/evidence.json`), 'Never overwrite performance evidence')
mkdirSync(output, { recursive: true })
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5187'
const coverOnly = process.argv.includes('--cover-only')
const seconds = Number(process.env.TEST_RETURN_LEVEL_SECONDS || 4)
assert.ok(Number.isFinite(seconds) && seconds >= 2 && seconds <= 60)
const selections = (process.env.TEST_RETURN_LEVELS || Array.from({ length: 7 }, (_, stage) => `${stage}:0,${stage}:1`).join(','))
  .split(',').map(value => { const [stage, realm] = value.split(':').map(Number); return { stage, realm } })
assert.ok(selections.length >= 1 && selections.length <= 14)
for (const selection of selections) assert.ok(Number.isInteger(selection.stage) && selection.stage >= 0 && selection.stage <= 6 && [0, 1].includes(selection.realm))
const sourceReceipt = productionReceipt()
const reuse = process.env.TEST_RETURN_FIXTURES ? JSON.parse(readFileSync(process.env.TEST_RETURN_FIXTURES, 'utf8')) : []
const previous = reuse.find(value => value.manifest?.stage === 0 && value.manifest?.realm === 0)
const fixture = buildFixture({ stage: 0, realm: 0, directory: previous?.directory }), fixtures = [fixture]
console.log(`QA navigation fixture: ${fixture.directory}`)
writeFileSync(`${output}/fixtures.json`, JSON.stringify(fixtures, null, 2))
if (process.argv.includes('--build-only')) process.exit(0)

const softwareGPU = process.env.TEST_SOFTWARE_GPU === '1'
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true,
  args: softwareGPU ? ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-webgl'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage(), runs = [], errors = [], logs = []
const fatalRuntimeLog = /\[tomcat-host\] fail|Missing C# script asset|Unhandled exception|callback\s+\w+\s+threw|Deferred[^\r\n]*(?:aborted|failed)/i
function assertRuntimeHealthy() {
  assert.deepEqual(errors, [], 'browser must not report uncaught errors')
  assert.deepEqual(logs.filter(value => fatalRuntimeLog.test(value)), [], 'native runtime must not report script faults or aborted deferred commands')
}
page.setDefaultTimeout(30000)
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { const value = message.text(); logs.push(value); if (value.includes('[Return]')) console.log(value) })
await page.route('**/v1/**', route => route.fulfill({ status: route.request().url().includes('/auth/me') ? 401 : 200, json: [] }))
let activePackage, failure, frame, canvas, renderer, receipt, loadedEngine, cover
await page.route(url => new URL(url).pathname === '/samples/return/return.tcpak', route => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: activePackage }))
await page.addInitScript(() => {
  if (window === top) { window.__returnQaContexts = []; return }
  const state = window.__returnQaPerf = { recording: false, samples: [], current: null }
  const raf = requestAnimationFrame
  window.requestAnimationFrame = callback => raf.call(window, timestamp => {
    if (!state.recording) return callback(timestamp)
    const start = performance.now(), sample = { timestamp, engineCalls: 0, engineMs: 0 }
    state.current = sample
    try { return callback(timestamp) }
    finally { sample.cpuMs = performance.now() - start; state.samples.push(sample); state.current = null }
  })
  const Native = globalThis.AudioContext
  if (Native) globalThis.AudioContext = class extends Native {
    constructor(...args) { super(...args); top.__returnQaContexts.push(this) }
  }
  const fetchNative = globalThis.fetch.bind(globalThis)
  globalThis.fetch = async (...args) => {
    const response = await fetchNative(...args), requested = typeof args[0] === 'string' ? args[0] : args[0].url
    if (new URL(response.url || requested, location.href).pathname === '/samples/return/return.tcpak') {
      const bytes = await response.clone().arrayBuffer(), digest = await crypto.subtle.digest('SHA-256', bytes)
      top.__returnQaReceipt = { bytes: bytes.byteLength, sha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') }
    }
    return response
  }
})
// Package fetch belongs to the top document; retain the exact served fixture hash.
await page.addInitScript(() => {
  if (window !== top) return
  const nativeFetch = fetch.bind(window)
  window.fetch = async (...args) => {
    const response = await nativeFetch(...args), requested = typeof args[0] === 'string' ? args[0] : args[0].url
    if (new URL(response.url || requested, location.href).pathname === '/samples/return/return.tcpak') {
      const bytes = await response.clone().arrayBuffer(), digest = await crypto.subtle.digest('SHA-256', bytes)
      window.__returnQaReceipt = { bytes: bytes.byteLength, sha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') }
    }
    return response
  }
})
const wait = milliseconds => page.waitForTimeout(milliseconds)
async function press(key) { await page.keyboard.press(key, { delay: 80 }); await wait(100) }
async function snapshot(label) {
  assertRuntimeHealthy()
  const begin = logs.length
  await press('F8')
  const deadline = Date.now() + 10000
  while (!logs.slice(begin).some(value => value.includes('[ReturnQA] end')) && Date.now() < deadline) await wait(50)
  const lines = logs.slice(begin).filter(value => value.includes('[ReturnQA] ')).map(value => value.split('[ReturnQA] ')[1])
  assert.ok(lines.includes('end'), 'QA diagnostic snapshot must come from the fixture')
  assertRuntimeHealthy()
  const state = lines.find(value => value.startsWith('state|'))?.split('|').slice(1).map(Number)
  assert.equal(state?.length, 7)
  const entries = type => lines.filter(value => value.startsWith(`${type}|`)).map(value => value.split('|').slice(1).map(Number))
  const memory = await frame.evaluate(() => { const module = window.TomCatWeb.runtime.Module; return {
    wasmHeapBytes: module.HEAPU8?.buffer?.byteLength ?? module.wasmMemory?.buffer?.byteLength ?? null,
    jsHeapBytes: performance.memory?.usedJSHeapSize ?? null } })
  return { label, memory, stage: state[0], realm: state[1], x: state[2], y: state[3], grounded: !!state[4], paused: !!state[5], corpses: state[6],
    maps: entries('map').map(([index, native, visible]) => ({ index, native: !!native, visible: !!visible })),
    boxes: entries('box').map(([index, x, y, enabled]) => ({ index, x, y, enabled: !!enabled })),
    buttons: entries('button').map(([index, pressed, target]) => ({ index, pressed: !!pressed, target })),
    doors: entries('door').map(([index, on, visible]) => ({ index, on: !!on, visible: !!visible })) }
}
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b)
  return { count: sorted.length, median: sorted[Math.floor(sorted.length * .5)] ?? null,
    p95: sorted[Math.floor(sorted.length * .95)] ?? null, p99: sorted[Math.floor(sorted.length * .99)] ?? null,
    max: sorted.at(-1) ?? null, over50ms: sorted.filter(value => value > 50).length }
}
async function measure(label, action) {
  assertRuntimeHealthy()
  await frame.evaluate(() => { window.__returnQaPerf.samples = []; window.__returnQaPerf.recording = true })
  try { await action() } finally { await frame.evaluate(() => { window.__returnQaPerf.recording = false }) }
  const samples = await frame.evaluate(() => window.__returnQaPerf.samples.filter(value => value.engineCalls > 0))
  assertRuntimeHealthy()
  assert.ok(samples.length >= 10, 'actual PlayerFrame must be sampled')
  const intervals = samples.slice(1).map((sample, index) => sample.timestamp - samples[index].timestamp)
  return { label, cpu: stats(samples.map(sample => sample.cpuMs)), playerFrame: stats(samples.map(sample => sample.engineMs)),
    animationFrameIntervals: stats(intervals), callbackCadenceHz: intervals.length * 1000 / intervals.reduce((a, b) => a + b, 0), samples }
}
async function move(key, milliseconds) {
  await page.keyboard.down(key)
  try { await wait(milliseconds) } finally { await page.keyboard.up(key) }
}
async function tutorialMechanics() {
  await press('r'); await wait(300)
  const states = [await snapshot('tutorial-restart')]
  assert.equal(states[0].stage, 0); assert.equal(states[0].realm, 0)
  for (let attempts = 0; states.at(-1).realm === 0 && attempts < 8; attempts++) {
    await move('d', 200); states.push(await snapshot('walk-to-original-trap'))
  }
  assert.equal(states.at(-1).realm, 1, 'ordinary walking must trigger the authored death switch')
  for (let attempts = 0; Math.abs(states.at(-1).x - 2.15) > .09 && attempts < 18; attempts++) {
    const dx = 2.15 - states.at(-1).x
    await move(dx > 0 ? 'd' : 'a', Math.max(20, Math.min(180, Math.abs(dx) / 5 * 1000)))
    states.push(await snapshot('push-original-box'))
  }
  const pressed = states.at(-1)
  assert.ok(pressed.boxes.some(box => box.enabled && box.x < 2), 'actual player contact must push the original box')
  assert.ok(pressed.buttons.some(button => button.pressed), 'box must hold the authored button')
  assert.ok(pressed.doors.some(door => door.on && !door.visible), 'pressed button must remove linked doors')
  const box = pressed.boxes.find(value => value.enabled && value.x < 2)
  await press('Space')
  await move('a', Math.max(60, (pressed.x - box.x) / 5 * 1000))
  await wait(650)
  states.push(await snapshot('standing-on-box'))
  assert.ok(states.at(-1).grounded && states.at(-1).y > pressed.y + .5, 'jump must land on the real movable box')
  const startLog = logs.length
  await page.keyboard.down('Space'); await page.keyboard.down('a')
  try { await wait(290) } finally { await page.keyboard.up('a'); await page.keyboard.up('Space') }
  const deadline = Date.now() + 5000
  while (!logs.slice(startLog).some(value => value.includes('[Return] win:0')) && Date.now() < deadline) await wait(100)
  assert.ok(logs.slice(startLog).some(value => value.includes('[Return] win:0')), 'ordinary jumps must reach the original tutorial goal')
  await wait(1700)
  states.push(await snapshot('tutorial-completed'))
  assert.equal(states.at(-1).stage, 1, 'tutorial completion must load Level1')
  return states
}
try {
  await page.goto(`${base}/games/return`)
  activePackage = readFileSync(fixture.packagePath)
  await page.getByRole('button', { name: '开始游玩', exact: true }).first().click()
  await page.locator('.player-status').filter({ hasText: '已就绪' }).waitFor({ timeout: 180000 })
  const ready = Date.now() + 30000
  while (!logs.some(value => value.includes('[Return] ready')) && Date.now() < ready) await wait(100)
  assert.ok(logs.some(value => value.includes('[Return] ready')))
  receipt = await page.evaluate(() => window.__returnQaReceipt)
  assert.equal(receipt?.sha256, fixture.manifest.packageSha256)
  assert.equal(receipt.bytes, fixture.manifest.packageBytes)
  frame = page.frames().find(value => value !== page.mainFrame()); canvas = frame.locator('canvas')
  loadedEngine = await readLoadedEngine(frame)
  assert.ok([loadedEngine.manifest.commit, ...(loadedEngine.manifest.legacyCommits || [])].includes(fixture.manifest.engineCommit), 'fixture must match the engine actually loaded')
  await canvas.focus(); await wait(500)
  renderer = await frame.evaluate(() => { const gl = document.querySelector('canvas').getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown' })
  const hooked = await frame.evaluate(() => {
    const engine = window.TomCatWeb.engine, original = engine.PlayerFrame
    const wrapped = function (...args) { const sample = window.__returnQaPerf.current, begin = performance.now(); try { return original.apply(this, args) } finally { if (sample) { sample.engineCalls++; sample.engineMs += performance.now() - begin } } }
    try { engine.PlayerFrame = wrapped } catch {}
    return engine.PlayerFrame === wrapped
  })
  assert.ok(hooked)
  for (const selection of coverOnly ? [] : selections) {
    const logStart = logs.length, run = { selection, snapshots: [], phases: [] }
    runs.push(run)
    let initial = await snapshot('before-navigation')
    for (let attempts = 0; initial.stage !== selection.stage && attempts < 7; attempts++) {
      await press('F9'); initial = await snapshot('navigation')
    }
    assert.equal(initial.stage, selection.stage, 'QA stage navigation must reach the selected stage')
    // Exercise the real restart before each realm; it must reset boxes, buttons,
    // doors and corpse cursor without recreating the pooled visuals.
    await press('r')
    if (selection.realm === 1) await press('F10')
    await wait(400)
    initial = await snapshot('initial')
    if (initial.paused) { await press('p'); await wait(200); initial = await snapshot('resumed') }
    assert.equal(initial.stage, selection.stage)
    assert.equal(initial.realm, selection.realm, 'fixture must measure its requested realm before ordinary inputs')
    assert.equal(initial.paused, false)
    assert.equal(initial.corpses, 0, 'restart must reset the corpse pool')
    assert.ok(initial.maps.length > 0 && initial.maps.every(map => map.native), 'every rendered source map must be a native Tilemap2D entity')
    assert.ok(initial.maps.some(map => map.visible), 'current realm must have visible native maps')
    run.snapshots.push(initial)
    const prefix = `${selection.stage}-${selection.realm}`
    await canvas.screenshot({ path: `${output}/${prefix}-initial.png` })
    run.phases.push(await measure('idle', () => wait(seconds * 1000)))
    run.phases.push(await measure('ordinary-movement', async () => {
      for (const key of ['d', 'a']) {
        await page.keyboard.down(key)
        try { await wait(seconds * 500) } finally { await page.keyboard.up(key) }
      }
    }))
    const moved = await snapshot('after-movement'); run.snapshots.push(moved)
    if (moved.grounded && moved.stage !== 6) {
      const jumpLog = logs.length
      await press('Space')
      const jumping = await snapshot('jump'); run.snapshots.push(jumping)
      assert.ok(logs.slice(jumpLog).some(value => value.includes('[Return] jump')), 'grounded jump must be accepted')
      assert.ok(jumping.y > moved.y + .05 || jumping.stage !== moved.stage, 'grounded jump must raise the player or finish the stage')
      await wait(700)
    }
    await canvas.screenshot({ path: `${output}/${prefix}-after.png` })
    if (selection.stage === 0 && selection.realm === 0) {
      run.tutorialMechanics = await tutorialMechanics()
      await canvas.screenshot({ path: `${output}/tutorial-completed.png` })
    }
    run.logs = logs.slice(logStart).filter(value => value.includes('[Return]'))
    console.log(JSON.stringify({ ...selection, phases: run.phases.map(({ samples, ...summary }) => summary) }))
  }
  if (coverOnly || process.env.TEST_RETURN_COVER === '1') {
    let state = await snapshot('cover-navigation')
    for (let attempts = 0; state.stage !== 3 && attempts < 7; attempts++) {
      await press('F9'); state = await snapshot('cover-navigation')
    }
    assert.equal(state.stage, 3)
    await press('r')
    await page.setViewportSize({ width: 1600, height: 900 })
    await page.getByRole('button', { name: '全屏游玩', exact: true }).click()
    await page.waitForFunction(() => document.fullscreenElement?.classList.contains('runtime-player'))
    await canvas.focus(); await wait(250)
    state = await snapshot('cover')
    if (state.paused) { await press('p'); await wait(250); state = await snapshot('cover-resumed') }
    assert.equal(state.stage, 3); assert.equal(state.realm, 0); assert.equal(state.paused, false)
    const path = `${output}/cover-level3-life.png`
    await canvas.screenshot({ path })
    cover = { path, state, viewport: await canvas.boundingBox() }
    await page.evaluate(() => document.exitFullscreen())
  }
  await page.getByRole('button', { name: '关闭播放器', exact: true }).click()
  assert.equal(await page.locator('iframe').count(), 0)
  await page.waitForFunction(() => top.__returnQaContexts.every(value => value.state === 'closed'))
  assertRuntimeHealthy()
  assert.equal(productionReceipt(), sourceReceipt, 'QA must never mutate the production project')
} catch (error) {
  failure = error
  if (canvas && frame && !frame.isDetached()) { try { await canvas.screenshot({ path: `${output}/failure.png` }) } catch {} }
} finally {
  const evidence = { schema: 1, startedAt, finishedAt: new Date().toISOString(), status: failure ? 'failed' : 'passed', failure: failure?.stack, testSha256,
    concurrencyNote: process.env.TEST_PERFORMANCE_CONCURRENCY_NOTE || null,
    renderer, browser: browser.version(), softwareGPURequested: softwareGPU, base, productionTreeSha256: sourceReceipt, fixture: fixture.manifest, receipt, loadedEngine, coverOnly, selections: coverOnly ? [] : selections, runs, errors, logs, cover,
    measurement: coverOnly ? 'Cover capture only. A temporary cooked copy with QA-only F9 navigation selects Level3; real R resets the stage before the screenshot. No performance or full-stage coverage is claimed.' : 'One temporary cooked fixture selects stages/realms with QA-only F9/F10. F8 reads state outside timing intervals. These keys and diagnostics are absent from production. Every selection uses the real R restart and normal movement/jump input. Measured CPU is synchronous update/render submission; rAF timestamps show callback cadence, not GPU/display presentation. This suite is not a natural full-game playthrough.' }
  writeFileSync(`${output}/evidence.json`, JSON.stringify(evidence, null, 2))
  console.log(`Return stage QA ${evidence.status}: ${output}`)
  await browser.close()
}
if (failure) throw failure
