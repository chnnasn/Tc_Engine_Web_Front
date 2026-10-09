import { preview, nativeClick, openNativeScripts, engineState, engineRpc } from './engine-browser-helpers.mjs'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { signIn } from './email-sign-in.mjs'

const directory = await mkdtemp(join(tmpdir(), 'tomcat-agent-browser-'))
const children = []
async function freePort() {
  const server = createServer(); await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  const port = server.address().port; await new Promise(ok => server.close(ok)); return port
}
async function start(command, args, options, pattern) {
  const child = spawn(command, args, { ...options, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child)
  return new Promise((ok, no) => {
    let output = ''; const timer = setTimeout(() => no(new Error(output)), 30000)
    const read = bytes => { output += bytes; const match = output.match(pattern); if (match) { clearTimeout(timer); ok(match[1]) } }
    child.stdout.on('data', read); child.stderr.on('data', read)
    child.once('error', no); child.once('exit', code => { clearTimeout(timer); no(new Error(`Server exit ${code}: ${output}`)) })
    child.diagnostics = () => output
  })
}
let browser
try {
  const apiDir = resolve('../Tc_Engine_Web_backend/TomCat.Api')
  const mcpDir = resolve('../Tc_Engine_Web_Mcp')
  const mcpPort = await freePort(), vitePort = await freePort()
  let redisConnection = ''
  if (process.env.TEST_REDIS_SERVER) {
    const port = await freePort()
    await start(process.env.TEST_REDIS_SERVER, ['--bind', '127.0.0.1', '--port', String(port), '--appendonly', 'yes', '--appendfsync', 'always', '--maxmemory-policy', 'noeviction'], { cwd: directory }, /(Ready to accept connections)/i)
    redisConnection = `127.0.0.1:${port}`
  }
  const secret = 'integration-test-secret-01234567890123456789'
  const api = await start('dotnet', [join(apiDir, 'bin/Release/net10.0/TomCat.Api.dll'), '--urls', 'http://127.0.0.1:0'], {
    cwd: apiDir, env: { ...process.env, ASPNETCORE_ENVIRONMENT: 'Development', Storage__Directory: directory, Mail__PickupDirectory: join(directory, 'mail'), Agent__Url: `http://127.0.0.1:${mcpPort}`, Agent__Secret: secret, Redis__ConnectionString: redisConnection, Redis__FlushIntervalSeconds: '3600' },
  }, /Now listening on:\s+(http:\/\/127\.0\.0\.1:\d+)/)
  await start(join(mcpDir, '.venv/Scripts/python.exe'), ['tests/agent_fixture.py'], {
    cwd: mcpDir, env: { ...process.env, PORT: String(mcpPort), TOMCAT_BACKEND_URL: api, TOMCAT_AGENT_SECRET: secret, TOMCAT_MCP_URL: `http://127.0.0.1:${mcpPort}/mcp/`, LANGSMITH_TRACING: 'false', LANGCHAIN_TRACING_V2: 'false' },
  }, /Uvicorn running on (http:\/\/127\.0\.0\.1:\d+)/)
  const base = await start(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], {
    env: { ...process.env, TOMCAT_API_PROXY: api, NO_COLOR: '1' },
  }, /(http:\/\/127\.0\.0\.1:\d+)/)
  browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  const results = [], errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (/\/commands\/[^/]+\/result$/.test(request.url())) results.push(request.postDataJSON()) })
  await page.goto(`${base}/projects`)
  await page.getByRole('button', { name: '登录 / 注册', exact: true }).click()
  await signIn(page, directory, 'aitest', 'agent-password-12345', true)
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.locator('.page-actions').getByRole('button', { name: '新建项目', exact: true }).click()
  await page.getByLabel('项目名称', { exact: true }).fill('我的第一个游戏')
  await page.getByRole('button', { name: '创建项目', exact: true }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'AI 助手' && !b.disabled), null, { timeout: 120000 })
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click()
  await page.getByRole('button', { name: '保存到云端', exact: true }).waitFor()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.evaluate(() => {
    const fs = document.querySelector('iframe').contentWindow.TomCatWeb.runtime.Module.FS
    fs.writeFile('/tmp/rename-a', 'new'); fs.writeFile('/tmp/rename-b', 'old')
    fs.readFile('/tmp/rename-b')
    fs.rename('/tmp/rename-a', '/tmp/rename-b'); fs.rename('/tmp/rename-b', '/tmp/rename-c')
    if (fs.analyzePath('/tmp/rename-b').exists) throw new Error('overwritten MEMFS lookup resurrected a deleted file')
    if (fs.readFile('/tmp/rename-c', {encoding:'utf8'}) !== 'new') throw new Error('rename lost data')
    fs.unlink('/tmp/rename-c')
  })
  const logs = []
  page.on('console', message => { if (!message.text().includes('GL_INVALID_OPERATION')) logs.push(message.text()) })
  await page.getByLabel('描述你想修改的场景').fill('SCRIPT_WORKFLOW')
  await page.getByRole('button', { name: '执行', exact: true }).click()
  await page.getByText('SCRIPT_WORKFLOW_COMPLETE', { exact: true }).waitFor({ timeout: 120000 })
  await page.getByText(/^结束检查点：/).waitFor({ timeout: 90000 })
  assert.equal(results.length, 12)
  assert.ok(results.every(r => r.ok), JSON.stringify(results))
  assert.equal(results[7].data.compilation.succeeded, true)
  assert.equal(results[9].data.entity.script_attachments.length, 1)
  assert.ok(logs.some(line => line.includes('AI_SCRIPT_CREATED')), 'compiled script ran in Play')
  await page.getByRole('button', { name: '收起 AI 助手', exact: true }).click()
  await preview(page, 'play')
  await nativeClick(page, 800, 420)
  await page.keyboard.down('d'); await page.waitForTimeout(700); await page.keyboard.up('d')
  assert.ok(logs.some(line => /AI_SCRIPT_MOVE:[0-9]/.test(line)), 'holding D moves the runtime entity through the verified API')
  await preview(page, 'stop')
  const projectId = await page.evaluate(async () => (await (await fetch('/v1/projects')).json())[0].id)
  const revisions = await page.evaluate(async id => (await fetch(`/v1/projects/${id}/revisions`)).json(), projectId)
  const end = revisions.find(r => r.aiCheckpoint?.phase === 'end')
  const manifest = await page.evaluate(async ({id, rev}) => (await fetch(`/v1/projects/${id}/revisions/${rev}`)).json(), {id: projectId, rev: end.revisionId})
  assert.ok(manifest.files.some(f => f.path === 'Assets/Scripts/PlayerMovement.cs'))
  assert.ok(manifest.files.some(f => f.path === 'Assets/Scripts/PlayerMovement.cs.tcmeta'))
  const registry = await engineRpc(page, 'asset.list')
  assert.ok(registry.assets.some(a => a.handle === results[9].data.entity.script_attachments[0].handle), 'script registered for native Inspector')
  await openNativeScripts(page)
  await page.mouse.move(620, 810); await page.waitForTimeout(200)
  await page.mouse.click(620, 810, { button: 'right', delay: 100 }); await page.waitForTimeout(300)
  await page.screenshot({ path: '.engine/native-delete-menu.png' })
  await nativeClick(page, 649, 865)
  await page.screenshot({ path: '.engine/native-delete-confirm.png' })
  const scriptExists = () => page.evaluate(() => document.querySelector('iframe').contentWindow.TomCatWeb.runtime.Module.FS.analyzePath('/Samples/PhysicsPlayground/Assets/Scripts/PlayerMovement.cs').exists)
  await nativeClick(page, 548, 534) // Cancel the referenced-asset deletion.
  assert.equal(await scriptExists(), true)
  await page.mouse.move(620, 810); await page.waitForTimeout(200)
  await page.mouse.click(620, 810, { button: 'right', delay: 100 }); await page.waitForTimeout(250)
  await nativeClick(page, 649, 865)
  await nativeClick(page, 470, 534) // Delete Anyway, preserving missing references.
  assert.equal(await scriptExists(), false)
  assert.equal(await page.evaluate(() => document.querySelector('iframe').contentWindow.TomCatWeb.runtime.Module.FS.analyzePath('/Samples/PhysicsPlayground/Assets/Scripts/PlayerMovement.cs.tcmeta').exists), false)
  await page.getByRole('button', { name: '保存到云端', exact: true }).click()
  await page.getByText('完整项目已保存到云端', { exact: true }).waitFor()
  const latest = await page.evaluate(async id => {
    const revisions = await (await fetch(`/v1/projects/${id}/revisions`)).json()
    return (await fetch(`/v1/projects/${id}/revisions/${revisions[0].revisionId}`)).json()
  }, projectId)
  assert.equal(latest.files.some(f => f.path.startsWith('Assets/Scripts/PlayerMovement.cs')), false, 'cloud revision drops both source and metadata')
  await page.mouse.move(356, 788); await page.waitForTimeout(180)
  await page.mouse.click(356, 788, { button: 'right', delay: 100 }); await page.waitForTimeout(250)
  await page.screenshot({ path: '.engine/packages-read-only.png' })
  await page.keyboard.press('Escape')
  await page.reload()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'C# 脚本' && !b.disabled), null, { timeout: 120000 })
  assert.equal(await scriptExists(), false, 'deleted source stays absent after cloud reload')
  const restored = await engineRpc(page, 'scene.snapshot', { sceneHandle: (await engineState(page)).sceneHandle })
  assert.ok(restored.archive.includes('PlayerMovement'), 'source deletion preserves the scene reference as missing, like desktop')
  console.log('PASS: real MCP script creation, compile, attachment, keyboard movement, checkpoint; MEMFS replace/delete; native delete cancellation/confirmation; source+metadata removed from cloud and stay removed after reload')
  assert.deepEqual(errors, [])
} catch (error) {
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) { await page.screenshot({ path: '.engine/agent-scripts-failure.png' }); console.error((await page.locator('body').innerText()).slice(-8000)) }
  for (const child of children) console.error(child.diagnostics?.() || '')
  throw error
} finally {
  await browser?.close()
  for (const child of children.reverse()) if (child.exitCode === null && child.signalCode === null) await new Promise(ok => { child.once('exit', ok); child.kill() })
  await rm(directory, { recursive: true, force: true })
}
