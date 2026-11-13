import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5199'
const output = '.engine/catalog-qa/' + new Date().toISOString().replace(/[:.]/g, '-')
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = [], checks = []
page.on('pageerror', e => errors.push(e.message))
const samples = [
  { id: 'return', title: 'Return / Echo World', subtitle: '切换生死世界，推动箱子、触发机关。', author: 'Tc 引擎示例', category: '解谜', image: '/samples/return/cover.png', color: '#cbd8d2', description: '像素平台解谜示例。' },
  { id: 'shelter', title: 'Shelter · 避难所', subtitle: '风暴将至，为居民留下一处家园。', author: 'Tc 引擎示例', category: '策略', image: '/samples/shelter/gameplay.png', color: '#bd9c6d', description: '避难所示例。' },
  { id: 'rougelike', title: 'Rougelike · 几何竞技场', subtitle: '挥出刀光，在十波围攻中找到自己的节奏。', author: 'Tc 引擎示例', category: '动作', image: '/samples/rougelike/cover.png', color: '#f7f7e2', description: '几何竞技场示例。' },
  { id: 'physics-lab', title: 'Physics Lab · 物理实验室', subtitle: '观察重力、旋转与碰撞如何发生。', author: 'Tc 引擎示例', category: '物理', image: '/samples/physics-lab/cover.png', color: '#d8e1d0', description: '物理实验室示例。' },
]
await page.route('**/v1/**', r => {
  const path = new URL(r.request().url()).pathname
  if (path === '/v1/auth/me') return r.fulfill({ status: 401, json: {} })
  if (path === '/v1/games') return r.fulfill({ json: samples })
  return r.fulfill({ status: 200, json: [] })
})
const titles = ['Return / Echo World', 'Shelter · 避难所', 'Rougelike · 几何竞技场', 'Physics Lab · 物理实验室']
const ids = ['return', 'shelter', 'rougelike', 'physics-lab']
try {
  await page.goto(base)
  const carousel = page.getByRole('region', { name: '精选引擎示例' })
  await carousel.scrollIntoViewIfNeeded()
  assert.equal(await page.locator('.game-grid .game-card').count(), 4)
  assert.doesNotMatch(await page.locator('body').innerText(), /林间来信|日落以后|方寸之间/)
  assert.equal(await page.locator('a[href="/games/forest"],a[href="/games/desert"],a[href="/games/puzzle"]').count(), 0)
  assert.equal(await page.locator('iframe').count(), 0, 'Carousel must not boot game runtimes')
  for (let i = 0; i < ids.length; i++) {
    await carousel.getByRole('button', { name: `展示 ${titles[i]}`, exact: true }).click()
    assert.equal(await carousel.getAttribute('data-game-id'), ids[i])
    assert.equal(await carousel.getByRole('link', { name: `体验 ${titles[i]}`, exact: true }).getAttribute('href'), `/games/${ids[i]}`)
    await carousel.locator('img').evaluate(img => img.decode())
    assert.ok(await carousel.locator('img').evaluate(img => img.naturalWidth >= 1000))
    await carousel.screenshot({ path: `${output}/desktop-${ids[i]}.png` })
  }
  checks.push('four real sample images, matching links, no obsolete catalog entries or game iframes')
  await carousel.getByRole('button', { name: `展示 ${titles[0]}`, exact: true }).click()
  await page.evaluate(() => document.activeElement?.blur())
  await page.mouse.move(0, 0)
  await page.waitForFunction(() => document.querySelector('.sample-carousel')?.dataset.gameId === 'shelter', null, { timeout: 9000 })
  await carousel.hover()
  await page.waitForTimeout(6500)
  assert.equal(await carousel.getAttribute('data-game-id'), 'shelter', 'hover pauses rotation')
  await carousel.getByRole('button', { name: '暂停自动轮播', exact: true }).click()
  await page.evaluate(() => document.activeElement?.blur())
  await page.mouse.move(0, 0)
  await page.waitForTimeout(6500)
  assert.equal(await carousel.getAttribute('data-game-id'), 'shelter', 'explicit pause persists after leaving')
  await carousel.getByRole('button', { name: '下一个示例', exact: true }).click()
  assert.equal(await carousel.getAttribute('data-game-id'), 'rougelike')
  checks.push('desktop automatic advance, hover pause, explicit pause and manual advance')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await carousel.scrollIntoViewIfNeeded(); await page.mouse.move(0, 0)
  await page.waitForTimeout(6500)
  assert.equal(await carousel.getAttribute('data-game-id'), 'return')
  assert.equal(await carousel.getByRole('button', { name: '暂停自动轮播', exact: true }).count(), 0)
  checks.push('reduced-motion disables automatic rotation')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload(); await carousel.scrollIntoViewIfNeeded()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile horizontal overflow')
  await carousel.getByRole('button', { name: '下一个示例', exact: true }).click()
  assert.equal(await carousel.getAttribute('data-game-id'), 'shelter')
  await carousel.screenshot({ path: `${output}/mobile.png` })
  checks.push('mobile layout and manual rotation')
  assert.deepEqual(errors, [])
  writeFileSync(`${output}/evidence.json`, JSON.stringify({ status: 'passed', base, checks, errors, browser: browser.version() }, null, 2))
  console.log(`Catalog browser checks passed: ${output}`)
} finally { await browser.close() }
