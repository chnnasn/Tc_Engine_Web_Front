// 从引擎烘焙出的示例 TCPAK 派生出三份内容不同的示例游戏包。
//
// 为什么改写而不是重新 Cook：
//   托管 Web 引擎把 C++ 归档链进 .NET browser-wasm 模块，重建一次需要 .NET 10 +
//   wasm-tools + CMake + Ninja；而且 Web/CMakeLists.txt 只预载 Samples/PhysicsPlayground，
//   build-engine.mjs 又要求引擎工作树干净，无法在不改上游检出内容的前提下加入新示例工程。
//
//   幸运的是 tcpak v7 的索引是定长结构，场景资产的载荷就是引擎自己序列化出来的场景
//   YAML 文本（与 Assets/Scene/*.tomcat 同构）。因此这里直接改写场景载荷、重算每个条目
//   的 SHA-256 与偏移即可得到合法的引擎包，产物仍由引擎在加载时完整校验。
//
// 两条硬性约束（由引擎 ComponentRegistry 的镜像校验强制，改错会直接拒绝加载）：
//   1. 浮点必须写成 float32 的 %.9g 形式。写 1.4 会被拒，必须写 1.39999998。
//   2. 同一实体的 legacy 段（Transform/SpriteRenderer/...）与 Components 段必须逐值一致。
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASE_PACKAGE = resolve(root, '.engine/sample.tcpak')

// tcpak v7 布局：magic(8) + version(u32) + headerSize(u32) + entryCount(u64) + ...
const ENTRY_SIZE = 64 // u64 handle + u16 type + u16 flags + u32 reserved + u64 offset + u64 size + 32B sha256
const SCENE_ASSET_TYPE = 1
const SPRITE_HANDLE = '6071781742850736130'
const SCENE_HANDLE = '12007672766582721512'
const CAMERA_FOV = 0.785398185
const CAMERA_NEAR = 0.00999999978

// TypeId 超过 2^53，必须用字符串保存，否则 JS 数字会丢精度（引擎按 uint64 读取）。
const TYPE = {
  id: '11457157452030541825',
  tag: '11457157452030541826',
  metadata: '11457157452030541827',
  transform: '11457157452030541828',
  camera: '11457157452030541829',
  spriteRenderer: '11457157452030541830',
  rigidbody2D: '11457157452030541836',
  boxCollider2D: '11457157452030541837',
}

// 引擎用 float32 的 %.9g 输出数值，镜像校验按字面量比对，因此这里必须逐字对齐。
function num(value) {
  const rounded = Math.fround(value)
  if (!Number.isFinite(rounded)) throw new Error(`场景数值必须是有限数：${value}`)
  if (rounded === 0) return '0'
  const text = rounded.toPrecision(9)
  if (text.includes('e') || text.includes('E')) return text
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
}
const vec = values => `[${values.map(num).join(', ')}]`
const bool = value => (value ? 'true' : 'false')

function identityComponents(uuid, name) {
  return `      - TypeId: ${TYPE.id}
        StableName: TomCat.ID
        SchemaVersion: 1
        Properties:
          - PropertyId: 1
            StableName: Value
            Value: ${uuid}
      - TypeId: ${TYPE.tag}
        StableName: TomCat.Tag
        SchemaVersion: 1
        Properties:
          - PropertyId: 1
            StableName: Name
            Value: ${name}
          - PropertyId: 2
            StableName: Visible
            Value: true
      - TypeId: ${TYPE.metadata}
        StableName: TomCat.EntityMetadata
        SchemaVersion: 1
        Properties:
          - PropertyId: 1
            StableName: GameplayTag
            Value: Untagged
          - PropertyId: 2
            StableName: Layer
            Value: 0
          - PropertyId: 3
            StableName: HierarchyIcon
            Value: 1`
}

function transformSection(translation, rotation, scale) {
  return `    Transform:
      Translation: ${vec(translation)}
      Rotation: ${vec(rotation)}
      Scale: ${vec(scale)}
    LocalTransform:
      Translation: ${vec(translation)}
      Rotation: ${vec(rotation)}
      Scale: ${vec(scale)}`
}

