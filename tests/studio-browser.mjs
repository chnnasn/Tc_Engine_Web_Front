import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
let signedIn = true
const user = { id: 'design-fixture', email: 'creator@example.com', emailVerified: true }
const projects = [
  { id: 'forest-study', name: '林间漫游', description: '在森林与小屋之间，寻找下一段故事。', image: '/images/forest.webp', template: '2D', status: 'draft', updated: '今天' },
  { id: 'first-world', name: '我的第一个世界', description: '一个关于探索、跳跃与发现的小实验。', image: '', template: '2D', status: 'draft', updated: '昨天' },
]
await page.addInitScript(({ user, projects }) => localStorage.setItem(`tomcat-ui-projects-v2-${user.id}`, JSON.stringify(projects)), { user, projects })
await page.route('**/v1/**', route => {
  const path = new URL(route.request().url()).pathname
  if (path.endsWith('/auth/me')) return route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? user : {} })
  if (path.endsWith('/projects') || path.endsWith('/games')) return route.fulfill({ json: [] })
  return route.fulfill({ json: {} })
})
mkdirSync('.engine/studio-design', { recursive: true })
async function capture(name, fullPage = true) {
  await page.evaluate(() => document.fonts.ready)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${name}: horizontal overflow`)
  await page.screenshot({ path: `.engine/studio-design/${name}.png`, fullPage })
}
try {
  await page.goto(base)
  await page.getByRole('heading', { name: '林间来信', exact: true, level: 2 }).waitFor()
  await capture('home-desktop')
  await page.getByRole('button', { name: '打开我的账户' }).click()
  await page.locator('.menu-identity strong').filter({ hasText: user.email }).waitFor()
  await capture('menu-desktop', false)
  await page.locator('.account-menu').screenshot({ path: '.engine/studio-design/account-menu.png' })
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.account-menu').count(), 0)
  assert.equal(await page.getByRole('button', { name: '打开我的账户' }).evaluate(e => document.activeElement === e), true)
  await page.getByRole('button', { name: '打开我的账户' }).click()
  await page.locator('h1').click()
  assert.equal(await page.locator('.account-menu').count(), 0)
  await page.getByRole('button', { name: '打开我的账户' }).click()
  await page.locator('.account-menu').getByRole('link', { name: /项目工作台/ }).click()
  await page.waitForURL('**/projects')
  assert.equal(await page.locator('.account-menu').count(), 0)
  await page.locator('.workspace-overview').waitFor()
  await capture('projects-desktop')
  await page.getByRole('button', { name: '新建项目', exact: true }).last().click()
  await page.locator('#project-name').waitFor()
  await capture('new-project-desktop', false)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '打开我的账户' }).click()
  await page.getByRole('button', { name: /管理云端账号/ }).click()
  await page.locator('.account-identity').waitFor()
  await capture('account-desktop', false)
  await page.keyboard.press('Escape')
  for (const route of ['/community', '/profile', '/games/forest', '/community/welcome', '/play']) {
    await page.goto(base + route)
    await page.locator('main').waitFor()
    await capture(route.slice(1).replaceAll('/', '-') + '-desktop')
  }
  await page.setViewportSize({ width: 390, height: 844 })
  for (const route of ['/', '/projects', '/community', '/profile', '/play']) {
    await page.goto(base + route)
    if (route === '/projects') await page.locator('.workspace-overview').waitFor()
    await capture((route.slice(1) || 'home') + '-mobile')
  }
  await page.getByRole('button', { name: '打开我的账户' }).click()
  await capture('menu-mobile', false)
  const bounds = await page.locator('.account-menu').boundingBox()
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390)
  signedIn = false
  await page.goto(base + '/projects')
  await page.getByRole('button', { name: '登录 / 注册', exact: true }).click()
  await page.locator('#cloud-email').waitFor()
  await capture('login-mobile', false)
  assert.equal(await page.locator('dialog').evaluate(e => e.scrollWidth > e.clientWidth), false)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await capture('login-desktop', false)
  assert.deepEqual(errors, [])
  console.log('PASS: account menu dismiss/focus/navigation, all public page desktop/mobile layouts, account and project dialogs. Screenshots use fixture data.')
} finally { await browser.close() }
