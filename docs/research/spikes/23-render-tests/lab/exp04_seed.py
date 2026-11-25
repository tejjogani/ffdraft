"""Exp 4: seed sensitivity. Workflow settings, stone crop, fixed samples; seed 0 vs seed 1 at 64, 256, 1024 samples,
without the denoiser and with it (Open Image Denoise, albedo+normal guides)."""
from metrics import *
for spp in (64, 256, 1024):
    for seed in (0, 1):
        run({"name": "wf_s%d_%d" % (seed, spp), "spp": spp, "seed": seed})
        if spp < 1024 or seed == 0:      # denoised seed 1 at 1024 was left out to save machine time
            run({"name": "wfd_s%d_%d" % (seed, spp), "spp": spp, "seed": seed, "denoise": True})
s, m, g = masks()
K = ("lin_rel_rmse", "d8_max", "d8_mean", "d8_rmse", "d8_frac_gt2", "ssim", "dE00_mean", "dE00_p99")
for pre, label in (("wf", "no denoise"), ("wfd", "OIDN")):
    for spp in (64, 256, 1024):
        if pre == "wfd" and spp == 1024:
            continue
        a, b = "%s_s0_%d" % (pre, spp), "%s_s1_%d" % (pre, spp)
        print("%-10s %4d spp seed0 vs seed1 | whole crop: %s" % (label, spp, fmt(compare(a, b), K)))
        print("%-10s %4d spp                | stone only: %s" % ("", spp, fmt(compare(a, b, s), K)))
        print("%-10s %4d spp                | metal only: %s" % ("", spp, fmt(compare(a, b, m), K)))
        print("%-10s %4d spp                | ground only: %s | render %.1fs" % ("", spp, fmt(compare(a, b, g), K), res(a)["render_s"]))
