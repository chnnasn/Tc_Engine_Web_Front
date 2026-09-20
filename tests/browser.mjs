import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'
if (!process.argv.includes('--missing')) execFileSync(process.execPath, ['tests/player-fixture.cjs'], { stdio: 'inherit' })
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('dialog', dialog => dialog.accept())
try {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(base)).ok) break } catch { /* Preview may still be starting. */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  if (process.argv.includes('--missing')) await page.route('**/engine/**/manifest.json', route => route.fulfill({ status: 404, body: 'missing' }))
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
    const save = page.getByRole('button', { name: '保存', exact: true })
    await save.waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '保存' && !b.disabled), null, { timeout: 120000 })
    await page.getByRole('button', { name: '添加对象', exact: true }).click()
    await page.waitForFunction(() => document.body.textContent.includes('New Entity'))
    const tga = Buffer.from([0,0,2,0,0,0,0,0,0,0,0,0,1,0,1,0,24,0,0,0,255])
    await page.locator('input[type=file]').setInputFiles({ name: 'red.tga', mimeType: 'application/octet-stream', buffer: tga })
    await page.getByText('图片已导入，请保存项目', { exact: true }).waitFor()
    await save.click()
    await page.getByText('引擎项目已保存到此浏览器', { exact: true }).waitFor()
    const saved = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('tomcat-engine-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
      const value = await new Promise(resolve => { const r = db.transaction('projects').objectStore('projects').get('my-first-game'); r.onsuccess = () => resolve(r.result) })
      db.close(); return value
    })
    assert.equal(saved.format, 'tomcat-engine-project'); assert.match(saved.archive, /New Entity/)
    assert.ok(Object.keys(saved.files).some(path => path.endsWith('.tga')))
    assert.ok(Object.keys(saved.files).some(path => path.endsWith('.tga.tcmeta')))
    await page.reload()
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '保存' && !b.disabled), null, { timeout: 120000 })
    assert.equal(await page.getByText('我的第一个游戏 · 未保存', { exact: true }).count(), 0)
    mkdirSync('.engine', { recursive: true }); await page.screenshot({ path: '.engine/editor-browser.png' })
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: '返回项目' }).click()
      await page.getByRole('heading', { name: '我的项目' }).waitFor()
      assert.equal(await page.locator('iframe').count(), 0)
      await page.goto(`${base}/editor/my-first-game`)
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '保存' && !b.disabled), null, { timeout: 120000 })
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
      iframe.contentWindow.postMessage({ type: 'tomcat-connect', kind: 'editor', name: 'Browser regression', template: '2D' }, location.origin, [channel.port2])
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
    await page.goto(`${base}/games/forest`)
    await page.getByRole('button', { name: '打开游玩预览' }).click()
    for (let i = 0; i < 2; i++) {
      await page.locator('input[type=file]').setInputFiles('.engine/sample.tcpak')
      await page.getByText('正在运行本地游戏包', { exact: true }).waitFor({ timeout: 120000 })
      if (i === 0) await page.screenshot({ path: '.engine/player-browser.png' })
      await page.getByRole('button', { name: '停止', exact: true }).click()
      assert.equal(await page.locator('iframe').count(), 0)
      for (let tries = 0; tries < 100 && page.workers().length; tries++) await new Promise(resolve => setTimeout(resolve, 100))
      assert.equal(page.workers().length, 0, 'pthread workers must terminate on stop')
    }
    await page.locator('input[type=file]').setInputFiles({ name: 'invalid.tcpak', mimeType: 'application/octet-stream', buffer: Buffer.from('invalid') })
    await page.getByRole('alert').waitFor({ timeout: 120000 })
    assert.equal(await page.locator('iframe').count(), 0)
    await page.getByRole('button', { name: '关闭播放器', exact: true }).click()
  }
  assert.deepEqual(errors, [])
  console.log(process.argv.includes('--missing') ? 'PASS: isolation, missing-engine diagnostic and route cleanup' : 'PASS: real editor, archive persistence, repeated cleanup, uint64, undo/redo, preview, save conflict')
} finally { await browser.close() }
