import { createEngineCache } from './engine-cache-core.mjs'

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
let queue = Promise.resolve()
self.addEventListener('message', event => {
  if (event.data?.type !== 'tomcat-engine-prepare' || !event.ports[0] || !event.source?.url || new URL(event.source.url).origin !== self.location.origin) return
  const port = event.ports[0]
  // Serialize preparations from editor/player tabs so they share downloads.
  const task = queue.then(async () => {
    const cache = createEngineCache({ storage: caches, fetcher: fetch, baseUrl: self.registration.scope,
      progress: detail => port.postMessage({ type: 'progress', detail }) })
    try { port.postMessage({ type: 'ready', result: await cache.prepare(event.data.commit) }) }
    catch (error) { port.postMessage({ type: 'error', message: error.name === 'QuotaExceededError' ? '浏览器本地存储空间不足，更新未启用，旧版本缓存已保留' : error.message || String(error) }) }
    finally { port.close() }
  })
  queue = task.catch(() => {})
  event.waitUntil(task)
})
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(new URL('engine-cache/', self.registration.scope).href)) return
  const cache = createEngineCache({ storage: caches, fetcher: fetch, baseUrl: self.registration.scope })
  event.respondWith(cache.serve(event.request.url).catch(() => new Response('Engine cache unavailable', { status: 503 })))
})
