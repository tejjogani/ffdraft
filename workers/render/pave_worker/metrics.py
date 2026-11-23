"""Numeric render metrics for the critique loop; consumed by `assessRender` in @pave/render.

Field names and definitions mirror `RenderMetrics` in packages/render/src/assess.ts.
"""

from __future__ import annotations

import math

import numpy as np

CLIP = 254.0 / 255.0
CRUSH = 0.02
FIREFLY_DELTA = 0.25


def _luminance(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def _neighbours(a: np.ndarray) -> np.ndarray:
    """The 3×3 neighbourhood of every interior pixel, stacked on axis 0."""
    h, w = a.shape
    return np.stack([a[1 + dy : h - 1 + dy, 1 + dx : w - 1 + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1)])


def measure(image: np.ndarray, coverage: np.ndarray, rendered: np.ndarray) -> dict[str, object]:
    """`image`: composited RGBA (display-referred); `coverage`: subject alpha from the mask pass;
    `rendered`: alpha of the beauty pass before compositing (where the renderer produced pixels)."""
    h, w = coverage.shape
    subject = coverage > 0.5
    lum = _luminance(image[..., :3])
    metrics: dict[str, object] = {
        "width": w,
        "height": h,
        "subjectBox": None,
        "subjectCoverage": float(subject.mean()),
        "clippedPct": 0.0,
        "crushedPct": 0.0,
        "subjectLuminance": 0.0,
        "firefliesPerMp": 0.0,
        "noise": 0.0,
    }
    if subject.any():
        ys, xs = np.nonzero(subject)
        metrics["subjectBox"] = [xs.min() / w, ys.min() / h, (xs.max() + 1) / w, (ys.max() + 1) / h]
        metrics["clippedPct"] = float((image[..., :3].max(axis=2)[subject] >= CLIP).mean() * 100)
        metrics["crushedPct"] = float((lum[subject] < CRUSH).mean() * 100)
        metrics["subjectLuminance"] = float(lum[subject].mean())

    stack = _neighbours(lum)
    centre = lum[1:-1, 1:-1]
    median = np.median(stack, axis=0)
    hot = (centre - median > FIREFLY_DELTA) & (centre > 2 * median)
    metrics["firefliesPerMp"] = float(hot.sum() / (w * h / 1e6))

    # Immerkær (1996) fast noise σ, restricted to smooth rendered pixels so edges don't count.
    kernel = np.array([1, -2, 1, -2, 4, -2, 1, -2, 1], dtype=np.float32).reshape(9, 1, 1)
    response = np.abs((stack * kernel).sum(axis=0))
    gradient = np.abs(stack[5] - stack[3]) + np.abs(stack[7] - stack[1])
    region = rendered[1:-1, 1:-1] > 0.99
    if region.sum() > 100:
        smooth = region & (gradient <= np.percentile(gradient[region], 50))
        if smooth.any():
            metrics["noise"] = float(math.sqrt(math.pi / 2) / 6 * response[smooth].mean())
    return metrics
