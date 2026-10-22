import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { prepareEngineArtifact } from '../scripts/prepare-engine-artifact.mjs'
import { manifestPayload, sha256, validateManifest } from '../public/engine-cache-core.mjs'

const lock = JSON.parse(readFileSync(new URL('../engine.lock.json', import.meta.url)))
async function fixture(t, commit = lock.artifactReuse.sourceCommit) {
  const directory = mkdtempSync(join(tmpdir(), 'tomcat-artifact-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const files = []
  for (const path of ['main.js', '_framework/dotnet.js', '_framework/dotnet.native.wasm', 'refs/test.dll']) {
    const bytes = Buffer.from(path)
    mkdirSync(dirname(join(directory, path)), { recursive: true })
    writeFileSync(join(directory, path), bytes)
    files.push({ path, size: bytes.length, sha256: await sha256(bytes), contentType: 'application/octet-stream' })
  }
  const manifest = { commit, kind: lock.kind, protocol: lock.protocol, cacheSchema: 1,
    entry: 'main.js', framework: '_framework', refs: 'refs', refsList: ['test.dll'], files, builtAt: 'original-build-time' }
  manifest.hash = await sha256(new TextEncoder().encode(manifestPayload(manifest)))
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest))
  return { directory, manifest }
}

test('history rewrite verifies bytes, retains build provenance and is idempotent', async t => {
  const { directory, manifest } = await fixture(t)
  const result = await prepareEngineArtifact(directory, lock)
  await validateManifest(result, lock.commit)
  assert.equal(result.provenance.builtFromCommit, manifest.commit)
  assert.equal(result.provenance.originalManifestHash, manifest.hash)
  assert.equal(result.builtAt, manifest.builtAt)
  assert.deepEqual(result.files, manifest.files)
  assert.deepEqual(result.legacyCommits, lock.legacyCommits)
  assert.deepEqual(await prepareEngineArtifact(directory, lock), result)
})

test('current builds verify without inventing rewrite provenance', async t => {
  const { directory } = await fixture(t, lock.commit)
  assert.equal((await prepareEngineArtifact(directory, lock)).provenance, undefined)
})

test('corrupt or incomplete bundles fail before the manifest changes', async t => {
  for (const missing of [false, true]) {
    const { directory } = await fixture(t)
    const original = readFileSync(join(directory, 'manifest.json'), 'utf8')
    if (missing) rmSync(join(directory, 'main.js'))
    else writeFileSync(join(directory, 'main.js'), 'corrupt')
    await assert.rejects(prepareEngineArtifact(directory, lock))
    assert.equal(readFileSync(join(directory, 'manifest.json'), 'utf8'), original)
  }
})

test('project compatibility never grants artifact equivalence; future pins require new evidence', async t => {
  const { directory } = await fixture(t, lock.legacyCommits.at(-1))
  await assert.rejects(prepareEngineArtifact(directory, lock), /explicit history rewrite/)
  const original = await fixture(t)
  await assert.rejects(prepareEngineArtifact(original.directory, { ...lock, commit: 'a'.repeat(40) }), /explicit history rewrite/)
  await assert.rejects(prepareEngineArtifact(original.directory, { ...lock, protocol: 'other' }), /explicit history rewrite/)
})
