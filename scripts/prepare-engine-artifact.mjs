import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { manifestPayload, sha256, validateManifest } from '../public/engine-cache-core.mjs'

// A history rewrite is not a new binary build. Preserve the original build
// identity while binding verified, source-equivalent bytes to the current pin.
// legacyCommits is deliberately NOT an artifact reuse allowlist.
export async function prepareEngineArtifact(directory, lock) {
  const path = join(directory, 'manifest.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  const reuse = lock.artifactReuse
  const migrating = manifest.commit !== lock.commit
  if (manifest.kind !== lock.kind || manifest.protocol !== lock.protocol ||
      (migrating && (!reuse || reuse.targetCommit !== lock.commit || manifest.commit !== reuse.sourceCommit))) {
    throw new Error('Engine artifact does not match the locked source or its explicit history rewrite')
  }
  await validateManifest(manifest, manifest.commit)
  // Verify every original byte before changing any metadata. Downloads must
  // contain the original bundle, not just compressed deployment transport.
  for (const file of manifest.files) {
    const bytes = readFileSync(join(directory, file.path))
    if (bytes.length !== file.size || await sha256(bytes) !== file.sha256) {
      throw new Error(`Engine artifact SHA-256 mismatch: ${file.path}`)
    }
  }
  if (migrating) {
    manifest.provenance = {
      builtFromCommit: manifest.commit,
      originalManifestHash: manifest.hash,
      equivalentCommit: reuse.equivalentCommit,
      sourceTree: reuse.sourceTree,
      reason: 'Upstream history rewrite followed only by documentation changes',
    }
    manifest.commit = lock.commit
  }
  manifest.legacyCommits = lock.legacyCommits
  manifest.hash = await sha256(new TextEncoder().encode(manifestPayload(manifest)))
  await validateManifest(manifest, lock.commit)
  writeFileSync(path, JSON.stringify(manifest))
  return manifest
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const lock = JSON.parse(readFileSync('engine.lock.json', 'utf8'))
  const manifest = await prepareEngineArtifact(process.argv[2] || `public/engine/${lock.commit}`, lock)
  console.log(`Verified engine ${manifest.commit}; built from ${manifest.provenance?.builtFromCommit || manifest.commit}`)
}
