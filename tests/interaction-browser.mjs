import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '0'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let browser
try {
  const base = await new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error(output || 'Vite did not start')), 30000)
    function read(chunk) { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]) } }
    server.stdout.on('data', read); server.stderr.on('data', read); server.on('error', reject)
  })
  browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/v1/**', route => new URL(route.request().url()).pathname === '/v1/auth/me'
    ? route.fulfill({ status: 401, json: { error: '请先登录' } }) : route.fulfill({ json: [] }))
  await page.goto(base)
  await page.getByRole('heading', { name: '有个想法？ 让它玩起来。' }).waitFor()
  await mkdir('docs/interaction-preview', { recursive: true })
  await page.screenshot({ path: 'docs/interaction-preview/home-desktop.png' })
  await page.locator('.intro-samples').getByRole('button', { name: '方寸之间' }).click()
  assert.equal(await page.getByRole('link', { name: '打开方寸之间' }).getAttribute('href'), '/games/puzzle')
  await page.getByRole('tab', { name: '先玩一会儿' }).press('ArrowRight')
  assert.equal(await page.getByRole('tab', { name: '开始创作' }).getAttribute('aria-selected'), 'true')
  await page.getByRole('button', { name: '2 AI 修改' }).click()
  await page.getByText('和 AI 一起修改', { exact: true }).waitFor()
  await page.screenshot({ path: 'docs/interaction-preview/home-create.png' })
  const nav = page.getByRole('navigation', { name: '主导航' })
  const disclosure = nav.getByRole('button', { name: '创作', exact: true })
  await disclosure.click()
  await nav.getByRole('link', { name: /我的项目/ }).waitFor()
  await disclosure.press('Escape')
  assert.equal(await disclosure.getAttribute('aria-expanded'), 'false')
  assert.equal(await disclosure.evaluate(el => document.activeElement === el), true)
  await disclosure.click()
  await page.getByRole('heading', { name: '有个想法？ 让它玩起来。' }).click()
  assert.equal(await disclosure.getAttribute('aria-expanded'), 'false')
  await page.getByRole('button', { name: '创建我的项目', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.locator('summary').filter({ hasText: 'AI 助手可以做些什么' }).click()
  assert.equal(await page.locator('details[open]').count(), 1)
  for (const width of [360, 390, 768]) {
    await page.setViewportSize({ width, height: 844 })
    await page.evaluate(() => scrollTo(0, 0))
    await page.getByRole('button', { name: '展开导航', exact: true }).click()
    await nav.getByRole('link', { name: '玩家作品', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '展开导航', exact: true }).getAttribute('aria-expanded'), 'false')
    assert.equal(new URL(page.url()).pathname, '/play')
    await page.getByRole('link', { name: 'TomCat 首页', exact: true }).click()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no horizontal overflow at ${width}px`)
    await page.screenshot({ path: `docs/interaction-preview/home-${width}.png` })
  }
  assert.deepEqual(errors, [])
  console.log('PASS: homepage examples, keyboard tabs, preview steps, disclosure dismissal, login entry, FAQ and mobile navigation')
} finally {
  await browser?.close()
  if (server.exitCode === null) server.kill()
}
