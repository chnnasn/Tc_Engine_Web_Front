import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { saveCloudProject } from '../src/engine/cloud.ts'
import { assertDocument, engineCommit, requiredFiles } from '../src/engine/storage.ts'
const document = {format:'tomcat-engine-project',version:2,engineCommit,sceneHandle:'18446744073709551615',archive:'Scene: example',files:Object.fromEntries(requiredFiles.map(path=>[path,btoa('{}')]))}
const binding={ownerId:'alice',projectId:'project',etag:'"previous"',pending:true}
const json = (value,status=200,headers={}) => new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}})
test('checkpoint writes are immediate conditional revisions with durable task metadata', async () => {
  const original = globalThis.fetch
  const checkpoint = { runId: 'c'.repeat(32), phase: 'start', sceneVersion: '1:3' }
  try {
    await assert.rejects(saveCloudProject(document, binding, { automatic: true, checkpoint }), /立即落库/)
    globalThis.fetch = async (path, init) => {
      if (path === '/v1/auth/me') return json({ id: 'alice' })
      if (path.includes('/uploads/')) return json({ uploadId: 'a'.repeat(32), contentHash: path.split('/').pop(), size: 2 })
      assert.ok(path.endsWith('/revisions')); assert.equal(init.headers['If-Match'], binding.etag)
      assert.deepEqual(JSON.parse(init.body).aiCheckpoint, checkpoint)
      return json({ etag: '"' + 'b'.repeat(32) + '"' }, 201, { etag: '"' + 'b'.repeat(32) + '"' })
    }
    await saveCloudProject(document, binding, { checkpoint })
  } finally { globalThis.fetch = original }
})
test('complete bundle rejects missing configs, images without metadata and orphan metadata',()=>{
  assertDocument(document)
  for(const files of [{...document.files,'Assets/test.png':btoa('image')},{...document.files,'Assets/test.png.tcmeta':btoa('meta')},{}]) assert.throws(()=>assertDocument({...document,files}))
})
test('cloud save never creates a revision after partial upload or wrong account',async()=>{
  const original=globalThis.fetch
  try {
    let requests=[]
    globalThis.fetch=async(path)=>{requests.push(path);if(path==='/v1/auth/me')return json({id:'alice'});throw new Error('network failure')}
    await assert.rejects(saveCloudProject(document,binding),/无法连接云端/)
    assert.ok(requests.length >= 2 && requests.length <= 5);assert.equal(requests.some(path=>path.endsWith('/revisions')),false)
    requests=[];globalThis.fetch=async(path)=>{requests.push(path);return json({id:'bob'})}
    await assert.rejects(saveCloudProject(document,binding),/其他云端账号/);assert.equal(requests.length,1)
  } finally {globalThis.fetch=original}
})
test('412 preserves caller ETag without retrying against server current revision',async()=>{
  const original=globalThis.fetch;let revisions=0
  try {
    globalThis.fetch=async(path,init)=>{
      if(path==='/v1/auth/me')return json({id:'alice'})
      if(path.includes('/uploads/'))return json({uploadId:'a'.repeat(32),contentHash:path.split('/').pop(),size:2})
      revisions++;assert.equal(init.headers['If-Match'],'"previous"')
      return json({},412,{etag:'"server-new"'})
    }
    await assert.rejects(saveCloudProject(document,binding),error=>error.status===412)
    assert.equal(revisions,1);assert.equal(binding.etag,'"previous"');assert.equal(binding.pending,true)
  } finally {globalThis.fetch=original}
})

