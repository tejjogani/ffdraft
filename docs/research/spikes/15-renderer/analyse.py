"""Display-space differences against the 2048-spp Mitsuba dispersive reference, and a gold colour probe."""
import numpy as np, os
from tonemap import display, box
def ssim(a, b):
    # Global-statistics SSIM on 8x8 blocks of luminance (no extra packages).
    la, lb = a.mean(axis=2), b.mean(axis=2); k = 8
    h = la.shape[0] // k * k
    A = la[:h, :h].reshape(h // k, k, h // k, k).transpose(0, 2, 1, 3).reshape(-1, k * k)
    B = lb[:h, :h].reshape(h // k, k, h // k, k).transpose(0, 2, 1, 3).reshape(-1, k * k)
    ma, mb = A.mean(1), B.mean(1); va, vb = A.var(1), B.var(1); cov = ((A - ma[:, None]) * (B - mb[:, None])).mean(1)
    c1, c2 = 0.01 ** 2, 0.03 ** 2
    return float((((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma ** 2 + mb ** 2 + c1) * (va + vb + c2))).mean())
for cam in ("hero", "macro"):
    ref = display(np.load("out/ref_%s_disp2048.npy" % cam))
    print("==", cam, "reference: mitsuba dispersive 2048 spp")
    for name in ("mitsuba_%s_disp", "mitsuba_%s_nodisp", "cycles_%s_disp", "cycles_%s_nodisp", "cycles_%s_disp_oidn", "own_%s_disp",
                 "own_%s_disp_oidn", "own_%s_nodisp", "wgsl_%s_disp", "luxcore_%s_disp", "luxcore_%s_caustic"):
        p = "out/" + name % cam + ".npy"
        if not os.path.exists(p): continue
        img = display(np.load(p))
        if img.shape != ref.shape: continue
        d1 = np.abs(img - ref).mean(); d4 = np.abs(box(img, 4) - box(ref, 4)).mean()
        print("%-26s mean abs diff: per pixel %.4f, 4x4 blocks %.4f, ssim(8x8 lum) %.3f" % (name % cam, d1, d4, ssim(img, ref)))
# Gold colour: mean linear RGB of a band patch in the hero view (lower band, lit), normalised to max 1.
for name in ("ref_hero_disp2048", "cycles_hero_disp", "own_hero_disp", "luxcore_hero_disp"):
    a = np.load("out/%s.npy" % name)[395:415, 250:290].reshape(-1, 3).mean(0)
    print("gold patch %-20s linear rgb %s  normalised %s" % (name, a.round(3), (a / a.max()).round(3)))
