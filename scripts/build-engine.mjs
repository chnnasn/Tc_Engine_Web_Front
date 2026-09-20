import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, copyFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(readFileSync(resolve(root, 'engine.lock.json'), 'utf8'))
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.error || result.status !== 0) throw result.error || new Error(`${command} failed (${result.status})`)
  return result.stdout.trim()
}
const source = resolve(process.env.TOMCAT_ENGINE_SOURCE || resolve(root, '.engine/source'))
if (!existsSync(source)) {
  mkdirSync(dirname(source), { recursive: true })
  run('git', ['clone', '--no-checkout', lock.repository, source])
  run('git', ['checkout', '--detach', lock.commit], source)
}
if (run('git', ['rev-parse', 'HEAD'], source) !== lock.commit) throw new Error('Engine checkout does not match engine.lock.json')
if (run('git', ['status', '--porcelain', '--untracked-files=no'], source)) throw new Error('Engine tracked files must be clean')
run('git', ['submodule', 'update', '--init', 'TomCat/vendor/Box2D', 'TomCat/vendor/glm', 'TomCat/vendor/spdlog', 'TomCat/vendor/ImGuizmo'], source)
const emsdk = process.env.EMSDK
if (!emsdk) throw new Error(`Activate Emscripten ${lock.emscripten} first (EMSDK is missing)`)
const emcc = resolve(emsdk, 'upstream/emscripten/emcc.py')
const python = process.env.EMSDK_PYTHON || 'python'
if (!run(python, [emcc, '--version']).includes(lock.emscripten)) throw new Error(`Use Emscripten ${lock.emscripten}`)
const build = resolve(root, '.engine/build')
run(python, [resolve(emsdk, 'upstream/emscripten/emcmake.py'), 'cmake', '-S', resolve(source, 'Web'), '-B', build, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release'])
run('cmake', ['--build', build, '--parallel', process.env.CMAKE_BUILD_PARALLEL_LEVEL || '6'])
run(process.execPath, [resolve(source, 'Web/tests/editor-rpc.cjs'), build])
run(process.execPath, [resolve(source, 'Web/tests/player-cook.cjs'), build])
const output = resolve(root, 'public/engine', lock.commit)
mkdirSync(output, { recursive: true })
for (const name of readdirSync(build)) {
  if (/^tomcat_(editor|player)\.(js|wasm|data|worker\.js)$/.test(name)) copyFileSync(resolve(build, name), resolve(output, name))
}
for (const kind of ['editor', 'player']) for (const extension of ['js', 'wasm', 'data']) {
  if (!existsSync(resolve(output, `tomcat_${kind}.${extension}`))) throw new Error(`Missing ${kind}.${extension}`)
}
writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(lock, null, 2))
console.log(`Verified engine artifacts: ${output}`)
