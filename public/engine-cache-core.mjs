// Shared by the build, Service Worker and tests. The manifest digest describes
// executable bytes, not their optional gzip transport or the build timestamp.
export const CACHE_SCHEMA = 1
export const BLOB_CACHE = 'tomcat-engine-blobs-v1'
export const VERSION_CACHE = 'tomcat-engine-versions-v1'
const digestPattern = /^[a-f0-9]{64}$/
const commitPattern = /^[a-f0-9]{40}$/
export const validPath = value => typeof value === 'string' && /^[\w./-]+$/.test(value) && !value.startsWith('/') && !value.split('/').some(part => !part || part === '.' || part === '..')
export async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
export function manifestPayload(manifest) {
  return JSON.stringify({ cacheSchema: manifest.cacheSchema, commit: manifest.commit, kind: manifest.kind,
    entry: manifest.entry, framework: manifest.framework, refs: manifest.refs, refsList: manifest.refsList,
    files: manifest.files.map(({ path, size, sha256, contentType }) => ({ path, size, sha256, contentType })) })
}
export async function validateManifest(manifest, commit) {
  if (!manifest || manifest.cacheSchema !== CACHE_SCHEMA || manifest.kind !== 'managed' || !commitPattern.test(commit) || manifest.commit !== commit) throw new Error('引擎清单版本不匹配，请重新发布引擎产物')
  if (!digestPattern.test(manifest.hash) || !validPath(manifest.entry) || !validPath(manifest.framework) || !validPath(manifest.refs) || !Array.isArray(manifest.refsList) || !manifest.refsList.every(validPath)) throw new Error('引擎清单格式错误')
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 2048) throw new Error('引擎文件清单无效')
  const paths = new Set()
  let size = 0
  for (const file of manifest.files) {
    if (!validPath(file.path) || paths.has(file.path) || !digestPattern.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 67108864 || typeof file.contentType !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(file.contentType)) throw new Error('引擎文件清单无效')
    if (file.parts !== undefined && (!Array.isArray(file.parts) || !file.parts.length || file.parts.length > 256 || !file.parts.every(validPath))) throw new Error('引擎传输清单无效')
    paths.add(file.path); size += file.size
  }
  if (size > 268435456 || ![manifest.entry, `${manifest.framework}/dotnet.js`, `${manifest.framework}/dotnet.native.wasm`, ...manifest.refsList.map(name => `${manifest.refs}/${name}`)].every(path => paths.has(path))) throw new Error('引擎清单缺少必要文件')
  if (await sha256(new TextEncoder().encode(manifestPayload(manifest))) !== manifest.hash) throw new Error('引擎清单 SHA-256 校验失败')
  return manifest
}

