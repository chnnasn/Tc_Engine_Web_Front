import test from 'node:test'
import assert from 'node:assert/strict'
import { executeTool } from '../src/engine/automation.ts'
import { sceneDiff, fileDiff } from '../src/engine/semantic-diff.ts'
import { runFixedValidation, runtimePositions, validateRuntimeRequest } from '../src/engine/runtime-validation.ts'

const entity = (id, x = 0) => ({ id, name: 'Box', parentId: null, components: [{ id: '4', values: { '1': [x, 0, 0] } }] })
const snapshot = { name: 'Test', sceneHandle: '99', revision: 1, mode: 'edit', archive: '', entities: [entity('18446744073709551615')], schemas: [{ id: '4', label: 'Transform', properties: [{ id: '1', label: 'Position' }] }] }
test('semantic diff uses IDs and retains removals, zero, false and property labels', () => {
  const after = structuredClone(snapshot)
  after.entities[0].components[0].values['1'] = [5, 0, 0]
  const diff = sceneDiff(snapshot, after)
  assert.equal(diff.total, 1); assert.equal(diff.changes[0].entityId, '18446744073709551615')
  assert.equal(diff.changes[0].property, 'Position')
  assert.equal(sceneDiff(snapshot, { ...snapshot, entities: [] }).changes[0].after, null)
  assert.deepEqual(fileDiff({ files: { 'a.cs': 'a', 'b.cs': 'b' } }, { files: { 'a.cs': 'changed', 'c.cs': 'c' } }).map(c => c.change), ['modified', 'removed', 'added'])
  assert.throws(() => sceneDiff(snapshot, { ...snapshot, sceneHandle: 'other' }))
  assert.equal(sceneDiff(snapshot, after, 0).truncated, true)
})
test('batch edits make one transaction and stale, oversized or unknown operations never write', async () => {
  const calls = []
  const call = async (type, data) => { calls.push([type, data]); return type === 'snapshot' ? snapshot : { ...snapshot, revision: 2, entities: [...snapshot.entities, entity('2')] } }
  const args = { scene_version: '99:1', label: 'Group', operations: [{ op: 'entity.create', entityId: '2', name: 'Box' }, { op: 'component.add', entityId: '2', componentId: '4' }] }
  const run = arguments_ => executeTool({ requestId: 'batch', name: 'scene_apply_patch', arguments: arguments_ }, call, () => {})
  assert.equal((await run(args)).data.diff.total, 1)
  assert.equal(calls.filter(([type]) => type === 'transact').length, 1)
  assert.equal(calls[1][1].operations.length, 2)
  calls.length = 0
  for (const bad of [{ ...args, scene_version: '99:0' }, { ...args, operations: Array(129).fill(args.operations[0]) }, { ...args, operations: [{ op: 'scene.loadArchive', entityId: '2' }] }]) assert.equal((await run(bad)).ok, false)
  assert.ok(calls.every(([type]) => type === 'snapshot'))
})
test('task baseline survives multiple commands but never leaks into another context', async () => {
  const context = {}
  await executeTool({ name: 'editor_get_status', arguments: {} }, async () => snapshot, () => {}, context)
  const next = { ...snapshot, revision: 2, entities: [] }
  assert.equal((await executeTool({ name: 'scene_get_diff', arguments: {} }, async () => next, () => {}, context)).data.total, 1)
  assert.equal((await executeTool({ name: 'scene_get_diff', arguments: {} }, async () => next, () => {}, {})).data.total, 0)
})
const archive = y => `Entities:\n  - Entity: 18446744073709551615\n    Transform:\n      Translation: [0, ${y}, 0]\n`
test('runtime positions preserve uint64 IDs, reject aliases and handle missing/nonfinite positions', () => {
  assert.deepEqual(runtimePositions(archive(2), ['18446744073709551615', '2']), { '18446744073709551615': [0, 2, 0], '2': null })
  assert.equal(runtimePositions(archive('.nan'), ['18446744073709551615'])['18446744073709551615'], null)
  assert.throws(() => runtimePositions('Entities: [*missing]', ['1']))
})
const request = { scene_version: '99:1', steps: 30, sample_every: 10, checks: [{ entity_id: '18446744073709551615', axis: 'y', min: 0.9, max: 1.1, stable_tolerance: 0.02 }] }
test('fixed stepping returns failing assertions as evidence and always stops preview', () => {
  const commands = []; let frame = 0
  const rpc = (type, args) => { if (type === 'preview.snapshot') return { archive: archive(1), frames: frame }; commands.push(args.command); if (args.command === 'step') frame++ }
  const result = runFixedValidation(request, rpc)
  assert.equal(result.passed, true); assert.deepEqual(result.samples.map(s => s.step), [0, 10, 20, 30]); assert.equal(frame, 30)
  assert.deepEqual(commands.slice(0, 2), ['play', 'pause']); assert.equal(commands.at(-1), 'stop')
  assert.equal(runFixedValidation({ ...request, checks: [{ ...request.checks[0], min: 3, max: 4 }] }, rpc).passed, false)
  assert.throws(() => runFixedValidation(request, (type, args) => { if (type === 'preview.snapshot') throw new Error('read failed'); commands.push(args.command) }))
  assert.equal(commands.at(-1), 'stop')
  for (const bad of [{ ...request, steps: 601 }, { ...request, sample_every: 0 }, { ...request, checks: [] }, { ...request, checks: [{ ...request.checks[0], min: 3, max: 1 }] }]) assert.throws(() => validateRuntimeRequest(bad))
})
