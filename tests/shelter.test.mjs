import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { assetList,validatePackage,sceneDocument } from '../scripts/build-shelter.mjs';
const root=new URL('../',import.meta.url);const read=p=>readFileSync(new URL(p,root));
const hash=b=>createHash('sha256').update(b).digest('hex');
const bindingRoot='samples/shelter/Reference/SceneBindings/';
const originalMeta=source=>parse(read(bindingRoot+source+'.meta').toString());
function originalGridManager(){
 const scriptGuid=originalMeta('Assets/Scripts/GridManager.cs').guid;
 const scene=read(bindingRoot+'Assets/Scenes/SampleScene.unity').toString();
 const components=[...scene.matchAll(/^--- !u!\d+ &-?\d+(?: stripped)?\s*\n([\s\S]*?)(?=^--- !u!|$(?![\s\S]))/gm)]
  .map(match=>parse(match[1],{intAsBigInt:true}).MonoBehaviour)
  .filter(component=>component?.m_Script?.guid===scriptGuid);
 assert.equal(components.length,1,'Original SampleScene must have one GridManager');
 return components[0];
}
function pngSize(bytes){
 assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.equal(bytes.subarray(12,16).toString(),'IHDR');
 return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
}
function verifyOriginalSpriteBinding(reference,source,path,offset,size){
 const original=originalMeta(source),texture=original.TextureImporter;
 assert.equal(reference.guid,original.guid,source+' must be the sprite actually referenced by GridManager');
 assert.equal(reference.fileID,21300000n,source+' must use its whole-image sprite');
 assert.equal(texture.spriteMode,1,source+' is not a sprite sheet');
 assert.deepEqual(texture.spriteSheet.sprites,[]);
 assert.equal(texture.spritePixelsToUnits,100);
 const imported=JSON.parse(read('samples/shelter/Reference/assets.json')).filter(asset=>asset.source===source);
 assert.equal(imported.length,1,source+' must have exactly one imported asset');
 assert.equal(imported[0].path,path,source+' must retain its intended native asset mapping');
 assert.equal(imported[0].conversion,'byte-identical');
 const bytes=read('samples/shelter/'+path);
 assert.equal(hash(bytes),imported[0].sourceSha256,source+' import must retain original image bytes');
 assert.deepEqual(pngSize(bytes),size,source+' original image dimensions must be retained');
 const metadata=parse(read('samples/shelter/'+path+'.tcmeta').toString(),{intAsBigInt:true}).Asset;
 const handle=6300000000000000000n+BigInt(offset);
 assert.equal(metadata.Handle,handle,path+' runtime handle');
 assert.equal(metadata.Type,'Texture2D');
 assert.deepEqual(assetList().filter(asset=>asset.handle===handle),[{path,handle,type:'Texture2D'}]);
}
test('Shelter package includes real C# assembly and every native asset with correct hashes',()=>{
 const manifest=JSON.parse(read('public/samples/shelter/manifest.json')),bytes=read('public/samples/shelter/shelter.tcpak');
 const lock=JSON.parse(read('engine.lock.json'));
 // Preserve the deployed package's actual cooker provenance.
 assert.ok([lock.commit,...lock.legacyCommits].includes(manifest.engineCommit));assert.equal(bytes.length,manifest.byteLength);assert.equal(hash(bytes),manifest.sha256);assert.equal(validatePackage(bytes),manifest.entries);
 assert.equal(read('samples/shelter/Assets/Scene/shelter.tomcat').toString(),sceneDocument());
 const damaged=Buffer.from(bytes);damaged[damaged.length-10]^=1;assert.throws(()=>validatePackage(damaged),/hash/i);
});
test('Shelter retained assets agree with import provenance',()=>{
 for(const a of JSON.parse(read('samples/shelter/Reference/assets.json'))){assert.equal(hash(read('samples/shelter/'+a.path)),a.sha256,a.path);if(a.conversion==='byte-identical')assert.equal(a.sourceSha256,a.sha256);}
 assert.match(read('samples/shelter/LICENSE').toString(),/GNU GENERAL PUBLIC LICENSE/);
 assert.equal(new Set(assetList().map(a=>String(a.handle))).size,assetList().length);
});

test('Shelter map tiles follow original scene GUIDs through import provenance and native handles',()=>{
 // Fixtures are byte-identical copies from the supplied Unity project. Reading
 // the scene bindings, rather than guessing from PNG names, prevents the old
 // unused tree/rock illustrations from replacing the original flat map tiles.
 const grid=originalGridManager();
 assert.equal(grid.generationDepth,2n);
 assert.equal(grid.size,1.2);
 assert.equal(grid.sprites.length,3);
 const rings=[
  ['main.png','ground.png',12],
  ['Resource.png','wood.png',13],
  ['build.png','stone.png',14],
 ];
 for(const [index,[original,target,handle]] of rings.entries()){
  verifyOriginalSpriteBinding(grid.sprites[index],'Assets/Image/building/'+original,'Assets/Art/'+target,handle,[500,500]);
 }
 const manifest=JSON.parse(read('samples/shelter/Reference/assets.json'));
 const mapPaths=new Set(rings.map(([,target])=>'Assets/Art/'+target));
 assert.ok(manifest.filter(asset=>mapPaths.has(asset.path)).every(asset=>!/(木头资源|石头资源)\.png$/.test(asset.source)));
});

test('Shelter building sprites retain original scene bindings and 500 by 800 proportions',()=>{
 const grid=originalGridManager();
 assert.equal(grid.Buildsprites.length,3);
 for(const [index,[original,target,handle]] of [
  ['主城.png','castle.png',15],
  ['食物产出房.png','farm.png',16],
  ['城墙.png','wall.png',17],
 ].entries()){
  verifyOriginalSpriteBinding(grid.Buildsprites[index],'Assets/Image/building/'+original,'Assets/Art/'+target,handle,[500,800]);
 }
});
test('Shelter source download matches the complete editable project and excludes caches',()=>{
 execFileSync(process.env.PYTHON||'python',['-c',`
from pathlib import Path
from zipfile import ZipFile
root=Path('samples/shelter')
with ZipFile('public/samples/shelter/shelter-source.zip') as z:
 for p in root.rglob('*'):
  parts=p.relative_to(root).parts
  if not p.is_file() or any(n in ('Library','obj','bin','node_modules') or n.startswith('.') for n in parts):continue
  assert z.read('Shelter/'+p.relative_to(root).as_posix())==p.read_bytes(),str(p)
 assert not any('/'+c+'/' in n for n in z.namelist() for c in ('Library','bin','obj','node_modules'))
`],{cwd:root});
});
