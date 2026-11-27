# SPDX-License-Identifier: GPL-3.0-or-later
"""Builds the Blender scene from a resolved job: piece, rig, world, ground and camera.

Hierarchy (mirrors the three.js side so both renderers move identically):
  piece   empty at the rig pivot (x, y); turntables rotate it about Z
  rig     empty at the rig pivot; light sweeps rotate it about Z; holds panels and sparkles
  orbit   empty at the camera target, rotation (−elevation, 0, azimuth); holds the camera at
          (0, −distance, 0) looking back along +Y, rolled about its view axis
"""

from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion

from .job import MM, Ambient, Animation, Camera, Ground, Keyframe, Panel, Rig, Scene, Sparkle, Vec3
from .materials import build_materials


def _m(v: Vec3) -> tuple[float, float, float]:
    return (v[0] * MM, v[1] * MM, v[2] * MM)


def _offset(p: Vec3, pivot: Vec3) -> tuple[float, float, float]:
    """A rig position relative to the rig's pivot, in metres."""
    return _m((p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]))


def _link(obj: bpy.types.Object, parent: bpy.types.Object | None = None) -> bpy.types.Object:
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def _empty(name: str, location: tuple[float, float, float]) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    obj.location = location
    return _link(obj)


def _emission(name: str) -> bpy.types.Material:
    """Emission coloured by the mesh's `radiance` colour attribute (HDR, per vertex)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    attr = tree.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "radiance"
    emit = tree.nodes.new("ShaderNodeEmission")
    emit.inputs["Strength"].default_value = 1.0
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    tree.links.new(attr.outputs["Color"], emit.inputs["Color"])
    tree.links.new(emit.outputs[0], out.inputs["Surface"])
    return mat


def _principled(name: str, color: tuple[float, float, float], roughness: float, ior: float = 1.5) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["IOR"].default_value = ior
    return mat


# ── Piece ────────────────────────────────────────────────────────────────────────────────────


def import_piece(glb: Path, scene: Scene) -> tuple[bpy.types.Object, list[bpy.types.Object]]:
    """Imports the GLB, assigns materials by node name, and returns (piece root, gem objects)."""
    bpy.ops.import_scene.gltf(filepath=str(glb))
    materials = build_materials(scene["materials"])
    pivot = scene["rig"]["pivot"]
    piece = _empty("piece", (pivot[0] * MM, pivot[1] * MM, 0.0))
    gems: list[bpy.types.Object] = []
    for obj in [o for o in bpy.context.scene.objects if o.get("role") in ("metal", "gem")]:
        key = scene["assignments"].get(obj.name)
        if key is None:
            raise KeyError(f"No material assigned to GLB node {obj.name!r}")
        world = obj.matrix_world.copy()
        if obj.data.users == 1:
            # Bake unique (metal) meshes into piece space so object-space textures and the brush
            # tangent use the kernel's axes in metres; the glTF importer leaves a Y-up basis.
            obj.data.transform(world)
            world = Matrix.Identity(4)
        obj.parent = piece
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_basis = Matrix.Translation(-piece.location) @ world
        # Instances can share geometry and still use different shot materials.
        if not obj.data.materials:
            obj.data.materials.append(materials[key])
        for slot in obj.material_slots:
            slot.link = "OBJECT"
            slot.material = materials[key]
        # An imported gemstone keeps its original CAD role and triangle mesh.
        if obj.get("role") == "gem" or scene["materials"][key]["kind"] == "gem":
            gems.append(obj)
    for obj in [o for o in bpy.context.scene.objects if o.type == "EMPTY" and not o.children and o is not piece]:
        bpy.data.objects.remove(obj)
    return piece, gems


# ── Rig ──────────────────────────────────────────────────────────────────────────────────────


def _panel(p: Panel, rig: bpy.types.Object, pivot: Vec3, material: bpy.types.Material) -> bpy.types.Object:
    w, h = p["size"][0] * MM / 2, p["size"][1] * MM / 2
    mesh = bpy.data.meshes.new(p["id"])
    # Wound so the face normal is local −Z, the direction the panel emits.
    mesh.from_pydata([(-w, -h, 0), (-w, h, 0), (w, h, 0), (w, -h, 0)], [], [(0, 1, 2, 3)])
    radiance = mesh.color_attributes.new("radiance", "FLOAT_COLOR", "POINT")
    bottom, top = p["gradient"]
    for i, k in enumerate((bottom, top, top, bottom)):
        radiance.data[i].color = (*(c * k for c in p["radiance"]), 1.0)
    mesh.materials.append(material)
    obj = _link(bpy.data.objects.new(p["id"], mesh), rig)
    obj.location = _offset(p["position"], pivot)
    x, y, z, qw = p["quaternion"]
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Quaternion((qw, x, y, z))
    # The rig is studio equipment, seen only in reflections and refractions — as in the
    # viewport, where it exists only in the PMREM. It casts no shadows (a card's shadow on the
    # catcher would read as dirt), and black flags are invisible to diffuse rays, so they draw
    # dark edges in metal without darkening the floor.
    obj.visible_camera = False
    obj.visible_shadow = False
    if max(p["radiance"]) == 0:
        obj.visible_diffuse = False
    return obj


def _sparkle(i: int, s: Sparkle, rig: bpy.types.Object, pivot: Vec3, gems: bpy.types.Collection) -> None:
    light = bpy.data.lights.new(f"sparkle-{i}", "POINT")
    peak = max(s["intensity"])
    # Cycles point light: radiant intensity I = P / 4π (calibrated in this container), and the
    # job's intensity is per mm², so P = 4π · I · 1e-6.
    light.energy = 4 * math.pi * peak * MM * MM
    light.color = tuple(c / peak for c in s["intensity"])
    light.shadow_soft_size = s["radius"] * MM
    obj = _link(bpy.data.objects.new(light.name, light), rig)
    obj.location = _offset(s["position"], pivot)
    obj.visible_camera = False
    # Research §1: light-link sparkle to stones so metal shows no pinpoint specks.
    obj.light_linking.receiver_collection = gems


def build_rig(
    rig: Rig, gems: list[bpy.types.Object], camera_floor: bpy.types.Object | None
) -> bpy.types.Object:
    root = _empty("rig", _m(rig["pivot"]))
    root.rotation_euler = (0.0, 0.0, math.radians(rig["rotation"]))
    material = _emission("panel")
    panel_receivers = None
    if camera_floor is not None:
        panel_receivers = bpy.data.collections.new("acrylic-flag")
        panel_receivers.objects.link(camera_floor)
        panel_receivers.collection_objects[0].light_linking.link_state = "EXCLUDE"
    for p in rig["panels"]:
        panel = _panel(p, root, rig["pivot"], material)
        if panel_receivers is not None:
            panel.light_linking.receiver_collection = panel_receivers
    if rig["sparkles"]:
        receivers = bpy.data.collections.new("sparkle-receivers")
        for g in gems:
            receivers.objects.link(g)
        for i, s in enumerate(rig["sparkles"]):
            _sparkle(i, s, root, rig["pivot"], receivers)
    return root


def build_world(ambient: Ambient) -> None:
    """World radiance interpolated linearly in the view direction's z, as in the three.js PMREM."""
    world = bpy.data.worlds.new("pave")
    bpy.context.scene.world = world
    world.use_nodes = True
    tree = world.node_tree
    tree.nodes.clear()
    coords = tree.nodes.new("ShaderNodeTexCoord")
    split = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coords.outputs["Generated"], split.inputs[0])

    def color(c: tuple[float, float, float]) -> bpy.types.NodeSocket:
        node = tree.nodes.new("ShaderNodeCombineXYZ")
        for i in range(3):
            node.inputs[i].default_value = c[i]
        return node.outputs[0]

    def mix(a: bpy.types.NodeSocket, b: bpy.types.NodeSocket, factor: bpy.types.NodeSocket) -> bpy.types.NodeSocket:
        node = tree.nodes.new("ShaderNodeMix")
        node.data_type = "VECTOR"
        tree.links.new(factor, node.inputs["Factor"])
        tree.links.new(a, node.inputs[4])
        tree.links.new(b, node.inputs[5])
        return node.outputs[1]

    def clamp(sign: float) -> bpy.types.NodeSocket:
        node = tree.nodes.new("ShaderNodeMath")
        node.operation = "MULTIPLY"
        node.use_clamp = True
        node.inputs[1].default_value = sign
        tree.links.new(split.outputs["Z"], node.inputs[0])
        return node.outputs[0]

    upper = mix(color(ambient["horizon"]), color(ambient["zenith"]), clamp(1.0))
    full = mix(upper, color(ambient["nadir"]), clamp(-1.0))
    background = tree.nodes.new("ShaderNodeBackground")
    tree.links.new(full, background.inputs["Color"])
    out = tree.nodes.new("ShaderNodeOutputWorld")
    tree.links.new(background.outputs[0], out.inputs["Surface"])


