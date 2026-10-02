import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { gzipSync } from 'node:zlib'
const lock = JSON.parse(readFileSync('engine.lock.json', 'utf8'))
const root = 'dist/engine/' + lock.commit
const headers = []
const chunks = {}
const types = { js: 'text/javascript', wasm: 'application/wasm', png: 'image/png', ttf: 'font/ttf', otf: 'font/otf', ico: 'image/x-icon', dll: 'application/octet-stream' }
function output(path, bytes, type) {
  writeFileSync(path, gzipSync(bytes, { level: 9 }))
  headers.push('/' + relative('dist', path).replaceAll('\\', '/') + '\n  Content-Encoding: gzip\n  Content-Type: ' + type + '\n  Cache-Control: public, max-age=31536000, immutable\n')
}
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) { walk(path); continue }
    const type = types[entry.name.split('.').pop()]
    if (!type) continue
    const bytes = readFileSync(path)
    if (!path.endsWith('.js') && bytes.length > 524288) {
      const count = Math.ceil(bytes.length / 262144)
      chunks['/' + relative('dist', path).replaceAll('\\', '/')] = count
      for (let i = 0; i < count; i++) output(path + '.part-' + i + '.gz', bytes.subarray(i * 262144, (i + 1) * 262144), type)
    } else output(path + '.gz', bytes, type)
  }
}
walk(join(root, '_framework'))
const entry = join(root, 'main.js')
const source = readFileSync(entry, 'utf8')
const marker = 'dotnet.withModuleConfig({ canvas }).create()'
if (!source.includes(marker)) throw new Error('Unsupported engine bootstrap')
const loader = `
const resourceChunks = ${JSON.stringify(chunks)};
async function downloadResource(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + url);
      return { bytes: new Uint8Array(await response.arrayBuffer()), type: response.headers.get('Content-Type') };
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}
function resourceLoader(type, name, url) {
  const path = new URL(url, import.meta.url).pathname;
  if (path.endsWith('.js')) return url + '.gz';
  if (!/\\.(wasm|png|ttf|otf|ico|dll)$/.test(path)) return undefined;
  return (async () => {
    const count = resourceChunks[path];
    const parts = [];
    let contentType;
    if (count) {
      for (let index = 0; index < count; index++) {
        const part = await downloadResource(url + '.part-' + index + '.gz');
        parts.push(part.bytes); contentType = part.type;
      }
    } else {
      const part = await downloadResource(url + '.gz');
      parts.push(part.bytes); contentType = part.type;
    }
    return new Response(new Blob(parts), { headers: { 'Content-Type': contentType || 'application/octet-stream' } });
  })();
}
`
writeFileSync(entry, loader + source.replace(marker, "dotnet.withConfig({ maxParallelDownloads: 4 }).withResourceLoader(resourceLoader).withModuleConfig({ canvas, onDownloadResourceProgress: (loaded, total) => globalThis.dispatchEvent(new CustomEvent('tomcat-web-download-progress', { detail: { loaded, total } })) }).create()"))
writeFileSync('dist/_headers', headers.join('\n'))
console.log('Prepared ' + headers.length + ' compressed engine resources and chunks')
