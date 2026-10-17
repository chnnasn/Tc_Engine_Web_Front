// Regress the reported left -> right -> restart vertical flip using actual
// submitted GPU vertices. The production package receives only ordinary input.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { readLoadedEngine } from './engine-provenance.mjs'
import { buildFixture, productionReceipt } from './return-fixture.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const startedAt = new Date().toISOString()
const output = resolve(process.env.TEST_RETURN_OUTPUT || `${root}/.engine/return-orientation-qa/${startedAt.replace(/[:.]/g, '-')}-${process.pid}`)
assert.ok(!existsSync(`${output}/evidence.json`), 'Do not overwrite previous evidence')
mkdirSync(output, { recursive: true })
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5185'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const productionTreeSha256 = productionReceipt()
const publishedPackageSha256 = sha256(readFileSync(`${root}/public/samples/return/return.tcpak`))
const legacyFlip = process.env.TEST_RETURN_LEGACY_FLIP === '1'
const expectLegacyFailure = process.env.TEST_RETURN_EXPECT_VERTICAL_FLIP === '1'
assert.ok(!expectLegacyFailure || legacyFlip, 'The expected-failure control is only for the isolated legacy-flip fixture')
const fixture = legacyFlip ? buildFixture({ mode: 'legacy-flip', directory: process.env.TEST_RETURN_FIXTURE }) : null
if (fixture) writeFileSync(`${output}/fixture.json`, JSON.stringify(fixture, null, 2))
if (process.argv.includes('--build-only')) {
  assert.ok(fixture, '--build-only requires TEST_RETURN_LEGACY_FLIP=1')
  console.log(`Legacy managed-setter fixture: ${fixture.directory}`)
  process.exit(0)
}
const artSource = readFileSync(`${root}/samples/return/Assets/Scripts/ReturnLevels.cs`, 'utf8')
const artHandles = new Map()
for (const name of ['Idle', 'Run', 'Fall', 'Dead']) {
  const declaration = artSource.match(new RegExp(`(?:ulong\\[\\]|ulong) ${name} = ([^;]+);`))
  assert.ok(declaration, `Find original ${name} sprite handles`)
  for (const handle of declaration[1].matchAll(/(\d+)UL/g)) artHandles.set(handle[1], name)
}
function expectedSpriteMips(bytes) {
  assert.equal(bytes.subarray(0, 8).toString(), 'TCPACK01')
  assert.equal(bytes.readUInt32LE(8), 8, 'Supported TCPAK format')
  const start = bytes.readUInt32LE(12), count = Number(bytes.readBigUInt64LE(16)), found = new Map()
  assert.ok(start + count * 64 <= bytes.length, 'Package index bounds')
  for (let index = 0; index < count; index++) {
    const at = start + index * 64, handle = bytes.readBigUInt64LE(at).toString()
    if (!artHandles.has(handle)) continue
    const offset = Number(bytes.readBigUInt64LE(at + 16)), size = Number(bytes.readBigUInt64LE(at + 24))
    assert.ok(offset + size <= bytes.length, `Texture bounds ${handle}`)
    const texture = bytes.subarray(offset, offset + size)
    assert.equal(sha256(texture), bytes.subarray(at + 32, at + 64).toString('hex'))
    assert.equal(texture.subarray(0, 4).toString(), 'TCTX')
    const table = texture.readUInt32LE(28), width = texture.readUInt32LE(table), height = texture.readUInt32LE(table + 4)
    const mipStart = Number(texture.readBigUInt64LE(table + 8)), mipSize = Number(texture.readBigUInt64LE(table + 16))
    assert.equal(width, 16); assert.equal(height, 16); assert.equal(mipSize, width * height * 4, 'RGBA8 avatar mip')
    assert.ok(mipStart + mipSize <= texture.length)
    const hash = sha256(texture.subarray(mipStart, mipStart + mipSize))
    found.set(handle, { handle, animation: artHandles.get(handle), sha256: hash, width, height })
  }
  assert.equal(found.size, artHandles.size, 'Every avatar sprite must exist in the published package')
  return [...found.values()]
}

const viewport = { width: 1600, height: 900 }
const softwareGPU = process.env.TEST_SOFTWARE_GPU === '1'
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true,
  args: softwareGPU ? ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-webgl'] })
