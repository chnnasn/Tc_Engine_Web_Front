#!/usr/bin/env python3
"""Deterministically convert the user's Unity Return demo into Tc sample data.

Requires Python 3, PyYAML and Pillow. Original files are read only. Run from any
directory: python scripts/import-return.py --source E:/Gitee/Return
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import math
import re
import shutil
from pathlib import Path

import yaml
from PIL import Image, ImageChops, ImageDraw

LOADER = getattr(yaml, "CSafeLoader", yaml.SafeLoader)
SCENES = ["Main", "default", "Level1", "Level2", "Level3", "Level4", "Level5", "final"]
BASE = 6200000000000010000
SCRIPT_KINDS = {
    "138e2b1fd3a302f46affa5b6c71dd5d8": "player",
    "3f7ceaeeff7c6ca4a88d5a7bac8431cb": "box",
    "5fb6609f77346df49b16cd844d62f102": "trap",
    "b51f26fa4a67c8741b6c286c0eb6b4ed": "button",
    "7c8cae2d0c749d443affa2f2359eea6b": "door",
    "c0d41664f88b961459b72bbfdbc51535": "goal",
    "0a3bbbdd5f5c3b042b8321fedf7bd1aa": "final",
}


def unity_docs(path):
    text = path.read_text(encoding="utf-8-sig")
    parts = re.split(r"^--- !u!(\d+) &(-?\d+)(?: stripped)?\n", text, flags=re.M)
    result = {}
    for i in range(1, len(parts), 3):
        data = yaml.load(parts[i + 2], Loader=LOADER)
        kind, body = next(iter(data.items()))
        result[parts[i + 1]] = {"type": kind, **body}
    return result


def fid(ref):
    return str((ref or {}).get("fileID", 0))


def vector(value, default=0):
    return float((value or {}).get("x", default)), float((value or {}).get("y", default))


def clean(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [clean(v) for v in value]
    return value


def polygon_rectangles(paths):
    """Decompose saved orthogonal CompositeCollider outlines, preserving holes.

    Unity stores tiny extrusion epsilons around exact source pixel edges. Snap
    those to the 1/16-unit source grid before decomposition, not to whole tiles.
    """
    polygons = [[(round(p['x']*16)/16,round(p['y']*16)/16) for p in poly] for poly in paths]
    xs=sorted({x for poly in polygons for x,y in poly});ys=sorted({y for poly in polygons for x,y in poly})
    def inside(px,py):
        hit=False
        for poly in polygons:
            for i,(ax,ay) in enumerate(poly):
                bx,by=poly[(i+1)%len(poly)]
                if (ay>py)!=(by>py) and px<(bx-ax)*(py-ay)/(by-ay)+ax:hit=not hit
        return hit
    runs=[]
    for y0,y1 in zip(ys,ys[1:]):
        start=None
        for index,(x0,x1) in enumerate(zip(xs,xs[1:])):
            fill=inside((x0+x1)/2,(y0+y1)/2)
            if fill and start is None:start=x0
            if start is not None and (not fill or index==len(xs)-2):
                end=x1 if fill else x0
                runs.append([start,y0,end-start,y1-y0]);start=None
    merged=[]
    for run in runs:
        prev=next((r for r in merged if r[0]==run[0] and r[2]==run[2] and r[1]+r[3]==run[1]),None)
        if prev:prev[3]+=run[3]
        else:merged.append(run)
    return merged


class Importer:
    def __init__(self, source, output):
        self.source, self.output = source, output
        self.art = output / "Assets/Art"
        self.reference = output / "Reference"
        self.art.mkdir(parents=True, exist_ok=True)
        self.reference.mkdir(parents=True, exist_ok=True)
        (output / "Assets/Scripts").mkdir(parents=True, exist_ok=True)
        self.guids, self.metas, self.prefabs, self.images = {}, {}, {}, {}
        self.samplers = {}
        self.assets, self.sprites, self.tiles, self.image_records = [], {}, {}, {}
        self.warnings = []
        for path in sorted((source / "Assets").rglob("*.meta")):
            meta = yaml.load(path.read_text(encoding="utf-8-sig"), Loader=LOADER)
            guid = meta.get("guid")
            if guid:
                self.guids[guid] = Path(str(path)[:-5])
                self.metas[guid] = meta
                if 'TextureImporter' in meta:
                    settings = meta['TextureImporter'].get('textureSettings', {})
                    filtering = {0: 'nearest', 1: 'linear'}
                    wrapping = {0: 'repeat', 1: 'clamp'}
                    if settings.get('filterMode', 1) not in filtering or any(settings.get(axis, 1) not in wrapping for axis in ['wrapU', 'wrapV']):
                        raise ValueError(f'Unsupported source texture sampling: {path}')
                    self.samplers[Path(str(path)[:-5]).relative_to(source).as_posix()] = {
                        'filterMode': filtering[settings.get('filterMode', 1)],
                        'wrapU': wrapping[settings.get('wrapU', 1)],
                        'wrapV': wrapping[settings.get('wrapV', 1)],
                    }

    def save_image(self, image, name, source, extra=None):
        name = re.sub(r"[^a-zA-Z0-9_.-]", "-", name)
        path = self.art / (name + ".png")
        if path.name in self.image_records:
            return self.image_records[path.name]
        image.save(path, optimize=False)
        handle = BASE + len(self.assets) + 1
        # Cropped/tiled sprites retain their source sampler; whole-map reference
        # PNGs are composites of the original point-filtered industrial tiles.
        sampler = self.samplers.get(source, {'filterMode': 'nearest', 'wrapU': 'clamp', 'wrapV': 'clamp'})
        sampling_yaml = ''.join(f'    {key}: {value}\n' for key, value in sampler.items())
        Path(str(path) + ".tcmeta").write_text(
            f"SchemaVersion: 2\nAsset:\n  Handle: {handle}\n  Type: Texture2D\n  ImportSettings:\n    Usage: Sprite\n    sRGB: false\n    generateMipmaps: false\n    compression: rgba8\n{sampling_yaml}  SubAssets: []\n", encoding="utf-8")
        record = {"name": name, "path": path.relative_to(self.output).as_posix(), "handle": str(handle),
                  "width": image.width, "height": image.height, "source": source, "sampling": sampler, **(extra or {})}
        self.assets.append(record)
        self.image_records[path.name] = record
        return record

    def sprite(self, ref):
        guid, file_id = ref.get("guid"), int(ref.get("fileID", 0))
        if not guid or not file_id:
            return None
        key = (guid, file_id)
        if key in self.sprites:
            return self.sprites[key]
        path = self.guids.get(guid)
        if not path or path.suffix.lower() not in [".png", ".jpg", ".jpeg"]:
            self.warnings.append(f"Unresolved sprite {ref}")
            return None
        image = self.images.setdefault(guid, Image.open(path).convert("RGBA"))
        imp = self.metas[guid]["TextureImporter"]
        ppu = imp.get("spritePixelsToUnits", 100)
        # Unity keeps stale sheet slices after switching Multiple -> Single.
        # Single sprite references (21300000) address the complete texture.
        sprites = imp.get("spriteSheet", {}).get("sprites", []) if imp.get("spriteMode", 1) == 2 else []
        meta = next((s for s in sprites if s.get("internalID") == file_id), None)
        if meta:
            r = meta["rect"]
            x, y, w, h = (int(r[k]) for k in ["x", "y", "width", "height"])
            crop = image.crop((x, image.height-y-h, x+w, image.height-y))
            name = meta["name"]
        else:
            if sprites:
                raise ValueError(f"Missing sprite ID {file_id} in {path}")
            crop, name, meta = image.copy(), path.stem, {}
        record = self.save_image(crop, "sprite-" + name, path.relative_to(self.source).as_posix(), {"unityFileId": file_id, "pixelsPerUnit": ppu})
        result = {"asset": record, "image": crop, "ppu": ppu, "meta": meta}
        self.sprites[key] = result
        return result

    def expand(self, scene):
        docs = unity_docs(scene)
        originals = list(docs.items())
        aliases = {}
        for key, obj in originals:
            instance = fid(obj.get("m_PrefabInstance"))
            source = fid(obj.get("m_CorrespondingSourceObject"))
            if instance != "0" and source != "0":
                aliases[key] = f"{instance}:{source}"
        for instance_id, instance in originals:
            if instance["type"] != "PrefabInstance":
                continue
            guid = instance["m_SourcePrefab"]["guid"]
            if guid not in self.prefabs:
                self.prefabs[guid] = unity_docs(self.guids[guid])
            prefab = copy.deepcopy(self.prefabs[guid])
            def remap(obj):
                if isinstance(obj, dict):
                    if "fileID" in obj and not obj.get("guid") and fid(obj) in prefab:
                        obj["fileID"] = f"{instance_id}:{obj['fileID']}"
                    for value in obj.values(): remap(value)
                elif isinstance(obj, list):
                    for value in obj: remap(value)
            for obj in prefab.values(): remap(obj)
            mod = instance["m_Modification"]
            for obj in prefab.values():
                if obj["type"] in ["Transform", "RectTransform"] and fid(obj.get("m_Father")) == "0":
                    obj["m_Father"] = mod["m_TransformParent"]
            for change in mod["m_Modifications"]:
                target = prefab.get(fid(change["target"]))
                if target is None: continue
                path = change["propertyPath"].split(".")
                dest = target
                for part in path[:-1]:
                    if part not in dest: dest[part] = {}
                    dest = dest[part]
                ref = change.get("objectReference", {})
                val = change.get("value")
                if fid(ref) != "0" or ref.get("guid"):
                    value = ref
                elif isinstance(dest.get(path[-1]), dict) and "fileID" in dest[path[-1]]:
                    value = {"fileID": 0}
                else:
                    value = val
                    if isinstance(val, str):
                        try: value = float(val) if any(ch in val.lower() for ch in ['.', 'e']) else int(val)
                        except ValueError: pass
                dest[path[-1]] = value
            for key, obj in prefab.items(): docs[f"{instance_id}:{key}"] = obj
        def resolve(obj):
            if isinstance(obj, dict):
                if "fileID" in obj and not obj.get("guid") and fid(obj) in aliases:
                    obj["fileID"] = aliases[fid(obj)]
                for value in obj.values(): resolve(value)
            elif isinstance(obj, list):
                for value in obj: resolve(value)
        for key, obj in list(docs.items()):
            if key in aliases: del docs[key]
            else: resolve(obj)
        return docs

    def import_scene(self, name):
        docs = self.expand(self.source / f"Assets/Scenes/{name}.unity")
        realm_roots=set()
        for obj in docs.values():
            if obj.get('m_Script',{}).get('guid')=='be94840b86c0f7144a1cc46695eab182':
                realm_roots.update([fid(obj.get('life')),fid(obj.get('death'))])
        transforms, components = {}, {}
        for key, obj in docs.items():
            go = fid(obj.get("m_GameObject"))
            components.setdefault(go, []).append((key, obj))
            if obj["type"] in ["Transform", "RectTransform"]:
                transforms[go] = key
        state_cache = {}
        def state(tid):
            if tid in state_cache: return state_cache[tid]
            obj = docs.get(tid, {})
            x,y = vector(obj.get("m_LocalPosition")); sx,sy = vector(obj.get("m_LocalScale"),1)
            rot = obj.get("m_LocalRotation", {})
            angle = 2 * math.atan2(rot.get("z",0),rot.get("w",1))
            parent = fid(obj.get("m_Father"))
            names = []
            active = True
            if parent != "0":
                px,py,psx,psy,pa,names,active = state(parent)
                lx,ly = x*psx,y*psy
                x,y = px+lx*math.cos(pa)-ly*math.sin(pa),py+lx*math.sin(pa)+ly*math.cos(pa)
                sx,sy,angle = sx*psx,sy*psy,angle+pa
            go = docs.get(fid(obj.get("m_GameObject")), {})
            names = names + [go.get("m_Name", "")]
            active = active and (fid(obj.get('m_GameObject')) in realm_roots or bool(go.get("m_IsActive",1)))
            state_cache[tid] = (x,y,sx,sy,angle,names,active)
            return state_cache[tid]
        def realm(names):
            return 0 if "Life" in names else 1 if "Death" in names else -1
        level = {"Name":name,"SpawnX":0,"SpawnY":0,"CameraX":0,"CameraY":0,"Size":16.875,"Maps":[],"Objects":[],"Texts":[]}
        scene_detail = {"source":f"Assets/Scenes/{name}.unity", "tilemaps":[],"objects":[],"texts":[]}
        for key,obj in docs.items():
            goid = fid(obj.get("m_GameObject")); tid = transforms.get(goid,"0")
            x,y,sx,sy,angle,names,active = state(tid)
            rr = realm(names)
            if obj["type"] == "Camera":
                level.update(CameraX=x,CameraY=y,Size=float(obj.get("orthographic size",8.4375))*2)
            if obj["type"] != "Tilemap" or not obj.get("m_Tiles"): continue
            tiles = obj["m_Tiles"]
            xs,ys = [t['first']['x'] for t in tiles],[t['first']['y'] for t in tiles]
            minx,maxx,miny,maxy = min(xs),max(xs)+1,min(ys),max(ys)+1
            image=Image.new("RGBA",((maxx-minx)*16,(maxy-miny)*16))
            types = {c['type'] for _,c in components.get(goid,[])}
            collide="TilemapCollider2D" in types
            solid_cells=[]; tile_details=[]
            for tile in tiles:
                tx,ty=tile['first']['x'],tile['first']['y']; d=tile['second']
                spr_ref=obj['m_TileSpriteArray'][d['m_TileSpriteIndex']]['m_Data'] if d['m_TileSpriteIndex']<len(obj['m_TileSpriteArray']) else {}
                sprite=self.sprite(spr_ref)
                tile_ref=obj['m_TileAssetArray'][d['m_TileIndex']]['m_Data']; guid=tile_ref.get('guid')
                if guid not in self.tiles:
                    self.tiles[guid]=next(iter(unity_docs(self.guids[guid]).values())) if guid in self.guids else {}
                asset=self.tiles[guid]; ctype=asset.get('m_ColliderType',0)
                mat=obj['m_TileMatrixArray'][d['m_TileMatrixIndex']]['m_Data']
                if any(abs(mat.get(k,0)-v)>0.0001 for k,v in [('e00',1),('e01',0),('e10',0),('e11',1)]):
                    self.warnings.append(f"Nonidentity tile matrix {name} ({tx},{ty})")
                if sprite:
                    tile_image=sprite['image'].copy()
                    col=obj['m_TileColorArray'][d['m_TileColorIndex']]['m_Data']; global_col=obj.get('m_Color',{})
                    tint=tuple(round(255*col.get(c,1)*global_col.get(c,1)) for c in ['r','g','b','a'])
                    if tint!=(255,255,255,255): tile_image=ImageChops.multiply(tile_image,Image.new('RGBA',tile_image.size,tint))
                    px=(tx-minx)*16+(16-tile_image.width)//2; py=(maxy-ty-1)*16+(16-tile_image.height)//2
                    image.alpha_composite(tile_image,(px,py))
                if collide and ctype:
                    solid_cells.append((tx,ty))
                tile_details.append({'x':tx,'y':ty,'sprite':sprite['asset']['name'] if sprite else None,'colliderType':ctype})
            # Merge adjacent cells into horizontal runs, then equal runs vertically.
            runs=[]
            for ty in sorted(set(p[1] for p in solid_cells)):
                cols=sorted(p[0] for p in solid_cells if p[1]==ty)
                if not cols: continue
                start=last=cols[0]
                for tx in cols[1:]+[cols[-1]+2]:
                    if tx!=last+1:
                        runs.append([start,ty,last-start+1,1]);start=tx
                    last=tx
            merged=[]
            for run in runs:
                prev=next((r for r in merged if r[0]==run[0] and r[2]==run[2] and r[1]+r[3]==run[1]),None)
                if prev: prev[3]+=1
                else: merged.append(run)
            composite=next((c for _,c in components.get(goid,[]) if c['type']=='CompositeCollider2D'),None)
            polygons=(composite or {}).get('m_CompositePaths',{}).get('m_Paths',[])
            if composite is not None:
                merged=polygon_rectangles(polygons)
            rects=[dict(X=x+(a+w/2)*sx,Y=y+(b+h/2)*sy,W=w*abs(sx),H=h*abs(sy)) for a,b,w,h in merged]
            record=self.save_image(image,f"map-{name}-{len(level['Maps'])}",scene_detail['source'])
            order=next((c.get('m_SortingLayer',0)*100+c.get('m_SortingOrder',0) for _,c in components.get(goid,[]) if c['type']=='TilemapRenderer'),0)
            mapdata=dict(Realm=rr,Texture=int(record['handle']),X=x+(minx+maxx)/2*sx,Y=y+(miny+maxy)/2*sy,W=(maxx-minx)*abs(sx),H=(maxy-miny)*abs(sy),Order=order,Solids=rects)
            level['Maps'].append(mapdata)
            scene_detail['tilemaps'].append({'name':'/'.join(names),'active':active,'tileCount':len(tiles),'collide':collide,'tiles':tile_details,'sourceCompositePaths':polygons,**mapdata})
        for goid, go in docs.items():
            if go['type']!='GameObject' or goid not in transforms: continue
            comps=[c for _,c in components.get(goid,[])]
            tid=transforms[goid];x,y,sx,sy,angle,names,active=state(tid);rr=realm(names)
            scripts=[c for c in comps if c['type']=='MonoBehaviour']
            behavior=next((c for c in scripts if c.get('m_Script',{}).get('guid') in SCRIPT_KINDS),None)
            kind=SCRIPT_KINDS[behavior['m_Script']['guid']] if behavior else 'decor'
            if kind=='final':kind='continue' if go.get('m_Name')=='Continue' else 'exit'
            if kind=='player':level.update(SpawnX=x,SpawnY=y)
            renderer=next((c for c in comps if c['type']=='SpriteRenderer'),None)
            collider=next((c for c in comps if c['type'] in ['BoxCollider2D','CircleCollider2D']),None)
            texts=[c for c in scripts if 'm_Text' in c]
            for t in texts:
                content=t.get('m_Text') or ''
                text={'Text':content,'X':x,'Y':y,'Realm':rr,'Size':t.get('m_FontData',{}).get('m_FontSize',16),'Path':'/'.join(names)}
                scene_detail['texts'].append(text);level['Texts'].append(text)
            if renderer is None and collider is None and behavior is None: continue
            sprite=self.sprite(renderer['m_Sprite']) if renderer and renderer.get('m_Sprite') else None
            w=sprite['image'].width/sprite['ppu'] if sprite else 0
            h=sprite['image'].height/sprite['ppu'] if sprite else 0
            drawmode=renderer.get('m_DrawMode',0) if renderer else 0
            if drawmode:
                w,h=vector(renderer.get('m_Size'))
                if sprite and drawmode==2:
                    pw,ph=max(1,round(w*sprite['ppu'])),max(1,round(h*sprite['ppu']))
                    tiled=Image.new('RGBA',(pw,ph))
                    for cy in range(0,ph,sprite['image'].height):
                        for cx in range(0,pw,sprite['image'].width):tiled.alpha_composite(sprite['image'],(cx,cy))
                    asset=self.save_image(tiled,f"tiled-{sprite['asset']['name']}-{pw}x{ph}",sprite['asset']['source'])
                else: asset=sprite['asset'] if sprite else None
            else:asset=sprite['asset'] if sprite else None
            ox,oy=vector(collider.get('m_Offset')) if collider else (0,0)
            cw,ch=vector(collider.get('m_Size')) if collider else (0,0)
            if collider and collider['type']=='CircleCollider2D':cw=ch=2*float(collider.get('m_Radius',0.5))
            # Bake rotation into collider axis-aligned dimensions (all gameplay colliders are axis aligned).
            cos,sin=math.cos(angle),math.sin(angle)
            cx,cy=ox*sx*cos-oy*sy*sin,ox*sx*sin+oy*sy*cos
            bw,bh=abs(cw*sx*cos)+abs(ch*sy*sin),abs(cw*sx*sin)+abs(ch*sy*cos)
            target=fid(behavior.get('target')) if behavior else '0'
            target_obj=docs.get(target,{})
            if target_obj.get('type')!='GameObject' and target_obj.get('m_GameObject'):target=fid(target_obj['m_GameObject'])
            if kind=='decor' and collider:kind='solid' if not collider.get('m_IsTrigger') else 'decor'
            record=dict(Id=goid,Name=go.get('m_Name',''),Kind=kind,Realm=rr,X=x,Y=y,ScaleX=sx,ScaleY=sy,
                        Texture=int(asset['handle']) if asset else 0,Width=w*abs(sx),Height=h*abs(sy),Angle=math.degrees(angle),
                        OffsetX=cx,OffsetY=cy,ColliderW=bw,ColliderH=bh,Collide=bool(collider),Trigger=bool(collider and collider.get('m_IsTrigger')),
                        TargetId=target,DisableWhenOn=bool((behavior or {}).get('DisableWhenOn',True)),Order=renderer.get('m_SortingLayer',0)*100+renderer.get('m_SortingOrder',0) if renderer else 0,
                        Active=active,FlipX=bool(renderer and renderer.get('m_FlipX')),FlipY=bool(renderer and renderer.get('m_FlipY')),
                        Color=renderer.get('m_Color',{'r':1,'g':1,'b':1,'a':1}) if renderer else {'r':1,'g':1,'b':1,'a':1})
            level['Objects'].append(record);scene_detail['objects'].append({'path':'/'.join(names),**record})
        self.reference.joinpath(f'{name}.json').write_text(json.dumps(clean(scene_detail),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        return clean(level)

    def run(self):
        levels=[self.import_scene(name) for name in SCENES]
        anims={}
        for name in ['idle','run','fall']:
            clip=next(iter(unity_docs(self.source/f'Assets/Animation/player/{name}.anim').values()))
            anims[name.title()]=[int(self.sprite(k['value'])['asset']['handle']) for k in clip['m_PPtrCurves'][0]['curve']]
        anims['Dead']=int(self.sprite({'guid':'094c61c07e7bba8439fd21e7669c5e8d','fileID':-1677774871})['asset']['handle'])
        for name in ['on','off']:
            clip=next(iter(unity_docs(self.source/f'Assets/Animation/{name}.anim').values()))
            for curve in clip['m_PPtrCurves']:
                key=('Bulb' if curve['path']=='Bulb' else 'Button')+name.title()
                anims[key]=[int(self.sprite(k['value'])['asset']['handle']) for k in curve['curve']]
        for name in ['Title','Start','Quat']:
            path=self.source/f'Assets/Scenes/{name}.png'
            guid=yaml.load(Path(str(path)+'.meta').read_text(),Loader=LOADER)['guid']
            sheets=self.metas[guid]['TextureImporter'].get('spriteSheet',{}).get('sprites',[])
            file_id=sheets[0]['internalID'] if sheets else 21300000
            anims['Quit' if name=='Quat' else name]=int(self.sprite({'guid':guid,'fileID':file_id})['asset']['handle'])
        path=self.source/'Assets/Spritesheet/thx.png';guid=yaml.load(Path(str(path)+'.meta').read_text(),Loader=LOADER)['guid']
        anims['Thanks']=int(self.sprite({'guid':guid,'fileID':21300000})['asset']['handle'])
        # Append UI assets after gameplay registration to preserve native tile
        # cells' existing asset identities.
        spec = importlib.util.spec_from_file_location('return_ui', Path(__file__).with_name('import-return-ui.py'))
        menu_importer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(menu_importer)
        menu_importer.export_menu(self)
        self.write_csharp(levels,anims)
        known_handles={int(a['handle']) for a in self.assets}
        for level in levels:
            ids={o['Id'] for o in level['Objects']}
            for obj in level['Objects']:
                assert obj['Texture']==0 or obj['Texture'] in known_handles
                if obj['Kind']=='button':assert obj['TargetId'] in ids,(level['Name'],obj['Id'],obj['TargetId'])
            for tilemap in level['Maps']:
                assert tilemap['Texture'] in known_handles
                assert all(r['W']>0 and r['H']>0 for r in tilemap['Solids'])
        self.reference.joinpath('levels.json').write_text(json.dumps(levels,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        self.reference.joinpath('assets.json').write_text(json.dumps({'assets':self.assets,'animations':{k:([str(h) for h in v] if isinstance(v,list) else str(v)) for k,v in anims.items()}},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        self.preview(levels)
        shutil.copyfile(self.source/'LICENSE',self.reference/'ORIGINAL-LICENSE.txt')
        hashes={p.relative_to(self.source).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((self.source/'Assets/Scenes').glob('*.unity'))}
        self.reference.joinpath('import-report.json').write_text(json.dumps({'source':str(self.source),'sceneOrder':SCENES,'sourceSha256':hashes,'warnings':sorted(set(self.warnings)),'assetCount':len(self.assets),'tileCollisionPolicy':'Saved Unity CompositeCollider2D outlines decomposed into rectangles with even-odd holes; numerical extrusion epsilon is snapped to the source 1/16-unit pixel grid. Raw outlines are retained in per-scene JSON. TilemapCollider2D + tile collider type grid fallback applies only without CompositeCollider2D.','sceneStats':[{'name':l['Name'],'maps':len(l['Maps']),'objects':len(l['Objects']),'solids':sum(len(m['Solids']) for m in l['Maps'])} for l in levels]},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(json.dumps({'scenes':len(levels),'assets':len(self.assets),'warnings':sorted(set(self.warnings))},ensure_ascii=False))

    def preview(self,levels):
        """Source-data contact sheet for visual comparison; not a runtime asset."""
        scale=16
        asset_paths={int(a['handle']):self.output/a['path'] for a in self.assets}
        sheets=Image.new('RGB',(7*288,2*312),(17,20,29))
        labels=ImageDraw.Draw(sheets)
        for li,level in enumerate(levels[1:]):
            for realm in [0,1]:
                view=Image.new('RGBA',(288,288),(29,33,45,255))
                draws=[]
                for tilemap in level['Maps']:
                    if tilemap['Realm'] in [-1,realm]:draws.append((tilemap['Order'],tilemap['Texture'],tilemap['X'],tilemap['Y'],tilemap['W'],tilemap['H'],{}))
                for obj in level['Objects']:
                    if obj['Texture'] and obj['Active'] and obj['Realm'] in [-1,realm] and (obj['Kind']!='door' or obj['DisableWhenOn']):
                        draws.append((obj['Order'],obj['Texture'],obj['X'],obj['Y'],obj['Width'],obj['Height'],obj))
                for _,texture,x,y,w,h,info in sorted(draws,key=lambda d:d[0]):
                    sprite=Image.open(asset_paths[texture]).convert('RGBA').resize((max(1,round(w*scale)),max(1,round(h*scale))),Image.Resampling.NEAREST)
                    if info.get('FlipX'):sprite=sprite.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                    if info.get('FlipY'):sprite=sprite.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
                    color=info.get('Color',{'r':1,'g':1,'b':1,'a':1})
                    tint=tuple(round(color.get(c,1)*255) for c in ['r','g','b','a'])
                    if tint!=(255,255,255,255):sprite=ImageChops.multiply(sprite,Image.new('RGBA',sprite.size,tint))
                    if info.get('Angle'):sprite=sprite.rotate(info['Angle'],resample=Image.Resampling.NEAREST,expand=True)
                    view.alpha_composite(sprite,(round(144+x*scale-sprite.width/2),round(144-y*scale-sprite.height/2)))
                sheets.paste(view,(li*288,realm*312+24))
                labels.text((li*288+8,realm*312+6),level['Name']+(' - LIFE' if realm==0 else ' - DEATH'),fill=(220,225,235))
        sheets.save(self.reference/'source-layouts.png')

    def write_csharp(self,levels,anims):
        def cs(v):
            if isinstance(v,bool):return 'true' if v else 'false'
            if isinstance(v,str):return json.dumps(v,ensure_ascii=False)
            if isinstance(v,(int,float)):
                if isinstance(v,int) and v>=BASE:return f'{v}UL'
                return format(v,'.9g')+'f'
            raise ValueError(v)
        out=['// Generated by scripts/import-return.py from the original Unity scene data. Do not edit.','namespace TomCatGame;','',
             '// All positions are original Unity coordinates: +Y up. X/Y are rectangle centers.',
             'public readonly record struct ReturnRect(float X, float Y, float W, float H);',
             'public sealed class ReturnMap { public int Realm, Order; public ulong Texture; public float X,Y,W,H; public ReturnRect[] Solids = []; }',
             'public sealed class ReturnObject { public string Id="", Name="", Kind="", TargetId=""; public int Realm,Order; public ulong Texture; public float X,Y,ScaleX,ScaleY,Width,Height,Angle,OffsetX,OffsetY,ColliderW,ColliderH,R=1,G=1,B=1,A=1; public bool Collide,Trigger,DisableWhenOn,Active,FlipX,FlipY; }',
             'public sealed class ReturnText { public string Text="", Path=""; public float X,Y,Size; public int Realm; }',
             'public sealed class ReturnLevel { public string Name=""; public float SpawnX,SpawnY,CameraX,CameraY,Size; public ReturnMap[] Maps=[]; public ReturnObject[] Objects=[]; public ReturnText[] Texts=[]; }',
             'public static class ReturnArt {']
        for key,value in anims.items():out.append('    public static readonly ulong[] '+key+' = ['+', '.join(str(v)+'UL' for v in value)+'];' if isinstance(value,list) else '    public const ulong '+key+' = '+str(value)+'UL;')
        out+=['}','public static class ReturnLevels {','    public static readonly ReturnLevel[] All = [']
        def fields(obj):
            return ','.join(k+'='+ (str(v) if k in ['Realm','Order'] else '0UL' if k=='Texture' and v==0 else cs(v)) for k,v in obj.items())
        for l in levels:
            out.append('        new() { '+fields({k:v for k,v in l.items() if k not in ['Maps','Objects','Texts']})+',')
            out.append('            Maps = [')
            for m in l['Maps']:
                rects=','.join('new('+','.join(cs(r[k]) for k in ['X','Y','W','H'])+')' for r in m['Solids'])
                out.append('                new() { '+fields({k:v for k,v in m.items() if k!='Solids'})+',Solids=['+rects+'] },')
            out+=['            ],','            Objects = [']
            for o in l['Objects']:
                data={k:v for k,v in o.items() if k!='Color'}
                data.update({k.upper():v for k,v in o['Color'].items()})
                out.append('                new() { '+fields(data)+' },')
            out+=['            ],','            Texts = [']
            for t in l['Texts']:out.append('                new() { '+fields(t)+' },')
            out+=['            ],','        },']
        out+=['    ];','}']
        self.output.joinpath('Assets/Scripts/ReturnLevels.cs').write_text('\n'.join(out)+'\n',encoding='utf-8')
        self.output.joinpath('Assets/Scripts/ReturnLevels.cs.tcmeta').write_text('SchemaVersion: 2\nAsset:\n  Handle: 6200000000000000004\n  Type: CSharpScript\n  ImportSettings: {}\n  SubAssets: []\n',encoding='utf-8')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,default=Path('E:/Gitee/Return'))
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'samples/return')
    args=parser.parse_args()
    Importer(args.source,args.output).run()

