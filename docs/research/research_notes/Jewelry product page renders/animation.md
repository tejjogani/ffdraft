# Jewelry animation in Blender Cycles and its delivery on the web (state on 25 November 2026)

Scope: turntables, camera moves, light sweeps, articulated and assembly motion, rendered from CAD in Cycles, encoded with FFmpeg. No generative video anywhere.

**Labels.** `[V]` = I opened the linked page today and the claim is on it. `[S]` = seen only as a search-result title or link. `[E]` = my own estimate or working knowledge. Two sub-kinds of `[E]` are marked because they are stronger than memory: `[E, tested]` = I ran it on this machine today (FFmpeg 6.1.1 from Ubuntu; Blender 5.3.0 as the `bpy` module in `/home/claude/scratch/15/venv-bpy`, API calls only, no renders); `[E, local copy]` = read in a copy of an upstream file that another researcher had already downloaded to `/tmp/cyc/` (I did not open the upstream page myself).

**What I could not open** (so nothing from them is `[V]`): most `docs.blender.org` manual pages (robots refusal; only the 4.5 Sampling and F-curve Modifier pages came through), the Blender 5.0 Python API release notes, CG Channel, Phoronix, the KeyShot community forum (login wall), the FFmpeg trac ticket on HEVC alpha (bot wall), Chrome's Lighthouse page on animated content. Test files are in `/tmp/animtest/` (scratch, not in the repository).

---

## 0. Versions in force, and what changed in the scripting API

### Takeaway
Blender 5.3 (10 November 2026) is current and 5.2 is the LTS; FFmpeg 8.1.2 is current. Scripts written for Blender 4.x break on 5.x in three places that matter here: `action.fcurves` is gone, the compositor tree moved off `scene.node_tree`, and the Glare/Denoise node settings became input sockets.

