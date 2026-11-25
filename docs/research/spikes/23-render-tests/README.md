# Render tests behind "Jewelry product page renders"

The scripts, logs and comparison images that the report [`../../reports/Jewelry product page renders.md`](../../reports/Jewelry%20product%20page%20renders.md) cites as "measured". They are research scripts, not product code. Blender (`bpy` 5.3.0, build `02f0899d78e3`) ran as its own process; nothing here is imported by the product.

| Folder | What it holds |
|---|---|
| `lab/` | The eleven render experiments and two additions: repeatability (`exp01`–`exp04`, `exp12`), ray depth (`exp05`), clamping and caustics (`exp06`), dispersion (`exp07`), the denoiser (`exp08`), turntable flicker (`exp09`), view transforms on white (`exp10`), timing (`exp11`). Each `expNN_*.py` has its `log_*.txt`; `lab.py` and `metrics.py` are shared; the `.jpg` files are the side-by-sides the notes describe. 349 renders, CPU only. |
| `metals/` | Reducing measured spectra of the pure metals to RGB, the alloy estimates, the view-transform and depth-of-field checks (`tiny_tests.py`), and what Blender embeds in saved files (`chunks.py`). The optical database itself is not copied; it is the CC0 refractiveindex.info database. |
| `animation/` | The keyframing checks against the Blender 5.3 scripting interface, the generator of synthetic frames for the ffmpeg tests, and `flicker_check.py`. |

The test scene is the ring from `../15-renderer/` (`make_scene.py` regenerates it).

**Limits.** One small scene (a 6.5 mm round diamond in a yellow gold ring), 512 px at most, two CPU cores. No GPU, no Apple Metal, no macOS, no second machine. The ffmpeg lines ran on FFmpeg 6.1.1 with synthetic frames; no browser was used.

**Two corrections found afterwards**, when the updated render workflow's code blocks were run in Blender 5.3.0:
- The turntable recipe in the notes moves the piece unless `bpy.context.view_layer.update()` is called after the pivot's location is set and before parenting (the pivot's matrix is still the identity until then).
- Making spin-frame JPEGs straight from transparent PNG frames puts the piece on black; the frames must be laid over white first.
