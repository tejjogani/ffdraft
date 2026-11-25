"""Runs ptgem.wgsl through wgpu (wgpu-native) headless. usage: render_wgsl.py <camera> <spp> [res] [depth] [nodisp]

On a machine with a GPU this uses Metal / D3D12 / Vulkan. On this GPU-less box it uses Mesa
llvmpipe through wgpu's OpenGL backend (WGPU_BACKEND_TYPE=OpenGL), which is a CPU.
Writes out/wgsl_<camera>_disp.npy (linear sRGB float32).
"""
import json
import math
import os
import struct
import sys
import time

import numpy as np
import wgpu

cam_name, spp = sys.argv[1], int(sys.argv[2])
res = int(sys.argv[3]) if len(sys.argv) > 3 else 256
depth = int(sys.argv[4]) if len(sys.argv) > 4 else 32
disp = 0 if "nodisp" in sys.argv else 1
HERE = os.path.dirname(os.path.abspath(__file__))
S = json.load(open(os.path.join(HERE, "scene", "scene.json")))

# ---- metal mesh and a median-split BVH (built on the CPU; 20 k triangles)
with open(os.path.join(HERE, "scene", "metal.bin"), "rb") as f:
    nv, nt = struct.unpack("<ii", f.read(8))
    V = np.frombuffer(f.read(12 * nv), dtype="<f4").reshape(nv, 3).astype(np.float64)
    N = np.frombuffer(f.read(12 * nv), dtype="<f4").reshape(nv, 3).astype(np.float64)
    F = np.frombuffer(f.read(12 * nt), dtype="<i4").reshape(nt, 3)
tv = V[F]
tlo, thi = tv.min(axis=1), tv.max(axis=1)
cent = tlo + thi
nodes, order = [], []
sys.setrecursionlimit(10000)


def build(idx):
    me = len(nodes)
    nodes.append(None)
    lo, hi = tlo[idx].min(axis=0), thi[idx].max(axis=0)
    if len(idx) <= 4:
        nodes[me] = (lo, hi, -1, -1, len(order), len(idx))
        order.extend(idx.tolist())
        return me
    axis = int(np.argmax(hi - lo))
    srt = idx[np.argsort(cent[idx, axis], kind="stable")]
    half = len(srt) // 2
    left = build(srt[:half])
    right = build(srt[half:])
    nodes[me] = (lo, hi, left, right, 0, 0)
    return me


t0 = time.time()
build(np.arange(nt))
t_bvh = time.time() - t0
pad = lambda a: np.hstack([a, np.zeros((len(a), 1))]).astype(np.float32)
node_lo = pad(np.array([n[0] for n in nodes]))
node_hi = pad(np.array([n[1] for n in nodes]))
node_i = np.array([n[2:] for n in nodes], dtype=np.int32)
o = np.array(order)
tri_p = pad(np.stack([tv[o, 0], tv[o, 1] - tv[o, 0], tv[o, 2] - tv[o, 0]], axis=1).reshape(-1, 3))
tri_n = pad(N[F[o]].reshape(-1, 3))

planes = np.array([p["n"] + [p["d"]] for p in S["gem"]["planes"]], dtype=np.float32)
gv = np.frombuffer(open(os.path.join(HERE, "scene", "gem.bin"), "rb").read()[8:], dtype="<f4")
with open(os.path.join(HERE, "scene", "gem.bin"), "rb") as f:
    gnv, gnt = struct.unpack("<ii", f.read(8))
    GV = np.frombuffer(f.read(12 * gnv), dtype="<f4").reshape(gnv, 3)
gc = GV.mean(axis=0)
gr = float(np.linalg.norm(GV - gc, axis=1).max()) * 1.001

lights = []
for L in S["lights"]:
    u, v = np.array(L["u"]), np.array(L["v"])
    area = 4 * np.linalg.norm(u) * np.linalg.norm(v)
    lights.append(L["center"] + [L["radiance"]] + L["normal"] + [area] + L["u"] + [float(u @ u)] + L["v"] + [float(v @ v)])
lights = np.array(lights, dtype=np.float32)

cam = S["cameras"][cam_name]
co, ct = np.array(cam["origin"]), np.array(cam["target"])
fw = (ct - co) / np.linalg.norm(ct - co)
rt = np.cross(fw, [0, 0, 1.0]); rt /= np.linalg.norm(rt)
up = np.cross(rt, fw)
half = math.tan(math.radians(cam["vfov"]) / 2)


