// Original Unity Main UI, exercised through the shipped package and real clicks.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { readLoadedEngine } from './engine-provenance.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const startedAt = new Date().toISOString()
const output = resolve(process.env.TEST_RETURN_OUTPUT || `${root}/.engine/return-menu-qa/${startedAt.replace(/[:.]/g, '-')}-${process.pid}`)
mkdirSync(output, { recursive: true })
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5192'
const softwareGPU = process.env.TEST_SOFTWARE_GPU === '1'
// Actual source-project Play mode screenshot (Unity 6000.2.14f1, Gamma).
// Quiet panel areas over the original [29,33,45] scene background. Allow only
// rounding variation, so a neutral but incorrectly bright panel cannot pass.
const originalPauseReference = {
  rgb: [135, 136, 141], tolerance: 2,
  screenshotSha256: 'cc616d7b84a5a7162a9aa43b9f00410f2710553853496c76ae77edabf4abdf54',
  sourceMainSha256: 'be3fffdfcd42339c77a0a899907b44d5439bdbbf955f9a897078215305388890',
}
assert.equal(createHash('sha256').update(readFileSync(`${root}/docs/return-reference/unity-pause.png`)).digest('hex'),
  originalPauseReference.screenshotSha256, 'The original Unity reference must retain its captured pixels')
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true,
  args: softwareGPU ? ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-webgl'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const logs = [], errors = [], captures = [], clicks = [], textureWarmups = []