test('automatic sync reuses uploaded bytes and submits a conditional working snapshot', async () => {
  const original = globalThis.fetch
  let uploads = 0, snapshots = 0
  try {
    globalThis.fetch = async (path, init) => {
      if (path === '/v1/auth/me') return json({ id: 'alice' })
      if (path.includes('/uploads/by-hash/')) return json({ uploadId: 'a'.repeat(32), contentHash: path.split('/').pop(), size: 2 })
      if (path.includes('/uploads/')) { uploads++; throw new Error('Existing bytes must not be uploaded again') }
      assert.ok(path.endsWith('/working-state')); assert.equal(init.method, 'PUT'); assert.equal(init.headers['If-Match'], binding.etag)
      assert.equal(JSON.parse(init.body).archive, document.archive); snapshots++
      return json({ etag: '"' + 'b'.repeat(32) + '"' }, 202, { etag: '"' + 'b'.repeat(32) + '"' })
    }
    const saved = await saveCloudProject(document, binding, { automatic: true, reuseUploads: true })
    assert.equal(uploads, 0); assert.equal(snapshots, 1); assert.equal(saved.pending, false)
    assert.equal(binding.etag, '"previous"')
  } finally { globalThis.fetch = original }
})

test('Project authoring preserves empty folders and accepts native asset names safely', () => {
  const changed = { ...document, directories: ['Assets/空目录', 'Assets/New Folder'], files: { ...document.files, 'Assets/New Folder/场景.tcscene': btoa('scene') } }
  assertDocument(changed)
  for (const directories of [['Assets/../bad'], ['Assets/bad\\name'], ['Assets/with.'], [3], ['Assets/New Folder', 'Assets/new folder'], ['Assets/New Folder/场景.tcscene']]) {
    assert.throws(() => assertDocument({ ...changed, directories }))
  }
  assert.throws(() => assertDocument({ ...changed, files: { ...changed.files, 'Assets/New Folder': btoa('file') } }))
})

