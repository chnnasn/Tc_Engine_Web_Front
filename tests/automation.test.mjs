import test from 'node:test'
import assert from 'node:assert/strict'
import { executeTool } from '../src/engine/automation.ts'
import { EngineError } from '../src/engine/protocol.ts'

const state = { sceneHandle: '18446744073709551615', revision: 7, mode: 'edit', dirty: false, entities: [], schemas: [] }
test('stale AI plan never invokes a write', async () => {
  const calls = []
  const result = await executeTool({ requestId: 'a', name: 'entity_create', arguments: { name: 'Player', scene_version: '18446744073709551615:6' } }, async type => { calls.push(type); return state }, () => {})
  assert.equal(result.error.code, 'SCENE_CHANGED')
  assert.deepEqual(calls, ['snapshot'])
})
test('native revision race is returned to AI without retry', async () => {
  const calls = []
  const result = await executeTool({ requestId: 'a', name: 'entity_create', arguments: { name: 'Player', scene_version: '18446744073709551615:7' } }, async (type, payload) => {
    calls.push(type)
    if (type === 'snapshot') return state
    assert.equal(payload.state.revision, 7)
    assert.equal(typeof payload.operations[0].entityId, 'string')
    throw new EngineError('REVISION_CONFLICT', 'Human edited meanwhile')
  }, () => {})
  assert.equal(result.error.code, 'SCENE_CHANGED')
  assert.deepEqual(calls, ['snapshot', 'transact'])
})
test('unsupported tools and runtime authoring cannot write', async () => {
  let calls = 0
  const call = async type => { calls++; assert.equal(type, 'snapshot'); return { ...state, mode: 'play' } }
  assert.equal((await executeTool({ requestId: 'a', name: 'scene_save', arguments: {} }, call, () => {})).error.code, 'UNSUPPORTED_TOOL')
  assert.equal(calls, 0)
  assert.equal((await executeTool({ requestId: 'b', name: 'entity_delete', arguments: { entity_id: '123' } }, call, () => {})).error.code, 'EDIT_MODE_REQUIRED')
  assert.equal(calls, 1)
})
