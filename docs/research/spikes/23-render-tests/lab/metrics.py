"""Shared measurement helpers for lab 23 (system python3: numpy, Pillow, scikit-image). No Blender here."""
import json, os, subprocess, hashlib
import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity
from skimage.color import rgb2lab, deltaE_ciede2000

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
STONE_FULL = {"border": None}


def run(jobs, force=False):
    """Render a job or list of jobs in ONE fresh Blender process, unless every output already exists."""
    jl = jobs if isinstance(jobs, list) else [jobs]
    if not force and all(os.path.exists(os.path.join(OUT, j["name"] + ".npy")) for j in jl):
        return
    p = subprocess.run([os.path.join(HERE, "run.sh"), json.dumps(jl)], capture_output=True, text=True)
    for line in p.stdout.splitlines():
        if "LAB_RESULT" not in line:
            print("!!", line)


def res(name):
    """Last results.jsonl record for a render name."""
    r = None
    for line in open(os.path.join(HERE, "results.jsonl")):
        d = json.loads(line)
        if d["name"] == name:
            r = d
    return r


def lin(name):
    return np.load(os.path.join(OUT, name + ".npy"))


def png(name, suffix=".png"):
    return np.asarray(Image.open(os.path.join(OUT, name + suffix)).convert("RGB")).astype(np.int16)


def fsha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()[:16]


def lum(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def masks(name="mask_stone"):
    m = lin(name)
    return m[..., 0] > 0.99, m[..., 1] > 0.99, m[..., 2] > 0.99     # stone, metal, ground (pure pixels only)


def compare(a, b, mask=None):
    """a, b: render names. Returns dict of linear and 8-bit display differences (optionally inside mask)."""
    A, B = lin(a)[..., :3], lin(b)[..., :3]
    PA, PB = png(a), png(b)
    d = {"px_equal": bool(np.array_equal(lin(a), lin(b))), "png_px_equal": bool(np.array_equal(PA, PB))}
    if mask is None:
        mask = np.ones(A.shape[:2], bool)
    dl = np.abs(A - B)[mask]
    d8 = np.abs(PA - PB)[mask]
    d["lin_max"] = float(dl.max()); d["lin_mean"] = float(dl.mean())
    d["lin_rel_rmse"] = float(np.sqrt(((A - B)[mask] ** 2).mean()) / max(1e-9, B[mask].mean()))
    d["d8_max"] = int(d8.max()); d["d8_mean"] = float(d8.mean())
    d["d8_rmse"] = float(np.sqrt((d8.astype(float) ** 2).mean()))
    d["d8_frac_gt2"] = float((d8.max(axis=-1) > 2).mean())
    d["ssim"] = float(structural_similarity(PA.astype(np.uint8), PB.astype(np.uint8), channel_axis=2, data_range=255))
    de = deltaE_ciede2000(rgb2lab(PA / 255.0), rgb2lab(PB / 255.0))[mask]
    d["dE00_mean"] = float(de.mean()); d["dE00_p99"] = float(np.percentile(de, 99))
    return d


def fmt(d, keys=("px_equal", "lin_max", "lin_mean", "d8_max", "d8_mean", "d8_rmse", "ssim", "dE00_mean")):
    out = []
    for k in keys:
        v = d[k]
        out.append("%s=%s" % (k, v if isinstance(v, (bool, int)) else ("%.4g" % v)))
    return "  ".join(out)


def stone_stats(name, stone):
    """Linear-light statistics inside the stone mask, and display chroma from the PNG."""
    A = lin(name)[..., :3]
    L = lum(A)[stone]
    rgb = A[stone]
    mx, mn = rgb.max(1), rgb.min(1)
    sat = np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0)
    coloured = (sat > 0.25) & (mx > 0.2)
    lab = rgb2lab(png(name)[stone][None].astype(float) / 255.0)[0]
    chroma = np.hypot(lab[:, 1], lab[:, 2])
    return {"mean_lum": float(L.mean()), "mean_rgb": [float(x) for x in rgb.mean(0)], "median_lum": float(np.median(L)),
            "p99": float(np.percentile(L, 99)), "p999": float(np.percentile(L, 99.9)), "max_lum": float(L.max()),
            "max_chan": float(rgb.max()), "frac_coloured": float(coloured.mean()),
            "sat_coloured": float(sat[coloured].mean()) if coloured.any() else 0.0, "mean_sat": float(sat.mean()),
            "chroma_mean": float(chroma.mean()), "chroma_p99": float(np.percentile(chroma, 99)),
            "disp_frac_clipped": float((png(name)[stone].min(1) >= 250).mean())}


def fireflies(name, region):
    """Isolated bright pixels: luminance above 2x the 3x3 median of neighbours and at least 0.5 above it."""
    from scipy.ndimage import median_filter
    L = lum(lin(name)[..., :3])
    med = median_filter(L, size=3)
    ff = (L > 2 * med) & (L - med > 0.5) & region
    return int(ff.sum()), float(ff.sum() / max(1, region.sum()))


def sidebyside(names, path, labels=None, scale=1, suffix=".png"):
    from PIL import ImageDraw
    ims = [Image.open(os.path.join(OUT, n + suffix)).convert("RGB") if isinstance(n, str) else n for n in names]
    if scale != 1:
        ims = [im.resize((im.width * scale, im.height * scale), Image.NEAREST) for im in ims]
    w, h = ims[0].size
    sheet = Image.new("RGB", (w * len(ims), h + 14), (255, 255, 255))
    dr = ImageDraw.Draw(sheet)
    for i, im in enumerate(ims):
        sheet.paste(im, (i * w, 14))
        dr.text((i * w + 3, 1), (labels or names)[i] if isinstance((labels or names)[i], str) else "", fill=(0, 0, 0))
    sheet.save(path)
    return path
