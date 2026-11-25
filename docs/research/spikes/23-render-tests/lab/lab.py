"""Lab 23: one render driver for the measured render-settings tests.

Runs Blender Cycles through the `bpy` Python module in its own process (bpy is GPL; nothing else imports it).
Scene geometry, lights and cameras come from the research-15 spike export (scene.json, gem.ply, metal.ply);
materials are the written workflow's (Principled gold, Principled diamond).

usage:  <python-with-bpy> lab.py '<json list of jobs>'
Each job is a dict; keys not given fall back to WF (the written workflow's settings) below.
For every job it writes out/<name>.exr (32-bit float linear), out/<name>.npy (same pixels, top row first),
out/<name>.png (8-bit, scene view transform) and appends one JSON line to results.jsonl.
Several jobs in one call are rendered in the same process (used by the same-process repeatability test).
"""
import hashlib
import json
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
SCENE_DIR = os.environ.get("LAB_SCENE", "/home/claude/scratch/15/scene")
OUT = os.path.join(HERE, "out")
MM = 0.001

# The written workflow's settings (SKILL.md section 5), plus the lab's fixed choices.
WF = dict(
    cam="macro", res=384, border=[0.125, 0.875, 0.1667, 0.797],   # "stone" crop: [xmin, xmax, ymin, ymax] fractions (y from bottom); null = full frame
    spp=64, seed=0, animated_seed=False, frame=1,
    adaptive=False, adaptive_threshold=0.01, time_limit=0.0,
    max_bounces=32, transmission=32, glossy=16, diffuse=3, transparent=8,
    caustics=False, blur_glossy=0.2, clamp_indirect=20.0, clamp_direct=0.0,
    denoise=False, denoise_passes="RGB_ALBEDO_NORMAL", prefilter="ACCURATE", follow_reflections=None,
    ior=2.417, disp_scale=0.36, abbe=20.0,      # "Dispersion 0.36" read as Scale 0.36 at the node's default Abbe 20
    threads=2, view="AgX", look="AgX - Base Contrast", exposure=-1.152,   # display only: 2^-1.152 = 0.45, the spike's gain
    film_transparent=False, shadow_catcher=False, rot_deg=0.0,
    mask=False, stamp=None, write_still=None, jpeg=False, dither=None,   # write_still: None | "PNG" | "JPEG"
    gold=(1.0, 0.76, 0.38), gold_rough=0.08,
    ground_emit=None,                           # with mask=True: ground emits this grey value (linear), a colour-management probe
    ground_albedo=None,                         # override the ground's diffuse albedo (spike scene: 0.8)
    tangent_test=None,                          # None | "normalmap" | "aniso": metal material that needs UV (MikkTSpace) tangents
    exr_multilayer=False,                       # also write out/<name>_ml.exr (multilayer) with render(write_still=True)
)


def sha(b):
    return hashlib.sha256(b).hexdigest()[:16]


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


def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes.clear()
    return m, m.node_tree, m.node_tree.nodes.new("ShaderNodeOutputMaterial")


def emission_mat(name, rgb, strength=1.0):
    m, tree, out = new_mat(name)
    e = tree.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = (*rgb, 1)
    e.inputs["Strength"].default_value = strength
    tree.links.new(e.outputs[0], out.inputs["Surface"])
    return m


def mesh_object(scene, name, verts, faces, mat, smooth):
    me = bpy.data.meshes.new(name)
    me.from_pydata((np.asarray(verts) * MM).tolist(), [], np.asarray(faces).tolist())
    me.update()
    for p in me.polygons:
        p.use_smooth = smooth
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


