import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
const lock=JSON.parse(readFileSync('engine.lock.json','utf8'))
const previous='331d1e0b15edc202a375e9568b5cefea5821e18c'
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'
const browser=await chromium.launch({channel:'chrome',headless:true})
const context=await browser.newContext({viewport:{width:1440,height:960}})
const uploads=new Map();let manifest
const revision='b'.repeat(32),etag=`"${revision}"`
await context.addInitScript(()=>localStorage.setItem('tomcat-ui-projects-v2-upgrade',JSON.stringify([
  {id:'upgrade',name:'Existing cloud project',template:'2D',description:'',image:'',status:'draft',updated:'today'}])))
await context.route('**/v1/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname
  const json=(body,headers={})=>route.fulfill({json:body,headers})
  if(path==='/v1/auth/me')return json({id:'upgrade',email:'upgrade@example.com',emailVerified:true})
  if(path.endsWith('/sync-config'))return json({enabled:false})
  if(path.includes('/uploads/')){
    const id=path.split('/').pop()
    if(req.method()==='PUT'){const bytes=req.postDataBuffer();uploads.set(id.slice(0,32),bytes);return json({uploadId:id.slice(0,32),contentHash:id,size:bytes.length})}
    return route.fulfill({body:uploads.get(id),contentType:'application/octet-stream'})
  }
  if(path.endsWith('/revisions') && req.method()==='POST'){manifest=req.postDataJSON();return json({etag},{etag})}
  if(path.endsWith('/working-state'))return json(manifest,{etag})
  return json({id:'upgrade',name:'Existing cloud project',template:'2D',currentRevisionId:manifest ? revision : null,etag:manifest ? etag : null})
})
const ready=async page=>{
  await page.goto(`${base}/editor/upgrade`)
  await page.waitForFunction(()=>document.querySelector('iframe')?.contentWindow?.TomCatWeb?.engine?.EditorState(),null,{timeout:240000})
}
const rpc=async(page,type,payload)=>page.evaluate(({type,payload})=>{
  const engine=document.querySelector('iframe').contentWindow.TomCatWeb.engine
  const s=JSON.parse(engine.EditorState())
  const reply=JSON.parse(engine.EditorRpc(JSON.stringify({protocol:'tomcat.web.v1',requestId:'upgrade',type,
    payload:{sceneHandle:s.sceneHandle,baseRevision:s.revision,...payload}})))
  if(!reply.ok)throw new Error(JSON.stringify(reply.error));return reply.result
},{type,payload})
try {
  const oldPage=await context.newPage()
  await oldPage.route('**/engine.lock.json*',route=>route.fulfill({contentType:'application/javascript',body:`export default ${JSON.stringify({...lock,commit:previous,legacyCommits:[]})}`}))
  // The old bundle has no scene.persist RPC; use its original capture behavior for this fixture.
  await oldPage.route('**/src/engine/host.ts*',async route=>{
    const response=await route.fetch();const raw=await response.text();const body=raw.replace(/protocol\.request\(["']scene\.persist["']\)/g,'protocol.snapshot(state().sceneHandle)')
    await route.fulfill({response,body})
  })
  await ready(oldPage)
  await rpc(oldPage,'scene.transact',{label:'Existing work',operations:[{op:'entity.create',entityId:'7011',name:'Keep this existing entity'}]})
  await oldPage.getByRole('button',{name:'保存到云端',exact:true}).click()
  await oldPage.getByText('已保存到数据库',{exact:true}).waitFor()
  assert.equal(manifest.engineCommit,previous,'fixture must be authored by the genuine previous WASM bundle')
  const archive=manifest.archive
  await oldPage.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('tomcat-engine-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
    await new Promise((resolve,reject)=>{const t=db.transaction('projects','readwrite');t.objectStore('projects').clear();t.oncomplete=resolve;t.onerror=()=>reject(t.error)});db.close()
  })
  await oldPage.close()
  const newPage=await context.newPage();await ready(newPage)
  const restored=await rpc(newPage,'scene.snapshot',{})
  assert.ok(restored.entities.some(e=>e.id==='7011' && e.name==='Keep this existing entity'))
  assert.equal(restored.archive,archive,'cloud restore must preserve the existing scene')
  await newPage.getByRole('button',{name:'保存到云端',exact:true}).click()
  await newPage.getByText('已保存到数据库',{exact:true}).waitFor()
  assert.equal(manifest.engineCommit,lock.commit)
  assert.equal(manifest.archive,archive)
  console.log('PASS: genuine previous WASM project saved, local copy removed, restored from cloud in new engine and saved intact.')
} catch(error) {const p=context.pages().at(-1);console.log(await p.locator('body').innerText());throw error} finally {await browser.close()}