const bundle = {
  ...document,
  files: Object.fromEntries([...requiredFiles, ...Array.from({ length: 6 }, (_, i) => `Assets/file-${i}.txt`)]
    .map((path, i) => [path, Buffer.from([0, 127, 128, 255, i]).toString('base64')])),
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const settled = () => new Promise(resolve => setTimeout(resolve, 1))
async function until(condition) {
  const deadline = Date.now() + 2000
  while (!condition()) { assert.ok(Date.now() < deadline, 'asynchronous upload made no progress'); await settled() }
}
const receipt = (path, bytes) => ({ uploadId: path.split('/').pop().slice(0, 32), contentHash: digest(bytes), size: bytes.length })

test('save bounds uploads to four and preserves every binary file in manifest order despite reversed responses', async () => {
  const original = globalThis.fetch, pending = [], sent = new Map()
  let active = 0, maximum = 0, manifest, completed = 0
  try {
    globalThis.fetch = async (path, init) => {
      if (path === '/v1/auth/me') return json({ id: 'alice' })
      if (path.includes('/uploads/')) {
        const bytes = Buffer.from(init.body), hash = path.split('/').pop()
        assert.equal(hash, digest(bytes)); sent.set(hash, bytes)
        active++; maximum = Math.max(maximum, active)
        return new Promise(resolve => pending.push(() => { active--; completed++; resolve(json(receipt(path, bytes))) }))
      }
      assert.equal(active, 0); assert.equal(completed, Object.keys(bundle.files).length)
      assert.ok(path.endsWith('/revisions')); assert.equal(init.headers['If-Match'], binding.etag)
      manifest = JSON.parse(init.body)
      return json({ etag: '"' + 'b'.repeat(32) + '"' }, 201, { etag: '"' + 'b'.repeat(32) + '"' })
    }
    const saving = saveCloudProject(bundle, binding)
    await until(() => pending.length === 4)
    assert.equal(active, 4); assert.equal(manifest, undefined)
    pending.pop()() // Finish the fourth file first; the manifest must not follow completion order.
    await until(() => pending.length === 4)
    assert.equal(completed, 1); assert.equal(maximum, 4)
    while (completed < Object.keys(bundle.files).length) {
      if (pending.length) pending.pop()()
      else await settled()
    }
    const saved = await saving
    assert.equal(maximum, 4); assert.equal(saved.pending, false); assert.equal(binding.pending, true)
    assert.deepEqual(manifest.files.map(file => file.path), Object.keys(bundle.files))
    for (const file of manifest.files) {
      const bytes = Buffer.from(bundle.files[file.path], 'base64')
      assert.deepEqual(sent.get(file.contentHash), bytes)
      assert.equal(file.size, bytes.length); assert.equal(file.contentHash, digest(bytes))
    }
  } finally { globalThis.fetch = original }
})

test('failed upload stops scheduling, drains in-flight requests and never commits or advances caller binding', async () => {
  const original = globalThis.fetch, pending = []
  let starts = 0, revisions = 0, finished = false
  try {
    globalThis.fetch = async (path, init) => {
      if (path === '/v1/auth/me') return json({ id: 'alice' })
      if (path.includes('/uploads/')) {
        starts++; const bytes = Buffer.from(init.body)
        return new Promise(resolve => pending.push({ fail: () => resolve(json({ error: 'rejected upload' }, 500)), pass: () => resolve(json(receipt(path, bytes))) }))
      }
      revisions++; throw new Error('partial files must never produce a revision')
    }
    const saving = saveCloudProject(bundle, binding).then(() => { finished = true; throw new Error('save must fail') }, error => { finished = true; return error })
    await until(() => pending.length === 4)
    pending[0].fail()
    await new Promise(resolve => setTimeout(resolve, 15))
    assert.equal(finished, false, 'the save lock must remain held until outstanding uploads settle')
    assert.equal(starts, 4); assert.equal(revisions, 0)
    for (const upload of pending.slice(1)) upload.pass()
    const error = await saving
    assert.match(error.message, /rejected upload/)
    assert.equal(starts, 4); assert.equal(revisions, 0)
    assert.equal(binding.etag, '"previous"'); assert.equal(binding.pending, true)
  } finally { globalThis.fetch = original }
})

test('corrupt upload receipts prevent revisions for each integrity field', async () => {
  const original = globalThis.fetch
  try {
    for (const corrupt of [{ contentHash: '0'.repeat(64) }, { size: 1000 }, { uploadId: 'not-an-id' }]) {
      let revisions = 0
      globalThis.fetch = async (path, init) => {
        if (path === '/v1/auth/me') return json({ id: 'alice' })
        if (path.includes('/uploads/')) return json({ ...receipt(path, Buffer.from(init.body)), ...corrupt })
        revisions++; throw new Error('invalid upload receipt must not commit')
      }
      await assert.rejects(saveCloudProject(bundle, binding), /云端上传校验失败/)
      assert.equal(revisions, 0); assert.equal(binding.etag, '"previous"')
    }
  } finally { globalThis.fetch = original }
})

test('bounded workers can reuse existing hashes and upload only missing files before a working snapshot', async () => {
  const original = globalThis.fetch, entries = Object.entries(bundle.files)
  const existing = new Set(entries.filter((_, i) => i % 2 === 0).map(([, encoded]) => digest(Buffer.from(encoded, 'base64'))))
  let puts = 0, reads = 0, snapshots = 0
  try {
    globalThis.fetch = async (path, init) => {
      if (path === '/v1/auth/me') return json({ id: 'alice' })
      const hash = path.split('/').pop()
      if (path.includes('/uploads/by-hash/')) {
        reads++
        return existing.has(hash) ? json({ uploadId: hash.slice(0, 32), contentHash: hash, size: 5 }) : json({}, 404)
      }
      if (path.includes('/uploads/')) { assert.ok(!existing.has(hash)); puts++; return json(receipt(path, Buffer.from(init.body))) }
      assert.ok(path.endsWith('/working-state')); assert.equal(init.method, 'PUT')
      assert.equal(reads, entries.length); assert.equal(puts, entries.length - existing.size)
      assert.deepEqual(JSON.parse(init.body).files.map(file => file.path), entries.map(([path]) => path)); snapshots++
      return json({ etag: '"' + 'b'.repeat(32) + '"' }, 202, { etag: '"' + 'b'.repeat(32) + '"' })
    }
    await saveCloudProject(bundle, binding, { automatic: true, reuseUploads: true })
    assert.equal(snapshots, 1)
  } finally { globalThis.fetch = original }
})