const page = await browser.newPage({ viewport, screen: viewport })
const logs = [], errors = [], captures = []
const fatal = /\[tomcat-host\] fail|Missing C# script asset|Unhandled exception|callback\s+\w+\s+threw|Deferred[^\r\n]*(?:aborted|failed)/i
const provenance = { testSha256: sha256(readFileSync(fileURLToPath(import.meta.url))) }
if (fixture) provenance.fixture = fixture.manifest
let frame, canvas, expectedMips, failure, renderer, expectedFailureObserved = false
page.on('console', message => logs.push(message.text()))
page.on('pageerror', error => errors.push(error.message))
function healthy() { assert.deepEqual(errors, []); assert.deepEqual(logs.filter(value => fatal.test(value)), []) }
if (process.env.TEST_LIVE_BACKEND !== '1') await page.route('**/v1/**', route => route.fulfill({ status: route.request().url().includes('/auth/me') ? 401 : 200, json: [] }))
if (fixture) await page.route(url => new URL(url).pathname === '/samples/return/return.tcpak', route => route.fulfill({
  status: 200, contentType: 'application/octet-stream', body: readFileSync(fixture.packagePath),
}))
await page.addInitScript(() => {
  const fetch = window.fetch.bind(window)
  window.fetch = async (...args) => {
    const response = await fetch(...args)
    if (new URL(response.url || String(args[0]), location.href).pathname === '/samples/return/return.tcpak') {
      const bytes = await response.clone().arrayBuffer(), hash = await crypto.subtle.digest('SHA-256', bytes)
      top.__returnPackage = { byteLength: bytes.byteLength, sha256: [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('') }
    }
    return response
  }
  if (window === top) return
  const state = window.__returnOrientation = { uploads: [], draws: [], parameters: {}, recording: false, generation: 0 }
  const ids = new WeakMap(), slots = new Map(), bound = new Map(), attributes = new Map(), buffers = new Map()
  let next = 1, unit = 33984, vao = 0
  const id = object => object ? (ids.has(object) ? ids.get(object) : (ids.set(object, next), next++)) : 0
  const prototype = WebGL2RenderingContext.prototype
  function hook(name, observe) {
    const native = prototype[name]
    prototype[name] = function (...args) { observe.call(this, args); return native.apply(this, args) }
  }
  hook('activeTexture', args => { unit = args[0] })
  hook('bindTexture', args => { if (args[0] === 3553) slots.set(unit, id(args[1])) })
  hook('texParameteri', args => {
    if (args[0] === 3553) (state.parameters[slots.get(unit)] ||= {})[args[1]] = args[2]
  })
  hook('bindBuffer', args => bound.set(args[0], id(args[1])))
  hook('bindVertexArray', args => { vao = id(args[0]) })
  hook('vertexAttribPointer', args => {
    if (!attributes.has(vao)) attributes.set(vao, {})
    attributes.get(vao)[args[0]] = { size: args[1], type: args[2], stride: args[4], offset: args[5], buffer: bound.get(34962) }
  })
  for (const name of ['texSubImage2D', 'texImage2D']) hook(name, function (args) {
    const width = args[name === 'texImage2D' ? 3 : 4], height = args[name === 'texImage2D' ? 4 : 5], source = args[8]
    if (width !== 16 || height !== 16 || !ArrayBuffer.isView(source)) return
    const start = source.byteOffset + (args[9] || 0) * source.BYTES_PER_ELEMENT
    state.uploads.push({ texture: slots.get(unit), flipY: this.getParameter(this.UNPACK_FLIP_Y_WEBGL),
      bytes: [...new Uint8Array(source.buffer, start, width * height * 4)] })
  })
  hook('bufferSubData', args => {
    if (!state.recording || !ArrayBuffer.isView(args[2])) return
    const source = args[2], offset = (args[3] || 0) * source.BYTES_PER_ELEMENT
    const length = args[4] ? args[4] * source.BYTES_PER_ELEMENT : source.byteLength - offset
    const bytes = new Uint8Array(args[1] + length)
    bytes.set(new Uint8Array(source.buffer, source.byteOffset + offset, length), args[1])
    buffers.set(bound.get(args[0]), bytes)
  })
  hook('drawElements', args => {
    if (!state.recording) return
    const attrs = attributes.get(vao), bytes = buffers.get(attrs?.[0]?.buffer), vertices = []
    if (!bytes || !attrs?.[0]?.stride) return
    const view = new DataView(bytes.buffer), stride = attrs[0].stride
    // Tc's sprite batches submit six indices per four vertices. Attribute 0 is
    // world position, 2 is UV and 3 is the texture slot in the actual VAO.
    for (let index = 0; index < Math.min(bytes.length / stride, args[1] / 6 * 4); index++) {
      const vertex = {}
      for (const [attribute, layout] of Object.entries(attrs)) if (layout.type === 5126) {
        vertex[attribute] = Array.from({ length: layout.size }, (_, component) => view.getFloat32(index * stride + layout.offset + component * 4, true))
      }
      vertices.push(vertex)
    }
    state.draws.push({ vertices, slots: [...slots] })
  })
})
const wait = ms => page.waitForTimeout(ms)
const count = text => logs.filter(value => value.includes(text)).length
async function logAfter(text, before = 0, timeout = 15000) {
  const until = Date.now() + timeout
  while (count(text) <= before && Date.now() < until) { healthy(); await wait(20) }
  assert.ok(count(text) > before, `Expected ${text}: ${logs.slice(-15).join('\n')}`)
}
async function capture(label, expectedFacing, { screenshot = false, jumping = false } = {}) {
  healthy()
  const generation = await frame.evaluate(() => {
    const state = window.__returnOrientation, engine = window.TomCatWeb.engine, original = engine.PlayerFrame
    state.draws = []
    engine.PlayerFrame = function (...args) {
      state.recording = true
      try { return original.apply(this, args) }
      finally { state.recording = false; state.generation++; engine.PlayerFrame = original }
    }
    return state.generation
  })
  await frame.waitForFunction(value => window.__returnOrientation.generation > value, generation)
  const observed = await frame.evaluate(() => ({ draws: window.__returnOrientation.draws, uploads: window.__returnOrientation.uploads, parameters: window.__returnOrientation.parameters }))
  const uploads = observed.uploads.map(({ bytes, ...entry }) => ({ ...entry, sha256: sha256(Buffer.from(bytes)) }))
  const textureMap = new Map(uploads.map(upload => [upload.texture, upload]))
  const mipMap = new Map(expectedMips.map(mip => [mip.sha256, mip]))
  const characters = []
  for (const draw of observed.draws) {
    const slots = new Map(draw.slots)
    for (let index = 0; index + 3 < draw.vertices.length; index += 4) {
      const vertices = draw.vertices.slice(index, index + 4), upload = textureMap.get(slots.get(33984 + vertices[0][3]?.[0]))
      const mip = mipMap.get(upload?.sha256)
      if (!mip) continue
      assert.equal(upload.flipY, false, `${label}: OpenGL must upload cooked bottom-first bytes unchanged`)
      const sampling = observed.parameters[upload.texture]
      if (!legacyFlip) {
        assert.equal(sampling?.[10240], 9728, `${label}: original avatar magnification must use nearest filtering`)
        assert.equal(sampling?.[10241], 9728, `${label}: original avatar minification must use nearest filtering`)
        assert.equal(sampling?.[10242], 33071, `${label}: sprite U edge must clamp instead of leaking opposite-edge pixels`)
        assert.equal(sampling?.[10243], 33071, `${label}: sprite V edge must clamp instead of producing the reported white line`)
      }
      const average = (uv, component) => vertices.filter(vertex => Math.abs(vertex[2][component] - uv) < .001)
        .reduce((sum, vertex) => sum + vertex[0][component], 0) / 2
      const vertical = average(1, 1) - average(0, 1), horizontal = average(1, 0) - average(0, 0)
      const center = vertices.reduce((sum, vertex) => [sum[0] + vertex[0][0] / 4, sum[1] + vertex[0][1] / 4], [0, 0])
      characters.push({ ...mip, texture: upload.texture, sampling, vertical, horizontal, center, vertices })
    }
  }
  // Retain the rejected GPU vertices too, so the old-engine negative control
  // leaves concrete evidence rather than only an assertion message.
  captures.push({ label, expectedFacing, characters, uploads })
  for (const character of characters) assert.ok(character.vertical > .99 && character.vertical < 1.01,
    `${label}: ${character.animation} must remain upright, actual UV vertical extent ${character.vertical}`)
  const heroes = characters.filter(character => character.animation !== 'Dead')
  assert.equal(heroes.length, 1, `${label}: identify exactly one avatar by actual bound texture bytes`)
  assert.ok(Math.abs(heroes[0].horizontal - expectedFacing) < .01, `${label}: horizontal facing must match normal movement`)
  if (jumping) {
    assert.equal(heroes[0].animation, 'Fall', 'Jump must use an original airborne frame')
    assert.ok(heroes[0].vertices.some(vertex => vertex[0][1] > -5.8), 'Jump must leave the floor')
  }
  // Reloading or replacing texture content to compensate for a transform bug
  // must fail: every texture id keeps its originally uploaded bytes.
  for (const upload of uploads) {
    const previous = captures.flatMap(item => item.uploads).find(item => item.texture === upload.texture)
    if (previous) assert.equal(upload.sha256, previous.sha256, `${label}: texture ${upload.texture} changed bytes`)
  }
  if (screenshot) await canvas.screenshot({ path: `${output}/${label}.png` })
  console.log(JSON.stringify({ label, animation: heroes[0].animation, vertical: heroes[0].vertical, horizontal: heroes[0].horizontal }))
}
async function turn(key, label) {
  await page.keyboard.down(key)
  try { await wait(90); await capture(label, key === 'a' ? -1 : 1) }
  finally { await page.keyboard.up(key) }
}
try {
  const response = await page.request.get(`${base}/samples/return/manifest.json`)
  assert.ok(response.ok()); const manifest = await response.json()
  const packageResponse = await page.request.get(`${base}/samples/return/return.tcpak`)
  assert.ok(packageResponse.ok()); const bytes = await packageResponse.body()
  assert.equal(sha256(bytes), manifest.sha256); assert.equal(bytes.length, manifest.byteLength)
  provenance.publishedPackage = manifest
  const loadedBytes = fixture ? readFileSync(fixture.packagePath) : bytes
  const expectedPackage = fixture ? { sha256: fixture.manifest.packageSha256, byteLength: fixture.manifest.packageBytes, engineCommit: fixture.manifest.engineCommit } : manifest
  expectedMips = expectedSpriteMips(loadedBytes)
  provenance.package = expectedPackage
  await page.goto(`${base}/games/return`)
  await page.getByRole('button', { name: '开始游玩', exact: true }).first().click()
  await page.locator('.player-status').filter({ hasText: '已就绪' }).waitFor({ timeout: Number(process.env.TEST_BOOT_TIMEOUT || 180000) })
  await logAfter('[Return] ready', 0, Number(process.env.TEST_BOOT_TIMEOUT || 180000))
  frame = page.frames().find(candidate => candidate.url() === new URL('/engine-host.html', base).href); assert.ok(frame)
  canvas = frame.locator('canvas')
  provenance.loadedEngine = await readLoadedEngine(frame)
  provenance.loadedPackage = await page.evaluate(() => top.__returnPackage)
  assert.equal(provenance.loadedPackage?.sha256, expectedPackage.sha256, 'Actual loaded package must equal the selected verified package')
  assert.equal(provenance.loadedPackage.byteLength, expectedPackage.byteLength)
  const engine = provenance.loadedEngine.manifest
  assert.ok([engine.commit, ...(engine.legacyCommits || [])].includes(expectedPackage.engineCommit), 'Selected package must match the actual loaded engine ABI')
  renderer = await frame.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2'), extension = gl.getExtension('WEBGL_debug_renderer_info')
    return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown'
  })
  await page.getByRole('button', { name: '全屏游玩', exact: true }).click()
  await page.waitForFunction(() => !!document.fullscreenElement)
  await canvas.focus(); await page.keyboard.press('Enter'); await logAfter('[Return] stage:0'); await wait(500)
  await capture('initial', 1, { screenshot: true })
  await turn('a', 'left'); await turn('d', 'right')
  const beforePosition = captures.at(-1).characters.find(character => character.animation !== 'Dead').center[0]
  await turn('d', 'position-update-right')
  const afterPosition = captures.at(-1).characters.find(character => character.animation !== 'Dead').center[0]
  assert.ok(afterPosition > beforePosition + .1, 'Same-facing movement must exercise Position setters without a new Scale/Rotation write')
  for (let index = 0; index < 4; index++) { await turn('a', `repeat-${index}-left`); await turn('d', `repeat-${index}-right`) }
  const restart = count('[Return] restart')
  await page.keyboard.press('r'); await logAfter('[Return] restart', restart); await wait(150)
  await capture('restart', 1, { screenshot: true })
  // A direct browser screenshot crop keeps the original screen pixels. No
  // asset editing, reconstruction, or gameplay-state mutation is involved.
  const box = await canvas.boundingBox(), hero = captures.at(-1).characters.find(character => character.animation !== 'Dead')
  const center = hero.vertices.reduce((sum, vertex) => [sum[0] + vertex[0][0] / 4, sum[1] + vertex[0][1] / 4], [0, 0])
  const pixelScale = box.width / 30, clip = { x: Math.round(box.x + box.width / 2 + center[0] * pixelScale - 120),
    y: Math.round(box.y + box.height / 2 - center[1] * pixelScale - 100), width: 240, height: 140 }
  await page.screenshot({ path: `${output}/upright-avatar.png`, clip })
  const jump = count('[Return] jump')
  await page.keyboard.press('Space', { delay: 50 }); await logAfter('[Return] jump', jump)
  await capture('jump-right', 1, { jumping: true })
  await turn('a', 'jump-left'); await turn('d', 'jump-right-turn'); await wait(800)
  // Slow software rendering can keep movement held long enough to reach the
  // trap during capture. Begin this separate death leg from a known live realm.
  const deathRestart = count('[Return] restart'), deathStage = count('[Return] stage:0')
  await page.keyboard.press('r', { delay: 80 })
  await logAfter('[Return] restart', deathRestart)
  await logAfter('[Return] stage:0', deathStage)
  const death = count('[Return] realm:1')
  await page.keyboard.down('d')
  try { await logAfter('[Return] realm:1', death) } finally { await page.keyboard.up('d') }
  await capture('death-realm', 1, { screenshot: true })
  await turn('a', 'death-left'); await turn('d', 'death-right')
  const reset = count('[Return] restart')
  await page.keyboard.press('r'); await logAfter('[Return] restart', reset); await wait(150)
  await capture('restart-after-death', 1, { screenshot: true })
  healthy()
  assert.equal(productionReceipt(), productionTreeSha256, 'Orientation QA must not mutate production sources')
  assert.equal(sha256(readFileSync(`${root}/public/samples/return/return.tcpak`)), publishedPackageSha256, 'Orientation QA must not mutate the published package')
} catch (error) {
  failure = error
  if (canvas && frame && !frame.isDetached()) try { await canvas.screenshot({ path: `${output}/failure.png` }) } catch {}
} finally {
  const productionAfter = { treeSha256: productionReceipt(), packageSha256: sha256(readFileSync(`${root}/public/samples/return/return.tcpak`)) }
  productionAfter.unchanged = productionAfter.treeSha256 === productionTreeSha256 && productionAfter.packageSha256 === publishedPackageSha256
  if (!productionAfter.unchanged) failure = new Error('Orientation QA modified production source or package')
  expectedFailureObserved = expectLegacyFailure && !!failure?.message.match(/^right: .*must remain upright, actual UV vertical extent -/) &&
    captures.some(capture => capture.label === 'right' && capture.characters.some(character => character.animation !== 'Dead' && character.vertical < -.99)) &&
    productionAfter.unchanged && errors.length === 0 && !logs.some(value => fatal.test(value))
  if (expectLegacyFailure && !expectedFailureObserved) failure ||= new Error('The old-engine negative control did not reproduce the expected right-turn vertical flip')
  const evidence = { schema: 1, status: expectedFailureObserved ? 'expected-failure' : failure ? 'failed' : 'passed', failure: failure?.stack, startedAt,
    finishedAt: new Date().toISOString(), base, viewport, renderer, softwareGPURequested: softwareGPU, browser: browser.version(), provenance,
    productionTreeSha256, publishedPackageSha256, productionAfter, legacyFlip, expectLegacyFailure, expectedFailureObserved, expectedMips, captures, logs, errors,
    scope: `${legacyFlip ? 'Isolated copied Return project restores negative XY scale and Z-only rotation through actual generated managed Transform setters; production remains unchanged.' : 'Unmodified production Return package.'} Actual texture uploads and sprite-batch world vertices/UVs are observed. Ordinary A/D/R/Space input covers repeated turns, same-facing Position writes, restart, jump and tutorial realm transition. No QA keys or private gameplay-state writes. The tutorial corpse is hidden in the opposite realm; this run does not claim visible corpse coverage. Instrumentation runs are correctness checks, not performance measurements.` }
  writeFileSync(`${output}/evidence.json`, JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify({ status: evidence.status, output, captures: captures.length }, null, 2))
  await browser.close()
}
if (failure && !expectedFailureObserved) throw failure