### Cited Findings
- Blender 5.3 was released on 10 November 2026 and is not an LTS; 5.2 LTS came out 14 July 2026 (supported to July 2028); 4.5 LTS is supported to July 2027; 5.4 is in alpha `[V, vendor blog]` — [Maverick Frame](https://maverickframe.com/blog/blender-latest-version/). 80.lv's article on the release is dated 11 November 2026 `[V]` — [80.lv](https://80.lv/articles/blender-5-3-has-finally-arrived). The 5.2 Python API notes page titles 5.2 as LTS `[V]` — [Blender developer docs](https://developer.blender.org/docs/release_notes/5.2/python_api/).
- FFmpeg's download page lists 8.1.2 "Hoare" (17 June 2026) as the newest branch release; older branches (8.0.3, 7.1.5, 6.1.6 …) still get point releases `[V]` — [FFmpeg download mirror](https://ffbox0-bg.ffmpeg.org/download.html).
- Since FFmpeg 7.1, `-colorspace` and `-color_range` on the output convert the picture instead of only tagging it, and before 7.1 an untagged PNG sequence is converted with the BT.601 matrix `[V]` — [ASWF Encoding Guidelines, colour](https://academysoftwarefoundation.github.io/EncodingGuidelines/ColorPreservation.html), [ASWF, web colour](https://academysoftwarefoundation.github.io/EncodingGuidelines/WebColorPreservation.html).
- Blender 5.0 change log: `Action.fcurves`, `Action.groups`, `Action.id_root` removed; `Scene.node_tree` renamed to `compositing_node_group`; `CompositorNodeGlare` lost `glare_type`, `threshold`, `streaks`, `fade`, `size`, `mix` and the rest of its properties; `CompositorNodeDenoise` lost `prefilter`, `quality`, `use_hdr`; `ImageFormatSettings.media_type` added; `CyclesRenderSettings.feature_set` removed `[V]` — [Blender 5.0 API change log](https://docs.blender.org/api/5.0/change_log.html).
- `scene.use_nodes` is deprecated, always returns True, and most compositor nodes now expose their menu options as inputs `[V, an add-on's tracking issue quoting the 5.0 notes]` — [NodeToPython issue 171](https://github.com/BrendanParmer/NodeToPython/issues/171); a second add-on confirms `action.fcurves` and `scene.node_tree` were removed `[V]` — [BlendLuxCore issue 1049](https://github.com/LuxCoreRender/BlendLuxCore/issues/1049).
- 5.2 added an `EXPAND_CACHES` flag to `bpy.data.file_path_foreach` so render farms can find every dependent file `[V]` — [Blender 5.2 Python API notes](https://developer.blender.org/docs/release_notes/5.2/python_api/).

Tested here (bpy 5.3.0), `[E, tested]`:
- `bpy.types.Action` has no `fcurves`; it has `layers` and `slots`. `bpy_extras.anim_utils` provides `action_get_channelbag_for_slot`, `action_ensure_channelbag_for_slot`, `animdata_get_channelbag_for_assigned_slot`. `obj.keyframe_insert(...)` still works unchanged.
- `Scene.compositing_node_group` works in 5.3 but prints a deprecation warning ("expected to be removed in Blender 6.0"); its description says it returns the node group of the active scene compositor *effect*.
- `ImageFormatSettings.media_type` is `IMAGE`, `MULTI_LAYER_IMAGE` or `VIDEO`; `file_format` includes PNG, OPEN_EXR, OPEN_EXR_MULTILAYER, WEBP, AVIF, JPEG, FFMPEG; `color_depth` is 8/10/12/16/32.
- Defaults in a factory 5.3 scene: `cycles.samples` 4096 with adaptive sampling on at threshold 0.01; `use_animated_seed` False; denoise on, OpenImageDenoise, passes `RGB_ALBEDO_NORMAL`, prefilter `ACCURATE`, quality `HIGH`; `sample_clamp_indirect` 10, `sample_clamp_direct` 0; `blur_glossy` 1.0; pixel filter Blackman-Harris 1.5 px; motion blur off, shutter 0.5, position CENTER; `use_persistent_data` False; `use_overwrite` True; `use_placeholder` False; fps 24; `dither_intensity` 1.0.

Local copies, `[E, local copy]`:
- Blender 5.3.0's dependency list pins OpenImageDenoise 2.5.0, FFmpeg 8.1, x265 4.1, libvpx 1.15.2, OpenEXR 3.4.10 (`/tmp/cyc/versions_v5.3.0.cmake`; upstream `build_files/build_environment/cmake/versions.cmake`).

### Inferences
- Pin the render workflow to one Blender series and state it. 5.2 LTS is the conservative pin for farms; 5.3 is what is installed here. Any snippet that reads f-curves must use the channelbag helper, not `action.fcurves` `[E]`.
- FFmpeg command lines below do the RGB→YCbCr conversion explicitly in a filter *and* tag the same values, so they should behave the same before and after the 7.1 change. I could only run them on 6.1.1; nobody here has run them on 8.1 `[E]`.

### Gaps
- The 5.0 Python API release-notes page (`developer.blender.org/docs/release_notes/5.0/python_api/`) was blocked; the change log and two add-on issues stand in for it.
- I did not test on FFmpeg 8.1.x. A one-minute check on a machine with 8.1 (encode the colour-patch test in section 5, read the pixels back) would close this.

---

## 1. The standard motions and how each is built in Blender

### Takeaway
Rotate the piece under fixed lights and a fixed camera for the product loop; it is a physical turntable and every facet passes through every light. Build each motion from an empty used as a pivot plus two keyframes with linear interpolation, put the second key on frame N+1 and render frames 1..N, and bake any scripted per-link posing to keyframes if the file will ever go to a farm.

### Cited Findings
- GIA splits scintillation into *sparkle* (spots of light that flash as the diamond, the observer or the light source moves) and *pattern* (the arrangement of bright and dark areas, visible still or moving); diffuse lighting suppresses fire, spot lighting brings it out `[V]` — [GIA, Gems & Gemology Fall 2004](https://www.gia.edu/articles/fall-2004-grading-cut-quality-brilliant-diamond-moses).
- Cycles f-curve modifier: modes are No Cycles, Repeat Motion, Repeat with Offset (each copy shifted so its first key meets the previous last key) and Repeat Mirrored; count 0 means infinite; it must be the first modifier; with Repeat Motion or Repeat with Offset on both ends the curve counts as a simple infinite cycle and automatic Bézier handles adapt to it `[V, 4.5 LTS manual]` — [Blender manual, F-Curve Modifiers](https://docs.blender.org/manual/en/4.5/editors/graph_editor/fcurves/modifiers.html).
- KeyShot's Animation Wizard builds what the vendor video summary calls "seamless 360-degree rotations" `[V]` — [Novedge](https://novedge.com/blogs/design-news/keyshot-pro-tips-creating-turntable-animations-in-keyshot-studio).
- A jewellery studio's own list of animation types: ring reveal, stone macro, metal reveal, colourway sweep (camera and light held fixed while metal or stone changes), in-scene lifestyle, silent loop, full 360° rotation; exploded views appear only for a watch `[V]` — [XO3D](https://xo3d.co.uk/resources/3d-animation/jewellery-animation/).
- A studio guide sizes films by frame count at 24 fps: loop 6–10 s (144–240 frames), hero spot 15–30 s (360–720 frames); each extra colourway is a full extra set of frames, so it suggests a short colour swap instead; 48 fps slow motion doubles frames and render time `[V]` — [Maverick Frame field guide (PDF)](https://maverickframe.com/lead-magnets/services/en/fifteen-seconds-360-frames.pdf).
- One marketplace seller's 360° jewellery spin is 20 s at 25 fps, 1280×720, from a 3DM file `[V]` — [Fiverr gig](https://fiverr.com/mashriquecad/do-360-realistic-jewelry-animation).
- The existing workflow already poses bracelets by whole rigid links along a curve and re-centres on the bounding-box centre of the stone centres — `/home/claude/skillpush/.claude/skills/jewelry-render/SKILL.md` §3, §7 (local file).

Tested here (bpy 5.3.0, no render; script `/tmp/animtest/src/anim_api_test.py`), `[E, tested]`:
- New keys default to `BEZIER` (ease in and out). For a loop they must be set to `LINEAR`.
- Keys at frame 1 (0°) and frame N+1 (360°), N = 144, linear: frame 2 = 2.5°, frame N = 357.5°, frame N+1 = 360°. Step = 360/N exactly. With `fc.extrapolation = 'LINEAR'` frame N+2 = 362.5°; with a `CYCLES` modifier set to `REPEAT_OFFSET` both ways, frame 3N+1 = 1080°.
- The wrong version (last key on frame N) gives a 2.5175° step and makes frame N a duplicate of frame 1: one stuck frame per loop.
- Parenting to a pivot empty with `matrix_parent_inverse = pivot.matrix_world.inverted()` leaves the world matrix unchanged.
- `TRACK_TO` constraint with `track_axis='TRACK_NEGATIVE_Z'`, `up_axis='UP_Y'` on a camera; keyframes on `camera.data.dof.focus_distance` (data path `dof.focus_distance`); keyframes on a world Mapping node input (`nodes["Mapping"].inputs[2].default_value`); `SINE` interpolation with `EASE_IN_OUT`; `rotation_quaternion` + `location` keys per object (7 f-curves) all work.
- Enumerations: extrapolation `CONSTANT`/`LINEAR`; interpolation `CONSTANT, LINEAR, BEZIER, SINE, QUAD, CUBIC, QUART, QUINT, EXPO, CIRC, BACK, BOUNCE, ELASTIC`; easing `AUTO, EASE_IN, EASE_OUT, EASE_IN_OUT`; f-modifier types include `CYCLES`, `NOISE`, `LIMITS`, `STEPPED`; cycles modes `NONE, REPEAT, REPEAT_OFFSET, MIRROR`.

Working recipe that ran on 5.3.0 `[E, tested]`:

```python
import bpy, math
from bpy_extras import anim_utils

def fcurves_of(id_):                     # Blender >= 5.0: there is no action.fcurves
    ad = id_.animation_data
    return anim_utils.action_get_channelbag_for_slot(ad.action, ad.action_slot).fcurves

sc = bpy.context.scene; N = 144; sc.render.fps = 24
sc.frame_start, sc.frame_end = 1, N      # render 1..N only

piv = bpy.data.objects.new("pivot", None); sc.collection.objects.link(piv)
piv.location = centre                    # bbox centre of the stone centres, not an object origin
for o in root_objects:
    o.parent = piv; o.matrix_parent_inverse = piv.matrix_world.inverted()

piv.rotation_euler[2] = 0.0;      piv.keyframe_insert("rotation_euler", index=2, frame=1)
piv.rotation_euler[2] = math.tau; piv.keyframe_insert("rotation_euler", index=2, frame=N + 1)
fc = fcurves_of(piv).find("rotation_euler", index=2)
for k in fc.keyframe_points: k.interpolation = 'LINEAR'
fc.extrapolation = 'LINEAR'              # or: m = fc.modifiers.new('CYCLES'); m.mode_before = m.mode_after = 'REPEAT_OFFSET'
```

> Correction by the lead, tested in Blender 5.3.0 on 25 November 2026: as written, this recipe moves the piece. `piv.matrix_world` is still the identity when it is read straight after `piv.location = centre`, so the piece jumps by `centre`. Call `bpy.context.view_layer.update()` after setting the pivot's location and before the parenting loop; with that line the piece stays where it was. Also, the spin-frame command further down makes JPEGs straight from transparent PNGs, which come out on black; lay the frames over white first, as the encode commands do.

### Inferences
All `[E]` unless marked.

**Which thing rotates.** The brief's premise ("diamonds sparkle only when the stone moves relative to the lights") needs one correction: GIA's definition has three movers, so a camera orbit also produces flashes. The three choices differ in what stays attached to what:

| Choice | Equivalent to | What the viewer sees | Use |
|---|---|---|---|
| Piece rotates; camera and lights fixed | A motorised turntable in a photo studio | Key light and shadow stay put on screen; every facet and every side of the metal passes through every light, so both *which facets are lit* and *which lit facets face the lens* change | The product-page loop. This is what "360° turntable" means in the studio pages above, though none of them states the mechanism |
| Camera orbits; piece and lights fixed | Walking around a lit object | Lighting is glued to the piece: the dark side stays dark and comes round to face the viewer; the floor, shadow and backdrop sweep through frame. Flashes still change because the view direction changes, but the set of facets receiving light never does | Short arcs (30–90°) and hero shots, where parallax against a set is wanted |
| Environment or lights rotate; piece and camera fixed | A light sweep | The picture is locked; only reflections and flashes travel | The "sparkle pass", §3 |

Rotating the piece is the same picture as orbiting camera *and* lights *and* world together, provided the floor is featureless. On a textured surface (marble, velvet nap) the surface must turn with the piece, like the disc of a turntable, or the piece will skate over the veins.

**Loop arithmetic.** N frames cover 0 to 360 − 360/N degrees. Key the pose on frames 1 and N+1, render 1..N. Loops must run at constant speed; any easing puts a visible pause at the wrap. Use easing only on one-shot moves.

**Frame counts that serve both a video and a spinner.** Pick N divisible by 72: 144 (6 s at 24 fps; every 2nd frame gives a 72-frame spinner, every 4th a 36-frame one), 216 (9 s at 24 fps; 7.2 s at 30), 288, 360 (12 s at 30 fps; 1° per frame). 180 frames (6 s at 30) gives 36 but not 72.

**Per-motion build and typical numbers.**

| Motion | Build | Interpolation | Typical length |
|---|---|---|---|
| Turntable loop | Pivot empty at the visual centre, piece parented, Z rotation 0→2π on frames 1 and N+1 | LINEAR, linear extrapolation or Cycles modifier | 6–12 s; 144–360 frames; 24 or 30 fps |
| Rocking loop | Same pivot, θ = A·sin(2πt/T), A = 10–20°, baked per frame or two SINE keys with a Cycles modifier | SINE | 4–6 s; loops with no seam and no stuck frame because the motion is periodic |
| Camera orbit | Second empty at the pivot, camera parented at a radius, `TRACK_TO` the pivot; rotate the empty | LINEAR for full circles, eased for arcs | 30–90° over 3–5 s |
| Light sweep | Lights parented to an empty at the piece and rotated ±60°, or a gradient card translated across, or the world Mapping node's Z rotation keyed | LINEAR or SINE | 3–6 s |
| Push-in | Camera location keys (dolly, not zoom, to keep perspective honest), optional `TRACK_TO` | SINE ease in/out | 2–4 s; 48–120 frames |
| Rack focus | `camera.data.dof.focus_distance` keys, or `dof.focus_object` set to an empty that moves from clasp to centre stone; f/2.8–f/5.6 | SINE | 1–2 s inside a longer shot |
| Macro fly-over along a tennis line | Camera on a `FOLLOW_PATH` constraint over a curve offset above the stone centres, `TRACK_TO` an empty that runs a few stones ahead; 100 mm lens, f/4 | LINEAR with eased ends | 4–8 s |
| Curl / drape (bracelet, chain) | The existing rigid-link frames with curvature k(t); set each link's `matrix_world` per frame | cosine ease on k | 60 % of the shot, then a hold (as today) |
| Clasp opening | Empty on the hinge pin axis taken from the CAD pin cylinder; tongue or lid parented; one Euler axis keyed | SINE ease | 1–2 s |
| Exploded / assembly | Each rigid group translated along its own axis (stones along the table normal, heads up, shank down), starts staggered 2–4 frames, then reversed | ease out going apart, ease in coming together | 3–5 s out, hold 1 s, 2–3 s back |
| Metal or stone swap | Keyframe the Principled Base Color (metals differ only in base colour in this workflow's table) or the absorption colour, over 8–15 frames; or render two aligned sequences and cross-fade (§5) | LINEAR | 0.3–0.6 s per change |

- A metal swap by keyframed base colour costs no extra frames; rendering each colourway separately costs a full sequence each (the studio guide above makes the same point about colourways) `[E]` + [Maverick Frame PDF](https://maverickframe.com/lead-magnets/services/en/fifteen-seconds-360-frames.pdf) `[V]`.
- Scripted posing has two delivery forms. A `frame_change_pre` handler that re-poses links works only where the script runs. Baking location + quaternion keys for every link on every frame (LINEAR, one key per frame) makes the `.blend` self-contained, which a farm that forbids user scripts requires (SheepIt does, §4). Use quaternions so a link passing 180° does not flip.
- Frame rate: 24 fps is the cheapest that reads as film; 30 fps matches most web video and phone screens; 60 fps doubles the frame bill and is worth it only for sparkle-critical close-ups (§3).

### Gaps
- KeyShot's own documentation and its forum threads on jewellery turntables and animated sparkle (`community.keyshot.com/forum/t/how-to-make-diamonds-sparkle-in-an-animations/256`, `.../gems-shining-during-animation/9297`) sit behind a login; no KeyShot comparison beyond the Novedge summary.
- No source I could open states outright that product videos rotate the piece rather than the camera; that row of the table is reasoning plus the studios' use of the word "turntable".
- The Blender manual pages on keyframes, extrapolation and constraints were blocked; the API behaviour above is from running 5.3.0, not from the manual.

---

## 2. Flicker and temporal stability

### Takeaway
Blender 5.3 has no temporal denoiser in its normal render path: OpenImageDenoise 2.5 and OptiX work one frame at a time, the new DLSS option is viewport-only, and the one temporal route (OptiX through a Python-only operator on multilayer EXR files) is NVIDIA-only and softens detail. Flicker is therefore controlled with samples, guiding passes and clean highlights, with the seed choice as a secondary lever that depends on how much of the frame is static.

### Cited Findings
- Manual, Sampling page: animating the seed is recommended for animations because noise that changes is less noticeable; noise threshold typically 0.1 to 0.001, 0 = automatic; denoise passes None / Albedo / Albedo + Normal, "at least" Albedo recommended because colour-only denoising blurs detail at low samples; prefilter None (assumes clean passes), Fast, Accurate (more detail, slower); OpenImageDenoise "typically" highest quality, Automatic prefers it over OptiX; Scrambling Distance trades randomness between pixels for GPU speed and is not compatible with blue-noise; Sample Subset (offset, length) splits one frame's samples across machines, merged with `bpy.ops.cycles.merge_images` `[V, 4.5 LTS manual]` — [Blender manual, Cycles Sampling](https://docs.blender.org/manual/en/4.5/render/cycles/render_settings/sampling.html).
- OptiX temporal denoising arrived in Blender 3.1 as `bpy.ops.cycles.denoise_animation()`, with no UI: set output to OpenEXR MultiLayer, enable Denoising Data, render, then run the operator; it uses motion vectors to link frames `[V]` — [BlenderNation, Jan 2022](https://www.blendernation.com/2022/01/10/optix-temporal-denoising-support-added-to-blender-3-1-alpha/).
- User tests in the developer forum thread: the temporal OptiX result was steadier but lost fine detail against standard OIDN and plain OptiX; turning Animated Seed off improved stability but left "structured patterns across frames" at low samples; the Vector pass is only written with motion blur off; the operator freezes the UI while it runs `[V, forum posts, undated in the fetched text]` — [devtalk thread, p. 6](https://devtalk.blender.org/t/taking-a-look-at-optix-7-3-temporal-denoising-for-cycles/18656?page=6), [post 104](https://devtalk.blender.org/t/taking-a-look-at-optix-7-3-temporal-denoising-for-cycles/18656/104).
- Intel announced Open Image Denoise 3 with temporal denoising aimed at animation flicker, for release in the second half of 2026 `[V, news article of 1 Feb 2026]` — [DevBytes](https://devbytes.co.in/news/intels-open-image-denoise-v3-is-focused-on-reducing-animation-flicker); CG Channel carried the same news on 30 Jan 2026 `[S]` — [CG Channel](https://www.cgchannel.com/2026/01/open-image-denoise-3-will-support-temporal-denoising/).
- Blender 5.3's DLSS denoiser (DLSS 4.5 Ray Reconstruction, NVIDIA driver 620+) is for the Cycles viewport only `[V, vendor blog]` — [Maverick Frame](https://maverickframe.com/blog/blender-latest-version/); pre-release coverage framed it around the viewport and noted its temporal-stability claims were untested `[V]` — [Digital Production, June 2026](https://digitalproduction.com/2026/06/03/nvidia-brings-dlss-denoising-to-blender-5-3/).
- A render-farm blog (checked 25 Nov 2026 per its own text) explains flicker as too few samples leaving the denoiser to guess differently each frame; advises lowering the noise threshold or raising max samples, Albedo + Normal, prefilter Accurate, quality High, animated seed on, and playing three or four consecutive frames before committing `[V]` — [iRender](https://irendering.net/blender-cycles-denoising-animation-oidn-optix/).
- Community reports disagree with the manual once a denoiser is on: one poster believes a changing seed is advised *against* with denoising because it can cause flicker; another saw static noise in part of the frame with a fixed seed while other areas still flickered `[V, forum, 2019–2021, no measurements]` — [Blender Artists 1245198](https://blenderartists.org/t/render-flickering-on-animation-after-denoise/1245198/6), [Blender Artists 1149358](https://blenderartists.org/t/static-seed/1149358).
- An OptiX bug that left later animation frames un-denoised was traced to an NVIDIA driver and fixed in driver 546.33 `[V]` — [Blender issue 114468](https://projects.blender.org/blender/blender/issues/114468).

Tested or read locally:
- `cycles.denoise_animation` exists in 5.3.0; its description: denoises a rendered sequence using current scene and view-layer settings, needs denoising data passes and OpenEXR multilayer output; arguments `input_filepath`, `output_filepath` (in place if empty); it aborts if any frame of the scene range is missing. It is not referenced anywhere in the Cycles UI file. A view-layer option `denoising_store_motion_passes` ("for temporal denoisers") exists beside `denoising_store_passes` `[E, tested on bpy 5.3.0 and read in its bundled add-on]`.
- In the 5.3.0 Cycles add-on the `DLSS` item is offered only through `preview_denoiser`; the render denoiser list is OpenImageDenoise and OptiX `[E, read in the bundled add-on]`.
- Blender 5.3.0 and 5.2.0 both pin OpenImageDenoise 2.5.0; the OIDN changelog copy fetched today ends at v2.5.1 with no v3 entry `[E, local copy: /tmp/cyc/versions_v5.3.0.cmake, /tmp/cyc/oidn_changelog.md]`.
- The 5.3 compositor Denoise node has inputs Image, Albedo, Normal, HDR, Prefilter (Accurate), Quality (Follow Scene): per-frame OIDN, no temporal input `[E, tested on bpy 5.3.0]`.

### Inferences
All `[E]`. A separate researcher is measuring fixed versus animated seed on this machine; treat that measurement as the authority and this as the reasoning to check it against.

- **Why per-frame denoising flickers.** The denoiser is a function of one noisy frame. Where the input is under-sampled it invents low-frequency structure, and a different noise pattern produces different structure, so the residue "boils" at the frame rate. Flat, slowly varying regions (white floor, shadow penumbra, backdrop gradient, large polished metal faces) show it most; faceted stones hide it because they change every frame anyway.
- **Seed, without denoising.** Animated seed looks like film grain; fixed seed looks like dirt on the lens that the piece slides behind. Animated wins, as the manual says.
- **Seed, with denoising.** With a fixed seed every pixel whose scene content does not change gets bit-identical input, so denoised output there is identical frame to frame: zero flicker in static regions, and the video encoder spends almost nothing on them. In a locked-camera turntable on a shadow catcher that is most of the frame. On the moving piece a fixed seed gives no benefit and can leave a faint screen-fixed pattern at low samples (the forum's "structured patterns"). With an animated seed the residue changes everywhere every frame. So: locked camera with large static areas → fixed seed is the safer default *when denoising*; camera moves (everything changes) → animated seed. Neither rescues an under-sampled frame.
- **What actually reduces flicker, in order of effect:** (1) more samples or a lower noise threshold, until the *un-denoised* frame is only mildly noisy; (2) Albedo + Normal passes with Accurate prefilter (already the 5.3 default); (3) a floor on adaptive sampling (`adaptive_min_samples` 64–128) so the per-pixel sample count does not swing between frames near the threshold; (4) larger, softer emitters for anything that lights the floor; (5) no post effects that amplify residue (glare, sharpening) before the picture is clean.
- **Adaptive sampling across frames.** The stop decision is made per pixel per frame from a noise estimate, so the same pixel can stop at different sample counts on neighbouring frames. That modulates residual noise in time. A tighter threshold (0.005–0.01) and a minimum sample floor shrink the swing; a pure fixed sample count removes it at a cost.
- **Fireflies from stones.** Light reaches the camera through a gem only by BSDF sampling (next-event estimation cannot connect through a refractive surface), so a small bright emitter seen through facets is found rarely and arrives with a huge weight: a firefly. Dispersion splits it into coloured ones. Controls, from least to most harmful to sparkle: (a) make "point" lights small discs of 1–3° apparent size, never true points; (b) Filter Glossy (`blur_glossy`): the workflow uses 0.2, the 5.3 default is 1.0; (c) indirect clamp: default 10, workflow 20. Every flash through a stone is an indirect path, so the clamp caps exactly the energy that makes sparkle and bloom; going below about 10 flattens stones; (d) leave direct clamp at 0 so light sources and their first reflection keep their real brightness; (e) caustics on the floor: the workflow turns them off, which is right for animation since floor caustics are the noisiest thing in a jewelry frame.
- **Motion blur.** Default off, shutter 0.5 frames, centred `[E, tested defaults]`. Keep it off for turntables: at 1–2.5° a frame the rim of a ring moves 5–10 px at 1080p, crisp frames read as a clean product shot, every frame stays usable as a still or spinner image, the Vector pass stays available (it is not written with motion blur on, per the forum thread above), and blur adds noise exactly where facets are. The one argument for a short shutter (0.2–0.3) is temporal anti-aliasing of flashes (§3).
- **Fine geometry (prongs, milgrain, pavé beads).** Sub-pixel bright details crawl as they cross pixel boundaries. The 1.5 px Blackman-Harris default is already a good anti-crawl filter; do not narrow it for "sharpness" in animation; widening to 1.8–2.0 trades a little softness for less crawl. The stronger fix is resolution: render 1.25–1.5× and downscale with Lanczos in FFmpeg, or frame tighter so a prong is at least 3 px wide.
- **Sample budget for a clean 1080p frame.** With OIDN and guiding passes, 256–512 samples at a 0.01 threshold is the working range for metal and white diamonds on white; coloured stones with absorption, dispersion, and dark-background scenes need 512–1024. Research 18 budgets 192 (standard) and 256 (final) samples for a 150-frame turntable (`docs/research/18-low-end-machines.md` §6.3); for animation I would treat 256 as the floor and decide by playing 8–10 consecutive full-size frames, not by a still.
- **Post-process fallbacks.** FFmpeg's temporal filters (`hqdn3d`, `atadenoise`, `tmix`) will calm a boiling background but average away single-frame flashes, which is the sparkle. If used at all, mask them to the background.

### Gaps
- No measured comparison of fixed versus animated seed for a denoised jewelry turntable exists in any source I could open; forum evidence is anecdotal and conflicting. The local Blender test should settle it; I ran none.
- Whether Open Image Denoise 3 has shipped: the changelog copy ends at 2.5.1 and Blender 5.3 bundles 2.5.0, so it is not in Blender today; I could not open Intel's or CG Channel's pages to confirm the release state.
- Blender's official 5.3 Cycles release notes were not reachable (the local copy is a 404 stub), so "DLSS is viewport-only" rests on the shipped add-on code and one vendor blog.
- The manual pages for Motion Blur, Film (pixel filter), Light Paths (clamping, filter glossy) and Reducing Noise were blocked; defaults above come from the running 5.3.0 build, the guidance from working knowledge.
- I found no source giving a sample count for flicker-free jewelry frames; the figures above are estimates.
- Third-party temporal tools (a "Super Image Denoiser" node add-on, E-Cycles' temporal denoiser, DaVinci Resolve or Neat Video in post) appeared only as titles or from memory `[S]`/`[E]`; none was examined.

---

## 3. Sparkle in motion

### Takeaway
Sparkle is small bright sources switching on and off in facets as stone, light or lens moves, so it needs small hard lights against dark surroundings and slow relative motion. The limiting number is degrees of rotation per frame: with pin-sized lights a 5-second full turn at 30 fps strobes, and about 1° a frame or less is needed for flashes to last more than one frame.

### Cited Findings
- Sparkle appears when diamond, observer or light moves; spot or point lighting accentuates fire, diffuse lighting suppresses it; GIA's own viewing box combines diffuse fluorescent light for brightness with LEDs for fire `[V]` — [GIA, Fall 2004](https://www.gia.edu/articles/fall-2004-grading-cut-quality-brilliant-diamond-moses).
- A KeyShot jewellery tutorial is built around placing several kinds of light "pins" in the HDRI editor, adding dark reflections, and adding bloom; the page gives no numbers `[V]` — [Will Gibbons](https://www.willgibbons.com/blog/jewelry).
- A jewellery studio stresses that polished gold and platinum expose every lighting flaw and calls for careful HDRI choice plus directed catch-lights, reviewed at the size the film will be watched `[V]` — [XO3D](https://xo3d.co.uk/resources/3d-animation/jewellery-animation/).
- The existing workflow lights with a banded dark/bright procedural dome plus 6–8 emissive strips and a top softbox, on the grounds that an all-white environment makes diamonds flat — `SKILL.md` §6 (local file).

Tested here (bpy 5.3.0), `[E, tested]`:
- The 5.3 Glare node has no properties; its inputs are Image, Type (default Streaks), Quality (Medium), Threshold (1.0), Smoothness (0.1), Clamp, Maximum (10), Strength (1.0), Saturation, Tint, Size (0.5), Streaks (4), Streaks Angle, Iterations (3), Fade (0.9), Color Modulation (0.25), Diagonal, Sun Position, Jitter, Kernel; outputs Image, Glare, Highlights. Scripts that set `node.glare_type` or `node.threshold` fail on 5.x; set `node.inputs["Threshold"].default_value` instead.

### Inferences
All `[E]`.

- **Light rig for motion.** Keep the strip softboxes for metal form, and add 6–20 small emitters (discs 10–30 mm across at 0.5–1 m, i.e. 1–3° apparent size, 20–100× the strip radiance) scattered over the upper hemisphere, or bake the same as bright dots in the procedural dome. Hide them from camera and from diffuse and shadow rays so they add flashes without hardening shadows.
- **Why rotation speed matters (the arithmetic).** A facet acts as a mirror: turning it by δ swings the reflected direction by 2δ. A light of apparent diameter α therefore stays in one facet for α/2 of rotation. At s degrees per frame the flash lasts (α/2)/s frames:

| Motion | s (°/frame) | Flash from a 3° light | Flash from a 6° light |
|---|---|---|---|
| Full turn in 5 s at 30 fps (150 frames) | 2.4 | 0.6 frame: caught or missed at random, reads as strobing | 1.25 frames |
| Full turn in 6 s at 24 fps (144 frames) | 2.5 | 0.6 frame | 1.2 frames |
| Full turn in 12 s at 30 fps (360 frames) | 1.0 | 1.5 frames | 3 frames |
| Rocking ±15° over 5 s at 30 fps | 0.63 peak | 2.4 frames or more | 4.8 frames or more |
| Full turn in 6 s at 60 fps (360 frames) | 1.0 | 1.5 frames | 3 frames |

  Refracted paths inside a brilliant have other angular gains, but the order of magnitude holds. For natural-looking sparkle aim for flashes of 2–4 frames: slow the motion to ≤ 1° a frame, enlarge the sparkle lights to 5–8°, or give them a soft edge so a flash ramps in and out.
- **Consequence for the product page.** A fast full spin (≥ 2° a frame) should be lit for form and pattern with larger sources and treated as a shape video. The sparkle shot is a different, slower motion: a rocking loop, a 60–90° arc, or a light sweep over a still piece. The light sweep is the cheapest of the three because geometry and camera never change.
- **A short shutter as temporal anti-aliasing.** With motion blur at 0.2–0.3 a flash that falls between frames is still recorded at reduced strength, which smooths strobing. It costs render time, softens moving edges slightly and removes the Vector pass. Worth testing only on the sparkle shot.
- **Glare.** Run it after denoising, on scene-linear data, with a threshold far above 1.0 (3–10) so only true flashes bloom and white metal does not. Fog Glow or Bloom at small size reads as lens bloom; 4- or 6-point streaks read as an effect and date the image. Keep the mix low enough that a frame with the effect bypassed still looks finished. Glare multiplies whatever flicker is in the highlights, so it is the last thing to add and the first to remove when a shot boils.
- **Frame rate.** 24 or 30 fps is fine once the per-frame angle is right; 60 fps buys smoother flashes at double the frames and is only justified for a hero close-up.

### Gaps
- I found no openable source that quantifies rotation speed, light size or frame rate for diamond sparkle in video; the table is my own geometry.
- KeyShot's guidance on animated sparkle is behind the forum login.
- The Glare node manual page was blocked; type names beyond the default (Bloom, Fog Glow, Ghosts, Simple Star, Sun Beams, Kernel) are from memory, not verified on 5.3.

---

## 4. Render time and cost

### Takeaway
A turntable is frames × pixels × samples; the cheap wins are fewer frames (24 fps, 144 frames), 1080p rather than 4K, persistent data, and parallel frame ranges on rented GPUs, which earlier research prices at well under a dollar for a 5-second 1080p turntable. Always render numbered images with overwrite off and placeholders on, so any number of machines can share one folder and a crash costs one frame.

### Cited Findings
- Earlier research (not repeated): a 150-frame 1080p turntable at 192–256 samples is 1–7 hours on an M2 Air GPU and about 7–70 minutes, $0.15–1.05, on a rented T4, L4 or 4090; 150 frames split over 10 containers finish in 1–3 minutes for the same money; rented GPU and farm prices as of 25 November 2026 — `/home/claude/pave-research/docs/research/18-low-end-machines.md` §6.1, §6.3, §7.1–7.3 (local file).
- Blender's manual gives the "primitive render farm" recipe: share the output directory, turn Overwrite off and Placeholders on, start as many machines as wanted on the same file; a frame number is appended with four digits by default and `#` characters set the padding `[V, manual page reached through blender.org, version not shown]` — [Blender manual, Output](https://www.blender.org/manual/en/render/output/properties/output.html).
- Command line: `-b` background; `-a` renders start to end inclusive; `-s`, `-e`, `-j` set start, end and step; `-f` takes a list (`1,3,5`) or an inclusive range (`1..10`); `-o` sets the path with `#` padding and `//` meaning relative to the `.blend`; arguments run in the order given, so output and frame options go before `-a` or `-f` and after the file; after `--`, `--cycles-device` accepts CPU, CUDA, OPTIX, HIP, ONEAPI, METAL (append `+CPU` for both) `[V, manual page reached through blender.org, version not shown]` — [Blender manual, Command Line Arguments](https://www.blender.org/manual/de/advanced/command_line/arguments.html).
- Sample Subset splits one frame's samples across machines and `cycles.merge_images` joins them; max samples must stay at the total `[V]` — [Blender manual, Cycles Sampling (4.5)](https://docs.blender.org/manual/en/4.5/render/cycles/render_settings/sampling.html).
- Flamenco is Blender's own render manager for small studios and home use on hardware you own: a Manager, Workers and a Blender add-on; it assumes storage that every machine sees at the same path the moment a file is written (a NAS), so Dropbox, Google Drive, OneDrive and Syncthing are unsupported, and on Windows shares must be mapped to drive letters; GPU choice lives in each Worker's Blender preferences `[V]` — [Flamenco FAQ](https://flamenco.blender.org/faq/), [Flamenco shared storage](https://flamenco.blender.org/usage/shared-storage/).
- Flamenco's "Simple Blender Render" job renders a frame range in chunks (chunk size default 1), refuses video output formats, and can make a preview video from the images with FFmpeg; a "Single Image Render" job splits one frame into tiles `[V]` — [Flamenco built-in job types](https://flamenco.blender.org/usage/job-types/builtin). The FAQ still says one image across several Workers is unsupported; the two pages disagree `[V]`.
- SheepIt (free, volunteer machines): project upload limit 2,048 MB; owners may not run their own scripts; frames are sent to other people's computers; a frame is split either into tiles ("chessboard", no compositing) or into reduced-sample layers rendered with different seeds and recombined; NVIDIA GPUs only since January 2023; points are charged at 10 per reference-minute and earned at 38; OpenEXR output is limited (animations only, ≤ 4096×2160); the FAQ names Blender 5.1 as the version needed to contribute and says stable releases are added as they appear `[V]` — [SheepIt FAQ](https://www.sheepit-renderfarm.com/faq).
- GarageFarm: GPU $0.004 / $0.006 / $0.012 per OctaneBench-hour by priority; CPU $0.024 / $0.036 / $0.072 per GHz-hour; node examples from $1.12–6.73 an hour (RTX 4000 Ada) to $3.22–25.76 (96 GB card); $25 trial credit with a 10-node cap; submission through its renderBeamer app and plug-in `[V]` — [GarageFarm pricing](https://garagefarm.net/pricing).

Tested here (bpy 5.3.0), `[E, tested]`:
- `render.use_persistent_data`: keeps render data for faster re-renders and animation at the cost of memory. `use_overwrite` (default True), `use_placeholder` (default False, "similar to Unix touch"). `render.frame_path(frame=7)` with `filepath="//frames/tt_####"` returns `frames/tt_0007.png`.
- `cycles.use_sample_subset`, `sample_offset`, `sample_subset_length` exist; `scene.frame_step` exists.

Read locally:
- Blender 5.3.0's argument source registers `-a`, `-s`, `-e`, `-j`, `-f`, `-o`, `-E`, `-F`, `-t`, `-P`, `--python-expr`, `--python-exit-code`, `-X/--factory-startup`, `--offline-mode`, `-c/--command`; the `-f` help text gives the comma list and the `..` range `[E, local copy: /tmp/cyc/g_blender_blender_v5.3.0_source_creator_creator_args.cc]`.

### Inferences
All `[E]`.

- **Budget arithmetic.** Work per frame in millions of pixel-samples (the unit research 18 uses): 1920×1080 × 256 = 531; 1280×720 × 256 = 236; 1080×1080 × 256 = 299; 3840×2160 × 256 = 2,123. A square 1080 loop is 56 % of the cost of a 16:9 one and suits a product page. Adaptive sampling stops white background early, so real cost depends on how much of the frame the piece fills.
- **Persistent data.** Without it every frame rebuilds the scene (geometry upload, acceleration structure, shader compile): a few seconds a frame that does not shrink with fewer samples. With it, a rotating pivot or a moving camera re-syncs transforms only. Turn it on for every animation; watch memory on 8–16 GB machines (research 18 §6.2 records an out-of-memory case with it on).
- **"Render the background once" does not work,** for three reasons: the piece mirrors the floor and environment, so its pixels depend on them; the floor carries the piece's shadow, contact occlusion and reflection, which move every frame; and with a moving camera nothing is static at all. On a white e-commerce shot there is no background to save anyway (film transparent, shadow catcher). What does help is a render border around the piece's screen bounds with crop on, and a fixed seed so that truly static pixels at least compress to nothing.
- **Previews.** Tiny-resolution key frames first (as the workflow already says), then a stepped pass: `-j 6` on a 144-frame turn gives 24 frames, enough for a contact sheet and a 1-second flipbook. Then 8–10 *consecutive* frames at final settings to judge flicker, which stepping cannot show.
- **Parallel ranges.** Frames are independent, so k machines give k× speed with no loss. Either give each machine a range (`-s 1 -e 48 -a`), or point them all at one folder with overwrite off and placeholders on and let them interleave. With an animated seed Cycles derives each frame's seed from the frame number, so results do not depend on which machine rendered which frame.
- **Placeholder trap.** A machine that dies leaves a zero-byte file that every other machine will skip. Before declaring a sequence complete, delete zero-byte frames and re-run (check script in §7).
- **What a farm or rented GPU needs.** One `.blend` with everything packed (`bpy.ops.file.pack_all()`), relative paths, the exact Blender version pinned (prefer the LTS the farm lists), image-sequence output with `####` in the path, animation baked to keyframes with no handler scripts, GPU device and denoiser set in the file, and a frame range. For a rented GPU the workflow's own kit (`scene.py --anim --frames --frame_start/step --gpu`) already fits; add `--frame_end` so ranges can be dealt out.
- **Choice.** For a jeweler's unreleased designs, volunteer farms are out on confidentiality (research 18 reached the same verdict). Commercial farms are convenient but 2–4× raw GPU price. Rented per-second GPUs running the existing headless script are the cheapest and keep the files private. Flamenco is the answer only if there are several owned machines on one network share.
- **GPU or CPU.** GPU by a wide margin for this workload; see research 18 §6.1 for the measured ratios.

Command shapes (argument names verified above; not executed here because no `blender` binary is installed):

```bash
# whole range, resumable, on GPU
blender -b tt.blend -o //frames/tt_#### -F PNG -s 1 -e 144 -a -- --cycles-device OPTIX
# one slice of the range on another machine
blender -b tt.blend -o //frames/tt_#### -s 49 -e 96 -a -- --cycles-device OPTIX
# stepped preview, every 6th frame
blender -b tt.blend -o //preview/tt_#### -s 1 -e 144 -j 6 -a
# re-render named frames
blender -b tt.blend -o //frames/tt_#### -f 17,53,90..92
```

```python
r = scene.render
r.use_persistent_data = True
r.use_overwrite = False; r.use_placeholder = True      # shareable and resumable
r.image_settings.media_type = 'IMAGE'                  # Blender 5.x
r.image_settings.file_format = 'PNG'; r.image_settings.color_mode = 'RGBA'; r.image_settings.color_depth = '16'
r.filepath = "//frames/tt_####"
```

### Gaps
- RebusFarm and Fox Renderfarm current GPU prices were not opened today (research 18 could not read Fox's GPU rates either). Only GarageFarm and SheepIt were re-read.
- Which Blender versions each commercial farm supports on 25 November 2026 (in particular 5.3, two weeks old) is not stated on the pages I read.
- How much persistent data saves per frame on this workflow's scenes is unmeasured; the other researcher's Blender tests could time it.
- The Flamenco version number was not on the pages fetched.

---

## 5. Output and encoding

### Takeaway
Render numbered 16-bit PNGs (or multilayer EXR when denoising or glare will be redone later), never a video file, then encode with FFmpeg using an explicit BT.709 conversion and sRGB transfer tag; ship H.264 `yuv420p` MP4 as the universal file and AV1 or HEVC as the smaller first choice. All command lines below ran on FFmpeg 6.1.1 today and the resulting files were checked with ffprobe.

### Cited Findings
- H.264 guide: CRF 0–51, default 23, sane range 17–28, 17–18 visually lossless or nearly; ±6 roughly halves or doubles size; use the slowest preset you can tolerate (slow ≈ +40 % time over medium); tunes include `animation` and `stillimage`; many players handle only 4:2:0, so use `yuv420p`; `-movflags +faststart` moves the index to the front so playback can begin before the download ends; leave the profile to x264 `[V]` — [FFmpeg wiki, H.264 (mirror)](https://fftrac-bg.ffmpeg.org/wiki/Encode/H.264).
- ASWF guidance for image sequences: convert RGB to BT.709 Y'CbCr explicitly (zscale preferred, swscale `scale=out_color_matrix=bt709:out_range=tv` widely used), tag primaries and matrix BT.709 and the transfer as sRGB (`iec61966-2-1`), limited range; CRF about 18 for H.264 because 23 is "a little on the low quality side"; 8-bit `yuv420p` is the most widely supported, 10-bit avoids most banding; 4:2:2 H.264 did not play in Firefox `[V]` — [ASWF, H.264](https://academysoftwarefoundation.github.io/EncodingGuidelines/Encodeh264.html), [ASWF, colour](https://academysoftwarefoundation.github.io/EncodingGuidelines/ColorPreservation.html).
- Browser colour: with the sRGB transfer tag a video matches an sRGB PNG in Safari and is the most reliable choice in Chrome; with the BT.709 transfer tag Safari renders at about gamma 1.95 (lighter than the still) while Chrome on Windows treats it like sRGB; gamma 2.2 tagging misbehaves in Safari; tags live in the MP4 `colr` box `[V]` — [ASWF, web colour](https://academysoftwarefoundation.github.io/EncodingGuidelines/WebColorPreservation.html).
- Range: limited range is the norm; 8-bit limited has only 219 luma levels so gradients can band; prefer 10-bit limited over 8-bit full; if full range is used it needs `-color_range pc` or FFmpeg 7.1 may convert back `[V]` — [ASWF, colour](https://academysoftwarefoundation.github.io/EncodingGuidelines/ColorPreservation.html).
- HEVC: Apple players need `-tag:v hvc1`; x265 default CRF 28 is low quality, 22 suggested; rough mapping x265 CRF ≈ 1.09 × x264 CRF − 4.19; HEVC played in Safari, Chrome and Firefox on macOS in their tests, but browsers lean on OS or GPU decoders so support varies by machine `[V]` — [ASWF, HEVC](https://academysoftwarefoundation.github.io/EncodingGuidelines/EncodeHevc.html).
- AV1: SVT-AV1 CRF 0–63, default 35, presets 0–13 (higher is faster), the fastest of the three encoders; libaom `-cpu-used` up to 6; AV1 goes in MP4 or WebM, not MOV; Chrome, Edge, Firefox and Opera play it, Safari only on Apple hardware with an AV1 decoder; up to about 50 % more efficient than H.264 `[V]` — [ASWF, AV1](https://academysoftwarefoundation.github.io/EncodingGuidelines/EncodeAv1.html).
- VP9: `-b:v 0` with `-crf` is constant-quality mode; `-row-mt 1` is off by default and nearly doubles speed; `-quality good`, `-cpu-used 2`; alpha is carried as `yuva420p`; 8- and 10-bit play in Chrome, Firefox and Safari `[V]` — [ASWF, VP9](https://academysoftwarefoundation.github.io/EncodingGuidelines/EncodeVP9.html).
- Transparent video on the web: VP9-with-alpha WebM works in Chrome and Firefox, not Safari (Safari plays the VP9 but drops the alpha); HEVC-with-alpha works in Safari; so list the HEVC source first; AV1 video has no alpha; animated AVIF has alpha but performs badly; HEVC with alpha can only be encoded on macOS (`hevc_videotoolbox ... -alpha_quality ... -tag:v hvc1`), and that route gave files about three times the VP9 size (3.4 MB against 1.1 MB in the author's example); the robust alternative is one ordinary video with colour stacked above a greyscale alpha, combined in WebGL (the author's `stacked-alpha-video` component): 460 kB as AV1 in the same example `[V]` — [Jake Archibald, 2024](https://jakearchibald.com/2024/video-with-transparency/).
- Apple's own description: HEVC with alpha stores a base colour layer and an alpha layer in one track; decoders that do not know the alpha layer show the base layer only; playback from iOS 13, tvOS 13, macOS Catalina, including Safari; encoding through AVAssetWriter, VTCompressionSession or AVAssetExportSession "with Alpha" presets; alpha quality is a 0–1 parameter; premultiplied alpha is the default `[V]` — [Apple WWDC19 session 506](https://developer.apple.com/wwdc19/506).
- GIF versus video: Google's example goes from a 3.7 MB GIF to a 551 KB MP4 and a 341 KB WebM; the element that behaves like a GIF is `<video autoplay loop muted playsinline>`; the browser takes the first `<source>` it can play, so order them smallest-first `[V]` — [web.dev](https://web.dev/articles/replace-gifs-with-videos.md.txt).
- Studio deliverables are MP4 or MOV for spins and animation; 1080p or 4K; 16:9, 9:16 and 1:1 cut-downs, with vertical and square versions re-rendered from new cameras, not cropped `[V]` — [7CGI](https://7cgi.com/jewelry-rendering/), [Maverick Frame PDF](https://maverickframe.com/lead-magnets/services/en/fifteen-seconds-360-frames.pdf).

Tested here, FFmpeg 6.1.1, on a synthetic 150-frame 1920×1080 RGBA sequence (`frames/f_0001.png` …), `[E, tested]`. Every output was checked with ffprobe for codec, tag, pixel format, colour fields, frame count and duration.

Inputs are RGBA PNGs (film transparent), so the first step lays them over white; drop the `color`/`overlay` part for opaque frames.

```bash
# Common pieces
IN='-framerate 30 -start_number 1 -i frames/f_%04d.png -f lavfi -i color=c=white:s=1920x1080:r=30'
FLT='[1:v][0:v]overlay=shortest=1:format=auto,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p'
TAGS='-color_range tv -colorspace bt709 -color_primaries bt709 -color_trc iec61966-2-1'

# 1. H.264 MP4, plays everywhere                         -> h264 High, avc1, yuv420p, 150 frames, 5.000 s
ffmpeg $IN -filter_complex "$FLT" -c:v libx264 -preset slow -crf 18 $TAGS -movflags +faststart -an tt_h264.mp4

# 2. HEVC MP4 for Apple devices (hvc1 tag)                -> hevc Main, hvc1
ffmpeg $IN -filter_complex "$FLT" -c:v libx265 -preset slow -crf 22 -tag:v hvc1 $TAGS -movflags +faststart -an tt_hevc.mp4

# 3. AV1 MP4, SVT-AV1 (fast) or libaom
ffmpeg $IN -filter_complex "$FLT" -c:v libsvtav1 -preset 6 -crf 30 -g 60 -svtav1-params tune=0 $TAGS -movflags +faststart -an tt_av1.mp4
ffmpeg $IN -filter_complex "$FLT" -c:v libaom-av1 -crf 30 -b:v 0 -cpu-used 6 -row-mt 1 $TAGS -movflags +faststart -an tt_av1_aom.mp4

# 4. VP9 WebM
ffmpeg $IN -filter_complex "$FLT" -c:v libvpx-vp9 -crf 30 -b:v 0 -deadline good -cpu-used 2 -row-mt 1 $TAGS -an tt_vp9.webm

# 5. Transparent VP9 WebM straight from the RGBA frames   -> stream tag alpha_mode=1
ffmpeg -framerate 30 -start_number 1 -i frames/f_%04d.png \
  -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuva420p" \
  -c:v libvpx-vp9 -crf 30 -b:v 0 -deadline good -cpu-used 2 -row-mt 1 -auto-alt-ref 0 $TAGS -an tt_alpha.webm

# 6. Stacked colour-over-alpha (any codec, any OS; needs the WebGL component on the page) -> 1920x2160
ffmpeg -framerate 30 -start_number 1 -i frames/f_%04d.png -filter_complex \
  "[0:v]format=rgba,split[m][a];[a]alphaextract[a2];[m]premultiply=inplace=1,format=rgb24[m2];[m2][a2]vstack,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" \
  -c:v libx265 -preset medium -crf 24 -tag:v hvc1 -an tt_stacked_hevc.mp4

# 7. Seamless loop played three times in one file (no re-encode)  -> 450 frames, 15.000 s
ffmpeg -stream_loop 2 -i tt_h264.mp4 -c copy -movflags +faststart tt_h264_x3.mp4

# 8. Hold the last frame 1.5 s (for one-shot moves, not loops)    -> 195 frames, 6.500 s
ffmpeg $IN -filter_complex "[1:v][0:v]overlay=shortest=1:format=auto,tpad=stop_mode=clone:stop_duration=1.5,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" \
  -c:v libx264 -preset slow -crf 18 $TAGS -movflags +faststart -an reveal_hold.mp4

# 9. Odd-sized frames: libx264 refuses ("width not divisible by 2 (641x361)"); pad or crop to even
-vf "pad=ceil(iw/2)*2:ceil(ih/2)*2:color=white,format=yuv420p"     # 641x361 -> 642x362
-vf "crop=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p"              # 641x361 -> 640x360

# 10. Cross-fade two pixel-aligned sequences (same frames, different metal), 0.5 s starting at 2.25 s -> still 150 frames
ffmpeg -framerate 30 -i white/f_%04d.png -framerate 30 -i yellow/f_%04d.png -filter_complex \
  "[0:v]format=gbrp[a];[1:v]format=gbrp[b];[a][b]blend=all_expr='A+(B-A)*clip((T-2.25)/0.5\,0\,1)',scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" \
  -c:v libx264 -preset slow -crf 18 $TAGS -movflags +faststart -an swap.mp4

# 11. Alternatives at 640 px wide
ffmpeg $IN -filter_complex "[1:v][0:v]overlay=shortest=1:format=auto,fps=15,scale=640:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5" -loop 0 tt.gif
ffmpeg $IN -filter_complex "[1:v][0:v]overlay=shortest=1:format=auto,scale=640:-2:flags=lanczos" -c:v libwebp_anim -lossless 0 -q:v 75 -loop 0 -an tt.webp
ffmpeg $IN -filter_complex "[1:v][0:v]overlay=shortest=1:format=auto,scale=640:-2:flags=lanczos,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" -c:v libsvtav1 -preset 6 -crf 30 -an tt.avif
```

Notes on what the tests showed `[E, tested]`:
- In item 10 I first tried `xfade`; it does not overlay two aligned clips, it joins them (output was 7.27 s from two 5 s inputs). `xfade` is for cuts between shots; `blend` with a time expression is the aligned cross-fade. Run as written on two folders of 90 frames (the second a tinted copy standing in for another metal): 90 frames out, 3.000 s, colour moving from the first set to the second across the half second.
- VP9 alpha: ffprobe reports `pix_fmt=yuv420p` plus the stream tag `alpha_mode=1`. FFmpeg's built-in VP9 decoder ignores the alpha; decoding with `-c:v libvpx-vp9` before `-i` returned RGBA with alpha 0–255 and a fully transparent corner. So "ffprobe says yuv420p" is not a failure.
- Local `libx265` (FFmpeg 6.1.1) lists no alpha pixel format; `libvpx-vp9` lists `yuva420p`.
- **Colour, measured.** A 720p test card through four encodes, read back the way an HD player decodes (BT.709 matrix):

| Encode | Pure green 0,255,0 | Yellow gold 255,199,115 | Green stone 8,204,77 | White / black |
|---|---|---|---|---|
| `-pix_fmt yuv420p` only (untagged; FFmpeg 6.1 used BT.601) | 0,215,0 | 255,198,110 | 0,176,72 | 255 / 0 |
| Tags added but no explicit conversion (FFmpeg 6.1) | 0,215,0 | 255,198,110 | 0,176,72 | 255 / 0 |
| Explicit `scale=out_color_matrix=bt709:out_range=tv` + tags | 0,254,0 | 254,197,115 | 7,203,76 | 255 / 0 |
| Correct limited-range file decoded as full range | 12,236,13 | 236,185,114 | 20,191,81 | 235 / 16 (washed out) |
| Full-range file decoded as limited | 0,255,0 | 255,212,116 | 0,216,72 | grey 128 → 130, extremes clipped (too contrasty) |

  On 6.1.1 adding `-colorspace bt709` without the filter changed the label but not the pixels, so the file is wrong *and* confidently tagged. Greens lose about 15 % (a green stone renders visibly duller); gold shifts slightly.
- **Sizes, synthetic proxy only** (flat-shaded, sparkle-heavy, white background; real renders have gradients and residual noise and will usually be larger). 5 s, 1080p30, 150 frames, 2 CPU threads:

| File | Size | Mean bitrate | Encode time |
|---|---|---|---|
| H.264 CRF 18 slow | 1.96 MB | 3.1 Mbit/s | 2 s |
| H.264 CRF 23 slow | 1.11 MB | 1.8 Mbit/s | 2 s |
| HEVC CRF 22 slow | 0.96 MB | 1.5 Mbit/s | 21 s |
| HEVC CRF 26 slow | 0.61 MB | 1.0 Mbit/s | — |
| AV1 SVT CRF 30 preset 6 | 0.71 MB | 1.1 Mbit/s | 21 s |
| AV1 SVT CRF 24 preset 4 | 0.89 MB | 1.4 Mbit/s | 46 s |
| AV1 libaom CRF 30 cpu-used 6 | 0.71 MB | 1.1 Mbit/s | 24 s |
| VP9 CRF 30 | 1.06 MB | 1.7 Mbit/s | 12 s |
| VP9 with alpha CRF 30 | 2.60 MB | 4.2 Mbit/s | 20 s |
| Stacked colour+alpha HEVC CRF 24 (1920×2160) | 1.33 MB | 2.1 Mbit/s | — |
| 640 px: GIF 30 fps / GIF 15 fps | 1.94 MB / 0.97 MB | | |
| 640 px: animated WebP q75 | 0.71 MB | | |
| 640 px: H.264 CRF 20 | 0.37 MB | | |
| 640 px: AVIF sequence (SVT CRF 30) | 0.17 MB | | |

### Inferences
All `[E]`.

- **Which image format to render.**

| Format | What it holds | Size per 1080p frame (typical) | Use when |
|---|---|---|---|
| PNG 8-bit RGBA | View-transformed (AgX → sRGB) picture, alpha | 1–3 MB | Quick previews; finals if no grading. Soft white-background gradients can band, though Blender's default dither hides most of it |
| PNG 16-bit RGBA | Same picture, 16 bits | 4–10 MB | **Default for finals.** No banding going into the encoder; safe to resize or adjust levels |
| OpenEXR multilayer, half float, ZIP or DWAA | Scene-linear combined + denoising data (+ Vector) | 15–60 MB | When denoising will be redone (the temporal operator requires it), glare is done in the compositor afterwards, or exposure may change. Needs a second Blender pass to apply the view transform; FFmpeg cannot apply AgX |

- **Never render straight to a video file.** A crash at frame 140 of 144 loses everything; ranges cannot be shared between machines; a single bad frame cannot be re-rendered; and every delivery format would be a second lossy generation. Flamenco enforces the same rule in its job type (cited above).
- **`-framerate` is an input option** and belongs before `-i`. Putting `-r` after the input makes FFmpeg duplicate or drop frames to convert from the default 25 fps.
- **Recommended delivery set for a product page.** `tt.av1.mp4` (first source), `tt.hevc.mp4` with `hvc1` (Safari on hardware without AV1), `tt.h264.mp4` (everything else), plus a poster still. Give each `<source>` a `type` with codecs so the browser can skip what it cannot play. Transparent delivery only when the page background is not white: HEVC-alpha `.mov` first (needs a Mac to encode), then VP9-alpha WebM; or the stacked file with the WebGL component, which needs no Mac.
- **Targets for a real 5–10 s, 1080p turntable:** H.264 CRF 18–20 at 3–6 Mbit/s, so 2–7 MB; HEVC CRF 22–24 or AV1 CRF 28–32 at 1.5–3 Mbit/s, so 1–4 MB. Sparkle is the expensive content: single-frame flashes cannot be predicted from the previous frame, so a sparkling close-up costs two to three times a plain metal spin at the same CRF. Prefer CRF over a fixed bitrate so those frames get the bits.
- **8-bit banding.** H.264 10-bit (`high10`) is not hardware-decoded on most phones, so the universal file stays 8-bit `yuv420p`. Put the 10-bit quality into the HEVC or AV1 file (`-pix_fmt yuv420p10le`), where 10-bit decode is standard.
- **Colour summary.** Blender writes display-referred sRGB pixels into PNG after the AgX view. The video matches the stills when (1) the matrix conversion is explicitly BT.709, (2) range is limited and tagged `tv`, (3) the transfer tag is sRGB, (4) primaries are BT.709. "Washed out" is almost always a limited-range file shown as full, or a BT.709-transfer tag in Safari; "too dark or contrasty" is a full-range file treated as limited; "greens look dull" is the BT.601 matrix.
- **Loops.** No audio track (`-an`): an audio stream adds priming samples and a gap at the wrap. Some mobile browsers still pause for a frame when a `<video loop>` restarts; concatenating two or three turns into one file (item 7) makes the seam rarer at a proportional size cost.
- **GIF, animated WebP, AVIF.** GIF is 256 colours, has no real alpha, and was 5× the size of H.264 in my test at a third of the resolution; animated WebP is better but still double the H.264 and has no playback controls; an AVIF sequence is small but decodes slowly and inconsistently (see the transparency article). Their only advantages are that they work inside `<img>` and in e-mail. Use video on the page; keep a GIF or WebP only for channels that cannot take a `<video>`.
- **Autoplay.** Browsers allow autoplay only when the video is muted (and on iOS, `playsinline`), so the element is `<video autoplay loop muted playsinline poster=...>`; honour `prefers-reduced-motion` by not autoplaying.

### Gaps
- HEVC with alpha could not be produced or tested here (Linux, no VideoToolbox). x265 4.x (which Blender 5.3 bundles) and recent FFmpeg are, to my memory, able to encode an alpha layer with `libx265`, but I could not open a source or test it; the FFmpeg ticket on HEVC alpha was unreachable `[E]`.
- The FFmpeg wiki pages for H.265, VP9 and AV1 were not opened (the ASWF pages stand in). MDN's autoplay guide was not opened; the autoplay bullet is working knowledge.
- No measured file sizes for real rendered jewelry frames; the table is from a synthetic proxy. Re-run the commands on the first real 144-frame sequence and replace the numbers.
- FFmpeg 8.1 behaviour of these exact commands is untested (see section 0).
- Safari's handling of the sRGB transfer tag is taken from the ASWF page; I did not test in a browser.

---

## 6. 360-degree spin viewers as an alternative to video

### Takeaway
A drag-to-rotate viewer is the same turntable delivered as 24, 36 or 72 still images plus a small script; if the turntable's frame count is a multiple of 72, one render serves the video and the spinner by taking every k-th frame.

### Cited Findings
- JS Cloudimage 360 View: MIT licence, version 4.9.5; images addressed by `folder` + `filename-x` pattern with an `{index}` placeholder and `amount-x` (and optional Y axis or grid); drag, swipe, inertia, autoplay (`speed` = milliseconds between frames, default 80), zoom, fullscreen, keyboard; lazy loading on by default; a Cloudimage CDN token is optional; its examples mostly use 36 frames `[V]` — [README on jsDelivr](https://cdn.jsdelivr.net/npm/js-cloudimage-360-view@4.9.5/README.md).
- @3dweb/360javascriptviewer: version 1.8.51; `totalFrames` defaults to 72; filename pattern `{filename}_xx.{extension}` where the number of x's sets zero-padding; `startFrameNo`; drag with inertia, auto-rotate, zoom; licence not stated on the page `[V]` — [npm](https://npmjs.com/package/@3dweb/360javascriptviewer).
- Other libraries seen only as search results: threesixty.js, react-360-product-viewer, @webrotate360/imagerotator, vue-360, a Framer "Turntable 360" component, a WordPress "SR Product 360° View" plug-in `[S]` — [threesixty.js](https://github.com/mladenilic/threesixty.js), [react-360-product-viewer](https://www.npmjs.com/package/react-360-product-viewer), [WebRotate 360](https://www.npmjs.com/package/@webrotate360/imagerotator).
- A studio lists "360-degree spins" as a deliverable separate from animation, delivered as MP4 or MOV `[V]` — [7CGI](https://7cgi.com/jewelry-rendering/).

Tested here (FFmpeg 6.1.1), `[E, tested]`:

```bash
# every 2nd frame of a 72-frame set -> 36 files named ring-0.jpg ... ring-35.jpg
ffmpeg -start_number 1 -i frames/t_%04d.png -vf "select='not(mod(n\,2))'" -fps_mode passthrough -start_number 0 -q:v 3 spin/ring-%d.jpg
# 36 frames as one 6x6 sprite sheet at 480 px per cell -> 2880x1620, 229 KB JPEG on the synthetic proxy
ffmpeg -framerate 36 -i spin36/s_%02d.png -vf "scale=480:-2:flags=lanczos,tile=6x6" -frames:v 1 -update 1 -q:v 3 sprite_6x6.jpg
```

### Inferences
All `[E]`.

- **Frame counts.** 24 frames = 15° steps (visibly steppy), 36 = 10° (the common default), 72 = 5° (smooth under a slow drag). For stones, 72 is worth it: at 10° steps the flashes are unrelated from one image to the next and the piece seems to flicker as it is dragged.
- **Naming.** Decide zero-padding and the first index once and match the library: `{index}` with a zero-base flag for Cloudimage, `_xx` for the 3dweb viewer. Blender's `####` output can be renumbered in the FFmpeg step as above.
- **One render, two products.** Render N = 144 at 24 fps. Video: all 144 frames. Spinner: frames 1, 3, 5 … for 72, or 1, 5, 9 … for 36. No extra render time.
- **Spinner versus video.**

| | Spinner | Video |
|---|---|---|
| Control | The shopper drags to any angle and stops there | Plays on its own |
| Weight | 36 images × 30–60 KB (WebP/AVIF at 800–1000 px) ≈ 1–2 MB; 72 doubles it | 1–4 MB for a 1080p loop |
| Memory | Decoded frames are width × height × 4 bytes each: 72 frames at 1920×1080 ≈ 600 MB, which will crash a phone tab; cap spinner frames near 1000 px or load on demand | One decoder |
| Transparency | Free with PNG, WebP or AVIF stills | Needs the alpha-video work in §5 |
| Motion quality | Limited to the step angle; no sparkle continuity | Smooth |

- **Sprite sheets** cut requests to one but hit texture and decode limits (a 6×6 sheet of 1000 px cells is 6000×6000) and defeat lazy loading; use them only for small thumbnails.
- **A third route:** scrub a muted `<video>` by setting `currentTime` on drag. It needs every frame to be a key frame (`-g 1`) to seek cleanly; on the synthetic 150-frame 1080p proxy that took the H.264 CRF 18 file from 1.96 MB to 4.03 MB `[E, tested]`. Seeking precision varies by browser.

### Gaps
- Licences and maintenance state of the libraries other than the two opened are unverified.
- No source compared conversion or engagement between a spinner and an autoplay loop for jewelry.
- The scrub-a-video route is from working knowledge; the all-intra file was encoded and sized here but not tried in a browser.

---

## 7. Verifying an animation, before and after the long render

### Takeaway
Check the motion with no rendering at all (f-curve values, rigidity, framing), then with a tiny-resolution contact sheet, then with a handful of consecutive full-quality frames; after the render, count frames, hunt for zero-byte placeholders, measure the wrap against a normal step, and scan for brightness pops and duplicates. The commands below ran today; the one thing the automatic scan did not catch was a single noisier frame inside fast motion, which still needs eyes.

### Cited Findings
- The existing workflow already requires 3–6 key frames at tiny resolution before a full run, and per-pose rigidity numbers (max rigid deviation within a link about 1e-5, prong-gap change, interpenetration depth) written to `verification.json` — `SKILL.md` §4, §7 (local file).
- Play several consecutive frames before committing to a sequence, because a still can look clean while the sequence flickers `[V]` — [iRender](https://irendering.net/blender-cycles-denoising-animation-oidn-optix/).
- The temporal-denoise operator itself refuses to run if any frame in the range is missing `[E, read in the Blender 5.3.0 add-on]`; the Output page's shared-folder recipe leaves placeholders `[V]` — [Blender manual, Output](https://www.blender.org/manual/en/render/output/properties/output.html).

Tested here, `[E, tested]` (FFmpeg 6.1.1, Python 3 with Pillow and NumPy; 150-frame synthetic loop):

```bash
# Contact sheet: every 15th frame, 5 x 2, 384 px cells          -> one 1936x436 PNG
ffmpeg -start_number 1 -i frames/f_%04d.png -vf "select='not(mod(n\,15))',scale=384:-1,tile=5x2:padding=4:color=white" -frames:v 1 -update 1 sheet.png

# Frame count, rate and duration of the delivered file           -> nb_read_frames=150 r_frame_rate=30/1 duration=5.000000
ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=codec_name,codec_tag_string,pix_fmt,width,height,r_frame_rate,nb_read_frames,color_range,color_space,color_transfer,color_primaries:format=duration,size -of default=nw=1 tt_h264.mp4

# Loop continuity: the wrap pair must look like any other neighbouring pair
ffmpeg -i frames/f_0150.png -i frames/f_0001.png -lavfi ssim -f null - 2>&1 | grep -o "All:[0-9.]*"   # wrap      0.950454
ffmpeg -i frames/f_0149.png -i frames/f_0150.png -lavfi ssim -f null - 2>&1 | grep -o "All:[0-9.]*"   # ordinary  0.950485
# An off-by-one loop (last frame == first frame) shows up as SSIM 1.000000 on the wrap pair.
```

```python
# flicker_check.py "frames/f_*.png" [z]  -- brightness pops, duplicates, wrap ratio (ran on 150 frames in a few seconds)
import sys, glob, numpy as np
from PIL import Image
files = sorted(glob.glob(sys.argv[1])); ZT = float(sys.argv[2]) if len(sys.argv) > 2 else 6.0
def load(p):
    im = Image.open(p).convert("RGBA"); bg = Image.new("RGBA", im.size, (255, 255, 255, 255)); bg.alpha_composite(im)
    im = bg.convert("L"); im.thumbnail((640, 640)); return np.asarray(im, dtype=np.float32)
fr = [load(p) for p in files]; n = len(fr)
mask = np.min(fr, axis=0) < 250                                   # pixels the piece ever covers
mean = np.array([f[mask].mean() for f in fr])
step = np.array([np.abs(fr[i] - fr[i-1])[mask].mean() for i in range(n)])            # step[0] is last -> first
res  = np.array([np.abs(fr[i] - (fr[i-1] + fr[(i+1) % n]) / 2)[mask].mean() for i in range(n)])
pop  = np.array([mean[i] - (mean[i-1] + mean[(i+1) % n]) / 2 for i in range(n)])
def z(x): m = np.median(x); mad = np.median(np.abs(x - m)) or 1e-6; return (x - m) / (1.4826 * mad)
print(f"frames {n}; wrap/typical step = {step[0] / np.median(step):.2f}")
for name, arr in (("brightness pop", pop), ("residual", res)):
    zz = z(arr); print(name, [(files[i].split('/')[-1], round(float(zz[i]), 1)) for i in np.where(np.abs(zz) > ZT)[0]])
```

Results of that script:
- Clean loop: no outliers; wrap/typical step ratio 1.01.
- One frame brightened by 3 %: flagged at 14 robust standard deviations (its two neighbours at about −7).
- One frame replaced by a copy of its predecessor (a stutter): flagged at −31 to −48.
- A black frame or a frame with the wrong background: flagged by thousands.
- One frame with added noise (σ = 6 on 8-bit, object only) in a fast-moving, high-contrast sequence: **not** flagged; the motion between frames swamps it.
- Zero-byte files are found with a two-line size check; a missing-number check found none when a placeholder existed, so check sizes, not only names.

Tested on bpy 5.3.0 `[E, tested]`: `fc.evaluate(frame)` returns the curve value without rendering, which is how the loop step and wrap were confirmed in section 1.

### Inferences
All `[E]`.

A checklist in the order it should run:

1. **No-render checks (seconds).** For frames 1, N/4, N/2, 3N/4, N: evaluate the pivot f-curve and confirm step = 360/N and value(N+1) − value(1) = 360°. Re-run the workflow's rigidity measurements at each of those frames: every part's matrix relative to its link frame equals the CAD value (≈1e-5), every object's world scale is 1, the distance between two reference vertices of each link is constant. Project the piece's bounding box through the camera at every k-th frame and confirm it stays inside the frame with margin (catches a straight bracelet leaving frame mid-curl).
2. **Contact sheet (a minute).** 8–12 key frames at 320–480 px and 16–32 samples, tiled into one image; look at silhouette, framing, which side faces the lens at the hold, whether the clasp is visible.
3. **Flipbook (minutes).** Every 6th frame at low resolution, encoded at 4–6 fps, to judge motion and easing.
4. **Flicker test (the important one).** 8–10 *consecutive* frames at final resolution and samples from the hardest part of the shot (most floor and shadow visible, stones face-on). Encode at the real frame rate, loop it, and look at the floor, the shadow edge and broad metal faces at 100 %. Adjust samples, seed mode and clamp here, not after the full render.
5. **After the render.** File count equals N; no zero-byte files; all frames the same dimensions; ffprobe on the encode shows N frames and N/fps seconds; SSIM of (N, 1) is in the same range as (1, 2); the script above finds no brightness pops or duplicates; then watch the encode once at full size.

- For per-frame *noise* flicker in moving subjects, a better automatic signal than frame differences would be a high-frequency energy measure per frame (variance of a Laplacian over the piece) or the same differencing restricted to static regions (floor and shadow). I did not build or test that.
- Rigid parts staying rigid cannot be judged from pixels; it has to be the matrix check in step 1, repeated for the frames actually rendered if posing is scripted per frame.

### Gaps
- The checker was exercised on synthetic frames with injected faults, not on Cycles output; its thresholds (6 robust σ) need one real sequence to calibrate.
- No published per-frame flicker metric for path-traced animation was found in the sources I could open; an image-difference tool with perceptual metrics (for example NVIDIA's FLIP or OpenImageIO's `idiff`, both of which another researcher had started to fetch into `/tmp/cyc/`) might serve, but I did not examine them.

---

## 8. How professional studios describe process, deliverables and price

### Takeaway
Studios sell the product-page loop as the smallest unit: 6–10 seconds, seamless, MP4 or MOV, 1080p, cut from the same scene as the stills. Published prices span two orders of magnitude, from about $50–100 on marketplaces to $300–450 a loop at a small studio and $5,000–10,000 at agencies, with colourways and extra aspect ratios charged as extra renders.

### Cited Findings
- 7CGI (US/Bangladesh): stills from $99; most single pieces in 2–4 business days; inputs CAD (3DM, STEP, STL, OBJ, FBX …), sketches or photos; process is geometry check → library metals, stones and lighting → an approved test render (metal tone, stone colour, camera angle) → full set; three revision rounds; spins and animation delivered as MP4 or MOV, stills as PNG/JPG/TIFF, AR as GLB; no animation price published `[V]` — [7CGI jewelry rendering](https://7cgi.com/jewelry-rendering/).
- A 7CGI case study for a two-tone diamond ring delivered dark-studio stills, white-background stills, an on-finger image and one loopable 360° video for the product page, all from the same model and material library `[V]` — [7CGI case study](https://7cgi.com/?p=567).
- Maverick Frame's 2026 guide: loop 6–10 s (144–240 frames at 24 fps), seamless, "replaces a still on a product page", $300–450 each and less when cut from an existing scene; hero spot 15–30 s at $1,500–2,000 per 15 s; explainer 45–90 s at about $4,500 a minute; vertical and square versions about $700 each because they are new cameras and renders; 6- and 10-second bumpers cut from existing frames about $300; HD recommended for web, 4K costs more; two revision rounds on the draft and one on the final; up to a minute of animation takes 4–6 weeks `[V]` — [Maverick Frame field guide (PDF)](https://maverickframe.com/lead-magnets/services/en/fifteen-seconds-360-frames.pdf).
- The same firm's market survey (1 November 2026, third-party figures, not its own prices): a 5–15 s 360° spin or turntable loop is $5,000–10,000 at studios and far less on marketplaces; exploded or technical views of 20–60 s are $20,000–50,000+; per-second sanity ranges are about $17–83 (freelance), $83–250 (boutique studio), $250–830+ (agency); a 30-second CGI film takes 2–4 weeks `[V]` — [Maverick Frame cost article](https://maverickframe.com/blog/3d-product-animation-cost/).
- A marketplace seller: 20 s, 25 fps, 1280×720 spin from a 3DM file, in gold, silver and rose gold; an order in the $50–100 band took 11 days `[V]` — [Fiverr gig](https://fiverr.com/mashriquecad/do-360-realistic-jewelry-animation).
- XO3D (UK) describes six stages (brief and reference, modelling, materials and stones, lighting rig, animation and cameras, rendering and finish), plans outputs by placement (hero film, vertical social cut, product-page loop, still), and calls stone realism "a specialist craft" that needs skill and render time; no prices or lengths published `[V]` — [XO3D](https://xo3d.co.uk/resources/3d-animation/jewellery-animation/).

### Inferences
All `[E]`.

- The deliverable set that recurs is: white-background stills, dark or lifestyle stills, one seamless loop, optional vertical cut. The workflow under revision already produces the stills; adding a 144-frame loop from the same scene matches what studios sell as the entry product.
- Against those prices, research 18's compute cost for a 5-second 1080p turntable (under a dollar on rented GPUs) means the scarce resource is not rendering but getting motion, lighting and flicker right the first time, which is what the verification ladder in section 7 is for.
- Studios treat aspect ratios as separate renders. For the workflow that means the camera fit (lens auto-fit to the piece's extent, already in §7 of the skill) should be recomputed per aspect ratio rather than cropping a 16:9 master.

### Gaps
- No studio page I could open states its frame rate, samples, renderer or per-frame render time; none describes how it avoids flicker.
- Prices specific to jewelry turntables from established jewelry CGI studios are not published; the only jewelry-specific figures are one studio's still price and one marketplace gig.
- KeyShot-based jewelry studios' process write-ups were not reachable.
