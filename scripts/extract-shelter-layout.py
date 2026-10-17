"""Read Unity scene/prefab YAML and resolve the original Shelter UI artwork.

The source project is never changed. Requires PyYAML (pip install pyyaml).
Run: python scripts/extract-shelter-layout.py [source-project] [report.json]
"""
from pathlib import Path
import json
import re
import struct
import sys
import yaml

SOURCE = Path(sys.argv[1] if len(sys.argv) > 1 else "E:/Github/Shelter")
OUTPUT = Path(sys.argv[2] if len(sys.argv) > 2 else ".engine/shelter-original-layout.json")
GUIDS = {}
for meta in (SOURCE / "Assets").rglob("*.meta"):
    match = re.search(r"^guid: (\w+)$", meta.read_text(encoding="utf-8-sig"), re.M)
    if match:
        GUIDS[match[1]] = Path(str(meta)[:-5])
ASSETS = {}


def read_objects(path):
    text = path.read_text(encoding="utf-8-sig")
    objects = {}
    for match in re.finditer(r"^--- !u!(\d+) &(-?\d+)(?: stripped)?\s*\n(.*?)(?=^--- !u!|\Z)", text, re.M | re.S):
        data = yaml.safe_load(match[3])
        kind, fields = next(iter(data.items()))
        objects[int(match[2])] = {"kind": kind, "classId": int(match[1]), "fields": fields}
    return objects


def asset_ref(value):
    guid = value.get("guid")
    path = GUIDS.get(guid)
    result = dict(value)
    if not path:
        return result
    relative = path.relative_to(SOURCE).as_posix()
    result["path"] = relative
    if guid not in ASSETS:
        meta = yaml.safe_load(Path(str(path) + ".meta").read_text(encoding="utf-8-sig"))
        details = {"path": relative, "guid": guid}
        texture = meta.get("TextureImporter")
        if texture:
            width = height = None
            if path.suffix.lower() == ".png":
                with path.open("rb") as stream:
                    header = stream.read(24)
                width, height = struct.unpack(">II", header[16:24])
            details.update({
                "width": width, "height": height,
                "spriteMode": texture.get("spriteMode"),
                "spritePixelsToUnits": texture.get("spritePixelsToUnits"),
                "spritePivot": texture.get("spritePivot"),
                "spriteBorder": texture.get("spriteBorder"),
                "sprites": texture.get("spriteSheet", {}).get("sprites", []),
                "wholeImageRect": {"x": 0, "y": 0, "width": width, "height": height},
            })
        ASSETS[guid] = details
    details = ASSETS[guid]
    if "spriteMode" in details:
        if details["spriteMode"] == 1:
            result["spriteRect"] = details["wholeImageRect"]
            result["spriteName"] = path.stem
        else:
            for sprite in details["sprites"]:
                if sprite.get("internalID") == value.get("fileID"):
                    result["spriteRect"] = sprite.get("rect")
                    result["spriteName"] = sprite.get("name")
    return result


