import test from 'node:test'
import assert from 'node:assert/strict'
import { saveCloudProject } from '../src/engine/cloud.ts'
import { assertDocument, engineCommit, requiredFiles } from '../src/engine/storage.ts'
const document = {format:'tomcat-engine-project',version:2,engineCommit,sceneHandle:'18446744073709551615',archive:'Scene: example',files:Object.fromEntries(requiredFiles.map(path=>[path,btoa('{}')]))}
const binding={ownerId:'alice',projectId:'project',etag:'"previous"',pending:true}
const json = (value,status=200,headers={}) => new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}})
test('complete bundle rejects missing configs, images without metadata and orphan metadata',()=>{
  assertDocument(document)
  for(const files of [{...document.files,'Assets/test.png':btoa('image')},{...document.files,'Assets/test.png.tcmeta':btoa('meta')},{}]) assert.throws(()=>assertDocument({...document,files}))
})
test('cloud save never creates a revision after partial upload or wrong account',async()=>{
  const original=globalThis.fetch
  try {
    let requests=[]
    globalThis.fetch=async(path)=>{requests.push(path);if(path==='/v1/auth/me')return json({id:'alice'});throw new Error('network failure')}
    await assert.rejects(saveCloudProject(document,binding),/无法连接云端/)
    assert.equal(requests.length,2);assert.equal(requests.some(path=>path.endsWith('/revisions')),false)
    requests=[];globalThis.fetch=async(path)=>{requests.push(path);return json({id:'bob'})}
    await assert.rejects(saveCloudProject(document,binding),/其他云端账号/);assert.equal(requests.length,1)
  } finally {globalThis.fetch=original}
})
test('412 preserves caller ETag without retrying against server current revision',async()=>{
  const original=globalThis.fetch;let revisions=0
  try {
    globalThis.fetch=async(path,init)=>{
      if(path==='/v1/auth/me')return json({id:'alice'})
      if(path.includes('/uploads/'))return json({uploadId:'a'.repeat(32),contentHash:path.split('/').pop(),size:2})
      revisions++;assert.equal(init.headers['If-Match'],'"previous"')
      return json({},412,{etag:'"server-new"'})
    }
    await assert.rejects(saveCloudProject(document,binding),error=>error.status===412)
    assert.equal(revisions,1);assert.equal(binding.etag,'"previous"');assert.equal(binding.pending,true)
  } finally {globalThis.fetch=original}
})

test('automatic sync reuses uploaded bytes and submits a conditional working snapshot', async () => {
  const original = globalThis.fetch
  let uploads = 0, snapshots = 0
  try {
    globalThis.fetch = async (path, init) => {
      if (path === '/v1/auth/me') return json({ id: 'alice' })
      if (path.includes('/uploads/by-hash/')) return json({ uploadId: 'a'.repeat(32), contentHash: path.split('/').pop(), size: 2 })
      if (path.includes('/uploads/')) { uploads++; throw new Error('Existing bytes must not be uploaded again') }
      assert.ok(path.endsWith('/working-state')); assert.equal(init.method, 'PUT'); assert.equal(init.headers['If-Match'], binding.etag)
      assert.equal(JSON.parse(init.body).archive, document.archive); snapshots++
      return json({ etag: '"' + 'b'.repeat(32) + '"' }, 202, { etag: '"' + 'b'.repeat(32) + '"' })
    }
    const saved = await saveCloudProject(document, binding, { automatic: true, reuseUploads: true })
    assert.equal(uploads, 0); assert.equal(snapshots, 1); assert.equal(saved.pending, false)
    assert.equal(binding.etag, '"previous"')
  } finally { globalThis.fetch = original }
})
