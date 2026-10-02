// 验证 HiDPI：绘制缓冲是否等于 CSS x DPR（逐物理像素渲染），且视觉尺寸仍等于视口。
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'
const commit = process.env.ENGINE_COMMIT
const lockPath = 'engine.lock.json'
const original = readFileSync(lockPath, 'utf8')
writeFileSync(lockPath, `${JSON.stringify({ ...JSON.parse(original), commit }, null, 2)}\n`)

const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true })
let failed = false
try {
  for (const dpr of [1, 1.5, 2]) {
    const context = await browser.newContext({ deviceScaleFactor: dpr, viewport: { width: 1000, height: 700 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      localStorage.setItem('tomcat-ui-projects-v2-engine-test', JSON.stringify([
        { id: 'local-probe', name: 'probe', template: '2D', image: '', status: 'draft', updated: '今天', description: '' },
      ]))
    })
    await page.route('**/v1/**', route => {
      const path = new URL(route.request().url()).pathname
      const reply = (body, status = 200) => route.fulfill({ status, json: body })
      if (path === '/v1/auth/me') return reply({ id: 'engine-test', username: 'engine-test' })
      if (path === '/v1/projects/local-probe') return reply({ id: 'cloud-probe', name: 'probe', description: '', template: '2D', currentRevisionId: null, etag: null })
      if (path === '/v1/projects' && route.request().method() === 'POST') return reply({ id: 'cloud-probe', name: 'probe', description: '', template: '2D', currentRevisionId: null, etag: null }, 201)
      return reply({ enabled: false })
    })
    await page.goto(`${base}/editor/local-probe`)
    await page.waitForFunction(() => {
      const frame = document.querySelector('iframe')
      const canvas = frame?.contentDocument?.querySelector('#canvas')
      return canvas && canvas.width > 1
    }, null, { timeout: 240000 })
    await page.waitForTimeout(2500)
    const state = await page.evaluate(() => {
      const frame = document.querySelector('iframe')
      const inner = frame.contentWindow
      const canvas = frame.contentDocument.querySelector('#canvas')
      const stage = frame.contentDocument.querySelector('#stage')
      const rect = canvas.getBoundingClientRect()
      return {
        dpr: inner.devicePixelRatio,
        inner: [inner.innerWidth, inner.innerHeight],
        bitmap: [canvas.width, canvas.height],
        client: [canvas.clientWidth, canvas.clientHeight],
        rect: [Math.round(rect.width), Math.round(rect.height)],
        stage: [stage.style.width, stage.style.height, stage.style.transform || 'none'],
        canvasStyle: [canvas.style.width || '(none)', canvas.style.height || '(none)'],
      }
    })
    // Emscripten 的 updateCanvasDimensions 用 Math.floor 处理 CSS x DPR
    // （library_glfw.js: const wNativeScaled = Math.floor(wNative * scale)），期望值用同一取整，
    // 免得把取整差异当成缺陷。
    const expectBacking = [Math.floor(state.client[0] * dpr), Math.floor(state.client[1] * dpr)]
    const crisp = state.bitmap[0] === expectBacking[0] && state.bitmap[1] === expectBacking[1]
    const visual = state.rect[0] === state.inner[0] && state.rect[1] === state.inner[1]
    if (!crisp || !visual || errors.length) failed = true
    console.log(
      `DPR ${dpr}: 缓冲 ${state.bitmap.join('x')} 期望 ${expectBacking.join('x')} ${crisp ? 'OK' : '不符'} |`,
      `画布 CSS ${state.client.join('x')} 可见 ${state.rect.join('x')} 视口 ${state.inner.join('x')} ${visual ? 'OK' : '不符'} |`,
      `stage ${state.stage.join(',')} canvas样式 ${state.canvasStyle.join(',')}`,
      errors.length ? `| 页面错误 ${errors.join('; ')}` : '',
    )
    await context.close()
  }
} finally {
  writeFileSync(lockPath, original)
  await browser.close()
}
console.log(failed ? '结论：仍有不符合项' : '结论：全部符合（绘制缓冲 = CSS x DPR，视觉尺寸 = 视口）')
process.exitCode = failed ? 1 : 0
