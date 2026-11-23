"""PNG in and out as numpy arrays (H × W × C, float32 0–1, top row first).

Reading goes through Blender's image loader (no extra dependency); writing uses a tiny
zlib encoder so the bytes on disk are exactly the composited values, with no colour-management
step in between.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

import bpy
import numpy as np


def read_png(path: Path) -> np.ndarray:
    image = bpy.data.images.load(str(path), check_existing=False)
    try:
        w, h = image.size
        pixels = np.empty(w * h * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)  # byte images: raw display values / 255
        return pixels.reshape(h, w, 4)[::-1].copy()
    finally:
        bpy.data.images.remove(image)


def write_png(path: Path, rgba: np.ndarray, *, alpha: bool) -> None:
    channels = 4 if alpha else 3
    data = np.clip(np.rint(rgba[..., :channels] * 255.0), 0, 255).astype(np.uint8)
    h, w = data.shape[:2]
    rows = np.concatenate([np.zeros((h, 1), np.uint8), data.reshape(h, w * channels)], axis=1)

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))

    header = struct.pack(">IIBBBBB", w, h, 8, 6 if alpha else 2, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(rows.tobytes(), 6))
        + chunk(b"IEND", b"")
    )
