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

function assertLevel3Boxes(state, settled = false) {
  if (state.stage !== 3) return
  assert.equal(state.boxes.length, 2, 'Level3 must retain both authored puzzle boxes')
  for (const box of state.boxes) {
    assert.ok(box.enabled && Number.isFinite(box.x) && Number.isFinite(box.y), `Level3 box ${box.index} must stay enabled with finite coordinates`)
    // Authored common floor top=-7, collider offsetY=.06 and H=.96.
    // The box origin must remain at/above -6.58 after overlap resolution.
    assert.ok(box.y >= -6.60 && box.y < 7.6 && box.x > -8 && box.x < 8, `Level3 box ${box.index} escaped the authored room: (${box.x}, ${box.y})`)
  }
  if (settled) {
    const lower = state.boxes.find(box => box.index === 1), upper = state.boxes.find(box => box.index === 5)
    assert.ok(lower && Math.abs(lower.y + 6.58) < .02, 'Level3 lower box must settle on the common floor at origin Y=-6.58')
    assert.ok(upper && Math.abs(upper.y + .58) < .02, 'Level3 upper box must remain on the central platform at origin Y=-0.58')
  }
}
// Read-only negative-control path: apply the same assertions to retained raw
// evidence without cooking, launching a browser or touching production assets.
const boxEvidence = process.argv.find(value => value.startsWith('--check-box-evidence='))?.slice('--check-box-evidence='.length)
if (boxEvidence) {
  const saved = JSON.parse(readFileSync(boxEvidence, 'utf8'))
  const states = saved.runs.filter(run => run.selection.stage === 3).flatMap(run => run.snapshots)
  assert.ok(states.length >= 2, 'Evidence must include Level3 box snapshots')
  for (const state of states) assertLevel3Boxes(state, ['initial', 'after-idle'].includes(state.label))
  console.log(`Level3 box evidence passed: ${states.length} snapshots`)
  process.exit(0)
}

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
const publishedReceipt = () => Object.fromEntries(['return.tcpak', 'return-source.zip', 'manifest.json'].map(name => {
  const bytes = readFileSync(`${root}/public/samples/return/${name}`)
  return [name, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }]
}))
const publishedBefore = publishedReceipt()
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
let activePackage, failure, frame, canvas, renderer, receipt, loadedEngine, cover, startup
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
async function snapshot(label, quick = false) {
  assertRuntimeHealthy()
  const begin = logs.length
  if (quick) await page.keyboard.press('F8', { delay: 10 })
  else await press('F8')
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
async function level3Mechanics(run) {
  const states = [], startLog = logs.length
  run.level3Mechanics = { method: 'QA navigation selects Level3 before this route. F8 only reads state. R/A/D/Space/P are the only gameplay mutations; real spikes, boxes, stairs and goal are used.', states }
  const observe = async label => {
    const state = await snapshot(label, true); states.push(state)
    assertLevel3Boxes(state)
    return state
  }
  let state
  async function walkTo(x, label, continuous = false) {
    const deadline = Date.now() + 9000
    if (continuous) {
      const sign = Math.sign(x - state.x), key = sign > 0 ? 'd' : 'a'
      await page.keyboard.down(key)
      try {
        do { await wait(20); state = await observe(label) }
        while (state.stage === 3 && sign * (x - state.x) > .1 && Date.now() < deadline)
      } finally { await page.keyboard.up(key) }
      return
    }
    // Release between bounded pulses: a diagnostic round trip while holding a
    // key can otherwise carry the player beyond a narrow stair's edge.
    while (state.stage === 3 && Math.abs(x - state.x) > .06 && Date.now() < deadline) {
      const distance = Math.abs(x - state.x)
      await move(x > state.x ? 'd' : 'a', Math.max(10, Math.min(distance < .6 ? 20 : 80, distance / 5 * 1000 - 8)))
      await wait(15); state = await observe(label)
    }
    assert.ok(state.stage !== 3 || Math.abs(x - state.x) < .3, `${label}: ordinary walking must reach X=${x}; got (${state.x},${state.y})`)
  }
  async function jumpTo(x, label, stationaryStartMs = 0) {
    assert.ok(state.grounded, `${label}: jump starts grounded`)
    const sign = Math.sign(x - state.x), key = sign > 0 ? 'd' : 'a', deadline = Date.now() + 2500
    let moving = true, airborne = false
    await page.keyboard.down('Space')
    if (stationaryStartMs) await wait(stationaryStartMs)
    await page.keyboard.down(key)
    try {
      do {
        await wait(20); state = await observe(label)
        airborne ||= !state.grounded
        if (moving && sign * (x - state.x) <= .13) { await page.keyboard.up(key); moving = false }
      } while (state.stage === 3 && !(airborne && state.grounded && !moving) && Date.now() < deadline)
    } finally { await page.keyboard.up(key); await page.keyboard.up('Space') }
    assert.ok(state.stage !== 3 || (airborne && state.grounded && Math.abs(x - state.x) < .6), `${label}: normal jump must land near X=${x}; got (${state.x},${state.y})`)
  }
  async function settle(label) { await wait(650); state = await observe(label) }
  // F8 is observation only. All mutations below use ordinary R/A/D/Space input;
  // no F9/F10 navigation, teleport, realm assignment or collision bypass.
  await press('r'); await wait(300); state = await observe('level3-restart')
  if (state.paused) { await press('p'); state = await observe('level3-resumed') }
  assert.equal(state.stage, 3); assert.equal(state.realm, 0); assertLevel3Boxes(state, true)
  await walkTo(1.6, 'approach-lower-box')
  await jumpTo(3.65, 'jump-over-lower-box')
  await walkTo(-2.31, 'place-lower-box-for-upper-box-drop')
  let lower = state.boxes.find(box => box.index === 1)
  assert.ok(Math.abs(lower.x + 3) < .2, 'Player contact must place the lower box for the upper box drop')
  await jumpTo(-4.5, 'cross-life-spikes', 120)
  await settle('death-realm-entry'); assert.equal(state.realm, 1, 'Original life spikes must reveal the death stairs')
  await jumpTo(-3, 'jump-on-lower-box')
  await jumpTo(-.35, 'jump-off-lower-box')
  await jumpTo(1.1, 'first-death-step')
  assert.ok(Math.abs(state.y + 5.5) < .03, 'First stair must support the player')
  await walkTo(2.05, 'first-step-edge')
  await jumpTo(4.1, 'second-death-step')
  assert.ok(Math.abs(state.y + 3.5) < .03, 'Second stair must support the player')
  await walkTo(3.9, 'second-step-edge')
  await jumpTo(1.85, 'third-death-step')
  assert.ok(Math.abs(state.y + 1.5) < .03, 'Third stair must support the player')
  await jumpTo(1.05, 'central-platform-right')
  if (state.y > .3) { await walkTo(1.05, 'step-off-upper-box-to-platform'); await settle('central-platform-settled') }
  assert.ok(Math.abs(state.y + .5) < .03, 'Central platform must support the player beside the upper box')
  await walkTo(-4.3, 'push-upper-box-off-central-left-edge', true)
  await settle('upper-box-lands-on-lower')
  lower = state.boxes.find(box => box.index === 1)
  let upper = state.boxes.find(box => box.index === 5)
  assert.ok(Math.abs(upper.x - lower.x) < .65 && Math.abs(upper.y - lower.y - .96) < .03, 'The real falling upper box must stack on the lower box')
  await canvas.screenshot({ path: `${output}/level3-boxes-stacked.png` })
  await jumpTo(-1.6, 'clear-stacked-boxes-to-the-right')
  await walkTo(.5, 'approach-bottom-death-step')
  await jumpTo(3, 'cross-bottom-death-step')
  await walkTo(6.05, 'return-via-death-spikes')
  await settle('life-realm-with-stacked-boxes'); assert.equal(state.realm, 0)
  await walkTo(-1.8, 'approach-stack-without-touching-spikes')
  await jumpTo(upper.x - .15, 'jump-on-stacked-boxes', 225)
  assert.ok(state.y > -4.7, 'Both boxes must provide the height needed for the left ledge')
  await canvas.screenshot({ path: `${output}/level3-standing-on-stack.png` })
  // Stay just inside the box's left collider edge. The player collider still
  // has ample support while the remaining ledge gap is within jump range.
  await walkTo(upper.x - .5, 'upper-box-left-edge')
  await settle('upper-box-takeoff-ready')
  upper = state.boxes.find(box => box.index === 5)
  assert.ok(state.grounded && Math.abs(state.y - (upper.y + 1.04)) < .03, 'Last jump must start stably supported by the upper box')
  await jumpTo(-5.1, 'jump-to-original-life-goal')
  const deadline = Date.now() + 5000
  while (!logs.slice(startLog).some(line => line.includes('[Return] win:3')) && Date.now() < deadline) await wait(50)
  assert.ok(logs.slice(startLog).some(line => line.includes('[Return] win:3')), 'Ordinary Level3 puzzle inputs must reach its original goal')
  await wait(1700); state = await observe('level3-completed')
  assert.equal(state.stage, 4, 'Level3 completion must advance to Level4')
  return run.level3Mechanics
}
try {
  await page.goto(`${base}/games/return`)
  activePackage = readFileSync(fixture.packagePath)
  await page.getByRole('button', { name: '开始游玩', exact: true }).first().click()
  await page.locator('.player-status').filter({ hasText: '已就绪' }).waitFor({ timeout: 180000 })
  const ready = Date.now() + 30000
  while (!logs.some(value => value.includes('[Return] ready')) && Date.now() < ready) await wait(100)
  assert.ok(logs.some(value => value.includes('[Return] ready')))
  assert.equal(fixture.manifest.startup, 'production-menu-ready-then-selection-flush', 'Performance fixture must preserve real menu warmup')
  const initialized = Date.now() + 30000
  while (!logs.some(value => value.includes(fixture.manifest.initializedMarker)) && Date.now() < initialized) await wait(50)
  const readyLog = logs.findIndex(value => value.includes('[Return] ready'))
  const selectedLog = logs.findIndex(value => value.includes(`[ReturnQA] selected:${fixture.manifest.stage}:${fixture.manifest.realm} after-menu-ready`))
  const initializedLog = logs.findIndex(value => value.includes(fixture.manifest.initializedMarker))
  assert.ok(readyLog >= 0 && selectedLog > readyLog && initializedLog > selectedLog, 'Production menu ready must precede QA selection and selected-stage visual flush')
  startup = { mode: fixture.manifest.startup, readyLogIndex: readyLog, selectedLogIndex: selectedLog, initializedLogIndex: initializedLog,
    markers: [logs[readyLog], logs[selectedLog], logs[initializedLog]] }
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
    assertLevel3Boxes(initial, true)
    run.snapshots.push(initial)
    const prefix = `${selection.stage}-${selection.realm}`
    await canvas.screenshot({ path: `${output}/${prefix}-initial.png` })
    run.phases.push(await measure('idle', () => wait(seconds * 1000)))
    const idle = await snapshot('after-idle'); run.snapshots.push(idle)
    assertLevel3Boxes(idle, true)
    run.phases.push(await measure('ordinary-movement', async () => {
      for (const key of ['d', 'a']) {
        await page.keyboard.down(key)
        try { await wait(seconds * 500) } finally { await page.keyboard.up(key) }
      }
    }))
    const moved = await snapshot('after-movement'); run.snapshots.push(moved)
    assertLevel3Boxes(moved)
    if (moved.grounded && moved.stage !== 6) {
      const jumpLog = logs.length
      await press('Space')
      const jumping = await snapshot('jump'); run.snapshots.push(jumping)
      assertLevel3Boxes(jumping)
      assert.ok(logs.slice(jumpLog).some(value => value.includes('[Return] jump')), 'grounded jump must be accepted')
      assert.ok(jumping.y > moved.y + .05 || jumping.stage !== moved.stage, 'grounded jump must raise the player or finish the stage')
      await wait(700)
    }
    await canvas.screenshot({ path: `${output}/${prefix}-after.png` })
    if (selection.stage === 0 && selection.realm === 0) {
      run.tutorialMechanics = await tutorialMechanics()
      await canvas.screenshot({ path: `${output}/tutorial-completed.png` })
    }
    if (selection.stage === 3 && selection.realm === 0 && process.env.TEST_RETURN_LEVEL3_COMPLETE === '1') {
      run.level3Mechanics = await level3Mechanics(run)
      await canvas.screenshot({ path: `${output}/level3-completed.png` })
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
  assert.deepEqual(publishedReceipt(), publishedBefore, 'QA must never mutate the published ZIP, package or manifest')
} catch (error) {
  failure = error
  if (canvas && frame && !frame.isDetached()) { try { await canvas.screenshot({ path: `${output}/failure.png` }) } catch {} }
} finally {
  const evidence = { schema: 1, startedAt, finishedAt: new Date().toISOString(), status: failure ? 'failed' : 'passed', failure: failure?.stack, testSha256,
    concurrencyNote: process.env.TEST_PERFORMANCE_CONCURRENCY_NOTE || null,
    renderer, browser: browser.version(), softwareGPURequested: softwareGPU, base, productionTreeSha256: sourceReceipt, publishedBefore, publishedAfter: publishedReceipt(), fixture: fixture.manifest, receipt, loadedEngine, startup, coverOnly, selections: coverOnly ? [] : selections, runs, errors, logs, cover,
    measurement: coverOnly ? 'Cover capture only. A temporary cooked copy with QA-only F9 navigation selects Level3; real R resets the stage before the screenshot. No performance or full-stage coverage is claimed.' : 'One temporary cooked fixture retains real Awake Load(0) and menu font/audio warmup. Explicit ordered ready/selected/initialized markers precede measurement. QA-only F9/F10 select stages/realms; F8 reads state outside timing intervals. These keys and diagnostics are absent from production. Every selection uses the real R restart and normal movement/jump input. Measured CPU is synchronous update/render submission; rAF timestamps show callback cadence, not GPU/display presentation. This suite is not a natural full-game playthrough.' }
  writeFileSync(`${output}/evidence.json`, JSON.stringify(evidence, null, 2))
  console.log(`Return stage QA ${evidence.status}: ${output}`)
  await browser.close()
}
if (failure) throw failure
