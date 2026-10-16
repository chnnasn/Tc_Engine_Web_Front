import { chromium } from 'playwright'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { readLoadedEngine } from './rougelike-performance-probe.mjs'

// Defaults retain the original hardware-GPU, menu-edge, eight-empty-swings case.
// TEST_PERF_AUDIO_COMPARE=1 adds eight output-muted swings to the SAME session.
// Optional TEST_PERF_MAX_FRAME_MS / TEST_PERF_P95_MS apply to each attack's
// iframe rAF callback CPU costs (the baseline metric), not idle/load or FPS.
// No machine-independent timing limit is enabled by default.
const root = fileURLToPath(new URL('../', import.meta.url))
const startedAt = new Date().toISOString()
const output = resolve(process.env.TEST_PERF_OUTPUT || `${root}/.engine/rougelike-performance/${startedAt.replace(/[:.]/g, '-')}-${process.pid}`)
assert.ok(!['evidence.json', 'profile.json', 'after-swings.png'].some(name => existsSync(`${output}/${name}`)), `Refusing to overwrite performance evidence: ${output}`)
mkdirSync(output, { recursive: true })
const optionalLimit = name => {
  if (!process.env[name]) return null
  const value = Number(process.env[name])
  assert.ok(Number.isFinite(value) && value > 0, `${name} must be a positive finite number`)
  return value
}
const thresholds = { max: optionalLimit('TEST_PERF_MAX_FRAME_MS'), p95: optionalLimit('TEST_PERF_P95_MS') }
const audioCompare = process.env.TEST_PERF_AUDIO_COMPARE === '1'
const softwareGPU = process.env.TEST_SOFTWARE_GPU === '1'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const localFile = path => existsSync(`${root}/${path}`) ? { path, sha256: sha256(readFileSync(`${root}/${path}`)) } : null
const localPin = JSON.parse(readFileSync(`${root}/engine.lock.json`, 'utf8'))
const provenance = {
  localPin,
  // Local source is separate: it may differ from a remotely served package.
  localSource: localFile('samples/rougelike/Assets/Scripts/RougelikeGame.cs'),
  testScript: localFile('tests/rougelike-performance-browser.mjs'),
}
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b)
  return { count: sorted.length, median: sorted[Math.floor(sorted.length * .5)] ?? null,
    p95: sorted[Math.floor(sorted.length * .95)] ?? null, max: sorted.at(-1) ?? null,
    over50ms: sorted.filter(value => value > 50).length }
}
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true,
  args: softwareGPU ? ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-webgl'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.setDefaultTimeout(30000)
