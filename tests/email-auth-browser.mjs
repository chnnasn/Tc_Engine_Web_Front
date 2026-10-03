import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true })
const page = await browser.newPage()
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'
let user, pendingEmail, binding = false
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.route('**/v1/**', async route => {
  const path = new URL(route.request().url()).pathname
  const reply = (body, status = 200) => route.fulfill({ status, json: body })
  const body = route.request().postDataJSON()
  if (path.endsWith('/auth/me')) return reply(user || {}, user ? 200 : 401)
  if (path.endsWith('/auth/register') || path.endsWith('/auth/bind-email')) {
    pendingEmail = body.email; binding = path.endsWith('/bind-email')
    if (!binding) assert.ok(body.password.length >= 12)
    return reply({ challengeId: 'challenge', resendAfter: 60 })
  }
  if (path.endsWith('/auth/verify-email')) {
    assert.equal(body.challengeId, 'challenge')
    if (body.code !== '123456') return reply({ error: '验证码错误' }, 400)
    return reply({ token: 'verified-token', binding })
  }
  if (path.endsWith('/auth/complete-registration')) {
    assert.equal(body.token, 'verified-token')
    user = { id: binding ? 'old-id' : 'new-id', username: body.username, email: pendingEmail, emailVerified: true }
    return reply(user)
  }
  if (path.endsWith('/auth/forgot-password')) {
    assert.equal(body.email, 'legacy@example.com')
    return reply({ challengeId: 'reset-challenge', resendAfter: 60, message: '如果该邮箱已绑定账号，将收到密码重置验证码' })
  }
  if (path.endsWith('/auth/reset-password')) {
    assert.equal(body.challengeId, 'reset-challenge'); assert.equal(body.code, '654321'); assert.equal(body.newPassword, 'new-password-12345')
    user = undefined; return reply({})
  }
  if (path.endsWith('/auth/change-password')) {
    if (body.currentPassword !== 'test-password-123') return reply({ error: '当前密码错误' }, 400)
    assert.equal(body.newPassword, 'new-password-12345'); user = undefined; return reply({})
  }
  if (path.endsWith('/auth/logout')) { user = undefined; return route.fulfill({ status: 204 }) }
  if (path.endsWith('/auth/login')) { assert.equal(body.email, 'legacy'); user = { id: 'old-id', username: 'legacy' }; return reply(user) }
  if (path.endsWith('/projects')) return reply([])
  return reply({})
})
try {
  await page.goto(base + '/projects')
  await page.getByRole('button', { name: '登录 / 注册', exact: true }).click()
  await page.getByRole('button', { name: '切换到注册', exact: true }).click()
  await page.locator('#cloud-username').fill('creator@example.com')
  await page.locator('#cloud-password').fill('test-password-123')
  await page.getByRole('button', { name: '发送验证码', exact: true }).click()
  await page.locator('#cloud-code').fill('000000')
  await page.getByRole('button', { name: '验证邮箱', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '验证码错误' }).waitFor()
  assert.equal(await page.locator('#cloud-display-name').count(), 0)
  await page.locator('#cloud-code').fill('123456')
  await page.getByRole('button', { name: '验证邮箱', exact: true }).click()
  await page.locator('#cloud-display-name').fill('creator')
  await page.getByRole('button', { name: '完成注册', exact: true }).click()
  await page.getByText('邮箱：creator@example.com', { exact: true }).waitFor()
  await page.getByRole('button', { name: '退出账号', exact: true }).click()
  await page.getByRole('button', { name: '返回登录', exact: true }).click()
  await page.locator('#cloud-username').fill('legacy')
  await page.locator('#cloud-password').fill('test-password-123')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByRole('button', { name: '绑定邮箱', exact: true }).click()
  await page.locator('#cloud-username').fill('legacy@example.com')
  await page.getByRole('button', { name: '发送验证码', exact: true }).click()
  await page.locator('#cloud-code').fill('123456')
  await page.getByRole('button', { name: '验证邮箱', exact: true }).click()
  await page.getByText('邮箱：legacy@example.com', { exact: true }).waitFor()
  assert.equal(user.id, 'old-id')
  await page.getByRole('button', { name: '修改密码', exact: true }).click()
  await page.locator('#current-password').fill('wrong-password')
  await page.locator('#new-password').fill('new-password-12345')
  await page.locator('#confirm-password').fill('different-password-123')
  await page.getByRole('button', { name: '确认修改密码', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '两次输入的新密码不一致' }).waitFor()
  await page.locator('#confirm-password').fill('new-password-12345')
  await page.getByRole('button', { name: '确认修改密码', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '当前密码错误' }).waitFor()
  await page.locator('#current-password').fill('test-password-123')
  await page.locator('#new-password').fill('new-password-12345')
  await page.locator('#confirm-password').fill('new-password-12345')
  await page.getByRole('button', { name: '确认修改密码', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '密码已更新' }).waitFor()
  await page.getByRole('button', { name: '忘记密码', exact: true }).click()
  await page.locator('#recovery-email').fill('legacy@example.com')
  await page.getByRole('button', { name: '发送重置验证码', exact: true }).click()
  await page.locator('#recovery-code').fill('654321')
  await page.locator('#new-password').fill('new-password-12345')
  await page.locator('#confirm-password').fill('new-password-12345')
  await page.getByRole('button', { name: '重置密码', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '密码已更新' }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Email browser checks passed: staged registration, invalid code, username, legacy binding, password change and recovery.')
} finally { await browser.close() }
