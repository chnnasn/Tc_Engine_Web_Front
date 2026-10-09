import { addEntity, preview, waitMode, fillCode, openNativeScripts, dragFirstNativeScript, engineRpc, engineState } from './engine-browser-helpers.mjs'
import { readScripts } from '../src/engine/scene-archive.ts'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'
if (!process.argv.includes('--missing')) {
  execFileSync(process.execPath, ['tests/player-fixture.cjs'], { stdio: 'inherit' })
  // 播放器改从后端取包，示例包需要先从引擎烘焙产物派生出来。
  execFileSync(process.execPath, ['scripts/build-sample-games.mjs'], { stdio: 'inherit' })
}
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
// The engine regression uses an authenticated cloud fixture; guest access has its own suite.
await page.addInitScript(() => {
  localStorage.setItem('tomcat-ui-projects-v2-engine-test', JSON.stringify([{ id: 'my-first-game', name: '我的第一个游戏', description: '', template: '2D', image: '', status: 'draft', updated: '今天' }]))
})
await page.route('**/v1/**', route => {
  const path = new URL(route.request().url()).pathname
  const json = (value, headers = {}) => route.fulfill({ json: value, headers })
  // 示例游戏包由后端提供：forest 是真实包，desert 故意损坏，puzzle 缺包。
  if (path.startsWith('/v1/games/') && path.endsWith('/package')) {
    const id = path.split('/')[3]
    if (id === 'forest') return route.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream' }, body: readFileSync('.engine/games/forest.tcpak') })
    if (id === 'desert') return route.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from('not a tcpak') })
    return route.fulfill({ status: 404, json: { error: '没有这个示例游戏包。' } })
  }
  if (path === '/v1/auth/me') return json({ id: 'engine-test', email: 'engine-test@example.com', emailVerified: true })
  if (path === '/v1/projects/sync-config') return json({ enabled: false })
  if (path.endsWith('/ai-sessions/')) return json([])
  if (path === '/v1/projects' && route.request().method() === 'GET') return json([])
  if (path.includes('/uploads/')) return json({ uploadId: 'a'.repeat(32), contentHash: path.split('/').pop(), size: route.request().postDataBuffer().length })
  if (path.endsWith('/revisions')) return json({ etag: '"' + 'b'.repeat(32) + '"' }, { etag: '"' + 'b'.repeat(32) + '"' })
  return json({ id: 'engine-project', currentRevisionId: null, etag: null })
})
const errors = []
const logs = []
page.on('pageerror', error => errors.push(error.message))
// SwiftShader 软件渲染会刷大量 glClear 警告，过滤掉以免淹没脚本日志。
page.on('console', message => { const text = message.text(); if (!text.includes('GL_INVALID_OPERATION')) logs.push(text) })
page.on('dialog', dialog => dialog.accept())
try {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(base)).ok) break } catch { /* Preview may still be starting. */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  if (process.argv.includes('--missing')) await page.context().route('**/engine/**/manifest.json', route => route.fulfill({ status: 404, body: 'missing' }))
  const response = await page.goto(`${base}/editor/my-first-game`)
  assert.equal(response.headers()['cross-origin-opener-policy'], 'same-origin')
  assert.equal(response.headers()['cross-origin-embedder-policy'], 'require-corp')
  assert.equal(await page.evaluate(() => crossOriginIsolated), true)
  if (process.argv.includes('--missing')) {
    await page.getByRole('alert').waitFor({ timeout: 30000 })
    assert.match(await page.getByRole('alert').textContent(), /engine:build/)
    assert.equal(await page.locator('iframe').count(), 0)
    await page.getByRole('button', { name: '返回项目' }).click()
    await page.getByRole('heading', { name: '我的项目' }).waitFor()
  } else {
    const save = page.getByRole('button', { name: '保存到云端', exact: true })
    await save.waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '保存到云端' && !b.disabled), null, { timeout: 240000 })
    await addEntity(page)
    const tga = Buffer.from([0,0,2,0,0,0,0,0,0,0,0,0,1,0,1,0,24,0,0,0,255])
    await page.locator('input[type=file]').setInputFiles({ name: 'red.tga', mimeType: 'application/octet-stream', buffer: tga })
    await page.getByText('图片已导入，请保存项目', { exact: true }).waitFor()
    await save.click()
    await page.getByText('已保存到数据库', { exact: true }).waitFor()
    const saved = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('tomcat-engine-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
      const value = await new Promise(resolve => { const r = db.transaction('projects').objectStore('projects').get('my-first-game'); r.onsuccess = () => resolve(r.result) })
      db.close(); return value
    })
    assert.equal(saved.format, 'tomcat-engine-project'); assert.match(saved.archive, /New Entity/)
    assert.ok(Object.keys(saved.files).some(path => path.endsWith('.tga')))
    assert.ok(Object.keys(saved.files).some(path => path.endsWith('.tga.tcmeta')))
    await page.reload()
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '保存到云端' && !b.disabled), null, { timeout: 240000 })
    assert.equal(await page.getByText('我的第一个游戏 · 未保存', { exact: true }).count(), 0)
    await preview(page, 'play')
    await preview(page, 'pause')
    await preview(page, 'step')
    assert.equal(await page.getByRole('button', { name: '添加对象', exact: true }).count(), 0)
    await preview(page, 'resume')
    await preview(page, 'stop')
    await waitMode(page, 'edit')
    assert.equal(await page.getByText('我的第一个游戏 · 未保存', { exact: true }).count(), 0)
    mkdirSync('.engine', { recursive: true }); await page.screenshot({ path: '.engine/editor-browser.png' })
    // C# 脚本：浏览器内 Roslyn 编译、托管 ABI 安装与诊断回传。
    const scriptSource = `using TomCat;
public sealed class WebSmoke : MonoBehaviour
{
    private void Awake()
    {
        Log.Info("WEB_SMOKE_ONCREATE");
        Tasks.Run(async token => {
            try {
                await Tasks.NextFrame(token);
                Log.Info("WEB_TASK_FRAME");
                await Tasks.NextFixedStep(token);
                Log.Info("WEB_TASK_FIXED");
                while (true) await Tasks.NextFrame(token);
            } finally { Log.Info("WEB_TASK_CANCELLED"); }
        });
        StartCoroutine(Routine());
    }
    private void Start() { Log.Info("WEB_START"); }
    private void Update() { }
    private System.Collections.IEnumerator Routine()
    {
        try {
            yield return Yield.Frames(2);
            yield return Yield.Seconds(0);
            yield return Yield.Until(() => true);
            yield return Yield.FixedStep;
            Log.Info("WEB_COROUTINE_READY");
            while (true) yield return null;
        } finally { Log.Info("WEB_COROUTINE_CANCELLED"); }
    }
    private void OnDestroy() { Log.Info("WEB_DESTROY"); }
}
`
    await page.getByRole('button', { name: 'C# 脚本', exact: true }).click()
    await page.getByPlaceholder('新脚本类名').fill('WebSmoke')
    await page.getByRole('button', { name: '新建', exact: true }).click()
    await page.locator('.script-panel .list li', { hasText: 'WebSmoke' }).first().waitFor({ timeout: 30000 })
    await fillCode(page, scriptSource)
    await page.getByRole('button', { name: '编译并安装', exact: true }).click()
    await page.locator('.script-panel .state.ok').waitFor({ timeout: 240000 })
    assert.equal(await page.locator('.script-panel .diagnostics li.error').count(), 0)
    // 挂载到选中实体并运行预览：证明浏览器内 C# 真的被引擎执行（而不只是编译通过）。
    await page.getByRole('button', { name: 'C# 脚本', exact: true }).click()
    await openNativeScripts(page)
    await dragFirstNativeScript(page)
    const attached = await engineRpc(page, 'scene.snapshot', { sceneHandle: (await engineState(page)).sceneHandle })
    assert.equal(readScripts(attached.archive, attached.entities.find(entity => entity.name === 'Player').id)[0]?.className, 'WebSmoke', 'native Project drag attaches the compiled script')
    await preview(page, 'play')
    await waitMode(page, 'play')
    for (let tries = 0; tries < 600 && !logs.some(text => text.includes('WEB_SMOKE_ONCREATE')); tries++) await new Promise(resolve => setTimeout(resolve, 100))
    assert.ok(logs.some(text => text.includes('WEB_SMOKE_ONCREATE')), `expected the C# lifecycle log, got ${JSON.stringify(logs.slice(-25))}`)
    const asyncMarkers = ['WEB_START', 'WEB_TASK_FRAME', 'WEB_TASK_FIXED', 'WEB_COROUTINE_READY']
    for (let tries = 0; tries < 300 && !asyncMarkers.every(marker => logs.some(text => text.includes(marker))); tries++) await new Promise(resolve => setTimeout(resolve, 100))
    for (const marker of asyncMarkers) assert.ok(logs.some(text => text.includes(marker)), `missing ${marker}: ${JSON.stringify(logs.slice(-30))}`)
    await preview(page, 'stop')
    await waitMode(page, 'edit')
    for (const marker of ['WEB_TASK_CANCELLED', 'WEB_COROUTINE_CANCELLED']) {
      const cleanup = logs.findIndex(text => text.includes(marker))
      const destroy = logs.findIndex(text => text.includes('WEB_DESTROY'))
      assert.ok(cleanup >= 0 && destroy > cleanup, `${marker} must precede destruction`)
    }
    // 重新打开面板：编译过一代程序集后再次编译，必须给出“重建会话”提示而不是静默失效。
    await page.getByRole('button', { name: 'C# 脚本', exact: true }).click()
    // 故意写入语法错误，验证 Roslyn 诊断被回传并渲染。
    await fillCode(page, 'using TomCat;\npublic sealed class WebSmoke : MonoBehaviour { private void Awake() { int broken = ; } }')
    await page.getByRole('button', { name: '编译并安装', exact: true }).click()
    await page.locator('.script-panel .diagnostics li.error').first().waitFor({ timeout: 240000 })
    assert.match(await page.locator('.script-panel .diagnostics li.error').first().textContent(), /CS\d{4}/)
    assert.equal(await page.locator('.script-panel .state.ok').count(), 0)
    // 程序集已装载过：面板必须提示重建会话，而不是假装能原地热替换。
    await page.locator('.script-panel .rebuild').waitFor({ timeout: 30000 })
    // 恢复可编译内容，并确认脚本随项目一起保存。
    await fillCode(page, scriptSource)
    await page.getByRole('button', { name: '保存脚本', exact: true }).click()
    await page.getByRole('button', { name: 'C# 脚本', exact: true }).click()
    await save.click()
    await page.getByText('已保存到数据库', { exact: true }).waitFor({ timeout: 240000 })
    const withScript = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('tomcat-engine-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
      const value = await new Promise(resolve => { const r = db.transaction('projects').objectStore('projects').get('my-first-game'); r.onsuccess = () => resolve(r.result) })
      db.close(); return Object.keys(value.files).filter(path => path.includes('Scripts/'))
    })
    assert.ok(withScript.includes('Assets/Scripts/WebSmoke.cs'), `expected script in archive, got ${JSON.stringify(withScript)}`)
    assert.ok(withScript.includes('Assets/Scripts/WebSmoke.cs.tcmeta'), `expected script meta in archive, got ${JSON.stringify(withScript)}`)
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: '返回项目' }).click()
      await page.getByRole('heading', { name: '我的项目' }).waitFor()
      assert.equal(await page.locator('iframe').count(), 0)
      await page.goto(`${base}/editor/my-first-game`)
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '保存到云端' && !b.disabled), null, { timeout: 240000 })
    }
    // Exercise the public iframe host using the same MessageChannel contract as Vue.
    await page.goto(`${base}/projects`)
    const result = await page.evaluate(async () => {
      const iframe = document.createElement('iframe'); iframe.style.cssText = 'width:1200px;height:800px'; iframe.src = '/engine-host.html'; document.body.append(iframe)
      await new Promise(resolve => iframe.onload = resolve)
      const channel = new MessageChannel(); let id = 0; const waiting = new Map()
      const ready = new Promise((resolve, reject) => {
        channel.port1.onmessage = e => {
          const d = e.data
          if (d.event === 'ready') resolve(d.snapshot)
          else if (d.event === 'fatal') reject(new Error(d.message))
          else if (waiting.has(d.id)) { const item = waiting.get(d.id); waiting.delete(d.id); d.error ? item.reject(new Error(d.error.code)) : item.resolve(d.result) }
        }
      })
      iframe.contentWindow.postMessage({ type: 'tomcat-connect', kind: 'editor', cloudProjectId: 'engine-project', name: 'Browser regression', template: '2D' }, location.origin, [channel.port2])
      const call = (type, payload = {}) => new Promise((resolve, reject) => { const key = ++id; waiting.set(key, { resolve, reject }); channel.port1.postMessage({ id: key, type, payload }) })
      try {
        const initial = await ready
        const entityId = '18446744073709551615'
        const transform = initial.schemas.find(schema => schema.name === 'TomCat.Transform')
        const next = await call('transact', { state: initial, label: 'Max ID', operations: [{ op: 'entity.create', entityId, name: 'Boundary' }, { op: 'component.patch', entityId, componentId: transform.id, properties: { '1': [1, 2, 0] } }] })
        const undo = await call('history', { state: next, direction: 'undo' })
        const redo = await call('history', { state: undo, direction: 'redo' })
        await call('preview', { command: 'play' }); await call('preview', { command: 'pause' }); await call('preview', { command: 'step' }); await call('preview', { command: 'stop' })
        const captured = await call('capture')
        await call('transact', { state: redo, label: 'Concurrent edit', operations: [{ op: 'entity.rename', entityId, name: 'Changed' }] })
        let conflict = false
        try { await call('markSaved', captured) } catch (error) { conflict = error.message === 'REVISION_CONFLICT' }
        return { schemaCount: initial.schemas.length, entityId: next.selectedEntityId, position: next.entities.find(e => e.id === entityId).components.find(c => c.id === transform.id).values['1'], undone: !undo.entities.some(e => e.id === entityId), redone: redo.entities.some(e => e.id === entityId), conflict }
      } finally { iframe.contentWindow.dispatchEvent(new Event('pagehide')); iframe.remove(); channel.port1.close() }
    })
    assert.ok(result.schemaCount > 0); assert.equal(result.entityId, '18446744073709551615'); assert.deepEqual(result.position, [1, 2, 0]); assert.ok(result.undone && result.redone && result.conflict)
  }
  if (!process.argv.includes('--missing')) {
    // 示例作品：播放器按作品 id 从后端取包，用户不再需要自己上传 TCPAK。
    await page.goto(`${base}/games/forest`)
    await page.getByRole('button', { name: '打开游玩预览' }).click()
    for (let i = 0; i < 2; i++) {
      await page.getByText(/正在运行 林间来信 的游戏包/).waitFor({ timeout: 240000 })
      if (i === 0) await page.screenshot({ path: '.engine/player-browser.png' })
      await page.getByRole('button', { name: '停止', exact: true }).click()
      assert.equal(await page.locator('iframe').count(), 0)
      for (let tries = 0; tries < 100 && page.workers().length; tries++) await new Promise(resolve => setTimeout(resolve, 100))
      assert.equal(page.workers().length, 0, 'pthread workers must terminate on stop')
      if (i === 0) await page.getByRole('button', { name: '重新加载', exact: true }).click()
    }
    await page.getByRole('button', { name: '关闭播放器', exact: true }).click()
    // 高 DPI 回归：引擎把画布的 CSS 盒子当作窗口尺寸、鼠标坐标空间与 ImGui 的 DisplaySize，
    // 把绘制缓冲（glfwGetFramebufferSize）当作 OpenGL 视口，两者的比值就是 ImGui 的
    // DisplayFramebufferScale。Emscripten 的 GLFW 还会用 clientWidth/clientHeight 覆盖绘制缓冲，
    // 所以宿主只把舞台设成 CSS 尺寸、由引擎决定缓冲（见 host.ts applyViewport）：栈里任何
    // "1 CSS 像素 = 1 缓冲像素" 的假设都会让 ImGui 在设备像素坐标系里排版，2x 屏上字号与所有
    // 面板只有应有的一半——这条断言此前固化的正是那个错误行为。
    const hidpi = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 })
    hidpi.on('pageerror', error => errors.push(error.message))
    await hidpi.route('**/v1/**', route => {
      const path = new URL(route.request().url()).pathname
      if (path.startsWith('/v1/games/')) return route.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream' }, body: readFileSync('.engine/games/forest.tcpak') })
      if (path === '/v1/auth/me') return route.fulfill({ json: { id: 'engine-test', email: 'engine-test@example.com', emailVerified: true } })
      return route.fulfill({ json: {} })
    })
    try {
      await hidpi.goto(`${base}/games/forest`)
      await hidpi.getByRole('button', { name: '打开游玩预览' }).click()
      await hidpi.getByText(/正在运行 林间来信 的游戏包/).waitFor({ timeout: 240000 })
      await hidpi.waitForTimeout(1000)
      const surface = await hidpi.evaluate(() => {
        const frame = document.querySelector('iframe')
        const canvas = frame.contentDocument.querySelector('#canvas')
        const stage = frame.contentDocument.querySelector('#stage')
        const rect = canvas.getBoundingClientRect()
        return {
          dpr: frame.contentWindow.devicePixelRatio,
          inner: [frame.contentWindow.innerWidth, frame.contentWindow.innerHeight],
          bitmap: [canvas.width, canvas.height],
          client: [canvas.clientWidth, canvas.clientHeight],
          rect: [Math.round(rect.width), Math.round(rect.height)],
          stageTransform: stage.style.transform || 'none',
          canvasTransform: canvas.style.transform || 'none',
        }
      })
      assert.equal(surface.dpr, 2)
      // 引擎坐标系 = 画布的 CSS 盒子 = 视口：ImGui 就在 CSS 像素里排版，缩放与 DPR 无关。
      assert.deepEqual(surface.client, surface.inner)
      assert.deepEqual(surface.rect, surface.inner)
      // CSS 布局保持逻辑像素；绘制缓冲使用设备像素，且没有额外 CSS 缩放。
      assert.deepEqual(surface.bitmap, surface.client.map(size => Math.round(size * surface.dpr)))
      assert.equal(surface.stageTransform, 'none')
      assert.equal(surface.canvasTransform, 'none')
      await hidpi.locator('.runtime-player').screenshot({ path: '.engine/player-hidpi.png' })
    } finally { await hidpi.close() }
    // 后端没有这个作品的包：给出明确提示，而不是让用户自己去找本地文件。
    await page.goto(`${base}/games/puzzle`)
    await page.getByRole('button', { name: '打开游玩预览' }).click()
    await page.getByRole('alert').waitFor({ timeout: 30000 })
    assert.match(await page.getByRole('alert').textContent(), /后端尚未提供/)
    assert.equal(await page.locator('iframe').count(), 0)
    await page.getByRole('button', { name: '关闭播放器', exact: true }).click()
    // 后端返回损坏的包：引擎拒绝加载，并给出“包损坏/版本不匹配”的提示。
    await page.goto(`${base}/games/desert`)
    await page.getByRole('button', { name: '打开游玩预览' }).click()
    await page.getByRole('alert').waitFor({ timeout: 240000 })
    assert.equal(await page.locator('iframe').count(), 0)
    await page.getByRole('button', { name: '关闭播放器', exact: true }).click()
  }
  assert.deepEqual(errors, [])
  console.log(process.argv.includes('--missing') ? 'PASS: isolation, missing-engine diagnostic and route cleanup' : 'PASS: real managed editor, in-browser C# compile + lifecycle execution, archive persistence, repeated cleanup, uint64, undo/redo, preview, save conflict, backend-served game packages, HiDPI viewport')
} finally { await browser.close() }
