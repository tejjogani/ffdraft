"""Cycles configuration, rendering, background compositing and video encoding.

The beauty pass always renders on a transparent film; the background (display-referred, as in
the three.js viewport) is composited afterwards in numpy, so "white" is exactly 255 whatever
the view transform. A second, cheap pass with only the piece visible gives the subject mask
for the critique metrics and doubles as a cut-out matte.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Callable
from pathlib import Path

import bpy
import numpy as np

from .imageio import read_png, write_png
from .job import Background, ColorSettings, Output

Progress = Callable[[float], None]

_VIEW = {"agx": "AgX", "neutral": "Khronos PBR Neutral"}
_GPU_BACKENDS = ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL")


def select_device() -> str:
    """Best available Cycles device: a GPU backend if one has devices, else CPU.

    `PAVE_CYCLES_DEVICE=CPU` (or a backend name) overrides the probe.
    """
    scene = bpy.context.scene
    forced = os.environ.get("PAVE_CYCLES_DEVICE", "").upper()
    if forced == "CPU":
        scene.cycles.device = "CPU"
        return "CPU"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for backend in (forced,) if forced else _GPU_BACKENDS:
        try:
            prefs.compute_device_type = backend
        except TypeError:  # backend not compiled into this build
            continue
        prefs.refresh_devices()
        devices = [d for d in prefs.devices if d.type == backend]
        if devices:
            for d in prefs.devices:
                d.use = d.type == backend
            scene.cycles.device = "GPU"
            return backend
    scene.cycles.device = "CPU"
    return "CPU"


def configure(output: Output, color: ColorSettings, animated: bool) -> None:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.render.resolution_x = output["width"]
    scene.render.resolution_y = output["height"]
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    c = scene.cycles
    c.samples = output["samples"]
    c.use_adaptive_sampling = True
    c.adaptive_threshold = output["noiseThreshold"]
    b = output["bounces"]
    c.max_bounces = b["total"]
    c.transmission_bounces = b["transmission"]
    c.glossy_bounces = b["glossy"]
    c.diffuse_bounces = b["diffuse"]
    c.transparent_max_bounces = b["transparent"]
    c.sample_clamp_direct = output["clampDirect"]
    c.sample_clamp_indirect = output["clampIndirect"]
    c.blur_glossy = output["filterGlossy"]
    c.caustics_reflective = True
    c.caustics_refractive = True
    c.use_denoising = output["denoise"]
    c.denoiser = "OPENIMAGEDENOISE"
    c.seed = output["seed"]
    c.use_animated_seed = animated
    view = scene.view_settings
    view.view_transform = _VIEW[color["view"]]
    view.look = "None"
    view.exposure = color["exposure"]
    view.gamma = 1.0
    image = scene.render.image_settings
    image.media_type = "IMAGE"
    image.file_format = "PNG"
    image.color_mode = "RGBA"
    image.color_depth = "8"


def _render(path: Path) -> None:
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def _background(bg: Background, h: int, w: int) -> np.ndarray | None:
    if bg["kind"] == "transparent":
        return None
    if bg["kind"] == "solid":
        return np.broadcast_to(np.array(bg["color"], np.float32), (h, w, 3))
    t = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None, None]
    top = np.array(bg["top"], np.float32)
    bottom = np.array(bg["bottom"], np.float32)
    return np.broadcast_to(top + (bottom - top) * t, (h, w, 3))


def composite(raw: np.ndarray, bg: Background) -> np.ndarray:
    """Straight-alpha `over` in display space (the shadow catcher's shadow is black with alpha)."""
    back = _background(bg, raw.shape[0], raw.shape[1])
    if back is None:
        return raw
    a = raw[..., 3:4]
    out = np.empty_like(raw)
    out[..., :3] = raw[..., :3] * a + back * (1 - a)
    out[..., 3] = 1.0
    return out


def render_mask(path: Path, hide: list[bpy.types.Object]) -> np.ndarray:
    """Piece coverage: direct camera hits only, a few samples, everything else hidden."""
    scene = bpy.context.scene
    c = scene.cycles
    saved = (c.samples, c.max_bounces, c.use_denoising, c.use_adaptive_sampling)
    for obj in hide:
        obj.hide_render = True
    c.samples, c.max_bounces, c.use_denoising, c.use_adaptive_sampling = 8, 0, False, False
    try:
        _render(path)
    finally:
        c.samples, c.max_bounces, c.use_denoising, c.use_adaptive_sampling = saved
        for obj in hide:
            obj.hide_render = False
    return read_png(path)[..., 3]


def render_still(out: Path, bg: Background, progress: Progress) -> tuple[Path, np.ndarray, np.ndarray]:
    """Returns (output file, composited image, beauty alpha)."""
    raw_path = out / "raw.png"

    def on_stats(*args: object) -> None:
        # Cycles reports "… Sample 12/64 …" in the stats string.
        text = next((a for a in args if isinstance(a, str)), "")
        if "Sample " in text:
            done, _, total = text.split("Sample ", 1)[1].split(" ", 1)[0].partition("/")
            if done.isdigit() and total.isdigit() and int(total):
                progress(0.1 + 0.8 * int(done) / int(total))

    bpy.app.handlers.render_stats.append(on_stats)
    try:
        _render(raw_path)
    finally:
        bpy.app.handlers.render_stats.remove(on_stats)
    raw = read_png(raw_path)
    image = composite(raw, bg)
    final = out / "render.png"
    write_png(final, image, alpha=bg["kind"] == "transparent")
    raw_path.unlink()
    return final, image, raw[..., 3]


def render_frames(out: Path, bg: Background, frames: int, progress: Progress) -> tuple[Path, np.ndarray, np.ndarray]:
    """Renders and composites every frame into `frames/`; returns frame 0's data for metrics."""
    folder = out / "frames"
    folder.mkdir(exist_ok=True)
    scene = bpy.context.scene
    first: tuple[np.ndarray, np.ndarray] | None = None
    for f in range(frames):
        scene.frame_set(f)
        raw_path = folder / f"raw_{f:04d}.png"
        _render(raw_path)
        raw = read_png(raw_path)
        image = composite(raw, bg)
        write_png(folder / f"frame_{f:04d}.png", image, alpha=bg["kind"] == "transparent")
        raw_path.unlink()
        if first is None:
            first = (image, raw[..., 3])
        progress(0.05 + 0.85 * (f + 1) / frames)
    scene.frame_set(0)
    assert first is not None
    return folder, first[0], first[1]


_VIDEO_CODECS = (("MPEG4", "H264", ".mp4"), ("WEBM", "WEBM", ".webm"))


def encode_video(frames_dir: Path, count: int, fps: int, width: int, height: int, out: Path) -> Path | None:
    """Encodes the composited frames with the FFmpeg built into bpy via the sequencer.

    Returns None if no encoder in this build accepts the frames (the PNG sequence remains).
    """
    for container, codec, ext in _VIDEO_CODECS:
        encode = bpy.data.scenes.new(f"encode-{codec}")
        encode.render.resolution_x, encode.render.resolution_y = width, height
        encode.render.resolution_percentage = 100
        encode.render.fps = fps
        encode.frame_start, encode.frame_end = 0, count - 1
        encode.view_settings.view_transform = "Standard"  # frames are already display-referred
        seq = encode.sequence_editor_create()
        strip = seq.strips.new_image("frames", str(frames_dir / "frame_0000.png"), 1, 0)
        for f in range(1, count):
            strip.elements.append(f"frame_{f:04d}.png")
        strip.colorspace_settings.name = "sRGB"
        settings = encode.render.image_settings
        settings.media_type = "VIDEO"
        settings.file_format = "FFMPEG"
        encode.render.ffmpeg.format = container
        encode.render.ffmpeg.codec = codec
        encode.render.ffmpeg.constant_rate_factor = "HIGH"
        target = out / f"render{ext}"
        encode.render.filepath = str(target)
        encode.render.use_file_extension = False
        try:
            bpy.ops.render.render(animation=True, scene=encode.name)
        except RuntimeError as err:
            print(f"pave: {codec} encode failed: {err}", file=sys.stderr)
            continue
        finally:
            bpy.data.scenes.remove(encode)
        if target.exists() and target.stat().st_size > 0:
            return target
    return None
