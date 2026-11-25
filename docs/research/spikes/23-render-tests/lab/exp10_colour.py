"""Exp 10: colour management on a white background. Hero ("ring") camera, 256 px, 128 samples + OIDN.
(A) film transparent + shadow-catcher ground, RGBA PNG composited over #FFFFFF with Pillow (the workflow's method);
(B) opaque film, white diffuse ground (albedo 0.8 as in the spike scene, and albedo 1.0);
(C) probe: an emissive plane of known scene-linear grey, to read what each view transform does to 'white'.
Views tested: Standard, AgX (None / Base Contrast / Medium High Contrast / Punchy), Filmic, Khronos PBR Neutral."""
from metrics import *
from PIL import Image
H = {"cam": "hero", "res": 256, "border": None, "spp": 128, "denoise": True}
VIEWS = [("Standard", "None"), ("AgX", "None"), ("AgX", "AgX - Base Contrast"), ("AgX", "AgX - Medium High Contrast"), ("AgX", "AgX - Punchy"),
         ("Filmic", "None"), ("Filmic", "Medium High Contrast"), ("Khronos PBR Neutral", "None")]
def tag(v, l):
    return (v + "_" + l).replace(" ", "").replace("-", "")
run(dict(H, name="mask_hero", mask=True, spp=16, denoise=False, view="Standard", look="None"))
EXPS = (-1.152, 0.0)
for ex in EXPS:
    et = "e0" if ex == 0 else "em1"
    run([dict(H, name="cmA_%s_%s" % (et, tag(v, l)), view=v, look=l, exposure=ex, film_transparent=True, shadow_catcher=True) for v, l in VIEWS])
    run([dict(H, name="cmB_%s_%s" % (et, tag(v, l)), view=v, look=l, exposure=ex) for v, l in VIEWS])
run([dict(H, name="cmB1_e0_%s" % tag(v, l), view=v, look=l, exposure=0.0, ground_albedo=1.0) for v, l in VIEWS])
GREYS = (0.18, 0.5, 0.8, 1.0, 1.5, 2.0, 4.0, 8.0, 16.0, 32.0)
run([dict(name="cmC_%s_%g" % (tag(v, l), gv), cam="hero", res=16, border=None, spp=1, mask=True, ground_emit=gv, view=v, look=l, exposure=0.0)
     for v, l in VIEWS for gv in GREYS])
_, metal, ground = masks("mask_hero")
from scipy.ndimage import binary_erosion
gold = binary_erosion(metal, iterations=2)
band = gold.copy(); band[:150] = False          # lower band of the ring (rows 150+): broad lit gold away from the stone
print("gold px", gold.sum(), "lower-band px", band.sum())
print("(C) probe: 8-bit value written for a scene-linear grey, exposure 0 (rows: view / look)")
print("%-38s" % "" + " ".join("%6g" % g for g in GREYS))
for v, l in VIEWS:
    vals = [int(png("cmC_%s_%g" % (tag(v, l), gv))[8, 8, 0]) for gv in GREYS]
    print("%-38s" % (v + " / " + l) + " ".join("%6d" % x for x in vals))
for ex in EXPS:
    et = "e0" if ex == 0 else "em1"
    print("\n== view exposure %+.3f stops" % ex)
    for v, l in VIEWS:
        n = "cmA_%s_%s" % (et, tag(v, l))
        im = Image.open(os.path.join(OUT, n + ".png")).convert("RGBA")
        rgba = np.asarray(im).astype(float)
        a = rgba[..., 3:4] / 255.0
        comp = np.round(rgba[..., :3] * a + 255.0 * (1 - a)).astype(np.uint8)      # straight-alpha PNG over white
        Image.fromarray(comp).save(os.path.join(OUT, n + "_white.png"))
        corner = comp[4:60, 4:60].reshape(-1, 3)
        bg = ground
        exact = (comp[bg] == 255).all(-1).mean()
        alpha0 = (rgba[..., 3][bg] == 0).mean()
        B = png("cmB_%s_%s" % (et, tag(v, l)))
        print("%-36s (A) over white: corner patch min %s mean %s; ground px exactly 255: %.1f%% (alpha==0: %.1f%%); gold mean sRGB %s, lower band %s | (B) albedo-0.8 ground corner %s gold lower band %s" % (
            v + " / " + l, corner.min(0).tolist(), np.round(corner.mean(0), 1).tolist(), 100 * exact, 100 * alpha0,
            np.round(comp[gold].mean(0), 1).tolist(), np.round(comp[band].mean(0), 1).tolist(),
            np.round(B[4:60, 4:60].reshape(-1, 3).mean(0), 1).tolist(), np.round(B[band].mean(0), 1).tolist()))
print("\n(B1) opaque film, ground albedo 1.0, exposure 0: ground corner 8-bit mean / max, and scene-linear value there")
for v, l in VIEWS:
    n = "cmB1_e0_%s" % tag(v, l)
    B = png(n)[4:60, 4:60].reshape(-1, 3)
    print("%-36s corner mean %s max %s  linear %.3f" % (v + " / " + l, np.round(B.mean(0), 1).tolist(), B.max(0).tolist(), lin(n)[4:60, 4:60].mean()))
A = lin("cmA_em1_" + tag("Standard", "None"))
print("\nlinear (premultiplied) gold mean RGB, lower band:", np.round(A[band][:, :3].mean(0), 4).tolist(), "alpha mean in gold", A[band][:, 3].mean())
print("identical linear pixels under every view? ", len({res("cmA_em1_" + tag(v, l))["px_sha"] for v, l in VIEWS}) == 1)
def hue_chroma(rgb):
    lab = rgb2lab(np.array(rgb, float)[None, None] / 255.0)[0, 0]
    return "L %.1f C %.1f h %.0f" % (lab[0], np.hypot(lab[1], lab[2]), np.degrees(np.arctan2(lab[2], lab[1])) % 360)
for ex in EXPS:
    et = "e0" if ex == 0 else "em1"
    for v, l in VIEWS:
        comp = np.asarray(Image.open(os.path.join(OUT, "cmA_%s_%s_white.png" % (et, tag(v, l)))).convert("RGB"))
        print("exposure %+.2f %-36s gold lower band Lab: %s | clipped gold px (any channel 255): %.1f%%" % (ex, v + " / " + l, hue_chroma(comp[band].mean(0)), 100 * (comp[gold].max(-1) == 255).mean()))
sidebyside(["cmA_em1_%s_white" % tag(v, l) for v, l in VIEWS], os.path.join(HERE, "exp10_colour_em1.png"), [v[:8] + "/" + l[-14:] for v, l in VIEWS])
sidebyside(["cmA_e0_%s_white" % tag(v, l) for v, l in VIEWS], os.path.join(HERE, "exp10_colour_e0.png"), [v[:8] + "/" + l[-14:] for v, l in VIEWS])
