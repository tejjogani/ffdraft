# Reproducing a KeyShot jewelry shoot in Pavé

Use one approved camera and lighting setup to produce a catalog still, then reuse it for motion. The reference can be public: KeyShot’s **Diamond Ring** download contains both `Model/Ring.3dm` by Simply Rhino Ltd and `KeyShot_RingJewelry.ksp`. The package contains a KeyShot scene and its environment. The CAD SHA-256 is `d74ed036ed598962e321313fd1e4724a2d0b93f341bc9f1e2d4b0b5fcd469584`. Pavé’s importer found ten visible geometry parts in millimetres. [Official download](https://media.keyshot.com/scenes/KeyShot_RingJewelry.zip) · [KeyShot’s demonstrated render and settings](https://www.youtube.com/watch?v=cYLe--0loWU)

## What to transfer

| In KeyShot | In Pavé |
| --- | --- |
| A Studio records the selected camera, environment, image style, model sets and multi-materials. | A saved shot holds the camera, look, ground, background, material overrides, motion and output. Save a successful setup as a house shot to reuse it across pieces. Visibility and imported geometry belong to the piece. [KeyShot Studios](https://manual.keyshot.com/manual/studios/) · [Pavé shot schema](../../packages/schema/src/api/entities.ts) |
| The camera defines perspective, target, field of view and orientation. | Save a custom position and target in millimetres, Z up, with focal length and roll. Lock the camera after alignment. For a local KeyShot session, its Python API can read `lux.getCameraPosition()`, `getCameraLookAt()`, `getCameraUp()`, `getCameraLens()`, `getCameraFocalLength()` and `getSceneInfo()`. Convert axes and scene units and verify the field of view against the silhouette. Shift lenses and orthographic cameras require separate calibration. [KeyShot scripting API](https://media.keyshot.com/scripting/doc/2026.1/lux.html) |
| HDRI pins place highlights on specific facets or metal edges. | Start with a named rig. Adjust its rotation, intensity and sparkle. The rig’s individual panels, gradients, black cards, exposure and view transform are defined in code. Reproducing a particular pin layout or importing a custom HDRI would require additional implementation. Compare finished images under the same display conditions. [KeyShot HDRI pins](https://manuals.keyshot.com/kss2025/en-us/manual/hdri-editor-pins.html) · [Pavé rigs](../../packages/render/src/looks.ts) · [Blender color management](https://docs.blender.org/manual/en/4.5/render/color_management.html) |
| Named material variants and gemstone shaders change appearance. | Use confirmed metal and stone assignments, or shot-only library overrides on eligible parts. Unassigned Rhino bodies can be shown in neutral clay. Keep any illustrative material choices on a study copy when modeling roles are required. The worker builds the Cycles shaders in Python. [Material implementation](../../workers/render/pave_worker/materials.py) · [Import preview](../../packages/render/src/import-preview.ts) |

## A verified shot

This scene ran on a disposable detail study of HBR0034315 with illustrative 14k white gold, diamond and emerald settings. The camera coordinates belong to that study. They will frame a different area on another piece.

```json
{
  "look": "studio-contrast",
  "camera": {
    "preset": "custom", "position": [109, -47, 32], "target": [95, 0, -0.6],
    "focalLength": 68, "roll": -15
  },
  "environment": {"rotation": 0, "intensity": 1, "background": "look"},
  "ground": "look", "sparkle": 0.4,
  "animation": {"type": "push-in", "seconds": 2.5, "fps": 24},
  "output": {"width": 960, "height": 630, "quality": "standard"}
}
```

Use HTTP POST to `/api/rpc/scenes.create` with `{pieceId, title, scene}`, then `/api/rpc/renders.create` with `{pieceId, sceneId, baseVersion, engine: "blender", autoTune: false}`. A script can poll `renders.get` and fetch the finished take from `/api/assets/{assetId}`. Omit `animation` for a still. The saved HBR movie decoded to 60 distinct H.264 frames, 960 × 630, yuv420p, 24 fps. Blender 4.5.3 Cycles rendered it on Metal in 383 seconds. [Queue handlers](../../apps/server/src/handlers/render.ts) · [Cycles settings and encoding](../../workers/render/pave_worker/render.py)

The assistant can suggest shots, capture the framing, modify one saved setting, estimate render time, or queue a take. A useful direction is “Keep the camera locked. Rotate the light until a reflection follows the outside of the shank. Show me the still before the push-in.” The corresponding operations are `scenes.capture`, `scenes.update` and `renders.create`. Save each comparison with its changed setting and piece version. [Assistant render workflow](../../packages/agent/src/prompt/skills/render.ts)

## Acceptance on public references

1. **Geometry and camera.** Import the Simply Rhino CAD. Select the same view, aspect ratio and visible parts as one identified webinar frame or the packaged KeyShot scene. Record the reference frame and scene version. Overlay the two images at equal size. Proposed starting tolerance: the stone center and two outer shank landmarks each fall within 2% of the image width. Check the shoulder and prong occlusion by eye.
2. **Materials and light.** On the matched ring, inspect the metal edge reflection, shadow contact and alternating bright and dark stone facets. For emerald color, Creox shows a green center, diamond halo and polished silver. For metal reflections around a colored setting, use Paul Adeyemo’s silver vine ring in KeyShot’s gallery. These last two are different designs. Compare those features visually and reserve positional measurements for the matched ring. [Creox emerald ring](https://creox.io/product/ring-elegance-timeless-jewelry-with-emerald-sparkle-for-keyshot/) · [Paul Adeyemo in the KeyShot gallery](https://www.keyshot.com/blog/these-keyshot-jewelry-renderings-bring-the-brilliance-and-bling/)
3. **Motion.** From the accepted still, render the desired move. Decode first, middle and last frames, verify dimensions, duration and frame count, and play it at normal speed. The focus should stay on the intended setting and broad white clipping or denoiser flicker should not obscure facets. Record the CAD checksum, shot JSON, renderer version and device alongside the approved reference. The HBR take demonstrates this workflow. A match to a private studio style remains unmeasured.
