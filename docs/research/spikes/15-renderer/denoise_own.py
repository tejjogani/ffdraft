"""OIDN (Apache-2.0) on the own tracer's output, colour only. usage: denoise_own.py out/x.npy -> out/x_oidn.npy"""
import sys, time, os
import numpy as np
import pyoidn
for p in sys.argv[1:]:
    a = np.ascontiguousarray(np.clip(np.load(p), 0, None).astype(np.float32))
    t0 = time.time(); c0 = sum(os.times()[:2])
    out = pyoidn.denoise(a, hdr=True, quality="high")
    print(p, "oidn_s", round(time.time() - t0, 2), "cpu_s", round(sum(os.times()[:2]) - c0, 1), "version", getattr(pyoidn, "__version__", "2.5.1.0"))
    np.save(p.replace(".npy", "_oidn.npy"), np.asarray(out))
