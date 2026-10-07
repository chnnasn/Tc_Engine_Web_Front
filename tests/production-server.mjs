// Local production verification, including Netlify's precompressed responses.
// npm run build && node scripts/compress-engine.mjs
// node tests/production-server.mjs
// TEST_BASE_URL=http://127.0.0.1:5186 node --experimental-strip-types tests/browser.mjs
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'

const root = resolve('dist')
const headers = new Map()
let current
for (const line of readFileSync(resolve(root, '_headers'), 'utf8').split(/\r?\n/)) {
  if (line.startsWith('/')) { current = {}; headers.set(line.trim(), current) }
  else if (current && line.includes(':')) { const colon = line.indexOf(':'); current[line.slice(0, colon).trim()] = line.slice(colon + 1).trim() }
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml' }
const counts = new Map()
createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  if (path === '/__test_requests') {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(Object.fromEntries(counts))); return
  }
  counts.set(path, (counts.get(path) || 0) + 1)
  let file = resolve(root, '.' + path)
  if (file !== root && !file.startsWith(root + sep)) { response.writeHead(404).end(); return }
  if (!existsSync(file) || !statSync(file).isFile()) {
    if (path.startsWith('/engine/') || path.startsWith('/engine-cache/') || path.startsWith('/assets/')) { response.writeHead(404).end(); return }
    file = resolve(root, 'index.html')
  }
  response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', ...headers.get(path) })
  response.end(readFileSync(file))
}).listen(5186, '127.0.0.1', () => console.log('Production test server: http://127.0.0.1:5186'))
