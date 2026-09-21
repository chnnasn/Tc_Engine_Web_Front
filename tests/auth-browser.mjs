import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true })
const page = await browser.newPage()
let user
let projectAccess = true
let cloudReads = 0
let engineLoads = 0
const errors = []
page.on('pageerror', error => errors.push(error.message))
const project = { id: 'owned', name: '账号 A 的项目', description: '', template: '2D', image: '', status: 'draft', updated: '今天' }
await page.addInitScript(project => {
  localStorage.setItem('tomcat-ui-projects-v2-alice', JSON.stringify([project]))
}, project)
await page.route('**/v1/**', async route => {
  const path = new URL(route.request().url()).pathname
  const reply = (body, status = 200) => route.fulfill({ status, json: body })
  if (path === '/v1/auth/login') { user = { id: 'alice', username: 'alice' }; return reply(user) }
  if (path === '/v1/auth/me') return reply(user || {}, user ? 200 : 401)
  if (!user) return reply({}, 401)
  if (path === '/v1/auth/logout') { user = undefined; return reply({}) }
  if (path === '/v1/projects') {
    if (route.request().method() === 'POST') return reply({ ...project, id: 'cloud-owned', currentRevisionId: null, etag: null })
    return reply([])
  }
  if (path === '/v1/projects/cloud-owned') {
    cloudReads++
    return reply({ ...project, id: 'cloud-owned', currentRevisionId: null, etag: null }, projectAccess ? 200 : 404)
  }
  return reply({ enabled: false })
})
await page.route('**/engine/**/manifest.json', route => { engineLoads++; return route.fulfill({ status: 404, body: 'missing engine fixture' }) })
try {
  for (const path of ['/editor/owned', '/editor', '/projects', '/profile', '/preview/owned']) {
    await page.goto(base + path)
    await page.getByRole('heading', { name: '登录后继续' }).waitFor()
    assert.equal(await page.locator('iframe').count(), 0)
  }
  assert.equal(engineLoads, 0)
  // Calling the iframe protocol directly must not bypass the page's login gate.
  const rejected = await page.evaluate(async () => {
    const iframe = document.createElement('iframe'); iframe.src = '/engine-host.html'; document.body.append(iframe)
    await new Promise(resolve => iframe.onload = resolve)
    const channel = new MessageChannel()
    const result = new Promise(resolve => { channel.port1.onmessage = event => resolve(event.data) })
    iframe.contentWindow.postMessage({ type: 'tomcat-connect', kind: 'editor', cloudProjectId: 'cloud-owned' }, location.origin, [channel.port2])
    try { return await result } finally { channel.port1.close(); iframe.remove() }
  })
  assert.equal(rejected.event, 'fatal')
  assert.match(rejected.message, /登录/)
  assert.equal(engineLoads, 0)
  await page.goto(base + '/community')
  await page.getByRole('button', { name: '发起话题' }).click()
  await page.locator('#cloud-username').waitFor()
  assert.equal(await page.locator('#topic-title').count(), 0)
  await page.goto(base + '/community/welcome')
  await page.getByRole('button', { name: '登录后参与讨论' }).waitFor()
  assert.equal(await page.locator('#topic-reply').count(), 0)
  await page.goto(base + '/games/forest')
  await page.getByRole('button', { name: '登录后参与讨论' }).waitFor()
  assert.equal(await page.locator('#game-comment').count(), 0)
  await page.getByRole('button', { name: '打开游玩预览', exact: true }).click()
  assert.equal(await page.locator('#cloud-username').count(), 0)
  await page.goto(base + '/editor/owned')
  await page.getByRole('button', { name: '登录 / 注册', exact: true }).click()
  await page.locator('#cloud-username').fill('alice')
  await page.locator('#cloud-password').fill('test-password-123')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByRole('button', { name: '返回项目', exact: true }).waitFor()
  await page.waitForFunction(() => document.body.textContent.includes('engine:build'))
  assert.ok(cloudReads >= 2, 'page and iframe host must both verify cloud project access')
  assert.ok(engineLoads > 0)
  // Reopening with revoked project ownership must stop before loading the engine.
  projectAccess = false
  const loadsBefore = engineLoads
  await page.reload()
  await page.getByRole('alert').filter({ hasText: '没有访问权限' }).waitFor()
  assert.equal(await page.locator('iframe').count(), 0)
  assert.equal(engineLoads, loadsBefore)
  projectAccess = true
  await page.goto(base + '/games/forest')
  await page.locator('#game-comment').waitFor()
  await page.locator('#game-comment').fill('会话失效后不得写入')
  user = undefined
  await page.getByRole('button', { name: '留下想法', exact: true }).click()
  await page.locator('#cloud-username').waitFor()
  assert.equal(await page.evaluate(() => localStorage.getItem('tomcat-ui-comments-forest')), null)
  user = { id: 'bob', username: 'bob' }
  await page.goto(base + '/projects')
  await page.getByRole('heading', { name: '我的项目' }).waitFor()
  assert.equal(await page.getByText(project.name, { exact: true }).count(), 0)
  await page.goto(base + '/community/welcome')
  await page.locator('#topic-reply').fill('已登录的回复')
  await page.getByRole('button', { name: '发送回复', exact: true }).click()
  await page.locator('.comment').getByText('已登录的回复', { exact: true }).waitFor()
  await page.goto(base + '/projects')
  await page.getByRole('heading', { name: '我的项目' }).waitFor()
  await page.getByRole('button', { name: '打开我的账户', exact: true }).click()
  await page.getByRole('button', { name: '管理云端账号', exact: true }).click()
  await page.getByRole('button', { name: '退出账号', exact: true }).click()
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.getByRole('heading', { name: '登录后继续' }).waitFor()
  // Network errors must fail closed too, without offering local editor mode.
  await page.route('**/v1/auth/me', route => route.abort())
  await page.goto(base + '/editor/owned')
  await page.getByRole('heading', { name: '登录后继续' }).waitFor()
  assert.equal(await page.locator('iframe').count(), 0)
  await page.getByText('云端连接失败，请重试', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Auth browser checks passed: guest gates, public pages/player, login return, cloud ownership, expired comments, account isolation.')
} finally { await browser.close() }
