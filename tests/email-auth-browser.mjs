import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'
let user, pendingEmail
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.route('**/v1/**', async route => {
  const path = new URL(route.request().url()).pathname
  const reply = (body, status = 200) => route.fulfill({ status, json: body })
  const body = route.request().postDataJSON()
  if (path.endsWith('/auth/me')) return reply(user || {}, user ? 200 : 401)
  if (path.endsWith('/auth/register')) {
    pendingEmail = body.email
    assert.ok(body.password.length >= 12)
    return reply({ challengeId: 'challenge', resendAfter: 60 })
  }
  if (path.endsWith('/auth/verify-email')) {
    assert.equal(body.challengeId, 'challenge')
    if (body.code !== '123456') return reply({ error: '验证码错误' }, 400)
    return reply({ token: 'verified-token' })
  }
  if (path.endsWith('/auth/complete-registration')) {
    assert.deepEqual(body, { token: 'verified-token' })
    user = { id: 'new-id', email: pendingEmail, emailVerified: true }
    return reply(user)
  }
  if (path.endsWith('/auth/forgot-password')) {
    assert.equal(body.email, 'creator@example.com')
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
  if (path.endsWith('/auth/login')) { assert.equal(body.email, 'creator@example.com'); user = { id: 'new-id', email: body.email, emailVerified: true }; return reply(user) }
  if (path.endsWith('/projects')) return reply([])
  return reply({})
})
mkdirSync('.engine/account-design', { recursive: true })
async function capture(name) {
  await page.screenshot({ path: `.engine/account-design/${name}.png`, fullPage: false })
  assert.equal(await page.locator('dialog').evaluate(el => el.scrollWidth > el.clientWidth), false)
}
try {
  await page.goto(base + '/projects')
  await page.getByRole('button', { name: '登录 / 注册', exact: true }).click()
  await page.locator('#cloud-email').waitFor()
  assert.equal(await page.locator('#cloud-email').getAttribute('type'), 'email')
  await capture('login-desktop')
  await page.setViewportSize({width:390,height:844}); await capture('login-mobile')
  await page.setViewportSize({width:1440,height:1000})
  await page.getByRole('button', { name: '切换到注册', exact: true }).click()
  await page.locator('#cloud-email').fill('creator@example.com')
  await page.locator('#cloud-password').fill('test-password-123')
  await page.getByRole('button', { name: '显示密码', exact:true }).click()
  assert.equal(await page.locator('#cloud-password').getAttribute('type'), 'text')
  await page.getByRole('button', { name: '隐藏密码', exact:true }).click()
  await capture('register-desktop')
  await page.getByRole('button', { name: '发送验证码', exact: true }).click()
  await page.locator('#cloud-code').fill('000000')
  await page.getByRole('button', { name: '验证邮箱并创建账号', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '验证码错误' }).waitFor()
  assert.equal(await page.locator('#cloud-display-name').count(), 0)
  await capture('verification-error')
  await page.locator('#cloud-code').fill('123456')
  await page.getByRole('button', { name: '验证邮箱并创建账号', exact: true }).click()
    await page.locator('.account-identity').getByText('creator@example.com', { exact: true }).waitFor()
  await capture('account-desktop')
  await page.setViewportSize({width:390,height:844}); await capture('account-mobile')
  await page.setViewportSize({width:1440,height:1000})
  await page.getByRole('button', { name: '退出账号', exact: true }).click()
  await page.getByRole('button', { name: '切换到登录', exact: true }).click()
  await page.locator('#cloud-email').fill('creator@example.com')
  await page.locator('#cloud-password').fill('test-password-123')
  await page.getByRole('button', { name: '登录', exact: true }).click()
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
  await page.locator('#recovery-email').fill('creator@example.com')
  await page.getByRole('button', { name: '发送重置验证码', exact: true }).click()
  await page.locator('#recovery-code').fill('654321')
  await capture('recovery-desktop')
  await page.locator('#new-password').fill('new-password-12345')
  await page.locator('#confirm-password').fill('new-password-12345')
  await page.getByRole('button', { name: '重置密码', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '密码已更新' }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Email browser checks passed: email-only registration/login, invalid code, password change/recovery and desktop/mobile layouts.')
} finally { await browser.close() }
