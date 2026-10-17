import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5187'
const output = resolve('.engine/return-homepage-qa', new Date().toISOString().replace(/[:.]/g, '-'))
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.route('**/v1/**', route => route.fulfill({ status: route.request().url().includes('/auth/me') ? 401 : 200, json: [] }))
try {
  await page.goto(base)
  const featured = page.getByRole('region', { name: '精选引擎示例：Return / Echo World' })
  await featured.waitFor()
  const image = featured.locator('img')
  await image.evaluate(image => image.decode())
  assert.ok(await image.evaluate(image => image.naturalWidth > 0))
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true })
  await page.getByRole('link', { name: '体验 Echo World', exact: true }).click()
  await page.waitForURL('**/games/return')
  await page.getByRole('heading', { name: 'Return / Echo World', exact: true }).waitFor()
  const download = page.getByRole('link', { name: '下载示例工程', exact: true })
  assert.equal(await download.getAttribute('href'), '/samples/return/return-source.zip')
  const zip = await page.request.get(new URL(await download.getAttribute('href'), base).href)
  assert.equal(zip.status(), 200)
  assert.equal((await zip.body()).subarray(0, 4).toString('hex'), '504b0304')
  await page.screenshot({ path: `${output}/detail.png`, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(base)
  await featured.waitFor()
  await featured.getByRole('heading', { name: 'Return / Echo World', exact: true }).waitFor()
  const mobileCta = featured.getByRole('link', { name: '体验 Echo World', exact: true })
  assert.ok(await mobileCta.isVisible(), 'Mobile sample action is missing')
  const titleBounds = await featured.locator('h2').boundingBox()
  const ctaBounds = await mobileCta.boundingBox()
  assert.ok(titleBounds && ctaBounds && titleBounds.x >= 0 && ctaBounds.x >= 0
    && titleBounds.x + titleBounds.width <= 390 && ctaBounds.x + ctaBounds.width <= 390,
  'Mobile sample title or action is clipped')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile homepage overflows horizontally')
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true })
  assert.deepEqual(errors, [])
  writeFileSync(`${output}/evidence.json`, JSON.stringify({ status: 'passed', base, browser: browser.version(), errors, desktop: [1440, 1000], mobile: [390, 844] }, null, 2))
  console.log(`Return homepage, detail, image, ZIP and mobile layout passed: ${output}`)
} finally { await browser.close() }
