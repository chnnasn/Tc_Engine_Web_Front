// Real WASM + native ImGui input; API traffic is isolated to this in-memory cloud fixture.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { fillCode } from './engine-browser-helpers.mjs'
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
const {nativeClick,engineState,engineRpc}=await import('./engine-browser-helpers.mjs')
try{
 await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/editor/my-first-game`)
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='保存到云端'&&!b.disabled),null,{timeout:240000})
 assert.equal(await page.getByRole('button',{name:'导出项目',exact:true}).count(),0)
 await nativeClick(page,320,679)
 await page.mouse.click(355,731,{button:'right',delay:80})
 await page.waitForTimeout(300)
 await page.mouse.move(401,743)
 await page.waitForTimeout(400)
 await nativeClick(page,478,745)
 await page.waitForTimeout(300)
 await page.keyboard.press('Control+a'); await page.keyboard.type('Level Two.tomcat',{delay:30}); await page.keyboard.press('Enter'); await page.waitForTimeout(350)
 const fsRead=async path=>{
   for(let attempt=0;;attempt++) {
     try{return await page.locator('iframe').evaluate((el,path)=>el.contentWindow.TomCatWeb.runtime.Module.FS.readFile(path,{encoding:'utf8'}),path)}
     catch(error){if(attempt===20)throw error;await page.waitForTimeout(100)}
   }
 }
 const root='/Samples/PhysicsPlayground/Assets'
 assert.match(await fsRead(root+'/Level Two.tomcat'),/SchemaVersion: 11/)
 // Move the scene tile into the existing Scene folder using the native Project drag target.
 await nativeClick(page,830,815);await page.waitForTimeout(500);await page.mouse.move(830,815);await page.waitForTimeout(180);await page.mouse.down();await page.waitForTimeout(600);await page.mouse.move(820,795,{steps:5});await page.waitForTimeout(600);await page.screenshot({path:'.engine/project-drag-source.png'});await page.mouse.move(365,750,{steps:20});await page.waitForTimeout(220);await page.screenshot({path:'.engine/project-drag.png'});await page.mouse.up();await page.waitForTimeout(350)
 assert.match(await fsRead(root+'/Scene/Level Two.tomcat'),/SchemaVersion: 11/)
 const metadata=await fsRead(root+'/Scene/Level Two.tomcat.tcmeta')
 const handle=/Handle: (\d+)/.exec(metadata)[1]
 // Empty folder creation and rename through the same native menu.
 await page.mouse.click(355,731,{button:'right',delay:80});await page.waitForTimeout(200);await page.mouse.move(401,743);await page.waitForTimeout(350);await nativeClick(page,478,765)
 await page.keyboard.press('Control+a');await page.keyboard.type('Empty Folder',{delay:20});await page.keyboard.press('Enter');await page.waitForTimeout(250)
 const state=await engineState(page)
 await engineRpc(page,'scene.transact',{sceneHandle:state.sceneHandle,baseRevision:state.revision,label:'Original work',operations:[{op:'entity.create',entityId:'7011',name:'Keep original scene'}]})
 const original=await engineRpc(page,'scene.persist')
 const opened=await engineRpc(page,'scene.openAsset',{handle})
 assert.equal(opened.sceneHandle,handle)
 assert.ok(!opened.entities.some(e=>e.id==='7011'))
 await engineRpc(page,'scene.transact',{sceneHandle:opened.sceneHandle,baseRevision:opened.revision,label:'Second scene',operations:[{op:'entity.create',entityId:'7012',name:'Keep second scene'}]})
 await engineRpc(page,'scene.openAsset',{handle:original.sceneHandle})
 const restored=await engineRpc(page,'scene.snapshot',{sceneHandle:original.sceneHandle});assert.ok(restored.entities.some(e=>e.id==='7011'))
 await engineRpc(page,'scene.openAsset',{handle})
 await page.getByRole('button',{name:'保存到云端',exact:true}).click()
 await page.getByText('完整项目已保存到云端',{exact:true}).waitFor()
 const saved=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('tomcat-engine-v1');r.onsuccess=()=>resolve(r.result)});return new Promise(resolve=>{const r=db.transaction('projects').objectStore('projects').get('my-first-game');r.onsuccess=()=>{db.close();resolve(r.result)}})})
 assert.ok(saved.directories.includes('Assets/Empty Folder'))
 assert.ok(saved.files['Assets/Scene/Level Two.tomcat'])
 assert.equal(saved.sceneHandle,handle)
 await page.screenshot({path:'.engine/project-authoring-success.png'})
 await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('tomcat-engine-v1');r.onsuccess=()=>resolve(r.result)});await new Promise(resolve=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').clear();tx.oncomplete=resolve});db.close()})
 await page.reload();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='保存到云端'&&!b.disabled),null,{timeout:240000})
 const after=await engineState(page);assert.equal(after.sceneHandle,handle)
 const snap=await engineRpc(page,'scene.snapshot',{sceneHandle:handle});assert.ok(snap.entities.some(e=>e.id==='7012'))
 assert.equal(await page.locator('iframe').evaluate((el,path)=>el.contentWindow.TomCatWeb.runtime.Module.FS.isDir(el.contentWindow.TomCatWeb.runtime.Module.FS.stat(path).mode),root+'/Empty Folder'),true)
 const box=await page.locator('iframe').boundingBox();await nativeClick(page,box.width/2-28,box.y+41);assert.equal((await engineState(page)).mode,'play')
 await engineRpc(page,'preview.control',{command:'stop'})
 await page.getByRole('button',{name:'C# 脚本',exact:true}).click()
 await page.getByPlaceholder('新脚本类名').fill('Movement')
 await page.getByRole('button',{name:'新建',exact:true}).click()
 await page.locator('.script-panel .list li').first().waitFor()
 await fillCode(page,'using TomCat;\npublic sealed class Movement : TomCatBehaviour { protected override void OnCreate() { Log.Info("MOVED_SCRIPT"); } }')
 // Model a native rename while the sidebar has an unsaved draft. Identity must follow .tcmeta.
 await page.locator('iframe').evaluate(el=>{
   const fs=el.contentWindow.TomCatWeb.runtime.Module.FS,root='/Samples/PhysicsPlayground/Assets'
   for(const suffix of ['', '.tcmeta'])fs.rename(root+'/Scripts/Movement.cs'+suffix,root+'/Empty Folder/Renamed.cs'+suffix)
 })
 await engineRpc(page,'asset.refresh')
 await page.getByRole('button',{name:'保存脚本',exact:true}).click()
 await page.locator('.script-panel .list li',{hasText:'Renamed.cs'}).waitFor()
 assert.match(await fsRead(root+'/Empty Folder/Renamed.cs'),/MOVED_SCRIPT/)
 await page.getByRole('button',{name:'编译并安装',exact:true}).click()
 await page.locator('.script-panel .state.ok').waitFor({timeout:120000})
 console.log('PASS: native create/rename/move, empty folder cloud restore, multi-scene persistence, native Play, moved C# draft save and compile; errors:',errors)
}catch(e){await page.screenshot({path:'.engine/project-authoring-failure.png'});console.log('logs',logs.slice(-15));console.log('fs',await page.locator('iframe').evaluate(el=>{const fs=el.contentWindow.TomCatWeb.runtime.Module.FS;return fs.readdir('/Samples/PhysicsPlayground/Assets').map(name=>({name,stat:fs.analyzePath('/Samples/PhysicsPlayground/Assets/'+name).exists}))}));console.log('files',await page.locator('iframe').evaluate(el=>el.contentWindow.TomCatWeb.runtime.Module.FS.readdir('/Samples/PhysicsPlayground/Assets')));throw e}finally{await browser.close()}
