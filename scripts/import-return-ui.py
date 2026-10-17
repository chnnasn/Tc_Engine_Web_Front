"""Import the original Main Canvas hierarchy without reauthoring its layout.

Called by import-return.py after existing art/animation registration so earlier
asset handles remain stable. The source Unity project is read only.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import shutil
from pathlib import Path

import yaml
from PIL import Image

LOADER = getattr(yaml, "CSafeLoader", yaml.SafeLoader)
FONT_HANDLE = 6200000000000000020
DATA_HANDLE = 6200000000000000006
IMAGE = "fe87c0e1cc204ed48ad3b37840f39efc"
TEXT = "5f7201a12d95ffc409449d95f23cf332"
BUTTON = "4e29b1a8efbd4b44bb3f3716e73f07ff"
SCALER = "0cd44c1031e13a943bb63640046fad76"
BUILTIN_REFERENCE = Path(__file__).with_name("return-ui-reference")
BUILTIN_IMAGE_SHA256 = "975b976cd1c9cd879ad150ad49b164375d8e9b99223f025e33e54e9c7f0f3bea"


def add_pause_slices(importer, parent_node, parent_index, image, scaler):
    """Convert the exact builtin identified by the source reference into nine images."""
    source = "Reference/UnityBuiltins/Background.png"
    source_image = BUILTIN_REFERENCE / "Background.png"
    source_meta = BUILTIN_REFERENCE / "Background.json"
    if hashlib.sha256(source_image.read_bytes()).hexdigest() != BUILTIN_IMAGE_SHA256:
        raise ValueError("Exported Unity Background differs from the audited source.")
    meta = json.loads(source_meta.read_text(encoding="utf-8-sig"))
    reference = image["m_Sprite"]
    if (meta["guid"] != reference["guid"] or str(meta["fileID"]) != file_id(reference)
            or meta["resource"] != "UI/Skin/Background.psd"):
        raise ValueError("Exported Unity builtin identity does not match the original Image sprite reference.")
    if meta["filterMode"] != "Bilinear" or any(meta[k] != "Clamp" for k in ("wrapModeU", "wrapModeV")):
        raise ValueError("Unexpected exported Unity Background sampler.")
    original = Image.open(source_image).convert("RGBA")
    if original.size != (32, 32) or any(meta["rect"][key] != value for key, value in (("x", 0), ("y", 0), ("width", 32), ("height", 32))):
        raise ValueError("Unexpected exported Unity Background dimensions.")
    border = meta["border"]
    left, bottom, right, top = (border[key] for key in ("x", "y", "z", "w"))
    if any(v <= 0 or v != int(v) for v in (left, bottom, right, top)):
        raise ValueError("Unity Background needs positive integer source borders.")
    pixels_per_unit = meta["pixelsPerUnit"] / scaler["m_ReferencePixelsPerUnit"] * image["m_PixelsPerUnitMultiplier"]
    if pixels_per_unit <= 0:
        raise ValueError("Invalid original pause panel pixels per unit.")
    x_cuts = (0, int(left), original.width-int(right), original.width)
    y_cuts = (0, int(bottom), original.height-int(top), original.height)
    bx, by = (left/pixels_per_unit, right/pixels_per_unit), (bottom/pixels_per_unit, top/pixels_per_unit)
    if x_cuts[1] >= x_cuts[2] or y_cuts[1] >= y_cuts[2]:
        raise ValueError("Unity Background has no center region.")
    importer.samplers[source] = {"filterMode": "linear", "wrapU": "clamp", "wrapV": "clamp"}
    nodes, evidence = [], []
    for row in range(3):
        for column in range(3):
            x0, x1 = x_cuts[column:column+2]
            y0, y1 = y_cuts[row:row+2]
            crop_rect = (x0, original.height-y1, x1, original.height-y0)
            cropped = original.crop(crop_rect)
            record = importer.save_image(cropped, f"ui-pause-panel-{row}-{column}", source,
                {"unityBuiltinResource": meta["resource"], "unityFileId": meta["fileID"],
                 "unityGuid": meta["guid"],
                 "pixelsPerUnit": meta["pixelsPerUnit"], "cropTopLeftPixels": [crop_rect[0], crop_rect[1], cropped.width, cropped.height]})
            def axis(cell, borders):
                if cell == 0: return 0, 0, 0, 0, borders[0]
                if cell == 2: return 1, 1, 1, 0, borders[1]
                # Asymmetric borders shift the stretch region's center.
                return 0, 1, .5, (borders[0]-borders[1])/2, -sum(borders)
            min_x, max_x, pivot_x, offset_x, width = axis(column, bx)
            min_y, max_y, pivot_y, offset_y, height = axis(row, by)
            node = {**parent_node,
                "Id": f"{parent_node['Id']}:slice:{row}:{column}", "Name": f"Background Slice {row},{column}",
                "Parent": parent_index, "Active": True,
                "X": offset_x, "Y": offset_y, "W": width, "H": height,
                "AnchorMinX": min_x, "AnchorMaxX": max_x, "AnchorMinY": min_y, "AnchorMaxY": max_y,
                "PivotX": pivot_x, "PivotY": pivot_y,
                "ScaleX": 1, "ScaleY": 1, "ScaleZ": 1, "Rotation": 0,
                "Texture": int(record["handle"]), "Image": True,
                "PreserveAspect": False, "Text": None, "Button": None, "ButtonAnimation": False}
            nodes.append(node)
            evidence.append({"id": node["Id"], "cropBottomLeftPixels": [x0, y0, x1-x0, y1-y0],
                             "texture": str(record["handle"]), "path": record["path"]})
    return nodes, {"method": "Nine native UIImage children using original pixel crops, borders and PPU; no flat-color substitute.",
        "source": source, "sourceSha256": BUILTIN_IMAGE_SHA256,
        "metadata": "Reference/UnityBuiltins/Background.json", "metadataSha256": hashlib.sha256(source_meta.read_bytes()).hexdigest(),
        "export": meta, "origin": "AssetDatabase.GetBuiltinExtraResource<Sprite>, verified GUID/fileID, and AsyncGPUReadback RGBA32 in an isolated Unity 6000.2.14f1 project; the original Return project was not edited.",
        "effectivePixelsPerUnit": pixels_per_unit, "layoutBorders": [bx[0], by[0], bx[1], by[1]], "slices": evidence}


def unity_docs(path):
    text = path.read_text(encoding="utf-8-sig")
    parts = re.split(r"^--- !u!(\d+) &(-?\d+)(?: stripped)?\n", text, flags=re.M)
    docs = {}
    for index in range(1, len(parts), 3):
        kind, body = next(iter(yaml.load(parts[index + 2], Loader=LOADER).items()))
        docs[parts[index + 1]] = {"type": kind, **body}
    return docs


def file_id(ref):
    return str((ref or {}).get("fileID", 0))


def json_ids(value, key=None):
    # Unity local IDs exceed JavaScript's exact integer range.
    if key in ("fileID", "internalID"):
        return str(value)
    if isinstance(value, dict):
        return {key: json_ids(item, key) for key, item in value.items()}
    if isinstance(value, list):
        return [json_ids(item) for item in value]
    return value


def projected_trs(transform):
    """Represent the source UI plane's quaternion as exact 2D TRS.

    Active Main UI uses identity rotations. Some disabled legacy letter nodes
    use X/Y half-turn flips; preserve those as signed planar scale as well.
    """
    scale = transform["m_LocalScale"]
    q = transform["m_LocalRotation"]
    x, y, z, w = (q[key] for key in ("x", "y", "z", "w"))
    length = math.sqrt(x*x + y*y + z*z + w*w)
    x, y, z, w = (v/length for v in (x, y, z, w))
    a, b = 1-2*(y*y+z*z), 2*(x*y+z*w)
    c, d = 2*(x*y-z*w), 1-2*(x*x+z*z)
    if abs(b) < 1e-6 and abs(c) < 1e-6:
        return scale["x"]*a, scale["y"]*d, scale["z"], 0.0
    angle = math.atan2(b, a)
    return scale["x"], scale["y"]*(a*d-b*c), scale["z"], angle


def build_canvas(importer, scene_name="Main", canvas_name="Canvas"):
    scene = importer.source / f"Assets/Scenes/{scene_name}.unity"
    docs = unity_docs(scene)
    game_objects = {key: value for key, value in docs.items() if value["type"] == "GameObject"}
    transforms = {key: value for key, value in docs.items()
                  if value["type"] in ("Transform", "RectTransform") and "m_GameObject" in value}
    by_game_object = {file_id(value["m_GameObject"]): key for key, value in transforms.items()}

    def components(game_object_id):
        return [docs[file_id(item["component"])] for item in game_objects[game_object_id]["m_Component"]]

    canvases = [value for value in docs.values() if value["type"] == "Canvas"
                and game_objects[file_id(value["m_GameObject"])]["m_Name"] == canvas_name
                and file_id(transforms[by_game_object[file_id(value["m_GameObject"])]]['m_Father']) == "0"]
    if len(canvases) != 1:
        raise ValueError(f"{scene_name} must contain exactly one top-level {canvas_name} Canvas.")
    canvas = canvases[0]
    canvas_id = file_id(canvas["m_GameObject"])
    canvas_transform = by_game_object[canvas_id]
    scaler = next(c for c in components(canvas_id) if c.get("m_Script", {}).get("guid") == SCALER)
    if canvas["m_RenderMode"] != 0 or scaler["m_UiScaleMode"] != 0:
        raise ValueError("Canvas import expects source Overlay / ConstantPixelSize.")

    nodes, reference_nodes, generated_graphics = [], [], []

    def visit(transform_id, parent, parent_active=True, parent_path=canvas_name):
        transform = transforms[transform_id]
        game_object_id = file_id(transform["m_GameObject"])
        go = game_objects[game_object_id]
        parts = components(game_object_id)
        image = next((c for c in parts if c.get("m_Script", {}).get("guid") == IMAGE), None)
        text = next((c for c in parts if c.get("m_Script", {}).get("guid") == TEXT), None)
        button = next((c for c in parts if c.get("m_Script", {}).get("guid") == BUTTON), None)
        graphic = image or text
        source_font = text.get("m_FontData") if text else None
        if source_font and source_font["m_Font"]["guid"] != "9f8cd9a7b5bf63c4aa4ca9adf29047be":
            raise ValueError("A different source menu font needs an explicit asset import.")
        sprite_ref = image["m_Sprite"] if image else {}
        # Unity's built-in sliced pause panel is exported separately, retaining
        # its actual texture and source border/PPU instead of a color substitute.
        builtin_panel = (scene_name == "Main" and canvas_name == "Menu"
                         and game_object_id == "1180627484"
                         and sprite_ref.get("guid") == "0000000000000000f000000000000000"
                         and file_id(sprite_ref) == "10907")
        sprite = importer.sprite(sprite_ref) if image and not builtin_panel else None
        if image and sprite_ref.get("fileID") and sprite is None and not builtin_panel:
            raise ValueError(f"Unresolved original UI sprite on {game_object_id}")
        color = (graphic or {}).get("m_Color", {"r": 1, "g": 1, "b": 1, "a": 1})
        anchor_min, anchor_max = transform["m_AnchorMin"], transform["m_AnchorMax"]
        position, size, pivot = (transform[key] for key in ("m_AnchoredPosition", "m_SizeDelta", "m_Pivot"))
        sx, sy, sz, rotation = projected_trs(transform)
        action = None
        if button:
            calls = button["m_OnClick"]["m_PersistentCalls"]["m_Calls"]
            method = calls[0]["m_MethodName"] if calls else None
            action = {"StartGame": "start", "Quat": "quit", "Continue": "resume", "Return": "restart", "quat": "quit"}.get(method)
            if method and action is None:
                raise ValueError(f"Unsupported original UI button method: {method}")
        node = {
            "Id": game_object_id, "Name": str(go["m_Name"]), "Parent": parent,
            "Active": bool(go["m_IsActive"]),
            "X": position["x"], "Y": position["y"], "W": size["x"], "H": size["y"],
            "AnchorMinX": anchor_min["x"], "AnchorMinY": anchor_min["y"],
            "AnchorMaxX": anchor_max["x"], "AnchorMaxY": anchor_max["y"],
            "PivotX": pivot["x"], "PivotY": pivot["y"],
            "ScaleX": sx, "ScaleY": sy, "ScaleZ": sz, "Rotation": rotation,
            "Texture": int(sprite["asset"]["handle"]) if sprite else 0,
            "Image": bool(image and image.get("m_Enabled", 1) and not builtin_panel),
            "Text": text["m_Text"] if text and text.get("m_Enabled", 1) else None,
            "R": color["r"], "G": color["g"], "B": color["b"], "A": color["a"],
            "Font": FONT_HANDLE, "FontSize": source_font["m_FontSize"] if source_font else 0,
            "Alignment": source_font["m_Alignment"] % 3 if source_font else 1,
            "VerticalAlignment": source_font["m_Alignment"] // 3 if source_font else 1,
            "LineSpacing": source_font["m_LineSpacing"] if source_font else 1,
            "Wrap": bool(source_font and source_font["m_HorizontalOverflow"] == 0),
            "Raycast": bool(graphic and graphic.get("m_RaycastTarget", 1)),
            "PreserveAspect": bool(image and image.get("m_PreserveAspect", 0)),
            "Button": action,
            "ButtonAnimation": bool(button and button.get("m_Transition") == 3),
        }
        index = len(nodes)
        nodes.append(node)
        path = parent_path + "/" + str(go["m_Name"])
        reference_nodes.append({"id": game_object_id, "transformId": transform_id,
            "path": path, "activeInHierarchy": parent_active and node["Active"],
            "transform": json_ids(transform), "components": json_ids(parts),
            "runtime": {**node, "Texture": str(node["Texture"]), "Font": str(node["Font"])}})
        if builtin_panel:
            slices, evidence = add_pause_slices(importer, node, index, image, scaler)
            generated_graphics.append(evidence)
            for child_node in slices:
                nodes.append(child_node)
                reference_nodes.append({"id": child_node["Id"], "sourceParentId": game_object_id,
                    "path": path+"/"+child_node["Name"], "generated": "UnityBuiltinBackgroundSlice",
                    "activeInHierarchy": parent_active and node["Active"],
                    "runtime": {**child_node, "Texture": str(child_node["Texture"]), "Font": str(child_node["Font"])}})
        for child in transform.get("m_Children", []):
            visit(file_id(child), index, parent_active and node["Active"], path)

    for child in transforms[canvas_transform]["m_Children"]:
        visit(file_id(child), -1)
    controllers = {}
    for name in (("Start", "Quat") if scene_name == "Main" and canvas_name == "Canvas" else ()):
        path = importer.source / f"Assets/{name}.controller"
        controllers[path.relative_to(importer.source).as_posix()] = json_ids(unity_docs(path))
    return nodes, {
        "schema": 1, "source": scene.relative_to(importer.source).as_posix(),
        "sourceSha256": hashlib.sha256(scene.read_bytes()).hexdigest(),
        "canvasId": canvas_id, "canvas": json_ids(canvas), "scaler": json_ids(scaler),
        "fontHandle": str(FONT_HANDLE), "nodes": reference_nodes, "controllers": controllers,
        "coordinates": "Original local RectTransform coordinates; Parent=-1 is the root Canvas. Nodes use source DFS order. Preserve inactive ancestors.",
        "buttonAnimation": {"highlightedScale": [.25, .30, .25], "times": [0, .5, 1], "loop": True, "transitionSeconds": .25} if controllers else None,
        "generatedGraphics": generated_graphics,
        "limitations": [],
    }


def build_menu(importer):
    return build_canvas(importer)


def export_menu(importer):
    nodes, reference = build_menu(importer)
    tutorial_nodes, tutorial_reference = build_canvas(importer, "default")
    pause_nodes, pause_reference = build_canvas(importer, "Main", "Menu")
    builtin_output = importer.reference / "UnityBuiltins"
    builtin_output.mkdir(parents=True, exist_ok=True)
    for name in ("Background.png", "Background.json", "UISprite.png", "UISprite.json"):
        shutil.copyfile(BUILTIN_REFERENCE / name, builtin_output / name)
    float_fields = {"X", "Y", "W", "H", "AnchorMinX", "AnchorMinY", "AnchorMaxX", "AnchorMaxY", "PivotX", "PivotY", "ScaleX", "ScaleY", "ScaleZ", "Rotation", "R", "G", "B", "A", "FontSize", "LineSpacing"}
    int_fields = {"Parent", "Alignment", "VerticalAlignment"}
    ulong_fields = {"Texture", "Font"}
    bool_fields = {"Active", "Image", "Wrap", "Raycast", "PreserveAspect", "ButtonAnimation"}
    def literal(key, value):
        if value is None: return "null"
        if key in bool_fields: return "true" if value else "false"
        if key in ulong_fields: return str(value) + "UL"
        if key in int_fields: return str(value)
        if key in float_fields:
            if not math.isfinite(value): raise ValueError(f"Non-finite menu value: {key}")
            return format(value, ".9g") + "f"
        return json.dumps(value, ensure_ascii=False)
    lines = ["// Generated from original Unity Main, tutorial and pause canvases. Run import-return.py to regenerate.",
             "#nullable enable", "namespace TomCatGame;", "", "public sealed class ReturnMenuNode", "{"]
    for key in nodes[0]:
        kind = "float" if key in float_fields else "int" if key in int_fields else "ulong" if key in ulong_fields else "bool" if key in bool_fields else "string?" if key in ("Text", "Button") else "string"
        default = ' = "";' if kind == "string" else ""
        lines.append(f"    public {kind} {key} {{ get; init; }}{default}")
    lines.extend(["}", "", "public static class ReturnMenuData", "{"])
    # The whole-map PNGs are reference composites, deliberately not cooked.
    # Every remaining image is packaged, including editable Tilemap cell art.
    textures = [asset["handle"] for asset in importer.assets
                if not Path(asset["path"]).name.startswith("map-")]
    lines.append("    public static readonly ulong[] PreloadTextures = [" +
                 ", ".join(str(handle) + "UL" for handle in textures) + "];")
    for prefix, group, source in (("", nodes, reference), ("Tutorial", tutorial_nodes, tutorial_reference), ("Pause", pause_nodes, pause_reference)):
        lines.extend([f"    public const float {prefix}ScaleFactor = {literal('X', source['scaler']['m_ScaleFactor'])};",
                      f"    public static readonly ReturnMenuNode[] {prefix}Nodes =", "    ["])
        for node in group:
            lines.append("        new() { " + ", ".join(key + "=" + literal(key, value) for key, value in node.items()) + " },")
        lines.append("    ];")
    lines.extend(["}", ""])
    script = importer.output / "Assets/Scripts/ReturnMenuData.cs"
    script.write_text("\n".join(lines), encoding="utf-8")
    Path(str(script)+".tcmeta").write_text(
        f"SchemaVersion: 2\nAsset:\n  Handle: {DATA_HANDLE}\n  Type: CSharpScript\n  ImportSettings: {{}}\n  SubAssets: []\n", encoding="utf-8")
    (importer.reference / "main-ui.json").write_text(json.dumps(reference, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    (importer.reference / "tutorial-ui.json").write_text(json.dumps(tutorial_reference, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    (importer.reference / "pause-ui.json").write_text(json.dumps(pause_reference, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    return reference
