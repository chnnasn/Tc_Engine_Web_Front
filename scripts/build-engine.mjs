// 构建 TomCat 托管 Web 引擎：Emscripten 出 C++ 静态库，.NET browser-wasm 拥有最终模块。
//
// 与旧版（纯 Emscripten 出 tomcat_editor/tomcat_player 两个可执行文件）不同，托管构建把
// C++ 引擎归档链接进 .NET 运行时模块，使原生与托管共享同一块 WebAssembly 内存，从而支持 C# 脚本。
//
// 前置：.NET 10 SDK + wasm-tools 工作负载、CMake 3.20+、Ninja。
// Emscripten 默认取自 wasm-tools 工作负载自带的 pack；也可设置 EMSDK 使用独立 emsdk。
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, copyFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname, join, basename, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(readFileSync(resolve(root, 'engine.lock.json'), 'utf8'))
const isWindows = process.platform === 'win32'
const rid = { win32: 'win-x64', linux: 'linux-x64', darwin: 'osx-x64' }[process.platform] || 'win-x64'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'],
    env: options.env || process.env,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().split(/\r?\n/).slice(-6).join('\n')
    throw new Error(`${basename(command)} ${args.join(' ')} 失败（退出码 ${result.status}）${detail ? `\n${detail}` : ''}`)
  }
  return (result.stdout || '').trim()
}
function locate(name) {
  const probe = isWindows ? 'where' : 'which'
  try { return run(probe, [name], { capture: true }).split(/\r?\n/)[0].trim() } catch { return '' }
}
function subdirectories(parent) {
  if (!existsSync(parent)) return []
  return readdirSync(parent, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => join(parent, entry.name))
}
function newestByVersion(directories) {
  const toParts = value => basename(value).split(/[^\d]+/).filter(Boolean).map(Number)
  return [...directories].sort((a, b) => {
    const left = toParts(a); const right = toParts(b)
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
      const difference = (left[index] || 0) - (right[index] || 0)
      if (difference) return difference
    }
    return 0
  }).pop()
}
function copyTree(from, to) {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name); const target = join(to, entry.name)
    if (entry.isDirectory()) copyTree(source, target)
    else if (entry.isFile()) copyFileSync(source, target)
  }
}
function directorySize(directory) {
  let total = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    total += entry.isDirectory() ? directorySize(path) : statSync(path).size
  }
  return total
}

// ---------------------------------------------------------------------------
// 1. 检出与校验引擎源码（提交必须与锁文件一致，且工作树干净）
// ---------------------------------------------------------------------------
const source = resolve(process.env.TOMCAT_ENGINE_SOURCE || join(root, '.engine/source'))
if (!existsSync(source)) {
  mkdirSync(dirname(source), { recursive: true })
  run('git', ['clone', '--no-checkout', lock.repository, source])
  run('git', ['checkout', '--detach', lock.commit], { cwd: source })
}
if (run('git', ['rev-parse', 'HEAD'], { cwd: source, capture: true }) !== lock.commit) throw new Error('引擎检出与 engine.lock.json 不一致')
if (run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: source, capture: true })) throw new Error('引擎工作树必须干净（无已跟踪文件改动）')
run('git', ['submodule', 'update', '--init', 'TomCat/vendor/Box2D', 'TomCat/vendor/glm', 'TomCat/vendor/spdlog', 'TomCat/vendor/ImGuizmo'], { cwd: source })

// ---------------------------------------------------------------------------
// 2. 解析工具链
// ---------------------------------------------------------------------------
const dotnet = process.env.DOTNET || 'dotnet'
const dotnetVersion = run(dotnet, ['--version'], { capture: true })
if (!/^10\./.test(dotnetVersion)) throw new Error(`托管 Web 构建需要 .NET 10 SDK，当前解析到 ${dotnetVersion}`)
const workloads = run(dotnet, ['workload', 'list'], { capture: true })
if (!/^wasm-tools\s/m.test(workloads)) throw new Error('缺少 .NET wasm-tools 工作负载，请先运行：dotnet workload install wasm-tools（浏览器用户无需安装）')

const cmake = locate('cmake')
if (!cmake) throw new Error('构建环境需要 CMake 3.20+')
let ninja = locate('ninja')
if (!ninja && isWindows) {
  // Visual Studio 自带 Ninja：通过 vswhere 找到最新安装。
  const vswhere = join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft Visual Studio/Installer/vswhere.exe')
  if (existsSync(vswhere)) {
    const installation = run(vswhere, ['-latest', '-products', '*', '-property', 'installationPath'], { capture: true }).split(/\r?\n/)[0].trim()
    const bundled = join(installation, 'Common7/IDE/CommonExtensions/Microsoft/CMake/Ninja/ninja.exe')
    if (existsSync(bundled)) ninja = bundled
  }
}
if (!ninja) throw new Error('构建环境需要 Ninja（可安装 Ninja，或安装带 CMake 组件的 Visual Studio）')