let frame, canvas, provenance, failure, quitCleanup, pauseQuitCleanup, pausePixels
page.on('console', message => logs.push(message.text()))
page.on('pageerror', error => errors.push(error.message))
const fatal = /\[tomcat-host\] fail|Unhandled exception|callback\s+\w+\s+threw|Deferred[^\r\n]*(?:aborted|failed)/i
const healthy = () => { assert.deepEqual(errors, []); assert.deepEqual(logs.filter(value => fatal.test(value)), []) }
if (process.env.TEST_LIVE_BACKEND !== '1') await page.route('**/v1/**', route => route.fulfill({ status: route.request().url().includes('/auth/me') ? 401 : 200, json: [] }))
await page.addInitScript(() => {
  if (window === top) { window.__returnMenuContexts = []; return }
  const Native = window.AudioContext
  if (Native) window.AudioContext = class extends Native {
    constructor(...args) { super(...args); top.__returnMenuContexts.push(this) }
  }
})
async function waitLog(text, previous = 0) {
  const until = Date.now() + 180000
  while (logs.filter(value => value.includes(text)).length <= previous && Date.now() < until) {
    healthy(); await page.waitForTimeout(50)
  }
  assert.ok(logs.filter(value => value.includes(text)).length > previous, `Missing ${text}: ${logs.slice(-10).join('\n')}`)
}
async function open() {
  const ready = logs.filter(value => value.includes('[Return] ready')).length
  const start = logs.length
  await page.getByRole('button', { name: '开始游玩', exact: true }).first().click()
  await waitLog('[Return] ready', ready)
  const startup = logs.slice(start)
  const queued = startup.find(value => /Queued \d+ packaged textures/.test(value))?.match(/Queued (\d+) packaged textures/)
  const requestedAt = startup.findIndex(value => /\[Return\] texture warmup:\d+ requested/.test(value))
  const completedAt = startup.findIndex(value => /\[Return\] textures ready:\d+/.test(value))
  const readyAt = startup.findIndex(value => value.includes('[Return] ready'))
  assert.ok(queued && requestedAt >= 0 && completedAt > requestedAt && readyAt > completedAt,
    'Native texture requests and completed GPU readiness must precede interactive readiness')
  const requested = Number(startup[requestedAt].match(/warmup:(\d+)/)[1])
  const completed = Number(startup[completedAt].match(/ready:(\d+)/)[1])
  assert.equal(requested, Number(queued[1]), 'Preload all actual packaged textures, excluding reference-only PNGs')
  assert.equal(completed, requested)
  textureWarmups.push({ queued: Number(queued[1]), requested, completed, requestedAt, completedAt, readyAt })
  frame = page.frames().find(candidate => candidate.url() === new URL('/engine-host.html', base).href)
  assert.ok(frame, 'Find native player frame explicitly')
  canvas = frame.locator('canvas')
  await page.waitForTimeout(300)
}
async function snapshot(name) {
  healthy()
  const bounds = await canvas.boundingBox()
  assert.ok(bounds?.width > 0 && bounds.height > 0)
  const png = await canvas.screenshot({ path: `${output}/${name}.png` })
  captures.push({ name, bounds })
  return png
}
async function originalButton(name) {
  const bounds = await canvas.boundingBox()
  const scale = Math.min(bounds.width / 1920, bounds.height / 1080)
  // Independent source values: Main.unity Start/Quat rect centers after the
  // original Canvas scaleFactor 5, measured relative to screen center.
  const offset = name === 'start' ? [-15.5, 150.5] : [-33, 287.5]
  const point = { x: bounds.x + bounds.width / 2 + offset[0] * scale, y: bounds.y + bounds.height / 2 + offset[1] * scale }
  assert.ok(point.y >= bounds.y && point.y <= bounds.y + bounds.height, 'Original button stays inside the fitted design')
  await page.mouse.move(point.x, point.y)
  await page.waitForTimeout(500)
  await snapshot(`${name}-hover`)
  clicks.push({ name, point, bounds, scale })
  await page.mouse.click(point.x, point.y)
}
async function pauseButton(name) {
  const bounds = await canvas.boundingBox()
  const scale = Math.min(bounds.width / 1920, bounds.height / 1080)
  // Main.unity Menu/Panel source button Y values -4/-39/-74, Canvas scale 5.
  const point = { x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2 + ({ resume: 20, restart: 195, quit: 370 })[name] * scale }
  const previous = logs.filter(value => value.includes(`[Return] ui:${name}`)).length
  clicks.push({ name: `pause-${name}`, point, bounds, scale })
  await page.mouse.click(point.x, point.y)
  await waitLog(`[Return] ui:${name}`, previous)
}
try {
  await page.goto(`${base}/games/return`)
  await open()
  provenance = await readLoadedEngine(frame)
  await page.getByRole('button', { name: '全屏游玩', exact: true }).click()
  await page.waitForFunction(() => !!document.fullscreenElement)
  await page.mouse.move(5, 5)
  await snapshot('menu-1920x1080')
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.waitForTimeout(150)
  await snapshot('menu-1280x720')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(150)
  await snapshot('menu-narrow')
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.waitForTimeout(150)
  await originalButton('quit')
  await page.waitForFunction(() => document.querySelectorAll('iframe[title="TomCat 游戏播放器"]').length === 0)
  quitCleanup = await page.evaluate(() => ({ iframes: document.querySelectorAll('iframe[title="TomCat 游戏播放器"]').length,
    audio: window.__returnMenuContexts.map(context => context.state) }))
  assert.ok(quitCleanup.audio.length > 0 && quitCleanup.audio.every(state => state === 'closed'), 'Application.Quit releases every audio context')
  assert.equal(await page.getByRole('alert').count(), 0, 'Normal game exit must not display a runtime error')
  healthy()
  await open()
  await snapshot('reopened-menu')
  await originalButton('start')
  await waitLog('[Return] stage:0')
  await page.getByRole('button', { name: '全屏游玩', exact: true }).click()
  await page.waitForFunction(() => !!document.fullscreenElement)
  await page.waitForTimeout(500)
  await snapshot('tutorial-after-start-click')
  await page.keyboard.press('p', { delay: 80 })
  await waitLog('[Return] paused:true')
  const firstPause = await snapshot('original-pause-panel')
  pausePixels = await page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), value => value.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const sample = document.createElement('canvas'); sample.width = bitmap.width; sample.height = bitmap.height
    const context = sample.getContext('2d'); context.drawImage(bitmap, 0, 0)
    const pixels = [.2, .5, .8].flatMap(y => [.08, .92].map(x => ({
      x: Math.floor(x * bitmap.width), y: Math.floor(y * bitmap.height),
      rgba: [...context.getImageData(Math.floor(x * bitmap.width), Math.floor(y * bitmap.height), 1, 1).data],
    })))
    bitmap.close(); return pixels
  }, firstPause.toString('base64'))
  for (const pixel of pausePixels) {
    const rgb = pixel.rgba.slice(0, 3)
    assert.ok(Math.min(...rgb) > 100 && Math.max(...rgb) - Math.min(...rgb) < 20,
      `First pause must show the original neutral panel, not missing/pending texture: ${JSON.stringify(pixel)}`)
    assert.ok(rgb.every((value, index) => Math.abs(value - originalPauseReference.rgb[index]) <= originalPauseReference.tolerance),
      `First pause must match original Unity compositing: ${JSON.stringify(pixel)}, reference ${originalPauseReference.rgb}`)
  }
  await page.waitForTimeout(700)
  await snapshot('original-pause-panel-settled')
  await pauseButton('resume')
  await waitLog('[Return] paused:false')
  const pausedBefore = logs.filter(value => value.includes('[Return] paused:true')).length
  await page.keyboard.press('p', { delay: 80 })
  await waitLog('[Return] paused:true', pausedBefore)
  const stagesBefore = logs.filter(value => value.includes('[Return] stage:0')).length
  await pauseButton('restart')
  await waitLog('[Return] stage:0', stagesBefore)
  await snapshot('tutorial-after-pause-restart')
  const pausedAgain = logs.filter(value => value.includes('[Return] paused:true')).length
  await page.keyboard.press('p', { delay: 80 })
  await waitLog('[Return] paused:true', pausedAgain)
  await pauseButton('quit')
  await page.waitForFunction(() => document.querySelectorAll('iframe[title="TomCat 游戏播放器"]').length === 0)
  pauseQuitCleanup = await page.evaluate(() => ({ iframes: document.querySelectorAll('iframe[title="TomCat 游戏播放器"]').length,
    audio: window.__returnMenuContexts.map(context => context.state) }))
  assert.ok(pauseQuitCleanup.audio.length >= 2 && pauseQuitCleanup.audio.every(state => state === 'closed'), 'Pause Quit releases both reopened player audio contexts')
  assert.equal(await page.getByRole('alert').count(), 0)
  healthy()
} catch (error) {
  failure = error
  try { await page.screenshot({ path: `${output}/failure.png` }) } catch {}
} finally {
  const evidence = { status: failure ? 'failed' : 'passed', startedAt, finishedAt: new Date().toISOString(),
    base, browser: browser.version(), softwareGPU, provenance, captures, clicks, quitCleanup, pauseQuitCleanup, pausePixels, originalPauseReference, textureWarmups, logs, errors,
    testSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'), failure: failure?.stack }
  writeFileSync(`${output}/evidence.json`, JSON.stringify(evidence, null, 2))
  await browser.close()
  console.log(JSON.stringify({ status: evidence.status, output }, null, 2))
}
if (failure) throw failure
