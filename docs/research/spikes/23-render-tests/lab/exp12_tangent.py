"""Exp 12 (added at the coordinator's request): do meshes that need UV tangents (MikkTSpace) break repeatability
when more than one thread runs? Hero camera, 256 px, 32 spp, no denoise. The ring metal has 20,224 triangles (> 10,000).
Material A: procedural noise -> tangent-space Normal Map node (UV map 'UVMap').  Material B: anisotropic gold with a
Tangent node set to the UV map. Each: 4 fresh processes with 2 threads, 2 renders in one process with 2 threads,
3 fresh processes with 1 thread."""
from metrics import *
H = {"cam": "hero", "res": 256, "border": None, "spp": 32}
for mat in ("normalmap", "aniso"):
    for k in range(4):
        run(dict(H, name="tan_%s_t2_%d" % (mat, k), tangent_test=mat, threads=2))
    run([dict(H, name="tan_%s_t2_same%d" % (mat, k), tangent_test=mat, threads=2) for k in range(2)])
    for k in range(3):
        run(dict(H, name="tan_%s_t1_%d" % (mat, k), tangent_test=mat, threads=1))
run(dict(H, name="tan_none_t2_0")); run(dict(H, name="tan_none_t2_1"))
for mat in ("normalmap", "aniso"):
    names = ["tan_%s_t2_%d" % (mat, k) for k in range(4)] + ["tan_%s_t2_same%d" % (mat, k) for k in range(2)] + ["tan_%s_t1_%d" % (mat, k) for k in range(3)]
    hs = {n: res(n)["px_sha"] for n in names}
    print(mat, ": 2-thread fresh x4 hashes", sorted({hs[n] for n in names[:4]}), "| same process x2", sorted({hs[n] for n in names[4:6]}),
          "| 1-thread fresh x3", sorted({hs[n] for n in names[6:]}))
    print("   all nine pixel buffers identical:", len(set(hs.values())) == 1)
    if len(set(hs.values())) > 1:
        base = names[0]
        for n in names[1:]:
            if hs[n] != hs[base]:
                print("   ", base, "vs", n, fmt(compare(base, n)))
print("control (plain gold, no tangents) 2 threads x2 identical:", res("tan_none_t2_0")["px_sha"] == res("tan_none_t2_1")["px_sha"])
print("normal-mapped vs plain gold (to show the material took effect):", fmt(compare("tan_normalmap_t2_0", "tan_none_t2_0")))
print("anisotropic vs plain gold:", fmt(compare("tan_aniso_t2_0", "tan_none_t2_0")))

# More repeats to estimate how often it happens: 10 more fresh 2-thread runs and 5 more 1-thread runs per material.
print("\nrepeat counts")
for mat in ("normalmap", "aniso"):
    for k in range(4, 14):
        run(dict(H, name="tan_%s_t2_%d" % (mat, k), tangent_test=mat, threads=2))
    for k in range(3, 8):
        run(dict(H, name="tan_%s_t1_%d" % (mat, k), tangent_test=mat, threads=1))
    from collections import Counter
    t2 = ["tan_%s_t2_%d" % (mat, k) for k in range(14)] + ["tan_%s_t2_same%d" % (mat, k) for k in range(2)]
    t1 = ["tan_%s_t1_%d" % (mat, k) for k in range(8)]
    c2, c1 = Counter(res(n)["px_sha"] for n in t2), Counter(res(n)["px_sha"] for n in t1)
    print(mat, "2 threads: %d renders ->" % len(t2), dict(c2), "| 1 thread: %d renders ->" % len(t1), dict(c1))
    common = c2.most_common(1)[0][0]
    for n in t2:
        if res(n)["px_sha"] != common:
            A, B = lin(n), lin(t2[0] if res(t2[0])["px_sha"] == common else t1[0])
            d = np.abs(A - B)
            print("   odd one out: %s  pixels differing %d of %d, max abs diff %.3g (relative %.3g), 8-bit PNG pixels equal: %s" % (
                n, int((d.max(-1) > 0).sum()), d.shape[0] * d.shape[1], d.max(), (d / np.maximum(np.abs(B), 1e-9)).max(), np.array_equal(png(n), png(t2[1]))))
