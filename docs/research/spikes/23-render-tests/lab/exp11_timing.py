"""Exp 11: time per sample. Macro ("stone") camera, 512 x 512 full frame, workflow settings, CPU, 2 threads, no denoise.
Dispersion on (scale 0.36 at Abbe 20) and off, at 32 and 96 samples, so the fixed start-up cost can be separated."""
from metrics import *
F = {"cam": "macro", "res": 512, "border": None}
for tag, d in (("disp", {}), ("nodisp", {"disp_scale": 0.0})):
    for spp in (32, 96):
        run(dict(F, name="tm_%s_%d" % (tag, spp), spp=spp, **d))
run(dict(F, name="tm_disp_96_oidn", spp=96, denoise=True))
run(dict(F, name="tm_disp_96_d64", spp=96, max_bounces=64, glossy=64, transmission=64))
run(dict(F, name="tm_disp_96_g32", spp=96, glossy=32))
run(dict(F, name="tm_disp_96_t1", spp=96, threads=1))
for tag in ("disp", "nodisp"):
    a, b = res("tm_%s_32" % tag), res("tm_%s_96" % tag)
    print("%-7s 32 spp: wall %.1fs cpu %.1fs (load %.1f) | 96 spp: wall %.1fs cpu %.1fs (load %.1f) | marginal per sample: wall %.3fs, cpu %.3fs | fixed overhead ~%.1fs wall" % (
        tag, a["render_s"], a["cpu_s"], a["load1"], b["render_s"], b["cpu_s"], b["load1"], (b["render_s"] - a["render_s"]) / 64,
        (b["cpu_s"] - a["cpu_s"]) / 64, a["render_s"] - 32 * (b["render_s"] - a["render_s"]) / 64))
for n in ("tm_disp_96_oidn", "tm_disp_96_d64", "tm_disp_96_g32", "tm_disp_96_t1"):
    r = res(n); print("%-18s wall %.1fs cpu %.1fs load %.1f -> cpu per sample %.3fs" % (n, r["render_s"], r["cpu_s"], r["load1"], r["cpu_s"] / 96))
print("\nall renders of the lab: cpu-seconds per sample per megapixel")
import json
tot = 0
for line in open(os.path.join(HERE, "results.jsonl")):
    d = json.loads(line); tot += d["cpu_s"]
print("total CPU-seconds rendered in the lab: %.0f (= %.1f min on 2 cores)" % (tot, tot / 120))