def build(cfg):
    S = json.load(open(os.path.join(SCENE_DIR, "scene.json")))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    mask = cfg["mask"]

    if mask:
        gold = emission_mat("gold", (0, 1, 0))
        gem = emission_mat("diamond", (1, 0, 0))
        ge = cfg["ground_emit"]
        ground = emission_mat("ground", (0, 0, 1) if ge is None else (ge, ge, ge))
    else:
        gold, tree, out = new_mat("gold")
        b = tree.nodes.new("ShaderNodeBsdfPrincipled")
        b.inputs["Base Color"].default_value = (*cfg["gold"], 1)
        b.inputs["Metallic"].default_value = 1.0
        b.inputs["Roughness"].default_value = cfg["gold_rough"]
        tree.links.new(b.outputs[0], out.inputs["Surface"])
        if cfg["tangent_test"] == "normalmap":      # procedural noise -> tangent-space Normal Map -> needs tangents from the UV map
            noise = tree.nodes.new("ShaderNodeTexNoise")
            noise.inputs["Scale"].default_value = 400.0
            nm = tree.nodes.new("ShaderNodeNormalMap")
            nm.space = "TANGENT"
            nm.uv_map = "UVMap"
            nm.inputs["Strength"].default_value = 1.0
            tree.links.new(noise.outputs["Color"], nm.inputs["Color"])
            tree.links.new(nm.outputs["Normal"], b.inputs["Normal"])
        elif cfg["tangent_test"] == "aniso":        # anisotropic gold with the tangent taken from the UV map
            tn = tree.nodes.new("ShaderNodeTangent")
            tn.direction_type = "UV_MAP"
            tn.uv_map = "UVMap"
            b.inputs["Anisotropic"].default_value = 0.8
            b.inputs["Roughness"].default_value = 0.3
            tree.links.new(tn.outputs["Tangent"], b.inputs["Tangent"])

        gem, tree, out = new_mat("diamond")
        b = tree.nodes.new("ShaderNodeBsdfPrincipled")
        b.inputs["Base Color"].default_value = (1, 1, 1, 1)
        b.inputs["Roughness"].default_value = 0.0
        b.inputs["IOR"].default_value = cfg["ior"]
        b.inputs["Transmission Weight"].default_value = 1.0
        b.inputs["Transmission Dispersion Scale"].default_value = cfg["disp_scale"]
        b.inputs["Transmission Dispersion Abbe Number"].default_value = cfg["abbe"]
        tree.links.new(b.outputs[0], out.inputs["Surface"])

        ground, tree, out = new_mat("ground")
        b = tree.nodes.new("ShaderNodeBsdfDiffuse")
        b.inputs["Color"].default_value = (cfg["ground_albedo"] or S["ground"]["albedo"],) * 3 + (1,)
        tree.links.new(b.outputs[0], out.inputs["Surface"])

    v, f = read_ply(os.path.join(SCENE_DIR, "metal.ply"))
    ob_metal = mesh_object(scene, "metal", v, f, gold, True)
    if cfg["tangent_test"]:
        me = ob_metal.data
        uvl = me.uv_layers.new(name="UVMap")
        co = np.empty(len(me.vertices) * 3, dtype=np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
        li = np.empty(len(me.loops), dtype=np.int32); me.loops.foreach_get("vertex_index", li)
        uv = np.stack([np.arctan2(co[li, 1], co[li, 0]) / (2 * np.pi) + 0.5, co[li, 2] / 0.03], axis=1).astype(np.float32)
        uvl.data.foreach_set("uv", uv.ravel())
        print("LAB_INFO metal faces", len(me.polygons), "loops", len(me.loops), flush=True)
    v, f = read_ply(os.path.join(SCENE_DIR, "gem.ply"))
    ob_gem = mesh_object(scene, "gem", v, f, gem, False)
    h = S["ground"]["halfSize"]
    ob_ground = mesh_object(scene, "ground", np.array([[-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0]], dtype=float),
                            np.array([[0, 1, 2, 3]]), ground, False)
    ob_ground.is_shadow_catcher = bool(cfg["shadow_catcher"])
    for ob in (ob_metal, ob_gem):          # turntable: the ring turns about its vertical (Z) axis
        ob.rotation_euler = (0.0, 0.0, np.radians(cfg["rot_deg"]))

    for L in S["lights"]:
        c, n, u, w = (np.array(L[k]) for k in ("center", "normal", "u", "v"))
        quad = np.array([c - u - w, c + u - w, c + u + w, c - u + w])
        if np.cross(quad[1] - quad[0], quad[2] - quad[0]) @ n < 0:
            quad = quad[::-1]
        if mask:
            m = emission_mat("light_" + L["name"], (0, 0, 0), 0.0)
        else:
            m, tree, out = new_mat("light_" + L["name"])
            e = tree.nodes.new("ShaderNodeEmission")
            e.inputs["Color"].default_value = (1, 1, 1, 1)
            geo = tree.nodes.new("ShaderNodeNewGeometry")
            mul = tree.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"
            inv = tree.nodes.new("ShaderNodeMath"); inv.operation = "SUBTRACT"
            inv.inputs[0].default_value = 1.0
            tree.links.new(geo.outputs["Backfacing"], inv.inputs[1])
            mul.inputs[0].default_value = L["radiance"]
            tree.links.new(inv.outputs[0], mul.inputs[1])
            tree.links.new(mul.outputs[0], e.inputs["Strength"])   # one-sided emitter
            tree.links.new(e.outputs[0], out.inputs["Surface"])
        mesh_object(scene, "light_" + L["name"], quad, np.array([[0, 1, 2, 3]]), m, False)

    world = bpy.data.worlds.new("world")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (1, 1, 1, 1)
    bg.inputs["Strength"].default_value = 0.0 if mask else S["environment"]["radiance"]
    scene.world = world

    cam = S["cameras"][cfg["cam"]]
    cd = bpy.data.cameras.new("cam")
    cd.sensor_fit = "VERTICAL"
    cd.angle_y = np.radians(cam["vfov"])
    cd.clip_start, cd.clip_end = 0.001, 5.0
    co = bpy.data.objects.new("cam", cd)
    co.location = Vector(cam["origin"]) * MM
    co.rotation_euler = (Vector(cam["target"]) - Vector(cam["origin"])).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(co)
    scene.camera = co
    return scene


def apply(scene, cfg):
    r = scene.render
    r.engine = "CYCLES"
    r.resolution_x = r.resolution_y = cfg["res"]
    r.resolution_percentage = 100
    r.threads_mode = "FIXED"
    r.threads = cfg["threads"]
    r.film_transparent = bool(cfg["film_transparent"])
    if cfg["border"]:
        r.use_border = True
        r.use_crop_to_border = True
        r.border_min_x, r.border_max_x, r.border_min_y, r.border_max_y = cfg["border"]
    else:
        r.use_border = False
    if cfg["dither"] is not None:
        r.dither_intensity = cfg["dither"]
    st = cfg["stamp"]
    if st == "all_off":           # every metadata flag off
        for p in r.bl_rna.properties:
            if p.identifier.startswith("use_stamp"):
                setattr(r, p.identifier, False)
    elif isinstance(st, dict):
        for k, v in st.items():
            setattr(r, k, v)
    scene.frame_set(int(cfg["frame"]))
    c = scene.cycles
    c.device = "CPU"
    c.samples = cfg["spp"]
    c.seed = cfg["seed"]
    c.use_animated_seed = bool(cfg["animated_seed"])
    c.use_adaptive_sampling = bool(cfg["adaptive"])
    c.adaptive_threshold = cfg["adaptive_threshold"]
    c.time_limit = cfg["time_limit"]
    if cfg["mask"]:
        c.max_bounces = c.transmission_bounces = c.glossy_bounces = c.diffuse_bounces = 0
    else:
        c.max_bounces = cfg["max_bounces"]
        c.transmission_bounces = cfg["transmission"]
        c.glossy_bounces = cfg["glossy"]
        c.diffuse_bounces = cfg["diffuse"]
    c.transparent_max_bounces = cfg["transparent"]
    c.caustics_reflective = c.caustics_refractive = bool(cfg["caustics"])
    c.blur_glossy = cfg["blur_glossy"]
    c.sample_clamp_indirect = cfg["clamp_indirect"]
    c.sample_clamp_direct = cfg["clamp_direct"]
    c.use_denoising = bool(cfg["denoise"])
    if cfg["denoise"]:
        c.denoiser = "OPENIMAGEDENOISE"
        c.denoising_input_passes = cfg["denoise_passes"]
        c.denoising_prefilter = cfg["prefilter"]
        if cfg["follow_reflections"] is not None:
            scene.view_layers[0].cycles.denoising_pass_follow_reflections = bool(cfg["follow_reflections"])
    scene.view_settings.view_transform = cfg["view"]
    scene.view_settings.look = cfg["look"]
    scene.view_settings.exposure = cfg["exposure"]


def set_format(scene, fmt):
    img = scene.render.image_settings
    try:
        img.media_type = "IMAGE"
    except Exception:
        pass
    img.file_format = fmt
    if fmt == "OPEN_EXR":
        img.color_mode = "RGBA" if scene.render.film_transparent else "RGB"
        img.color_depth = "32"
        img.exr_codec = "ZIP"
    elif fmt == "PNG":
        img.color_mode = "RGBA" if scene.render.film_transparent else "RGB"
        img.color_depth = "8"
        img.compression = 15
    elif fmt == "JPEG":
        img.color_mode = "RGB"
        img.quality = 95


def load_exr(path, alpha=False):
    im = bpy.data.images.load(path)
    w, h = im.size
    px = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(px)
    bpy.data.images.remove(im)
    px = px.reshape(h, w, 4)[::-1]
    return np.ascontiguousarray(px if alpha else px[:, :, :3])


def render(scene, cfg):
    name = cfg["name"]
    os.makedirs(OUT, exist_ok=True)
    exr, png, jpg = (os.path.join(OUT, name + e) for e in (".exr", ".png", ".jpg"))
    t0 = time.time(); c0 = sum(os.times()[:2])
    extra = {}
    if cfg["write_still"]:
        # The path the workflow scripts use: render straight to an 8-bit file.
        ext = ".png" if cfg["write_still"] == "PNG" else ".jpg"
        set_format(scene, cfg["write_still"])
        scene.render.filepath = os.path.join(OUT, name + "_ws" + ext)
        bpy.ops.render.render(write_still=True)
        extra["ws_sha"] = sha(open(os.path.join(OUT, name + "_ws" + ext), "rb").read())
    else:
        bpy.ops.render.render(write_still=False)
    t_render = time.time() - t0; cpu = sum(os.times()[:2]) - c0
    if cfg["exr_multilayer"]:
        # second render, written by Blender itself as a multilayer EXR (the path a kit/compositing pipeline would use)
        img = scene.render.image_settings
        try:
            img.media_type = "MULTI_LAYER_IMAGE"
        except Exception:
            pass
        img.file_format = "OPEN_EXR_MULTILAYER"
        scene.render.filepath = os.path.join(OUT, name + "_ml.exr")
        bpy.ops.render.render(write_still=True)
        extra["ml_exr_sha"] = sha(open(os.path.join(OUT, name + "_ml.exr"), "rb").read())
    rr = bpy.data.images["Render Result"]
    set_format(scene, "OPEN_EXR"); rr.save_render(filepath=exr, scene=scene)
    set_format(scene, "PNG"); rr.save_render(filepath=png, scene=scene)
    if cfg["jpeg"]:
        set_format(scene, "JPEG"); rr.save_render(filepath=jpg, scene=scene)
        extra["jpg_sha"] = sha(open(jpg, "rb").read())
    px = load_exr(exr, alpha=bool(cfg["film_transparent"]))
    np.save(os.path.join(OUT, name + ".npy"), px)
    res = {"name": name, "blender": bpy.app.version_string, "render_s": round(t_render, 2), "cpu_s": round(cpu, 2),
           "load1": round(os.getloadavg()[0], 2), "shape": list(px.shape),
           "px_sha": sha(px.tobytes()), "exr_sha": sha(open(exr, "rb").read()), "png_sha": sha(open(png, "rb").read()),
           "mean": float(px[..., :3].mean()), "pid": os.getpid(), **extra,
           "cfg": {k: v for k, v in cfg.items() if k != "name" and WF.get(k, None) != v}}
    with open(os.path.join(HERE, "results.jsonl"), "a") as fh:
        fh.write(json.dumps(res) + "\n")
    print("LAB_RESULT " + json.dumps(res), flush=True)
    return res


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    jobs = json.loads(argv[0])
    if isinstance(jobs, dict):
        jobs = [jobs]
    for job in jobs:
        cfg = dict(WF); cfg.update(job)
        scene = build(cfg)
        apply(scene, cfg)
        render(scene, cfg)
