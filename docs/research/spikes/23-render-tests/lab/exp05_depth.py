"""Exp 5: ray depth. Stone crop, seed 0, fixed samples, no denoise, everything else the workflow's.
(a) total 32 / glossy 16 / transmission 32 (the workflow)   (b) 32/32/32   (c) 16/16/16   (d) 64/64/64
plus a 64-spp sweep that shows which limit ends a path inside the stone."""
from metrics import *
from PIL import Image
D = lambda t, gl, tr: {"max_bounces": t, "glossy": gl, "transmission": tr}
HI = 1024
main = {"a": D(32, 16, 32), "b": D(32, 32, 32), "c": D(16, 16, 16), "d": D(64, 64, 64)}
for k, d in main.items():
    if k == "a":
        run({"name": "wf_s0_%d" % HI, "spp": HI, "seed": 0})          # same render as exp 4
    else:
        run(dict(d, name="dp_%s_%d" % (k, HI), spp=HI))
N = {"a": "wf_s0_%d" % HI, "b": "dp_b_%d" % HI, "c": "dp_c_%d" % HI, "d": "dp_d_%d" % HI}
sweep = {"t32_g2_tr32": D(32, 2, 32), "t32_g4_tr32": D(32, 4, 32), "t32_g8_tr32": D(32, 8, 32), "t32_g16_tr32": D(32, 16, 32),
         "t32_g32_tr32": D(32, 32, 32), "t4_g4_tr4": D(4, 4, 4), "t8_g8_tr8": D(8, 8, 8), "t16_g16_tr16": D(16, 16, 16),
         "t32_g32_tr4": D(32, 32, 4), "t32_g32_tr8": D(32, 32, 8), "t32_g32_tr16": D(32, 32, 16), "t8_g32_tr32": D(8, 32, 32),
         "t64_g64_tr64": D(64, 64, 64), "t128_g128_tr128": D(128, 128, 128), "t64_g16_tr64": D(64, 16, 64)}
for k, d in sweep.items():
    run(dict(d, name="dps_%s" % k, spp=64))
s, m, g = masks()
print("== main test, %d spp, seed 0" % HI)
ref = stone_stats(N["d"], s)["mean_lum"]
for k in "abcd":
    st = stone_stats(N[k], s); r = res(N[k])
    A = lin(N[k])
    print("(%s) total/glossy/transmission=%s  stone mean lum %.4f (%.2f%% of d)  median %.4f  p99.9 %.2f  metal mean %.4f  ground mean %.4f  render %.1fs cpu %.1fs  px_sha %s" % (
        k, "/".join(str(main[k][x]) for x in ("max_bounces", "glossy", "transmission")), st["mean_lum"], 100 * st["mean_lum"] / ref,
        st["median_lum"], st["p999"], lum(A)[m].mean(), lum(A)[g].mean(), r["render_s"], r["cpu_s"], r["px_sha"]))
for x, y in (("a", "c"), ("a", "b"), ("c", "b"), ("b", "d"), ("a", "d")):
    c = compare(N[x], N[y], s)
    A, B = lum(lin(N[x]))[s], lum(lin(N[y]))[s]
    print("(%s) vs (%s) in the stone: %s  frac px differing >1%%: %.3f  frac darker by >10%%: %.3f" % (
        x, y, fmt(c, ("px_equal", "lin_max", "lin_mean", "d8_max", "d8_mean", "d8_rmse", "ssim", "dE00_mean")),
        (np.abs(A - B) > 0.01 * np.maximum(B, 1e-3)).mean(), (A < 0.9 * B).mean()))
print("== sweep, 64 spp, seed 0: stone mean luminance")
for k in sweep:
    st = stone_stats("dps_" + k, s); r = res("dps_" + k)
    print("%-18s stone mean lum %.4f  median %.4f  render %.1fs  px_sha %s" % (k, st["mean_lum"], st["median_lum"], r["render_s"], r["px_sha"]))
# side-by-side and difference images (x3 nearest-neighbour)
def diffimg(x, y, gain=4):
    d = np.abs(png(N[x]) - png(N[y])).astype(float) * gain
    return Image.fromarray(np.clip(d, 0, 255).astype(np.uint8))
sidebyside([N[k] for k in "acbd"], os.path.join(HERE, "exp05_depth_side.png"),
           ["(a) 32/g16/t32 workflow", "(c) 16/16/16", "(b) 32/32/32", "(d) 64/64/64"], scale=2)
sidebyside([diffimg("a", "c"), diffimg("a", "b"), diffimg("b", "d")], os.path.join(HERE, "exp05_depth_diff.png"),
           ["|a-c| x4", "|a-b| x4", "|b-d| x4"], scale=2)
