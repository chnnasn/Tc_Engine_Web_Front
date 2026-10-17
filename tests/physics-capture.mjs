import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync,writeFileSync } from 'node:fs';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5199';
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[],logs=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>logs.push(m.text()));
await page.route('**/v1/**',r=>r.fulfill({status:r.request().url().includes('/auth/me')?401:200,json:[]}));
try{await page.goto(base+'/games/physics-lab');await page.getByRole('button',{name:'开始游玩',exact:true}).first().click();await page.locator('.player-status').filter({hasText:'已就绪'}).waitFor({timeout:180000});const frame=page.frames().find(f=>f!==page.mainFrame()),canvas=frame.locator('canvas');
 await page.getByRole('button',{name:'全屏游玩',exact:true}).click();await page.waitForTimeout(350);await canvas.screenshot({path:'public/samples/physics-lab/cover.png'});const before=await canvas.screenshot();await page.waitForTimeout(1200);const after=await canvas.screenshot();
 assert.notDeepEqual(before,after,'physics must actually advance');assert.deepEqual(errors,[]);assert.deepEqual(logs.filter(x=>/Unhandled exception|callback.*threw|\[tomcat-host\] fail/i.test(x)),[]);
 console.log('Real native physics capture passed');
}finally{mkdirSync('.engine/catalog-qa',{recursive:true});writeFileSync('.engine/catalog-qa/physics.json',JSON.stringify({errors,logs},null,2));await browser.close()}