function transformComponents(translation, rotation, scale) {
  return `      - TypeId: ${TYPE.transform}
        StableName: TomCat.Transform
        SchemaVersion: 1
        Properties:
          - PropertyId: 1
            StableName: Translation
            Value: ${vec(translation)}
          - PropertyId: 2
            StableName: Rotation
            Value: ${vec(rotation)}
          - PropertyId: 3
            StableName: Scale
            Value: ${vec(scale)}
          - PropertyId: 4
            StableName: LocalTranslation
            Value: ${vec(translation)}
          - PropertyId: 5
            StableName: LocalRotation
            Value: ${vec(rotation)}
          - PropertyId: 6
            StableName: LocalScale
            Value: ${vec(scale)}`
}

function cameraEntity(spec) {
  const { uuid, name, translation, rotation, scale, background } = spec
  return `  - Entity: ${uuid}
    Tag:
      Tag: ${name}
      Visible: true
    EntityMetadata:
      GameplayTag: Untagged
      Layer: 0
      HierarchyIcon: Entity
${transformSection(translation, rotation, scale)}
    Camera:
      Camera:
        ProjectionType: 1
        PerspectiveFOV: ${num(CAMERA_FOV)}
        PerspectiveNear: ${num(CAMERA_NEAR)}
        PerspectiveFar: 1000
        OrthographicSize: 10
        OrthographicNear: -1
        OrthographicFar: 1
      Primary: true
      FixedAspectRatio: false
      BackgroundColor: ${vec(background)}
    Components:
${identityComponents(uuid, name)}
${transformComponents(translation, rotation, scale)}
      - TypeId: ${TYPE.camera}
        StableName: TomCat.Camera
        SchemaVersion: 2
        Properties:
          - PropertyId: 300
            StableName: Primary
            Value: true
          - PropertyId: 301
            StableName: FixedAspectRatio
            Value: false
          - PropertyId: 302
            StableName: BackgroundColor
            Value: ${vec(background)}
          - PropertyId: 303
            StableName: ProjectionType
            Value: 1
          - PropertyId: 304
            StableName: OrthographicSize
            Value: 10
          - PropertyId: 305
            StableName: OrthographicNearClip
            Value: -1
          - PropertyId: 306
            StableName: OrthographicFarClip
            Value: 1
          - PropertyId: 307
            StableName: PerspectiveVerticalFov
            Value: ${num(CAMERA_FOV)}
          - PropertyId: 308
            StableName: PerspectiveNearClip
            Value: ${num(CAMERA_NEAR)}
          - PropertyId: 309
            StableName: PerspectiveFarClip
            Value: 1000
          - PropertyId: 310
            StableName: Enabled
            Value: true
    Parent: 0`
}

function spriteEntity(spec) {
  const { uuid, name, translation, rotation, scale, color, dynamic } = spec
  const legacyRigidbody = dynamic
    ? `    Rigidbody2D:
      Enabled: true
      BodyType: Dynamic
      FixedRotation: false
`
    : ''
  const componentRigidbody = dynamic
    ? `      - TypeId: ${TYPE.rigidbody2D}
        StableName: TomCat.Rigidbody2D
        SchemaVersion: 1
        Properties:
          - PropertyId: 100
            StableName: Enabled
            Value: true
          - PropertyId: 101
            StableName: BodyType
            Value: 1
          - PropertyId: 102
            StableName: FixedRotation
            Value: false
`
    : ''
  return `  - Entity: ${uuid}
    Tag:
      Tag: ${name}
      Visible: true
    EntityMetadata:
      GameplayTag: Untagged
      Layer: 0
      HierarchyIcon: Entity
${transformSection(translation, rotation, scale)}
    SpriteRenderer:
      Enabled: true
      Color: ${vec(color)}
      SpriteHandle: ${SPRITE_HANDLE}
      TilingFactor: 1
      SortingLayer: 0
      OrderInLayer: 0
${legacyRigidbody}    BoxCollider2D:
      Enabled: true
      IsTrigger: false
      CollisionLayer: 1
      CollisionMask: 65535
      Offset: [0, 0]
      Size: [0.5, 0.5]
      Density: 1
      Friction: 0.5
      Restitution: 0
      RestitutionThreshold: 0.5
    Components:
${identityComponents(uuid, name)}
${transformComponents(translation, rotation, scale)}
      - TypeId: ${TYPE.spriteRenderer}
        StableName: TomCat.SpriteRenderer
        SchemaVersion: 1
        Properties:
          - PropertyId: 200
            StableName: Enabled
            Value: true
          - PropertyId: 201
            StableName: Color
            Value: ${vec(color)}
          - PropertyId: 202
            StableName: Sprite
            Value: ${SPRITE_HANDLE}
          - PropertyId: 203
            StableName: TilingFactor
            Value: 1
          - PropertyId: 204
            StableName: SortingLayer
            Value: 0
          - PropertyId: 205
            StableName: OrderInLayer
            Value: 0
${componentRigidbody}      - TypeId: ${TYPE.boxCollider2D}
        StableName: TomCat.BoxCollider2D
        SchemaVersion: 1
        Properties:
          - PropertyId: 400
            StableName: Enabled
            Value: true
          - PropertyId: 401
            StableName: IsTrigger
            Value: false
          - PropertyId: 402
            StableName: CollisionLayer
            Value: 1
          - PropertyId: 403
            StableName: CollisionMask
            Value: 65535
          - PropertyId: 404
            StableName: Offset
            Value: [0, 0]
          - PropertyId: 405
            StableName: Size
            Value: [0.5, 0.5]
          - PropertyId: 406
            StableName: Density
            Value: 1
          - PropertyId: 407
            StableName: Friction
            Value: 0.5
          - PropertyId: 408
            StableName: Restitution
            Value: 0
          - PropertyId: 409
            StableName: RestitutionThreshold
            Value: 0.5
    Parent: 0`
}

