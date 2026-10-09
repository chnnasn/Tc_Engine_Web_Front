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
const {nativeClick,engineState,engineRpc}=await import('./engine-browser-helpers.mjs')
try{
 await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/editor/my-first-game`)
 const ready=()=>page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='保存到云端'&&!b.disabled),null,{timeout:240000})
 await ready()
 const root='/Samples/PhysicsPlayground/Assets'
 const files=()=>page.locator('iframe').evaluate((el,root)=>{const fs=el.contentWindow.TomCatWeb.runtime.Module.FS;const result=[];function walk(dir){for(const name of fs.readdir(dir)){if(name==='.'||name==='..')continue;const p=dir+'/'+name;result.push(p.slice(root.length+1));if(fs.isDir(fs.stat(p).mode))walk(p)}}walk(root);return result},root)
 const save=async()=>{await page.getByRole('button',{name:'保存到云端',exact:true}).click();await page.getByText('已保存到数据库',{exact:true}).waitFor()}
 assert.ok((await files()).includes('Scene.tomcat'),'initial scene is an explicit root asset')
 assert.ok(!(await files()).includes('Scenes'),'no implicit Scenes folder on new project')
 await save();assert.ok(!(await files()).includes('Scenes'))
 const initial=await engineState(page)
 await nativeClick(page,320,679)
 await page.screenshot({path:'.engine/scene-root-test.png'})
 // Rename the active asset and its containing folder while keeping its stable handle.
 await page.locator('iframe').evaluate((el,root)=>{const fs=el.contentWindow.TomCatWeb.runtime.Module.FS;fs.mkdir(root+'/My Levels');for(const suffix of ['', '.tcmeta'])fs.rename(root+'/Scene.tomcat'+suffix,root+'/My Levels/First Level.tomcat'+suffix)},root)
 await engineRpc(page,'asset.refresh')
 let snap=await engineRpc(page,'scene.snapshot',{sceneHandle:initial.sceneHandle})
 assert.equal(snap.name,'First Level');assert.equal(snap.sceneHandle,initial.sceneHandle)
 await page.locator('iframe').evaluate((el,root)=>el.contentWindow.TomCatWeb.runtime.Module.FS.rename(root+'/My Levels',root+'/Renamed Levels'),root)
 await engineRpc(page,'asset.refresh');await save()
 assert.ok((await files()).includes('Renamed Levels/First Level.tomcat'))
 assert.ok(!(await files()).some(p=>p.startsWith('My Levels')))
 // Delete the entire active-scene directory. Capturing, editing and saving must not restore it.
 await page.locator('iframe').evaluate((el,root)=>{const fs=el.contentWindow.TomCatWeb.runtime.Module.FS;for(const name of fs.readdir(root+'/Renamed Levels'))if(name!=='.'&&name!=='..')fs.unlink(root+'/Renamed Levels/'+name);fs.rmdir(root+'/Renamed Levels')},root)
 await engineRpc(page,'asset.refresh')
 snap=await engineRpc(page,'scene.snapshot',{sceneHandle:initial.sceneHandle})
 await engineRpc(page,'scene.transact',{sceneHandle:snap.sceneHandle,baseRevision:snap.revision,label:'Detached edit',operations:[{op:'entity.create',entityId:'7711',name:'Keep detached content'}]})
 await save();await save()
 assert.ok(!(await files()).some(p=>p==='Scenes'||p.startsWith('Renamed Levels')||p==='Scene.tomcat'))
 assert.ok(!savedManifest.directories.some(p=>p==='Assets/Scenes'||p==='Assets/Renamed Levels'))
 // Force a cloud restore so the original bundled project cannot resurrect deleted files either.
 await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('tomcat-engine-v1');r.onsuccess=()=>resolve(r.result)});await new Promise(resolve=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').clear();tx.oncomplete=resolve});db.close()})
 await page.reload();await ready();await save()
 const restored=await engineState(page);snap=await engineRpc(page,'scene.snapshot',{sceneHandle:restored.sceneHandle})
 assert.ok(snap.entities.some(e=>e.id==='7711'))
 assert.ok(!(await files()).some(p=>p==='Scenes'||p.startsWith('Renamed Levels')||p==='Scene.tomcat'))
 // Direct root creation is still available after deleting the default scene.
 await nativeClick(page,320,679)
 await page.mouse.click(355,731,{button:'right',delay:80});await page.waitForTimeout(300);await page.mouse.move(401,743);await page.waitForTimeout(400);await nativeClick(page,478,745)
 await page.waitForTimeout(300);await page.keyboard.press('Control+a');await page.keyboard.type('Root Level.tomcat',{delay:30});await page.keyboard.press('Enter');await page.waitForTimeout(500)
 assert.ok((await files()).includes('Root Level.tomcat'))
 const assetList=await engineRpc(page,'asset.list');const created=assetList.assets.find(a=>a.pathHint==='Root Level.tomcat')
 assert.ok(created)
 await assert.rejects(()=>engineRpc(page,'scene.openAsset',{handle:created.handle}),/SCENE_DETACHED/)
 snap=await engineRpc(page,'scene.openAsset',{handle:created.handle,discardDetached:true})
 assert.equal(snap.name,'Root Level')
 await save();await page.screenshot({path:'.engine/scene-ownership-success.png'})
 await page.mouse.click(830,815,{button:'right',delay:80});await page.waitForTimeout(350);await nativeClick(page,867,890)
 await page.keyboard.press('Control+a');await page.keyboard.type('Renamed Root.tomcat',{delay:30});await page.keyboard.press('Enter');await page.waitForTimeout(500)
 snap=await engineRpc(page,'scene.snapshot',{sceneHandle:created.handle});assert.equal(snap.name,'Renamed Root')
 assert.ok((await files()).includes('Renamed Root.tomcat'))
 await page.screenshot({path:'.engine/scene-native-renamed.png'});await page.waitForTimeout(2200)
 await page.mouse.click(830,815,{button:'right',delay:80});await page.waitForTimeout(350);await nativeClick(page,863,870);await page.waitForTimeout(1000)
 await nativeClick(page,460,512);await page.waitForTimeout(500)
 assert.ok(!(await files()).includes('Renamed Root.tomcat'),'native Delete removes the active scene')
 await save();await save()
 assert.ok(!(await files()).some(p=>p==='Renamed Root.tomcat'||p==='Root Level.tomcat'||p==='Scenes'))
 await page.screenshot({path:'.engine/scene-native-deleted.png'})
 assert.deepEqual(errors,[])
 console.log('PASS: root scene creation, rename follows handle, folder rename, deletion stays deleted across repeated saves and cloud restore, detached content retained, switching requires explicit discard.')
}catch(e){await page.screenshot({path:'.engine/scene-ownership-failure.png'});console.log(logs.slice(-15));throw e}finally{await browser.close()}
