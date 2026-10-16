import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parse } from 'yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporary = mkdtempSync(join(tmpdir(), 'return-tilemap-'))
try {
  const original = join(root, 'samples/return')
  cpSync(join(original, 'Reference'), join(temporary, 'Reference'), { recursive: true })
  mkdirSync(join(temporary, 'Assets/Scripts'), { recursive: true })
  mkdirSync(join(temporary, 'Assets/Scene'), { recursive: true })
  cpSync(join(original, 'Assets/Scripts/ReturnLevels.cs'), join(temporary, 'Assets/Scripts/ReturnLevels.cs'))
  cpSync(join(original, 'Assets/Scene/return.tomcat'), join(temporary, 'Assets/Scene/return.tomcat'))
  process.env.RETURN_SAMPLE_PROJECT = temporary
  const { nativeTilemapEntities, syncTilemapCollisions, tilemapYaml } = await import('./return-tilemap.mjs')
  const maps = nativeTilemapEntities()
  assert.equal(maps.length, 27)
  assert.equal(maps.reduce((n, e) => n + e.Components.find(c => c.StableName === 'TomCat.Tilemap2D').Properties.Cells.length, 0), 770)
  assert.equal(new Set(maps.map(e => String(e.Entity))).size, maps.length)
  assert.ok(maps.every(e => e.Tag.Visible === false))
  assert.deepEqual(syncTilemapCollisions(), [])
  assert.deepEqual(maps[0].Transform.Translation.map(Number), [.5, .5, 0])

  // Paint one solid tile into an empty tutorial cell; cooking must both preserve
  // the source edit and update gameplay collision, without modifying original data.
  const path = join(temporary, 'Assets/Scene/Levels/default.tomcat')
  const baseline = readFileSync(path, 'utf8')
  const scene = parse(baseline, { intAsBigInt: true })
  const tilemap = scene.Entities.find(e => e.Tag.Tag === 'ReturnMap_1_0').Components.find(c => c.StableName === 'TomCat.Tilemap2D').Properties
  tilemap.Cells.push({ ...structuredClone(tilemap.Cells[0]), Coordinate: [0, 0] })
  const edited = tilemapYaml(scene) + '\n'
  writeFileSync(path, edited)
  const cooked = nativeTilemapEntities()
  assert.equal(readFileSync(path, 'utf8'), edited, 'Cooking overwrote the authoritative editable scene')
  assert.equal(cooked[0].Components.find(c => c.StableName === 'TomCat.Tilemap2D').Properties.Cells.length, 61)
  const changes = syncTilemapCollisions()
  assert.deepEqual(changes, [{ level: 'default', map: 0, cells: 61, rectangles: 5 }])
  assert.match(readFileSync(join(temporary, 'Assets/Scripts/ReturnLevels.cs'), 'utf8'), /new\(0\.5f,0\.5f,1f,1f\)/)
  writeFileSync(path, baseline)
  assert.deepEqual(syncTilemapCollisions(), [], 'Erasing authored changes must restore original collider data')

  // Native transform order: cell-size scale occurs before quarter-turn rotation.
  const rotatedScene = parse(baseline, { intAsBigInt: true })
  const rotatedMap = rotatedScene.Entities.find(e => e.Tag.Tag === 'ReturnMap_1_0').Components.find(c => c.StableName === 'TomCat.Tilemap2D').Properties
  rotatedMap.CellSize = [2, 1]
  rotatedMap.Cells = [{ ...structuredClone(rotatedMap.Cells[0]), Coordinate: [0, 0], RotationQuarterTurns: 1 }]
  writeFileSync(path, tilemapYaml(rotatedScene) + '\n')
  syncTilemapCollisions()
  assert.match(readFileSync(join(temporary, 'Assets/Scripts/ReturnLevels.cs'), 'utf8'), /new\(0\.5f,0\.5f,1f,2f\)/)
  writeFileSync(path, baseline)
  syncTilemapCollisions()

  // The downloadable workflow must run without a frontend checkout or access
  // to build-rougelike.mjs. Supply only the shipped tools and their dependency.
  mkdirSync(join(temporary, 'Tools'), { recursive: true })
  cpSync(join(root, 'scripts/return-tilemap.mjs'), join(temporary, 'Tools/return-tilemap.mjs'))
  cpSync(join(root, 'scripts/return-project-tools/sync-maps.mjs'), join(temporary, 'Tools/sync-maps.mjs'))
  cpSync(join(root, 'scripts/return-project-tools/package.json'), join(temporary, 'package.json'))
  cpSync(join(root, 'node_modules/yaml'), join(temporary, 'node_modules/yaml'), { recursive: true })
  writeFileSync(path, edited)
  const standalone = spawnSync(process.execPath, [join(temporary, 'Tools/sync-maps.mjs')], { cwd: temporary, encoding: 'utf8' })
  assert.equal(standalone.status, 0, standalone.stderr || standalone.stdout)
  const standaloneScene = parse(readFileSync(join(temporary, 'Assets/Scene/return.tomcat'), 'utf8'), { intAsBigInt: true })
  const standaloneMap = standaloneScene.Entities.find(e => e.Tag.Tag === 'ReturnMap_1_0').Components.find(c => c.StableName === 'TomCat.Tilemap2D').Properties
  assert.equal(standaloneMap.Cells.length, 61)
  assert.match(readFileSync(join(temporary, 'Assets/Scripts/ReturnLevels.cs'), 'utf8'), /new\(0\.5f,0\.5f,1f,1f\)/)
  console.log('Return native tilemap checks passed: 27 maps / 770 cells; uint64 IDs; persisted painting; collision rebuild; restoration.')
} finally {
  delete process.env.RETURN_SAMPLE_PROJECT
  // mkdtempSync returned this dedicated temporary directory; no workspace paths.
  rmSync(temporary, { recursive: true, force: true })
}
