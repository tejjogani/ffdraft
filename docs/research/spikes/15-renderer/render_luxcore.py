"""LuxCoreRender spike (pyluxcore, Apache-2.0). usage: render_luxcore.py <camera> <spp> <mode> [res] [depth]

mode: disp     = PATHCPU, glass with Cauchy dispersion
      nodisp   = PATHCPU, glass without dispersion
      caustic  = PATHCPU with hybrid back/forward tracing (light tracing for caustic paths) + dispersion
Writes out/luxcore_<camera>_<mode>.npy (linear RGB float32).
"""
import json
import os
import sys
import time

import numpy as np
import pyluxcore

cam_name, spp, mode = sys.argv[1], int(sys.argv[2]), sys.argv[3]
res = int(sys.argv[4]) if len(sys.argv) > 4 else 512
depth = int(sys.argv[5]) if len(sys.argv) > 5 else 32
HERE = os.path.dirname(os.path.abspath(__file__))
S = json.load(open(os.path.join(HERE, "scene", "scene.json")))

pyluxcore.Init()
P = pyluxcore.Properties
scene = pyluxcore.Scene()
cam = S["cameras"][cam_name]
sp = P()


def setp(key, *vals):
    sp.Set(pyluxcore.Property(key, list(vals) if len(vals) > 1 else vals[0]))


setp("scene.camera.type", "perspective")
setp("scene.camera.lookat.orig", *cam["origin"])
setp("scene.camera.lookat.target", *cam["target"])
setp("scene.camera.up", 0.0, 0.0, 1.0)
setp("scene.camera.fieldofview", cam["vfov"])
setp("scene.camera.cliphither", 1.0)
setp("scene.camera.clipyon", 5000.0)
setp("scene.camera.autovolume.enable", False)

setp("scene.textures.aufresnel.type", "fresnelpreset")
setp("scene.textures.aufresnel.name", "gold")
setp("scene.materials.gold.type", "metal2")
setp("scene.materials.gold.fresnel", "aufresnel")
setp("scene.materials.gold.uroughness", S["metal"]["roughnessAlpha"])
setp("scene.materials.gold.vroughness", S["metal"]["roughnessAlpha"])

setp("scene.materials.diamond.type", "glass")
setp("scene.materials.diamond.kr", 1.0, 1.0, 1.0)
setp("scene.materials.diamond.kt", 1.0, 1.0, 1.0)
setp("scene.materials.diamond.interiorior", S["gem"]["ior"])
setp("scene.materials.diamond.exteriorior", 1.0)
if mode != "nodisp":
    # LuxCore's Cauchy coefficient is in square micrometres.
    setp("scene.materials.diamond.cauchyb", S["gem"]["cauchyB_nm2"] * 1e-6)
    setp("scene.materials.diamond.cauchyc", S["gem"]["cauchyB_nm2"] * 1e-6)

setp("scene.materials.ground.type", "matte")
setp("scene.materials.ground.kd", *([S["ground"]["albedo"]] * 3))

setp("scene.lights.env.type", "constantinfinite")
setp("scene.lights.env.color", 1.0, 1.0, 1.0)
setp("scene.lights.env.gain", *([S["environment"]["radiance"]] * 3))

setp("scene.shapes.gemshape.type", "mesh")
setp("scene.shapes.gemshape.ply", os.path.join(HERE, "scene", "gem.ply"))
setp("scene.shapes.metalshape.type", "mesh")
setp("scene.shapes.metalshape.ply", os.path.join(HERE, "scene", "metal.ply"))
setp("scene.objects.gem.shape", "gemshape")
setp("scene.objects.gem.material", "diamond")
setp("scene.objects.metal.shape", "metalshape")
setp("scene.objects.metal.material", "gold")

h = S["ground"]["halfSize"]
scene.DefineMesh("groundmesh", [(-h, -h, 0.0), (h, -h, 0.0), (h, h, 0.0), (-h, h, 0.0)],
                 [(0, 1, 2), (0, 2, 3)], None, None, None, None)
setp("scene.objects.ground.shape", "groundmesh")
setp("scene.objects.ground.material", "ground")

for L in S["lights"]:
    c, n, u, w = (np.array(L[k]) for k in ("center", "normal", "u", "v"))
    quad = [c - u - w, c + u - w, c + u + w, c - u + w]
    if np.cross(quad[1] - quad[0], quad[2] - quad[0]) @ n < 0:
        quad = quad[::-1]
    name = "light_" + L["name"]
    scene.DefineMesh(name + "_mesh", [tuple(float(x) for x in p) for p in quad], [(0, 1, 2), (0, 2, 3)],
                     None, None, None, None)
    setp("scene.materials.%s.type" % name, "matte")
    setp("scene.materials.%s.kd" % name, 0.0, 0.0, 0.0)
    setp("scene.materials.%s.emission" % name, *([L["radiance"]] * 3))
    setp("scene.objects.%s.shape" % name, name + "_mesh")
    setp("scene.objects.%s.material" % name, name)

scene.Parse(sp)

cp = P()


def setc(key, *vals):
    cp.Set(pyluxcore.Property(key, list(vals) if len(vals) > 1 else vals[0]))


setc("renderengine.type", "PATHCPU")
setc("native.threads.count", os.cpu_count() or 2)
setc("sampler.type", "SOBOL")
setc("sampler.sobol.adaptive.strength", 0.0)
setc("path.pathdepth.total", depth)
setc("path.pathdepth.diffuse", 8)
setc("path.pathdepth.glossy", depth)
setc("path.pathdepth.specular", depth)
setc("path.clamping.variance.maxvalue", 0.0)
setc("path.russianroulette.depth", 8)
if mode == "caustic":
    setc("path.hybridbackforward.enable", True)
    setc("path.hybridbackforward.partition", 0.8)
    setc("path.hybridbackforward.glossinessthreshold", 0.05)
setc("film.width", res)
setc("film.height", res)
setc("film.filter.type", "BOX")
setc("film.filter.width", 0.5)
setc("film.outputs.0.type", "RGB")
setc("film.outputs.0.filename", os.path.join(HERE, "out", "luxcore_tmp.exr"))
setc("batch.haltspp", spp)
setc("batch.halttime", 900)

config = pyluxcore.RenderConfig(cp, scene)
session = pyluxcore.RenderSession(config)
t0 = time.time()
session.Start()
while True:
    time.sleep(0.5)
    session.UpdateStats()
    if session.HasDone():
        break
t_render = time.time() - t0
stats = session.GetStats()
done_spp = stats.Get("stats.renderengine.pass").GetInt()
film = session.GetFilm()
buf = np.zeros(res * res * 3, dtype=np.float32)
film.GetOutputFloat(pyluxcore.FilmOutputType.RGB, buf)
session.Stop()
img = buf.reshape(res, res, 3)[::-1]
os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
name = "luxcore_%s_%s" % (cam_name, mode)
np.save(os.path.join(HERE, "out", name + ".npy"), img)
print(json.dumps({"engine": "luxcore " + pyluxcore.Version(), "camera": cam_name, "mode": mode, "res": res,
                  "spp": done_spp, "max_depth": depth, "render_s": round(t_render, 2),
                  "cpu_s": round(sum(os.times()[:2]), 1), "load1": round(os.getloadavg()[0], 1), "out": name + ".npy"}))
