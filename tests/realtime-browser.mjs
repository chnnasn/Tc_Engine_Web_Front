import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
const directory = await mkdtemp(join(tmpdir(), 'tomcat-cloud-browser-'))
const children = []
if (!process.env.TEST_REDIS_SERVER) throw new Error('Set TEST_REDIS_SERVER to a Redis server executable')
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
  await start(process.env.TEST_REDIS_SERVER, ['--bind','127.0.0.1','--port','16389','--appendonly','yes','--appendfsync','always'], {cwd:directory}, /(Ready to accept connections)/i)
  const apiDir = resolve(process.env.TEST_API_DIRECTORY || '../Tc_Engine_Web_backend/TomCat.Api')
  const api = await start('dotnet', [join(apiDir,'bin/Release/net10.0/TomCat.Api.dll'),'--urls','http://127.0.0.1:0'], {cwd:apiDir,env:{...process.env, ASPNETCORE_ENVIRONMENT:'Development',Storage__Directory:directory,Redis__ConnectionString:'127.0.0.1:16389',Redis__KeyPrefix:'browser:',Redis__FlushIntervalSeconds:'10'}}, /Now listening on:\s+(http:\/\/127\.0\.0\.1:\d+)/)
  const base = await start(process.execPath, ['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5193','--strictPort'], {env:{...process.env,TOMCAT_API_PROXY:api,NO_COLOR:'1'}}, /(http:\/\/127\.0\.0\.1:\d+)/)
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
  await a.getByRole('button',{name:'云端',exact:true}).click(); await signIn(a,true)
  await a.getByRole('button',{name:'创建云端项目并关联',exact:true}).click()
  await a.getByText(/已同步，等待定期落库/).waitFor({timeout:30000})
  const first = await cached(a)
  assert.ok(first.binding.etag); assert.equal(first.binding.pending,false)
  await a.getByText(/已自动保存到数据库/).waitFor({timeout:30000})
  assert.ok(await a.evaluate(() => window.markSavedCalls) >= 1)
  let uploadWrites = 0
  a.on('request', r => { if(r.method()==='PUT' && /\/uploads\//.test(r.url())) uploadWrites++ })
  await a.getByRole('button',{name:'添加对象',exact:true}).click()
  await a.getByText(/已同步，等待定期落库/).waitFor({timeout:30000})
  const second = await cached(a)
  assert.notEqual(second.binding.etag, first.binding.etag)
  assert.equal(uploadWrites, 0, 'unchanged resources are reused')
  await a.getByRole('button',{name:'保存到云端',exact:true}).click()
  await a.getByText('完整项目已保存到云端',{exact:true}).waitFor()
  const manual = await cached(a)
  const status = await a.evaluate(async id => (await fetch(`/v1/projects/${id}/sync-status`)).json(), manual.binding.projectId)
  assert.equal(status.persisted,true); assert.equal(status.etag,manual.binding.etag)
  await a.route('**/v1/projects/**/working-state', r => r.abort())
  await a.getByRole('button',{name:'添加对象',exact:true}).click()
  await a.getByText(/无法连接云端，本地内容已保留/).waitFor({timeout:30000})
  const offline = await cached(a)
  assert.equal(offline.binding.pending,true); assert.equal(offline.binding.etag,manual.binding.etag)
  await a.unroute('**/v1/projects/**/working-state')
  await a.getByText(/已同步，等待定期落库/).waitFor({timeout:30000})
  const reconnected = await cached(a)
  assert.equal(reconnected.binding.pending,false); assert.notEqual(reconnected.binding.etag,manual.binding.etag)
  // A competing writer must stop this tab's automatic uploads without changing its token.
  await a.evaluate(async ({id,etag}) => {
    const payload=await (await fetch(`/v1/projects/${id}/working-state`)).json()
    const response=await fetch(`/v1/projects/${id}/working-state`,{method:'PUT',headers:{'Content-Type':'application/json','X-TomCat-Request':'1','If-Match':etag},body:JSON.stringify(payload)})
    if(response.status!==202) throw new Error(`Concurrent write: ${response.status}`)
  }, {id:reconnected.binding.projectId,etag:reconnected.binding.etag})
  await a.getByRole('button',{name:'添加对象',exact:true}).click()
  await a.getByText(/云端已有新修订，本地内容已保留/).waitFor({timeout:30000})
  const conflicted=await cached(a)
  assert.equal(conflicted.binding.etag,reconnected.binding.etag); assert.equal(conflicted.binding.pending,true)
  let blockedUploads = 0
  a.on('request', r => { if(r.method()==='PUT' && r.url().endsWith('/working-state')) blockedUploads++ })
  await a.getByRole('button',{name:'添加对象',exact:true}).click()
  const deadline = Date.now() + 10000
  let later = await cached(a)
  while (later.document.archive === conflicted.document.archive && Date.now() < deadline) {
    await new Promise(ok => setTimeout(ok, 200)); later = await cached(a)
  }
  assert.notEqual(later.document.archive, conflicted.document.archive, 'edits after conflict still get a local draft')
  assert.equal(blockedUploads, 0); assert.equal(later.binding.etag, reconnected.binding.etag)
  console.log('PASS: real WASM automatic sync, periodic checkpoint acknowledgement, resource reuse, manual flush, offline draft, retry and stale writer rejection')
} finally {
  await browser?.close()
  for(const child of children.reverse()) if(child.exitCode===null&&child.signalCode===null) await new Promise(ok=>{child.once('exit',ok);child.kill()})
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
  assert.ok(basename(directory).startsWith('tomcat-cloud-browser-'))
  await rm(directory,{recursive:true,force:true})
}
