// Real WASM + native ImGui input; API traffic is isolated to this in-memory cloud fixture.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const browser = await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const page=await browser.newPage({viewport:{width:1440,height:960}})
const logs=[];page.on('console',m=>{if(!m.text().includes('GL_INVALID_OPERATION')) logs.push(m.text())});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
await page.addInitScript(()=>localStorage.setItem('tomcat-ui-projects-v2-engine-test',JSON.stringify([{id:'my-first-game',name:'我的第一个游戏',description:'',template:'2D',image:'',status:'draft',updated:'今天'}])))
const uploads=new Map();let savedManifest
await page.route('**/v1/**',route=>{
 const path=new URL(route.request().url()).pathname
 const json=(value,headers={})=>route.fulfill({json:value,headers})
 if(path==='/v1/auth/me')return json({id:'engine-test',email:'engine-test@example.com',emailVerified:true})
 if(path==='/v1/projects/sync-config')return json({enabled:false})
 if(path==='/v1/projects'&&route.request().method()==='GET')return json([])
 if(path.endsWith('/ai-sessions/'))return json([])
 if(path.includes('/uploads/')) {
   const id=path.split('/').pop()
   if(route.request().method()==='GET')return route.fulfill({body:uploads.get(id),contentType:'application/octet-stream'})
   const bytes=route.request().postDataBuffer();uploads.set(id.slice(0,32),bytes)
   return json({uploadId:id.slice(0,32),contentHash:id,size:bytes.length})
 }
 if(path.endsWith('/working-state'))return json(savedManifest,{etag:'\"'+'b'.repeat(32)+'\"'})
 if(path.endsWith('/revisions')){savedManifest=route.request().postDataJSON();return json({etag:'"'+'b'.repeat(32)+'"'},{etag:'"'+'b'.repeat(32)+'"'})}
 return json({id:'engine-project',currentRevisionId:savedManifest?'b'.repeat(32):null,etag:savedManifest?'"'+'b'.repeat(32)+'"':null})
})
const {nativeClick,engineState,engineRpc,fillCode}=await import('./engine-browser-helpers.mjs')
try {
 const {attachScripts}=await import('../src/engine/scene-archive.ts')
 const ready=()=>page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='保存到云端'&&!b.disabled),null,{timeout:240000})
 const snapshot=async()=>{const state=await engineState(page);return engineRpc(page,'scene.snapshot',{sceneHandle:state.sceneHandle})}
 const save=async()=>{await page.getByRole('button',{name:'保存到云端',exact:true}).click();await page.getByText('已保存到数据库',{exact:true}).waitFor()}
 await page.goto(`${process.env.TEST_BASE_URL||'http://127.0.0.1:5173'}/editor/my-first-game`);await ready()
 await page.getByRole('button',{name:'C# 脚本',exact:true}).click()
 await page.getByPlaceholder('新脚本类名').fill('PlayerMove');await page.getByRole('button',{name:'新建',exact:true}).click()
 await page.locator('.script-panel .list li').first().waitFor()
 await fillCode(page,'using TomCat;\npublic sealed class PlayerMove : TomCatBehaviour { public float Speed = 5f; protected override void OnCreate() { Log.Info("FIELD_VALUE:" + Speed); } }')
 await page.getByRole('button',{name:'编译并安装',exact:true}).click();await page.locator('.script-panel .state.ok').waitFor({timeout:120000})
 await page.getByRole('button',{name:'收起 C# 脚本',exact:true}).click()
 let snap=await snapshot();const player=snap.entities.find(e=>e.name==='Player');const assets=await engineRpc(page,'asset.list');const script=assets.assets.find(a=>a.pathHint==='Scripts/PlayerMove.cs')
 assert.ok(script)
 await engineRpc(page,'scene.loadArchive',{sceneHandle:snap.sceneHandle,baseRevision:snap.revision,archive:attachScripts(snap.archive,player.id,[{handle:script.handle,className:'PlayerMove'}])})
 snap=await snapshot();await engineRpc(page,'scene.select',{sceneHandle:snap.sceneHandle,entityId:player.id});await page.waitForTimeout(750)
 snap=await snapshot();assert.match(snap.archive,/Name: Speed/);assert.match(snap.archive,/Value: 5/)
 await page.screenshot({path:'.engine/inspector-metadata-visible.png'})
 await nativeClick(page,1300,483);await page.keyboard.down('Control');await page.waitForTimeout(200);await nativeClick(page,1300,483);await page.keyboard.up('Control')
 await page.keyboard.press('Control+a');await page.waitForTimeout(200);await page.keyboard.type('8.5',{delay:100});await page.waitForTimeout(200);await page.keyboard.press('Enter');await nativeClick(page,1100,560)
 snap=await snapshot();assert.match(snap.archive,/Name: Speed\s+Type: Float\s+Value: 8.5/)
 await engineRpc(page,'preview.control',{command:'play'});await page.waitForTimeout(400);assert.ok(logs.some(l=>l.includes('FIELD_VALUE:8.5')))
 await engineRpc(page,'preview.control',{command:'stop'});await save()
 await page.reload();await ready();snap=await snapshot();assert.match(snap.archive,/Name: Speed\s+Type: Float\s+Value: 8.5/)
 await engineRpc(page,'scene.select',{sceneHandle:snap.sceneHandle,entityId:player.id});await page.waitForTimeout(500)
 await page.getByRole('button',{name:'C# 脚本',exact:true}).click();await page.locator('.script-panel .state.ok').waitFor({timeout:30000});await page.getByRole('button',{name:'收起 C# 脚本',exact:true}).click()
 await page.screenshot({path:'.engine/inspector-metadata-restored.png'})
 const previousLogs=logs.length;await engineRpc(page,'preview.control',{command:'play'});await page.waitForTimeout(400);assert.ok(logs.slice(previousLogs).some(l=>l.includes('FIELD_VALUE:8.5')));await engineRpc(page,'preview.control',{command:'stop'})
 assert.deepEqual(errors,[])
 console.log('PASS: native public field edit from 5 to 8.5, runtime receives value, save/reopen installs metadata and preserves override')
}catch(error){await page.screenshot({path:'.engine/inspector-metadata-failure.png'});console.log(logs.slice(-18));throw error}finally{await browser.close()}
