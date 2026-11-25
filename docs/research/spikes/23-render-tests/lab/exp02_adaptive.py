"""Exp 2: repeatability with adaptive sampling (threshold 0.01, the workflow's value) and with a time limit.
Stone crop. Each variant twice in fresh processes; adaptive also 1 thread vs 2, and with the denoiser on."""
from metrics import *
A = {"spp": 512, "adaptive": True, "adaptive_threshold": 0.01}
run(dict(A, name="e2_ad_a")); run(dict(A, name="e2_ad_b")); run(dict(A, name="e2_ad_t1", threads=1))
run(dict(A, name="e2_add_a", denoise=True)); run(dict(A, name="e2_add_b", denoise=True))
run({"name": "e2_fix512", "spp": 512})
T = {"spp": 4096, "time_limit": 10.0}
run(dict(T, name="e2_tl_a")); run(dict(T, name="e2_tl_b")); run(dict(T, name="e2_tl_c", threads=1))
TA = dict(A, time_limit=10.0)
run(dict(TA, name="e2_tla_a")); run(dict(TA, name="e2_tla_b"))
s, m, g = masks()
def row(a, b, what):
    ra, rb = res(a), res(b)
    print("%-52s px sha equal=%-5s | %s | t=%.1fs / %.1fs" % (what, ra["px_sha"] == rb["px_sha"],
          fmt(compare(a, b), ("lin_max", "lin_mean", "d8_max", "d8_mean", "d8_rmse", "d8_frac_gt2", "ssim", "dE00_mean")), ra["render_s"], rb["render_s"]))
row("e2_ad_a", "e2_ad_b", "adaptive 0.01 (max 512), run a vs run b")
row("e2_ad_a", "e2_ad_t1", "adaptive 0.01, 2 threads vs 1 thread")
row("e2_add_a", "e2_add_b", "adaptive 0.01 + OIDN, run a vs run b")
row("e2_ad_a", "e2_fix512", "adaptive 0.01 (max 512) vs fixed 512")
row("e2_tl_a", "e2_tl_b", "time limit 10 s (max 4096), run a vs run b")
row("e2_tl_a", "e2_tl_c", "time limit 10 s, 2 threads vs 1 thread")
row("e2_tla_a", "e2_tla_b", "adaptive 0.01 + time limit 10 s, run a vs b")
# time-limit runs: which ones happen to match? (Cycles stops at whatever sample it has reached when the clock runs out)
for k in "de":
    run(dict(T, name="e2_tl_%s" % k))
print("time-limit runs, pixel hashes:", {k: res("e2_tl_%s" % k)["px_sha"] for k in "abcde"})
print("adaptive+time-limit runs, pixel hashes:", {k: res("e2_tla_%s" % k)["px_sha"] for k in "ab"})
print("cpu-seconds: adaptive(max 512) %.1f vs fixed 512 %.1f" % (res("e2_ad_a")["cpu_s"], res("e2_fix512")["cpu_s"]))
