import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { parse } from 'yaml'
import { assetList, validatePackage } from '../scripts/build-return.mjs'
import { games } from '../src/ui/data.ts'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url))
test('Return homepage entry ships a verified Tc package and editable project', () => {
  const game=games.find(g=>g.id==='return')
  assert.equal(games[0],game)
  assert.equal(game.packageUrl,'/samples/return/return.tcpak')
  assert.equal(game.sourceUrl,'/samples/return/return-source.zip')
  const bytes=read(`public${game.packageUrl}`),manifest=JSON.parse(read('public/samples/return/manifest.json'))
  assert.equal(validatePackage(bytes),manifest.entries)
  assert.equal(bytes.length,manifest.byteLength)
  assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.sha256)
  assert.equal(manifest.engineCommit,JSON.parse(read('engine.lock.json')).commit)
  const damaged=Buffer.from(bytes);damaged[damaged.length-1]^=1
  assert.throws(()=>validatePackage(damaged),/hash mismatch/)
  const assets=assetList(),ids=new Set(assets.map(a=>a.handle.toString()))
  assert.equal(ids.size,assets.length,'asset identities must be unique')
  assert.ok(assets.some(a=>a.path.endsWith('Crystaloid.wav')))
  assert.ok(assets.some(a=>a.path.endsWith('Tutorial.wav')))
})

test('Return source archive is reproducible, complete and matches current gameplay', () => {
  execFileSync(process.env.PYTHON||'python',['-c',`
from pathlib import Path
import zipfile
root=Path('samples/return')
with zipfile.ZipFile('public/samples/return/return-source.zip') as z:
    assert z.testzip() is None
    for name in ['Project.tcproj','LICENSE','package.json','Tools/sync-maps.mjs','Tools/return-tilemap.mjs']:
        assert 'Return/'+name in z.namelist(), name+' missing'
    for file in root.rglob('*'):
        parts=file.relative_to(root).parts
        if not file.is_file() or any(p in ('Library','bin','obj','node_modules') or p.startswith('.') for p in parts): continue
        name=file.relative_to(root).as_posix()
        assert z.read('Return/'+name)==file.read_bytes(), name+' stale/missing'
    assert not any('/'+cache+'/' in name for name in z.namelist() for cache in ['Library','obj','bin','node_modules'])
`],{cwd:new URL('../',import.meta.url),stdio:'pipe'})
})

test('all original stages and native tile cells survive the editable source import', () => {
  const levels=JSON.parse(read('samples/return/Reference/levels.json'))
  assert.deepEqual(levels.map(l=>l.Name),['Main','default','Level1','Level2','Level3','Level4','Level5','final'])
  for(const level of levels.slice(1)) {
    const ids=new Set(level.Objects.map(o=>o.Id))
    for(const item of level.Objects.filter(o=>o.Kind==='button'))assert.ok(ids.has(item.TargetId),`${level.Name}: unresolved button`)
    assert.ok(level.Maps.length>0)
    assert.ok(level.Objects.some(o=>o.Kind==='player'))
  }
  const scene=parse(read('samples/return/Assets/Scene/return.tomcat').toString(),{intAsBigInt:true})
  const maps=scene.Entities.filter(e=>e.Components.some(c=>c.StableName==='TomCat.Tilemap2D'))
  assert.equal(maps.length,levels.reduce((n,l)=>n+l.Maps.length,0),'the playable scene must use native editable tilemaps')
  for(const map of maps) {
    const cells=map.Components.find(c=>c.StableName==='TomCat.Tilemap2D').Properties.Cells
    assert.ok(cells.length>0)
    assert.equal(new Set(cells.map(c=>c.Coordinate.join(','))).size,cells.length,'one native cell per coordinate')
  }
})
