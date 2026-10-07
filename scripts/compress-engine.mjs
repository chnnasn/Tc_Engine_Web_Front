import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { gzipSync } from 'node:zlib'
import { writeEngineManifest } from './engine-manifest.mjs'

const lock = JSON.parse(readFileSync('engine.lock.json', 'utf8'))
const root = 'dist/engine/' + lock.commit
const manifest = await writeEngineManifest(root)
const headers = []
function output(path, bytes, type) {
  writeFileSync(path, gzipSync(bytes, { level: 9 }))
  headers.push('/' + relative('dist', path).replaceAll('\\', '/') + '\n  Content-Encoding: gzip\n  Content-Type: ' + type + '\n  Cache-Control: public, max-age=31536000, immutable\n')
}
for (const file of manifest.files) {
  const path = join(root, file.path)
  const bytes = readFileSync(path)
  headers.push(`/engine/${lock.commit}/${file.path}\n  Cache-Control: public, max-age=31536000, immutable\n`)
  // Verify the decompressed, joined bytes before committing the complete file.
  if (bytes.length > 524288) {
    file.parts = []
    for (let offset = 0, index = 0; offset < bytes.length; offset += 262144, index++) {
      const part = file.path + '.part-' + index + '.gz'
      output(join(root, part), bytes.subarray(offset, offset + 262144), file.contentType)
      file.parts.push(part)
    }
  } else {
    output(path + '.gz', bytes, file.contentType)
    file.parts = [file.path + '.gz']
  }
}
writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest))
headers.push(`/engine/${lock.commit}/manifest.json\n  Cache-Control: no-store\n`)
writeFileSync('dist/_headers', headers.join('\n'))
console.log('Prepared ' + manifest.files.length + ' verified engine resources with compressed transport')
