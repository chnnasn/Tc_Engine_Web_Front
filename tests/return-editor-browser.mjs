// Restore the published Return ZIP into an isolated browser project, then use
// real native scene decoding, history and persistence to edit one Tilemap cell.
// Cells are not a generic component.patch property in this engine pin: the
// native scene.loadArchive transaction is used and its resulting archive checked.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, parseDocument } from 'yaml'
import { chromium } from 'playwright'
import { assertDocument } from '../src/engine/storage.ts'
import { engineState, engineRpc, nativeClick } from './engine-browser-helpers.mjs'
import { readLoadedEngine } from './engine-provenance.mjs'
import { productionReceipt, root } from './return-fixture.mjs'

const startedAt = new Date().toISOString()
const output = resolve(process.env.TEST_RETURN_EDITOR_OUTPUT || `${root}/.engine/return-editor-qa/${startedAt.replace(/[:.]/g, '-')}-${process.pid}`)
assert.ok(!existsSync(`${output}/evidence.json`), 'Never overwrite QA evidence')
mkdirSync(output, { recursive: true })
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5187'
const hash = value => createHash('sha256').update(value).digest('hex')
const sourceReceipt = productionReceipt(), testSha256 = hash(readFileSync(fileURLToPath(import.meta.url)))
const lock = JSON.parse(readFileSync(`${root}/engine.lock.json`, 'utf8'))
const projectId = 'return-native-editor-qa', scenePath = 'Assets/Scene/Levels/Level3.tomcat'
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true, args: ['--enable-webgl'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.setDefaultTimeout(30000)
const logs = [], errors = [], uploads = new Map(), snapshots = []
let savedManifest, failure, sourceArchive, loadedEngine, editedCell, nativeSchema, nativeInspector
page.on('console', message => logs.push(message.text()))
page.on('pageerror', error => errors.push(error.message))
page.on('dialog', dialog => dialog.accept())
await page.addInitScript(id => localStorage.setItem('tomcat-ui-projects-v2-engine-test', JSON.stringify([
  { id, name: 'Return 原生 Tilemap 编辑测试', description: '', template: '2D', image: '', status: 'draft', updated: '今天' },
])), projectId)
await page.route('**/v1/**', route => {
  const request = route.request(), path = new URL(request.url()).pathname
  const json = (value, headers = {}) => route.fulfill({ json: value, headers })
  if (path === '/v1/auth/me') return json({ id: 'engine-test', email: 'engine-test@example.com', emailVerified: true })
  if (path === '/v1/projects/sync-config') return json({ enabled: false })
  if (path === '/v1/projects' && request.method() === 'GET') return json([])
  if (path.endsWith('/ai-sessions/')) return json([])
  if (path.includes('/uploads/')) {
    const id = path.split('/').pop()
    if (request.method() === 'GET') return route.fulfill({ body: uploads.get(id), contentType: 'application/octet-stream' })
    const bytes = request.postDataBuffer(); uploads.set(id.slice(0, 32), bytes)
    return json({ uploadId: id.slice(0, 32), contentHash: id, size: bytes.length })
  }
  if (path.endsWith('/working-state')) return json(savedManifest, { etag: '"' + 'b'.repeat(32) + '"' })
  if (path.endsWith('/revisions')) {
    savedManifest = request.postDataJSON()
    return json({ etag: '"' + 'b'.repeat(32) + '"' }, { etag: '"' + 'b'.repeat(32) + '"' })
  }
  return json({ id: 'return-editor-cloud-fixture', currentRevisionId: savedManifest ? 'b'.repeat(32) : null, etag: savedManifest ? '"' + 'b'.repeat(32) + '"' : null })
})
const ready = () => page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '保存到云端' && !button.disabled), null, { timeout: 240000 })
async function snapshot(label) {
  const state = await engineState(page), value = await engineRpc(page, 'scene.snapshot', { sceneHandle: state.sceneHandle })
  writeFileSync(`${output}/${label}.tomcat`, value.archive)
  snapshots.push({ label, sceneHandle: value.sceneHandle, revision: value.revision, archiveSha256: hash(value.archive), dirty: value.dirty, canUndo: value.canUndo, canRedo: value.canRedo })
  return value
}
const decode = archive => parse(archive, { intAsBigInt: true })
const mapComponent = entity => entity.Components.find(component => component.StableName === 'TomCat.Tilemap2D')
const cellsOf = (archive, name) => mapComponent(decode(archive).Entities.find(entity => entity.Tag.Tag === name)).Properties.Cells
const cellIdentity = cell => `${cell.Coordinate[0]},${cell.Coordinate[1]}:${cell.SpriteHandle}`
async function history(direction, current) {
  return engineRpc(page, `history.${direction}`, { sceneHandle: current.sceneHandle, baseRevision: current.revision })
}
try {
  const response = await page.request.get(`${base}/samples/return/return-source.zip`)
  assert.ok(response.ok(), 'published editable source ZIP must be downloadable')
  const zip = await response.body()
  sourceArchive = { url: response.url(), bytes: zip.length, sha256: hash(zip) }
  // Read ZIP entries in memory. Only project/config/assets enter the isolated
  // browser; Reference and standalone Tools are deliberately not engine assets.
  const extracted = spawnSync(process.env.PYTHON || 'python', ['-c',
    'import sys,io,zipfile,json,base64\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\nf={}\nfor n in z.namelist():\n p=n.removeprefix("Return/")\n if not n.endswith("/") and (p=="Project.tcproj" or p.startswith("Assets/") or p.startswith("ProjectSettings/")):\n  f[p]=base64.b64encode(z.read(n)).decode("ascii")\nprint(json.dumps(f))'],
  { input: zip, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  assert.equal(extracted.status, 0, extracted.stderr)
  const files = JSON.parse(extracted.stdout), archive = Buffer.from(files[scenePath], 'base64').toString('utf8')
  const sceneHandle = /Handle: (\d+)/.exec(Buffer.from(files[scenePath + '.tcmeta'], 'base64').toString('utf8'))[1]
  const document = { format: 'tomcat-engine-project', version: 2, engineCommit: lock.commit, sceneHandle, archive, files }
  assertDocument(document)
  sourceArchive.projectFiles = Object.keys(files).length
  await page.goto(`${base}/projects`)
  await page.evaluate(async ({ id, document }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('tomcat-engine-v1', 2)
      request.onupgradeneeded = () => { for (const store of ['projects', 'cloudLinks']) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store) }
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('projects', 'readwrite'); transaction.objectStore('projects').put(document, id)
      transaction.oncomplete = resolve; transaction.onerror = transaction.onabort = () => reject(transaction.error)
    })
    db.close()
  }, { id: projectId, document })
  await page.goto(`${base}/editor/${projectId}`); await ready()
  const frame = page.frames().find(value => value.url() === new URL('/engine-host.html', base).href)
  assert.ok(frame, 'native editor iframe must exist')
  loadedEngine = await readLoadedEngine(frame)
  assert.ok([loadedEngine.manifest.commit, ...(loadedEngine.manifest.legacyCommits || [])].includes(document.engineCommit))
  let current = await snapshot('original')
  assert.equal(current.sceneHandle, sceneHandle)
  nativeSchema = current.schemas.find(schema => schema.name === 'TomCat.Tilemap2D')
  assert.ok(nativeSchema, 'the real loaded engine must expose native Tilemap2D schema')
  assert.ok(current.schemas.some(schema => schema.name === 'TomCat.TilemapRenderer2D'))
  assert.ok(!nativeSchema.properties.some(property => property.name === 'Cells'), 'this pin uses archive/palette cell editing, not a fabricated generic Cells property')
  const maps = decode(current.archive).Entities.filter(mapComponent)
  assert.ok(maps.length >= 2, 'Level3 source must retain multiple separate editable maps')
  const selected = maps.find(entity => entity.Tag.Visible && mapComponent(entity).Properties.Cells.length > 10)
  assert.ok(selected)
  const name = selected.Tag.Tag, originalCells = cellsOf(current.archive, name), originalIdentity = originalCells.map(cellIdentity)
  const cellIndex = originalCells.findIndex(cell => Number(cell.Coordinate[1]) === Math.min(...originalCells.map(value => Number(value.Coordinate[1]))))
  editedCell = { map: name, beforeCount: originalCells.length, removed: cellIdentity(originalCells[cellIndex]) }
  await engineRpc(page, 'scene.select', { sceneHandle, entityId: String(selected.Entity) })
  await page.screenshot({ path: `${output}/editor-original.png` })
  const modified = parseDocument(current.archive, { intAsBigInt: true })
  const entities = modified.get('Entities', true)
  const entityIndex = maps.length && decode(current.archive).Entities.findIndex(entity => entity.Tag.Tag === name)
  const components = entities.items[entityIndex].get('Components', true)
  const componentIndex = selected.Components.findIndex(component => component.StableName === 'TomCat.Tilemap2D')
  components.items[componentIndex].get('Properties', true).get('Cells', true).items.splice(cellIndex, 1)
  await engineRpc(page, 'scene.loadArchive', { sceneHandle, baseRevision: current.revision, archive: modified.toString() })
  current = await snapshot('one-cell-erased')
  assert.equal(cellsOf(current.archive, name).length, originalCells.length - 1)
  assert.ok(!cellsOf(current.archive, name).map(cellIdentity).includes(editedCell.removed))
  await history('undo', current); current = await snapshot('undo')
  assert.deepEqual(cellsOf(current.archive, name).map(cellIdentity), originalIdentity)
  await history('redo', current); current = await snapshot('redo')
  assert.equal(cellsOf(current.archive, name).length, originalCells.length - 1)
  await engineRpc(page, 'scene.persist')
  const stored = await frame.evaluate(path => window.TomCatWeb.runtime.Module.FS.readFile('/Samples/PhysicsPlayground/' + path, { encoding: 'utf8' }), scenePath)
  assert.equal(cellsOf(stored, name).length, originalCells.length - 1, 'native scene.persist must save the edited cell list')
  await engineRpc(page, 'scene.openAsset', { handle: '6200000000000020005' })
  await engineRpc(page, 'scene.openAsset', { handle: sceneHandle })
  current = await snapshot('reopened')
  assert.equal(cellsOf(current.archive, name).length, originalCells.length - 1)
  await page.getByRole('button', { name: '保存到云端', exact: true }).click()
  await page.getByText('已保存到数据库', { exact: true }).waitFor()
  await page.reload(); await ready()
  current = await snapshot('browser-reloaded')
  assert.equal(current.sceneHandle, sceneHandle)
  assert.equal(cellsOf(current.archive, name).length, originalCells.length - 1)
  await page.screenshot({ path: `${output}/editor-reopened.png` })
  if (process.env.TEST_RETURN_NATIVE_INSPECTOR === '1') {
    await engineRpc(page, 'scene.select', { sceneHandle, entityId: String(selected.Entity) })
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${output}/inspector-before-erase.png` })
    // First Cells row's native x button, observed at this fixed1600x1000 dock
    // layout. The archive assertions make an off-target click fail explicitly.
    await nativeClick(page, 1562, 682)
    current = await snapshot('native-inspector-erased')
    assert.equal(cellsOf(current.archive, name).length, originalCells.length - 2, 'native Inspector row delete must erase exactly one cell')
    await page.screenshot({ path: `${output}/inspector-erased.png` })
    await history('undo', current); current = await snapshot('native-inspector-undo')
    assert.equal(cellsOf(current.archive, name).length, originalCells.length - 1, 'native Inspector erase must participate in undo history')
    nativeInspector = { action: 'Native Inspector Cells first-row delete button, followed by native undo', deletedCells: 1, restoredCells: 1 }
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(logs.filter(value => /\[tomcat-host\] fail|Missing C# script asset|Unhandled exception|callback\s+\w+\s+threw|Deferred[^\r\n]*(?:aborted|failed)/i.test(value)), [])
  assert.equal(productionReceipt(), sourceReceipt, 'editor QA must never mutate the production project')
} catch (error) {
  failure = error
  try { await page.screenshot({ path: `${output}/failure.png` }) } catch {}
} finally {
  const evidence = { schema: 1, status: failure ? 'failed' : 'passed', failure: failure?.stack, startedAt, finishedAt: new Date().toISOString(), base,
    browser: browser.version(), testSha256, sourceReceipt, sourceArchive, loadedEngine, nativeSchema, editedCell, nativeInspector, snapshots, errors, logs,
    scope: 'Published ZIP restored into an isolated browser project. Native schema inspection, one cell erased through scene.loadArchive, native undo/redo, native scene.persist/openAsset, mocked-cloud save and browser reload. No production source writes or real cloud writes. This verifies archive editing/persistence; it does not claim mouse painting through Tile Palette UI.' }
  writeFileSync(`${output}/evidence.json`, JSON.stringify(evidence, null, 2))
  console.log(`Return native editor QA ${evidence.status}: ${output}`)
  await browser.close()
}
if (failure) throw failure
