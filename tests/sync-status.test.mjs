import test from 'node:test'
import assert from 'node:assert/strict'
import { describeSync } from '../src/engine/sync-status.ts'
const local = { etag: '"a"', matches: true, changedDuringQuery: false, blocked: false }
test('a persisted cloud revision does not imply unsynced local edits are saved', () => {
  const result = describeSync({ ...local, matches: false }, { etag: '"a"', persisted: true })
  assert.equal(result.status, 'local_changes'); assert.equal(result.currentContentPersisted, false)
})
test('pending Redis snapshot, checkpoint persistence, conflicts and edits during query are distinct', () => {
  assert.equal(describeSync(local, { etag: '"a"', persisted: false }).status, 'synced_pending_persistence')
  assert.equal(describeSync(local, { etag: '"a"', persisted: true }).currentContentPersisted, true)
  assert.equal(describeSync(local, { etag: '"other"', persisted: true }).status, 'conflict')
  assert.equal(describeSync({ ...local, changedDuringQuery: true }, { etag: '"a"', persisted: true }).currentContentPersisted, false)
})
