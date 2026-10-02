import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EditorProtocol, EngineError, assertHandle } from '../src/engine/protocol.ts'
import { bootPlayer, shutdown, compileAndInstall, bytesToBase64, capabilityErrors, scriptAssetsJson } from '../src/engine/runtime.ts'
import { assertDocument, engineCommit, validFilePath } from '../src/engine/storage.ts'
import { attachScripts, detachScripts, readScripts } from '../src/engine/scene-archive.ts'

test('uint64 boundaries remain exact strings through transactions and schemas', () => {
  const max = '18446744073709551615'
  assertHandle(max)
  for (const id of [Number(max), '-1', '01', '18446744073709551616', '1e3', '']) assert.throws(() => assertHandle(id))
  let request
  const protocol = new EditorProtocol(json => {
    request = JSON.parse(json)
    return JSON.stringify({ ...request, ok: true, result: { sceneHandle: max, revision: 3, selectedEntityId: max, schemas: [{ id: max }] } })
  })
  const value = protocol.transact({ sceneHandle: max, revision: 2, selectedEntityId: null }, 'patch', [{ op: 'component.patch', entityId: max, componentId: max, properties: { [max]: max } }])
  assert.equal(request.payload.operations[0].properties[max], max)
  assert.equal(value.schemas[0].id, max)
  assert.equal(request.payload.baseRevision, 2)
})
test('RPC rejects mismatched envelopes and preserves conflict errors', () => {
  const protocol = new EditorProtocol(json => {
    const request = JSON.parse(json)
    return JSON.stringify({ ...request, ok: false, error: { code: 'REVISION_CONFLICT', message: 'Changed' } })
  })
  assert.throws(() => protocol.request('scene.transact'), error => error instanceof EngineError && error.code === 'REVISION_CONFLICT')
  assert.throws(() => new EditorProtocol(() => '{"ok":true}').request('system.capabilities'), /mismatch/)
})
test('Player hands package bytes straight to the managed JSExport without staging memory', () => {
  const calls = []
  const web = { engine: { PlayerBoot(...args) { calls.push(args); return 1 }, PlayerError: () => 'bad package' } }
  assert.throws(() => bootPlayer(web, new Uint8Array([1, 2, 3]), 800, 600), /bad package/)
  assert.equal(calls.length, 1)
  assert.deepEqual([calls[0][0], calls[0][1]], [800, 600])
  assert.deepEqual([...calls[0][2]], [1, 2, 3])
  assert.throws(() => bootPlayer(web, new Uint8Array(0), 800, 600), /256 MiB/)
})
test('shutdown calls the managed export and still reclaims a thread pool when one exists', () => {
  const seen = []
  const web = {
    engine: { EditorShutdown() { seen.push('editor'); throw new Error('shutdown failed') }, PlayerShutdown() { seen.push('player') } },
    runtime: { Module: { PThread: { terminateAllThreads() { seen.push('threads') } } } },
  }
  assert.throws(() => shutdown(web, 'editor'))
  assert.deepEqual(seen, ['editor', 'threads'])
  shutdown(web, 'player')
  assert.deepEqual(seen, ['editor', 'threads', 'player', 'threads'])
})
test('compileAndInstall surfaces Roslyn diagnostics and rejects modules without a compiler', () => {
  const diagnostics = [{ severity: 'error', code: 'CS1002', message: '; expected', file: 'Assets/Scripts/A.cs', line: 3, column: 1 }]
  const web = { compileAndInstall: request => ({ succeeded: false, diagnostics, echo: request.scriptAssetsJson }) }
  const result = compileAndInstall(web, { sources: [{ path: 'Assets/Scripts/A.cs', text: 'class A' }], references: [], scriptAssetsJson: '{}' })
  assert.equal(result.succeeded, false)
  assert.equal(result.diagnostics[0].code, 'CS1002')
  assert.throws(() => compileAndInstall({}, { sources: [], references: [], scriptAssetsJson: '{}' }), /不支持浏览器内 C# 编译/)
  assert.throws(() => compileAndInstall({ compileAndInstall: () => null }, { sources: [], references: [], scriptAssetsJson: '{}' }), /无法识别/)
})
test('bytesToBase64 round-trips large buffers in chunks', () => {
  const bytes = new Uint8Array(20000).map((_, index) => index % 251)
  const encoded = bytesToBase64(bytes)
  assert.deepEqual([...Uint8Array.from(atob(encoded), char => char.charCodeAt(0))], [...bytes])
})
test('capability probe never requires cross-origin isolation for the single-threaded managed build', () => {
  // 托管构建 WasmEnableThreads=false，产物中不含 SharedArrayBuffer/pthread。
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext')
  Object.defineProperty(globalThis, 'isSecureContext', { value: true, configurable: true })
  const stub = { getContext: () => ({ getExtension: () => ({ loseContext() {} }) }) }
  const original = globalThis.document
  globalThis.document = { createElement: () => stub }
  try { assert.deepEqual(capabilityErrors(), []) }
  finally {
    if (original === undefined) delete globalThis.document; else globalThis.document = original
    if (previous) Object.defineProperty(globalThis, 'isSecureContext', previous)
  }
})
test('project document validates pinned engine, uint64, base64 and file paths', () => {
  const document = { format: 'tomcat-engine-project', version: 1, engineCommit, sceneHandle: '18446744073709551615', archive: 'scene', files: { 'ProjectSettings/PlayerSettings.json': 'e30=' } }
  assertDocument(document)
  assert.throws(() => assertDocument({ ...document, engineCommit: 'old' }))
  assert.throws(() => assertDocument({ ...document, engineCommit: 'old' }))
  assert.throws(() => assertDocument({ ...document, sceneHandle: 12 }))
  assert.throws(() => assertDocument({ ...document, files: { '../Project.tcproj': 'e30=' } }))
  assert.throws(() => assertDocument({ ...document, files: { 'Assets/WebImports/a.png': '***' } }))
  assert.equal(validFilePath('Assets/WebImports/..'), false)
  assert.equal(validFilePath('Assets/WebImports/a.png.tcmeta'), true)
  assert.equal(validFilePath('Assets/Scripts/Player.cs'), true)
  assert.equal(validFilePath('Assets/Scripts/Player.cs.tcmeta'), true)
})
test('old engine projects are rejected', () => {
  const document = { format: 'tomcat-engine-project', version: 2, engineCommit: '1223a9610066d420485fa7f273b0eeca34835bbf', sceneHandle: '1', archive: 'scene', files: {} }
  assert.throws(() => assertDocument(document), /不兼容的引擎版本/)
})
test('version 2 projects require .tcmeta beside scripts and images', () => {
  const base = {
    format: 'tomcat-engine-project', version: 2, engineCommit, sceneHandle: '1', archive: 'scene',
    files: { 'Project.tcproj': 'e30=', 'ProjectSettings/BuildSettings.json': 'e30=', 'ProjectSettings/ProjectSettings.json': 'e30=', 'ProjectSettings/PlayerSettings.json': 'e30=' },
  }
  assertDocument(base)
  assert.throws(() => assertDocument({ ...base, files: { ...base.files, 'Assets/Scripts/Player.cs': 'e30=' } }), /C# 脚本缺少 .tcmeta/)
  assertDocument({ ...base, files: { ...base.files, 'Assets/Scripts/Player.cs': 'e30=', 'Assets/Scripts/Player.cs.tcmeta': 'e30=' } })
  assert.throws(() => assertDocument({ ...base, files: { ...base.files, 'Assets/Scripts/Player.cs.tcmeta': 'e30=' } }), /\.tcmeta 缺少源文件/)
})

const archiveFixture = `SchemaVersion: 11
SceneName: sample
Entities:
  - Entity: 1000000000000000001
    Tag:
      Tag: MainCamera
    Components:
      - TypeId: 11457157452030541825
        StableName: TomCat.ID
        SchemaVersion: 1
        Properties:
          - PropertyId: 1
            StableName: Value
            Value: 1000000000000000001
      - TypeId: 11457157452030541828
        StableName: TomCat.Transform
        SchemaVersion: 1
        Properties:
          - PropertyId: 1
            StableName: Translation
            Value: [0, 0, 0]
    Parent: 0
  - Entity: 2539330170089681506
    Tag:
      Tag: Square
    Components:
      - TypeId: 11457157452030541825
        StableName: TomCat.ID
        SchemaVersion: 1
        Properties:
          - PropertyId: 1
            StableName: Value
            Value: 2539330170089681506
    Parent: 0
`
test('scene archive injection attaches a CSharpScripts record the engine can decode', () => {
  const attached = attachScripts(archiveFixture, '2539330170089681506', [{ handle: '123', className: 'WebSmoke', attachmentId: '9000000000000000001' }])
  // 记录头必须与引擎注册的 CSharpScripts 描述符完全一致。
  assert.match(attached, /^ {6}- TypeId: 11457157452030541833$/m)
  assert.match(attached, /^ {8}StableName: TomCat\.CSharpScripts$/m)
  assert.match(attached, /^ {8}SchemaVersion: 1$/m)
  assert.match(attached, /^ {10}Scripts:$/m)
  assert.match(attached, /^ {12}- AttachmentID: 9000000000000000001$/m)
  assert.match(attached, /^ {14}Enabled: true$/m)
  assert.match(attached, /^ {14}ScriptHandle: 123$/m)
  assert.match(attached, /^ {14}ClassName: WebSmoke$/m)
  assert.match(attached, /^ {14}Fields: \[\]$/m)
  // 注入必须落在目标实体的 Components 段内，而不是另一个实体。
  const square = attached.slice(attached.indexOf('Entity: 2539330170089681506'))
  assert.ok(square.includes('TomCat.CSharpScripts'))
  assert.ok(!attached.slice(0, attached.indexOf('Entity: 2539330170089681506')).includes('TomCat.CSharpScripts'))
  // 其余内容逐行保持不变：按位置整块移除注入的记录再比对。
  const injected = [
    '      - TypeId: 11457157452030541833',
    '        StableName: TomCat.CSharpScripts',
    '        SchemaVersion: 1',
    '        Properties:',
    '          Scripts:',
    '            - AttachmentID: 9000000000000000001',
    '              Enabled: true',
    '              ScriptHandle: 123',
    '              ClassName: WebSmoke',
    '              Fields: []',
  ]
  const lines = attached.split('\n')
  const start = lines.indexOf(injected[0])
  assert.ok(start > 0)
  assert.deepEqual(lines.slice(start, start + injected.length), injected)
  assert.equal([...lines.slice(0, start), ...lines.slice(start + injected.length)].join('\n'), archiveFixture)
})
test('re-attaching replaces the record instead of duplicating it, and detach restores the archive', () => {
  const once = attachScripts(archiveFixture, '2539330170089681506', [{ handle: '123', className: 'WebSmoke', attachmentId: '11' }])
  const twice = attachScripts(once, '2539330170089681506', [{ handle: '124', className: 'WebFault', attachmentId: '12' }])
  assert.equal((twice.match(/TomCat\.CSharpScripts/g) || []).length, 1)
  assert.ok(!twice.includes('WebSmoke'))
  assert.deepEqual(readScripts(twice, '2539330170089681506'), [{ handle: '124', className: 'WebFault', attachmentId: '12' }])
  assert.equal(detachScripts(twice, '2539330170089681506'), archiveFixture)
  assert.equal(detachScripts(archiveFixture, '2539330170089681506'), archiveFixture)
})
test('scene archive injection refuses unknown entities and invalid handles', () => {
  assert.throws(() => attachScripts(archiveFixture, '999', [{ handle: '1', className: 'A' }]), /找不到可挂载脚本的实体/)
  assert.throws(() => attachScripts(archiveFixture, '2539330170089681506', []), /至少需要一个脚本/)
  assert.throws(() => attachScripts(archiveFixture, '2539330170089681506', [{ handle: '0', className: 'A' }]), /脚本 Handle 无效/)
  assert.throws(() => attachScripts(archiveFixture, '2539330170089681506', [{ handle: '1', className: '1 bad' }]), /脚本类名无效/)
  assert.throws(() => attachScripts(archiveFixture, '2539330170089681506', [{ handle: '1', className: 'A', attachmentId: '0' }]), /AttachmentID/)
})

test('script asset handles keep their exact uint64 digits above 2^53', () => {
  // 源生成器用 GetUInt64() 精确解析；Number() 会把 5478837881518915558 舍入成 …5584，
  // 引擎随后报 "Missing C# script asset <handle>"。这里锁死十进制原文。
  const handle = '5478837881518915558'
  assert.notEqual(String(Number(handle)), handle)
  const json = scriptAssetsJson([{ path: 'Assets/Scripts/WebSmoke.cs', handle }])
  assert.equal(json, `{"version":1,"assets":{"Assets/Scripts/WebSmoke.cs":${handle}}}`)
  assert.ok(json.includes(handle))
  assert.equal(JSON.parse(json).assets['Assets/Scripts/WebSmoke.cs'], Number(handle))
  const max = scriptAssetsJson([{ path: 'a.cs', handle: '18446744073709551615' }])
  assert.ok(max.includes('18446744073709551615'))
  assert.throws(() => scriptAssetsJson([{ path: 'a.cs', handle: '0' }]), /十进制 uint64/)
  assert.throws(() => scriptAssetsJson([{ path: 'a.cs', handle: '1e3' }]), /十进制 uint64/)
  assert.throws(() => scriptAssetsJson([{ path: 'a.cs', handle: '18446744073709551616' }]), /超出 uint64/)
})
