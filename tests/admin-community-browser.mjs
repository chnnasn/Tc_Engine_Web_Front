import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { mailedCode } from '../../Tc_Engine_Web_backend/tests/email-helper.mjs'

const directory = await mkdtemp(join(tmpdir(), 'tomcat-admin-browser-'))
const children = []
const errors = []
let browser
async function server(command, args, options, pattern) {
  const child = spawn(command, args, { ...options, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  return new Promise((yes, no) => {
    let output = ''
    const timer = setTimeout(() => { child.kill(); no(new Error(output)) }, 30000)
    const fail = cause => { clearTimeout(timer); no(cause) }
    child.once('error', fail); child.once('exit', () => fail(new Error(output)))
    const read = chunk => { output += chunk.toString().replace(/\x1b\[[0-9;]*m/g, ''); const match = output.match(pattern); if (match) { clearTimeout(timer); yes(match[1]) } }
    child.stdout.on('data', read); child.stderr.on('data', read)
  })
}
try {
  const api = await server('dotnet', [resolve('../Tc_Engine_Web_backend/TomCat.Api/bin/Release/net10.0/TomCat.Api.dll'), '--urls', 'http://127.0.0.1:0'], {
    cwd: resolve('../Tc_Engine_Web_backend/TomCat.Api'),
    env: { ...process.env, ASPNETCORE_ENVIRONMENT: 'Development', Storage__Directory: directory, Mail__PickupDirectory: join(directory, 'mail') },
  }, /Now listening on:\s+(http:\/\/127\.0\.0\.1:\d+)/)
  const base = await server(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '0'], {
    cwd: process.cwd(), env: { ...process.env, TOMCAT_API_PROXY: api, NO_COLOR: '1' },
  }, /Local:\s+(http:\/\/127\.0\.0\.1:\d+)/)
  const password = 'browser-test-password-123'
  async function register(email) {
    const post = async (path, body) => {
      const response = await fetch(api + '/v1/auth/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TomCat-Request': '1' }, body: JSON.stringify(body) })
      assert.equal(response.status, 200); return response.json()
    }
    const { challengeId } = await post('register', { email, password })
    const { token } = await post('verify-email', { challengeId, code: await mailedCode(directory, email) })
    return post('complete-registration', { token })
  }
  await register('chnnasn@gmail.com')
  const normal = await register('browser-user@example.com')
  browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true })
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const userContext = await browser.newContext({ viewport: { width: 1280, height: 960 } })
  const adminPage = await adminContext.newPage(), userPage = await userContext.newPage()
  for (const page of [adminPage, userPage]) { page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(20000) }
  async function login(page, email) {
    await page.goto(base + '/admin')
    await page.getByRole('button', { name: '登录 / 注册', exact: true }).click()
    await page.locator('#cloud-email').fill(email)
    await page.locator('#cloud-password').fill(password)
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.getByRole('button', { name: '退出账号', exact: true }).waitFor()
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  }
  await login(userPage, normal.email)
  await userPage.getByRole('heading', { name: '需要管理员权限' }).waitFor()
  await userPage.goto(base + '/community')
  await userPage.getByRole('button', { name: '发起话题', exact: true }).click()
  await userPage.locator('#topic-title').fill('浏览器管理验收话题')
  await userPage.locator('#topic-content').fill('这是保存在服务器的内容。<script>window.injected=true</script>')
  await userPage.getByRole('button', { name: '发布话题', exact: true }).click()
  await userPage.getByRole('heading', { name: '浏览器管理验收话题', exact: true }).waitFor()
  const topicUrl = userPage.url()
  await userPage.locator('#topic-reply').fill('需要处理的回复')
  await userPage.getByRole('button', { name: '发送回复', exact: true }).click()
  await userPage.locator('.comment').getByText('需要处理的回复', { exact: true }).waitFor()
  assert.equal(await userPage.evaluate(() => window.injected), undefined)
  await userPage.reload()
  await userPage.locator('.comment').getByText('需要处理的回复', { exact: true }).waitFor()

  await login(adminPage, 'chnnasn@gmail.com')
  await adminPage.getByRole('heading', { name: /^管理后台/ }).waitFor()
  await adminPage.locator('.admin-row').getByText(normal.email, { exact: false }).waitFor()
  assert.equal(await adminPage.locator('.admin-stat strong').first().textContent(), '2')
  const shots = resolve('.engine/admin-community')
  await mkdir(shots, { recursive: true })
  await adminPage.screenshot({ path: join(shots, 'admin-desktop.png'), fullPage: true })
  async function action(name, reason, confirmLabel = name) {
    await adminPage.getByRole('button', { name, exact: true }).click()
    await adminPage.locator('#moderation-reason').fill(reason)
    await adminPage.getByRole('button', { name: '确认' + confirmLabel, exact: true }).click()
    await adminPage.locator('#moderation-reason').waitFor({ state: 'hidden' })
  }
  await adminPage.getByRole('button', { name: '社区话题', exact: true }).click()
  await action('置顶', '浏览器置顶验收', '置顶话题')
  await adminPage.getByText('已置顶', { exact: true }).waitFor()
  await adminPage.getByRole('button', { name: '社区回复', exact: true }).click()
  await adminPage.getByText('需要处理的回复', { exact: true }).waitFor()
  await action('删除回复', '清理不当回复')
  await adminPage.getByText('暂无符合条件的记录。', { exact: true }).waitFor()
  await userPage.reload()
  await userPage.getByText('还没有回复，来聊聊你的看法吧。', { exact: true }).waitFor()
  await adminPage.getByRole('button', { name: '账号管理', exact: true }).click()
  await adminPage.getByRole('button', { name: '封禁账号', exact: true }).waitFor()
  await action('封禁账号', '处理恶意账号')
  await adminPage.getByText('已封禁', { exact: true }).waitFor()
  await userPage.reload()
  await userPage.getByRole('button', { name: '登录后参与讨论', exact: true }).waitFor()
  await adminPage.getByRole('button', { name: '社区话题', exact: true }).click()
  await action('删除话题', '删除不当话题及关联回复')
  await adminPage.getByText('暂无符合条件的记录。', { exact: true }).waitFor()
  await userPage.goto(topicUrl)
  await userPage.getByRole('alert').filter({ hasText: '话题不存在或已被移除' }).waitFor()
  await adminPage.getByRole('button', { name: '操作记录', exact: true }).click()
  await adminPage.getByText('删除不当话题及关联回复', { exact: true }).waitFor()
  await adminPage.setViewportSize({ width: 390, height: 844 })
  assert.equal(await adminPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await adminPage.screenshot({ path: join(shots, 'admin-mobile.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.log('PASS: real verified login, admin gate, persisted posts/replies, pin/delete, suspension, audit, safe text rendering, desktop/mobile layouts.')
} finally {
  await browser?.close()
  for (const child of children.reverse()) if (child.exitCode === null && child.signalCode === null) await new Promise(yes => { child.once('exit', yes); child.kill() })
  await rm(directory, { recursive: true, force: true })
}
