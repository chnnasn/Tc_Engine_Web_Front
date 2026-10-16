import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'

const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1040 } })
const logs = [], errors = []
if(process.env.TEST_PROFILE==='1') {
  const profiler=await page.context().newCDPSession(page)
  await profiler.send('Profiler.enable');await profiler.send('Profiler.start')
  setTimeout(async()=>{try{const result=await profiler.send('Profiler.stop');writeFileSync('.engine/rougelike-qa/profile.json',JSON.stringify(result));console.log('Profile saved')}catch(error){console.log(String(error))}},25000).unref()
}
// Observe actual AudioContext output, without a game-side test API.
await page.addInitScript(() => {
  if (!globalThis.AudioContext) return
  const NativeAudioContext = globalThis.AudioContext
  top.__rougelikeAudio ??= []
  globalThis.AudioContext = class extends NativeAudioContext {
    constructor(...args) {
      super(...args)
      const analyser = this.createAnalyser(), silent = this.createGain()
      silent.gain.value = 0; analyser.connect(silent); silent.connect(this.destination)
      const create = this.createBufferSource.bind(this)
      this.createBufferSource = () => { const source = create(); source.connect(analyser); return source }
      top.__rougelikeAudio.push({ context: this, analyser })
    }
  }
})
page.on('console', message => { const text = message.text(); if (!text.includes('GL_INVALID_OPERATION')) { logs.push(text); if (/Rougelike|exception|error|failed/i.test(text)) console.log(text) } })
page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
page.on('dialog', dialog => dialog.accept())
if(process.env.TEST_LIVE_BACKEND!=='1')await page.route('**/v1/**', route => route.fulfill({status: route.request().url().includes('/auth/me') ? 401 : 200, json: []}))
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'
mkdirSync('.engine/rougelike-qa', { recursive: true })
async function visibleBodies(canvas) {
  const png = (await canvas.screenshot()).toString('base64')
  return page.evaluate(async png => {
    const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode()
    const surface = document.createElement('canvas'); surface.width = image.width; surface.height = image.height
    const context = surface.getContext('2d'); context.drawImage(image, 0, 0)
    const { data, width, height } = context.getImageData(0, 0, image.width, image.height)
    const scale = Math.min(width / 1152, height / 648), step = 2
    const w = Math.ceil(width / step), h = Math.ceil(height / step), mask = new Uint8Array(w*h), bodies = []
    for (let y=0; y<h; y++) for(let x=0; x<w; x++) {
      const at=((y*step)*width+x*step)*4
      if(data[at]<105 && data[at+1]<105 && data[at+2]<105) mask[y*w+x]=1
    }
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      if(!mask[y*w+x]) continue
      const queue=[y*w+x];mask[y*w+x]=0;let lowX=x,highX=x,lowY=y,highY=y
      for(let i=0;i<queue.length;i++) {
        const at=queue[i],cx=at%w,cy=Math.floor(at/w);lowX=Math.min(lowX,cx);highX=Math.max(highX,cx);lowY=Math.min(lowY,cy);highY=Math.max(highY,cy)
        for(const n of [cx>0?at-1:-1,cx+1<w?at+1:-1,cy>0?at-w:-1,cy+1<h?at+w:-1]) if(n>=0&&mask[n]){mask[n]=0;queue.push(n)}
      }
      const bw=(highX-lowX+1)*step,bh=(highY-lowY+1)*step,area=queue.length*step*step
      const single=bw>35*scale&&bh>35*scale&&bw<65*scale&&bh<65*scale&&area>1000*scale*scale
      const cluster=bw>35*scale&&bh>35*scale&&bw<190*scale&&bh<190*scale&&area>2600*scale*scale
      if(single||cluster) bodies.push({x:(lowX+highX)*step/2,y:(lowY+highY)*step/2,cluster})
    }
    return { bodies, width, height, scale }
  },png)
}
async function slashStart(canvas) {
  // Menu has no enemies: follow the visible hexagon using screenshots and WASD.
  // Stop within slash range of the authored start button, then attack it.
  let player={x:300,y:470}
  for(let attempt=0;attempt<32;attempt++) {
    const {bodies,width,height,scale}=await visibleBodies(canvas)
    const expected={x:width/2+(player.x-576)*scale,y:height/2+(player.y-324)*scale}
    const body=bodies.filter(body=>!body.cluster).sort((a,b)=>Math.hypot(a.x-expected.x,a.y-expected.y)-Math.hypot(b.x-expected.x,b.y-expected.y))[0]
    assert.ok(body&&Math.hypot(body.x-expected.x,body.y-expected.y)<150*scale,'track menu player from rendered pixels')
    player={x:576+(body.x-width/2)/scale,y:324+(body.y-height/2)/scale}
    // Stay to the left of the label so glyphs cannot merge with the hexagon in
    // the pixel tracker. The button's authored hit circle is in slash range.
    if(Math.abs(player.x-745)<25&&Math.abs(player.y-357)<25) {
      const box=await canvas.boundingBox()
      await page.mouse.move(box.x+width/2+(908-576)*scale,box.y+height/2+(357-324)*scale)
      await page.waitForTimeout(350)
      await page.mouse.click(box.x+width/2+(908-576)*scale,box.y+height/2+(357-324)*scale,{delay:60})
      return
    }
    const dx=745-player.x,dy=357-player.y,key=Math.abs(dx)>Math.abs(dy)?(dx>0?'d':'a'):(dy>0?'s':'w')
    const duration=Math.min(180,Math.max(45,Math.max(Math.abs(dx),Math.abs(dy))/500*1000*.7))
    await page.keyboard.down(key);await page.waitForTimeout(duration);await page.keyboard.up(key)
  }
  throw new Error('Could not walk into menu slash range')
}
try {
  await page.goto(`${base}/games/rougelike`)
  await page.getByRole('button', { name: '开始游玩', exact: true }).first().click()
  console.log('Waiting for native player readiness')
  await page.waitForFunction(() => document.body.innerText.includes('Rougelike · 几何竞技场 已就绪'), null, { timeout: Number(process.env.TEST_BOOT_TIMEOUT || 90000) })
  await page.waitForTimeout(4000)
  console.log('Capturing native menu')
  const canvas = page.frameLocator('iframe').locator('canvas')
  await canvas.screenshot({ path: '.engine/rougelike-qa/menu.png' })
  assert.ok(logs.some(text => text.includes('[Rougelike] ready')), logs.slice(-40).join('\n'))
  await canvas.focus()
  if(process.env.TEST_MENU_SLASH==='1')await slashStart(canvas)
  else await page.keyboard.press('Enter')
  const started=Date.now()+30000
  while(!logs.some(text=>text.includes('[Rougelike] wave:1'))&&Date.now()<started)await page.waitForTimeout(200)
  await page.waitForTimeout(2500)
  await canvas.screenshot({ path: '.engine/rougelike-qa/playing.png' })
  assert.ok(logs.some(text => text.includes('[Rougelike] wave:1')), logs.slice(-40).join('\n'))
  if (process.env.TEST_COMBAT === '1') {
    // Fight the first wave through visible pixels and ordinary mouse input.
    // This cannot pass by changing game state or invoking private game methods.
    const deadline=Date.now()+60000
    while(!logs.some(text=>text.includes('[Rougelike] upgrade wave:1'))&&Date.now()<deadline) {
      const {bodies,width,height,scale}=await visibleBodies(canvas),box=await canvas.boundingBox()
      const target=bodies.map(body=>({...body,d:Math.hypot(body.x-width/2,body.y-height/2)}))
        .filter(body=>body.d>(body.cluster?5:34)*scale&&body.d<110*scale).sort((a,b)=>a.d-b.d)[0]
      if(target) await page.mouse.click(box.x+target.x,box.y+target.y,{delay:60})
      await page.waitForTimeout(260)
    }
    assert.ok(logs.some(text=>text.includes('[Rougelike] upgrade wave:1')),logs.slice(-35).join('\n'))
    await canvas.screenshot({path:'.engine/rougelike-qa/upgrade.png'})
    if(process.env.TEST_CAPTURE_COVER==='1') {
      await page.setViewportSize({width:1440,height:810})
      await page.getByRole('button',{name:'全屏游玩',exact:true}).click()
      await page.waitForTimeout(1000)
      await canvas.screenshot({path:'.engine/rougelike-qa/cover.png'})
      await page.evaluate(()=>document.exitFullscreen())
      await page.setViewportSize({width:1440,height:1040})
      await canvas.focus()
    }
    await page.keyboard.press('1')
    await page.waitForTimeout(3500)
    assert.ok(logs.some(text=>text.includes('[Rougelike] wave:2')))
  }
  await page.keyboard.down('d'); await page.waitForTimeout(350); await page.keyboard.up('d')
  await page.mouse.click((await canvas.boundingBox()).x+500,(await canvas.boundingBox()).y+240)
  if (process.env.TEST_REQUIRE_AUDIO === '1') {
    await page.waitForFunction(() => top.__rougelikeAudio.some(({ context, analyser }) => {
      const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples)
      return context.state === 'running' && samples.some(value => Math.abs(value) > .0001)
    }), null, { timeout: 10000 })
    assert.ok(logs.some(text => text.includes('audio backend:WebAudio')))
  }
  if(process.env.TEST_DEATH==='1') {
    const deadline=Date.now()+90000
    while(!logs.some(text=>text.includes('[Rougelike] game over'))&&Date.now()<deadline)await page.waitForTimeout(300)
    assert.ok(logs.some(text=>text.includes('[Rougelike] dying'))&&logs.some(text=>text.includes('[Rougelike] game over')),'real contact damage must reach death and game over')
    await canvas.screenshot({path:'.engine/rougelike-qa/game-over.png'})
    const before=logs.filter(text=>text.includes('[Rougelike] menu')).length
    await page.keyboard.press('m');await page.waitForTimeout(500)
    assert.equal(logs.filter(text=>text.includes('[Rougelike] menu')).length,before+1)
    const waves=logs.filter(text=>text.includes('[Rougelike] wave:1 ')).length
    await page.keyboard.press('Enter');await page.waitForTimeout(2500)
    assert.equal(logs.filter(text=>text.includes('[Rougelike] wave:1 ')).length,waves+1)
    await canvas.screenshot({path:'.engine/rougelike-qa/retry.png'})
  }
  await page.keyboard.press('p')
  await page.waitForTimeout(1000)
  await canvas.screenshot({ path: '.engine/rougelike-qa/paused.png' })
  await page.getByRole('button', { name: '全屏游玩', exact: true }).click()
  await page.waitForFunction(()=>document.fullscreenElement?.classList.contains('runtime-player'))
  await page.waitForTimeout(500)
  const fullscreenBox=await canvas.boundingBox()
  const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}))
  assert.ok(Math.abs(fullscreenBox.width-viewport.width)<2&&Math.abs(fullscreenBox.height-viewport.height)<2,'fullscreen canvas should fill the viewport')
  await page.evaluate(()=>document.exitFullscreen())
  await page.getByRole('button', { name: '关闭播放器', exact: true }).click()
  assert.equal(await page.locator('iframe').count(),0)
  if (process.env.TEST_REQUIRE_AUDIO === '1') {
    await page.waitForFunction(() => top.__rougelikeAudio.every(({ context }) => context.state === 'closed'))
  }
  assert.deepEqual(errors,[])
  assert.ok(!logs.some(text => /callback \w+ threw|MissingMethodException|aborted before live mutation/.test(text)), logs.slice(-40).join('\n'))
  console.log('PASS: anonymous static package, C# lifecycle/start, fullscreen, and teardown; movement/pause inputs sent'+(process.env.TEST_MENU_SLASH==='1'?'; menu slashed':'')+(process.env.TEST_COMBAT==='1'?'; first wave and upgrade reached':'')+(process.env.TEST_DEATH==='1'?'; contact death, menu return and retry verified':'')+(process.env.TEST_REQUIRE_AUDIO==='1'?'; real audio output and disposal verified':''))
} catch (error) {
  await page.screenshot({ path: '.engine/rougelike-qa/failure.png' }).catch(()=>{})
  console.error((await page.locator('body').innerText()).slice(-5000), logs.slice(-45).join('\n'))
  throw error
} finally { await browser.close() }