def params(first, count):
    f = np.array([*co, 0, *fw, 0, *rt, 0, *up, 0, *gc, gr,
                  half, S["gem"]["cauchyA"], S["gem"]["cauchyB_nm2"], S["environment"]["radiance"],
                  S["ground"]["z"], S["ground"]["albedo"], S["ground"]["halfSize"], 0], dtype=np.float32)
    u = np.array([res, len(planes), len(lights), depth, first, count, 12345, disp], dtype=np.uint32)
    return f.tobytes() + u.tobytes()


adapter = wgpu.gpu.request_adapter_sync(power_preference="high-performance")
device = adapter.request_device_sync()
U = wgpu.BufferUsage
buf = lambda a: device.create_buffer_with_data(data=a.tobytes(), usage=U.STORAGE)
ubuf = device.create_buffer(size=len(params(0, 1)), usage=U.UNIFORM | U.COPY_DST)
accum = device.create_buffer(size=res * res * 16, usage=U.STORAGE | U.COPY_SRC)
t0 = time.time()
module = device.create_shader_module(code=open(os.path.join(HERE, "ptgem.wgsl")).read())
pipe = device.create_compute_pipeline(layout="auto", compute={"module": module, "entry_point": "main"})
entries = [{"binding": 0, "resource": {"buffer": ubuf}}]
for i, b in enumerate([buf(planes), buf(lights), buf(node_lo), buf(node_hi), buf(node_i), buf(tri_p), buf(tri_n), accum]):
    entries.append({"binding": i + 1, "resource": {"buffer": b}})
bind = device.create_bind_group(layout=pipe.get_bind_group_layout(0), entries=entries)
t_compile = time.time() - t0

per_pass = 4
cpu0 = sum(os.times()[:2])
t0 = time.time()
done = 0
while done < spp:
    n = min(per_pass, spp - done)
    device.queue.write_buffer(ubuf, 0, params(done, n))
    enc = device.create_command_encoder()
    cp = enc.begin_compute_pass()
    cp.set_pipeline(pipe); cp.set_bind_group(0, bind)
    cp.dispatch_workgroups((res + 7) // 8, (res + 7) // 8)
    cp.end()
    device.queue.submit([enc.finish()])
    device.queue.read_buffer(accum, 0, 16)      # wait for the pass to finish
    done += n
    if done == n:
        t_first = time.time() - t0
a = np.frombuffer(device.queue.read_buffer(accum), dtype=np.float32).reshape(res, res, 4).astype(np.float64)
t_render = time.time() - t0
cpu = sum(os.times()[:2]) - cpu0

# XYZ -> linear sRGB with a flat spectrum mapped to white (same as ptgem.c).
lam = 380 + 0.1 * (np.arange(3500) + 0.5)
g = lambda l, m, s1, s2: np.exp(-0.5 * ((l - m) / np.where(l < m, s1, s2)) ** 2)
XE = (1.056 * g(lam, 599.8, 37.9, 31.0) + 0.362 * g(lam, 442.0, 16.0, 26.7) - 0.065 * g(lam, 501.1, 20.4, 26.2)).mean()
YE = (0.821 * g(lam, 568.8, 46.9, 40.5) + 0.286 * g(lam, 530.9, 16.3, 31.1)).mean()
ZE = (1.217 * g(lam, 437.0, 11.8, 36.0) + 0.681 * g(lam, 459.0, 26.0, 13.8)).mean()
xyz = a[..., :3] / a[..., 3:4] / [XE, YE, ZE] * [0.95047, 1.0, 1.08883]
M = np.array([[3.2404542, -1.5371385, -0.4985314], [-0.9692660, 1.8760108, 0.0415560], [0.0556434, -0.2040259, 1.0572252]])
rgb = xyz @ M.T
name = "wgsl_%s_%s" % (cam_name, "disp" if disp else "nodisp")
np.save(os.path.join(HERE, "out", name + ".npy"), rgb.astype(np.float32))
info = adapter.info
print(json.dumps({"engine": "ptgem.wgsl via wgpu-py %s" % wgpu.__version__, "adapter": info.get("device"),
                  "backend": info.get("backend_type"), "adapter_type": info.get("adapter_type"),
                  "camera": cam_name, "res": res, "spp": spp, "max_depth": depth, "dispersion": disp,
                  "bvh_build_py_s": round(t_bvh, 2), "shader_compile_s": round(t_compile, 2),
                  "first_pass_s": round(t_first, 2), "render_s": round(t_render, 2), "cpu_s": round(cpu, 1),
                  "load1": round(os.getloadavg()[0], 1), "out": name + ".npy"}))
