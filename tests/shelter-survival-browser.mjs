// Independent production smoke: ordinary mouse gameplay from the original
// resources to the first successful storm and the Continue button. No model
// access, injected resources, private state, or accelerated clock API.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { readLoadedEngine } from './engine-provenance.mjs'

const base=process.env.TEST_BASE_URL || 'https://www.tcfun.fun'
const output=resolve(`.engine/shelter-success-qa/${new Date().toISOString().replaceAll(':','-')}`)
mkdirSync(output,{recursive:true})
const manifest=JSON.parse(readFileSync('public/samples/shelter/manifest.json','utf8'))
const lock=JSON.parse(readFileSync('engine.lock.json','utf8'))
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl']})
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1})
const logs=[],errors=[],screenshots=[],built=new Set(),checkpoints=[],networkFailures=[]
let frame,canvas,provenance,packageReceipt,failure,residents=1
page.on('console',m=>{logs.push(m.text());if(m.text().includes('[Shelter]'))console.log(m.text())})
page.on('pageerror',e=>errors.push(e.message))
page.on('requestfailed',r=>networkFailures.push({url:r.url(),error:r.failure()?.errorText}))
await page.route('**/v1/**',r=>r.fulfill({status:r.request().url().includes('/auth/me')?401:200,json:[]}))
const wait=ms=>page.waitForTimeout(ms),count=s=>logs.filter(l=>l.includes(s)).length
function healthy(){assert.deepEqual(errors,[]);assert.deepEqual(logs.filter(l=>/Unhandled exception|callback.*threw|\[tomcat-host\] fail|Deferred.*(?:failed|aborted)/i.test(l)),[])}
async function cue(s,previous=0,timeout=30000){const begin=Date.now();let progress=begin+15000;while(count(s)<=previous&&Date.now()-begin<timeout){healthy();if(Date.now()>progress){console.log(`Waiting for ${s}: ${Math.round((Date.now()-begin)/1000)}s`);progress+=15000}await wait(100)}assert.ok(count(s)>previous,`Expected ${s}`)}
async function waitForPlayer(){const begin=Date.now();let progress=begin+15000;while(Date.now()-begin<240000){if(await page.locator('.player-status').filter({hasText:'已就绪'}).isVisible())return;const alert=page.locator('.player-dialog [role="alert"]');if(await alert.isVisible())throw new Error(`Player startup failed: ${await alert.innerText()}`);if(Date.now()>progress){console.log(`Waiting for deployed engine startup: ${Math.round((Date.now()-begin)/1000)}s`);progress+=15000}await wait(250)}throw new Error('Player startup exceeded 240 seconds')}
async function click(x,y){const b=await canvas.boundingBox(),s=Math.min(b.width/1920,b.height/1080);await page.mouse.click(b.x+b.width/2+(x-960)*s,b.y+b.height/2+(y-540)*s,{delay:60});await wait(180)}
async function capture(name){await canvas.screenshot({path:`${output}/${name}.png`});screenshots.push(`${name}.png`)}
async function build(i){if(built.has(i))return true;const dx=(i%5-2)*129.6,dy=(Math.floor(i/5)-2)*129.6;await click(960+dx,540+dy);const n=count(`[Shelter] build:${i}`);await click(1193.5+dx,651.5+Math.max(-400,Math.min(250,dy)));if(count(`[Shelter] build:${i}`)>n){built.add(i);return true}assert.ok(logs.at(-1).includes('[Shelter] build blocked:'),'Failed build has visible/logged reason');await click(978.5+dx,651.5+Math.max(-400,Math.min(250,dy)));return false}
async function dispatchOne(){await click(1811,950);await cue('[Shelter] window:Dispatch');const partyBefore=count('[Shelter] party:1');await click(778+364/residents,623);await cue('[Shelter] party:1',partyBefore);const before=count('[Shelter] dispatch:1');for(let attempts=0;attempts<30&&count('[Shelter] dispatch:1')===before;attempts++){await click(1143,798);if(count('[Shelter] dispatch:1')===before){assert.ok(logs.at(-1).includes('dispatch blocked:食物不足'),'Retry only a normal food shortage');await wait(2000)}}await cue('[Shelter] dispatch:1',before);residents--}
async function pixelState(){const png=await canvas.screenshot();return page.evaluate(async b64=>{const img=new Image();img.src=`data:image/png;base64,${b64}`;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const s=Math.min(img.width/1920,img.height/1080),ox=(img.width-1920*s)/2,oy=(img.height-1080*s)/2,result={};for(const [k,[x,y,w,h]]of Object.entries({food:[875,85,230,65],countdown:[20,945,410,90]})){const p=ctx.getImageData(Math.round(ox+x*s),Math.round(oy+y*s),Math.round(w*s),Math.round(h*s)).data;result[k]=[...new Uint8Array(await crypto.subtle.digest('SHA-256',p))].map(n=>n.toString(16).padStart(2,'0')).join('')}return result},png.toString('base64'))}
try{
 console.log('Downloading deployed Shelter package for hash verification')
 const response=await page.request.get(`${base}/samples/shelter/shelter.tcpak`,{timeout:240000});assert.equal(response.status(),200);const bytes=await response.body();packageReceipt={url:response.url(),byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};assert.equal(packageReceipt.byteLength,manifest.byteLength);assert.equal(packageReceipt.sha256,manifest.sha256)
 await page.route(url=>new URL(url).pathname==='/samples/shelter/shelter.tcpak',r=>r.fulfill({status:200,contentType:'application/octet-stream',body:bytes}))
 await page.goto(`${base}/games/shelter`);await page.getByRole('button',{name:'开始游玩',exact:true}).first().click();await waitForPlayer();await cue('[Shelter] ready');frame=page.frames().find(f=>f!==page.mainFrame());canvas=frame.locator('canvas');provenance=await readLoadedEngine(frame);assert.equal(provenance.manifest.commit,lock.commit)
 await click(960,600);await cue('[Shelter] start');await capture('initial')
 for(const i of [6,7,0,1,2])assert.equal(await build(i),true)
 await dispatchOne();await click(1855,94);await click(820,845);await cue('[Shelter] speed:4');await click(820,845);await cue('[Shelter] speed:16');await click(960,380)
 for(let trip=1;trip<=10;trip++){
  await cue('[Shelter] window:Report',trip-1,20000);await capture(`report-${trip}`);const previous=count('[Shelter] collect');await click(960,798);await cue('[Shelter] collect',previous);residents+=2
  await build(8);await build(3);await build(11);checkpoints.push({trip,residents,built:[...built]})
  if([6,7,8,11,0,1,2,3].every(i=>built.has(i)))break
  // Leave reserves and let ordinary production run. A food-shortage failure
  // is retried through the same visible confirm button, never bypassed.
  await wait(trip===1||trip===4?5000:1000);await dispatchOne()
 }
 assert.equal(built.size,8,'Four farms and four walls built from earned resources');await capture('four-farms-four-walls')
 await cue('[Shelter] storm:5',0,240000);await capture('storm');await cue('[Shelter] storm result:survived',0,30000);assert.equal(count('[Shelter] storm result:lost'),0);await capture('successful-result')
 const beforeContinue=count('[Shelter] window:None');await click(960,890);await cue('[Shelter] window:None',beforeContinue);assert.equal(count('[Shelter] menu'),0,'Continue stays in the game');await capture('continued');const before=await pixelState();await wait(5500);const after=await pixelState();assert.notEqual(before.countdown,after.countdown,'Countdown progresses after Continue');assert.notEqual(before.food,after.food,'Surviving farms produce after Continue');checkpoints.push({afterContinue:{before,after}});await capture('continued-production')
 await page.getByRole('button',{name:'关闭播放器',exact:true}).click();assert.equal(await page.locator('iframe').count(),0);healthy();console.log('Production first storm success and Continue passed')
}catch(e){failure=e.stack||String(e);try{await page.screenshot({path:`${output}/failure-page.png`,fullPage:true})}catch{};if(canvas)try{await capture('failure')}catch{};throw e}
finally{writeFileSync(`${output}/evidence.json`,JSON.stringify({status:failure?'failed':'passed',failure,base,package:manifest,packageReceipt,provenance,checkpoints,screenshots,logs,errors,networkFailures,notes:'Actual deployed package and locked native engine. API authentication/list endpoints mocked only. Every action is a normal mouse click. Resources are earned through normal dispatch/production from initial reserves; no private state, resources, or clock injection. Read-only pixel hashes verify countdown and food advance after successful first-storm Continue. This is a functional run, not a performance measurement.'},null,2));await browser.close();console.log(`Evidence: ${output}`)}
