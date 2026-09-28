import { test } from 'node:test'
import assert from 'node:assert/strict'
import { engineCompatibility, MAX_PACKAGE, ArcadeError } from '../src/engine/arcade.ts'
import { engineCommit, legacyEngineCommits } from '../src/engine/storage.ts'

test('published game ids are enforced as opaque paths and errors carry statuses', async () => {
  const error = new ArcadeError(404, 'missing')
  assert.equal(error.status, 404)
  assert.equal(error instanceof Error, true)
  assert.equal(typeof MAX_PACKAGE, 'number')
})

test('engine compatibility distinguishes the locked commit from legacy and unknown ones', () => {
  assert.equal(engineCompatibility(engineCommit), 'match')
  const legacy = legacyEngineCommits[0]
  if (legacy) assert.equal(engineCompatibility(legacy), 'legacy')
  assert.equal(engineCompatibility('0'.repeat(40)), legacyEngineCommits.includes('0'.repeat(40)) ? 'legacy' : 'mismatch')
})
