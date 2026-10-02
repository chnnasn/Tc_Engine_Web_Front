// Serve binary boot resources compressed even when the CDN does not compress WASM.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { gzipSync } from 'node:zlib'
const lock = JSON.parse(readFileSync('engine.lock.json', 'utf8'))
const root = `dist/engine/${lock.commit}`
const headers = []
const types = { wasm: 'application/wasm', png: 'image/png', ttf: 'font/ttf', otf: 'font/otf', ico: 'image/x-icon', dll: 'application/octet-stream' }
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) { walk(path); continue }
    const type = types[entry.name.split('.').pop()]
    if (!type) continue
    writeFileSync(`${path}.gz`, gzipSync(readFileSync(path), { level: 9 }))
    headers.push(`/${relative('dist', path).replaceAll('\\', '/')}.gz\n  Content-Encoding: gzip\n  Content-Type: ${type}\n  Cache-Control: public, max-age=31536000, immutable\n`)
  }
}
walk(join(root, '_framework'))
const entry = join(root, 'main.js')
const source = readFileSync(entry, 'utf8')
const marker = 'dotnet.withModuleConfig({ canvas }).create()'
if (!source.includes(marker)) throw new Error('Unsupported engine bootstrap: compression loader was not installed')
writeFileSync(entry, source.replace(marker, `dotnet.withConfig({ maxParallelDownloads: 4 }).withResourceLoader((type, name, url) => { if (!/\\.(wasm|png|ttf|otf|ico|dll)$/.test(new URL(url, import.meta.url).pathname)) return undefined; return (async () => { for (let attempt = 0; attempt < 3; attempt++) { try { const response = await fetch(url + '.gz'); if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + name); const bytes = await response.arrayBuffer(); return new Response(bytes, { headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream' } }); } catch (error) { if (attempt === 2) throw error; await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); } } })(); }).withModuleConfig({ canvas, onDownloadResourceProgress: (loaded, total) => globalThis.dispatchEvent(new CustomEvent('tomcat-web-download-progress', { detail: { loaded, total } })) }).create()`))
writeFileSync('dist/_headers', headers.join('\n'))
console.log(`Compressed ${headers.length} engine resources`)
