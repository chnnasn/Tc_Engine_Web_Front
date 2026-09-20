import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EditorProtocol, EngineError, assertHandle } from '../src/engine/protocol.ts'
import { bootPlayer, shutdown } from '../src/engine/runtime.ts'
import { assertDocument, engineCommit, validFilePath } from '../src/engine/storage.ts'

test('uint64 boundaries remain exact strings through transactions and schemas', () => {
  const max = '18446744073709551615'
  assertHandle(max)
  for (const id of [Number(max), '-1', '01', '18446744073709551616', '1e3', '']) assert.throws(() => assertHandle(id))
  let request
  const protocol = new EditorProtocol(json => {
    request = JSON.parse(json)
    return JSON.stringify({ ...request, ok: true, result: { sceneHandle: max, revision: 3, selectedEntityId: max, schemas: [{ id: max }] } })
  })
  const value = protocol.transact({ sceneHandle: max, revision: 2, selectedEntityId: null }, 'patch', [{ op: 'component.patch', entityId: max, componentId: max, properties: { [max]: max } }])
  assert.equal(request.payload.operations[0].properties[max], max)
  assert.equal(value.schemas[0].id, max)
  assert.equal(request.payload.baseRevision, 2)
})
test('RPC rejects mismatched envelopes and preserves conflict errors', () => {
  const protocol = new EditorProtocol(json => {
    const request = JSON.parse(json)
    return JSON.stringify({ ...request, ok: false, error: { code: 'REVISION_CONFLICT', message: 'Changed' } })
  })
  assert.throws(() => protocol.request('scene.transact'), error => error instanceof EngineError && error.code === 'REVISION_CONFLICT')
  assert.throws(() => new EditorProtocol(() => '{"ok":true}').request('system.capabilities'), /mismatch/)
})
test('Player copies into grown heap and frees staging memory on failed boot', () => {
  let freed = false
  const module = {
    HEAPU8: new Uint8Array(1),
    _malloc() { this.HEAPU8 = new Uint8Array(64); return 8 },
    _free(pointer) { assert.equal(pointer, 8); freed = true },
    ccall(name) { return name.endsWith('_error') ? 'bad package' : 1 },
  }
  assert.throws(() => bootPlayer(module, new Uint8Array([1, 2, 3]), 800, 600), /bad package/)
  assert.deepEqual([...module.HEAPU8.slice(8, 11)], [1, 2, 3]); assert.equal(freed, true)
})
test('thread pool terminates even when native shutdown throws', () => {
  let terminated = false
  assert.throws(() => shutdown({ ccall() { throw new Error('shutdown failed') }, PThread: { terminateAllThreads() { terminated = true } } }, 'editor'))
  assert.equal(terminated, true)
})
test('project document validates pinned engine, uint64, base64 and file paths', () => {
  const document = { format: 'tomcat-engine-project', version: 1, engineCommit, sceneHandle: '18446744073709551615', archive: 'scene', files: { 'ProjectSettings/PlayerSettings.json': 'e30=' } }
  assertDocument(document)
  assert.throws(() => assertDocument({ ...document, engineCommit: 'old' }))
  assert.throws(() => assertDocument({ ...document, sceneHandle: 12 }))
  assert.throws(() => assertDocument({ ...document, files: { '../Project.tcproj': 'e30=' } }))
  assert.throws(() => assertDocument({ ...document, files: { 'Assets/WebImports/a.png': '***' } }))
  assert.equal(validFilePath('Assets/WebImports/..'), false)
  assert.equal(validFilePath('Assets/WebImports/a.png.tcmeta'), true)
})
