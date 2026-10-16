// Opt-in native-player QA. This is deliberately NOT a natural ten-wave run.
// A copy of the production Tc project starts at wave 10 with all three skills
// unlocked and 100 HP. Only that copy's Awake receives the initialization below.
// The production project, public package and source ZIP are never modified.
// Run with a website server already listening (default http://127.0.0.1:5185):
//   node tests/rougelike-skills-browser.mjs
// --build-only cooks without launching Chrome; --fixture=<absolute directory>
// reuses a previously built fixture after verifying source/toolchain/package hashes.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { validatePackage } from '../scripts/build-rougelike.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const production = join(root, 'samples/rougelike')
const sourcePath = join(production, 'Assets/Scripts/RougelikeGame.cs')
const scratch = join(root, '.engine')
const lock = JSON.parse(readFileSync(join(root, 'engine.lock.json'), 'utf8'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const productionHash = hash(readFileSync(sourcePath))
const initialization = '\n        Begin();\n        slowUnlocked = holeUnlocked = chargeUnlocked = true;\n        health = maxHealth = 100;\n        wave = 9;\n        StartWave(1.5f);'
const player = resolve(process.env.TOMCAT_PLAYER_DIR || join(scratch, 'player-fixture'))
const managed = resolve(process.env.TOMCAT_MANAGED_DIR || join(scratch, 'upgrade-managed'))
const worker = resolve(process.env.TOMCAT_COOK_WORKER || join(root, '../Tc_Engine_Web_backend/cook/worker.mjs'))
for (const directory of [player, managed]) {
  assert.equal(readFileSync(join(directory, 'engine-commit.txt'), 'utf8').trim(), lock.commit,
    `Stage the engine.lock.json candidate before building a QA fixture: ${directory}`)
}
const toolchainHashes = Object.fromEntries([
  join(player, 'tomcat_player.js'), join(player, 'tomcat_player.wasm'),
  join(managed, 'TomCat.Managed.dll'), join(managed, 'TomCat.ScriptGenerator.dll'),
].map(path => [relative(root, path).replaceAll('\\', '/'), hash(readFileSync(path))]))

mkdirSync(scratch, { recursive: true })
const existing = process.argv.find(value => value.startsWith('--fixture='))?.slice('--fixture='.length)
const directory = existing ? resolve(existing) : mkdtempSync(join(scratch, 'rougelike-skills-'))
assert.ok(directory.startsWith(scratch + sep), 'QA output must stay within frontend/.engine')
const packagePath = join(directory, 'rougelike-skills.tcpak')
const manifestPath = join(directory, 'fixture.json')
let manifest
if (existing) {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.equal(manifest.productionSourceSha256, productionHash, 'Production changed; recook the QA fixture')
  assert.equal(manifest.engineCommit, lock.commit)
  assert.deepEqual(manifest.toolchainHashes, toolchainHashes)
  assert.equal(manifest.initialization, initialization)
  assert.equal(manifest.packageSha256, hash(readFileSync(packagePath)))
} else {
  const copy = join(directory, 'project')
  cpSync(production, copy, { recursive: true, filter: path =>
    !relative(production, path).split(sep).some(part => ['Library', 'bin', 'obj', '.git'].includes(part)) })
  const original = readFileSync(sourcePath, 'utf8')
  // Anchor the end of the real Awake; fail rather than silently patch another method.
  const marker = '        Log.Info("[Rougelike] ready: Tc C# arena, 10 waves, native sprites and text");'
  assert.equal(original.split(marker).length, 2, 'Awake marker changed; review fixture initialization')
  const at = original.indexOf(marker) + marker.length
  assert.match(original.slice(at), /^\s*\}/, 'Expected Awake to end immediately after its ready log')
  const modified = original.slice(0, at) + initialization + original.slice(at)
  writeFileSync(join(copy, 'Assets/Scripts/RougelikeGame.cs'), modified)
  const cooked = spawnSync(process.execPath, [worker, join(copy, 'Project.tcproj'), packagePath], {
    cwd: root, env: { ...process.env, TOMCAT_PLAYER_DIR: player, TOMCAT_MANAGED_DIR: managed },
    stdio: 'inherit', timeout: 180000,
  })
  assert.equal(cooked.status, 0, `Native Tc fixture cook failed: ${cooked.error?.message || cooked.signal || cooked.status}`)
  const bytes = readFileSync(packagePath)
  manifest = { purpose: 'QA only: unlocked skills and wave-10 stress, not a natural playthrough',
    engineCommit: lock.commit, toolchainHashes, productionSourceSha256: productionHash,
    fixtureSourceSha256: hash(Buffer.from(modified)), initialization,
    packageSha256: hash(bytes), packageBytes: bytes.length, entries: validatePackage(bytes) }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}
assert.equal(hash(readFileSync(sourcePath)), productionHash, 'Production source was modified')
console.log(`QA fixture (never published): ${directory}`)
if (process.argv.includes('--build-only')) process.exit(0)

const logs = [], errors = [], evidence = { fixture: manifest, assertions: [], screenshots: [] }
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1040 } })
page.setDefaultTimeout(10000)
// Observe actual engine-created WebAudio nodes, never game/private simulation state.
await page.addInitScript(() => {
  // Hash the bytes actually received by fetch. CDP response.body() may evict a
  // 17 MB intercepted package before it is read, so inspect its real clone here.
  const nativeFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = async (...args) => {
    const response = await nativeFetch(...args)
    const requested = typeof args[0] === 'string' ? args[0] : args[0].url
    if (new URL(response.url || requested, location.href).pathname === '/samples/rougelike/rougelike.tcpak') {
      const bytes = await response.clone().arrayBuffer()
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      top.__rougelikeFixtureReceipt = { bytes: bytes.byteLength,
        sha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') }
    }
    return response
  }
  if (!globalThis.AudioContext) return
  const Native = globalThis.AudioContext
  top.__rougelikeSkillsAudio ??= []
  globalThis.AudioContext = class extends Native {
    constructor(...args) {
      super(...args)
      const analyser = this.createAnalyser(), mute = this.createGain(), voices = []
      mute.gain.value = 0; analyser.connect(mute); mute.connect(this.destination)
      const create = this.createBufferSource.bind(this)
      this.createBufferSource = () => {
        const source = create(), voice = { source, started: false, stopped: false, ended: false }
        const start = source.start.bind(source), stop = source.stop.bind(source)
        source.start = (...args) => { voice.started = true; return start(...args) }
        source.stop = (...args) => { voice.stopped = true; return stop(...args) }
        source.addEventListener('ended', () => { voice.ended = true })
        source.connect(analyser); voices.push(voice); return source
      }
      top.__rougelikeSkillsAudio.push({ context: this, analyser, voices })
    }
  }
})
page.on('console', message => {
  const text = message.text()
  if (text.includes('GL_INVALID_OPERATION')) return
  logs.push(text)
  if (/Rougelike|exception|failed/i.test(text)) console.log(text)
})
page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
page.on('dialog', dialog => dialog.accept())
await page.route('**/v1/**', route => route.fulfill({ status: route.request().url().includes('/auth/me') ? 401 : 200, json: [] }))
let fixtureRequests = 0
// PlayerPreview appends ?engine=<commit>; matching pathname avoids accidentally
// loading the production package while intending to exercise the QA fixture.
const isSamplePackage = url => new URL(url).pathname === '/samples/rougelike/rougelike.tcpak'
await page.route(url => isSamplePackage(url), route => {
  fixtureRequests++
  return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: readFileSync(packagePath) })
})
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5185'
async function logContaining(part, timeout = 15000) {
  const end = Date.now() + timeout
  while (!logs.some(text => text.includes(part)) && Date.now() < end) await page.waitForTimeout(100)
  assert.ok(logs.some(text => text.includes(part)), `Missing native log: ${part}\n${logs.slice(-30).join('\n')}`)
  evidence.assertions.push(`Native log: ${part}`)
}
async function audioSnapshot() {
  return page.evaluate(() => (top.__rougelikeSkillsAudio || []).map(({ context, analyser, voices }) => {
    const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples)
    return { state: context.state, peak: Math.max(...samples.map(Math.abs)), voices: voices.map(v => ({
      active: v.started && !v.stopped && !v.ended, loop: v.source.loop,
      pitch: v.source.playbackRate.value, duration: v.source.buffer?.duration,
    })) }
  }))
}
async function waitPitch(pitch) {
  const end = Date.now() + 5000
  let snapshot
  do {
    snapshot = await audioSnapshot()
    if (snapshot.some(a => a.state === 'running' && a.voices.some(v => v.active && v.loop && Math.abs(v.pitch - pitch) < .001))) {
      evidence.assertions.push(`Active native BGM AudioBufferSourceNode playbackRate=${pitch}`)
      return snapshot
    }
    await page.waitForTimeout(50)
  } while (Date.now() < end)
  assert.fail(`Native BGM did not reach pitch ${pitch}: ${JSON.stringify(snapshot)}`)
}
async function capture(canvas, name) {
  const png = await canvas.screenshot({ path: join(directory, name + '.png') })
  evidence.screenshots.push(name + '.png')
  return png.toString('base64')
}
// Sample screenshots in original 1152x648 coordinates; account for aspect-fit.
async function pixels(png, rect) {
  return page.evaluate(async ({ png, rect }) => {
    const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
    const scale = Math.min(image.width / 1152, image.height / 648)
    const x = (image.width - 1152 * scale) / 2 + rect[0] * scale
    const y = (image.height - 648 * scale) / 2 + rect[1] * scale
    const data = context.getImageData(Math.round(x), Math.round(y), Math.max(1, Math.round(rect[2] * scale)), Math.max(1, Math.round(rect[3] * scale))).data
    let red = 0, green = 0, blue = 0, dark = 0, blueLine = 0, redPixels = 0, bluePixels = 0
    for (let i = 0; i < data.length; i += 4) {
      red += data[i]; green += data[i + 1]; blue += data[i + 2]
      if (data[i] < 105 && data[i + 1] < 105 && data[i + 2] < 105) dark++
      if (data[i + 2] - data[i] > 4 && data[i] > 100 && data[i] < 235) blueLine++
      if (data[i] - data[i + 1] > 40 && data[i] - data[i + 2] > 20) redPixels++
      if (data[i + 2] - data[i] > 30 && data[i + 2] - data[i + 1] > 10) bluePixels++
    }
    const count = data.length / 4
    return { r: red / count, g: green / count, b: blue / count, dark: dark / (scale * scale),
      blueLine: blueLine / (scale * scale), redPixels: redPixels / (scale * scale), bluePixels: bluePixels / (scale * scale) }
  }, { png, rect })
}
async function moveMouse(canvas, x, y) {
  const box = await canvas.boundingBox(), scale = Math.min(box.width / 1152, box.height / 648)
  await page.mouse.move(box.x + box.width / 2 + (x - 576) * scale, box.y + box.height / 2 + (y - 324) * scale)
}
try {
  await page.goto(`${base}/games/rougelike`)
  const packageResponse = page.waitForResponse(response => isSamplePackage(response.url()), { timeout: 60000 })
  await page.getByRole('button', { name: '开始游玩', exact: true }).first().click()
  const response = await packageResponse
  assert.equal(fixtureRequests, 1, 'QA fixture must be intercepted before waiting for native readiness')
  assert.equal(response.status(), 200)
  await page.waitForFunction(() => top.__rougelikeFixtureReceipt?.sha256)
  const receipt = await page.evaluate(() => top.__rougelikeFixtureReceipt)
  assert.equal(receipt.sha256, manifest.packageSha256, 'Browser received a package other than the cooked QA fixture')
  assert.equal(receipt.bytes, manifest.packageBytes)
  evidence.browserPackageReceipt = receipt
  evidence.assertions.push('Browser response bytes match the QA package SHA-256 before native readiness')
  await page.waitForFunction(() => document.body.innerText.includes('Rougelike · 几何竞技场 已就绪'), null, { timeout: 90000 })
  const canvas = page.frameLocator('iframe').locator('canvas')
  await logContaining('[Rougelike] ready')
  await logContaining('audio backend:WebAudio')
  await canvas.click({ position: { x: 100, y: 250 } })
  await page.waitForTimeout(250)
  // The real game auto-pauses when its iframe loses focus during loading.
  // Resume with its public P key only if the real music voice is paused.
  if (!(await audioSnapshot()).some(a => a.voices.some(v => v.active && v.loop))) await page.keyboard.press('p')
  await logContaining('[Rougelike] wave:10 enemies:60 hp:5')
  await waitPitch(1)
  assert.equal(fixtureRequests, 1, 'Expected only the fixture package request to be intercepted')
  const normal = await capture(canvas, '01-wave10-unlocked')
  const hud = await pixels(normal, [24, 20, 264, 50])
  assert.ok(hud.redPixels > 1800 && hud.bluePixels > 900, `Native health/energy fills are obscured: ${JSON.stringify(hud)}`)
  evidence.assertions.push('Red health and blue energy fill pixels render in front of native gray tracks')

  await page.keyboard.down('Shift')
  await waitPitch(.25)
  const slowed = await capture(canvas, '02-time-slow')
  await page.keyboard.up('Shift')
  await waitPitch(1)
  const normalPaper = await pixels(normal, [70, 150, 150, 180]), slowPaper = await pixels(slowed, [70, 150, 150, 180])
  assert.ok(slowPaper.b - slowPaper.r > normalPaper.b - normalPaper.r + 5, `Time-slow blue tint missing: ${JSON.stringify({ normalPaper, slowPaper })}`)
  evidence.assertions.push('Shift changes native BGM pitch 1 → .25 → 1 and screenshot blue tint')

  await moveMouse(canvas, 800, 200)
  const beforeHole = await capture(canvas, '03-before-black-hole')
  await page.keyboard.press('r')
  await logContaining('[Rougelike] black hole')
  await page.waitForTimeout(250)
  const withHole = await capture(canvas, '04-black-hole')
  const holeBefore = await pixels(beforeHole, [700, 100, 200, 200]), holeAfter = await pixels(withHole, [700, 100, 200, 200])
  assert.ok(holeAfter.dark > holeBefore.dark + 900, `Black-hole core/rings not visible at cursor: ${JSON.stringify({ holeBefore, holeAfter })}`)
  const holeAudio = await audioSnapshot()
  assert.ok(holeAudio.some(a => a.voices.some(v => !v.loop && v.duration > 2.4 && v.duration < 2.5)), 'Native black-hole audio clip was not played')
  evidence.assertions.push('R produces native black-hole log, rendered core/rings at cursor, and original ~2.438s SFX')

  await moveMouse(canvas, 1050, 324)
  await page.waitForTimeout(400)
  const beforeCharge = await capture(canvas, '05-before-charge')
  await page.mouse.down({ button: 'left' })
  await page.waitForTimeout(1500)
  const charging = await capture(canvas, '06-charge-guide')
  const guideBefore = await pixels(beforeCharge, [680, 319, 300, 10]), guideAfter = await pixels(charging, [680, 319, 300, 10])
  assert.ok(guideAfter.blueLine > guideBefore.blueLine + 120, `Held-left native charge guide not visible: ${JSON.stringify({ guideBefore, guideAfter })}`)
  await page.mouse.up({ button: 'left' })
  await logContaining('[Rougelike] charge released')
  await capture(canvas, '07-charge-released')
  evidence.assertions.push('Held left renders the charge guide; release executes native flying-blade branch')

  // Pressure phase: ordinary wave-10 spawning, enemy pursuit/contact, and real
  // rendering continue. No kills, spawn count or private C# state are fabricated.
  // Wall time does not prove all 60 have spawned when the renderer runs slowly.
  const stressSeconds = Number(process.env.TEST_STRESS_SECONDS || 38)
  assert.ok(Number.isFinite(stressSeconds) && stressSeconds >= 30, 'Pressure phase needs at least 30 wall-clock seconds')
  await page.waitForTimeout(stressSeconds * 1000)
  const crowd = await capture(canvas, '08-wave10-pressure')
  const crowdPixels = await pixels(crowd, [100, 100, 952, 448])
  assert.ok(crowdPixels.dark > 9000, `Expected a visible multi-enemy wave-10 crowd: ${JSON.stringify(crowdPixels)}`)
  await logContaining('[Rougelike] hurt hp:')
  assert.ok(!logs.some(text => text.includes('[Rougelike] dying')), '100-HP pressure fixture unexpectedly died')
  const audible = await audioSnapshot()
  assert.ok(audible.some(a => a.state === 'running' && a.peak > .0001), 'Native AudioContext output is silent')
  evidence.assertions.push(`${stressSeconds}s real-browser wave-10 pressure with visible enemy crowd and native contact-damage logs; no claim that all 60 spawned`)

  await page.keyboard.press('p')
  await page.waitForTimeout(200)
  const pausedAudio = await audioSnapshot()
  assert.ok(!pausedAudio.some(a => a.voices.some(v => v.active)), 'Pause left a native audio voice running')
  const paused = await capture(canvas, '09-paused')
  await page.waitForTimeout(450)
  const stillPaused = await capture(canvas, '10-paused-stable')
  assert.equal(hash(Buffer.from(stillPaused, 'base64')), hash(Buffer.from(paused, 'base64')), 'Paused native canvas continued changing')
  evidence.assertions.push('P stops native audio voices and freezes consecutive canvas screenshots')
  await page.getByRole('button', { name: '关闭播放器', exact: true }).click()
  assert.equal(await page.locator('iframe').count(), 0)
  await page.waitForFunction(() => top.__rougelikeSkillsAudio.every(a => a.context.state === 'closed'))
  evidence.assertions.push('Closing the player removes iframe and closes every native AudioContext')
  assert.deepEqual(errors, [])
  assert.ok(!logs.some(text => /callback \w+ threw|MissingMethodException|aborted before live mutation|Unhandled exception/.test(text)), logs.slice(-35).join('\n'))
  assert.equal(hash(readFileSync(sourcePath)), productionHash, 'Production source changed during the QA run')
  evidence.status = 'passed'
  evidence.audio = { afterBlackHole: holeAudio, afterPressure: audible, paused: pausedAudio }
  evidence.visualMetrics = { hud, normalPaper, slowPaper, holeBefore, holeAfter, guideBefore, guideAfter, crowdPixels }
  console.log('PASS: explicit QA initialization; native Shift/audio pitch/tint, R/render/SFX, charged blade, wave-10 pressure, pause and teardown')
} catch (error) {
  evidence.status = 'failed'; evidence.error = String(error.stack || error)
  evidence.audioAtFailure = await audioSnapshot().catch(() => [])
  await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => {})
  console.error(logs.slice(-40).join('\n'))
  throw error
} finally {
  evidence.logs = logs; evidence.pageErrors = errors
  writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n')
  await browser.close()
}
