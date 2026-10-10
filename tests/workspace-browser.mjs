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
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
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
  const originalUrl = page.url()
  await page.getByLabel('描述你想修改的场景').fill('WORKSPACE_WORKFLOW')
  await page.getByRole('button', { name: '执行', exact: true }).click()
  await page.getByText('WORKSPACE_WORKFLOW_COMPLETE', { exact: true }).waitFor({ timeout: 120000 })
  await page.getByText(/^结束检查点：/).waitFor({ timeout: 30000 })
  const { engineState, engineRpc } = await import('./engine-browser-helpers.mjs')
  const state = await engineState(page)
  assert.equal(state.mode, 'edit')
  const snapshot = () => engineRpc(page, 'scene.snapshot', { sceneHandle: state.sceneHandle })
  let before = await snapshot()
  assert.ok(before.entities.some(e => e.name === 'TrialBox'))
  const boxId = '9000000000000000102'
  const transform = before.schemas.find(s => s.name === 'TomCat.Transform')
  const translation = transform.properties.find(p => p.name === 'Translation').id
  assert.equal(before.entities.find(e => e.id === boxId).components.find(c => c.id === transform.id).values[translation][1], 3, 'validation never persists the runtime position')
  await assert.rejects(engineRpc(page, 'scene.transact', { sceneHandle: state.sceneHandle, baseRevision: before.revision, label: 'Must roll back', operations: [{ op: 'entity.create', entityId: '8001', name: 'MustNotExist' }, { op: 'component.add', entityId: '999999', componentId: transform.id }] }))
  assert.equal((await snapshot()).entities.some(e => e.id === '8001'), false)
  await engineRpc(page, 'history.undo', { sceneHandle: state.sceneHandle, baseRevision: before.revision })
  assert.equal((await snapshot()).entities.some(e => e.id === boxId || e.id === '9000000000000000101'), false, 'one undo removes the entire group')
  await engineRpc(page, 'history.redo', { sceneHandle: state.sceneHandle, baseRevision: (await snapshot()).revision })
  const projects = await (await page.request.get(base + '/v1/projects')).json()
  const source = projects.find(p => p.name === '我的第一个游戏')
  const sessions = await (await page.request.get(`${base}/v1/projects/${source.id}/ai-sessions/`)).json()
  const history = await (await page.request.get(`${base}/v1/projects/${source.id}/ai-sessions/${sessions[0].sessionId}`)).json()
  const runId = history.turns[0].runId
  const evidence = await (await page.request.get(`${base}/v1/projects/${source.id}/ai-runs/${runId}/events`)).json()
  assert.ok(evidence.events.some(e => e.tool === 'scene_apply_patch' && e.result.data.diff.total >= 2))
  assert.deepEqual(evidence.events.filter(e => e.tool === 'runtime_validate').map(e => e.result.data.passed), [true, false])
  const notes = await (await page.request.get(`${base}/v1/projects/${source.id}/ai-knowledge`)).json()
  assert.equal(notes.notes[0].sourceRunId, runId)
  await page.getByText('执行证据与变更', { exact: true }).last().click()
  await page.getByText('位置验收：通过 · 180 步', { exact: true }).waitFor()
  await mkdir('.engine', { recursive: true })
  await page.screenshot({ path: '.engine/workspace-evidence.png' })
  await page.getByRole('button', { name: '项目工具', exact: true }).click()
  const workspace = page.getByLabel('项目工具', { exact: true })
  await workspace.getByText('2 项场景变化', { exact: true }).waitFor()
  await workspace.getByText('固定步数位置验收', { exact: true }).click()
  await workspace.getByLabel('目标实体').selectOption(boxId)
  await workspace.getByLabel('最终世界 Y 最小值').fill('-0.05')
  await workspace.getByLabel('最终世界 Y 最大值').fill('0.1')
  await workspace.getByRole('button', { name: '运行位置验收', exact: true }).click()
  await workspace.getByText('位置验收通过 · 180 步', { exact: true }).waitFor()
  await workspace.getByText('项目知识（1）', { exact: true }).click()
  await workspace.getByRole('button', { name: 'falling-box · v1', exact: true }).click()
  await workspace.getByLabel('内容', { exact: true }).fill('已通过 180 步落地位置验收，人工复核。')
  await workspace.getByRole('button', { name: '保存笔记', exact: true }).click()
  await workspace.getByRole('button', { name: 'falling-box · v2', exact: true }).waitFor()
  await page.getByRole('button', { name: '创建试验副本', exact: true }).click()
  await page.waitForURL(url => url.toString() !== originalUrl, { timeout: 90000 })
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'AI 助手' && !b.disabled), null, { timeout: 120000 })
  const trialState = await engineState(page)
  let trial = await engineRpc(page, 'scene.snapshot', { sceneHandle: trialState.sceneHandle })
  assert.equal(trial.entities.find(e => e.id === boxId).name, 'TrialBox')
  const all = await (await page.request.get(base + '/v1/projects')).json()
  const fork = all.find(p => p.name.includes('试验副本'))
  assert.ok(fork.currentRevisionId)
  const relation = await (await page.request.get(`${base}/v1/projects/${fork.id}/experiment`)).json()
  assert.equal(relation.sourceProjectId, source.id)
  const baselineManifest = await (await page.request.get(`${base}/v1/projects/${source.id}/revisions/${relation.baseRevisionId}`)).json()
  const forkManifest = await (await page.request.get(`${base}/v1/projects/${fork.id}/revisions/${fork.currentRevisionId}`)).json()
  assert.equal(forkManifest.archive, baselineManifest.archive)
  const contents = manifest => manifest.files.map(f => ({ path: f.path, contentHash: f.contentHash, size: f.size })).sort((a, b) => a.path.localeCompare(b.path))
  assert.deepEqual(contents(forkManifest), contents(baselineManifest), 'every project file is copied byte-for-byte')
  const parentAfter = await (await page.request.get(`${base}/v1/projects/${source.id}`)).json()
  await engineRpc(page, 'scene.transact', { sceneHandle: trial.sceneHandle, baseRevision: trial.revision, label: 'Trial only', operations: [{ op: 'entity.rename', entityId: boxId, name: 'OnlyInTrial' }] })
  await page.getByRole('button', { name: '保存到云端', exact: true }).click()
  await page.getByText('已保存到数据库', { exact: true }).waitFor()
  assert.equal((await (await page.request.get(`${base}/v1/projects/${source.id}`)).json()).etag, parentAfter.etag)
  const originalManifest = await (await page.request.get(`${base}/v1/projects/${source.id}/revisions/${parentAfter.currentRevisionId}`)).json()
  assert.ok(!originalManifest.archive.includes('OnlyInTrial'))
  await page.getByRole('button', { name: '项目工具', exact: true }).click()
  await page.getByText(/试验副本 · 基线/).waitFor()
  await page.screenshot({ path: '.engine/workspace-trial.png' })
  await page.goto(originalUrl)
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'AI 助手' && !b.disabled), null, { timeout: 120000 })
  const restored = await engineState(page)
  assert.equal((await engineRpc(page, 'scene.snapshot', { sceneHandle: restored.sceneHandle })).entities.find(e => e.id === boxId).name, 'TrialBox')
  assert.deepEqual(errors, [])
  console.log('PASS: real MCP/WASM batch transaction, atomic rollback, undo, fixed physics pass/fail, durable evidence/knowledge, independent project fork')

} catch (error) {
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) console.error((await page.locator('body').innerText()).slice(-8000))
  for (const child of children) console.error(child.diagnostics?.() || '')
  throw error
} finally {
  await browser?.close()
  for (const child of children.reverse()) if (child.exitCode === null && child.signalCode === null) await new Promise(ok => { child.once('exit', ok); child.kill() })
  await rm(directory, { recursive: true, force: true })
}
