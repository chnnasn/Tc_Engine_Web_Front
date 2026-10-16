// Native, editable Tc Tilemap2D scenes for Return. Stage files are authoritative:
// existing files are read, never overwritten during cooking.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const project = resolve(process.env.RETURN_SAMPLE_PROJECT || join(root, 'samples/return'))
const source = join(project, 'Reference'), stages = join(project, 'Assets/Scene/Levels')
const scenes = ['Main', 'default', 'Level1', 'Level2', 'Level3', 'Level4', 'Level5', 'final']
const base = 6200000000000000000n, typeBase = 0x9f00000000000000n
const loadJson = name => JSON.parse(readFileSync(join(source, name), 'utf8'))
const data = () => ({ levels: loadJson('levels.json'), assets: loadJson('assets.json').assets })

// The native Scene 11 reader compares legacy/registry YAML dumps. Keep its
// float32 precision and flow-vector spelling, including exact uint64 handles.
const scalar = value => {
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value)
    const n = Math.fround(value).toPrecision(9)
    return n.includes('e') ? n : n.replace(/0+$/, '').replace(/\.$/, '')
  }
  return typeof value === 'boolean' ? String(value) : JSON.stringify(value)
}
export const tilemapYaml = (value, level = 0) => {
  const indent = ' '.repeat(level)
  if (Array.isArray(value)) return value.length ? value.map(item => `${indent}- ${tilemapYaml(item, level + 2).trimStart()}`).join('\n') : `${indent}[]`
  if (value && typeof value === 'object') return Object.keys(value).length ? Object.entries(value).map(([key, item]) => {
    if (Array.isArray(item) && item.every(entry => typeof entry !== 'object')) return `${indent}${key}: [${item.map(scalar).join(', ')}]`
    return item && typeof item === 'object' ? `${indent}${key}:\n${tilemapYaml(item, level + 2)}` : `${indent}${key}: ${scalar(item)}`
  }).join('\n') : `${indent}{}`
  return indent + scalar(value)
}
const component = (id, name, properties) => ({ TypeId: typeBase + BigInt(id), StableName: `TomCat.${name}`, SchemaVersion: 1, Properties: properties })
const prop = (id, name, value) => ({ PropertyId: id, StableName: name, Value: value })
const tileComponent = entity => entity.Components.find(c => c.StableName === 'TomCat.Tilemap2D')
const setActive = (entity, active) => {
  entity.Tag.Visible = active
  entity.Components.find(c => c.StableName === 'TomCat.Tag').Properties.find(p => p.StableName === 'Visible').Value = active
}
function sourceLayout(map) {
  const xs = map.tiles.map(t => t.x), ys = map.tiles.map(t => t.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs) + 1, minY = Math.min(...ys), maxY = Math.max(...ys) + 1
  const sx = map.W / (maxX - minX), sy = map.H / (maxY - minY)
  return { sx, sy, x: map.X - (minX + maxX) * sx / 2, y: map.Y - (minY + maxY) * sy / 2 }
}
function sourceEntity(map, level, index, assets) {
  const id = base + 30000n + BigInt(level * 100 + index), tag = `ReturnMap_${level}_${index}`
  const layout = sourceLayout(map), translation = [layout.x + layout.sx / 2, layout.y + layout.sy / 2, 0]
  const rotation = [0, 0, 0], scale = [1, 1, 1]
  const spriteHandles = new Map(assets.map(a => [a.name, BigInt(a.handle)]))
  const cells = map.tiles.filter(t => t.sprite && spriteHandles.has(t.sprite)).map(t => ({
    Coordinate: [t.x, t.y], SpriteHandle: spriteHandles.get(t.sprite), Tint: [1, 1, 1, 1], FlipX: false, FlipY: false, RotationQuarterTurns: 0,
  })).sort((a, b) => a.Coordinate[1] - b.Coordinate[1] || a.Coordinate[0] - b.Coordinate[0])
  const entity = {
    Entity: id, Tag: { Tag: tag, Visible: map.Realm !== 1 },
    EntityMetadata: { GameplayTag: 'Untagged', Layer: 0, HierarchyIcon: 'Entity' },
    Transform: { Translation: translation, Rotation: rotation, Scale: scale },
    LocalTransform: { Translation: translation, Rotation: rotation, Scale: scale },
    Components: [
      component(1, 'ID', [prop(1, 'Value', id)]),
      component(2, 'Tag', [prop(1, 'Name', tag), prop(2, 'Visible', map.Realm !== 1)]),
      component(3, 'EntityMetadata', [prop(1, 'GameplayTag', 'Untagged'), prop(2, 'Layer', 0), prop(3, 'HierarchyIcon', 1)]),
      component(4, 'Transform', [prop(1, 'Translation', translation), prop(2, 'Rotation', rotation), prop(3, 'Scale', scale), prop(4, 'LocalTranslation', translation), prop(5, 'LocalRotation', rotation), prop(6, 'LocalScale', scale)]),
      component(0x11, 'Tilemap2D', { Enabled: true, CellSize: [layout.sx, layout.sy], CellGap: [0, 0], SortingLayer: 0, OrderInLayer: map.Order, Cells: cells }),
      component(0x15, 'TilemapRenderer2D', [prop(1400, 'Enabled', true), prop(1401, 'SortOrder', 0), prop(1402, 'Mode', 0), prop(1403, 'DetectChunkCulling', 0), prop(1404, 'SortingLayer', 0), prop(1405, 'OrderInLayer', map.Order), prop(1406, 'Material', 0n)]),
    ], Parent: 0n,
  }
  return entity
}
function cameraForLevel(level, index) {
  const entryPath = join(project, 'Assets/Scene/return.tomcat')
  if (!existsSync(entryPath)) throw Error(`Missing Return entry scene: ${entryPath}`)
  const camera = parse(readFileSync(entryPath, 'utf8'), { intAsBigInt: true }).Entities.find(e => e.Camera)
  if (!camera) throw Error(`Return entry scene has no camera: ${entryPath}`)
  const id = base + 29000n + BigInt(index), bg = [0.1137255, 0.12941177, 0.1764706, 1]
  camera.Entity = id; camera.Tag.Tag = 'MainCamera'
  camera.Camera.BackgroundColor = bg; camera.Camera.Camera.OrthographicSize = level.Size
  camera.Transform.Translation = camera.LocalTransform.Translation = [level.CameraX, level.CameraY, 0]
  for (const c of camera.Components) for (const p of c.Properties) {
    if (c.StableName === 'TomCat.ID') p.Value = id
    if (c.StableName === 'TomCat.Camera' && p.StableName === 'BackgroundColor') p.Value = bg
    if (c.StableName === 'TomCat.Camera' && p.StableName === 'OrthographicSize') p.Value = level.Size
    if (c.StableName === 'TomCat.Transform' && ['Translation', 'LocalTranslation'].includes(p.StableName)) p.Value = [level.CameraX, level.CameraY, 0]
  }
  return camera
}
export function ensureAuthoringScenes() {
  mkdirSync(stages, { recursive: true })
  const { levels, assets } = data()
  for (let level = 1; level < scenes.length; level++) {
    const path = join(stages, `${scenes[level]}.tomcat`)
    if (existsSync(path)) continue
    const reference = loadJson(`${scenes[level]}.json`)
    const document = { SchemaVersion: 11, SceneName: `Return - ${scenes[level]}`, Entities: [cameraForLevel(levels[level], level), ...reference.tilemaps.map((map, index) => sourceEntity(map, level, index, assets))] }
    writeFileSync(path, tilemapYaml(document) + '\n')
    writeFileSync(path + '.tcmeta', `SchemaVersion: 2\nAsset:\n  Handle: ${base + 20000n + BigInt(level)}\n  Type: Scene\n  ImportSettings: {}\n  SubAssets: []\n`)
  }
}
/** Authoritative stage maps, cloned inactive for the combined playable scene. */
export function nativeTilemapEntities({ syncCollisions = true } = {}) {
  ensureAuthoringScenes()
  if (syncCollisions) syncTilemapCollisions()
  const entities = []
  for (let level = 1; level < scenes.length; level++) {
    const scene = parse(readFileSync(join(stages, `${scenes[level]}.tomcat`), 'utf8'), { intAsBigInt: true })
    for (const entity of scene.Entities.filter(tileComponent)) {
      if (!/^ReturnMap_\d+_\d+$/.test(entity.Tag.Tag)) throw Error(`Keep Return map identity when editing: ${entity.Tag.Tag}`)
      setActive(entity, false); entities.push(entity)
    }
  }
  return entities
}

