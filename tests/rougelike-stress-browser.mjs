// Explicit QA fixture, never a natural ten-wave playthrough. Production gameplay
// stays unchanged; the existing fixture builder sets wave 10, unlocked skills,
// and 1000 HP. Default hardware GPU; no cross-machine pass/fail timing limits.
// TEST_STRESS_PROFILE=1 adds CPU sampling (and its overhead).
// TEST_STRESS_FULLSCREEN=1 enters the real fullscreen player.
// TEST_STRESS_WIDTH / TEST_STRESS_HEIGHT set the viewport (default 1440x1000).
// TEST_STRESS_CROWD_SECONDS sets the crowd target (>=35, default 120). Shortened
// runs are iteration evidence; final comparable acceptance still uses 120.
// Optional TEST_STRESS_MAX_FRAME_MS / TEST_STRESS_P95_MS limit actual-engine
// rAF callback CPU costs in every active phase AND the whole active window.
// The latter includes between-phase collection overhead, but not load/pause/teardown.
// --fixture=<directory> reuses a fixture only after the builder verifies hashes.
// TEST_STRESS_OUTPUT selects a fresh evidence folder; existing evidence is refused.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { readLoadedEngine } from './rougelike-performance-probe.mjs'
import { killCounts } from './rougelike-log-counts.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hash = value => createHash('sha256').update(value).digest('hex')
const startedAt = new Date().toISOString()
const optionalLimit = name => {
  if (!process.env[name]) return null
  const value = Number(process.env[name])
  assert.ok(Number.isFinite(value) && value > 0, `${name} must be a positive finite number`)
  return value
}
const thresholds = { max: optionalLimit('TEST_STRESS_MAX_FRAME_MS'), p95: optionalLimit('TEST_STRESS_P95_MS') }
const crowdSeconds = Number(process.env.TEST_STRESS_CROWD_SECONDS || 120)
assert.ok(Number.isFinite(crowdSeconds) && crowdSeconds >= 35, 'TEST_STRESS_CROWD_SECONDS must be finite and at least 35')
const output = resolve(process.env.TEST_STRESS_OUTPUT || join(root, '.engine', 'rougelike-stress', `${startedAt.replace(/[:.]/g, '-')}-${process.pid}`))
assert.ok(!['evidence.json', 'profile.json'].some(name => existsSync(join(output, name))), `Refusing to overwrite stress evidence: ${output}`)
mkdirSync(output, { recursive: true })
const fixtureArg = process.argv.find(value => value.startsWith('--fixture='))
const built = spawnSync(process.execPath, [join(root, 'tests/rougelike-skills-browser.mjs'), '--build-only', ...(fixtureArg ? [fixtureArg] : [])], {
  cwd: root, env: { ...process.env, TEST_FIXTURE_HEALTH: '1000' }, encoding: 'utf8', timeout: 180000,
})
console.log(built.stdout || '')
assert.equal(built.status, 0, `QA fixture verification/cook failed: ${built.error?.message || built.stderr || built.signal}`)
const directory = /QA fixture \(never published\): (.+)/.exec(built.stdout)?.[1]?.trim()
assert.ok(directory, 'fixture builder must return its verified directory')
const fixture = JSON.parse(readFileSync(join(directory, 'fixture.json'), 'utf8'))
const packageBytes = readFileSync(join(directory, 'rougelike-skills.tcpak'))
assert.equal(hash(packageBytes), fixture.packageSha256)
assert.match(fixture.initialization, /health = maxHealth = 1000;/)
const sourcePath = join(root, 'samples/rougelike/Assets/Scripts/RougelikeGame.cs')
const originalSourceHash = hash(readFileSync(sourcePath))
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5185'
const profiling = process.env.TEST_STRESS_PROFILE === '1', softwareGPU = process.env.TEST_SOFTWARE_GPU === '1'
const fullscreen = process.env.TEST_STRESS_FULLSCREEN === '1'
const viewport = { width: Number(process.env.TEST_STRESS_WIDTH || 1440), height: Number(process.env.TEST_STRESS_HEIGHT || 1000) }
assert.ok(Object.values(viewport).every(value => Number.isInteger(value) && value >= 480 && value <= 7680), 'Stress viewport dimensions must be integers between 480 and 7680')
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true,
  args: softwareGPU ? ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-webgl'] })
