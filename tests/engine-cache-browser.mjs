import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { chromium } from 'playwright'
import { BLOB_CACHE, manifestPayload, sha256 } from '../public/engine-cache-core.mjs'

const commit = 'a'.repeat(40)
async function fixture(revision, text) {
  const contents = {
    'main.js': Buffer.from(`import { value } from './_framework/dotnet.js'; globalThis.cacheSmoke = [value, ${JSON.stringify(text)}]; const bytes = await (await fetch(new URL('./_framework/dotnet.native.wasm', import.meta.url))).arrayBuffer(); globalThis.cacheWasm = (await WebAssembly.compile(bytes)) instanceof WebAssembly.Module;`),
    '_framework/dotnet.js': Buffer.from('export const value = 42'),
    '_framework/dotnet.native.wasm': Buffer.from([0,97,115,109,1,0,0,0]),
    'refs/test.dll': Buffer.from('compiler reference'),
  }
  const transport = {}, files = []
  for (const [path, bytes] of Object.entries(contents)) {
    const parts = []
    // Tiny chunks deliberately exercise real browser gzip decoding/reassembly.
    for (let offset = 0, index = 0; offset < bytes.length; offset += 100, index++) {
      const part = path + `.part-${index}.gz`
      transport[part] = gzipSync(bytes.subarray(offset, offset + 100)); parts.push(part)
    }
    files.push({ path, size: bytes.length, sha256: await sha256(bytes), contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream', parts })
  }
  const manifest = { cacheSchema: 1, commit: revision, kind: 'managed', entry: 'main.js', framework: '_framework', refs: 'refs', refsList: ['test.dll'], files }
  manifest.hash = await sha256(new TextEncoder().encode(manifestPayload(manifest)))
  return { manifest, transport, contents }
}
let published = await fixture(commit, 'old'), corrupt = false, interrupted = false
const requests = []
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  response.setHeader('Cache-Control', 'no-store')
  if (path === '/engine-cache-sw.js' || path === '/engine-cache-core.mjs') {
    response.setHeader('Content-Type', 'text/javascript'); response.end(readFileSync('public' + path)); return
  }
  if (path.startsWith('/engine/')) {
    requests.push(path)
    if (path.endsWith('/manifest.json')) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(published.manifest)); return }
    if (interrupted) { response.destroy(); return }
    const file = path.split(`/engine/${published.manifest.commit}/`)[1]
    const body = published.transport[file]
    if (body) { response.setHeader('Content-Encoding', 'gzip'); response.end(corrupt ? gzipSync(Buffer.from('wrong')) : body); return }
    response.writeHead(404).end(); return
  }
  if (path.startsWith('/engine-cache/')) { response.writeHead(404).end(); return }
  response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Engine cache test</title>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext()
let page = await context.newPage()
async function prepare(revision = published.manifest.commit) {
  return page.evaluate(commit => new Promise(resolve => {
    const channel = new MessageChannel()
    channel.port1.onmessage = event => {
      if (event.data.type !== 'progress') { channel.port1.close(); resolve(event.data) }
    }
    navigator.serviceWorker.controller.postMessage({ type: 'tomcat-engine-prepare', commit }, [channel.port2])
  }), revision)
}
try {
  await page.goto(origin)
  await page.evaluate(() => navigator.serviceWorker.register('/engine-cache-sw.js', { type: 'module' }))
  await page.waitForFunction(() => navigator.serviceWorker.controller)
  const cold = await prepare()
  assert.equal(cold.type, 'ready', JSON.stringify(cold))
  assert.equal(cold.result.downloaded, 4)
  await page.evaluate(url => import(url + 'main.js'), cold.result.baseUrl)
  assert.deepEqual(await page.evaluate(() => cacheSmoke), [42, 'old'])
  assert.equal(await page.evaluate(() => cacheWasm), true)
  requests.length = 0
  await page.close(); page = await context.newPage(); await page.goto(origin)
  const warm = await prepare()
  assert.equal(warm.result.downloaded, 0)
  assert.deepEqual(requests, [`/engine/${commit}/manifest.json`])
  published = await fixture('b'.repeat(40), 'updated')
  requests.length = 0
  const update = await prepare()
  assert.equal(update.result.downloaded, 1)
  assert.equal(update.result.reused, 3)
  assert.ok(requests.slice(1).every(path => path.includes('/main.js.part-')))
  const oldBytes = await page.evaluate(async url => (await fetch(url + 'main.js')).text(), cold.result.baseUrl)
  assert.match(oldBytes, /old/)
  published = await fixture('c'.repeat(40), 'broken')
  corrupt = true
  assert.equal((await prepare()).type, 'error')
  assert.equal(await page.evaluate(async url => (await fetch(url)).status, `${origin}/engine-cache/${published.manifest.hash}/main.js`), 503)
  assert.equal(await page.evaluate(async url => (await fetch(url + 'main.js')).status, update.result.baseUrl), 200)
  corrupt = false; interrupted = true
  assert.equal((await prepare()).type, 'error')
  interrupted = false
  assert.equal((await prepare()).result.downloaded, 1)
  const hash = published.manifest.files.find(file => file.path === 'refs/test.dll').sha256
  await page.evaluate(async ({ name, hash, origin }) => (await caches.open(name)).put(`${origin}/engine-cache-blobs/${hash}`, new Response('corrupt')), { name: BLOB_CACHE, hash, origin })
  assert.equal((await prepare()).result.downloaded, 1)
  await context.setOffline(true)
  const offline = await prepare()
  assert.equal(offline.result.offline, true)
  assert.equal((await prepare('d'.repeat(40))).type, 'error')
  console.log('PASS: real Service Worker cold/warm, gzip chunks, nested modules + WASM, incremental update, atomic failure, repair and offline reuse')
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
