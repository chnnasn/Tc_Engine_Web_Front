import test from 'node:test'
import assert from 'node:assert/strict'
import { executeScriptTool, scriptExample } from '../src/engine/script-automation.ts'
import { attachScripts, editScriptAttachment, readScripts } from '../src/engine/scene-archive.ts'

const base = 'Scene: Test\nEntities:\n  - Entity: 18446744073709551615\n    Components:\n      - TypeId: 1\n        Properties: {}\n'
const id = '18446744073709551615'
function fixture() {
  let snapshot = { sceneHandle: '77', revision: 1, mode: 'edit', archive: base, entities: [{ id }] }
  let scripts = []
  const host = {
    snapshot: () => snapshot, scripts: () => scripts, installed: () => false,
    write: ({ path, text }) => { const old = scripts.find(s => s.path === path); scripts = [...scripts.filter(s => s.path !== path), { path, text, className: 'PlayerMovement', handle: old?.handle || id }]; return scripts.at(-1) },
    compile: async validate => { validate(); return { succeeded: true, restartRequired: false } },
    load: (_, archive) => snapshot = { ...snapshot, archive, revision: snapshot.revision + 1 },
  }
  return { host, change: value => snapshot = { ...snapshot, ...value } }
}
test('script authoring rejects stale sources, wrong scene, preview writes and path traversal', async () => {
  const { host, change } = fixture()
  const versions = await executeScriptTool('script_list', {}, host)
  const args = { ...versions, path: 'Assets/Scripts/PlayerMovement.cs', text: scriptExample }
  const saved = await executeScriptTool('script_write', args, host)
  assert.notEqual(saved.source_version, versions.source_version)
  await assert.rejects(executeScriptTool('script_write', args, host), { code: 'SOURCES_CHANGED' })
  assert.equal(host.scripts()[0].text, scriptExample)
  await assert.rejects(executeScriptTool('script_write', { ...saved, path: '../Escape.cs', text: '' }, host), { code: 'INVALID_ARGUMENT' })
  change({ revision: 2 })
  await assert.rejects(executeScriptTool('script_compile', saved, host), { code: 'SCENE_CHANGED' })
  change({ mode: 'play' })
  await assert.rejects(executeScriptTool('script_write', { ...saved, scene_version: '77:2', path: args.path, text: '' }, host), { code: 'EDIT_MODE_REQUIRED' })
})
test('compilation rechecks source and scene after asynchronous reference loading', async () => {
  const { host, change } = fixture()
  const versions = await executeScriptTool('script_list', {}, host)
  host.compile = async validate => { await Promise.resolve(); change({ revision: 2 }); validate(); assert.fail('stale compile must stop') }
  await assert.rejects(executeScriptTool('script_compile', versions, host), { code: 'SCENE_CHANGED' })
})
test('targeted attach/detach preserves exact existing fields, IDs and enabled state', () => {
  const first = { handle: '123', className: 'Existing', attachmentId: id }
  const archive = attachScripts(base, id, [first]).replace('Enabled: true', 'Enabled: false').replace('Fields: []', 'Fields:\n                - Name: Speed\n                  Value: 7.5')
  const appended = editScriptAttachment(archive, id, { handle: '456', className: 'PlayerMovement', attachmentId: '999' })
  assert.equal(readScripts(appended, id).length, 2)
  assert.ok(appended.includes('Enabled: false'))
  assert.ok(appended.includes('Value: 7.5'))
  assert.equal(editScriptAttachment(appended, id, '999'), archive)
  assert.equal(editScriptAttachment(appended, id, { handle: '456', className: 'PlayerMovement' }), appended)
  assert.equal(readScripts(editScriptAttachment(appended, id, first.attachmentId), id)[0].handle, '456')
})
test('script attach/read/detach uses string uint64 IDs and updated scene version', async () => {
  const { host } = fixture()
  const saved = await executeScriptTool('script_write', { ...await executeScriptTool('script_list', {}, host), path: 'Assets/Scripts/PlayerMovement.cs', text: scriptExample }, host)
  const attached = await executeScriptTool('script_attach', { ...saved, path: 'Assets/Scripts/PlayerMovement.cs', entity_id: id }, host)
  assert.equal(attached.scene_version, '77:2')
  assert.equal(attached.attachments[0].handle, id)
  const detached = await executeScriptTool('script_detach', { ...attached, entity_id: id, attachment_id: attached.attachments[0].attachmentId }, host)
  assert.deepEqual(detached.attachments, [])
  assert.equal(host.scripts().length, 1)
})
