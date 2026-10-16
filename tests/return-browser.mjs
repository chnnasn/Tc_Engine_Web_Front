// Real published package + ordinary player input. No game-state mutation or QA
// scene substitution. Timing reports CPU submission and rAF cadence separately;
// neither metric proves that the compositor displayed every frame.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { readLoadedEngine } from './engine-provenance.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const startedAt = new Date().toISOString()
const output = resolve(process.env.TEST_RETURN_OUTPUT || `${root}/.engine/return-qa/${startedAt.replace(/[:.]/g, '-')}-${process.pid}`)
assert.ok(!existsSync(`${output}/evidence.json`), `Refusing to overwrite evidence: ${output}`)
mkdirSync(output, { recursive: true })
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5185'
const seconds = Number(process.env.TEST_RETURN_SECONDS || 8)
assert.ok(Number.isFinite(seconds) && seconds >= 2 && seconds <= 120, 'TEST_RETURN_SECONDS must be between 2 and 120')
const optionalLimit = name => {
  if (!process.env[name]) return null
  const value = Number(process.env[name])
  assert.ok(Number.isFinite(value) && value > 0, `${name} must be positive and finite`)
  return value
}
const thresholds = { cpuP95Ms: optionalLimit('TEST_RETURN_CPU_P95_MS'), intervalP95Ms: optionalLimit('TEST_RETURN_INTERVAL_P95_MS') }
const softwareGPU = process.env.TEST_SOFTWARE_GPU === '1'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b)
  return { count: sorted.length, median: sorted[Math.floor(sorted.length * .5)] ?? null,
    p95: sorted[Math.floor(sorted.length * .95)] ?? null, p99: sorted[Math.floor(sorted.length * .99)] ?? null,
    max: sorted.at(-1) ?? null, over33ms: sorted.filter(value => value > 1000 / 30 + .5).length,
    over50ms: sorted.filter(value => value > 50).length }
}
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true,
  args: softwareGPU ? ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-webgl'] })
const viewport = { width: 1440, height: 1000 }
const page = await browser.newPage({ viewport, screen: viewport })
page.setDefaultTimeout(30000)
const logs = [], errors = [], phases = [], checkpoints = []
const fatalRuntimeLog = /\[tomcat-host\] fail|Missing C# script asset|Unhandled exception|callback\s+\w+\s+threw|Deferred[^\r\n]*(?:aborted|failed)/i
function assertRuntimeHealthy() {
  assert.deepEqual(errors, [], 'browser must not report uncaught errors')
  assert.deepEqual(logs.filter(value => fatalRuntimeLog.test(value)), [], 'native runtime must not report script faults or aborted deferred commands')
}
const provenance = { localPin: JSON.parse(readFileSync(`${root}/engine.lock.json`, 'utf8')),
  testSha256: sha256(readFileSync(fileURLToPath(import.meta.url))) }
