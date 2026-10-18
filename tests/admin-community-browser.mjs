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
  const shots = resolve('.engine/admin-community')
  await mkdir(shots, { recursive: true })
  for (const page of [adminPage, userPage]) { page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(20000) }
  async function login(page, email) {
    await page.goto(base + '/admin')
    await page.getByRole('button', { name: '登录 / 注册', exact: true }).click()
    await page.locator('#cloud-email').fill(email)
    await page.locator('#cloud-password').fill(password)
    await page.getByRole('checkbox', { name: /在此浏览器记住此账号/ }).check()
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.getByRole('button', { name: '退出账号', exact: true }).waitFor()
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  }
  await login(userPage, normal.email)
  await userPage.getByRole('heading', { name: '需要管理员权限' }).waitFor()
  await userPage.goto(base + '/profile')
  await userPage.locator('#display-name').fill('改名后的玩家')
  await userPage.getByRole('button', { name: '保存昵称', exact: true }).click()
  await userPage.getByRole('heading', { name: '改名后的玩家', exact: true }).waitFor()
  const avatar = await userPage.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64; const context = canvas.getContext('2d'); context.fillStyle = '#bf745a'; context.fillRect(0, 0, 64, 64); return canvas.toDataURL('image/png').split(',')[1] })
  await userPage.getByLabel('上传头像', { exact: true }).setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from(avatar, 'base64') })
  await userPage.getByRole('img', { name: '改名后的玩家的头像', exact: true }).waitFor()
  await userPage.getByRole('img', { name: '改名后的玩家的头像', exact: true }).evaluate(image => image.decode())
  await userPage.screenshot({ path: join(shots, 'profile-owner-desktop.png'), fullPage: true })
  await userPage.setViewportSize({ width: 390, height: 844 })
  assert.equal(await userPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await userPage.screenshot({ path: join(shots, 'profile-owner-mobile.png'), fullPage: true })
  await userPage.setViewportSize({ width: 1280, height: 960 })
  await userPage.goto(base + '/community')
  await userPage.getByRole('button', { name: '发起话题', exact: true }).click()
  await userPage.locator('#topic-title').fill('浏览器管理验收话题')
  await userPage.locator('#topic-content').fill('这是保存在服务器的内容。<script>window.injected=true</script>')
  await userPage.getByRole('button', { name: '发布话题', exact: true }).click()
  await userPage.getByRole('heading', { name: '浏览器管理验收话题', exact: true }).waitFor()
  const topicUrl = userPage.url()
  await userPage.locator('.article-author').getByRole('link', { name: /改名后的玩家/ }).waitFor()
  assert.equal(await userPage.getByRole('button', { name: '删除话题', exact: true }).count(), 0)
  await userPage.locator('#topic-reply').fill('需要处理的回复')
  await userPage.getByRole('button', { name: '发送回复', exact: true }).click()
  await userPage.locator('.comment').getByText('需要处理的回复', { exact: true }).waitFor()
  assert.equal(await userPage.getByRole('button', { name: '删除回复', exact: true }).count(), 0)
  assert.equal(await userPage.evaluate(() => window.injected), undefined)
  await userPage.reload()
  await userPage.locator('.comment').getByText('需要处理的回复', { exact: true }).waitFor()

  await login(adminPage, 'chnnasn@gmail.com')
  await adminPage.getByRole('heading', { name: /^管理后台/ }).waitFor()
  await adminPage.locator('.admin-row').getByText(normal.email, { exact: false }).waitFor()
  assert.equal(await adminPage.locator('.admin-stat strong').first().textContent(), '2')
  for (const label of ['云端项目', '社区回复', '资源存储']) assert.equal(await adminPage.locator('.admin-stats').getByText(label, { exact: true }).count(), 0)
  await adminPage.getByText(/近 14 天活跃趋势/).click()
  assert.equal(await adminPage.locator('.activity-table tbody tr').count(), 14)
  // Save a second account in this browser, then explicitly pick the administrator.
  await adminPage.getByRole('button', { name: '打开我的账户', exact: true }).click()
  await adminPage.getByRole('button', { name: '管理云端账号', exact: true }).click()
  await adminPage.getByRole('button', { name: /切换账号/ }).click()
  await adminPage.locator('#cloud-email').fill(normal.email)
  await adminPage.locator('#cloud-password').fill(password)
  await adminPage.getByRole('checkbox', { name: /在此浏览器记住此账号/ }).check()
  await adminPage.getByRole('button', { name: '登录', exact: true }).click()
  await adminPage.getByRole('button', { name: /切换账号/ }).waitFor()
  await adminPage.getByRole('button', { name: /切换账号/ }).click()
  await adminPage.getByRole('button', { name: '登录已保存账号 chnnasn@gmail.com', exact: true }).waitFor()
  await adminPage.getByRole('button', { name: `登录已保存账号 ${normal.email}`, exact: true }).waitFor()
  await adminPage.screenshot({ path: join(shots, 'account-picker-desktop.png'), fullPage: true })
  await adminPage.getByRole('button', { name: '登录已保存账号 chnnasn@gmail.com', exact: true }).click()
  await adminPage.getByRole('button', { name: '退出账号', exact: true }).waitFor()
  await adminPage.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await adminPage.getByRole('heading', { name: /^管理后台/ }).waitFor()
  assert.equal((await adminContext.cookies()).filter(cookie => cookie.name === 'tomcat.accounts')[0].httpOnly, true)
  assert.equal((await adminContext.cookies()).filter(cookie => cookie.name === 'tomcat.session')[0].expires > Date.now() / 1000 + 29 * 86400, true)
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
  await adminPage.goto(topicUrl)
  await adminPage.getByText('需要处理的回复', { exact: true }).waitFor()
  await adminPage.locator('.comment').getByRole('button', { name: '删除回复', exact: true }).click()
  await adminPage.locator('#inline-delete-reason').fill('清理不当回复')
  await adminPage.getByRole('button', { name: '确认删除', exact: true }).click()
  await adminPage.getByText('还没有回复，来聊聊你的看法吧。', { exact: true }).waitFor()
  await adminPage.locator('.article-author').getByRole('link', { name: /改名后的玩家/ }).click()
  await adminPage.getByRole('heading', { name: '改名后的玩家', exact: true }).waitFor()
  assert.equal(await adminPage.locator('#display-name').count(), 0)
  await adminPage.getByText('普通用户', { exact: true }).waitFor()
  await adminPage.screenshot({ path: join(shots, 'profile-public-desktop.png'), fullPage: true })
  await userPage.reload()
  await userPage.getByText('还没有回复，来聊聊你的看法吧。', { exact: true }).waitFor()
  await adminPage.goto(base + '/admin')
  await adminPage.getByRole('button', { name: '封禁账号', exact: true }).waitFor()
  await action('封禁账号', '处理恶意账号')
  await adminPage.getByText('已封禁', { exact: true }).waitFor()
  await userPage.reload()
  await userPage.getByRole('button', { name: '登录后参与讨论', exact: true }).waitFor()
  await adminPage.getByRole('combobox', { name: '筛选账号状态', exact: true }).selectOption('suspended')
  await adminPage.getByRole('button', { name: '解除封禁', exact: true }).waitFor()
  await action('解除封禁', '账号复核通过')
  await adminPage.getByText('暂无符合条件的记录。', { exact: true }).waitFor()
  await adminPage.getByRole('combobox', { name: '筛选账号状态', exact: true }).selectOption('all')
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
  console.log('PASS: profiles/avatar/role badges, opt-in multiple saved accounts, explicit switching, inline reply deletion, unbanning, activity overview, permissions and desktop/mobile layouts.')
} finally {
  await browser?.close()
  for (const child of children.reverse()) if (child.exitCode === null && child.signalCode === null) await new Promise(yes => { child.once('exit', yes); child.kill() })
  await rm(directory, { recursive: true, force: true })
}
