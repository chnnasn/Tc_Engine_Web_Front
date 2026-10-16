import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { validatePackage, handles } from '../scripts/build-rougelike.mjs'
import { games } from '../src/ui/data.ts'

test('homepage Rougelike ships a complete verified native Tc package for the pinned engine', () => {
  const game = games.find(game => game.id === 'rougelike')
  assert.ok(game?.packageUrl && game.sourceUrl)
  const bytes = readFileSync(new URL(`../public${game.packageUrl}`, import.meta.url))
  const manifest = JSON.parse(readFileSync(new URL('../public/samples/rougelike/manifest.json', import.meta.url)))
  const lock = JSON.parse(readFileSync(new URL('../engine.lock.json', import.meta.url)))
  assert.equal(validatePackage(bytes), manifest.entries)
  assert.equal(bytes.length, manifest.byteLength)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256)
  assert.equal(manifest.engineCommit, lock.commit)
  // Audio and both source fonts must be in the shipped bundle, not only on disk.
  assert.ok(manifest.entries >= Object.keys(handles).length - 1)
  const corrupt = Buffer.from(bytes)
  corrupt[corrupt.length - 1] ^= 1
  assert.throws(() => validatePackage(corrupt), /hash mismatch/)
})

test('downloadable example includes its editable scene and all three special skills', () => {
  const zip = readFileSync(new URL('../public/samples/rougelike/rougelike-source.zip', import.meta.url))
  assert.equal(zip.readUInt32LE(0), 0x04034b50)
  for (const path of ['Rougelike/Project.tcproj', 'Rougelike/Assets/Scene/rougelike.tomcat', 'Rougelike/Assets/Scripts/RougelikeGame.cs', 'Rougelike/Assets/Audio/Welcome.wav']) {
    assert.ok(zip.includes(Buffer.from(path)), `missing source archive entry: ${path}`)
  }
  const source = readFileSync(new URL('../samples/rougelike/Assets/Scripts/RougelikeGame.cs', import.meta.url), 'utf8')
  assert.ok(zip.includes(Buffer.from(source)), 'source download is stale; rebuild engine:rougelike')
})
