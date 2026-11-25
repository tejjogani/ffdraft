"""Blender Cycles reference, run as its own process (bpy is GPL; nothing else imports it).

usage: render_cycles.py <camera> <spp> <mode> [res] [depth]
mode: disp | nodisp | disp_oidn   (Principled BSDF dispersion on/off; OIDN denoise on)
Writes out/cycles_<camera>_<mode>.npy (linear Rec.709 float32).
"""
import json
import os
import struct
import sys
import time

import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
cam_name, spp, mode = argv[0], int(argv[1]), argv[2]
res = int(argv[3]) if len(argv) > 3 else 512
depth = int(argv[4]) if len(argv) > 4 else 32
HERE = os.path.dirname(os.path.abspath(__file__))
S = json.load(open(os.path.join(HERE, "scene", "scene.json")))
MM = 0.001


def read_ply(path):
    with open(path, "rb") as f:
        nv = nf = 0
        while True:
            line = f.readline().decode().strip()
            if line.startswith("element vertex"): nv = int(line.split()[-1])
            if line.startswith("element face"): nf = int(line.split()[-1])
            if line == "end_header": break
        vn = np.frombuffer(f.read(nv * 24), dtype="<f4").reshape(nv, 6)
        faces = np.frombuffer(f.read(nf * 13), dtype=np.dtype([("n", "u1"), ("i", "<i4", 3)]))["i"]
    return vn[:, :3], faces


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes.clear()
    return m, m.node_tree, m.node_tree.nodes.new("ShaderNodeOutputMaterial")


def mesh_object(name, verts, faces, mat, smooth):
    me = bpy.data.meshes.new(name)
    me.from_pydata((verts * MM).tolist(), [], faces.tolist())
    me.update()
    for p in me.polygons:
        p.use_smooth = smooth
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


# Gold: Metallic BSDF, F82 (as the product worker does).
gold, tree, out = material("gold")
b = tree.nodes.new("ShaderNodeBsdfMetallic")
b.fresnel_type = "F82"
b.inputs["Base Color"].default_value = (*S["metal"]["rgb"], 1)
b.inputs["Edge Tint"].default_value = (*S["metal"]["edgeTint"], 1)
b.inputs["Roughness"].default_value = S["metal"]["roughnessAlpha"] ** 0.5   # alpha = roughness^2
tree.links.new(b.outputs[0], out.inputs["Surface"])

# Diamond: Principled BSDF with native dispersion (Blender 5.3).
gem, tree, out = material("diamond")
b = tree.nodes.new("ShaderNodeBsdfPrincipled")
b.inputs["Base Color"].default_value = (1, 1, 1, 1)
b.inputs["Roughness"].default_value = 0.0
b.inputs["IOR"].default_value = S["gem"]["ior"]
b.inputs["Transmission Weight"].default_value = 1.0
b.inputs["Transmission Dispersion Scale"].default_value = 0.0 if mode == "nodisp" else 1.0
b.inputs["Transmission Dispersion Abbe Number"].default_value = S["gem"]["abbe"]
tree.links.new(b.outputs[0], out.inputs["Surface"])

ground, tree, out = material("ground")
b = tree.nodes.new("ShaderNodeBsdfDiffuse")
b.inputs["Color"].default_value = (S["ground"]["albedo"],) * 3 + (1,)
tree.links.new(b.outputs[0], out.inputs["Surface"])

v, f = read_ply(os.path.join(HERE, "scene", "metal.ply"))
mesh_object("metal", v, f, gold, True)
v, f = read_ply(os.path.join(HERE, "scene", "gem.ply"))
mesh_object("gem", v, f, gem, False)
h = S["ground"]["halfSize"]
mesh_object("ground", np.array([[-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0]], dtype=float),
            np.array([[0, 1, 2, 3]]), ground, False)

