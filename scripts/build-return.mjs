// Return is cooked by the same pinned native Tc toolchain as the other samples.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { sceneDocument as referenceScene } from './build-rougelike.mjs'
import { nativeTilemapEntities } from './return-tilemap.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const project = join(root, 'samples/return'), output = join(root, 'public/samples/return')
const base = 6200000000000000000n
// Whole-map PNGs are source references only; gameplay renders editable cells.
const runtimeAsset = asset => !/^Assets\/Art\/map-.*\.png$/.test(asset.path)
// Scene 11's legacy/registry agreement uses canonical float32 values and flow
// vectors. Match the native serializer, including exact uint64 identities.
export const scalar = value => {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value)
    const number = Math.fround(value).toPrecision(9)
    return number.includes('e') ? number : number.replace(/0+$/, '').replace(/\.$/, '')
  }
  return typeof value==='boolean' ? String(value) : JSON.stringify(value)
}
export const yaml = (value, level=0) => {
  const indent=' '.repeat(level)
  if(Array.isArray(value))return value.length?value.map(item=>`${indent}- ${yaml(item,level+2).trimStart()}`).join('\n'):`${indent}[]`
  if(value&&typeof value==='object')return Object.keys(value).length?Object.entries(value).map(([key,item])=>{
    if(Array.isArray(item)&&item.every(entry=>typeof entry!=='object'))return `${indent}${key}: [${item.map(scalar).join(', ')}]`
    return item&&typeof item==='object'?`${indent}${key}:\n${yaml(item,level+2)}`:`${indent}${key}: ${scalar(item)}`
  }).join('\n'):`${indent}{}`
  return indent+scalar(value)
}
export function assetList() {
  const assets = []
  function walk(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (entry.name.endsWith('.tcmeta')) {
        const asset = parse(readFileSync(file, 'utf8'), { intAsBigInt: true }).Asset
        assets.push({ path: relative(project, file.slice(0, -7)).replaceAll('\\', '/'), handle: asset.Handle, type: asset.Type })
      }
    }
  }
  walk(join(project, 'Assets')); return assets
}
export function sceneDocument(assets) {
  const tilemaps = nativeTilemapEntities()
  assets ??= assetList()
  // Clone the pinned schema's camera, script attachment and disabled asset anchors.
  const reference = parse(referenceScene(), { intAsBigInt: true })
  const entities = reference.Entities.slice(0, 2)
  const background = [0.1137255, 0.12941177, 0.1764706, 1]
  entities[0].Camera.BackgroundColor = background
  entities[0].Camera.Camera.OrthographicSize = 16.875
  for (const property of entities[0].Components.find(c=>c.StableName==='TomCat.Camera').Properties) {
    if(property.StableName==='BackgroundColor')property.Value=background
    if(property.StableName==='OrthographicSize')property.Value=16.875
  }
  const convert = object => {
    if (typeof object === 'bigint') return object >= 6100000000000000000n && object < 6100000000000100000n ? object + 100000000000000000n : object
    if (Array.isArray(object)) return object.map(convert)
    if (object && typeof object === 'object') return Object.fromEntries(Object.entries(object).map(([k,v]) => [k,convert(v)]))
    return typeof object === 'string' ? object.replaceAll('Rougelike', 'Return') : object
  }
  const templates = { Texture2D: reference.Entities.find(e => e.SpriteRenderer), Font: reference.Entities.find(e => e.Tag.Tag.startsWith('Font_')), Audio: reference.Entities.find(e => e.AudioSource) }
  for (const asset of assets.filter(a => runtimeAsset(a) && templates[a.type])) {
    const anchor = structuredClone(templates[asset.type])
    const id = base + 1000n + BigInt(entities.length)
    anchor.Entity = id; anchor.Tag.Tag = 'Asset_' + asset.path
    for (const c of anchor.Components) {
      for (const p of Array.isArray(c.Properties) ? c.Properties : []) {
        if (c.StableName === 'TomCat.ID') p.Value = id
        if (c.StableName === 'TomCat.Tag' && p.StableName === 'Name') p.Value = anchor.Tag.Tag
        if (['Sprite', 'Font', 'Clip'].includes(p.StableName)) p.Value = asset.handle
        if (['FallbackFont', 'EmojiFont'].includes(p.StableName)) p.Value = 0n
      }
    }
    if (anchor.SpriteRenderer) anchor.SpriteRenderer.SpriteHandle = asset.handle
    if (anchor.AudioSource) anchor.AudioSource.Clip = asset.handle
    entities.push(anchor)
  }
  entities.push(...tilemaps)
  return yaml(convert({ SchemaVersion: 11, SceneName: 'Return', Entities: entities }))+'\n'
}
export function validatePackage(bytes, assets = assetList()) {
  if (bytes.subarray(0,8).toString() !== 'TCPACK01' || bytes.readUInt32LE(8) !== 8) throw Error('Expected TCPAK v8')
  const start = bytes.readUInt32LE(12), count = Number(bytes.readBigUInt64LE(16)), found = new Set()
  let managed = false
  if (count > 100000 || start + count * 64 > bytes.length) throw Error('Invalid TCPAK table')
  for (let i=0;i<count;i++) {
    const at=start+i*64, handle=bytes.readBigUInt64LE(at), offset=Number(bytes.readBigUInt64LE(at+16)), size=Number(bytes.readBigUInt64LE(at+24))
    if (offset+size>bytes.length) throw Error('Invalid TCPAK entry bounds')
    const payload=bytes.subarray(offset,offset+size)
    if (!createHash('sha256').update(payload).digest().equals(bytes.subarray(at+32,at+64))) throw Error(`TCPAK hash mismatch ${handle}`)
    found.add(handle)
    if (payload.subarray(0,8).toString()==='TCMAN001' && payload.includes(Buffer.from([0x4d,0x5a,0x90,0]))) managed=true
  }
  for (const asset of assets.filter(a=>runtimeAsset(a)&&a.type!=='CSharpScript'&&(a.type!=='Scene'||a.handle===base+2n))) if(!found.has(asset.handle)) throw Error(`Cook omitted ${asset.path}`)
  if (!managed) throw Error('Cook omitted managed gameplay assembly')
  return count
}
function main() {
  mkdirSync(join(project,'Assets/Scene'),{recursive:true}); mkdirSync(output,{recursive:true})
  mkdirSync(join(project,'Tools'),{recursive:true})
  for (const [from,to] of [
    ['return-project-tools/package.json','package.json'],
    ['return-project-tools/sync-maps.mjs','Tools/sync-maps.mjs'],
    ['return-project-tools/README.md','Tools/README.md'],
    ['return-tilemap.mjs','Tools/return-tilemap.mjs'],
  ]) copyFileSync(join(root,'scripts',from),join(project,to))
  writeFileSync(join(project,'Assets/Scene/return.tomcat'),sceneDocument())
  if(process.argv.includes('--scene-only'))return
  const player=resolve(process.env.TOMCAT_PLAYER_DIR || join(root,'.engine/player-fixture'))
  const managed=resolve(process.env.TOMCAT_MANAGED_DIR || join(root,'.engine/upgrade-managed'))
  const worker=resolve(process.env.TOMCAT_COOK_WORKER || join(root,'../Tc_Engine_Web_backend/cook/worker.mjs'))
  const lock=JSON.parse(readFileSync(join(root,'engine.lock.json'),'utf8'))
  for(const dir of [player,managed]) {
    if(!existsSync(join(dir,'engine-commit.txt')) || readFileSync(join(dir,'engine-commit.txt'),'utf8').trim()!==lock.commit)throw Error(`Missing/stale pinned Tc toolchain: ${dir}`)
  }
  const target=join(output,'return.tcpak')
  const result=spawnSync(process.execPath,[worker,join(project,'Project.tcproj'),target],{cwd:root,env:{...process.env,TOMCAT_PLAYER_DIR:player,TOMCAT_MANAGED_DIR:managed},stdio:'inherit'})
  if(result.status!==0)throw Error('Tc cook failed; see compiler/cooker diagnostics')
  const bytes=readFileSync(target), entries=validatePackage(bytes)
  // Python's ZIP implementation provides deflate and deterministic file timestamps.
  const zip=spawnSync(process.env.PYTHON || 'python',[join(root,'scripts/zip-return.py'),project,join(output,'return-source.zip')],{stdio:'inherit'})
  if(zip.status!==0)throw Error('Source archive failed')
  writeFileSync(join(output,'manifest.json'),JSON.stringify({id:'return',title:'Return',engine:'TomCat',engineCommit:lock.commit,packageVersion:8,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),entries,packageUrl:'/samples/return/return.tcpak',sourceUrl:'/samples/return/return-source.zip'},null,2)+'\n')
  console.log(`Return: verified ${entries} entries, ${bytes.length} bytes`)
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main()
