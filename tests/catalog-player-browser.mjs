import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5200'
const output = '.engine/catalog-qa/player-' + new Date().toISOString().replace(/[:.]/g, '-')
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = [], logs = [], games = []
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => logs.push(m.text()))
if (process.env.TEST_LIVE_BACKEND !== '1') await page.route('**/v1/**', r => r.fulfill({ status: r.request().url().includes('/auth/me') ? 401 : 200, json: [] }))
try {
  for (const id of ['return', 'shelter', 'rougelike', 'physics-lab']) {
    console.log(`Opening ${id}`)
    await page.goto(`${base}/games/${id}`)
    await page.getByRole('button', { name: '开始游玩', exact: true }).first().click()
    await page.locator('.player-status').filter({ hasText: '已就绪' }).waitFor({ timeout: 240000 })
    const frame = page.frames().find(f => f !== page.mainFrame()), canvas = frame.locator('canvas')
    assert.ok(await canvas.isVisible())
    await canvas.click(); await page.keyboard.press('Enter'); await page.waitForTimeout(1200)
    await canvas.screenshot({ path: `${output}/${id}.png` })
    assert.deepEqual(errors, [])
    assert.deepEqual(logs.filter(s => /Unhandled exception|callback.*threw|\[tomcat-host\] fail/i.test(s)), [])
    await page.getByRole('button', { name: '停止', exact: true }).click()
    assert.equal(await page.locator('iframe').count(), 0)
    games.push(id); console.log(`${id}: real engine ready, input and stop passed`)
  }
  await page.route('**/samples/physics-lab/physics-lab.tcpak*', r => r.fulfill({ status: 404, body: 'missing' }))
  await page.goto(`${base}/games/physics-lab`)
  await page.getByRole('button', { name: '开始游玩', exact: true }).first().click()
  await page.getByRole('alert').filter({ hasText: '这个示例的游戏资源暂时无法找到' }).waitFor()
  assert.equal(await page.locator('iframe').count(), 0)
  assert.deepEqual(errors, [])
  writeFileSync(`${output}/evidence.json`, JSON.stringify({ status: 'passed', base, games, errors, logs, missingPackage: 'passed' }, null, 2))
  console.log(`Catalog player checks passed: ${output}`)
} catch (error) {
  writeFileSync(`${output}/failure.json`, JSON.stringify({ base, games, error: error.message, errors, logs }, null, 2))
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {})
  console.error(logs.slice(-30)); throw error
} finally { await browser.close() }