# ── Ground ───────────────────────────────────────────────────────────────────────────────────


def _plane(name: str, z: float, size: float, center: tuple[float, float]) -> bpy.types.Object:
    s = size * MM / 2
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    obj = _link(bpy.data.objects.new(name, mesh))
    obj.location = (center[0] * MM, center[1] * MM, z * MM)
    return obj


def build_ground(g: Ground, center: Vec3) -> list[bpy.types.Object]:
    kind = g["kind"]
    if kind == "none":
        return []
    if kind == "shadow":
        obj = _plane("ground", g["z"], g["size"], (center[0], center[1]))
        obj.is_shadow_catcher = True
        # Camera-only: a shadow, not a lit white floor the metal and stones would reflect.
        # The look's ambient nadir stands in for floor bounce, exactly as in the viewport.
        obj.visible_diffuse = obj.visible_glossy = obj.visible_transmission = False
        obj.data.materials.append(_principled("ground", (0.8, 0.8, 0.8), 1.0))
        return [obj]
    if kind == "reflective":
        # The camera sees the reflection of the piece and room, with softboxes flagged off the
        # acrylic. The piece still sees the same rig in the sheet as it does in the room.
        center_xy = (center[0], center[1])
        material = _principled("ground", g["color"], g["roughness"], g["ior"])
        camera_floor = _plane("acrylic", g["z"], g["size"], center_xy)
        camera_floor.visible_diffuse = camera_floor.visible_glossy = camera_floor.visible_transmission = False
        camera_floor.data.materials.append(material)
        reflected_floor = _plane("acrylic-bounce", g["z"] - 0.002, g["size"], center_xy)
        reflected_floor.visible_camera = False
        reflected_floor.data.materials.append(material)
        return [camera_floor, reflected_floor]
    if kind == "white-gloss":
        # The pale floor receives the softboxes so it shows both contact shadow and reflection.
        obj = _plane("white-gloss", g["z"], g["size"], (center[0], center[1]))
        obj.data.materials.append(_principled("white-gloss", g["color"], g["roughness"], g["ior"]))
        return [obj]
    # Sweep: extrude the [depth, height] profile across its width, facing the camera.
    hw = g["width"] * MM / 2
    profile = g["profile"]
    verts = [(x, d * MM, h * MM) for d, h in profile for x in (-hw, hw)]
    faces = [(2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(len(profile) - 1)]
    mesh = bpy.data.meshes.new("sweep")
    mesh.from_pydata(verts, [], faces)
    mesh.shade_smooth()
    mesh.materials.append(_principled("sweep", g["color"], g["roughness"]))
    obj = _link(bpy.data.objects.new("ground", mesh))
    obj.location = _m(g["center"])
    obj.rotation_euler = (0.0, 0.0, math.radians(g["azimuth"]))
    return [obj]


# ── Camera ───────────────────────────────────────────────────────────────────────────────────


def build_camera(c: Camera) -> tuple[bpy.types.Object, bpy.types.Object]:
    orbit = _empty("orbit", _m(c["target"]))
    orbit.rotation_mode = "XYZ"
    orbit.rotation_euler = (math.radians(-c["elevation"]), 0.0, math.radians(c["azimuth"]))
    data = bpy.data.cameras.new("camera")
    data.lens = c["focalLength"]
    data.sensor_width = c["sensorWidth"]
    data.sensor_fit = "AUTO"
    data.clip_start = c["near"] * MM
    data.clip_end = c["far"] * MM
    if c["fStop"] is not None:
        data.dof.use_dof = True
        data.dof.aperture_fstop = c["fStop"]
        data.dof.focus_distance = c["focusDistance"] * MM
    cam = _link(bpy.data.objects.new("camera", data), orbit)
    cam.location = (0.0, -c["distance"] * MM, 0.0)
    # Looking back along +Y, then rolled about its own view axis. Turning the camera about its
    # local Z by +roll is the parent's −Y rotation applied after the X turn, so the XYZ Euler is
    # (90°, −roll, 0); positive roll turns the picture clockwise, as in @pave/render.
    cam.rotation_euler = (math.pi / 2, -math.radians(c["roll"]), 0.0)
    bpy.context.scene.camera = cam
    return orbit, cam


# ── Animation ────────────────────────────────────────────────────────────────────────────────

_EASING = {"easeIn": "EASE_IN", "easeOut": "EASE_OUT", "easeInOut": "EASE_IN_OUT"}


def _keys(owner: bpy.types.ID, path: str, index: int, keys: list[Keyframe], convert) -> None:  # type: ignore[no-untyped-def]
    """Keys `owner.<path>[index]` (index −1 for scalars) with per-segment cubic easing."""
    from bpy_extras import anim_utils

    head, _, prop = path.rpartition(".")
    target = owner.path_resolve(head) if head else owner
    for k in keys:
        value = convert(k["value"])
        if index >= 0:
            getattr(target, prop)[index] = value
        else:
            setattr(target, prop, value)
        owner.keyframe_insert(path, index=index, frame=k["frame"])
    anim = owner.animation_data
    bag = anim_utils.action_get_channelbag_for_slot(anim.action, anim.action_slot)
    curve = bag.fcurves.find(path, index=max(index, 0))
    for point, k in zip(curve.keyframe_points, keys, strict=True):
        if k["ease"] == "linear":
            point.interpolation = "LINEAR"
        else:
            point.interpolation = "CUBIC"
            point.easing = _EASING[k["ease"]]


def animate(
    a: Animation, piece: bpy.types.Object, rig: bpy.types.Object, orbit: bpy.types.Object, cam: bpy.types.Object
) -> None:
    scene = bpy.context.scene
    scene.render.fps = a["fps"]
    scene.frame_start = 0
    scene.frame_end = a["frameCount"] - 1
    t = a["tracks"]
    if "pieceRotation" in t:
        _keys(piece, "rotation_euler", 2, t["pieceRotation"], math.radians)
    if "rigRotation" in t:
        _keys(rig, "rotation_euler", 2, t["rigRotation"], math.radians)
    if "cameraAzimuth" in t:
        _keys(orbit, "rotation_euler", 2, t["cameraAzimuth"], math.radians)
    if "cameraElevation" in t:
        _keys(orbit, "rotation_euler", 0, t["cameraElevation"], lambda v: math.radians(-v))
    if "cameraDistance" in t:
        _keys(cam, "location", 1, t["cameraDistance"], lambda v: -v * MM)
    if "focusDistance" in t:
        _keys(cam.data, "dof.focus_distance", -1, t["focusDistance"], lambda v: v * MM)


def build_scene(scene: Scene, glb: Path) -> dict[str, list[bpy.types.Object]]:
    """Builds everything; returns object groups the renderer toggles for the mask pass."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    piece, gems = import_piece(glb, scene)
    ground = build_ground(scene["ground"], scene["camera"]["target"])
    rig = build_rig(scene["rig"], gems, ground[0] if scene["ground"]["kind"] == "reflective" else None)
    build_world(scene["rig"]["ambient"])
    orbit, cam = build_camera(scene["camera"])
    if scene["animation"]:
        animate(scene["animation"], piece, rig, orbit, cam)
    return {"ground": ground}
