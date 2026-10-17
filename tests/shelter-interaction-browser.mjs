// Real shipped TCPAK, ordinary mouse input, rendered-pixel/log assertions.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { readLoadedEngine } from './engine-provenance.mjs'

const output = resolve(process.env.TEST_SHELTER_OUTPUT || `.engine/shelter-ui-qa/${new Date().toISOString().replaceAll(':', '-')}`)
mkdirSync(output, { recursive: true })
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5199'
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true, args: ['--enable-webgl'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: Number(process.env.TEST_DEVICE_SCALE || 1) })
const logs = [], errors = [], checkpoints = [], screenshots = [], networkFailures = []
const manifest = JSON.parse(readFileSync('public/samples/shelter/manifest.json', 'utf8'))
let frame, canvas, failure, provenance, renderer
page.on('console', message => { logs.push(message.text()); if (message.text().includes('[Shelter]')) console.log(message.text()) })
page.on('pageerror', error => errors.push(error.message))
page.on('requestfailed', request => networkFailures.push({ url: request.url(), error: request.failure()?.errorText }))
await page.route('**/v1/**', route => route.fulfill({ status: route.request().url().includes('/auth/me') ? 401 : 200, json: [] }))
const wait = milliseconds => page.waitForTimeout(milliseconds)
const count = text => logs.filter(line => line.includes(text)).length
function healthy() {
  assert.deepEqual(errors, [], 'no uncaught browser errors')
  assert.deepEqual(logs.filter(line => /Unhandled exception|callback.*threw|\[tomcat-host\] fail|Deferred.*(?:failed|aborted)/i.test(line)), [], 'no native script errors')
}
async function cue(text, previous = 0, timeout = 30000) {
  const until = Date.now() + timeout
  while (count(text) <= previous && Date.now() < until) { healthy(); await wait(80) }
  assert.ok(count(text) > previous, `Expected new log: ${text}`)
}
async function waitForPlayer() {
  const begin = Date.now(); let progress = begin + 15000
  while (Date.now() - begin < 240000) {
    if (await page.locator('.player-status').filter({ hasText: '已就绪' }).isVisible()) return
    const alert = page.locator('.player-dialog [role="alert"]')
    if (await alert.isVisible()) throw new Error(`Player startup failed: ${await alert.innerText()}`)
    if (Date.now() > progress) { console.log(`Waiting for deployed engine startup: ${Math.round((Date.now() - begin) / 1000)}s`); progress += 15000 }
    await wait(250)
  }
  throw new Error('Player startup exceeded 240 seconds')
}
async function point(x, y) {
  const box = await canvas.boundingBox(), scale = Math.min(box.width / 1920, box.height / 1080)
  return { x: box.x + box.width / 2 + (x - 960) * scale, y: box.y + box.height / 2 + (y - 540) * scale }
}
async function click(x, y) { const p = await point(x, y); await page.mouse.click(p.x, p.y, { delay: 60 }); await wait(200) }
async function quickClick(x, y) { const p = await point(x, y); await page.mouse.click(p.x, p.y); await wait(200) }
async function plot(index) { await click(960 + (index % 5 - 2) * 129.6, 540 + (Math.floor(index / 5) - 2) * 129.6) }
async function buildButton(index, confirm) {
  const dx = Math.max(-780, Math.min(530, (index % 5 - 2) * 129.6)), dy = Math.max(-400, Math.min(250, (Math.floor(index / 5) - 2) * 129.6))
  await click((confirm ? 1193.5 : 978.5) + dx, (confirm ? 651.5 : 651.5) + dy)
}
async function snap(label) {
  healthy()
  // scene.snapshot is unavailable in standalone players (NO_PROJECT). Inspect
  // rendered output instead of exposing or changing the simulation internals.
  const png = await canvas.screenshot()
  const regions = await page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
    const scratch = document.createElement('canvas'); scratch.width = image.width; scratch.height = image.height
    const context = scratch.getContext('2d'); context.drawImage(image, 0, 0)
    const scale = Math.min(image.width / 1920, image.height / 1080), offsetX = (image.width - 1920 * scale) / 2, offsetY = (image.height - 1080 * scale) / 2
    const rects = { Wood: [140, 85, 200, 65], Stone: [512, 85, 200, 65], Food: [875, 85, 230, 65], Daily: [1568, 790, 240, 65], Countdown: [20, 945, 410, 90], Party: [820, 493, 360, 50], Cost: [820, 552, 420, 50] }
    for (const index of [0, 1, 6, 7, 8, 12]) rects[`Plot ${index}`] = [960 + (index % 5 - 2) * 129.6 - 60, 540 + (Math.floor(index / 5) - 2) * 129.6 - 60, 120, 120]
    const result = {}
    for (const [name, [x, y, w, h]] of Object.entries(rects)) {
      const pixels = context.getImageData(Math.round(offsetX + x * scale), Math.round(offsetY + y * scale), Math.round(w * scale), Math.round(h * scale)).data
      result[name] = [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].map(value => value.toString(16).padStart(2, '0')).join('')
    }
    return result
  }, png.toString('base64'))
  const result = { label, regions, window: logs.filter(line => line.includes('[Shelter] window:')).at(-1)?.split('window:')[1] }
  checkpoints.push(result)
  return result
}
const resources = state => ['Wood', 'Stone', 'Food', 'Daily'].map(name => state.regions[name])
async function capture(name) { await wait(180); await canvas.screenshot({ path: `${output}/${name}.png` }); screenshots.push(`${name}.png`) }
async function selectPartyOne() {
  const from = await point(778, 623), to = await point(1142, 623)
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await wait(100)
  await page.mouse.move(to.x, to.y, { steps: 15 }); await wait(150); await page.mouse.up(); await wait(180)
}
try {
  const response = await page.request.get(`${base}/samples/shelter/shelter.tcpak`)
  assert.equal(response.status(), 200)
  const packageBytes = await response.body()
  assert.equal(createHash('sha256').update(packageBytes).digest('hex'), manifest.sha256, 'serve the current production package')
  console.log(`Verified deployed package: ${packageBytes.length} bytes / ${manifest.sha256}`)
  // Hold this exact verified package for the complete run even if another cook
  // replaces the public file while the browser is loading the native engine.
  await page.route(url => new URL(url).pathname === '/samples/shelter/shelter.tcpak', route => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: packageBytes }))
  await page.goto(`${base}/games/shelter`)
  await page.getByRole('button', { name: '开始游玩', exact: true }).first().click()
  await waitForPlayer()
  await cue('[Shelter] ready')
  frame = page.frames().find(value => value !== page.mainFrame()); canvas = frame.locator('canvas')
  provenance = await readLoadedEngine(frame)
  renderer = await frame.evaluate(() => { const gl = document.querySelector('canvas').getContext('webgl2'), extension = gl.getExtension('WEBGL_debug_renderer_info'); return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown' })
  await capture('menu')
  await click(960, 600); await cue('[Shelter] start')
  let state = await snap('initial')
  const initial = state
  assert.equal(state.window, 'None')
  await capture('initial')

  await plot(7); await cue('[Shelter] selected:7'); await capture('build-preview')
  await buildButton(7, false)
  state = await snap('cancel-build'); assert.equal(state.window, 'None'); assert.equal(state.regions['Plot 7'], initial.regions['Plot 7']); assert.deepEqual(resources(state), resources(initial))
  await plot(7); await buildButton(7, true); await cue('[Shelter] build:7')
  state = await snap('first-farm'); assert.equal(state.window, 'None'); assert.notEqual(state.regions['Plot 7'], initial.regions['Plot 7']); assert.notEqual(state.regions.Wood, initial.regions.Wood)
  const buildCount = count('[Shelter] build:')
  await plot(7); const occupiedBefore = await snap('occupied-before-confirm'); await buildButton(7, true)
  await cue('[Shelter] build blocked:此地块已有建筑')
  state = await snap('occupied-plot'); assert.deepEqual(resources(state), resources(occupiedBefore)); assert.equal(count('[Shelter] build:'), buildCount)
  await capture('occupied-plot'); await buildButton(7, false)
  await plot(6); await buildButton(6, true); await cue('[Shelter] build:6')
  const firstFarm = checkpoints.find(checkpoint => checkpoint.label === 'first-farm')
  state = await snap('second-farm'); assert.notEqual(state.regions.Wood, firstFarm.regions.Wood); assert.notEqual(state.regions['Plot 6'], initial.regions['Plot 6'])
  await plot(8); const insufficientBefore = await snap('insufficient-before-confirm'); await buildButton(8, true)
  await cue('[Shelter] build blocked:木材不足，需要 15')
  state = await snap('insufficient-resources'); assert.deepEqual(resources(state), resources(insufficientBefore)); assert.equal(state.regions['Plot 8'], insufficientBefore.regions['Plot 8']); assert.equal(count('[Shelter] build:8'), 0)
  await capture('insufficient-resources'); await buildButton(8, false)
  await plot(0); await buildButton(0, true); await cue('[Shelter] build:0')
  state = await snap('first-wall'); assert.notEqual(state.regions.Stone, initial.regions.Stone); assert.notEqual(state.regions['Plot 0'], initial.regions['Plot 0']); const preDispatch = state

  await click(1811, 950); await cue('[Shelter] window:Dispatch')
  const dispatchZero = await snap('dispatch-zero'); assert.equal(dispatchZero.window, 'Dispatch')
  await click(1143, 798)
  await cue('[Shelter] dispatch blocked:拖动滑块，至少选择一位居民')
  state = await snap('dispatch-zero-blocked'); assert.deepEqual(resources(state), resources(dispatchZero)); assert.equal(count('[Shelter] dispatch:'), 0)
  const beforeQuickOne = count('[Shelter] party:1'); await quickClick(1142, 623); await cue('[Shelter] party:1', beforeQuickOne)
  state = await snap('slider-quick-click-one'); assert.notEqual(state.regions.Party, dispatchZero.regions.Party); assert.notEqual(state.regions.Cost, dispatchZero.regions.Cost)
  const beforeQuickZero = count('[Shelter] party:0'); await quickClick(778, 623); await cue('[Shelter] party:0', beforeQuickZero)
  state = await snap('slider-quick-click-zero'); assert.equal(state.regions.Party, dispatchZero.regions.Party); assert.equal(state.regions.Cost, dispatchZero.regions.Cost)
  // Continue holding outside the track: the selected count must clamp to the
  // actual resident range, while the dispatch remains unconfirmed.
  const dragLogStart = logs.length, startDrag = await point(778, 623), beyondRight = await point(1450, 623), beyondLeft = await point(350, 623)
  await page.mouse.move(startDrag.x, startDrag.y); await page.mouse.down(); await wait(100)
  await page.mouse.move(beyondRight.x, beyondRight.y, { steps: 16 }); await wait(180)
  state = await snap('slider-clamped-max'); assert.equal(state.regions.Party, checkpoints.find(checkpoint => checkpoint.label === 'slider-quick-click-one').regions.Party)
  await page.mouse.move(beyondLeft.x, beyondLeft.y, { steps: 16 }); await wait(180)
  state = await snap('slider-clamped-min'); assert.equal(state.regions.Party, dispatchZero.regions.Party); assert.equal(state.regions.Cost, dispatchZero.regions.Cost)
  await page.mouse.up(); await wait(180)
  assert.ok(logs.slice(dragLogStart).filter(line => line.includes('[Shelter] party:')).every(line => /party:[01]$/.test(line)), 'holding outside the track never selects outside 0..resident count')
  assert.equal(count('[Shelter] dispatch:'), 0)
  await selectPartyOne(); await cue('[Shelter] party:1'); state = await snap('dispatch-selected'); assert.deepEqual(resources(state), resources(dispatchZero))
  await capture('dispatch-selected'); await click(835, 798)
  state = await snap('dispatch-cancelled'); assert.deepEqual(resources(state), resources(preDispatch)); assert.equal(count('[Shelter] dispatch:'), 0)
  await click(1811, 950); state = await snap('dispatch-reopened'); assert.equal(state.window, 'Dispatch')
  // Reopening resets the selection, so confirm is still blocked before drag.
  const blockedDispatch = count('[Shelter] dispatch blocked:'); await click(1143, 798); await cue('[Shelter] dispatch blocked:', blockedDispatch); assert.equal(count('[Shelter] dispatch:'), 0)
  await selectPartyOne(); await click(1143, 798); await cue('[Shelter] dispatch:1')
  state = await snap('exploration-started'); assert.notEqual(state.regions.Daily, preDispatch.regions.Daily); assert.notEqual(state.regions.Food, preDispatch.regions.Food)
  await click(1855, 94); await click(820, 845); await cue('[Shelter] speed:4'); await click(820, 845); await cue('[Shelter] speed:16'); await click(960, 380)
  await cue('[Shelter] window:Report', 0, 15000)
  state = await snap('exploration-report'); assert.equal(state.window, 'Report'); await capture('exploration-report')
  const reportTransitions = count('[Shelter] window:')
  await page.keyboard.press('p', { delay: 60 }); await wait(200)
  await page.keyboard.press('Escape', { delay: 60 }); await wait(200)
  state = await snap('report-cannot-be-bypassed'); assert.equal(state.window, 'Report'); assert.equal(count('[Shelter] window:'), reportTransitions); assert.equal(count('[Shelter] collect'), 0)
  await click(960, 798); await cue('[Shelter] collect')
  state = await snap('collected'); assert.equal(state.window, 'None'); assert.notEqual(state.regions.Daily, preDispatch.regions.Daily); assert.notEqual(state.regions.Wood, preDispatch.regions.Wood); assert.notEqual(state.regions.Stone, preDispatch.regions.Stone); const collected = state
  await click(960, 798); assert.equal(count('[Shelter] collect'), 1)
  // A second click lands on the map after the modal has closed; cancel that
  // harmless new build preview before changing playback layout.
  state = await snap('after-collect-click')
  if (state.window === 'Build') { const selected = Number(logs.filter(line => line.includes('[Shelter] selected:')).at(-1).split('selected:')[1]); await buildButton(selected, false) }
  state = await snap('after-collect-repeat'); assert.equal(state.regions.Wood, collected.regions.Wood); assert.equal(state.regions.Stone, collected.regions.Stone)

  await page.getByRole('button', { name: '全屏游玩', exact: true }).click(); await wait(300)
  await plot(1); await cue('[Shelter] selected:1'); await capture('fullscreen-build')
  await buildButton(1, true); await cue('[Shelter] build:1')
  state = await snap('fullscreen-build'); assert.equal(state.window, 'None')
  await click(1855, 94); state = await snap('paused-before'); const frozenCountdown = state.regions.Countdown, frozenResource = resources(state)
  await capture('settings'); await wait(3000)
  state = await snap('paused-after'); assert.equal(state.regions.Countdown, frozenCountdown); assert.deepEqual(resources(state), frozenResource)
  await click(960, 380)
  await click(1855, 94); await click(960, 540); await cue('[Shelter] menu'); await capture('returned-menu')
  const starts = count('[Shelter] start'); await click(960, 600); await cue('[Shelter] start', starts)
  state = await snap('restarted-from-menu'); assert.equal(state.window, 'None')
  await capture('restart')
  await page.evaluate(() => document.exitFullscreen()); await wait(250)
  state = await snap('restarted-embedded'); assert.deepEqual(resources(state), resources(initial)); assert.equal(state.regions['Plot 7'], initial.regions['Plot 7']); assert.equal(state.regions['Plot 1'], initial.regions['Plot 1'])
  await page.getByRole('button', { name: '关闭播放器', exact: true }).click(); assert.equal(await page.locator('iframe').count(), 0)
  healthy()
  console.log('Shelter mouse interaction regression passed')
} catch (error) {
  failure = error.stack || String(error)
  try { await page.screenshot({ path: `${output}/failure-page.png`, fullPage: true }) } catch {}
  if (canvas) { try { await capture('failure') } catch {} }
  throw error
} finally {
  writeFileSync(`${output}/evidence.json`, JSON.stringify({ status: failure ? 'failed' : 'passed', failure, base, browser: browser.version(), deviceScaleFactor: Number(process.env.TEST_DEVICE_SCALE || 1), package: manifest, provenance, renderer, screenshots, checkpoints, logs, errors, networkFailures, notes: 'Gameplay actions use ordinary mouse clicks/dragging; P/Esc are negative checks that cannot bypass the report. Assertions inspect gameplay logs and hash rendered canvas regions in comparable modal/layout states; they do not expose or change private game state. Player-mode scene.snapshot is unavailable (NO_PROJECT). The actual native TCPAK and pinned engine run without test-only game changes. API auth/list calls are mocked. Performance is measured separately by shelter-performance-browser.mjs.' }, null, 2))
  await browser.close()
  console.log(`Evidence: ${output}`)
}