const logs = [], errors = [], intervals = [], thresholdFailures = []
let frame, canvas, renderer, profiler, profile, failure, observed, summaries, topFunctions = [], symbols
page.on('console', message => { const value = message.text(); logs.push(value); if (value.includes('[Rougelike]')) console.log(value) })
page.on('pageerror', error => errors.push(error.message))
await page.addInitScript(({ audioCompare }) => {
  // A large package can be evicted from CDP response.body storage. Hash the
  // actual fetch clone before the player consumes it, outside measured phases.
  const nativeFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = async (...args) => {
    const response = await nativeFetch(...args)
    const requestUrl = typeof args[0] === 'string' ? args[0] : args[0].url || String(args[0])
    const url = new URL(response.url || requestUrl, location.href)
    if (url.pathname === '/samples/rougelike/rougelike.tcpak') {
      const bytes = await response.clone().arrayBuffer(), digest = await crypto.subtle.digest('SHA-256', bytes)
      top.__tcPackageReceipt = { url: url.href, status: response.status, byteLength: bytes.byteLength,
        sha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') }
    }
    return response
  }
  if (window === top) return
  const state = window.__tcPerf = { frames: [], audio: [], inputs: [], contexts: [], current: null, hooks: {} }
  const epoch = () => performance.timeOrigin + performance.now()
  const raf = window.requestAnimationFrame
  window.requestAnimationFrame = callback => raf.call(window, timestamp => {
    const begin = performance.now()
    const sample = { at: performance.timeOrigin + begin, timestamp, callback: callback.name, engineCalls: 0, engineMs: 0 }
    state.current = sample
    try { return callback(timestamp) }
    finally { sample.duration = performance.now() - begin; state.frames.push(sample); state.current = null }
  })
  document.addEventListener('pointerdown', event => {
    if (event.target instanceof HTMLCanvasElement) state.inputs.push({ at: epoch(), button: event.button, trusted: event.isTrusted })
  }, true)
  // Observe real starts and PCM allocation. In the optional comparison only,
  // add one output gain to BOTH trials; muting it never skips native audio work.
  const NativeAudioContext = globalThis.AudioContext
  if (NativeAudioContext) globalThis.AudioContext = class extends NativeAudioContext {
    constructor(...args) {
      super(...args)
      const context = { context: this, gate: null }
      state.contexts.push(context)
      if (audioCompare) {
        const gate = super.createGain(); gate.connect(this.destination); context.gate = gate
        const createGain = this.createGain.bind(this)
        this.createGain = () => {
          const gain = createGain(), connect = gain.connect
          gain.connect = function (destination, ...ports) { return connect.call(this, destination === context.context.destination ? gate : destination, ...ports) }
          return gain
        }
      }
      const createBuffer = this.createBuffer.bind(this), createSource = this.createBufferSource.bind(this)
      this.createBuffer = (...values) => {
        const begin = epoch(), result = createBuffer(...values)
        state.audio.push({ type: 'buffer', at: begin, duration: epoch() - begin, channels: values[0], frames: values[1], sampleRate: values[2] })
        return result
      }
      this.createBufferSource = (...values) => {
        const source = createSource(...values), start = source.start
        source.start = function (...args) {
          const result = start.apply(this, args)
          state.audio.push({ type: 'start', at: epoch(), state: context.context.state, bufferSeconds: this.buffer?.duration })
          return result
        }
        return source
      }
    }
  }
}, { audioCompare })
await page.route('**/v1/**', route => route.fulfill({ status: route.request().url().includes('/auth/me') ? 401 : 200, json: [] }))

async function stopProfiler() {
  if (!profiler || profile) return
  profile = (await profiler.send('Profiler.stop')).profile
  writeFileSync(`${output}/profile.json`, JSON.stringify(profile))
}
function summarise() {
  if (!observed) return []
  // Pair globally before assigning by the preceding callback's start. A slow
  // last frame in an interval must retain its gap to the next callback.
  const engineFrames = observed.frames.filter(item => item.engineCalls > 0)
  const engineGaps = engineFrames.slice(0, -1).map((item, index) => ({ at: item.at, duration: engineFrames[index + 1].at - item.at }))
  return intervals.map(interval => {
    // Keep baseline's start-in-interval selection and quantile convention.
    const frames = observed.frames.filter(item => item.at >= interval.start && item.at < interval.end)
    const engine = frames.filter(item => item.engineCalls > 0)
    const starts = observed.audio.filter(item => item.type === 'start' && item.at >= interval.start && item.at < interval.end)
    return { ...interval, ...stats(frames.map(item => item.duration)),
      engineCallbacks: stats(engine.map(item => item.duration)), playerFrame: stats(engine.map(item => item.engineMs)),
      // Consecutive engine callback starts include browser scheduling gaps.
      // Baseline has no matching field; do not retroactively compare FPS.
      engineIntervals: stats(engineGaps.filter(item => item.at >= interval.start && item.at < interval.end).map(item => item.duration)),
      audioStarts: starts.length, audioContextStates: [...new Set(starts.map(item => item.state))],
      audioCreates: observed.audio.filter(item => item.type === 'create' && item.at >= interval.start && item.at < interval.end),
      audioPlays: observed.audio.filter(item => item.type === 'play' && item.at >= interval.start && item.at < interval.end),
      pointerDowns: observed.inputs.filter(item => item.at >= interval.start && item.at < interval.end),
    }
  })
}
function symbolise() {
  if (!profile) return
  const manifest = provenance.loadedEngine?.manifest
  const symbolPath = `public/engine/${manifest?.commit}/_framework/dotnet.native.js.symbols`
  const manifestPath = `${root}/public/engine/${manifest?.commit}/manifest.json`
  const names = new Map()
  if (existsSync(`${root}/${symbolPath}`) && existsSync(manifestPath)) {
    const localManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const nativeHash = item => item.files?.find(file => file.path === '_framework/dotnet.native.wasm')?.sha256
    if (nativeHash(manifest) && nativeHash(manifest) === nativeHash(localManifest)) {
      const bytes = readFileSync(`${root}/${symbolPath}`)
      for (const line of bytes.toString().split(/\r?\n/)) {
        const match = /^(\d+):(.*)$/.exec(line)
        if (match) names.set(match[1], match[2].replace(/\\([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))))
      }
      symbols = { path: symbolPath, sha256: sha256(bytes), matchedNativeWasmSha256: nativeHash(manifest), entries: names.size }
    }
  }
  const nodes = new Map(profile.nodes.map(node => [node.id, node.callFrame])), totals = new Map()
  for (let index = 0; index < (profile.samples?.length || 0); index++) {
    const call = nodes.get(profile.samples[index]), raw = call?.functionName || '(anonymous)'
    const id = /wasm-function\[(\d+)\]/.exec(raw)?.[1], name = names.get(id) || raw
    const key = `${name}\n${call?.url || ''}`
    const item = totals.get(key) || { name, raw, url: call?.url, selfMs: 0, samples: 0 }
    item.selfMs += (profile.timeDeltas?.[index] || 0) / 1000; item.samples++
    totals.set(key, item)
  }
  topFunctions = [...totals.values()].sort((a, b) => b.selfMs - a.selfMs).slice(0, 35)
}

try {
  await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5185'}/games/rougelike`)
  await page.getByRole('button', { name: '开始游玩', exact: true }).first().click()
  await page.waitForFunction(() => document.body.innerText.includes('Rougelike · 几何竞技场 已就绪'), null, { timeout: 180000 })
  await page.waitForTimeout(4000)
  frame = page.frames().find(item => item !== page.mainFrame() && item.url().includes('engine')) || page.frames().find(item => item !== page.mainFrame())
  assert.ok(frame, 'player iframe must exist')
  canvas = frame.locator('canvas')
  renderer = await frame.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2'), extension = gl?.getExtension('WEBGL_debug_renderer_info')
    return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown'
  })
  console.log('Renderer:', renderer, '\nEvidence:', output)
  provenance.loadedEngine = await readLoadedEngine(frame)
  provenance.loadedPackage = await page.evaluate(() => top.__tcPackageReceipt)
  assert.ok(provenance.loadedEngine?.manifest?.commit, 'record the engine manifest actually loaded by this player')
  assert.ok(provenance.loadedPackage, 'record the actual loaded package response')
  const gameResponse = await page.request.get(new URL('/samples/rougelike/manifest.json', page.url()).href)
  assert.ok(gameResponse.ok(), 'published game manifest must be available')
  const gameBytes = await gameResponse.body(), game = JSON.parse(gameBytes.toString())
  provenance.gameManifest = { url: gameResponse.url(), sha256: sha256(gameBytes), manifest: game }
  assert.equal(provenance.loadedPackage.sha256, game.sha256, 'loaded package matches published manifest')
  assert.equal(provenance.loadedPackage.byteLength, game.byteLength, 'loaded package length matches manifest')
  const runtimePin = provenance.loadedEngine.manifest
  assert.ok([runtimePin.commit, ...(runtimePin.legacyCommits || [])].includes(game.engineCommit), 'runtime explicitly accepts the package engine pin')
  if (game.sourceUrl) {
    const response = await page.request.get(new URL(game.sourceUrl, page.url()).href)
    assert.ok(response.ok(), 'published source archive must be available')
    const bytes = await response.body()
    provenance.sourceArchive = { url: response.url(), byteLength: bytes.length, sha256: sha256(bytes) }
  }
  // Tag actual engine work, without replacing the baseline all-iframe-rAF metric.
  const hooks = await frame.evaluate(() => {
    const state = window.__tcPerf, web = window.TomCatWeb, playerFrame = web.engine.PlayerFrame
    const wrapped = function (...args) {
      const begin = performance.now(), current = state.current
      try { return playerFrame.apply(this, args) }
      finally { if (current) { current.engineCalls++; current.engineMs += performance.now() - begin } }
    }
    try { web.engine.PlayerFrame = wrapped } catch {}
    state.hooks.playerFrame = web.engine.PlayerFrame === wrapped
    const audio = web.runtime.Module.tomcatAudio
    for (const method of ['create', 'play']) {
      const original = audio[method]
      audio[method] = function (...args) {
        const begin = performance.now(), result = original.apply(this, args)
        state.audio.push({ type: method, at: performance.timeOrigin + begin, duration: performance.now() - begin,
          device: args[0], voice: method === 'create' ? result : args[1], result,
          ...(method === 'create' ? { pcmBytes: args[3], channels: args[4], sampleRate: args[5], bits: args[6] } : {}) })
        return result
      }
    }
    state.hooks.audio = true
    return state.hooks
  })
  assert.ok(hooks.playerFrame && hooks.audio, 'actual PlayerFrame and native WebAudio hooks must attach')
  await canvas.focus()
  // Isolate empty swings at the left arena edge, away from breakable menus.
  await page.keyboard.down('a'); await page.waitForTimeout(1500); await page.keyboard.up('a')
  const box = await canvas.boundingBox()
  assert.ok(box, 'player canvas must be visible')
  const scale = Math.min(box.width / 1152, box.height / 648)
  await page.mouse.move(box.x + box.width / 2 + (200 - 576) * scale, box.y + box.height / 2 + (470 - 324) * scale)
  await page.waitForTimeout(1000)
  profiler = await page.context().newCDPSession(page)
  await profiler.send('Profiler.enable'); await profiler.send('Profiler.start')
  const now = () => page.evaluate(() => performance.timeOrigin + performance.now())
  for (const mode of audioCompare ? ['enabled', 'output-muted'] : ['enabled']) {
    if (mode === 'output-muted') await frame.evaluate(() => {
      for (const item of window.__tcPerf.contexts) item.gate.gain.value = 0
    })
    const begin = await now(); await page.waitForTimeout(4000)
    intervals.push({ label: mode === 'enabled' ? 'idle' : 'muted-idle', kind: 'idle', audioMode: mode, start: begin, end: await now() })
    for (let index = 0; index < 8; index++) {
      const start = await now()
      await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up()
      await page.waitForTimeout(1200)
      intervals.push({ label: `${mode === 'enabled' ? '' : 'muted-'}attack-${index + 1}`, kind: 'attack', audioMode: mode, start, end: await now() })
    }
  }
  await stopProfiler()
  observed = await frame.evaluate(() => {
    const { frames, audio, inputs, hooks, contexts } = window.__tcPerf
    return { frames, audio, inputs, hooks, contexts: contexts.map(item => ({ state: item.context.state, sampleRate: item.context.sampleRate, outputGain: item.gate?.gain.value ?? 1 })) }
  })
  summaries = summarise()
  await canvas.screenshot({ path: `${output}/after-swings.png` })
  assert.deepEqual(errors, [])
  assert.ok(!logs.some(value => /callback \w+ threw|MissingMethodException|aborted before live mutation|Unhandled exception|\[tomcat-host\] fail:/.test(value)), 'Managed callback/host faults invalidate the sample even if PlayerFrame continues rendering')
  assert.ok(logs.some(value => value.includes('[Rougelike] ready')), 'real game must report readiness')
  assert.ok(!logs.some(value => /\[Rougelike\] (wave:|kill:|hurt |upgrade |dying|clear)/.test(value)), 'empty swings must remain in the menu, away from combat and buttons')
  assert.ok(summaries.every(interval => interval.count > 0 && interval.engineCallbacks.count > 0), 'both baseline rAF and actual PlayerFrame work must be observed in every interval')
  for (const interval of summaries.filter(item => item.kind === 'attack')) {
    // Attack has no log. Menu knife audio is cued only after cooldown/energy
    // checks; one native Play AND one actual source.start prove acceptance.
    assert.equal(interval.pointerDowns.filter(event => event.trusted && event.button === 0).length, 1, `${interval.label}: one trusted canvas click`)
    assert.equal(interval.audioPlays.filter(event => event.result === true).length, 1, `${interval.label}: one accepted native knife Play`)
    assert.equal(interval.audioStarts, 1, `${interval.label}: one actual AudioBufferSource.start`)
    assert.deepEqual(interval.audioContextStates, ['running'], `${interval.label}: audio processing must remain enabled`)
    if (thresholds.max !== null && interval.max > thresholds.max) thresholdFailures.push(`${interval.label} max ${interval.max.toFixed(2)} > ${thresholds.max} ms`)
    if (thresholds.p95 !== null && interval.p95 > thresholds.p95) thresholdFailures.push(`${interval.label} p95 ${interval.p95.toFixed(2)} > ${thresholds.p95} ms`)
  }
  assert.deepEqual(thresholdFailures, [], 'attack-only optional CPU callback thresholds')
  await page.getByRole('button', { name: '关闭播放器', exact: true }).click()
} catch (error) {
  failure = error
} finally {
  try { await stopProfiler() } catch (error) { errors.push(`Profiler: ${error.message}`) }
  if (!observed && frame && !frame.isDetached()) {
    try { observed = await frame.evaluate(() => { const { frames, audio, inputs, hooks } = window.__tcPerf; return { frames, audio, inputs, hooks } }) }
    catch (error) { errors.push(`Observation: ${error.message}`) }
  }
  try { summaries ??= summarise() } catch (error) { errors.push(`Summary: ${error.message}`) }
  try { symbolise() } catch (error) { errors.push(`Symbols: ${error.message}`) }
  try { await browser.close() } catch (error) { errors.push(`Browser close: ${error.message}`); failure ??= error }
  if (!failure && errors.length) failure = new Error(errors.join('\n'))
  const evidence = { schema: 2, startedAt, finishedAt: new Date().toISOString(), status: failure ? 'failed' : 'passed',
    failure: failure?.stack, baseUrl: process.env.TEST_BASE_URL || 'http://127.0.0.1:5185', browser: browser.version(),
    viewport: page.viewportSize(), renderer, softwareGPURequested: softwareGPU, audioCompare, thresholds, thresholdFailures,
    provenance, summary: summaries, frames: observed?.frames, audio: observed?.audio, inputs: observed?.inputs, hooks: observed?.hooks,
    audioContexts: observed?.contexts, symbols, topFunctions, logs, errors,
    measurement: {
      primary: 'Original baseline: duration of every iframe rAF callback whose start falls inside each interval; same floor(n*q) quantiles.',
      engine: 'PlayerFrame wrapper marks host callbacks; synchronous native WASM/game update/render submission is included. engineIntervals pairs globally adjacent engine callback starts, assigning each gap to the interval containing its preceding start; this retains boundary-crossing gaps. No gap is invented after the final observed callback.',
      limits: 'CPU wall duration includes scheduler preemption and profiler/instrumentation overhead; excludes completed GPU rendering, compositor display, audio-thread cost and work outside rAF. This is not end-to-end input latency or FPS.',
      audio: 'Optional output-muted trial retains AudioContext, PCM conversion, native Play, buffer starts and audio processing. It is a sequential warm-cache comparison, not proof about disabling the audio subsystem. First attack can allocate PCM.',
      profile: 'CPU selfMs is a statistical sample estimate across the entire profile (idle plus all attacks), not exact per-function duration or attack-only cost.',
      source: 'sourceArchive hashes the served download; localSource hashes the checkout independently and is not asserted to equal the deployed source.',
    } }
  try { writeFileSync(`${output}/evidence.json`, JSON.stringify(evidence, null, 2)) }
  catch (error) { failure ??= error; console.error('Evidence write:', error.message) }
  console.log(JSON.stringify({ status: evidence.status, output, summary: summaries, topFunctions: topFunctions.slice(0, 15) }, null, 2))
}
if (failure) throw failure
