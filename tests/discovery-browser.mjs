import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
const fixtures = Array.from({ length: 7 }, (_, i) => ({
  id: `published-${i}`, title: `真实发布作品 ${i + 1}`, description: `创作者完成的冒险 ${i + 1}`,
  byteLength: 1024, etag: 'fixture', publishedAt: `2026-10-${String(7-i).padStart(2,'0')}T04:00:00Z`, engineCommit: 'fixture',
}))
let data = []
let failure = false
let release
let gate = new Promise(resolve => { release = resolve })
let reads = 0
await page.route('**/v1/**', async route => {
  const path = new URL(route.request().url()).pathname
  if (path === '/v1/games/published') {
    reads++
    await gate
    return route.fulfill({ status: failure ? 503 : 200, json: failure ? { error: '暂时不可用，请重试' } : data })
  }
  if (path === '/v1/auth/me') return route.fulfill({ status: 401, json: {} })
  return route.fulfill({ json: [] })
})
const recommendations = page.locator('.home-published')
mkdirSync('.engine/discovery-design', { recursive: true })
try {
  await page.goto(base)
  await recommendations.getByRole('status').waitFor()
  assert.equal(await recommendations.locator('.published-empty').count(), 0, 'loading must not appear empty')
  release()
  await recommendations.getByRole('heading', { name: '还没有已发布的玩家作品' }).waitFor()
  assert.equal(await recommendations.locator('a[href^="/games/"]').count(), 0, 'never substitute examples for real recommendations')
  assert.equal(await page.locator('.discover-section .game-card').count(), 3)
  assert.match(await page.locator('#discover-title').innerText(), /示例体验/)
  assert.equal(await page.getByRole('combobox', { name: '游戏排序' }).count(), 0)
  await page.getByPlaceholder('搜索示例').fill('方寸')
  assert.equal(await page.locator('.discover-section .game-card').count(), 1)
  assert.equal(await recommendations.locator('.published-empty').count(), 1)
  await page.getByPlaceholder('搜索示例').fill('')
  await page.screenshot({ path: '.engine/discovery-design/home-empty.png', fullPage: true })

  data = fixtures
  await recommendations.getByRole('button', { name: '刷新作品' }).click()
  await recommendations.locator('.published-card').first().waitFor()
  assert.equal(await recommendations.locator('.published-card').count(), 6)
  assert.equal(await recommendations.locator('.published-card h3').first().textContent(), fixtures[0].title)
  assert.equal(await recommendations.locator('a[href^="/play/"]').first().getAttribute('href'), '/play/published-0')
  await page.screenshot({ path: '.engine/discovery-design/home-published.png', fullPage: true })

  await recommendations.getByRole('link', { name: /查看全部作品/ }).click()
  await page.waitForURL('**/play')
  await page.locator('.published-card').first().waitFor()
  assert.equal(await page.locator('.published-card').count(), 7)
  await page.getByPlaceholder('搜索玩家作品').fill('不存在的作品')
  await page.getByText('没有找到匹配的玩家作品', { exact: true }).waitFor()
  assert.equal(await page.getByRole('heading', { name: '还没有已发布的玩家作品' }).count(), 0)
  await page.getByRole('button', { name: '清空搜索' }).click()
  assert.equal(await page.locator('.published-card').count(), 7)
  failure = true
  await page.getByRole('button', { name: '刷新作品' }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.locator('.published-empty').count(), 0, 'request errors must not appear as no published games')
  failure = false
  data = fixtures.slice(1)
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await page.locator('.published-card').first().waitFor()
  assert.equal(await page.locator('.published-card').count(), 6)
  assert.equal(await page.getByRole('heading', { name: fixtures[0].title, exact: true }).count(), 0, 'unpublished games disappear on refresh')

  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: '.engine/discovery-design/player-mobile.png', fullPage: true })
  await page.goto(base)
  await recommendations.locator('.published-card').first().waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  failure = true
  await recommendations.getByRole('button', { name: '刷新作品' }).click()
  await recommendations.getByRole('alert').waitFor()
  assert.equal(await page.locator('.discover-section .game-card').count(), 3, 'examples remain usable during API failure')
  failure = false
  data = []
  await recommendations.getByRole('button', { name: '重试', exact: true }).click()
  await recommendations.locator('.published-empty').waitFor()
  await page.screenshot({ path: '.engine/discovery-design/home-mobile.png', fullPage: true })
  assert.ok(reads >= 6)
  assert.deepEqual(errors, [])
  console.log('PASS: real published API on both pages, loading/empty/error/retry, latest six links, full list/search, withdrawn games, separate examples, mobile layout.')
} finally { await browser.close() }
