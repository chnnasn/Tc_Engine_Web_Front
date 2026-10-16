// Read provenance from the engine entry actually loaded in the iframe. Engine
// downloads happen in a Service Worker, so page response events are insufficient.
// All byte verification runs before measured phases/profiling.
export async function readLoadedEngine(frame) {
  return frame.evaluate(async () => {
    const entry = [...document.scripts].map(script => script.src).find(src => src && /\/(?:engine|engine-cache)\/[^/]+\/main\.js$/.test(new URL(src).pathname))
    if (!entry) throw new Error('Cannot identify the actual loaded engine entry')
    const entryUrl = new URL(entry), cached = /^(.*)engine-cache\/([a-f0-9]{64})\/main\.js$/.exec(entryUrl.pathname)
    const url = cached ? new URL(`${cached[1]}engine-cache-versions/${cached[2]}`, entry).href : new URL('manifest.json', entry).href
    const response = cached ? await caches.match(url) : await fetch(url, { cache: 'no-store' })
    if (!response?.ok) throw new Error(`Cannot read loaded engine manifest: ${url}`)
    const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
    const bytes = await response.arrayBuffer(), manifest = JSON.parse(new TextDecoder().decode(bytes))
    if (cached && manifest.hash !== cached[2]) throw new Error('Loaded engine entry and cached manifest disagree')
    const resources = []
    for (const path of ['main.js', '_framework/dotnet.native.js', '_framework/dotnet.native.wasm']) {
      const file = manifest.files?.find(item => item.path === path)
      if (!file) throw new Error(`Loaded engine manifest lacks ${path}`)
      const resourceUrl = new URL(path, entry).href, resource = await fetch(resourceUrl, { cache: 'no-store' })
      if (!resource.ok) throw new Error(`Cannot verify loaded engine resource: ${resourceUrl}`)
      const body = await resource.arrayBuffer(), sha256 = await digest(body)
      if (body.byteLength !== file.size || sha256 !== file.sha256) throw new Error(`Loaded engine resource hash mismatch: ${path}`)
      resources.push({ path, url: resourceUrl, byteLength: body.byteLength, sha256 })
    }
    return { url, sha256: await digest(bytes), manifest, entryUrl: entry, cacheHash: cached?.[2] ?? null, resources,
      verification: 'Read manifest for the actual loaded entry; re-read its immutable virtual resource URLs and verified their byte hashes before timing.' }
  })
}
