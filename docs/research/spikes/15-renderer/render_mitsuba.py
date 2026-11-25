"""Mitsuba 3 spike. usage: render_mitsuba.py <camera> <spp> <mode> [res] [depth]

mode: nodisp  = llvm_ad_spectral, built-in `dielectric` (one IOR for all wavelengths)
      disp    = llvm_ad_spectral, a Python dispersive dielectric (Cauchy) and a one-wavelength-
                per-path wrapper integrator, so every path refracts at its own wavelength
      rgb     = llvm_ad_rgb, built-in dielectric
Writes out/mitsuba_<camera>_<mode>.npy (linear sRGB float32) and prints wall-clock seconds.
"""
import json
import os
import sys
import time
import numpy as np

cam_name, spp, mode = sys.argv[1], int(sys.argv[2]), sys.argv[3]
res = int(sys.argv[4]) if len(sys.argv) > 4 else 512
depth = int(sys.argv[5]) if len(sys.argv) > 5 else 32
HERE = os.path.dirname(os.path.abspath(__file__))
S = json.load(open(os.path.join(HERE, "scene", "scene.json")))

import drjit as dr
import mitsuba as mi

mi.set_variant("llvm_ad_rgb" if mode == "rgb" else "llvm_ad_spectral")
T = mi.ScalarTransform4f


class Dispersive(mi.BSDF):
    """Smooth dielectric whose index follows Cauchy's equation; the hero wavelength picks the path."""

    def __init__(self, props):
        mi.BSDF.__init__(self, props)
        self.a = props["cauchy_a"]
        self.b = props["cauchy_b"]
        reflection = mi.BSDFFlags.DeltaReflection | mi.BSDFFlags.FrontSide | mi.BSDFFlags.BackSide
        transmission = (mi.BSDFFlags.DeltaTransmission | mi.BSDFFlags.FrontSide
                        | mi.BSDFFlags.BackSide | mi.BSDFFlags.NonSymmetric)
        self.m_components = [reflection, transmission]
        self.m_flags = reflection | transmission

    def sample(self, ctx, si, sample1, sample2, active):
        cos_i = mi.Frame3f.cos_theta(si.wi)
        lam = si.wavelengths[0]
        eta = self.a + self.b / (lam * lam)
        r_i, cos_t, eta_it, eta_ti = mi.fresnel(cos_i, eta)
        reflect = sample1 <= r_i
        bs = mi.BSDFSample3f()
        bs.pdf = dr.select(reflect, r_i, 1 - r_i)
        bs.sampled_component = dr.select(reflect, mi.UInt32(0), mi.UInt32(1))
        bs.sampled_type = dr.select(reflect, mi.UInt32(+mi.BSDFFlags.DeltaReflection),
                                    mi.UInt32(+mi.BSDFFlags.DeltaTransmission))
        bs.wo = dr.select(reflect, mi.reflect(si.wi), mi.refract(si.wi, cos_t, eta_ti))
        bs.eta = dr.select(reflect, 1.0, eta_it)
        # Radiance is compressed by eta^2 when it crosses the surface (camera paths).
        weight = dr.select(reflect, 1.0, dr.square(eta_ti))
        return bs, mi.Spectrum(weight) & active

    def eval(self, ctx, si, wo, active):
        return mi.Spectrum(0.0)

    def pdf(self, ctx, si, wo, active):
        return mi.Float(0.0)

    def eval_pdf(self, ctx, si, wo, active):
        return mi.Spectrum(0.0), mi.Float(0.0)

    def to_string(self):
        return "Dispersive[a=%g, b=%g]" % (self.a, self.b)


class OneWavelength(mi.SamplingIntegrator):
    """Runs the stock path tracer with all four spectral slots set to the hero wavelength."""

    def __init__(self, props):
        mi.SamplingIntegrator.__init__(self, props)
        self.inner = mi.load_dict({"type": "path", "max_depth": props.get("max_depth", 32), "rr_depth": 8})

    def sample(self, scene, sampler, ray, medium=None, active=True):
        hero = ray.wavelengths[0]
        one = mi.RayDifferential3f(ray)
        one.wavelengths = mi.Color0f() if False else type(ray.wavelengths)(hero)
        spec, valid, aovs = self.inner.sample(scene, sampler, one, medium, active)
        out = dr.zeros(type(spec))
        out[0] = spec[0] * len(ray.wavelengths)   # the other slots carry nothing: unbiased
        return out, valid, aovs


