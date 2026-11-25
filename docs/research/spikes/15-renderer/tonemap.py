"""Shared display transform for every engine: one exposure, sRGB curve, 8-bit PNG.

usage: tonemap.py out/a.npy [out/b.npy ...]   -> out/a.png
       tonemap.py --diff ref.npy other.npy     -> prints display-space error figures
"""
import sys
import numpy as np
from PIL import Image

EXPOSURE = 0.45   # one linear gain for all engines; chosen so the lit ground sits near 0.8 display


def display(lin):
    x = np.clip(np.nan_to_num(lin[..., :3]) * EXPOSURE, 0, None)
    # Soft shoulder above 0.8 so sparkles keep some colour instead of clipping flat.
    x = np.where(x > 0.8, 0.8 + 0.2 * np.tanh((x - 0.8) / 0.2), x)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(np.maximum(x, 1e-9), 1 / 2.4) - 0.055)


def box(img, k):
    h, w = img.shape[0] // k * k, img.shape[1] // k * k
    return img[:h, :w].reshape(h // k, k, w // k, k, -1).mean(axis=(1, 3))


if __name__ == "__main__":
    if sys.argv[1] == "--diff":
        a, b = (display(np.load(p)) for p in sys.argv[2:4])
        for k in (1, 4, 8):
            da, db = box(a, k), box(b, k)
            print("box %d: mean abs diff %.4f  rmse %.4f  (display 0..1)" %
                  (k, np.abs(da - db).mean(), np.sqrt(((da - db) ** 2).mean())))
        print("mean display value: ref %.4f other %.4f" % (a.mean(), b.mean()))
    else:
        for p in sys.argv[1:]:
            lin = np.load(p)
            Image.fromarray((display(lin) * 255 + 0.5).astype(np.uint8)).save(p.replace(".npy", ".png"))
            print(p, lin.shape, "mean", float(np.nan_to_num(lin).mean()), "max", float(np.nanmax(lin)))
