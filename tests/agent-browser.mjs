import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'

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
  const secret = 'integration-test-secret-01234567890123456789'
  const api = await start('dotnet', [join(apiDir, 'bin/Release/net10.0/TomCat.Api.dll'), '--urls', 'http://127.0.0.1:0'], {
    cwd: apiDir, env: { ...process.env, ASPNETCORE_ENVIRONMENT: 'Development', Storage__Directory: directory, Agent__Url: `http://127.0.0.1:${mcpPort}`, Agent__Secret: secret },
  }, /Now listening on:\s+(http:\/\/127\.0\.0\.1:\d+)/)
  await start(join(mcpDir, '.venv/Scripts/python.exe'), ['tests/agent_fixture.py'], {
    cwd: mcpDir, env: { ...process.env, PORT: String(mcpPort), TOMCAT_BACKEND_URL: api, TOMCAT_AGENT_SECRET: secret, TOMCAT_MCP_URL: `http://127.0.0.1:${mcpPort}/mcp/`, LANGSMITH_TRACING: 'false', LANGCHAIN_TRACING_V2: 'false' },
  }, /Uvicorn running on (http:\/\/127\.0\.0\.1:\d+)/)
  const base = await start(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], {
    env: { ...process.env, TOMCAT_API_PROXY: api, NO_COLOR: '1' },
  }, /(http:\/\/127\.0\.0\.1:\d+)/)
  browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const page = await browser.newPage()
  const results = [], errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (/\/commands\/[^/]+\/result$/.test(request.url())) results.push(request.postDataJSON()) })
  await page.goto(`${base}/editor/my-first-game`)
  await page.getByRole('button', { name: '添加对象', exact: true }).waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '添加对象' && !b.disabled), null, { timeout: 120000 })
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click()
  await page.getByText('请先通过“云端”登录并关联项目，再使用 AI 助手。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '云端', exact: true }).click()
  await page.getByLabel('用户名', { exact: true }).fill('aitest')
  await page.getByLabel('密码', { exact: true }).fill('agent-password-12345')
  await page.getByRole('button', { name: '切换到注册', exact: true }).click()
  await page.getByRole('button', { name: '注册并登录', exact: true }).click()
  await page.getByRole('button', { name: '创建云端项目并关联', exact: true }).click()
  await page.getByRole('button', { name: '保存到云端', exact: true }).waitFor()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.getByLabel('描述你想修改的场景').fill('创建一个 AI_Player 对象，读取验证，然后撤销并确认移除。')
  await page.getByRole('button', { name: '执行', exact: true }).click()
  await page.getByText('已创建、读取验证并撤销 AI_Player。', { exact: true }).waitFor({ timeout: 90000 })
  assert.equal(results.length, 7)
  assert.ok(results.every(r => r.ok), JSON.stringify(results))
  assert.ok(results[1].data.schemas.length > 0, 'schema comes from real WASM')
  const created = results[3].data.entity
  assert.equal(created.name, 'AI_Player')
  assert.equal(typeof created.id, 'string')
  assert.equal(results[4].data.entity.id, created.id)
  assert.equal(results[6].data.entities.some(e => e.id === created.id), false)
  assert.deepEqual(errors, [])
  console.log('PASS: real LangChain graph → HTTP MCP → authenticated .NET broker → browser → WASM: schema, create, read, undo, verify')
} catch (error) {
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) console.error((await page.locator('body').innerText()).slice(-8000))
  for (const child of children) console.error(child.diagnostics?.() || '')
  throw error
} finally {
  await browser?.close()
  for (const child of children.reverse()) if (child.exitCode === null && child.signalCode === null) await new Promise(ok => { child.once('exit', ok); child.kill() })
  await rm(directory, { recursive: true, force: true })
}
