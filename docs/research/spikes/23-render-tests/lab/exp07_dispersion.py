"""Exp 7: dispersion. Principled BSDF 'Transmission Dispersion Scale' / 'Transmission Dispersion Abbe Number' in bpy 5.3.
Stone crop, 256 spp, seeds 0 and 1, no denoise, workflow settings otherwise."""
from metrics import *
from skimage.color import rgb2lab
V = {"off (scale 0)": ("d0", {"disp_scale": 0.0}),
     "scale 0.36, Abbe 20 (wf as read)": ("wf", {}),
     "scale 1.0, Abbe 55.3 (diamond)": ("dphys", {"disp_scale": 1.0, "abbe": 55.3}),
     "scale 0.36, Abbe 55.3": ("d36a55", {"disp_scale": 0.36, "abbe": 55.3}),
     "scale 1.0, Abbe 20 (node default Abbe)": ("d1a20", {"disp_scale": 1.0, "abbe": 20.0})}
for label, (tag, d) in V.items():
    for seed in (0, 1):
        run(dict(d, name="%s_s%d_256" % (tag, seed), spp=256, seed=seed))
run({"name": "d3617_s0_256", "spp": 256, "seed": 0, "disp_scale": 0.3617})     # equivalence check only, one seed
s, m, g = masks()
def lab(n):
    return rgb2lab(png(n).astype(float) / 255.0)
for label, (tag, d) in V.items():
    a, b = "%s_s0_256" % tag, "%s_s1_256" % tag
    la, lb = lab(a), lab(b)
    raw = (np.hypot(la[..., 1], la[..., 2])[s].mean() + np.hypot(lb[..., 1], lb[..., 2])[s].mean()) / 2
    sig = float(np.sqrt(max(0.0, (la[..., 1] * lb[..., 1] + la[..., 2] * lb[..., 2])[s].mean())))   # cross-seed: noise cancels
    st = [stone_stats(n, s) for n in (a, b)]
    A, B = lin(a), lin(b)
    noise = float(np.sqrt((((A - B)[s]) ** 2).mean() / 2) / A[s].mean())
    cnoise = float(np.sqrt((((la - lb)[..., 1:][s]) ** 2).sum(-1).mean() / 2))
    print("%-40s stone mean lum %.4f | display chroma: raw mean %.2f, cross-seed RMS (signal) %.2f, p99 %.1f | coloured px %.3f sat %.3f | noise: rel RMS %.3f, chroma-noise RMS %.2f | render %.1fs / %.1fs cpu %.1f" % (
        label, (st[0]["mean_lum"] + st[1]["mean_lum"]) / 2, raw, sig, (st[0]["chroma_p99"] + st[1]["chroma_p99"]) / 2,
        (st[0]["frac_coloured"] + st[1]["frac_coloured"]) / 2, (st[0]["sat_coloured"] + st[1]["sat_coloured"]) / 2,
        noise, cnoise, res(a)["render_s"], res(b)["render_s"], res(a)["cpu_s"]))
print("scale 0.3617/Abbe 20 vs scale 1.0/Abbe 55.3, same seed:", fmt(compare("d3617_s0_256", "dphys_s0_256", s)))
print("scale 0.36/Abbe 20 vs scale 1.0/Abbe 55.3, same seed:", fmt(compare("wf_s0_256", "dphys_s0_256", s)))
print("for scale, seed0 vs seed1 of scale 0.36/Abbe 20:   ", fmt(compare("wf_s0_256", "wf_s1_256", s)))
print("off vs scale 0.36/Abbe 20, same seed:               ", fmt(compare("d0_s0_256", "wf_s0_256", s)))
print("scale 0.36/Abbe 55.3 vs off, same seed:             ", fmt(compare("d36a55_s0_256", "d0_s0_256", s)))
sidebyside(["d0_s0_256", "d36a55_s0_256", "wf_s0_256", "dphys_s0_256", "d1a20_s0_256"], os.path.join(HERE, "exp07_dispersion_side.png"),
           ["off", "0.36 @ Abbe 55.3", "0.36 @ Abbe 20 (wf)", "1.0 @ Abbe 55.3", "1.0 @ Abbe 20"], scale=2)