const env = { ...process.env, PATH: `${dirname(ninja)}${sep}${process.env.PATH}` }
let python = process.env.EMSDK_PYTHON || 'python'
let emcmake
if (process.env.EMSDK) {
  // 独立 emsdk。
  emcmake = join(process.env.EMSDK, 'upstream/emscripten/emcmake.py')
  if (!existsSync(emcmake)) throw new Error(`EMSDK 中找不到 emcmake.py：${emcmake}`)
} else {
  // 使用 wasm-tools 工作负载自带的 Emscripten pack。
  const dotnetRoot = dirname(resolve(locate(dotnet) || dotnet))
  const packs = join(dotnetRoot, 'packs')
  const pickPack = (suffix) => newestByVersion(subdirectories(packs).filter(directory =>
    /^Microsoft\.NET\.Runtime\.Emscripten\./.test(basename(directory)) && basename(directory).endsWith(suffix)))
  const sdkPack = pickPack('.Sdk.' + rid)
  const nodePack = pickPack('.Node.' + rid)
  const pythonPack = pickPack('.Python.' + rid)
  const cachePack = pickPack('.Cache.' + rid)
  if (!sdkPack || !nodePack || !pythonPack || !cachePack) {
    throw new Error(`wasm-tools 工作负载未提供 Emscripten pack（${rid}）。请运行 dotnet workload install wasm-tools，或设置 EMSDK 指向独立 emsdk。`)
  }
  const tools = join(newestByVersion(subdirectories(sdkPack)), 'tools')
  emcmake = join(tools, 'emscripten', 'emcmake.py')
  if (!existsSync(emcmake)) throw new Error(`wasm-tools 的 Emscripten 启动器缺失：${emcmake}`)
  python = join(newestByVersion(subdirectories(pythonPack)), 'tools', isWindows ? 'python.exe' : 'bin/python3')
  env.EMSDK_PATH = tools.endsWith(sep) ? tools : tools + sep
  env.EMSDK_PYTHON = python
  env.DOTNET_EMSCRIPTEN_LLVM_ROOT = join(tools, 'bin')
  env.DOTNET_EMSCRIPTEN_NODE_JS = join(newestByVersion(subdirectories(nodePack)), 'tools', 'bin', isWindows ? 'node.exe' : 'node')
  env.DOTNET_EMSCRIPTEN_BINARYEN_ROOT = tools
  env.EM_CACHE = join(newestByVersion(subdirectories(cachePack)), 'tools', 'emscripten', 'cache')
  env.FROZEN_CACHE = 'true'
}
if (!existsSync(python)) python = process.env.EMSDK_PYTHON || 'python'

// ---------------------------------------------------------------------------
// 3. 只构建托管入口所需的原生静态库
// ---------------------------------------------------------------------------
const buildNative = resolve(process.env.TOMCAT_NATIVE_BUILD || join(root, '.engine/build-managed-native'))
const buildOut = resolve(process.env.TOMCAT_MANAGED_BUILD || join(root, '.engine/build-managed'))
// emcmake 会重置子进程 PATH，因此显式指定 Ninja，避免依赖 PATH 查找。
run(python, [emcmake, cmake, '-S', join(source, 'Web'), '-B', buildNative, '-G', 'Ninja', `-DCMAKE_MAKE_PROGRAM=${ninja}`, '-DCMAKE_BUILD_TYPE=Release'], { env })
// tomcat_player 只用于测试夹具：上游 tc_web_player_cook_sample 用它生成真实 TCPAK。
run(cmake, ['--build', buildNative, '--target', 'tomcat_managed_web_entrypoints', 'tomcat_player', '--parallel', process.env.CMAKE_BUILD_PARALLEL_LEVEL || '6'], { env })
if (!existsSync(join(buildNative, 'tomcat_player.js'))) throw new Error(`未生成测试夹具 tomcat_player.js：${buildNative}`)

const requiredArchives = ['libtomcat_managed_web_entrypoints.a', 'libtc_player_core.a', 'libtc_yaml.a', 'libbox2d.a']
const archives = requiredArchives.map((name) => {
  const matches = []
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name === name) matches.push(path)
    }
  }
  walk(buildNative)
  if (matches.length !== 1) throw new Error(`在 ${buildNative} 下期望恰好一个 ${name}，实际找到 ${matches.length} 个`)
  return matches[0].replace(/\\/g, '/')
})

// ---------------------------------------------------------------------------
// 4. 发布 .NET browser-wasm 宿主（最终 .wasm 归 .NET 所有）
// ---------------------------------------------------------------------------
// 刻意不做整体删除：产物按提交寻址，重复构建直接覆盖即可，
// 同时避免在受限环境（沙箱、只读挂载）中触发批量删除保护。
mkdirSync(buildOut, { recursive: true })
const hostProject = join(source, 'Managed/TomCat.WebHost/TomCat.WebHost.csproj')
run(dotnet, [
  'publish', hostProject, '-c', 'Release', '-r', 'browser-wasm',
  '--nologo', '-nodeReuse:false', '-p:UseSharedCompilation=false', '-p:NuGetAudit=false',
  `-p:WasmAppDir=${buildOut.replace(/\\/g, '/')}`,
  `-p:TomCatWebEntrypointsArchive=${archives[0]}`,
  `-p:TomCatWebPlayerCoreArchive=${archives[1]}`,
  `-p:TomCatWebYamlArchive=${archives[2]}`,
  `-p:TomCatWebBox2dArchive=${archives[3]}`,
  `-p:TomCatRepositoryRoot=${source.replace(/\\/g, '/')}`,
])

