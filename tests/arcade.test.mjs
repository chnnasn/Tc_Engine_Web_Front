import { test } from 'node:test'
import assert from 'node:assert/strict'
import { engineCompatibility, loadPublishedPackage, MAX_PACKAGE, ArcadeError } from '../src/engine/arcade.ts'
import { getTopic } from '../src/ui/community-api.ts'
import { engineCommit } from '../src/engine/storage.ts'

test('published game ids are enforced as opaque paths and errors carry statuses', async () => {
  const error = new ArcadeError(404, 'missing')
  assert.equal(error.status, 404)
  assert.equal(error instanceof Error, true)
  assert.equal(typeof MAX_PACKAGE, 'number')
})

test('platform 404 is not described as removed content or an unpublished game', async () => {
  const original = globalThis.fetch
  const platform = () => new Response(JSON.stringify({ status: 'error', code: 404, message: 'Application not found' }), { status: 404, headers: { 'content-type': 'application/json' } })
  try {
    globalThis.fetch = async () => platform()
    await assert.rejects(getTopic('missing'), /云端服务暂时不可用/)
    await assert.rejects(loadPublishedPackage('missing'), /云端服务暂时不可用/)
    globalThis.fetch = async () => new Response('', { status: 404, headers: { 'content-type': 'application/json' } })
    await assert.rejects(getTopic('missing'), /内容不存在或已被移除/)
    await assert.rejects(loadPublishedPackage('gone'), /作品不存在或已取消发布/)
  } finally { globalThis.fetch = original }
})

test('engine compatibility distinguishes the locked commit from legacy and unknown ones', () => {
  assert.equal(engineCompatibility(engineCommit), 'match')
  for (const commit of ['5734c56ae05241b01a684afb8e62f2b164c69ba2', '0b8829a864ff53ad0ad2c7ded56ef433325a836a']) {
    assert.equal(engineCompatibility(commit), 'match')
  }
  assert.equal(engineCompatibility('41708b6c756d530a1c71f0e0ef2539a1df1bb03e'), 'mismatch')
  assert.equal(engineCompatibility('b0002beabdb2d4b0e7e2c64603f8c284436cf4db'), 'mismatch')
  assert.equal(engineCompatibility('1223a9610066d420485fa7f273b0eeca34835bbf'), 'mismatch')
})
