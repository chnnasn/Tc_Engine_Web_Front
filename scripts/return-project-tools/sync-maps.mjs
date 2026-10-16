// Installed at Return/Tools/sync-maps.mjs in the downloadable source project.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
process.env.RETURN_SAMPLE_PROJECT = project
const { nativeTilemapEntities, tilemapYaml } = await import('./return-tilemap.mjs')
const entry = join(project, 'Assets/Scene/return.tomcat')
const scene = parse(readFileSync(entry, 'utf8'), { intAsBigInt: true })
const nativeMaps = nativeTilemapEntities()
// Preserve camera, script controller, assets, and any user-created non-map
// entities; only the imported named map copies are replaced from authoring files.
scene.Entities = scene.Entities.filter(entity => !/^ReturnMap_\d+_\d+$/.test(entity.Tag?.Tag || '')).concat(nativeMaps)
writeFileSync(entry, tilemapYaml(scene) + '\n')
console.log(`Return: synchronized ${nativeMaps.length} native maps and collision data. Reload the entry scene in Tc, then run or cook the project.`)
