// Build the sample with Tc's own C# compiler and TCPAK writer. Gameplay is C#.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const project = join(root, 'samples/rougelike')
const output = join(root, 'public/samples/rougelike')
export const handles = {
  script: 6100000000000000001n, scene: 6100000000000000002n,
  player: 6100000000000000010n, circle: 6100000000000000011n,
  square: 6100000000000000012n, triangle: 6100000000000000013n,
  hexagonPointed: 6100000000000000014n, hexagonFlat: 6100000000000000015n,
  monogram: 6100000000000000020n, silver: 6100000000000000021n,
  welcome: 6100000000000000030n, knife: 6100000000000000031n,
  hit: 6100000000000000032n, death: 6100000000000000033n,
  hurt: 6100000000000000034n, blackHole: 6100000000000000035n,
}

// Mirror the engine's float32 %.9g serialization, preserving uint64 identities.
const scalar = value => {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value)
    const number = Math.fround(value).toPrecision(9)
    return number.includes('e') ? number : number.replace(/0+$/, '').replace(/\.$/, '')
  }
  if (typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
const yaml = (value, level = 0) => {
  const indent = ' '.repeat(level)
  if (Array.isArray(value)) {
    if (!value.length) return `${indent}[]`
    return value.map(item => {
      const body = yaml(item, level + 2)
      return `${indent}- ${body.trimStart()}`
    }).join('\n')
  }
  if (value && typeof value === 'object') {
    if (!Object.keys(value).length) return `${indent}{}`
    return Object.entries(value).map(([key, item]) => {
      if (Array.isArray(item) && item.every(entry => typeof entry !== 'object')) return `${indent}${key}: [${item.map(scalar).join(', ')}]`
      if (item && typeof item === 'object') return `${indent}${key}:\n${yaml(item, level + 2)}`
      return `${indent}${key}: ${scalar(item)}`
    }).join('\n')
  }
  return indent + scalar(value)
}
const prop = (PropertyId, StableName, Value) => ({ PropertyId, StableName, Value })
const component = (TypeId, StableName, SchemaVersion, Properties) => ({ TypeId, StableName, SchemaVersion, Properties })
function entity(id, name, position = [0, 0, 0]) {
  const transform = { Translation: position, Rotation: [0, 0, 0], Scale: [1, 1, 1] }
  return {
    Entity: id, Tag: { Tag: name, Visible: true },
    EntityMetadata: { GameplayTag: 'Untagged', Layer: 0, HierarchyIcon: 'Entity' },
    Transform: transform, LocalTransform: transform,
    Components: [
      component(0x9f00000000000001n, 'TomCat.ID', 1, [prop(1, 'Value', id)]),
      component(0x9f00000000000002n, 'TomCat.Tag', 1, [prop(1, 'Name', name), prop(2, 'Visible', true)]),
      component(0x9f00000000000003n, 'TomCat.EntityMetadata', 1, [prop(1, 'GameplayTag', 'Untagged'), prop(2, 'Layer', 0), prop(3, 'HierarchyIcon', 1)]),
      component(0x9f00000000000004n, 'TomCat.Transform', 1, [prop(1, 'Translation', position), prop(2, 'Rotation', [0, 0, 0]), prop(3, 'Scale', [1, 1, 1]), prop(4, 'LocalTranslation', position), prop(5, 'LocalRotation', [0, 0, 0]), prop(6, 'LocalScale', [1, 1, 1])]),
    ], Parent: 0,
  }
}
export function sceneDocument() {
  const camera = entity(6100000000000000100n, 'MainCamera')
  const background = [0.9682644, 0.9684492, 0.8876525, 1]
  camera.Camera = { Camera: { ProjectionType: 1, PerspectiveFOV: 0.785398185, PerspectiveNear: 0.00999999978, PerspectiveFar: 1000, OrthographicSize: 648, OrthographicNear: 0, OrthographicFar: 1000 }, Primary: true, FixedAspectRatio: false, BackgroundColor: background, Exposure: 0, Saturation: 1, Vignette: 0 }
  camera.Components.push(component(0x9f00000000000005n, 'TomCat.Camera', 4, [
    prop(300, 'Primary', true), prop(301, 'FixedAspectRatio', false), prop(302, 'BackgroundColor', background), prop(303, 'ProjectionType', 1), prop(304, 'OrthographicSize', 648), prop(305, 'OrthographicNearClip', 0), prop(306, 'OrthographicFarClip', 1000), prop(307, 'PerspectiveVerticalFov', 0.785398185), prop(308, 'PerspectiveNearClip', 0.00999999978), prop(309, 'PerspectiveFarClip', 1000), prop(310, 'Enabled', true), prop(311, 'Exposure', 0), prop(312, 'Saturation', 1), prop(313, 'Vignette', 0),
  ]))
  const controller = entity(6100000000000000101n, 'RougelikeGame')
  const scripts = { Scripts: [{ AttachmentID: 6100000000000000102n, Enabled: true, ScriptHandle: handles.script, ClassName: 'TomCatGame.RougelikeGame', Fields: [] }] }
  controller.CSharpScripts = scripts
  controller.Components.push(component(0x9f00000000000009n, 'TomCat.CSharpScripts', 1, scripts))
  const entities = [camera, controller]
  // Cook traverses serialized references. Offscreen, disabled anchors retain
  // the textures/fonts that the C# controller assigns to runtime entities.
  const textures = ['player', 'circle', 'square', 'triangle', 'hexagonPointed', 'hexagonFlat']
  for (const [index, key] of textures.entries()) {
    const anchor = entity(6100000000000000200n + BigInt(index), `Asset_${key}`, [10000, 10000, 0])
    anchor.SpriteRenderer = { Enabled: false, Color: [1, 1, 1, 1], SpriteHandle: handles[key], TilingFactor: 1, SortingLayer: 0, OrderInLayer: 0, NormalMap: 0, CastShadows: false, Material: 0 }
    anchor.Components.push(component(0x9f00000000000006n, 'TomCat.SpriteRenderer', 2, [prop(200, 'Enabled', false), prop(201, 'Color', [1, 1, 1, 1]), prop(202, 'Sprite', handles[key]), prop(203, 'TilingFactor', 1), prop(204, 'SortingLayer', 0), prop(205, 'OrderInLayer', 0), prop(206, 'NormalMap', 0), prop(207, 'CastShadows', false), prop(208, 'Material', 0)]))
    entities.push(anchor)
  }
  for (const [index, key] of ['monogram', 'silver'].entries()) {
    const anchor = entity(6100000000000000300n + BigInt(index), `Font_${key}`, [10000, 10000, 0])
    anchor.Components.push(component(0x9f01000000000001n, 'TomCat.TextRenderer', 1, [prop(0x9f01100000000001n, 'Enabled', false), prop(0x9f01100000000002n, 'Font', handles[key]), prop(0x9f01100000000003n, 'Text', 'Rougelike'), prop(0x9f01100000000004n, 'FontSize', 32), prop(0x9f01100000000005n, 'Color', [0, 0, 0, 1]), prop(0x9f01100000000006n, 'Alignment', 0), prop(0x9f01100000000007n, 'MaxWidth', 0), prop(0x9f01100000000008n, 'LineSpacing', 1), prop(0x9f01100000000009n, 'FallbackFont', handles.silver), prop(0x9f0110000000000an, 'EmojiFont', 0)]))
    entities.push(anchor)
  }
  for (const [index, key] of ['welcome', 'knife', 'hit', 'death', 'hurt', 'blackHole'].entries()) {
    const anchor = entity(6100000000000000400n + BigInt(index), `Audio_${key}`, [10000, 10000, 0])
    const settings = { Enabled: false, Clip: handles[key], PlayOnStart: false, Loop: false, Streaming: false, Volume: 1, Pitch: 1, SpatialBlend: 0, MinDistance: 1, MaxDistance: 25, MixerGroup: index === 0 ? 1 : 2, Bus: 4294967295 }
    anchor.AudioSource = settings
    anchor.Components.push(component(0x9f0000000000000an, 'TomCat.AudioSource', 2, Object.entries(settings).map(([name, value], offset) => prop(900 + offset, name, value))))
    entities.push(anchor)
  }
  return yaml({ SchemaVersion: 11, SceneName: 'Rougelike', Entities: entities }) + '\n'
}

export function validatePackage(bytes) {
  if (bytes.subarray(0, 8).toString('ascii') !== 'TCPACK01' || bytes.readUInt32LE(8) !== 8) throw new Error('Expected a Tc TCPAK v8 package')
  const size = bytes.readUInt32LE(12), count = Number(bytes.readBigUInt64LE(16)), found = new Set()
  let hasAssembly = false
  for (let index = 0; index < count; index++) {
    const at = size + index * 64
    const handle = bytes.readBigUInt64LE(at), offset = Number(bytes.readBigUInt64LE(at + 16)), length = Number(bytes.readBigUInt64LE(at + 24))
    if (offset + length > bytes.length) throw new Error(`Invalid TCPAK entry ${handle}`)
    const payload = bytes.subarray(offset, offset + length)
    if (!createHash('sha256').update(payload).digest().equals(bytes.subarray(at + 32, at + 64))) throw new Error(`TCPAK hash mismatch ${handle}`)
    found.add(handle)
    if ((bytes.readUInt16LE(at + 10) & 1) && payload.subarray(0, 8).toString('ascii') === 'TCMAN001' && payload.includes(Buffer.from([0x4d, 0x5a, 0x90, 0x00]))) hasAssembly = true
  }
  for (const [name, handle] of Object.entries(handles)) {
    if (name !== 'script' && !found.has(handle)) throw new Error(`Cook omitted ${name} (${handle})`)
  }
  if (!hasAssembly) throw new Error('Cook omitted the managed gameplay assembly')
  return count
}

// Small dependency-free ZIP writer: source stays downloadable without Library
// caches or machine-specific paths. Stored entries keep this code auditable.
function sourceZip(directory) {
  const files = []
  const walk = path => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['Library', 'bin', 'obj'].includes(entry.name) || entry.name.startsWith('.')) continue
      const target = join(path, entry.name)
      if (entry.isDirectory()) walk(target)
      else files.push({ name: Buffer.from(`Rougelike/${relative(directory, target).replace(/\\/g, '/')}`), data: readFileSync(target) })
    }
  }
  walk(directory)
  const parts = [], central = []
  let offset = 0
  for (const { name, data } of files) {
    let crc = 0xffffffff
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)) }
    crc = (crc ^ 0xffffffff) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26)
    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x800, 8); record.writeUInt16LE(0x21, 14)
    record.writeUInt32LE(crc, 16); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42)
    parts.push(local, name, data); central.push(record, name); offset += local.length + name.length + data.length
  }
  const directoryBytes = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directoryBytes.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, directoryBytes, end])
}

