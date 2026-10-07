// 显示比例与工作区持久化的浏览器验收。
//
// 覆盖两件在真实 WASM 编辑器上必须成立的事：
//   1) 引擎界面单位与设备像素比无关：宿主把 devicePixelRatio 交给引擎后，字体图集按
//      「基准字号 x 比例」重烘焙（DPR=2 时 32 -> 64），而画布的 CSS 盒子始终等于视口。
//   2) 工作区布局能落盘、回放，并且拒绝不可用的数据（乱码、空串、只含自定义段——
//      最后一种若被接受会让 ImGui 清掉默认停靠树）。
//
// 需要已构建的引擎产物、开发服务器和真实 Chrome：
//   npm run dev
//   node tests/display-scale.mjs
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true })
const errors = []

/** 一个已登录、已关联云端项目的编辑器页面（云端用假 API 顶替）。 */
const prepare = async (context, projectId) => {
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
    if (path === `/v1/projects/${projectId}`) return reply({ id: 'cloud-probe', name: 'probe', description: '', template: '2D', currentRevisionId: null, etag: null })
    if (path === '/v1/projects' && route.request().method() === 'POST') return reply({ id: 'cloud-probe', name: 'probe', description: '', template: '2D', currentRevisionId: null, etag: null }, 201)
    return reply({ enabled: false })
  })
  return page
}

/** 打开编辑器并等画布就绪（引擎首次加载需要下载 _framework）。 */
const openEditor = async (page, projectId = 'local-probe') => {
  await page.goto(`${base}/editor/${projectId}`)
  await page.waitForFunction(() => {
    const frame = document.querySelector('iframe')
    const canvas = frame?.contentDocument?.querySelector('#canvas')
    return canvas && canvas.width > 1
  }, null, { timeout: 240000 })
  await page.waitForTimeout(2000)
}

/** 画布指标 + 引擎侧真实生效的界面缩放（通过 editor.setDisplayScale 的应答读回）。 */
const snapshot = page => page.evaluate(() => {
  const frame = document.querySelector('iframe')
  const inner = frame.contentWindow
  const canvas = frame.contentDocument.querySelector('#canvas')
  const rect = canvas.getBoundingClientRect()
  const rpc = (type, payload) => JSON.parse(inner.TomCatWeb.engine.EditorRpc(JSON.stringify({
    protocol: 'tomcat.web.v1', requestId: `probe-${type}`, type, payload,
  }))).result
  return {
    dpr: inner.devicePixelRatio,
    inner: [inner.innerWidth, inner.innerHeight],
    bitmap: [canvas.width, canvas.height],
    client: [canvas.clientWidth, canvas.clientHeight],
    rect: [Math.round(rect.width), Math.round(rect.height)],
    scale: rpc('editor.setDisplayScale', { scale: inner.devicePixelRatio }),
  }
})

try {
  // --- 1) 界面单位与 DPR 无关 ------------------------------------------------
  for (const dpr of [1, 1.25, 1.5, 2]) {
    const context = await browser.newContext({ deviceScaleFactor: dpr, viewport: { width: 1000, height: 700 } })
    const page = await prepare(context, 'local-probe')
    await openEditor(page)
    const state = await snapshot(page)
    const label = `DPR ${dpr}`
    assert.equal(state.scale.applied, true, `${label}: 引擎未接受显示比例`)
    assert.equal(state.scale.effectiveScale, dpr, `${label}: 生效比例应为 ${dpr}，实际 ${state.scale.effectiveScale}`)
    // 字体图集按比例重烘焙：基准 32 接口单位 -> 32 x dpr 物理像素
    assert.equal(state.scale.bakedFontSize, Math.round(state.scale.baseFontSize * dpr),
      `${label}: 字体图集未按比例重烘焙（${state.scale.baseFontSize} -> ${state.scale.bakedFontSize}）`)
    // 引擎坐标系 = 画布 CSS 盒子 = 视口；绘制缓冲是 CSS x DPR（Emscripten 用 Math.floor）
    assert.deepEqual(state.client, state.inner, `${label}: 画布 CSS 盒子不等于视口`)
    assert.deepEqual(state.rect, state.inner, `${label}: 画布可见区域不等于视口`)
    assert.deepEqual(state.bitmap, [Math.floor(state.client[0] * dpr), Math.floor(state.client[1] * dpr)],
      `${label}: 绘制缓冲不是 CSS x DPR（${state.client.join('x')} x ${dpr} -> ${state.bitmap.join('x')}）`)
    console.log(`${label}: effective=${state.scale.effectiveScale} font=${state.scale.baseFontSize}->${state.scale.bakedFontSize} 缓冲 ${state.bitmap.join('x')} 画布 ${state.client.join('x')} 视口 ${state.inner.join('x')}`)
    await context.close()
  }

  // --- 2) 工作区布局：落盘、回放、拒绝坏数据 ---------------------------------
  const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1100, height: 760 } })
  const page = await prepare(context, 'local-probe')
  await openEditor(page)
  // 宿主每 2 秒比对一次工作区并落盘
  await page.waitForTimeout(3000)
  const stored = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k === 'tomcat.web-editor-layout.v1')
    return { key: key ?? null, settings: key ? localStorage.getItem(key) : '' }
  })
  assert.ok(stored.key, '工作区未落盘：localStorage 里没有布局键')
  // blob = 引擎段（版本 + 面板掩码）+ ImGui 托管段
  assert.match(stored.settings, /^1\n\[TomCatWebPanelLayout\]\[v1\]\n\d+\n/, '布局 blob 缺少引擎段或版本号')
  assert.match(stored.settings, /\[(Window|Table|Docking)\]\[/, '布局 blob 缺少 ImGui 托管段')
  console.log(`布局已落盘：${stored.key}（${stored.settings.length} 字节，含引擎段与托管段）`)

  await page.reload()
  await openEditor(page)
  const roundtrip = await page.evaluate(() => {
    const inner = document.querySelector('iframe').contentWindow
    const current = JSON.parse(inner.TomCatWeb.engine.EditorRpc(JSON.stringify({
      protocol: 'tomcat.web.v1', requestId: 'save2', type: 'editor.saveLayout', payload: {},
    }))).result.settings
    const key = Object.keys(localStorage).find(k => k === 'tomcat.web-editor-layout.v1')
    return { current, stored: key ? localStorage.getItem(key) : '' }
  })
  assert.equal(roundtrip.current, roundtrip.stored, '重载后的工作区与存储内容不一致')
  console.log(`布局往返一致：${roundtrip.current.length} 字节`)

  const rejected = await page.evaluate(() => {
    const inner = document.querySelector('iframe').contentWindow
    const load = settings => JSON.parse(inner.TomCatWeb.engine.EditorRpc(JSON.stringify({
      protocol: 'tomcat.web.v1', requestId: 'load', type: 'editor.loadLayout', payload: { settings },
    }))).result.applied
    return {
      garbage: load('not a layout'),
      empty: load(''),
      // 只含自定义段：经 ImGui 载入会清掉默认停靠树，必须拒绝
      customOnly: load('1\n[TomCatWebPanelLayout][v1]\n63\n[TomCatToolbar]\nfoo=1\n'),
    }
  })
  for (const [name, applied] of Object.entries(rejected)) assert.equal(applied, false, `${name} 不应被接受`)
  console.log(`坏数据一律拒绝：${Object.keys(rejected).join(', ')}`)
  await context.close()

  assert.deepEqual(errors, [], `页面错误：${errors.join('; ')}`)
  console.log('显示比例与工作区持久化验收通过。')
} finally {
  await browser.close()
}