def extract_scene(path):
    objects = read_objects(path)
    nodes = {}
    transforms = {}
    for file_id, obj in objects.items():
        fields = obj["fields"]
        if obj["kind"] == "GameObject":
            nodes[file_id] = {
                "fileId": file_id, "name": fields.get("m_Name"),
                "active": bool(fields.get("m_IsActive", 1)),
                "layer": fields.get("m_Layer"), "components": [], "children": []}
        if obj["kind"] in ("Transform", "RectTransform"):
            transforms[file_id] = fields.get("m_GameObject", {}).get("fileID")
    for file_id, obj in objects.items():
        fields = obj["fields"]
        go_id = fields.get("m_GameObject", {}).get("fileID")
        node = nodes.get(go_id)
        if node is None:
            continue
        if obj["kind"] in ("Transform", "RectTransform"):
            node["transformFileId"] = file_id
            node["transformType"] = obj["kind"]
            node["transform"] = {key: fields.get(key) for key in (
                "m_LocalPosition", "m_LocalRotation", "m_LocalScale", "m_AnchorMin", "m_AnchorMax",
                "m_AnchoredPosition", "m_SizeDelta", "m_Pivot", "m_LocalEulerAnglesHint", "m_RootOrder") if key in fields}
            node["parentFileId"] = transforms.get(fields.get("m_Father", {}).get("fileID"))
            node["childFileIds"] = [transforms.get(child.get("fileID")) for child in fields.get("m_Children", [])]
        else:
            node["components"].append({"fileId": file_id, "kind": obj["kind"], "properties": fields})
    roots = []
    for node in nodes.values():
        parent = nodes.get(node.get("parentFileId"))
        if parent:
            parent["children"].append(node)
        else:
            roots.append(node)
    def qualify(node, prefix="", parent_active=True):
        node["path"] = prefix + "/" + str(node["name"])
        node["activeInHierarchy"] = parent_active and node["active"]
        node["children"].sort(key=lambda item: item.get("transform", {}).get("m_RootOrder", 0))
        for child in node["children"]:
            qualify(child, node["path"], node["activeInHierarchy"])
    for node in roots:
        qualify(node)
    def layout(node, parent=None):
        transform = node.get("transform", {})
        canvas = any(c["kind"] == "Canvas" and c["properties"].get("m_RenderMode") in (0, 1) for c in node["components"])
        if canvas:
            scaler = next((c["properties"] for c in node["components"] if "m_UiScaleMode" in c["properties"]), {})
            factor = scaler.get("m_ScaleFactor", 1)
            node["designLayout1920x1080"] = {"localSize": [1920 / factor, 1080 / factor], "pixelPivot": [0, 0], "pixelScale": [factor, factor], "pixelBoundsTopLeft": [0, 0, 1920, 1080]}
        elif parent and node.get("transformType") == "RectTransform" and "designLayout1920x1080" in parent:
            p = parent["designLayout1920x1080"]
            parent_pivot = parent.get("transform", {}).get("m_Pivot", {"x": 0, "y": 0})
            pivot = transform["m_Pivot"]
            amin, amax = transform["m_AnchorMin"], transform["m_AnchorMax"]
            size, point, scale = [], [], []
            for axis, key in enumerate(("x", "y")):
                size.append(p["localSize"][axis] * (amax[key] - amin[key]) + transform["m_SizeDelta"][key])
                anchor = amin[key] + (amax[key] - amin[key]) * pivot[key]
                point.append(p["pixelPivot"][axis] + ((anchor - parent_pivot[key]) * p["localSize"][axis] + transform["m_AnchoredPosition"][key]) * p["pixelScale"][axis])
                scale.append(p["pixelScale"][axis] * transform["m_LocalScale"][key])
            bounds = [point[0] - pivot["x"] * size[0] * scale[0], 1080 - point[1] - (1-pivot["y"]) * size[1] * scale[1], size[0] * scale[0], size[1] * scale[1]]
            node["designLayout1920x1080"] = {"localSize": size, "pixelPivot": point, "pixelScale": scale, "pixelBoundsTopLeft": bounds}
        for child in node["children"]:
            layout(child, node)
    for node in roots:
        layout(node)
    def resolve(value):
        if isinstance(value, list):
            return [resolve(item) for item in value]
        if isinstance(value, dict):
            if "fileID" in value:
                if "guid" in value:
                    return asset_ref(value)
                obj_id = value["fileID"]
                target_id = obj_id if obj_id in nodes else objects.get(obj_id, {}).get("fields", {}).get("m_GameObject", {}).get("fileID")
                target = nodes.get(target_id)
                return {**value, **({"scenePath": target["path"]} if target else {})}
            return {key: resolve(item) for key, item in value.items()}
        return value
    exclusions = {"m_ObjectHideFlags", "m_CorrespondingSourceObject", "m_PrefabInstance", "m_PrefabAsset", "m_GameObject", "m_EditorHideFlags", "m_Name", "m_EditorClassIdentifier"}
    flat = []
    for node in nodes.values():
        for component in node["components"]:
            raw = component["properties"]
            properties = {key: value for key, value in raw.items() if key not in exclusions}
            component["properties"] = resolve(properties)
            script = component["properties"].get("m_Script", {}).get("path", "")
            if script:
                component["script"] = script
            if "m_Sprite" in raw:
                component["sprite"] = resolve(raw["m_Sprite"])
                component["color"] = raw.get("m_Color")
                component["raycastTarget"] = raw.get("m_RaycastTarget")
            if "m_Text" in raw:
                component["text"] = raw["m_Text"]
                component["font"] = resolve(raw.get("m_FontData", {}))
                component["color"] = raw.get("m_Color")
            if "m_text" in raw:
                component["text"] = raw["m_text"]
                component["fontSize"] = raw.get("m_fontSize")
                component["font"] = resolve(raw.get("m_fontAsset"))
                component["color"] = raw.get("m_fontColor")
        flat.append({key: value for key, value in node.items() if key != "children"})
    return {"source": path.relative_to(SOURCE).as_posix(), "tree": roots, "flatNodes": flat}


scenes = [extract_scene(SOURCE / "Assets/Scenes" / name) for name in ("Start.unity", "SampleScene.unity")]
prefabs = [extract_scene(path) for path in sorted((SOURCE / "Assets/Tiles").glob("*.prefab"))]
# Include the easily confused unused art even when no scene references it.
for guid, path in GUIDS.items():
    if path.parent == SOURCE / "Assets/Image/building":
        asset_ref({"guid": guid, "fileID": 21300000})

report = {"sourceProject": str(SOURCE.resolve()), "readOnlySource": True,
          "coordinateNotes": "Unity RectTransform: bottom-left coordinates, y up; m_AnchoredPosition is relative to anchors. Runtime CanvasScaler overwrites root transform. Text and images below are serialized original bindings, not inferred visuals.",
          "designLayoutNotes": "designLayout1920x1080 is an analytical projection for the original desktop default 1920x1080 with ConstantPixelSize CanvasScaler factor 5, without executing Unity. It ignores no rotations in the two supplied scene UI trees because they are all identity. World-space prefab canvases are excluded. Static bounds may be moved by scripts at runtime (notably BuildUi/outLIne).",
          "scenes": scenes, "prefabs": prefabs, "assets": list(ASSETS.values())}
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Wrote {OUTPUT}: {sum(len(scene['flatNodes']) for scene in scenes)} scene nodes; {len(ASSETS)} resolved assets")
