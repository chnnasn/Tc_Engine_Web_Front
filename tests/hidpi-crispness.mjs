// HiDPI 清晰度验收：绘制缓冲必须等于 CSS 尺寸 x 设备像素比。
//
// 引擎（Emscripten GLFW）让窗口成为 HiDPI aware 后（GLFW_SCALE_TO_MONITOR），
// updateCanvasDimensions 会把绘制缓冲设成 floor(CSS x devicePixelRatio)，而 clientWidth 与
// glfwGetWindowSize 仍是逻辑尺寸——ImGui 的 DisplayFramebufferScale 正是这两者的比值。
// 缺少这一条时缓冲等于 CSS 尺寸，界面由浏览器放大，在高 DPI 屏上偏软。
//
// 需要已构建的引擎产物、开发服务器与真实 Chrome：
//   npm run dev
//   node tests/hidpi-crispness.mjs
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true })
const errors = []

/** 读一次画布指标；引擎宿主尚未就绪时返回 pending，由调用方重试。 */
const measure = page => page.evaluate(() => {
  const frame = document.querySelector('iframe')
  if (!frame?.contentWindow || !frame.contentDocument) return { pending: true, frames: document.querySelectorAll('iframe').length }
  const inner = frame.contentWindow
  const canvas = frame.contentDocument.querySelector('#canvas')
  if (!canvas || canvas.width <= 1) return { pending: true, frames: 1 }
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

/** 宿主 iframe 可能被重建（页面重新挂载引擎表面），因此重试到它稳定。 */
const measureStable = async page => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = await measure(page)
    if (!state.pending) return state
    await page.waitForTimeout(500)
  }
  throw new Error('引擎宿主 iframe 一直不可用')
}

const openEditor = async page => {
  await page.goto(`${base}/editor/local-probe`)
  await page.waitForFunction(() => {
    const canvas = document.querySelector('iframe')?.contentDocument?.querySelector('#canvas')
    return canvas && canvas.width > 1
  }, null, { timeout: 240000 })
  await page.waitForTimeout(2500)
}

try {
  for (const dpr of [1, 1.5, 2]) {
    const context = await browser.newContext({ deviceScaleFactor: dpr, viewport: { width: 1000, height: 700 } })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      localStorage.setItem('tomcat-ui-projects-v2-engine-test', JSON.stringify([
        { id: 'local-probe', name: 'probe', template: '2D', image: '', status: 'draft', updated: '今天', description: '' },
      ]))
    })
    await page.route('**/v1/**', route => {
      const path = new URL(route.request().url()).pathname
      const reply = (body, status = 200) => route.fulfill({ status, json: body })
      if (path === '/v1/auth/me') return reply({ id: 'engine-test', email: 'engine-test@example.com', emailVerified: true })
      if (path === '/v1/projects/local-probe') return reply({ id: 'cloud-probe', name: 'probe', description: '', template: '2D', currentRevisionId: null, etag: null })
      if (path === '/v1/projects' && route.request().method() === 'POST') return reply({ id: 'cloud-probe', name: 'probe', description: '', template: '2D', currentRevisionId: null, etag: null }, 201)
      return reply({ enabled: false })
    })
    await openEditor(page)
    const state = await measureStable(page)

    // Emscripten 用 Math.floor 处理 CSS x DPR：
    // library_glfw.js: const wNativeScaled = Math.floor(wNative * scale);
    const expectBacking = [Math.floor(state.client[0] * dpr), Math.floor(state.client[1] * dpr)]
    const label = `DPR ${dpr}`
    assert.deepEqual(state.bitmap, expectBacking,
      `${label}: 绘制缓冲应为 floor(CSS x DPR) = ${expectBacking.join('x')}，实际 ${state.bitmap.join('x')}`)
    assert.deepEqual(state.client, state.inner, `${label}: 画布 CSS 盒子不等于视口`)
    assert.deepEqual(state.rect, state.inner, `${label}: 画布可见区域不等于视口`)
    assert.equal(state.stage[2], 'none', `${label}: 舞台不应有缩放变换`)
    console.log(`${label}: 缓冲 ${state.bitmap.join('x')} = CSS ${state.client.join('x')} x ${dpr} | 可见 ${state.rect.join('x')} 视口 ${state.inner.join('x')} | canvas样式 ${state.canvasStyle.join(',')}`)
    await context.close()
  }
  assert.deepEqual(errors, [], `页面错误：${errors.join('; ')}`)
  console.log('HiDPI 验收通过：绘制缓冲等于 CSS x DPR，视觉尺寸等于视口。')
} finally {
  await browser.close()
}
