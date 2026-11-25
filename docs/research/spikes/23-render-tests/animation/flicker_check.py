# Per-frame checks on an image sequence: object-masked mean luma, temporal residual vs neighbours, wrap continuity.
# usage: python3 flicker_check.py "frames/f_*.png" [zscore_threshold]
import sys, glob, numpy as np
from PIL import Image
files = sorted(glob.glob(sys.argv[1])); S = 640; ZT = float(sys.argv[2]) if len(sys.argv) > 2 else 6.0
def load(p):
    im = Image.open(p).convert("RGBA"); bg = Image.new("RGBA", im.size, (255,255,255,255)); bg.alpha_composite(im)
    im = bg.convert("L"); im.thumbnail((S, S)); return np.asarray(im, dtype=np.float32)
fr = [load(p) for p in files]; n = len(fr)
mask = np.min(fr, axis=0) < 250                                            # pixels the object ever covers
mean = np.array([f[mask].mean() for f in fr])
step = np.array([np.abs(fr[i]-fr[i-1])[mask].mean() for i in range(n)])    # i=0 is the wrap pair (last -> first)
res  = np.array([np.abs(fr[i]-(fr[i-1]+fr[(i+1)%n])/2)[mask].mean() for i in range(n)])
dmean = np.array([mean[i]-(mean[i-1]+mean[(i+1)%n])/2 for i in range(n)])  # brightness pop relative to neighbours
def z(x): m = np.median(x); mad = np.median(np.abs(x-m)) or 1e-6; return (x-m)/(1.4826*mad)
print(f"frames {n}  object-mean luma {mean.mean():.2f} +- {mean.std():.3f}")
print(f"step diff median {np.median(step):.3f}; wrap (last->first) {step[0]:.3f}  ratio {step[0]/np.median(step):.2f}")
for name, arr in (("brightness pop", dmean), ("residual", res)):
    zz = z(arr); bad = np.where(np.abs(zz) > ZT)[0]
    print(name, "outliers:", [(files[i].split('/')[-1], round(float(arr[i]),3), round(float(zz[i]),1)) for i in bad])