let frame, canvas, failure, renderer, receipt, cleanup, sampledAudio, warmReopen, tutorialCompletion, warmup
page.on('console', message => { const value = message.text(); logs.push(value); if (value.includes('[Return]')) console.log(value) })
page.on('pageerror', error => errors.push(error.message))
await page.addInitScript(() => {
  const nativeFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = async (...args) => {
    const response = await nativeFetch(...args)
    const requestUrl = typeof args[0] === 'string' ? args[0] : args[0].url || String(args[0])
    if (new URL(response.url || requestUrl, location.href).pathname === '/samples/return/return.tcpak') {
      const bytes = await response.clone().arrayBuffer(), digest = await crypto.subtle.digest('SHA-256', bytes)
      top.__returnPackageReceipt = { url: response.url, byteLength: bytes.byteLength,
        sha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') }
    }
    return response
  }
  if (window === top) { window.__returnContexts = []; return }
  const state = window.__returnObservation = { recording: false, samples: [], current: null, dropped: 0, audio: [], buffers: [] }
  const raf = window.requestAnimationFrame
  window.requestAnimationFrame = callback => raf.call(window, timestamp => {
    if (!state.recording) return callback(timestamp)
    const begin = performance.now(), sample = { timestamp, engineCalls: 0, engineMs: 0, engineDelta: 0 }
    state.current = sample
    try { return callback(timestamp) }
    finally {
      sample.callbackMs = performance.now() - begin
      if (state.samples.length < 20000) state.samples.push(sample); else state.dropped++
      state.current = null
    }
  })
  const Native = globalThis.AudioContext
  if (Native) globalThis.AudioContext = class extends Native {
    constructor(...args) {
      super(...args)
      const analyser = this.createAnalyser(), outputAnalyser = this.createAnalyser(), silent = this.createGain()
      silent.gain.value = 0; analyser.connect(silent); silent.connect(this.destination)
      outputAnalyser.connect(silent)
      top.__returnContexts.push({ context: this, analyser, outputAnalyser })
      const bufferIds = new WeakMap(), outputGains = new WeakMap()
      const createBuffer = this.createBuffer.bind(this), createGain = this.createGain.bind(this)
      let newestBuffer
      this.createBuffer = (...args) => {
        const buffer = createBuffer(...args); newestBuffer = buffer
        bufferIds.set(buffer, state.buffers.length)
        state.buffers.push({ channels: args[0], frames: args[1], sampleRate: args[2] })
        return buffer
      }
      // Native WebAudio creates one PCM buffer and one destination gain per
      // voice. Observe the final gain, after channel routing, without changing it.
      this.createGain = () => {
        const gain = createGain(), connect = gain.connect, context = this, buffer = newestBuffer
        gain.connect = function (target, ...args) {
          const result = connect.call(this, target, ...args)
          if (target === context.destination && buffer) { outputGains.set(buffer, gain); connect.call(this, outputAnalyser) }
          return result
        }
        return gain
      }
      const create = this.createBufferSource.bind(this), context = this
      this.createBufferSource = () => {
        const source = create(), start = source.start, stop = source.stop
        let observation
        source.connect(analyser)
        source.start = function (...values) {
          const result = start.apply(this, values)
          if (state.audio.length < 1000) {
            observation = { at: performance.now(), loop: this.loop, gain: outputGains.get(this.buffer)?.gain.value,
              buffer: bufferIds.get(this.buffer), state: context.state, duration: this.buffer?.duration, channels: this.buffer?.numberOfChannels }
            state.audio.push(observation)
          }
          return result
        }
        source.stop = function (...values) { const result = stop.apply(this, values); if (observation) observation.stoppedAt = performance.now(); return result }
        return source
      }
    }
  }
})
if (process.env.TEST_LIVE_BACKEND !== '1') await page.route('**/v1/**', route => route.fulfill({ status: route.request().url().includes('/auth/me') ? 401 : 200, json: [] }))
const wait = milliseconds => page.waitForTimeout(milliseconds)
const occurrences = text => logs.filter(value => value.includes(text)).length
async function logAfter(text, count = 0, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (occurrences(text) <= count && Date.now() < deadline) { assertRuntimeHealthy(); await wait(100) }
  assertRuntimeHealthy()
  assert.ok(occurrences(text) > count, `Expected ${text}; recent log:\n${logs.slice(-20).join('\n')}`)
}
async function checkpoint(label) {
  const state = await frame.evaluate(() => {
    const module = window.TomCatWeb.runtime.Module, engine = window.TomCatWeb.engine
    let nativeStats = null
    try { if (engine.PlayerStats) nativeStats = JSON.parse(engine.PlayerStats()) } catch {}
    return { width: document.querySelector('canvas').width, height: document.querySelector('canvas').height,
      wasmHeapBytes: module.HEAPU8?.buffer?.byteLength ?? module.wasmMemory?.buffer?.byteLength ?? null,
      jsHeapBytes: performance.memory?.usedJSHeapSize ?? null, nativeStats,
      audioContexts: top.__returnContexts.map(({ context }) => ({ state: context.state, sampleRate: context.sampleRate })) }
  })
  checkpoints.push({ label, ...state })
}
async function measure(label, action = () => wait(seconds * 1000)) {
  assertRuntimeHealthy()
  await checkpoint(`${label}:before`)
  await frame.evaluate(() => { const state = window.__returnObservation; state.samples = []; state.dropped = 0; state.recording = true })
  const actionStartedAt = Date.now()
  let actionDurationMs, samplingExtensionMs = 0
  try {
    await action()
    actionDurationMs = Date.now() - actionStartedAt
    // SwiftShader can deliver fewer than ten frames during a short transition.
    // Keep collecting actual PlayerFrame calls, with a bound that still fails
    // a stalled runtime. Record this extension separately from the action.
    const extensionStartedAt = Date.now(), deadline = extensionStartedAt + 5000
    let count = await frame.evaluate(() => window.__returnObservation.samples.filter(sample => sample.engineCalls > 0).length)
    while (count < 10 && Date.now() < deadline) {
      assertRuntimeHealthy()
      await wait(50)
      count = await frame.evaluate(() => window.__returnObservation.samples.filter(sample => sample.engineCalls > 0).length)
    }
    samplingExtensionMs = Date.now() - extensionStartedAt
  } finally { await frame.evaluate(() => { window.__returnObservation.recording = false }) }
  const observed = await frame.evaluate(() => ({ samples: window.__returnObservation.samples, dropped: window.__returnObservation.dropped }))
  const engine = observed.samples.filter(sample => sample.engineCalls > 0)
  assert.equal(observed.dropped, 0, `${label}: observation capacity must not be exceeded`)
  assert.ok(engine.length >= 10, `${label}: expected at least 10 actual PlayerFrame calls, observed ${engine.length}`)
  const intervals = engine.slice(1).map((sample, index) => sample.timestamp - engine[index].timestamp)
  const phase = { label, actionDurationMs, samplingExtensionMs,
    callbackCpu: stats(engine.map(sample => sample.callbackMs)), playerFrameCpu: stats(engine.map(sample => sample.engineMs)),
    animationFrameIntervals: stats(intervals), callbackCadenceHz: intervals.length * 1000 / intervals.reduce((a, b) => a + b, 0), samples: observed.samples }
  phases.push(phase)
  assertRuntimeHealthy()
  console.log(JSON.stringify({ ...phase, samples: undefined }))
  if (thresholds.cpuP95Ms !== null) assert.ok(phase.callbackCpu.p95 <= thresholds.cpuP95Ms, `${label}: CPU p95 exceeds configured limit`)
  if (thresholds.intervalP95Ms !== null) assert.ok(phase.animationFrameIntervals.p95 <= thresholds.intervalP95Ms, `${label}: rAF interval p95 exceeds configured limit`)
  await checkpoint(`${label}:after`)
}
async function press(key) { await page.keyboard.press(key, { delay: 80 }); await wait(180) }
async function completeTutorial() {
  const started = Date.now(), logStart = logs.length
  const restarted = occurrences('[Return] restart')
  await press('r'); await logAfter('[Return] restart', restarted)
  const death = occurrences('[Return] realm:1')
  await page.keyboard.down('d')
  try { await logAfter('[Return] realm:1', death) } finally { await page.keyboard.up('d') }
  // This is the first authored tutorial button. Poll at 20 ms so the contact
  // cue bounds the box position within 0.1 world units at the authored speed5.
  const button = '[Return] button:159445659:5513520972314207830:true'
  const pressed = occurrences(button), deadline = Date.now() + 10000
  await page.keyboard.down('a')
  try {
    while (occurrences(button) <= pressed && Date.now() < deadline) { assertRuntimeHealthy(); await wait(20) }
    assert.ok(occurrences(button) > pressed, 'walking must push the original box onto the tutorial button')
    // The .96-wide box first overlaps the .4-wide button at center~2.18;
    // another .65 units centers it at1.53 while keeping the button held.
    await wait(130)
  } finally { await page.keyboard.up('a') }
  await canvas.screenshot({ path: `${output}/tutorial-box-button.png` })
  await page.keyboard.press('Space', { delay: 80 }); await wait(100)
  await page.keyboard.down('a')
  try { await wait(140) } finally { await page.keyboard.up('a') }
  await wait(650)
  await canvas.screenshot({ path: `${output}/tutorial-on-box.png` })
  const won = occurrences('[Return] win:0'), next = occurrences('[Return] stage:1 ')
  await page.keyboard.down('Space'); await page.keyboard.down('a')
  try { await wait(290) } finally { await page.keyboard.up('a'); await page.keyboard.up('Space') }
  await logAfter('[Return] win:0', won, 10000)
  await logAfter('[Return] stage:1 ', next, 10000)
  await canvas.screenshot({ path: `${output}/tutorial-completed.png` })
  tutorialCompletion = { durationMs: Date.now() - started, logs: logs.slice(logStart).filter(value => value.includes('[Return]')),
    method: 'Unmodified production package. Normal R/D/A/Space input, authored trap/button/win log cues, and bounded moves at the original speed5. No QA keys or private game-state reads.' }
}

try {
  await page.goto(`${base}/games/return`)
  await page.getByRole('button', { name: '开始游玩', exact: true }).first().click()
  await page.locator('.player-status').filter({ hasText: '已就绪' }).waitFor({ timeout: Number(process.env.TEST_BOOT_TIMEOUT || 180000) })
  await logAfter('[Return] ready')
  frame = page.frames().find(value => value.url() === new URL('/engine-host.html', base).href)
  assert.ok(frame, 'native engine iframe must exist')
  canvas = frame.locator('canvas')
  await wait(1000)
  await canvas.screenshot({ path: `${output}/menu.png` })
  renderer = await frame.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2'), extension = gl?.getExtension('WEBGL_debug_renderer_info')
    return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown'
  })
  const attached = await frame.evaluate(() => {
    const engine = window.TomCatWeb.engine, original = engine.PlayerFrame
    const wrapped = function (...args) {
      const sample = window.__returnObservation.current, begin = performance.now()
      try { return original.apply(this, args) }
      finally { if (sample) { sample.engineCalls++; sample.engineMs += performance.now() - begin; sample.engineDelta += args[0] } }
    }
    try { engine.PlayerFrame = wrapped } catch {}
    return engine.PlayerFrame === wrapped
  })
  assert.ok(attached, 'actual PlayerFrame timing hook must attach')
  provenance.loadedEngine = await readLoadedEngine(frame)
  if (process.env.TEST_RETURN_WARMUP === '1') {
    await logAfter('[Return] audio warmup:5 silent voices')
    const observed = await frame.evaluate(() => ({ audio: window.__returnObservation.audio, buffers: window.__returnObservation.buffers }))
    assert.equal(observed.buffers.length, 5, 'menu must allocate exactly five native PCM buffers')
    assert.equal(observed.audio.length, 5, 'each native voice must warm exactly once before Enter')
    assert.ok(observed.audio.every(value => value.gain === 0 && value.stoppedAt >= value.at), 'all warmup playback must start at zero output gain and stop')
    const peaks = []
    for (let index = 0; index < 6; index++) {
      peaks.push(await page.evaluate(() => Math.max(...top.__returnContexts.map(({ outputAnalyser }) => {
        const samples = new Float32Array(outputAnalyser.fftSize); outputAnalyser.getFloatTimeDomainData(samples)
        return samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0)
      }))))
      await wait(50)
    }
    assert.ok(peaks.every(peak => peak === 0), 'actual destination audio must remain silent in menu')
    warmup = { beforeEnter: observed, menuOutputPeaks: peaks }
  }
  receipt = await page.evaluate(() => window.__returnPackageReceipt)
  const response = await page.request.get(`${base}/samples/return/manifest.json`)
  assert.ok(response.ok(), 'Return manifest must be published')
  const manifestBytes = await response.body(), manifest = JSON.parse(manifestBytes.toString())
  provenance.gameManifest = { sha256: sha256(manifestBytes), manifest }
  assert.equal(receipt?.sha256, manifest.sha256, 'loaded production package must match its manifest')
  assert.equal(receipt.byteLength, manifest.byteLength)
  assert.ok(provenance.loadedEngine?.manifest?.commit, 'record the actual loaded engine identity')
  const engine = provenance.loadedEngine.manifest
  assert.ok([engine.commit, ...(engine.legacyCommits || [])].includes(manifest.engineCommit), 'Return package must match the runtime ABI')
  await canvas.focus()
  await measure('start-transition', async () => {
    await press('Enter')
    await logAfter('[Return] stage:0')
    await wait(600)
  })
  await canvas.screenshot({ path: `${output}/tutorial.png` })
  await measure('tutorial-idle')

  const oneShotsBefore = await frame.evaluate(() => window.__returnObservation.audio.filter(value => !value.loop).length)
  const jumpCount = occurrences('[Return] jump')
  await measure('jump', async () => {
    await press('Space')
    await logAfter('[Return] jump', jumpCount)
    await wait(900)
  })
  const oneShotsAfter = await frame.evaluate(() => window.__returnObservation.audio.filter(value => !value.loop).length)
  assert.ok(oneShotsAfter > oneShotsBefore, 'a grounded Space press must trigger actual jump audio')
  // Capture a separate jump: screenshot readback must stay outside timing runs.
  await press('Space')
  await canvas.screenshot({ path: `${output}/jump.png` })
  await wait(900)

  const realmCount = occurrences('[Return] realm:1')
  await measure('death-transition', async () => {
    await page.keyboard.down('d')
    try { await logAfter('[Return] realm:1', realmCount, 20000) }
    finally { await page.keyboard.up('d') }
    await wait(300)
  })
  await wait(200)
  await canvas.screenshot({ path: `${output}/death-realm.png` })
  await measure('death-realm-idle')
  const restartCount = occurrences('[Return] restart')
  await measure('restart-transition', async () => {
    await press('r')
    await logAfter('[Return] restart', restartCount)
    await wait(300)
  })
  await canvas.screenshot({ path: `${output}/restarted.png` })

  const pauseCount = occurrences('[Return] paused:true')
  await press('Escape')
  await logAfter('[Return] paused:true', pauseCount)
  await canvas.screenshot({ path: `${output}/paused.png` })
  const resumeCount = occurrences('[Return] paused:false')
  await press('p')
  await logAfter('[Return] paused:false', resumeCount)

  const muteCount = occurrences('[Return] mute:true')
  await press('m')
  await logAfter('[Return] mute:true', muteCount)
  const unmuteCount = occurrences('[Return] mute:false')
  await press('m')
  await logAfter('[Return] mute:false', unmuteCount)

  await page.waitForFunction(() => top.__returnContexts.some(({ context, analyser }) => {
    const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples)
    return context.state === 'running' && samples.some(value => Math.abs(value) > .0001)
  }), null, { timeout: 10000 })
  sampledAudio = await frame.evaluate(() => window.__returnObservation.audio)
  assert.ok(sampledAudio.some(value => value.state === 'running'), 'WebAudio must process actual sources')

  await page.getByRole('button', { name: '全屏游玩', exact: true }).click()
  await page.waitForFunction(() => document.fullscreenElement?.classList.contains('runtime-player'))
  await wait(500)
  const box = await canvas.boundingBox(), dimensions = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  assert.ok(Math.abs(box.width - dimensions.width) <= 2 && Math.abs(box.height - dimensions.height) <= 2, 'fullscreen canvas must match the viewport')
  await canvas.focus()
  await wait(200)
  if (logs.filter(value => value.includes('[Return] paused:')).at(-1)?.includes('paused:true')) {
    const resumed = occurrences('[Return] paused:false')
    await press('p')
    await logAfter('[Return] paused:false', resumed)
  }
  await canvas.screenshot({ path: `${output}/fullscreen.png` })
  await measure('fullscreen-idle')
  await measure('fullscreen-movement', async () => {
    for (let index = 0; index < 4; index++) {
      const key = index % 2 ? 'a' : 'd'
      await page.keyboard.down(key)
      try { await wait(seconds * 1000 / 4) } finally { await page.keyboard.up(key) }
    }
  })
  if (process.env.TEST_RETURN_COMPLETE === '1') await completeTutorial()
  if (warmup) {
    warmup.afterGameplay = await frame.evaluate(() => ({ buffers: window.__returnObservation.buffers, audio: window.__returnObservation.audio }))
    assert.equal(warmup.afterGameplay.buffers.length, 5, 'jump/death/win/music/pause/restart must reuse the five warmed PCM buffers')
    assert.ok(warmup.afterGameplay.audio.slice(5).some(value => value.gain > 0), 'normal gameplay must restore audible gain')
  }
  await page.evaluate(() => document.exitFullscreen())
  await page.getByRole('button', { name: '关闭播放器', exact: true }).click()
  assert.equal(await page.locator('iframe[title="TomCat 游戏播放器"]').count(), 0, 'closing removes the runtime iframe')
  await page.waitForFunction(() => top.__returnContexts.every(({ context }) => context.state === 'closed'))
  cleanup = await page.evaluate(() => ({ iframes: document.querySelectorAll('iframe[title="TomCat 游戏播放器"]').length, audioContexts: top.__returnContexts.map(({ context }) => context.state) }))
  if (process.env.TEST_RETURN_REOPEN !== '0') {
    let engineDownloads = 0
    const observe = request => { if (/\/engine\/.*\.gz(?:\?|$)/.test(request.url())) engineDownloads++ }
    page.on('request', observe)
    const readyCount = occurrences('[Return] ready')
    await page.getByRole('button', { name: '开始游玩', exact: true }).first().click()
    await page.locator('.player-status').filter({ hasText: '已就绪' }).waitFor({ timeout: 90000 })
    await logAfter('[Return] ready', readyCount)
    page.off('request', observe)
    assert.equal(engineDownloads, 0, 'warm reopen must reuse the verified engine cache')
    await page.getByRole('button', { name: '关闭播放器', exact: true }).click()
    await page.waitForFunction(() => top.__returnContexts.every(({ context }) => context.state === 'closed'))
    warmReopen = await page.evaluate(() => ({ iframes: document.querySelectorAll('iframe[title="TomCat 游戏播放器"]').length, audioContexts: top.__returnContexts.map(({ context }) => context.state) }))
    warmReopen.engineDownloads = engineDownloads
    assert.equal(warmReopen.iframes, 0, 'reopened runtime must also be fully removed')
  }
  assertRuntimeHealthy()
} catch (error) {
  failure = error
  if (canvas && frame && !frame.isDetached()) {
    try { await canvas.screenshot({ path: `${output}/failure.png` }) } catch {}
  }
} finally {
  if(frame&&!frame.isDetached()) {
    try { sampledAudio = await frame.evaluate(()=>window.__returnObservation.audio) } catch {}
  }
  const evidence = { schema: 1, status: failure ? 'failed' : 'passed', failure: failure?.stack,
    startedAt, finishedAt: new Date().toISOString(), base, browser: browser.version(), viewport,
    renderer, softwareGPURequested: softwareGPU, thresholds, provenance, loadedPackage: receipt,
    phases, checkpoints, audio: sampledAudio, cleanup, warmReopen, tutorialCompletion, warmup, logs, errors,
    measurement: {
      input: 'Unmodified production TCPAK, ordinary keyboard and player UI input. This smoke run does not claim completion of all levels.',
      cpu: 'Synchronous iframe host rAF callback and nested PlayerFrame wall duration; includes WASM game/update/render submission and instrumentation overhead.',
      intervals: 'Differences between consecutive engine-calling rAF timestamps, measured separately from CPU duration. Cadence is not proof of completed GPU/compositor presentation or end-to-end input latency.',
      scope: 'Hardware, viewport, phase, package and engine hashes are recorded. No universal frame-rate threshold is enabled unless explicitly configured.',
    } }
  writeFileSync(`${output}/evidence.json`, JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify({ status: evidence.status, renderer, output, phases: phases.map(({ samples, ...summary }) => summary) }, null, 2))
  await browser.close()
}
if (failure) throw failure
