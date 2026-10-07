import test from 'node:test'
import assert from 'node:assert/strict'
import { BLOB_CACHE, VERSION_CACHE, createEngineCache, manifestPayload, sha256, validateManifest } from '../public/engine-cache-core.mjs'

const base = 'https://test.example/'
const commit = 'a'.repeat(40)
const encoder = new TextEncoder()
async function fixture(suffix = '', revision = commit) {
  const contents = { 'main.js': `export const version = '${suffix}'`, '_framework/dotnet.js': 'runtime', '_framework/dotnet.native.wasm': 'wasm', 'refs/test.dll': 'reference' }
  const files = await Promise.all(Object.entries(contents).map(async ([path, value]) => ({ path, size: encoder.encode(value).length, sha256: await sha256(encoder.encode(value)), contentType: 'application/octet-stream' })))
  const manifest = { cacheSchema: 1, commit: revision, kind: 'managed', entry: 'main.js', framework: '_framework', refs: 'refs', refsList: ['test.dll'], files }
  manifest.hash = await sha256(encoder.encode(manifestPayload(manifest)))
  return { manifest, contents }
}
function memoryStorage() {
  const stores = new Map()
  return { stores, async open(name) {
    if (!stores.has(name)) stores.set(name, new Map())
    const store = stores.get(name)
    return { async match(key) { return store.get(key)?.clone() }, async put(key, response) { store.set(key, response.clone()) }, async delete(key) { return store.delete(key) } }
  } }
}
async function harness() {
  const storage = memoryStorage()
  let published = await fixture(), failure = null, offline = false
  const requests = []
  const fetcher = async url => {
    requests.push(url)
    if (offline) throw new TypeError('offline')
    if (url.endsWith('/manifest.json')) return Response.json(published.manifest)
    const path = url.split(`/engine/${published.manifest.commit}/`)[1]
    return failure ? failure(path) : new Response(published.contents[path])
  }
  const cache = createEngineCache({ storage, fetcher, baseUrl: base })
  return { storage, requests, cache, get published() { return published }, publish(value) { published = value }, fail(fn) { failure = fn }, offline(value) { offline = value } }
}
test('cold install verifies complete version; warm open requests only the manifest', async () => {
  const h = await harness()
  const cold = await h.cache.prepare(commit)
  assert.equal(cold.downloaded, 4)
  assert.equal((await h.cache.serve(cold.baseUrl + 'main.js')).status, 200)
  h.requests.length = 0
  const warm = await h.cache.prepare(commit)
  assert.equal(warm.downloaded, 0)
  assert.equal(warm.reused, 4)
  assert.deepEqual(h.requests, [base + `engine/${commit}/manifest.json`])
})
test('new commit downloads only changed bytes; old version remains readable', async () => {
  const h = await harness()
  const old = await h.cache.prepare(commit)
  const next = await fixture('updated', 'b'.repeat(40))
  h.publish(next); h.requests.length = 0
  const result = await h.cache.prepare(next.manifest.commit)
  assert.equal(result.downloaded, 1); assert.equal(result.reused, 3)
  assert.equal(h.requests.length, 2)
  assert.notEqual(result.baseUrl, old.baseUrl)
  assert.equal(await (await h.cache.serve(old.baseUrl + 'main.js')).text(), "export const version = ''")
})
test('hash mismatch cannot activate a partial update; retry repairs and commits', async () => {
  const h = await harness()
  const old = await h.cache.prepare(commit)
  const next = await fixture('updated')
  h.publish(next); h.fail(() => new Response('corrupted'))
  await assert.rejects(h.cache.prepare(commit), /校验失败/)
  assert.equal((await h.cache.serve(base + `engine-cache/${next.manifest.hash}/main.js`)).status, 503)
  assert.equal((await h.cache.serve(old.baseUrl + 'main.js')).status, 200)
  const pointer = await (await h.storage.open(VERSION_CACHE)).match(base + `engine-cache-commits/${commit}`)
  assert.equal((await pointer.json()).hash, old.manifest.hash)
  h.fail(null)
  assert.equal((await h.cache.prepare(commit)).downloaded, 1)
})
test('network interruption and quota failure leave the previous complete version intact', async () => {
  const h = await harness()
  const old = await h.cache.prepare(commit)
  const next = await fixture('updated')
  h.publish(next); h.fail(() => { throw new TypeError('connection reset') })
  await assert.rejects(h.cache.prepare(commit), /下载失败/)
  h.fail(null)
  const open = h.storage.open.bind(h.storage)
  h.storage.open = async name => {
    const cache = await open(name)
    if (name === BLOB_CACHE) cache.put = async () => { throw new DOMException('full', 'QuotaExceededError') }
    return cache
  }
  await assert.rejects(h.cache.prepare(commit), /空间不足/)
  assert.equal((await h.cache.serve(old.baseUrl + 'main.js')).status, 200)
  assert.equal((await h.cache.serve(base + `engine-cache/${next.manifest.hash}/main.js`)).status, 503)
})
test('evicted and corrupted cached files are repaired individually, never served unchecked', async () => {
  const h = await harness()
  const old = await h.cache.prepare(commit)
  const file = old.manifest.files[0]
  const blobs = await h.storage.open(BLOB_CACHE)
  await blobs.put(base + `engine-cache-blobs/${file.sha256}`, new Response('bad'))
  assert.equal((await h.cache.serve(old.baseUrl + file.path)).status, 503)
  h.requests.length = 0
  assert.equal((await h.cache.prepare(commit)).downloaded, 1)
  assert.equal(h.requests.length, 2)
  await blobs.delete(base + `engine-cache-blobs/${file.sha256}`)
  assert.equal((await h.cache.prepare(commit)).downloaded, 1)
})
test('offline startup requires a complete, matching commit; no cross-version fallback', async () => {
  const h = await harness()
  await h.cache.prepare(commit)
  h.offline(true)
  assert.equal((await h.cache.prepare(commit)).offline, true)
  await assert.rejects(h.cache.prepare('b'.repeat(40)), /没有完整缓存/)
  const file = h.published.manifest.files[0]
  await (await h.storage.open(BLOB_CACHE)).delete(base + `engine-cache-blobs/${file.sha256}`)
  await assert.rejects(h.cache.prepare(commit), /缓存不完整/)
})
test('manifest digest, duplicate paths, traversal and required files are validated', async () => {
  for (const mutate of [m => { m.hash = '0'.repeat(64) }, m => { m.files.push(m.files[0]) }, m => { m.files[0].path = '../outside.js' }, m => { m.files[0].parts = ['https://other.example/a'] }, m => { m.files.pop() }]) {
    const { manifest } = await fixture()
    mutate(manifest)
    await assert.rejects(validateManifest(manifest, commit))
  }
})
