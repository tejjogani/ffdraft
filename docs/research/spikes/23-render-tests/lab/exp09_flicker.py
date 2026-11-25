"""Exp 9: animation flicker. Hero ("ring") camera, 256 px full frame, 6 turntable frames, ring turned 2 degrees per frame
about its vertical axis, 32 samples. Fixed seed vs use_animated_seed; with Open Image Denoise and without."""
from metrics import *
H = {"cam": "hero", "res": 256, "border": None, "spp": 32}
run(dict(H, name="mask_hero", mask=True, spp=16, view="Standard", look="None"))
for den in (True, False):
    for mode in ("fixed", "anim"):
        for f in range(6):
            run(dict(H, name="fl_%s_%s_f%d" % ("d" if den else "n", mode, f), denoise=den, rot_deg=2.0 * f, frame=f + 1,
                     animated_seed=(mode == "anim"), seed=0))
# a static control: 6 frames with NO rotation and animated seed (pure noise/denoiser flicker), and fixed seed (should be identical)
for f in range(6):
    run(dict(H, name="fl_d_animstatic_f%d" % f, denoise=True, rot_deg=0.0, frame=f + 1, animated_seed=True))
_, _, g = masks("mask_hero")
# static background patches: ground corners far from the ring and its shadow
P = {"top-left 56x56": (slice(4, 60), slice(4, 60)), "top-right 56x56": (slice(4, 60), slice(196, 252)), "bottom-right 40x40": (slice(212, 252), slice(212, 252))}
for name, sl in P.items():
    assert g[sl].all(), name
def series(prefix, sl, kind):
    if kind == "lin":
        return np.stack([lum(lin("%s_f%d" % (prefix, f)))[sl] for f in range(6)])
    return np.stack([png("%s_f%d" % (prefix, f))[sl].astype(float).mean(-1) for f in range(6)])
def box(x, k=8):
    f, h, w = x.shape
    return x[:, :h // k * k, :w // k * k].reshape(f, h // k, k, w // k, k).mean((2, 4))
print("frame-to-frame change in static ground patches (display 8-bit units unless noted)")
for den, dl in (("d", "OIDN"), ("n", "no denoise")):
    for mode in ("fixed", "anim") + (("animstatic",) if den == "d" else ()):
        pre = "fl_%s_%s" % (den, mode)
        out = []
        for name, sl in P.items():
            S8 = series(pre, sl, "png"); SL = series(pre, sl, "lin")
            f2f = np.abs(np.diff(S8, axis=0)).mean()                     # mean abs change per pixel between consecutive frames
            f2fmax = np.abs(np.diff(S8, axis=0)).max()
            tstd = S8.std(axis=0).mean()                                  # per-pixel temporal std
            blk = box(S8).std(axis=0).mean()                              # 8x8 block means: low-frequency "boiling"
            pm = S8.mean((1, 2)).std()                                    # patch-mean brightness flicker
            spat = S8.std(axis=(1, 2)).mean()                             # spatial std inside a frame (grain)
            rel = (SL.std(axis=0) / SL.mean()).mean()
            out.append("%s: f2f mean %.3f max %.0f | temporal std/px %.3f | 8x8-block temporal std %.3f | patch-mean std %.3f | in-frame grain std %.3f | linear rel temporal std %.4f" % (
                name, f2f, f2fmax, tstd, blk, pm, spat, rel))
        print("%-11s %-10s\n    " % (dl, mode) + "\n    ".join(out))
print("render time per frame (s):", {k: round(np.mean([res("fl_%s_f%d" % (k, f))["render_s"] for f in range(6)]), 2) for k in ("d_fixed", "d_anim", "n_fixed", "n_anim")})
print("fixed seed, frame 0 vs frame 1 (ring moved 2 deg): whole-frame", fmt(compare("fl_d_fixed_f0", "fl_d_fixed_f1")))
print("animated seed, frame 0 vs frame 1:                 whole-frame", fmt(compare("fl_d_anim_f0", "fl_d_anim_f1")))
print("seed check: fixed-seed f0 == anim-seed f0 pixels?", res("fl_n_fixed_f0")["px_sha"] == res("fl_n_anim_f0")["px_sha"])
sidebyside(["fl_d_fixed_f0", "fl_d_fixed_f5", "fl_d_anim_f0", "fl_d_anim_f5", "fl_n_fixed_f0"], os.path.join(HERE, "exp09_flicker_frames.png"),
           ["fixed f0 OIDN", "fixed f5 OIDN", "anim f0 OIDN", "anim f5 OIDN", "f0 no denoise"], scale=2)
# amplified difference of consecutive frames (x16) to show the flicker pattern
from PIL import Image
def d(a, b):
    return Image.fromarray(np.clip(np.abs(png(a) - png(b)) * 16, 0, 255).astype(np.uint8))
sidebyside([d("fl_d_fixed_f0", "fl_d_fixed_f1"), d("fl_d_anim_f0", "fl_d_anim_f1"), d("fl_n_fixed_f0", "fl_n_fixed_f1"), d("fl_n_anim_f0", "fl_n_anim_f1")],
           os.path.join(HERE, "exp09_flicker_diff.png"), ["OIDN fixed |f0-f1| x16", "OIDN anim x16", "noisy fixed x16", "noisy anim x16"], scale=2)
