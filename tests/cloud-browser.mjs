import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const directory = await mkdtemp(join(tmpdir(), 'tomcat-cloud-browser-'))
const children = []
async function start(command, args, options, pattern) {
  const child = spawn(command, args, { ...options, windowsHide: true, stdio: ['ignore','pipe','pipe'] }); children.push(child)
  return new Promise((yes, no) => {
    let output = ''; const timer = setTimeout(() => no(new Error(output)), 30000)
    const read = bytes => { output += bytes; const match = output.match(pattern); if (match) { clearTimeout(timer); yes(match[1]) } }
    child.stdout.on('data', read); child.stderr.on('data', read)
    child.once('error', no); child.once('exit', code => { clearTimeout(timer); no(new Error(`Server exit ${code}: ${output}`)) })
  })
}
let browser
try {
  const apiDir = resolve(process.env.TEST_API_DIRECTORY || '../Tc_Engine_Web_backend/TomCat.Api')
  const api = await start('dotnet', [join(apiDir,'bin/Release/net10.0/TomCat.Api.dll'),'--urls','http://127.0.0.1:0'], {cwd:apiDir,env:{...process.env, ASPNETCORE_ENVIRONMENT:'Development',Storage__Directory:directory}}, /Now listening on:\s+(http:\/\/127\.0\.0\.1:\d+)/)
  const base = await start(process.execPath, ['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5192','--strictPort'], {env:{...process.env,TOMCAT_API_PROXY:api,NO_COLOR:'1'}}, /(http:\/\/127\.0\.0\.1:\d+)/)
  browser = await chromium.launch({channel:process.env.TEST_BROWSER_CHANNEL || 'chrome',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const a = await browser.newPage(); const b = await browser.newPage()
  for (const p of [a,b]) await p.addInitScript(() => {
    window.markSavedCalls = 0
    const send = MessagePort.prototype.postMessage
    MessagePort.prototype.postMessage = function(message, ...args) {
      if (message?.type === 'markSaved') window.markSavedCalls++
      return send.call(this, message, ...args)
    }
  })
  for (const p of [a,b]) p.on('dialog', d => d.accept())
  const ready = p => p.waitForFunction(() => [...document.querySelectorAll('button')].some(b => /^(保存|保存到云端)$/.test(b.textContent) && !b.disabled), null, {timeout:120000})
  const cached = p => p.evaluate(async () => {
    const id = location.pathname.split('/').pop()
    const db = await new Promise((ok,no) => {const r=indexedDB.open('tomcat-engine-v1');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})
    const read = store => new Promise(ok => {const r=db.transaction(store).objectStore(store).get(id);r.onsuccess=()=>ok(r.result)})
    const result={document:await read('projects'),binding:await read('cloudLinks')};db.close();return result
  })
  async function signIn(p, register=false) {
    await p.getByLabel('用户名',{exact:true}).fill('cloudtest')
    await p.getByLabel('密码',{exact:true}).fill('cloud-password-12345')
    if(register) await p.getByRole('button',{name:'切换到注册',exact:true}).click()
    await p.getByRole('button',{name:register?'注册并登录':'登录',exact:true}).click()
    await p.getByRole('button',{name:'退出账号',exact:true}).waitFor()
  }
  await a.goto(`${base}/editor/my-first-game`); await ready(a)
  await a.getByRole('button',{name:'添加对象',exact:true}).click()
  await a.locator('input[type=file]').setInputFiles({name:'red.tga',mimeType:'application/octet-stream',buffer:Buffer.from([0,0,2,0,0,0,0,0,0,0,0,0,1,0,1,0,24,0,0,0,255])})
  await a.getByText('图片已导入，请保存项目',{exact:true}).waitFor()
  await a.getByRole('button',{name:'云端',exact:true}).click(); await signIn(a,true)
  await a.getByRole('button',{name:'创建云端项目并关联',exact:true}).click()
  await a.getByRole('button',{name:'保存到云端',exact:true}).click()
  await a.getByText('完整项目已保存到云端',{exact:true}).waitFor()
  const first = await cached(a)
  assert.equal(await a.evaluate(() => window.markSavedCalls),1)
  assert.equal(first.document.version,2); assert.equal(first.binding.pending,false)
  for(const path of ['Project.tcproj','ProjectSettings/BuildSettings.json','ProjectSettings/ProjectSettings.json','ProjectSettings/PlayerSettings.json']) assert.ok(first.document.files[path])
  assert.ok(Object.keys(first.document.files).some(p=>p.endsWith('.tga.tcmeta')))
  await b.goto(`${base}/projects`); await b.getByRole('button',{name:'云端项目',exact:true}).click(); await signIn(b)
  await b.locator('.cloud-list button').first().click(); await b.getByRole('button',{name:'恢复为本地副本',exact:true}).click()
  await b.waitForURL('**/editor/**'); await ready(b)
  const restored=await cached(b)
  assert.deepEqual(restored.document,first.document); assert.deepEqual(restored.binding,first.binding)
  assert.match(restored.document.archive,/New Entity/)
  // Saving the restored real engine validates that configuration and all resource bytes survived boot.
  await b.getByRole('button',{name:'保存到云端',exact:true}).click(); await b.getByText('完整项目已保存到云端',{exact:true}).waitFor()
  const second=await cached(b); assert.deepEqual(second.document.files,first.document.files)
  await a.getByRole('button',{name:'添加对象',exact:true}).click(); await a.getByRole('button',{name:'保存到云端',exact:true}).click()
  await a.getByText(/云端已有新修订，本地内容已保留/).waitFor()
  assert.equal(await a.evaluate(() => window.markSavedCalls),1,'conflict must not mark the scene saved')
  const stale=await cached(a); assert.equal(stale.binding.etag,first.binding.etag); assert.equal(stale.binding.pending,true)
  await a.reload(); await ready(a); assert.ok(await a.getByText(/我的第一个游戏 · 未保存/).count())
  await b.route('**/v1/projects/**/uploads/**',r=>r.abort())
  await b.getByRole('button',{name:'添加对象',exact:true}).click(); await b.getByRole('button',{name:'保存到云端',exact:true}).click()
  await b.getByText(/无法连接云端，本地内容已保留/).waitFor()
  assert.equal(await b.evaluate(() => window.markSavedCalls),1,'upload failure must not mark the scene saved')
  const offline=await cached(b); assert.equal(offline.binding.pending,true); assert.equal(offline.binding.etag,second.binding.etag)
  const revisions=await b.evaluate(async id=>(await fetch(`/v1/projects/${id}/revisions`)).json(),first.binding.projectId)
  assert.equal(revisions.length,2)
  await b.unroute('**/v1/projects/**/uploads/**')
  await b.goto(`${base}/projects`); await b.getByRole('button',{name:'云端项目',exact:true}).click()
  await b.locator('.cloud-list button').first().click(); await b.getByLabel(/恢复版本/).selectOption(first.binding.etag.slice(1,-1))
  await b.getByRole('button',{name:'恢复为本地副本',exact:true}).click();await b.waitForURL('**/editor/**');await ready(b)
  const historical=await cached(b); assert.deepEqual(historical.document,first.document);assert.equal(historical.binding,undefined)
  await b.goto(`${base}/projects`);await b.getByRole('button',{name:'云端项目',exact:true}).click();await b.locator('.cloud-list button').first().click()
  await b.route('**/v1/projects/**/uploads/**',r=>r.fulfill({status:200,body:'corrupted'}))
  await b.getByRole('button',{name:'恢复为本地副本',exact:true}).click();await b.getByRole('alert').filter({hasText:'文件完整性校验失败'}).waitFor()
  assert.equal(new URL(b.url()).pathname,'/projects')
  console.log('PASS: real WASM complete cloud roundtrip, image/meta/config bytes, stale ETag, offline draft, historical restore, corrupt download rejection')
} finally {
  await browser?.close()
  for(const child of children.reverse()) if(child.exitCode===null&&child.signalCode===null) await new Promise(ok=>{child.once('exit',ok);child.kill()})
  await rm(directory,{recursive:true,force:true})
}
