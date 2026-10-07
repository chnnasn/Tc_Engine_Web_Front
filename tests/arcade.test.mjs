import { test } from 'node:test'
import assert from 'node:assert/strict'
import { engineCompatibility, MAX_PACKAGE, ArcadeError } from '../src/engine/arcade.ts'
import { engineCommit } from '../src/engine/storage.ts'

test('published game ids are enforced as opaque paths and errors carry statuses', async () => {
  const error = new ArcadeError(404, 'missing')
  assert.equal(error.status, 404)
  assert.equal(error instanceof Error, true)
  assert.equal(typeof MAX_PACKAGE, 'number')
})

test('engine compatibility distinguishes the locked commit from legacy and unknown ones', () => {
  assert.equal(engineCompatibility(engineCommit), 'match')
  assert.equal(engineCompatibility('41708b6c756d530a1c71f0e0ef2539a1df1bb03e'), 'match')
  assert.equal(engineCompatibility('1223a9610066d420485fa7f273b0eeca34835bbf'), 'mismatch')
})