mi.register_bsdf("dispersive", lambda props: Dispersive(props))
mi.register_integrator("onewavelength", lambda props: OneWavelength(props))

cam = S["cameras"][cam_name]
scene = {
    "type": "scene",
    "integrator": ({"type": "onewavelength", "max_depth": depth} if mode == "disp"
                   else {"type": "path", "max_depth": depth, "rr_depth": 8}),
    "sensor": {
        "type": "perspective", "fov": cam["vfov"], "fov_axis": "y", "near_clip": 1.0, "far_clip": 5000.0,
        "to_world": T().look_at(origin=cam["origin"], target=cam["target"], up=cam["up"]),
        "film": {"type": "hdrfilm", "width": res, "height": res, "rfilter": {"type": "box"},
                 "pixel_format": "rgb", "component_format": "float32"},
        "sampler": {"type": "independent", "sample_count": 1},
    },
    "env": {"type": "constant", "radiance": {"type": "rgb", "value": [S["environment"]["radiance"]] * 3}},
    "ground": {"type": "rectangle",
               "to_world": T().translate([0, 0, S["ground"]["z"]]).scale(S["ground"]["halfSize"]),
               "bsdf": {"type": "diffuse", "reflectance": {"type": "rgb", "value": [S["ground"]["albedo"]] * 3}}},
    "metal": {"type": "ply", "filename": os.path.join(HERE, "scene", "metal.ply"),
              "bsdf": {"type": "roughconductor", "material": "Au", "distribution": "ggx",
                       "alpha": S["metal"]["roughnessAlpha"]}},
    "gem": {"type": "ply", "filename": os.path.join(HERE, "scene", "gem.ply"), "face_normals": True,
            "bsdf": ({"type": "dispersive", "cauchy_a": S["gem"]["cauchyA"], "cauchy_b": S["gem"]["cauchyB_nm2"]}
                     if mode == "disp" else {"type": "dielectric", "int_ior": S["gem"]["ior"], "ext_ior": 1.0})},
}
for L in S["lights"]:
    c, n, u, v = (np.array(L[k]) for k in ("center", "normal", "u", "v"))
    # Mitsuba's rectangle spans [-1,1]^2 in XY and emits along +Z.
    m = np.eye(4)
    m[:3, 0], m[:3, 1], m[:3, 2], m[:3, 3] = u, v, n, c
    if np.linalg.det(m[:3, :3]) < 0:
        m[:3, 0] = -u
    scene["light_" + L["name"]] = {
        "type": "rectangle", "to_world": T(m.tolist()),
        "emitter": {"type": "area", "radiance": {"type": "rgb", "value": [L["radiance"]] * 3}}}

t0 = time.time()
sc = mi.load_dict(scene)
t_load = time.time() - t0
# Passes keep the wavefront (pixels x samples) small enough for 7 GB of RAM.
per_pass = max(1, min(spp, (3_000_000 // (res * res)) or 1))
passes = (spp + per_pass - 1) // per_pass
acc = None
t0 = time.time()
for i in range(passes):
    img = mi.render(sc, spp=per_pass, seed=i)
    a = np.array(img, dtype=np.float64)
    acc = a if acc is None else acc + a
    if i == 0:
        t_first = time.time() - t0
acc /= passes
t_render = time.time() - t0
os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
name = "mitsuba_%s_%s" % (cam_name, mode)
np.save(os.path.join(HERE, "out", name + ".npy"), acc.astype(np.float32))
print(json.dumps({"engine": "mitsuba " + mi.__version__, "variant": mi.variant(), "camera": cam_name,
                  "mode": mode, "res": res, "spp": per_pass * passes, "max_depth": depth,
                  "load_s": round(t_load, 2), "first_pass_s": round(t_first, 2),
                  "render_s": round(t_render, 2),
                  "cpu_s": round(sum(__import__("os").times()[:2]), 1),
                  "load1": round(__import__("os").getloadavg()[0], 1), "out": name + ".npy"}))