for L in S["lights"]:
    c, n, u, w = (np.array(L[k]) for k in ("center", "normal", "u", "v"))
    quad = np.array([c - u - w, c + u - w, c + u + w, c - u + w])
    if np.cross(quad[1] - quad[0], quad[2] - quad[0]) @ n < 0:
        quad = quad[::-1]
    m, tree, out = material("light_" + L["name"])
    e = tree.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = (1, 1, 1, 1)
    geo = tree.nodes.new("ShaderNodeNewGeometry")
    mul = tree.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    inv = tree.nodes.new("ShaderNodeMath")
    inv.operation = "SUBTRACT"
    inv.inputs[0].default_value = 1.0
    tree.links.new(geo.outputs["Backfacing"], inv.inputs[1])
    mul.inputs[0].default_value = L["radiance"]
    tree.links.new(inv.outputs[0], mul.inputs[1])
    tree.links.new(mul.outputs[0], e.inputs["Strength"])   # one-sided: emits along the normal only
    tree.links.new(e.outputs[0], out.inputs["Surface"])
    mesh_object("light_" + L["name"], quad, np.array([[0, 1, 2, 3]]), m, False)

world = bpy.data.worlds.new("world")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (1, 1, 1, 1)
bg.inputs["Strength"].default_value = S["environment"]["radiance"]
scene.world = world

cam = S["cameras"][cam_name]
cd = bpy.data.cameras.new("cam")
cd.sensor_fit = "VERTICAL"
cd.angle_y = np.radians(cam["vfov"])
cd.clip_start, cd.clip_end = 0.001, 5.0
co = bpy.data.objects.new("cam", cd)
co.location = Vector(cam["origin"]) * MM
co.rotation_euler = (Vector(cam["target"]) - Vector(cam["origin"])).to_track_quat("-Z", "Y").to_euler()
scene.collection.objects.link(co)
scene.camera = co

scene.render.engine = "CYCLES"
scene.render.resolution_x = scene.render.resolution_y = res
scene.render.resolution_percentage = 100
scene.render.threads_mode = "FIXED"
scene.render.threads = os.cpu_count() or 2
c = scene.cycles
c.device = "CPU"
device_used = "CPU"
want = os.environ.get("SPIKE_CYCLES_DEVICE", "CPU").upper()   # e.g. METAL on a Mac, OPTIX on an RTX card
if want != "CPU":
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = want
        prefs.refresh_devices()
        found = [d for d in prefs.devices if d.type == want]
        for d in prefs.devices:
            d.use = d.type == want
        if found:
            c.device = "GPU"
            device_used = want + ": " + ", ".join(d.name for d in found)
    except TypeError:
        pass   # backend not in this build: stay on the CPU
c.samples = spp
c.use_adaptive_sampling = False
c.max_bounces = c.transmission_bounces = c.glossy_bounces = depth
c.diffuse_bounces = 8
c.transparent_max_bounces = 8
c.sample_clamp_direct = c.sample_clamp_indirect = 0.0
c.blur_glossy = 0.0
c.caustics_reflective = c.caustics_refractive = True
c.use_denoising = mode.endswith("oidn")
if c.use_denoising:
    c.denoiser = "OPENIMAGEDENOISE"
c.seed = 0
scene.view_settings.view_transform = "Raw"
scene.render.film_transparent = False
try:
    c.pixel_filter_type = "BOX"
except Exception:
    pass
img = scene.render.image_settings
try:
    img.media_type = "IMAGE"
except Exception:
    pass
img.file_format = "OPEN_EXR"
img.color_mode = "RGB"
img.color_depth = "32"
os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
name = "cycles_%s_%s" % (cam_name, mode)
exr = os.path.join(HERE, "out", name + ".exr")
scene.render.filepath = exr
t0 = time.time()
bpy.ops.render.render(write_still=True)
t_render = time.time() - t0
im = bpy.data.images.load(exr)
px = np.empty(res * res * 4, dtype=np.float32)
im.pixels.foreach_get(px)
px = px.reshape(res, res, 4)[::-1, :, :3]
np.save(os.path.join(HERE, "out", name + ".npy"), px)
print("PAVE_RESULT " + json.dumps({"engine": "cycles " + bpy.app.version_string, "camera": cam_name, "mode": mode,
                                   "res": res, "spp": spp, "max_depth": depth, "device": device_used,
                                   "threads": scene.render.threads, "render_s": round(t_render, 2),
                                   "cpu_s": round(sum(os.times()[:2]), 1), "load1": round(os.getloadavg()[0], 1),
                                   "out": name + ".npy"}))
