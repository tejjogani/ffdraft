"""Exp 8: denoiser and facets. Stone crop, workflow settings, seed 0 at 64 / 256 / 1024 samples, with Open Image Denoise
off and on, against a reference that is the mean of four 1024-sample renders (seeds 1-4, 4096 samples in all, no denoise).
Guide passes: albedo+normal (Blender default) vs none (RGB only); also 'follow reflections' off and prefilter NONE at 64."""
from metrics import *
from PIL import Image
for seed in (1, 2, 3, 4):
    run({"name": "wf_s%d_1024" % seed, "spp": 1024, "seed": seed})
ref = np.mean([lin("wf_s%d_1024" % k) for k in (1, 2, 3, 4)], axis=0).astype(np.float32)
np.save(os.path.join(OUT, "ref4096.npy"), ref)
refA = np.mean([lin("wf_s%d_1024" % k) for k in (1, 2)], axis=0); refB = np.mean([lin("wf_s%d_1024" % k) for k in (3, 4)], axis=0)
for spp in (64, 256, 1024):
    run({"name": "wf_s0_%d" % spp, "spp": spp})
    run({"name": "wfd_s0_%d" % spp, "spp": spp, "denoise": True})
    run({"name": "wfdrgb_s0_%d" % spp, "spp": spp, "denoise": True, "denoise_passes": "RGB"})
    if spp < 1024:
        run({"name": "wfdalb_s0_%d" % spp, "spp": spp, "denoise": True, "denoise_passes": "RGB_ALBEDO"})
run({"name": "wfdnofollow_s0_64", "spp": 64, "denoise": True, "follow_reflections": False})
run({"name": "wfdnofollow_s0_256", "spp": 256, "denoise": True, "follow_reflections": False})
run({"name": "wfdnopre_s0_64", "spp": 64, "denoise": True, "prefilter": "NONE"})
s, m, g = masks()
# One display transform for linear data in this script (reference has no Blender PNG): gain 0.45, soft shoulder, sRGB curve.
def disp(a):
    x = np.clip(a[..., :3] * 0.45, 0, None)
    x = np.where(x > 0.8, 0.8 + 0.2 * np.tanh((x - 0.8) / 0.2), x)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(np.maximum(x, 1e-9), 1 / 2.4) - 0.055)
R = disp(ref)
def grad(img):
    L = img.mean(-1); gy, gx = np.gradient(L); return np.hypot(gx, gy)
gR = grad(R)[s].mean()
def row(label, a):
    A = lin(a) if isinstance(a, str) else a
    D = disp(A)
    rel = float(np.sqrt(((A - ref)[s] ** 2).mean()) / ref[s].mean())
    d8 = float(np.abs(D - R)[s].mean() * 255)
    rm = float(np.sqrt(((D - R)[s] ** 2).mean()) * 255)
    ss_full, smap = structural_similarity(D, R, channel_axis=2, data_range=1.0, full=True)
    de = deltaE_ciede2000(rgb2lab(D), rgb2lab(R))[s].mean()
    print("%-34s stone: rel RMSE(linear) %.3f | display mean abs %.2f/255, RMSE %.2f/255 | SSIM(stone) %.3f | dE00 %.2f | edge energy vs ref %.2f | mean lum ratio %.3f" % (
        label, rel, d8, rm, smap.mean(-1)[s].mean(), de, grad(D)[s].mean() / gR, lum(A)[s].mean() / lum(ref)[s].mean()))
print("reference self-consistency: seeds 1+2 vs seeds 3+4 (2048 each):")
tmp = ref; ref_keep = ref
ref = refB; R = disp(ref); gR = grad(R)[s].mean(); row("  half A vs half B", refA)
ref = ref_keep; R = disp(ref); gR = grad(R)[s].mean()
for spp in (64, 256, 1024):
    row("%4d spp, no denoise" % spp, "wf_s0_%d" % spp)
    row("%4d spp, OIDN albedo+normal" % spp, "wfd_s0_%d" % spp)
    if spp < 1024:
        row("%4d spp, OIDN albedo only" % spp, "wfdalb_s0_%d" % spp)
    row("%4d spp, OIDN no guides (RGB)" % spp, "wfdrgb_s0_%d" % spp)
row("  64 spp, OIDN a+n, follow refl. off", "wfdnofollow_s0_64")
row(" 256 spp, OIDN a+n, follow refl. off", "wfdnofollow_s0_256")
row("  64 spp, OIDN a+n, prefilter NONE", "wfdnopre_s0_64")
for spp in (64, 256, 1024):
    print("time %4d spp: no denoise %.1fs, OIDN a+n %.1fs, OIDN rgb %.1fs" % (spp, res("wf_s0_%d" % spp)["render_s"],
          res("wfd_s0_%d" % spp)["render_s"], res("wfdrgb_s0_%d" % spp)["render_s"]))
def im(a):
    A = lin(a) if isinstance(a, str) else a
    return Image.fromarray((disp(A) * 255 + 0.5).astype(np.uint8))
im(ref).save(os.path.join(OUT, "ref4096_disp.png"))
sidebyside([im("wf_s0_64"), im("wfd_s0_64"), im("wfdrgb_s0_64"), im(ref)], os.path.join(HERE, "exp08_denoise_64.png"),
           ["64 spp noisy", "64 spp OIDN albedo+normal", "64 spp OIDN no guides", "reference 4x1024"], scale=2)
sidebyside([im("wf_s0_256"), im("wfd_s0_256"), im("wfdrgb_s0_256"), im(ref)], os.path.join(HERE, "exp08_denoise_256.png"),
           ["256 spp noisy", "256 spp OIDN albedo+normal", "256 spp OIDN no guides", "reference 4x1024"], scale=2)
sidebyside([im("wf_s0_1024"), im("wfd_s0_1024"), im("wfdrgb_s0_1024"), im(ref)], os.path.join(HERE, "exp08_denoise_1024.png"),
           ["1024 spp noisy", "1024 spp OIDN albedo+normal", "1024 spp OIDN no guides", "reference 4x1024"], scale=2)
# zoomed crop of the table / star facets (x5)
def crop(a, box=(96, 60, 192, 140)):
    return im(a).crop(box)
sidebyside([crop("wf_s0_64"), crop("wfd_s0_64"), crop("wfdrgb_s0_64"), crop("wfd_s0_256"), crop("wfd_s0_1024"), crop(ref)],
           os.path.join(HERE, "exp08_denoise_zoom.png"), ["64 noisy", "64 OIDN a+n", "64 OIDN rgb", "256 OIDN a+n", "1024 OIDN a+n", "reference"], scale=4)