function main() {
  mkdirSync(join(project, 'Assets/Scene'), { recursive: true })
  writeFileSync(join(project, 'Assets/Scene/rougelike.tomcat'), sceneDocument())
  if (process.argv.includes('--scene-only')) return
  const worker = resolve(process.env.TOMCAT_COOK_WORKER || join(root, '../Tc_Engine_Web_backend/cook/worker.mjs'))
  const player = resolve(process.env.TOMCAT_PLAYER_DIR || join(root, '.engine/player-fixture'))
  const managed = resolve(process.env.TOMCAT_MANAGED_DIR || join(root, '.engine/upgrade-managed'))
  for (const path of [worker, join(player, 'tomcat_player.js'), join(managed, 'TomCat.Managed.dll'), join(managed, 'TomCat.ScriptGenerator.dll')]) {
    if (!existsSync(path)) throw new Error(`Missing build input: ${path}. See samples/rougelike/README.md for toolchain setup.`)
  }
  const lock = JSON.parse(readFileSync(join(root, 'engine.lock.json'), 'utf8'))
  for (const directory of [player, managed]) {
    const versionFile = join(directory, 'engine-commit.txt')
    if (existsSync(versionFile) && readFileSync(versionFile, 'utf8').trim() !== lock.commit) throw new Error(`Stale Tc build inputs in ${directory}; run npm run engine:build for ${lock.commit} first.`)
  }
  mkdirSync(output, { recursive: true })
  const target = join(output, 'rougelike.tcpak')
  const result = spawnSync(process.execPath, [worker, join(project, 'Project.tcproj'), target], { cwd: root, env: { ...process.env, TOMCAT_PLAYER_DIR: player, TOMCAT_MANAGED_DIR: managed }, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`Tc cook failed (${result.status}): ${result.error?.message || 'see compiler/cooker diagnostics above'}`)
  const bytes = readFileSync(target), entries = validatePackage(bytes)
  writeFileSync(join(output, 'rougelike-source.zip'), sourceZip(project))
  writeFileSync(join(output, 'manifest.json'), JSON.stringify({ id: 'rougelike', title: 'Rougelike', engine: 'TomCat', engineCommit: lock.commit, packageVersion: 8, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), entries, packageUrl: '/samples/rougelike/rougelike.tcpak', sourceUrl: '/samples/rougelike/rougelike-source.zip' }, null, 2) + '\n')
  console.log(`Rougelike: verified ${entries} TCPAK entries, ${bytes.length} bytes; C# gameplay, original graphics/fonts/audio included.`)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
