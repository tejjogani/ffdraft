"""Exp 1: repeatability at fixed samples (seed 0, adaptive off, no time limit). Stone crop, 64 spp.
Compares: same process twice, fresh process, 1 thread vs 2 threads; each with the denoiser off and on."""
from metrics import *
B = {"spp": 64}
for tag, extra in (("n", {}), ("d", {"denoise": True})):
    run([dict(B, name="e1%s_p1a" % tag, **extra), dict(B, name="e1%s_p1b" % tag, **extra)])   # same process, twice
    run(dict(B, name="e1%s_p2" % tag, **extra))                                               # fresh process
    run(dict(B, name="e1%s_t1" % tag, threads=1, **extra))                                    # 1 thread
    run(dict(B, name="e1%s_p3" % tag, **extra))                                               # third fresh process
for tag in ("n", "d"):
    print("== denoiser", "off" if tag == "n" else "on (Open Image Denoise)")
    for a, b, what in (("p1a", "p1b", "same process, 1st vs 2nd render"), ("p1a", "p2", "process 1 vs fresh process 2"),
                       ("p2", "p3", "fresh process 2 vs fresh process 3"), ("p2", "t1", "2 threads vs 1 thread")):
        na, nb = "e1%s_%s" % (tag, a), "e1%s_%s" % (tag, b)
        ra, rb = res(na), res(nb)
        c = compare(na, nb)
        print("%-36s float px sha equal=%s  EXR file sha equal=%s  PNG file sha equal=%s | %s | t=%.1fs/%.1fs" % (
            what, ra["px_sha"] == rb["px_sha"], ra["exr_sha"] == rb["exr_sha"], ra["png_sha"] == rb["png_sha"],
            fmt(c, ("lin_max", "lin_mean", "d8_max", "d8_mean")), ra["render_s"], rb["render_s"]))
c = compare("e1n_p2", "e1d_p2")
print("denoise on vs off (64 spp), for scale:", fmt(c))