const page = await browser.newPage({ viewport, screen: viewport })
page.setDefaultTimeout(30000)
const logs = [], errors = [], phases = [], resources = []
const evidence = { startedAt, base, fixture, fixtureDirectory: directory, softwareGPURequested: softwareGPU, profiling,
  crowdSecondsRequested: crowdSeconds, thresholds, thresholdMetric: 'engineCallbacks: CPU wall duration of rAF callbacks containing PlayerFrame, per active phase and whole active window including collection gaps',
  viewport, fullscreenRequested: fullscreen, browser: browser.version(), testSha256: hash(readFileSync(fileURLToPath(import.meta.url))) }
let frame, canvas, cdp, profileStarted = false, failure, samples, activeWindow
page.on('console', message => { const value = message.text(); logs.push(value); if (value.includes('[Rougelike]')) console.log(value) })
page.on('pageerror', error => errors.push(error.message))
await page.addInitScript(() => {
  const nativeFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = async (...args) => {
    const response = await nativeFetch(...args)
    const requested = typeof args[0] === 'string' ? args[0] : args[0].url || String(args[0])
    const url = new URL(response.url || requested, location.href)
    if (url.pathname === '/samples/rougelike/rougelike.tcpak') {
      const bytes = await response.clone().arrayBuffer(), digest = await crypto.subtle.digest('SHA-256', bytes)
      top.__stressReceipt = { bytes: bytes.byteLength, sha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') }
    }
    return response
  }
  if (window === top) { window.__stressContexts = []; return }
  const state = window.__stress = { frames: [], audio: [], active: new Set(), current: null }
  const epoch = () => performance.timeOrigin + performance.now(), raf = requestAnimationFrame
  window.requestAnimationFrame = callback => raf.call(window, timestamp => {
    const begin = performance.now(), sample = { at: performance.timeOrigin + begin, timestamp, engineMs: 0, engineCalls: 0, engineDelta: 0 }
    state.current = sample
    try { return callback(timestamp) }
    finally { sample.duration = performance.now() - begin; state.frames.push(sample); state.current = null }
  })
  const Native = globalThis.AudioContext
  if (Native) globalThis.AudioContext = class extends Native {
    constructor(...args) {
      super(...args); top.__stressContexts.push(this)
      const create = this.createBufferSource.bind(this)
      this.createBufferSource = () => {
        const source = create(), start = source.start, stop = source.stop
        source.start = function (...args) {
          const result = start.apply(this, args); state.active.add(source)
          state.audio.push({ at: epoch(), duration: source.buffer?.duration, loop: source.loop, pitch: source.playbackRate.value })
          return result
        }
        source.stop = function (...args) { const result = stop.apply(this, args); state.active.delete(source); return result }
        source.addEventListener('ended', () => state.active.delete(source))
        return source
      }
    }
  }
})
await page.route('**/v1/**', route => route.fulfill({ status: route.request().url().includes('/auth/me') ? 401 : 200, json: [] }))
let packageRequests = 0
await page.route(url => new URL(url).pathname === '/samples/rougelike/rougelike.tcpak', route => {
  packageRequests++
  return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: packageBytes })
})
const now = () => page.evaluate(() => performance.timeOrigin + performance.now())
const wait = milliseconds => page.waitForTimeout(milliseconds)
async function logContaining(text, timeout = 30000) {
  const end = Date.now() + timeout
  while (!logs.some(value => value.includes(text)) && Date.now() < end) await wait(100)
  assert.ok(logs.some(value => value.includes(text)), `Missing native log: ${text}`)
}
async function snapshot(label) {
  const [metrics, dom, runtime] = await Promise.all([
    cdp.send('Performance.getMetrics'), cdp.send('Memory.getDOMCounters'),
    frame.evaluate(() => {
      const module = window.TomCatWeb.runtime.Module
      return { at: performance.timeOrigin + performance.now(), wasmHeapBytes: module.HEAPU8?.buffer?.byteLength ?? module.wasmMemory?.buffer?.byteLength ?? null,
        browserHeap: performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize, limit: performance.memory.jsHeapSizeLimit } : null,
        activeAudioSources: window.__stress.active.size, activeMusic: [...window.__stress.active].filter(source => source.loop).map(source => ({ pitch: source.playbackRate.value })),
        contexts: top.__stressContexts.map(context => ({ state: context.state, sampleRate: context.sampleRate })) }
    }),
  ])
  resources.push({ label, ...runtime, dom, metrics: Object.fromEntries(metrics.metrics.filter(item => ['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'Documents', 'JSEventListeners', 'LayoutCount', 'TaskDuration', 'ScriptDuration'].includes(item.name)).map(item => [item.name, item.value])) })
}
async function phase(label, seconds, action) {
  await snapshot(`${label}:before`)
  const running = () => {
    const resource = resources.at(-1)
    assert.ok(resource.activeMusic.length > 0 && resource.contexts.some(context => context.state === 'running'), `${label}: invalid pressure sample; native music must remain active in a running AudioContext`)
  }
  running()
  const start = await now(), logStart = logs.length, wasClearedAtStart = logs.some(value => value.includes('[Rougelike] clear'))
  await action(seconds * 1000)
  const end = await now()
  phases.push({ label, start, end, seconds: (end - start) / 1000, wasClearedAtStart,
    clearedAtEnd: logs.some(value => value.includes('[Rougelike] clear')), logs: logs.slice(logStart) })
  const costs = await frame.evaluate(({ start, end }) => window.__stress.frames
    .filter(sample => sample.at >= start && sample.at < end && sample.engineCalls > 0)
    .map(sample => sample.duration), { start, end })
  const live = stats(costs)
  console.log('[stress phase] ' + JSON.stringify({ label, frames: live.count, p95: live.p95, p99: live.p99, max: live.max,
    over50: live.over50ms, kills: killCounts(phases.at(-1)).kills,
    cleared: phases.at(-1).clearedAtEnd, thresholdFailures: checkThresholds(label, live) }))
  await snapshot(`${label}:after`)
  running()
  if (label.includes('crowd')) assert.ok(logs.slice(logStart).some(value => value.includes('[Rougelike] hurt hp:')), `${label}: invalid crowd sample; require fresh native contact damage rather than a paused/static scene`)
  await canvas.screenshot({ path: join(output, `${label}.png`) })
  assert.ok(!logs.some(value => value.includes('[Rougelike] dying')), '1000-HP QA fixture must survive the stress run')
}
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b)
  return { count: sorted.length, median: sorted[Math.floor(sorted.length * .5)] ?? null, p95: sorted[Math.floor(sorted.length * .95)] ?? null,
    p99: sorted[Math.floor(sorted.length * .99)] ?? null, max: sorted.at(-1) ?? null,
    over16_67ms: sorted.filter(value => value > 1000 / 60).length, over33_33ms: sorted.filter(value => value > 1000 / 30).length, over50ms: sorted.filter(value => value > 50).length }
}
const checkThresholds = (label, cpu) => ['max', 'p95'].flatMap(metric => thresholds[metric] !== null && cpu[metric] > thresholds[metric]
  ? [{ label, metric: `engineCallbacks.${metric}`, observedMs: cpu[metric], limitMs: thresholds[metric] }] : [])
async function finishActiveWindow(partial = false) {
  if (!activeWindow || activeWindow.end !== undefined) return
  const end = await now()
  Object.assign(activeWindow, { end, seconds: (end - activeWindow.start) / 1000, partial,
    clearedAtEnd: logs.some(value => value.includes('[Rougelike] clear')), logs: logs.slice(activeWindow.logStart) })
}
try {
  await page.goto(`${base}/games/rougelike`)
  await page.getByRole('button', { name: '开始游玩', exact: true }).first().click()
  await page.waitForFunction(() => document.body.innerText.includes('Rougelike · 几何竞技场 已就绪'), null, { timeout: 180000 })
  evidence.browserPackageReceipt = await page.evaluate(() => top.__stressReceipt)
  assert.equal(evidence.browserPackageReceipt?.sha256, fixture.packageSha256)
  assert.equal(evidence.browserPackageReceipt.bytes, fixture.packageBytes)
  assert.equal(packageRequests, 1)
  frame = page.frames().find(item => item !== page.mainFrame())
  evidence.loadedEngine = await readLoadedEngine(frame)
  assert.equal(evidence.loadedEngine.manifest.commit, fixture.engineCommit, 'actual browser engine must match the verified fixture toolchain pin')
  canvas = frame.locator('canvas')
  if (fullscreen) {
    await page.getByRole('button', { name: '全屏游玩', exact: true }).click()
    await page.waitForFunction(() => !!document.fullscreenElement)
  }
  evidence.canvas = await canvas.evaluate(element => ({ width: element.width, height: element.height, cssWidth: element.clientWidth, cssHeight: element.clientHeight, devicePixelRatio }))
  evidence.renderer = await frame.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2'), extension = gl?.getExtension('WEBGL_debug_renderer_info')
    return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown'
  })
  const hooked = await frame.evaluate(() => {
    const engine = window.TomCatWeb.engine, original = engine.PlayerFrame
    const wrapped = function (...args) {
      const begin = performance.now(), sample = window.__stress.current
      try { return original.apply(this, args) }
      finally { if (sample) { sample.engineCalls++; sample.engineMs += performance.now() - begin; sample.engineDelta += args[0] } }
    }
    try { engine.PlayerFrame = wrapped } catch {}
    return engine.PlayerFrame === wrapped
  })
  assert.ok(hooked, 'PlayerFrame observation must attach')
  await canvas.click({ position: { x: 100, y: 250 } }); await wait(250)
  if (!await frame.evaluate(() => [...window.__stress.active].some(source => source.loop))) await page.keyboard.press('p')
  await logContaining('[Rougelike] wave:10 enemies:60 hp:5')
  cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable')
  if (profiling) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); profileStarted = true }
  console.log('Stress renderer:', evidence.renderer, '\nEvidence:', output)
  const runStart = await now()
  activeWindow = { label: 'active-window', start: runStart, logStart: logs.length,
    wasClearedAtStart: logs.some(value => value.includes('[Rougelike] clear')), includesCollectionGaps: true }
  await phase('01-crowd', Math.min(40, crowdSeconds), wait)
  await logContaining('[Rougelike] hurt hp:')
  // Retain the crowd before dealing damage: otherwise concentrated AoE can
  // naturally clear wave 10 and make a later long-run sample nearly empty.
  let window = 0
  while ((await now()) - runStart < crowdSeconds * 1000) await phase(`02-crowd-long-run-${++window}`, 10, wait)
  evidence.crowdWallSeconds = ((await now()) - runStart) / 1000
  assert.ok(!logs.some(value => value.includes('[Rougelike] clear')), 'Crowd-only phase must not have cleared the wave')
  const box = await canvas.boundingBox(), scale = Math.min(box.width / 1152, box.height / 648)
  await page.mouse.move(box.x + box.width / 2 + (800 - 576) * scale, box.y + box.height / 2 + (200 - 324) * scale)
  await phase('03-black-hole', 8, async duration => { await page.keyboard.press('r'); await wait(duration) })
  await logContaining('[Rougelike] black hole')
  await phase('04-shift-input-energy-limited', 8, async duration => {
    await page.keyboard.down('Shift'); await wait(300)
    evidence.slowPitch = await frame.evaluate(() => [...window.__stress.active].filter(source => source.loop).map(source => source.playbackRate.value))
    await wait(duration - 300); await page.keyboard.up('Shift')
  })
  assert.ok(evidence.slowPitch.some(value => Math.abs(value - .25) < .001), 'Shift must execute native time slow before energy expires')
  await phase('05-charged-blades', 8, async duration => {
    const end = Date.now() + duration
    while (Date.now() < end) { await page.mouse.down(); await wait(1500); await page.mouse.up(); await wait(500) }
  })
  await logContaining('[Rougelike] charge released')
  await phase('06-continuous-slashes', 20, async duration => {
    const end = Date.now() + duration; let index = 0
    while (Date.now() < end) {
      const button = index++ % 2 ? 'right' : 'left'
      await page.mouse.down({ button }); await wait(80); await page.mouse.up({ button }); await wait(270)
    }
  })
  await finishActiveWindow()
  evidence.measuredWallSeconds = activeWindow.seconds
  evidence.waveClearedDuringRun = logs.some(value => value.includes('[Rougelike] clear'))
  // A genuine clear changes load; preserve that fact instead of claiming the
  // maximum crowd persists for the entire long run. No enemy counts are faked.
  if (evidence.waveClearedDuringRun) {
    await page.keyboard.press('Enter'); await wait(250)
    await logContaining('[Rougelike] wave:1 enemies:5 hp:1')
    evidence.restartedWave1ForPause = true
  }
  await page.keyboard.press('p'); await wait(250)
  const paused = await canvas.screenshot({ path: join(output, '08-paused.png') })
  await wait(500)
  assert.equal(hash(await canvas.screenshot()), hash(paused), 'P must freeze the actual canvas')
  assert.equal(await frame.evaluate(() => window.__stress.active.size), 0, 'P must stop audio voices')
  samples = await frame.evaluate(() => ({ frames: window.__stress.frames, audio: window.__stress.audio }))
  await snapshot('paused')
  if (fullscreen) { await page.evaluate(() => document.exitFullscreen()); await page.waitForFunction(() => !document.fullscreenElement) }
  await page.getByRole('button', { name: '关闭播放器', exact: true }).click()
  await page.waitForFunction(() => top.__stressContexts.every(context => context.state === 'closed'))
  assert.equal(await page.locator('iframe').count(), 0)
  evidence.audioClosed = true
  assert.deepEqual(errors, [])
  assert.ok(!logs.some(value => /callback \w+ threw|MissingMethodException|aborted before live mutation|Unhandled exception|\[tomcat-host\] fail:/.test(value)), logs.slice(-25).join('\n'))
  assert.equal(hash(readFileSync(sourcePath)), originalSourceHash, 'Production source changed during QA')
} catch (error) {
  failure = error
  // Resource/screenshot/clock collection can fail after a gameplay assertion.
  // Keep that first failure even when collecting its partial window also fails.
  try { await finishActiveWindow(true) } catch (captureError) { errors.push(`Active window: ${captureError.message}`) }
}
finally {
  if (profileStarted) {
    try { writeFileSync(join(output, 'profile.json'), JSON.stringify((await cdp.send('Profiler.stop')).profile)) }
    catch (error) { errors.push(`Profiler: ${error.message}`) }
  }
  if (!samples && frame && !frame.isDetached()) {
    try { samples = await frame.evaluate(() => ({ frames: window.__stress.frames, audio: window.__stress.audio })) }
    catch (error) { errors.push(`Observation: ${error.message}`) }
  }
  const engineFrames = (samples?.frames || []).filter(sample => sample.engineCalls > 0)
  const engineGaps = engineFrames.slice(0, -1).map((sample, index) => ({ at: sample.at, duration: engineFrames[index + 1].at - sample.at }))
  const summariseWindow = phase => {
    const frames = (samples?.frames || []).filter(sample => sample.at >= phase.start && sample.at < phase.end), engine = frames.filter(sample => sample.engineCalls > 0)
    const audio = (samples?.audio || []).filter(sample => sample.at >= phase.start && sample.at < phase.end)
    return { ...phase, callbacks: stats(frames.map(sample => sample.duration)), engineCallbacks: stats(engine.map(sample => sample.duration)),
      playerFrame: stats(engine.map(sample => sample.engineMs)),
      engineIntervals: stats(engineGaps.filter(sample => sample.at >= phase.start && sample.at < phase.end).map(sample => sample.duration)),
      engineDeltaSeconds: engine.reduce((sum, sample) => sum + sample.engineDelta, 0),
      nativeKnifeStarts: audio.filter(event => !event.loop && event.duration > 1.48 && event.duration < 1.5).length, audioStarts: audio.length,
      ...killCounts(phase), cleared: phase.logs.some(value => value.includes('[Rougelike] clear')) }
  }
  try {
    evidence.phases = phases.map(summariseWindow)
    evidence.activeWindow = activeWindow?.end !== undefined ? summariseWindow(activeWindow) : activeWindow
  } catch (error) { errors.push(`Summary: ${error.message}`) }
  evidence.phases ??= []
  evidence.totalKills = evidence.activeWindow?.kills ?? 0
  if (!failure && !evidence.phases.every(phase => phase.engineCallbacks.count > 0)) failure = new Error('Every stress phase must contain real PlayerFrame callbacks')
  if (!failure && !(evidence.phases.find(phase => phase.label === '06-continuous-slashes')?.nativeKnifeStarts > 0)) failure = new Error('Continuous input must produce actual knife audio starts; energy/cooldowns still apply')
  if (!failure && !(evidence.totalKills > 0)) failure = new Error('The active stress window must contain real native kills; skill/audio activity alone does not exercise death fragments')
  const thresholdWindows = [...evidence.phases, ...(evidence.activeWindow?.engineCallbacks ? [evidence.activeWindow] : [])]
  const thresholdFailures = thresholdWindows.flatMap(phase => checkThresholds(phase.label, phase.engineCallbacks))
  if (!failure && thresholdFailures.length) failure = new Error(`Active-phase/window CPU thresholds exceeded: ${JSON.stringify(thresholdFailures)}`)
  try { await browser.close() } catch (error) { errors.push(`Browser close: ${error.message}`); failure ??= error }
  if (!failure && errors.length) failure = new Error(errors.join('\n'))
  Object.assign(evidence, { status: failure ? 'failed' : 'passed', failure: failure?.stack, thresholdFailures, finishedAt: new Date().toISOString(), resources, frames: samples?.frames, audio: samples?.audio, logs, errors,
    limits: [
      'Synthetic initialization: wave 10, all skills, 1000 HP. Natural enemy spawning/damage and production skill costs remain. This is not a natural progression/clear test.',
      'Wall-clock crowd duration does not prove 60 spawned: engineDeltaSeconds is input delta, not private world time. Cleared-wave logs explicitly mark reduced load.',
      'rAF CPU callbacks include synchronous WASM/render submission, not completed GPU/compositor work. Callback-start intervals show scheduling gaps, not exact displayed FPS.',
      'engineIntervals pairs globally adjacent engine starts and assigns each gap to the window containing its preceding start, retaining cross-boundary stalls; the last observed callback has no inferred successor.',
      'activeWindow starts after initialization/focus/profiler setup and ends after the final attack phase, before clear restart, P, and teardown. It includes inter-phase snapshots/screenshots and their instrumentation overhead so delayed fragment work cannot fall between thresholded phases. Its timing is not directly comparable with phase-only or original empty-swing CPU baselines.',
      'Native kill batches contribute their explicit count (historical single-kill records count as one) across the whole active window, including collection gaps, split before/after the first clear. A phase already cleared at start can be an empty-scene input sample, not crowd pressure.',
      '16.67/33.33 ms counts are diagnostic 60/30 Hz budgets, not assertions. Headless display cadence, instrumentation and optional profiler affect measurements.',
      'Heap metrics are snapshots with GC variation. JS heap does not include the full WASM/audio/GPU allocations; WASM buffer size is capacity, not live allocations. No draw hooks or forced GC are used.',
      'The observer retains frame/audio records, so some JS heap growth is measurement overhead, not evidence of a game leak.',
      'Shift is held for 8 wall seconds; native energy depletion can end slow time earlier. The phase measures that real transition, not 8 seconds of guaranteed slow motion.',
      'Audio starts count actual WebAudio voices, not attempts; same-frame hit/death sounds can replace a knife cue in the original single-SFX design.',
    ] })
  try { writeFileSync(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2)) }
  catch (error) { failure ??= error; console.error('Evidence write:', error.message) }
  console.log(JSON.stringify({ status: evidence.status, output, crowdSecondsRequested: crowdSeconds, crowdWallSeconds: evidence.crowdWallSeconds,
    thresholds, thresholdFailures, totalKills: evidence.totalKills, activeWindow: evidence.activeWindow,
    phases: evidence.phases, resources, waveClearedDuringRun: evidence.waveClearedDuringRun }, null, 2))
}
if (failure) throw failure