// 三个示例共用同一台正交相机（尺寸 10，即可见高度 -5..5），只换背景色。
const CAMERA_UUID = '3000000000000000001'
const camera = background => ({ uuid: CAMERA_UUID, name: 'MainCamera', translation: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], background })

let nextUuid = 0
const entity = spec => ({ uuid: String(3000000000000000100n + BigInt(nextUuid++)), dynamic: true, rotation: [0, 0, 0], ...spec })

export const sampleGames = [
  {
    id: 'forest',
    title: '林间来信',
    scene: 'forest',
    // 林间来信：暖绿背景 + 苔色地面，四片叶子从不同高度飘落。
    background: [0.36, 0.52, 0.34, 1],
    entities: [
      entity({ name: 'MossyGround', translation: [0, -2.4, 0], scale: [7, 0.5, 1], color: [0.3, 0.44, 0.26, 1], dynamic: false }),
      entity({ name: 'LeafA', translation: [-2.2, 2.4, 0], rotation: [0, 0, 0.32], scale: [0.7, 0.5, 1], color: [0.62, 0.78, 0.42, 1] }),
      entity({ name: 'LeafB', translation: [0.4, 3.1, 0], rotation: [0, 0, -0.55], scale: [0.9, 0.62, 1], color: [0.5, 0.7, 0.36, 1] }),
      entity({ name: 'LeafC', translation: [2.1, 2, 0], rotation: [0, 0, 0.95], scale: [0.6, 0.45, 1], color: [0.72, 0.84, 0.5, 1] }),
      entity({ name: 'LeafD', translation: [-0.9, 3.8, 0], rotation: [0, 0, -0.2], scale: [0.8, 0.55, 1], color: [0.44, 0.64, 0.34, 1] }),
    ],
  },
  {
    id: 'puzzle',
    title: '方寸之间',
    scene: 'puzzle',
    // 方寸之间：冷灰蓝背景 + 两侧静态台阶，两块暖色方块落进中间。
    background: [0.2, 0.24, 0.3, 1],
    entities: [
      entity({ name: 'Floor', translation: [0, -2.6, 0], scale: [6, 0.4, 1], color: [0.3, 0.35, 0.42, 1], dynamic: false }),
      entity({ name: 'StepLeft', translation: [-1.6, -1.6, 0], scale: [1, 0.5, 1], color: [0.62, 0.68, 0.78, 1], dynamic: false }),
      entity({ name: 'StepRight', translation: [1.6, -1.6, 0], scale: [1, 0.5, 1], color: [0.62, 0.68, 0.78, 1], dynamic: false }),
      entity({ name: 'PieceA', translation: [0, 2.6, 0], rotation: [0, 0, 0.785398185], scale: [0.8, 0.8, 1], color: [0.85, 0.72, 0.45, 1] }),
      entity({ name: 'PieceB', translation: [0.3, 3.8, 0], rotation: [0, 0, -0.4], scale: [0.6, 0.6, 1], color: [0.78, 0.64, 0.4, 1] }),
    ],
  },
  {
    id: 'desert',
    title: '日落以后',
    scene: 'desert',
    // 日落以后：夕阳橙背景 + 宽沙丘，三块暖色石头依次落下。
    background: [0.86, 0.52, 0.28, 1],
    entities: [
      entity({ name: 'Dune', translation: [0, -2.2, 0], scale: [9, 0.6, 1], color: [0.72, 0.5, 0.28, 1], dynamic: false }),
      entity({ name: 'SunStoneA', translation: [-2.8, 2.8, 0], rotation: [0, 0, 0.5], scale: [0.75, 0.75, 1], color: [0.95, 0.78, 0.45, 1] }),
      entity({ name: 'SunStoneB', translation: [1.2, 3.4, 0], rotation: [0, 0, -0.35], scale: [0.9, 0.6, 1], color: [0.9, 0.62, 0.35, 1] }),
      entity({ name: 'SunStoneC', translation: [2.9, 2.2, 0], rotation: [0, 0, 0.8], scale: [0.55, 0.55, 1], color: [0.98, 0.85, 0.55, 1] }),
    ],
  },
]

