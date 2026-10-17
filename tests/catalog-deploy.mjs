import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const base = process.env.TEST_BASE_URL || 'https://www.tcfun.fun'
const lock = JSON.parse(readFileSync('engine.lock.json'))
const evidence = { base, at: new Date().toISOString(), resources: [], removedRoutes: [] }
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
async function request(path, options = {}) {
  for (let n = 0; n < 3; n++) {
    try { return await fetch(base + path, { ...options, signal: AbortSignal.timeout(60000) }) }
    catch (error) { if (n === 2) throw error }
  }
}
for (const id of ['return', 'shelter', 'rougelike', 'physics-lab']) {
  const files = [`${id}.tcpak`, id === 'shelter' ? 'gameplay.png' : 'cover.png']
  if (id !== 'physics-lab') files.push('manifest.json', `${id}-source.zip`)
  for (const file of files) {
    const path = `/samples/${id}/${file}`, response = await request(path)
    assert.equal(response.status, 200, path)
    const bytes = Buffer.from(await response.arrayBuffer())
    assert.equal(sha(bytes), sha(readFileSync('public' + path)), path)
    evidence.resources.push({ path, size: bytes.length, sha256: sha(bytes) })
    console.log(`Verified ${path}`)
  }
}
for (const id of ['forest', 'desert', 'puzzle']) {
  const response = await request(`/games/${id}`, { redirect: 'manual' })
  assert.equal(response.status, 404)
  assert.equal(response.headers.get('location'), null)
  evidence.removedRoutes.push({ id, status: response.status })
}
const manifestResponse = await request(`/engine/${lock.commit}/manifest.json`)
assert.equal(manifestResponse.status, 200)
const manifest = await manifestResponse.json()
assert.equal(manifest.commit, lock.commit)
assert.ok(manifest.files.length > 150 && manifest.files.every(file => file.parts?.length))
evidence.engine = { commit: manifest.commit, resources: manifest.files.length }
const health = await request('/health'); assert.equal(health.status, 200)
evidence.health = { status: health.status, body: await health.text() }
mkdirSync('.engine/catalog-qa', { recursive: true })
writeFileSync('.engine/catalog-qa/deploy-resources.json', JSON.stringify(evidence, null, 2))
console.log('Live asset hashes, removed routes, compressed engine manifest and backend health passed')