export function createEngineCache({ storage, fetcher, baseUrl, progress = () => {} }) {
  const base = new URL(baseUrl)
  const key = path => new URL(path, base).href
  const blobKey = hash => key(`engine-cache-blobs/${hash}`)
  const versionKey = hash => key(`engine-cache-versions/${hash}`)
  const pointerKey = commit => key(`engine-cache-commits/${commit}`)
  const virtualBase = hash => key(`engine-cache/${hash}/`)
  const responseFor = (bytes, file) => new Response(bytes, { headers: { 'Content-Type': file.contentType, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' } })
  async function validBytes(response, file) {
    if (!response) return null
    const bytes = await response.arrayBuffer()
    return bytes.byteLength === file.size && await sha256(bytes) === file.sha256 ? bytes : null
  }
  async function request(url) {
    let error
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetcher(url, { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(60000) })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return new Uint8Array(await response.arrayBuffer())
      } catch (reason) { error = reason }
    }
    throw new Error(`引擎资源下载失败：${new URL(url).pathname} (${error?.message})。旧版本缓存已保留，请重试。`)
  }
  async function prepare(commit) {
    if (!commitPattern.test(commit)) throw new Error('无效的引擎版本')
    progress({ phase: 'checking', loaded: 0, total: 0 })
    const versions = await storage.open(VERSION_CACHE)
    const blobs = await storage.open(BLOB_CACHE)
    let manifest, offline = false
    // A network outage can use the last complete version of this exact engine
    // commit. Never silently pair a new frontend with a different engine ABI.
    let response
    try { response = await fetcher(key(`engine/${commit}/manifest.json`), { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(20000) }) }
    catch { offline = true }
    if (offline) {
      const previous = await versions.match(pointerKey(commit))
      if (!previous) throw new Error('无法获取引擎版本清单，且本地没有完整缓存，请联网后重试')
      manifest = await previous.json()
    } else {
      if (!response.ok) throw new Error('未找到匹配版本的引擎，请运行 npm run engine:build 或检查部署')
      manifest = await response.json()
    }
    await validateManifest(manifest, commit)
    let loaded = 0, reused = 0, downloaded = 0, cursor = 0, failure
    const total = manifest.files.length
    // Four file workers also bound transport concurrency and peak memory.
    await Promise.all(Array.from({ length: Math.min(4, total) }, async () => {
      while (!failure && cursor < total) {
        const file = manifest.files[cursor++]
        try {
          let bytes = await validBytes(await blobs.match(blobKey(file.sha256)), file)
          if (bytes) reused++
          else {
            if (offline) throw new Error('本地引擎缓存不完整，请联网修复；旧版本缓存已保留')
            progress({ phase: 'downloading', loaded, total, reused, downloaded })
            const parts = []
            let length = 0
            for (const path of file.parts || [file.path]) {
              const part = await request(key(`engine/${commit}/${path}`))
              length += part.byteLength
              if (length > file.size) throw new Error(`引擎文件长度校验失败：${file.path}`)
              parts.push(part)
            }
            const joined = new Uint8Array(length)
            let offset = 0
            for (const part of parts) { joined.set(part, offset); offset += part.length }
            if (length !== file.size || await sha256(joined) !== file.sha256) throw new Error(`引擎文件 SHA-256 校验失败：${file.path}。旧版本缓存已保留，请重试。`)
            bytes = joined
            await blobs.put(blobKey(file.sha256), responseFor(bytes, file))
            downloaded++
          }
          loaded++
          progress({ phase: 'verifying', loaded, total, reused, downloaded })
        } catch (error) { failure ||= error }
      }
    }))
    if (failure) {
      if (failure.name === 'QuotaExceededError') throw new Error('浏览器本地存储空间不足，更新未启用，旧版本缓存已保留')
      throw failure
    }
    // Cache.put is atomic: no version URL becomes readable before every file is
    // present and verified. An interrupted download leaves only reusable blobs.
    const marker = new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } })
    await versions.put(versionKey(manifest.hash), marker.clone())
    await versions.put(pointerKey(commit), marker)
    progress({ phase: 'ready', loaded, total, reused, downloaded, offline })
    return { manifest, baseUrl: virtualBase(manifest.hash), reused, downloaded, offline }
  }
  async function serve(url) {
    const prefix = key('engine-cache/')
    if (!url.startsWith(prefix)) return null
    const [hash, ...parts] = new URL(url).pathname.slice(new URL(prefix).pathname.length).split('/')
    const path = parts.join('/')
    if (!digestPattern.test(hash) || !validPath(path)) return new Response('Invalid engine resource', { status: 404 })
    const versions = await storage.open(VERSION_CACHE)
    const marker = await versions.match(versionKey(hash))
    if (!marker) return new Response('Engine version is not complete', { status: 503 })
    const manifest = await marker.json()
    await validateManifest(manifest, manifest.commit)
    if (manifest.hash !== hash) return new Response('Invalid engine version', { status: 503 })
    const file = manifest.files.find(file => file.path === path)
    if (!file) return new Response('Unknown engine resource', { status: 404 })
    const blobs = await storage.open(BLOB_CACHE)
    const bytes = await validBytes(await blobs.match(blobKey(file.sha256)), file)
    if (!bytes) return new Response('Engine cache missing or corrupt; reopen to repair', { status: 503 })
    return responseFor(bytes, file)
  }
  return { prepare, serve }
}