export function sceneDocument(game) {
  const bodies = [cameraEntity(camera(game.background)), ...game.entities.map(spriteEntity)]
  return `SchemaVersion: 11
SceneName: ${game.scene}
Entities:
${bodies.join('\n')}`
}

// 改写场景载荷后按 tcpak v7 规则重排索引：条目顺序不变，偏移与摘要重算。
export function repackPackage(base, sceneText) {
  const headerSize = base.readUInt32LE(12)
  const entryCount = Number(base.readBigUInt64LE(16))
  if (base.subarray(0, 8).toString('ascii') !== 'TCPACK01' || base.readUInt32LE(8) !== 7) throw new Error('示例基底必须是 tcpak v7')
  const entries = []
  for (let index = 0; index < entryCount; index++) {
    const at = headerSize + index * ENTRY_SIZE
    const offset = Number(base.readBigUInt64LE(at + 16))
    const size = Number(base.readBigUInt64LE(at + 24))
    entries.push({
      rawHandle: base.readBigUInt64LE(at), rawType: base.readUInt16LE(at + 8),
      flags: base.readUInt16LE(at + 10), reserved: base.readUInt32LE(at + 12),
      payload: base.subarray(offset, offset + size),
    })
  }
  const scene = entries.findIndex(entry => entry.rawType === SCENE_ASSET_TYPE)
  if (scene < 0) throw new Error('示例基底里没有场景资产')
  entries[scene].payload = Buffer.from(sceneText, 'utf8')
  let cursor = headerSize + entryCount * ENTRY_SIZE
  for (const entry of entries) {
    entry.offset = cursor
    entry.size = entry.payload.length
    cursor += entry.size
  }
  const output = Buffer.alloc(cursor)
  base.copy(output, 0, 0, headerSize)
  let at = headerSize
  for (const entry of entries) {
    output.writeBigUInt64LE(entry.rawHandle, at)
    output.writeUInt16LE(entry.rawType, at + 8)
    output.writeUInt16LE(entry.flags, at + 10)
    output.writeUInt32LE(entry.reserved, at + 12)
    output.writeBigUInt64LE(BigInt(entry.offset), at + 16)
    output.writeBigUInt64LE(BigInt(entry.size), at + 24)
    createHash('sha256').update(entry.payload).digest().copy(output, at + 32)
    at += ENTRY_SIZE
  }
  for (const entry of entries) entry.payload.copy(output, entry.offset)
  return output
}

function main() {
  if (!existsSync(BASE_PACKAGE)) {
    throw new Error(`缺少示例基底 ${BASE_PACKAGE}，请先运行 npm run engine:build（会同时构建 tomcat_player 夹具）`)
  }
  const base = readFileSync(BASE_PACKAGE)
  const outputDirectory = resolve(process.argv[2] || join(root, '.engine/games'))
  mkdirSync(outputDirectory, { recursive: true })
  for (const game of sampleGames) {
    const bytes = repackPackage(base, sceneDocument(game))
    const target = join(outputDirectory, `${game.id}.tcpak`)
    writeFileSync(target, bytes)
    console.log(`${game.id.padEnd(7)} ${game.title}  →  ${target}  (${bytes.length} 字节)`)
  }
  console.log(`场景 Handle 保持 ${SCENE_HANDLE}，精灵 Handle 保持 ${SPRITE_HANDLE}。`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