// 不同 SDK 版本可能把应用包写在 WasmAppDir 根目录或 AppBundle 子目录。
const bundle = existsSync(join(buildOut, 'main.js')) ? buildOut : join(buildOut, 'AppBundle')
if (!existsSync(join(bundle, 'main.js'))) throw new Error(`托管发布未生成 main.js：${bundle}`)
if (!existsSync(join(bundle, '_framework', 'dotnet.js'))) throw new Error(`托管发布未生成 _framework/dotnet.js：${bundle}`)

// ---------------------------------------------------------------------------
// 5. 收集 C# 编译所需的引用程序集（Roslyn 元数据引用）
// ---------------------------------------------------------------------------
// 上游冒烟测试已验证的最小集合是 mscorlib + System.Runtime + TomCat.Managed；
// 这里保持该最小集合，并补一组常用程序集，便于真实脚本编写。
const referenceAssemblies = [
  'mscorlib.dll', 'netstandard.dll', 'System.Runtime.dll', 'System.Runtime.Extensions.dll',
  'System.Runtime.InteropServices.dll', 'System.Collections.dll', 'System.Linq.dll',
  'System.ObjectModel.dll', 'System.Console.dll', 'System.Memory.dll', 'System.Threading.dll',
  'System.Threading.Tasks.dll', 'System.Text.Encoding.dll', 'System.Text.Encoding.Extensions.dll',
  'System.Text.Json.dll', 'System.ComponentModel.Primitives.dll',
]
const dotnetRoot = dirname(resolve(locate(dotnet) || dotnet))
// 结构：packs/Microsoft.NETCore.App.Ref/<版本>/ref/<目标框架>/<程序集>.dll
const refPackRoot = join(dotnetRoot, 'packs', 'Microsoft.NETCore.App.Ref')
if (!existsSync(refPackRoot)) throw new Error('找不到 Microsoft.NETCore.App.Ref 引用包，无法生成 C# 编译引用集')
const refVersion = newestByVersion(subdirectories(refPackRoot))
const refSource = refVersion ? newestByVersion(subdirectories(join(refVersion, 'ref'))) : undefined
if (!refSource) throw new Error(`引用包中没有 ref 目录：${refPackRoot}`)

const refsDirectory = join(bundle, 'refs')
mkdirSync(refsDirectory, { recursive: true })
const refsList = []
for (const name of referenceAssemblies) {
  const from = join(refSource, name)
  if (!existsSync(from)) { console.warn(`跳过缺失的引用程序集：${name}`); continue }
  copyFileSync(from, join(refsDirectory, name)); refsList.push(name)
}
// TomCat.Managed.dll 是脚本 API 面（MonoBehaviour / Log / 组件代理）。
const managedDll = [
  join(source, 'Managed/TomCat.Managed/bin/Release/net10.0/TomCat.Managed.dll'),
  join(source, 'Managed/TomCat.WebHost/bin/Release/net10.0/browser-wasm/TomCat.Managed.dll'),
].find(existsSync)
if (!managedDll) throw new Error('找不到 TomCat.Managed.dll，C# 脚本无法编译')
copyFileSync(managedDll, join(refsDirectory, 'TomCat.Managed.dll')); refsList.push('TomCat.Managed.dll')
for (const required of ['mscorlib.dll', 'System.Runtime.dll', 'TomCat.Managed.dll']) {
  if (!refsList.includes(required)) throw new Error(`C# 编译引用集缺少必需项：${required}`)
}

// ---------------------------------------------------------------------------
// 6. 复制到 public/engine/<commit>/ 并写 manifest
// ---------------------------------------------------------------------------
const output = resolve(root, 'public/engine', lock.commit)
mkdirSync(output, { recursive: true })
copyTree(bundle, output)
for (const required of ['main.js', join('_framework', 'dotnet.js'), join('_framework', 'dotnet.native.wasm')]) {
  if (!existsSync(join(output, required))) throw new Error(`引擎产物缺少 ${required}`)
}
writeFileSync(join(output, 'manifest.json'), JSON.stringify({
  ...lock,
  builtAt: new Date().toISOString(),
  dotnetSdk: dotnetVersion,
  entry: 'main.js',
  framework: '_framework',
  refs: 'refs',
  refsList,
}, null, 2))
await (await import('./engine-manifest.mjs')).writeEngineManifest(output)
console.log(`已生成托管 Web 引擎：${output}`)
console.log(`  提交 ${lock.commit}`)
console.log(`  引用程序集 ${refsList.length} 个`)
console.log(`  产物体积 ${(directorySize(output) / 1048576).toFixed(1)} MiB`)
console.log('  部署需提供 COOP: same-origin 与 COEP: require-corp，并确保 .wasm 为 application/wasm。')
console.log('  验收：以 HTTP 提供该目录，打开上游 Web/tests/managed-browser-smoke.html，或运行 npm run test:browser。')
