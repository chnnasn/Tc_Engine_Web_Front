import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'
const browser=await chromium.launch({channel:process.env.TEST_BROWSER_CHANNEL || 'chrome',headless:true,
  args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const page=await browser.newPage({viewport:{width:1600,height:1000}})
const errors=[]
page.on('pageerror',e=>errors.push(e.message))
page.on('console',m=>{if(/GL_INVALID|WebGL shader|\[tomcat-host\] fail/.test(m.text())) errors.push(m.text())})
await page.addInitScript(()=>localStorage.setItem('tomcat-ui-projects-v2-engine-test',JSON.stringify([
  {id:'viewport',name:'Viewport parity',template:'2D',description:'',image:'',status:'draft',updated:'today'}])))
await page.route('**/v1/**',route=>{
  const path=new URL(route.request().url()).pathname
  if(path==='/v1/auth/me')return route.fulfill({json:{id:'engine-test',email:'test@example.com',emailVerified:true}})
  if(path==='/v1/projects/sync-config')return route.fulfill({json:{enabled:false}})
  if(path.endsWith('/revisions'))return route.fulfill({json:{etag:'"test"'},headers:{etag:'"test"'}})
  if(path.includes('/uploads/'))return route.fulfill({json:{uploadId:'a'.repeat(32),contentHash:path.split('/').pop(),size:route.request().postDataBuffer().length}})
  return route.fulfill({json:{id:'viewport',name:'Viewport parity',template:'2D',currentRevisionId:null,etag:null}})
})
const rpc=(type,payload={})=>page.evaluate(({type,payload})=>{
  const engine=document.querySelector('iframe').contentWindow.TomCatWeb.engine
  const reply=JSON.parse(engine.EditorRpc(JSON.stringify({protocol:'tomcat.web.v1',requestId:'viewport-test',type,payload})))
  if(!reply.ok)throw new Error(JSON.stringify(reply.error))
  return reply.result
},{type,payload})
const state=()=>page.evaluate(()=>JSON.parse(document.querySelector('iframe').contentWindow.TomCatWeb.engine.EditorState()))
const snapshot=async()=>rpc('scene.snapshot',{sceneHandle:(await state()).sceneHandle})
async function transact(operations){const s=await state();return rpc('scene.transact',{sceneHandle:s.sceneHandle,baseRevision:s.revision,label:'Viewport regression',operations})}
async function select(entityId){return rpc('scene.select',{sceneHandle:(await state()).sceneHandle,entityId})}
async function capture(name){await page.waitForTimeout(180);await page.screenshot({path:`.engine/viewport-${name}.png`})}
async function blueBounds(){
  const png=await page.screenshot({clip:{x:400,y:185,width:650,height:500}})
  return page.evaluate(async data=>{
    const image=new Image(); image.src=`data:image/png;base64,${data}`; await image.decode()
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data
    let minX=Infinity,maxX=-1,minY=Infinity,maxY=-1,count=0
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
      const i=(y*canvas.width+x)*4,[r,g,b]=pixels.slice(i,i+3)
      if(b>180 && r<150 && g>r+35){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);count++}
    }
    return {width:maxX-minX,height:maxY-minY,count}
  },png.toString('base64'))
}
try {
  mkdirSync('.engine',{recursive:true})
  await page.goto(`${base}/editor/viewport`)
  await page.waitForFunction(()=>document.querySelector('iframe')?.contentWindow?.TomCatWeb?.engine?.EditorState(),null,{timeout:240000})
  await page.waitForTimeout(1500)
  const initial=await snapshot(), camera=initial.entities.find(e=>e.name==='Main Camera'), player=initial.entities.find(e=>e.name==='Player')
  const schema=name=>initial.schemas.find(s=>s.name===name)
  const cameraSchema=schema('TomCat.Camera'),transform=schema('TomCat.Transform')
  // A direct, fast click must use the current pointer, not last frame's pick.
  await page.mouse.click(704,438)
  await page.waitForTimeout(180)
  assert.equal((await state()).selectedEntityId,camera.id,'camera billboard must be selectable')
  await transact([{op:'component.patch',entityId:camera.id,componentId:cameraSchema.id,properties:{'304':4}}])
  await capture('camera-ortho-4')
  const small=await blueBounds()
  assert.ok(small.count>300 && small.width>150 && small.height>150,`camera frustum missing: ${JSON.stringify(small)}`)
  await transact([{op:'component.patch',entityId:camera.id,componentId:cameraSchema.id,properties:{'304':6}}])
  await capture('camera-ortho-6')
  const large=await blueBounds()
  assert.ok(large.width>small.width*1.35 && large.height>small.height*1.35,'orthographic size must resize the visible frustum')
  await page.mouse.move(900,500);await page.keyboard.press('2');await capture('camera-3d')
  await page.keyboard.press('2')
  const box=schema('TomCat.BoxCollider2D')
  await transact([
    {op:'component.patch',entityId:camera.id,componentId:transform.id,properties:{'1':[-3,0,0]}},
    {op:'component.add',entityId:player.id,componentId:box.id},
  ])
  await select(player.id);await capture('collider')
  await page.mouse.click(1346,454);await page.waitForTimeout(180)
  const before=(await snapshot()).entities.find(e=>e.id===player.id).components.find(c=>c.id===box.id).values['405']
  await page.mouse.move(735,437);await page.mouse.down();await page.mouse.move(776,437,{steps:8});await page.mouse.up()
  await capture('collider-drag')
  const after=(await snapshot()).entities.find(e=>e.id===player.id).components.find(c=>c.id===box.id).values['405']
  assert.ok(after[0]>before[0]+0.2,`collider handle did not change width: ${JSON.stringify({before,after})}`)
  await page.keyboard.press('Control+z');await page.waitForTimeout(160)
  assert.deepEqual((await snapshot()).entities.find(e=>e.id===player.id).components.find(c=>c.id===box.id).values['405'],before,'collider drag must undo in one step')
  const canvasSchema=schema('TomCat.Canvas'), rectSchema=schema('TomCat.RectTransform'), imageSchema=schema('TomCat.UIImage')
  await transact([
    {op:'entity.create',entityId:'7001',name:'Test Canvas'},
    {op:'component.add',entityId:'7001',componentId:canvasSchema.id},
    {op:'entity.create',entityId:'7002',name:'Test UI',parentId:'7001'},
    {op:'component.add',entityId:'7002',componentId:rectSchema.id},
    {op:'component.add',entityId:'7002',componentId:imageSchema.id},
  ])
  await select('7002');await page.keyboard.press('w');await page.keyboard.press('f');await capture('ui-handles')
  const positionId=rectSchema.properties.find(p=>p.name==='AnchoredPosition').id
  const rectBefore=(await snapshot()).entities.find(e=>e.id==='7002').components.find(c=>c.id===rectSchema.id).values[positionId]
  await page.mouse.move(750,437);await page.mouse.down();await page.mouse.move(791,437,{steps:8});await page.mouse.up()
  await capture('ui-drag')
  const rectAfter=(await snapshot()).entities.find(e=>e.id==='7002').components.find(c=>c.id===rectSchema.id).values[positionId]
  assert.ok(rectAfter[0]>rectBefore[0]+5,`UI drag must edit AnchoredPosition: ${JSON.stringify({rectBefore,rectAfter})}`)
  await page.keyboard.press('Control+z');await page.waitForTimeout(160)
  assert.deepEqual((await snapshot()).entities.find(e=>e.id==='7002').components.find(c=>c.id===rectSchema.id).values[positionId],rectBefore)
  const layout=await rpc('editor.saveLayout')
  await rpc('editor.loadLayout',{settings:layout.settings.replace(/(\[TomCatWebPanelLayout\]\[v1\]\n)\d+/, '$12047')})
  await capture('authoring-panels')
  const opened=await rpc('editor.saveLayout')
  for(const panel of ['Animation','Animator','Tile Palette','Profiler','Asset Inspector']) assert.ok(opened.settings.includes(`[Window][${panel}]`),`${panel} should render`)
  writeFileSync('.engine/viewport-test-state.json',JSON.stringify(await snapshot(),null,2))
  assert.deepEqual(errors,[])
  console.log('PASS: camera icon picking, live frustum size, collider/UI handle drag and undo, F focus, 2D/3D switch, authoring windows, no WebGL errors.')
} finally {await browser.close()}
