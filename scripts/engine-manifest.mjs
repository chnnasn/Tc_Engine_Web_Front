import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CACHE_SCHEMA, manifestPayload, sha256, validateManifest } from '../public/engine-cache-core.mjs'

const types = { js: 'text/javascript', mjs: 'text/javascript', wasm: 'application/wasm', json: 'application/json', png: 'image/png', ttf: 'font/ttf', otf: 'font/otf', ico: 'image/x-icon', glsl: 'text/plain', md: 'text/plain', tomcat: 'text/plain', tcmeta: 'text/plain', tcproj: 'application/json' }
export async function writeEngineManifest(root) {
  const source = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
  // Keep development and production bytes identical; native debug symbols are
  // not needed for startup and would otherwise add another 9 MB to the cache.
  const bootPath = join(root, '_framework/dotnet.boot.js')
  const boot = readFileSync(bootPath, 'utf8')
  const start = boot.indexOf('/*json-start*/') + '/*json-start*/'.length
  const end = boot.indexOf('/*json-end*/')
  if (start < '/*json-start*/'.length || end < start) throw new Error('Unsupported runtime boot config')
  const config = JSON.parse(boot.slice(start, end))
  config.resources.wasmSymbols = []
  writeFileSync(bootPath, boot.slice(0, start) + JSON.stringify(config) + boot.slice(end))
  const paths = []
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && !/\.(gz|map|symbols|stamp)$/.test(entry.name) && path !== join(root, 'manifest.json')) paths.push(path)
    }
  }
  walk(root)
  const files = []
  for (const path of paths.sort()) {
    const bytes = readFileSync(path)
    files.push({ path: relative(root, path).replaceAll('\\', '/'), size: bytes.length, sha256: await sha256(bytes), contentType: types[path.split('.').pop()] || 'application/octet-stream' })
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  const manifest = { ...source, cacheSchema: CACHE_SCHEMA, files }
  manifest.hash = await sha256(new TextEncoder().encode(manifestPayload(manifest)))
  await validateManifest(manifest, source.commit)
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest))
  return manifest
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const lock = JSON.parse(readFileSync('engine.lock.json', 'utf8'))
  const root = process.argv.slice(2).find(argument => !argument.startsWith('--')) || `public/engine/${lock.commit}`
  if (existsSync(join(root, 'manifest.json'))) {
    const manifest = await writeEngineManifest(root)
    console.log(`Engine SHA-256 manifest: ${manifest.files.length} files, ${manifest.hash}`)
  } else if (!process.argv.includes('--optional')) throw new Error('Missing engine bundle; run npm run engine:build first')
}