function collisionMasks(reference, assets) {
  const masks = new Map(), names = new Map(assets.map(a => [a.name, a.handle]))
  for (const map of reference.flatMap(r => r.tilemaps).filter(m => m.collide)) {
    const layout = sourceLayout(map)
    for (const tile of map.tiles) {
      if (!tile.sprite || !names.has(tile.sprite)) continue
      const key = names.get(tile.sprite)
      if (masks.has(key)) continue
      const cx = layout.x + (tile.x + .5) * layout.sx, cy = layout.y + (tile.y + .5) * layout.sy
      const parts = []
      if (tile.colliderType) for (const r of map.Solids) {
        const left = Math.max(cx - layout.sx / 2, r.X - r.W / 2), right = Math.min(cx + layout.sx / 2, r.X + r.W / 2)
        const bottom = Math.max(cy - layout.sy / 2, r.Y - r.H / 2), top = Math.min(cy + layout.sy / 2, r.Y + r.H / 2)
        if (right > left + 1e-6 && top > bottom + 1e-6) parts.push({ X: ((left + right) / 2 - cx) / layout.sx, Y: ((bottom + top) / 2 - cy) / layout.sy, W: (right - left) / layout.sx, H: (top - bottom) / layout.sy })
      }
      masks.set(key, parts)
    }
  }
  return masks
}
const cellsKey = cells => JSON.stringify(cells.map(c => [Number(c.Coordinate[0]), Number(c.Coordinate[1]), String(c.SpriteHandle), !!c.FlipX, !!c.FlipY, Number(c.RotationQuarterTurns)]).sort((a, b) => a[1] - b[1] || a[0] - b[0]))
function generatedRects(entity, masks, collide) {
  if (!collide) return []
  const tilemap = tileComponent(entity).Properties, translation = entity.Transform.Translation.map(Number), scale = entity.Transform.Scale.map(Number)
  const size = tilemap.CellSize.map(Number), gap = tilemap.CellGap.map(Number), result = []
  if (entity.Transform.Rotation.some(value => Math.abs(Number(value)) > 1e-5)) throw Error('Return collision authoring supports unrotated Tilemap entities; rotate individual cells instead.')
  for (const cell of tilemap.Cells) {
    const handle = String(cell.SpriteHandle)
    if (!masks.has(handle)) throw Error(`No Return collision profile for sprite ${handle}. Use an imported Return tile in a collision layer.`)
    const x = translation[0] + Number(cell.Coordinate[0]) * (size[0] + gap[0]) * scale[0], y = translation[1] + Number(cell.Coordinate[1]) * (size[1] + gap[1]) * scale[1]
    const angle = Number(cell.RotationQuarterTurns) * Math.PI / 2, co = Math.round(Math.cos(angle)), si = Math.round(Math.sin(angle))
    for (const mask of masks.get(handle)) {
      // Tc applies local cell size/flip before quarter-turn rotation, then the
      // entity scale. This distinction matters for non-square painted cells.
      const ox = mask.X * size[0] * (cell.FlipX ? -1 : 1), oy = mask.Y * size[1] * (cell.FlipY ? -1 : 1)
      result.push({ X: x + (ox * co - oy * si) * scale[0], Y: y + (ox * si + oy * co) * scale[1], W: (Math.abs(co) * mask.W * size[0] + Math.abs(si) * mask.H * size[1]) * Math.abs(scale[0]), H: (Math.abs(si) * mask.W * size[0] + Math.abs(co) * mask.H * size[1]) * Math.abs(scale[1]) })
    }
  }
  // Merge only exact adjacent rectangles; this preserves arch/spike silhouettes.
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) {
      const a = result[i], b = result[j]
      if (Math.abs(a.Y - b.Y) < 1e-6 && Math.abs(a.H - b.H) < 1e-6 && Math.abs(Math.abs(a.X - b.X) - (a.W + b.W) / 2) < 1e-6) {
        const left = Math.min(a.X - a.W / 2, b.X - b.W / 2); a.W += b.W; a.X = left + a.W / 2
      } else if (Math.abs(a.X - b.X) < 1e-6 && Math.abs(a.W - b.W) < 1e-6 && Math.abs(Math.abs(a.Y - b.Y) - (a.H + b.H) / 2) < 1e-6) {
        const bottom = Math.min(a.Y - a.H / 2, b.Y - b.H / 2); a.H += b.H; a.Y = bottom + a.H / 2
      } else continue
      result.splice(j, 1); changed = true; break outer
    }
  }
  return result
}
/** Synchronize authored tile edits into the fixed-step collision data at cook. */
export function syncTilemapCollisions() {
  ensureAuthoringScenes()
  const { levels, assets } = data(), reference = scenes.slice(1).map(name => loadJson(`${name}.json`)), masks = collisionMasks(reference, assets)
  const changes = [], rectangles = []
  for (let level = 1; level < scenes.length; level++) {
    const scene = parse(readFileSync(join(stages, `${scenes[level]}.tomcat`), 'utf8'), { intAsBigInt: true })
    for (let index = 0; index < levels[level].Maps.length; index++) {
      const entity = scene.Entities.find(e => e.Tag.Tag === `ReturnMap_${level}_${index}`)
      if (!entity || !tileComponent(entity)) throw Error(`Missing native ReturnMap_${level}_${index}; erase cells instead of deleting map identities.`)
      const original = sourceEntity(reference[level - 1].tilemaps[index], level, index, assets)
      const same = cellsKey(tileComponent(entity).Properties.Cells) === cellsKey(tileComponent(original).Properties.Cells)
        && tilemapYaml(entity.Transform) === tilemapYaml(original.Transform)
        && tilemapYaml(tileComponent(entity).Properties.CellSize) === tilemapYaml(tileComponent(original).Properties.CellSize)
        && tilemapYaml(tileComponent(entity).Properties.CellGap) === tilemapYaml(tileComponent(original).Properties.CellGap)
      const rects = same ? levels[level].Maps[index].Solids : generatedRects(entity, masks, reference[level - 1].tilemaps[index].collide)
      rectangles.push(rects)
      if (!same) changes.push({ level: scenes[level], map: index, cells: tileComponent(entity).Properties.Cells.length, rectangles: rects.length })
    }
  }
  const path = join(project, 'Assets/Scripts/ReturnLevels.cs'), before = readFileSync(path, 'utf8')
  let index = 0
  const cs = number => `${Number(number.toFixed(6))}f`
  const after = before.replace(/Solids=\[[^\r\n]*?\]/g, () => 'Solids=[' + rectangles[index++].map(r => `new(${['X','Y','W','H'].map(k => cs(r[k])).join(',')})`).join(',') + ']')
  if (index !== rectangles.length) throw Error(`Collision map count mismatch: ${index} vs ${rectangles.length}`)
  if (before !== after) writeFileSync(path, after)
  writeFileSync(join(source, 'edited-tilemaps.json'), JSON.stringify({ changed: changes, note: 'Generated at cook from authoritative Assets/Scene/Levels scenes. Unchanged maps retain original Unity composite collider outlines.' }, null, 2) + '\n')
  return changes
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const maps = nativeTilemapEntities()
  console.log(`Return native Tilemap2D: ${maps.length} maps, ${maps.reduce((n,e) => n + tileComponent(e).Properties.Cells.length,0)} editable cells`)
}
