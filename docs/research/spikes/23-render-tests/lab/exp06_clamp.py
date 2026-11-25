"""Exp 6: indirect clamp (20 / 10 / 0=off) and filter glossy (0.2 / 0). Stone crop, 256 spp, seeds 0 and 1, no denoise.
Also clamp 20 vs 0 at 1024 spp for the bias in mean brightness."""
from metrics import *
V = {"wf (clamp20, blur0.2)": ("wf", {}), "clamp 10": ("c10", {"clamp_indirect": 10.0}), "clamp 0 (off)": ("c0", {"clamp_indirect": 0.0}),
     "blur_glossy 0": ("b0", {"blur_glossy": 0.0}), "clamp 0 + blur 0": ("c0b0", {"clamp_indirect": 0.0, "blur_glossy": 0.0}),
     "wf + caustics on": ("caus", {"caustics": True})}
for label, (tag, d) in V.items():
    for seed in (0, 1):
        run(dict(d, name="%s_s%d_256" % (tag, seed), spp=256, seed=seed))
run({"name": "wf_s0_1024", "spp": 1024, "seed": 0})
run({"name": "c0_s0_1024", "spp": 1024, "seed": 0, "clamp_indirect": 0.0})
s, m, g = masks()
print("256 spp. Linear-light figures in the stone; noise = RMS(seed0-seed1)/sqrt(2) relative to mean; fireflies outside the stone.")
for label, (tag, d) in V.items():
    a, b = "%s_s0_256" % tag, "%s_s1_256" % tag
    st = [stone_stats(n, s) for n in (a, b)]
    av = lambda k: (st[0][k] + st[1][k]) / 2
    A, B = lin(a), lin(b)
    noise = lambda msk: float(np.sqrt((((A - B)[msk]) ** 2).mean() / 2) / A[msk].mean())
    notstone = m | g
    ff = [fireflies(n, notstone)[0] for n in (a, b)]
    ffs = [fireflies(n, s)[0] for n in (a, b)]
    print("%-26s stone mean %.4f | p99 %.2f | p99.9 %.2f / %.2f | max lum %.1f / %.1f | coloured px %.3f, their saturation %.3f | display chroma mean %.2f | clipped(>=250) %.3f | noise stone %.3f metal %.3f ground %.4f | fireflies off-stone %d / %d, in-stone %d / %d | %.1fs" % (
        label, av("mean_lum"), av("p99"), st[0]["p999"], st[1]["p999"], st[0]["max_lum"], st[1]["max_lum"], av("frac_coloured"), av("sat_coloured"),
        av("chroma_mean"), av("disp_frac_clipped"), noise(s), noise(m), noise(g), ff[0], ff[1], ffs[0], ffs[1], res(a)["render_s"]))
for n in ("wf_s0_1024", "c0_s0_1024"):
    st = stone_stats(n, s); A = lin(n)
    print("1024 spp %-12s stone mean %.4f  p99 %.2f  p99.9 %.2f  max %.1f  metal mean %.4f  ground mean %.4f  fireflies off-stone %d" % (
        n, st["mean_lum"], st["p99"], st["p999"], st["max_lum"], lum(A)[m].mean(), lum(A)[g].mean(), fireflies(n, m | g)[0]))
print("clamp 20 vs clamp 0 at 1024 spp, stone:", fmt(compare("wf_s0_1024", "c0_s0_1024", s)))
sidebyside(["wf_s0_256", "c10_s0_256", "c0_s0_256", "b0_s0_256", "caus_s0_256"], os.path.join(HERE, "exp06_clamp_side.png"),
           ["wf clamp20 blur.2", "clamp 10", "clamp off", "blur_glossy 0", "wf + caustics on"], scale=2)

# Display-space view of the same thing (8-bit PNG, AgX Base Contrast, exposure -1.152): seed 0 vs seed 1 per variant,
# and how many stone pixels reach display white.
print("\ndisplay space, 256 spp")
for label, (tag, d) in V.items():
    a, b = "%s_s0_256" % tag, "%s_s1_256" % tag
    c = compare(a, b, s)
    P = png(a)[s]
    print("%-26s seed0 vs seed1 in stone: %s | stone px with all channels >=250: %d, >=240: %d, max 8-bit value %d" % (
        label, fmt(c, ("d8_max", "d8_mean", "d8_rmse", "dE00_mean")), int((P.min(1) >= 250).sum()), int((P.min(1) >= 240).sum()), int(P.max())))
for x in ("c10", "c0", "b0", "caus"):
    print("wf vs %-5s same seed, stone: %s" % (x, fmt(compare("wf_s0_256", "%s_s0_256" % x, s), ("px_equal", "lin_mean", "d8_max", "d8_mean", "d8_rmse", "dE00_mean"))))
    print("wf vs %-5s same seed, ground: %s" % (x, fmt(compare("wf_s0_256", "%s_s0_256" % x, g), ("px_equal", "lin_mean", "d8_max", "d8_mean", "d8_rmse", "dE00_mean"))))
# How much of the stone's light sits in the pixels brighter than the clamp level?
for n in ("c0_s0_1024", "wf_s0_1024"):
    L = lum(lin(n))[s]
    print("%s: stone px with lum > 20: %d (%.2f%%) carrying %.1f%% of the stone's summed luminance; > 100: %d" % (
        n, int((L > 20).sum()), 100 * (L > 20).mean(), 100 * L[L > 20].sum() / L.sum(), int((L > 100).sum())))
Lc, Lw = lum(lin("c0_s0_1024"))[s], lum(lin("wf_s0_1024"))[s]
body = Lc <= 20
print("mean luminance of the stone pixels that are below 20 in the unclamped render: clamp off %.4f, clamp 20 %.4f (ratio %.3f)" % (Lc[body].mean(), Lw[body].mean(), Lw[body].mean() / Lc[body].mean()))
