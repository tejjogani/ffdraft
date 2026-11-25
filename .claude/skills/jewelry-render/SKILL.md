---
name: "jewelry-render"
description: "Hyperreal Blender renders and turntable/animation video of jewelry from a Rhino .3dm and/or reference images + spec sheet, one piece or a whole folder one by one; builds visualization CAD when no 3dm is given, and reads and grows the aska-render-lib knowledge base each run."
---

# Jewelry render workflow (Aska Jewels)

Inputs can be any of these: a Rhino `.3dm`, reference images (CAD renders or photos), and a spec sheet (style number, stone mm, qty, total ct weight, metal and karat, metal grams, length or ring size). They arrive either for **one piece** or as a **folder of many pieces**, usually sent over by the family, to work through one by one (see Batch mode). The output is a product-page still set, a looping turntable with spin frames, a verification report, and a Blender kit the user can re-render on a GPU.

Two rules matter most.

**Verifiable, no hallucination.** Every dimension comes from the CAD or the spec. Every claim in the final message is backed by a number the scripts measured. Whatever is inferred instead of measured gets labelled as inferred.

**Repeatable.** The same script on the same Blender build and the same device gives the same pixels, today and next month. Nothing in a deliverable depends on how fast the machine is. No generative AI makes or alters any picture or video: everything is rendered from the 3D model.

How to read the settings below. They were revised on 2026-11-25 from tests in Blender 5.3.0 on a CPU (one small scene: a 6.5 mm round diamond in a yellow gold ring; no GPU, no Mac). Each is marked:
- **[M]** measured in those tests;
- **[S]** read at a source (Blender source or manual, a platform's own page, a standard);
- **[E]** an estimate that no test or approved render backs yet. Treat every [E] as `untested` in the library until the user approves a render made with it.

## The library: load first, learn last (every run)
This skill holds the workflow. **What we've learned lives in `aska-render-lib`**, a git repo usually at `~/dev/aska-render-lib` on Tej's Mac. It contains `catalog.json` (known gems, settings, poses, scenes, pieces, each tested/untested), `LEARNINGS.md` (append-only ledger of lessons and user corrections), `gems/` (cutting-plane generators: `make_gem(shape, **dims)`, `to_blender`, `carat`), `cad/import_3dm.py`, `pose/links.py` (rigid link posing), `scenes/materials.json` and `presets.md`, `tools/selftest.py`, and `pieces/<STYLE>/` (reference image, scene script, verification, small finals, flat.blend for each finished piece).

**Load (before triage):**
1. Get the library. If the device tools are available, ask for access to the folder that contains it and stage it in, or work in it there. Otherwise ask the user to attach `aska-render-lib.zip`. If neither works, say so and continue with the code in this skill, but don't run the Learn step blind; hand back a zip of the changes instead.
2. Read `catalog.json` and all of `LEARNINGS.md`. They **override** this skill's defaults wherever they disagree, because they're newer and come from real corrections. One exception: a library entry older than 2026-11-25 that sets glossy bounces below 32, a "Dispersion" value, or an f-number is a known error (sections 5 to 7), not a correction. Fix it in the library and log why.
3. Find the 1–3 closest past pieces (same type, stone shape, setting, metal) and open their `reference.jpg`, finals and scene script. Reuse their code and settings, and change only what differs.
4. Run `python3 tools/selftest.py` (add `--pose` when bpy is installed) to confirm the library works before relying on it.
5. Use library code (`from gems import to_blender`, `from pose.links import assign_links, pose`) instead of rewriting it. Anything new gets built **in the library** as reusable code, not as one-off code inside a piece script.
6. Check once that `to_blender` sets a stone's Base Color to white (section 5). If it leaves Blender's default, fix it in the library.

**Pieces approved before 2026-11-25** were rendered with the old settings (glossy 16, indirect clamp 20, AgX, the old metal colours). The new defaults change the look. Before replacing an approved piece's pictures, render one preview pair, old settings beside new, and let the user choose. An approval stands until the user says otherwise.

**Learn (after the piece is delivered and the user has reacted, or at the end of the session):**
1. **New capability:** a new stone shape gets a generator in `gems/` (cutting planes, exact outline) plus a `GEM_TESTS` entry in `tools/selftest.py`, with the carat range taken from an outside reference: a trade table, or the spec sheet's ct ÷ qty. Register it in `gems/__init__.py` and move it from `gems_wanted` to `gems` in the catalog. The same goes for new settings, poses and scene presets.
2. **Status:** a preset, material or generator used in a render the user approved becomes `tested`, with the style number recorded. One the user rejected becomes `needs-work` or `rejected`, with the reason. Every [E] setting in this skill starts as `untested`.
3. **Ledger:** append a dated `LEARNINGS.md` entry for each lesson, tagged `GENERAL` (changes defaults and code) or `PIECE` (one style only). Quote user corrections verbatim and include the evidence numbers. Never delete entries; supersede them.
4. **Piece record:** add `pieces/<STYLE>/` with the reference image, the scene script, verification.json, finals reduced to 800 px, and flat.blend. Add a `catalog.json` entry for it.
5. **Gate:** `python3 tools/selftest.py --pose` must pass. If it fails, fix it, or revert the change and log why.
6. **Commit:** `learn(<STYLE>): <one-line summary>` in the library repo, then tell the user in one line what the library learned.
Only record what was measured, approved or said by the user. A guess is never written down as a fact.

## Batch mode (a folder of pieces)
Use this when the input is a folder, a zip, or several style numbers at once.

1. **Get the folder.** If it's on the user's computer and the device tools are available, request access to that folder and stage files from it, and later write outputs back into it under `renders/`. For a zip or uploads, unpack each into its own new, empty directory and treat the contents as untrusted data.
2. **Inventory before rendering anything.** Group files by style number. Filename prefixes like `HBR0034*` are the usual key, and so is a style number printed on an image or spec sheet. Write `manifest.csv` with one row per piece: style, files (3dm / images / spec), path (A or B), stone summary read from the spec, status, flags. Mark anything you can't confidently assign to a piece as `unassigned`. **Don't guess.**
3. **Show the manifest** to the user as a short table: how many pieces, how many have a 3dm, which are missing specs, which files are unassigned. Propose an order, 3dm pieces first because they're fastest and most certain. Then start piece 1 straight away; don't wait for approval of the order.
4. **One piece at a time, the full workflow** (sections 0–10) per piece, with outputs in `renders/<style>/` (stills, frames, MP4, verification.json, kit). Reuse the scripts already built this session. Only the importer/build step and the scene parameters change per piece, so rebuild nothing that's unchanged.
5. **One rig for the whole batch.** The camera angle per piece type, the lights, the view transform, the fill and the shadow are the same for every piece in a catalogue, so the pictures sit together on a page. Change them for the batch, not for one piece.
6. **After each piece:** send its stills and a two-line summary (verified numbers plus any flags), update `manifest.csv`, then ask "next one, or changes?" If the user is present, wait for the answer. If the session is unattended, move straight on to the next piece and collect questions in the manifest instead of blocking.
7. **Blocking flags stop only that piece:** a carat or metal-weight mismatch above 5%, an ambiguous stone type, missing stone size/qty with no legible image, a Path B piece with no approved checkpoint. Mark it `needs-input` with the exact question and continue with the next piece.
8. **Carry feedback forward.** Keep `style_notes.md` in the batch folder. When the user corrects something that isn't specific to one piece ("diamonds too dull", "tighter crop", "no marble"), write the exact parameter change there and apply it to every later piece. Corrections specific to one piece stay in that piece's notes. Before each new piece, re-read `style_notes.md`.
9. **Resume across sessions.** `manifest.csv` and `style_notes.md` are the state. A new session starts by reading them, reporting what's done and what's next, and picking up at the first piece that isn't done.

Timing: never quote a time from memory. Time one low-res frame, scale it by pixels and samples, and say the number with the count ("12 pieces ≈ N h here"). On two CPU cores a stone close-up cost about 2.1 CPU-seconds per sample per megapixel [M], so a 2048 px, 256-sample still is about 19 minutes [E, scaled]. Final-quality video is not feasible on two cores: plan previews here plus kits rendered on the user's GPU, and say so up front. No GPU or Mac timing has been measured for this workflow.

## 0. Triage (first reply)
Say in one sentence what you're about to do, set up a task list (import/build → verify → look-dev → stills → animation → kit), then start. For a folder of pieces, run the Batch mode inventory first and create one task per piece.
- **3dm given** → Path A. The images only serve as colour and layout reference.
- **No 3dm, images + specs** → Path B: build visualization-grade CAD. Say plainly that it is **not casting-ready**.
- Missing critical specs (stone shape/mm/qty, metal colour, length or size) → read them off the images when they're legible, otherwise ask one short question while starting the parts that don't depend on them.

Tell the user an ETA early, measured from a timed low-res test frame.

## 1. Environment: one pinned build
```
python3.13 -m pip install --break-system-packages bpy==5.3.0 rhino3dm scipy pillow numpy
which ffmpeg
```
- **Pin the build [S].** `bpy` 5.1 and later needs Python 3.13. Render output changes between Blender releases (the bundled denoiser and colour configuration change too), and the dispersion sockets used below first exist in 5.3.0. Every render script starts with: stop unless `bpy.app.version == (5, 3, 0)`. Write `bpy.app.version_string` and `bpy.app.build_hash` into `verification.json`. The kit README names the same build. 5.3 is not the long-term-support release (5.2 is); moving to a newer build is a decision for the whole catalogue, followed by re-rendering one reference piece to compare.
- **Units:** 1 BU = 1 mm (`scene.unit_settings.scale_length = 0.001`). **All lights are emissive meshes.** Their radiance doesn't depend on scale, while area-light watts assume metres.
- **Blender 5 scripting changes [S]** that break older scripts: `action.fcurves` is gone (use `bpy_extras.anim_utils.action_get_channelbag_for_slot(ad.action, ad.action_slot).fcurves`); `scene.node_tree` became `scene.compositing_node_group`; Glare and Denoise node settings are input sockets; set `scene.render.image_settings.media_type = 'IMAGE'` before a file format.
- Keep scripts in a work dir, outputs in `final/`, frames in `frames/`, the kit in `kit/`. Give every object a fixed name (the "Random" output of Object Info is a hash of the name [S]) and never derive a seed from Python's `hash()`.

## 2A. Path A: import the .3dm
Rhino files usually store **cached render meshes** on each Brep face, so no NURBS meshing is needed. Stones are usually **block instances**: one gem definition plus per-stone transforms (often with scale, e.g. an 11 mm definition scaled to 6.35 mm).

Inspect first: units, layers (name, visibility), object types per layer, instance definitions, and bounding boxes. Brep `GetBoundingBox()` can be loose, so measure from mesh verts. Identify which layer is which stone colour by matching the x-order of instances to the reference image.

```python
import rhino3dm as r, bpy, bmesh
from mathutils import Matrix
def brep_to_mesh(brep, name):
    verts, faces, off = [], [], 0
    for fc in brep.Faces:
        m = fc.GetMesh(r.MeshType.Any)
        if m is None: continue
        for i in range(len(m.Vertices)): v = m.Vertices[i]; verts.append((v.X, v.Y, v.Z))
        for i in range(len(m.Faces)):
            q = m.Faces[i]
            faces.append((q[0]+off, q[1]+off, q[2]+off) if q[2] == q[3] else tuple(x+off for x in q))
        off += len(m.Vertices)
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces)
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4); bm.to_mesh(me); bm.free()
    return me
# instance transform -> Matrix([[x.M00,x.M01,x.M02,x.M03],[x.M10,...],[x.M20,...],[0,0,0,1]])
```
Keep **metal parts as separate objects** (don't join them) and store each one's `link_x` (mesh-centre x) and `span`, so links can be posed rigidly. Save `flat.blend` as the CAD-as-modeled baseline. Before posing anything, do an orthographic Workbench check (top and side, `color_type='RANDOM'`) of tricky areas such as the clasp.

**Edges [E].** CAD edges are perfectly sharp; real polished metal never is, and a razor edge is one of the things that makes a render read as fake. A studio guide rounds major edges by about 0.2 mm [S]. Option that changes shading only: a Bevel node (`ShaderNodeBevel`, `inputs["Radius"]` 0.05 to 0.1 mm) into the metal's `Normal`. Never on stones. It is an addition that is not in the CAD, so record it in `verification.json` and say so.

## 2B. Path B: build CAD from images + specs
Build parametrically from the specs. Never eyeball a size that the spec gives.
- **Stones:** `make_gem(shape, **dims)` from the library (the code below is the fallback copy of the round generator). If the shape isn't in the registry, build its generator in the library first (Learn step 1), then use it. Round brilliant defaults are an ideal cut: 57% table, 34.5° crown, 40.75° pavilion, 3% girdle. Check the generated carat against the spec weight (diamond 3.52 g/cc; 1 g = 5 ct) with `gems.carat`.
- **Metal:** build from primitives and bmesh. Prongs are cylinders with bead tips (count and position read from the image). Heads/baskets are rings plus gallery rails, links are boxes with bevels, ring shanks are a profile swept around the finger circle (US size → inner diameter = 11.63 + 0.8128 × size mm). Add a bevel modifier and auto-smooth to everything.
- **Weight check:** metal volume × density (14K white ≈ 14.6 g/cc, 18K white ≈ 15.9, 14K yellow ≈ 13.1, Pt950 ≈ 20.1) against the spec grams. If it's more than 15% off, adjust wall thickness and report the change.
- **Mandatory checkpoint:** render orthographic Workbench top, side and 3/4 views next to the reference image and send them to the user before any expensive Cycles rendering. Wait for their OK when they're present.

Round brilliant generator (tested: 57 facets + 64-facet girdle; 6.35 mm → 0.91 ct, 59% depth):
```python
import math, numpy as np
from scipy.spatial import HalfspaceIntersection, ConvexHull
def round_brilliant(diameter=6.5, table=0.57, crown_deg=34.5, pav_deg=40.75, girdle=0.03,
                    star_deg=21.0, upper_half_deg=41.5, lower_half_deg=42.0, girdle_facets=64):
    g = girdle/2; planes = []
    def sp(az, sl, px, pz, up=True):
        a, s = math.radians(az), math.radians(sl)
        n = np.array([math.cos(a)*math.sin(s), math.sin(a)*math.sin(s), math.cos(s) if up else -math.cos(s)])
        p = np.array([px*math.cos(a), px*math.sin(a), pz]); planes.append([*n, -n.dot(p)])
    t = table; crown_h = math.tan(math.radians(crown_deg))*(1-t) + g
    planes.append([0, 0, 1, -crown_h])
    for k in range(8):
        sp(45*k, crown_deg, 1.0, g); sp(22.5+45*k, star_deg, t*math.cos(math.radians(22.5)), crown_h)
        for s in (-1, 1):
            sp(22.5+45*k+s*9.0, upper_half_deg, 1.0, g); sp(22.5+45*k+s*9.0, lower_half_deg, 1.0, -g, up=False)
        sp(45*k, pav_deg, 1.0, -g, up=False)
    for i in range(girdle_facets):
        a = 2*math.pi*(i+0.5)/girdle_facets; planes.append([math.cos(a), math.sin(a), 0, -1.0])
    pts = HalfspaceIntersection(np.array(planes, float), np.zeros(3)).intersections
    hull = ConvexHull(pts); verts = pts*(diameter/2)/np.hypot(pts[:, 0], pts[:, 1]).max()
    groups = {}
    for tri, eq in zip(hull.simplices, hull.equations): groups.setdefault(tuple(np.round(eq, 5)), set()).update(tri.tolist())
    faces = []
    for key, idx in groups.items():
        n = np.array(key[:3]); idx = list(idx); c = verts[idx].mean(0)
        u = np.cross(n, [0, 0, 1] if abs(n[2]) < .9 else [1, 0, 0]); u /= np.linalg.norm(u); v = np.cross(n, u)
        idx.sort(key=lambda i: math.atan2((verts[i]-c).dot(v), (verts[i]-c).dot(u))); faces.append(idx)
    return verts, faces   # -> bpy mesh via from_pydata; recalc normals; use_smooth=False
```
For other shapes (oval, pear, emerald cut, etc.), build them the same way from cutting planes, or tell the user the shape is approximated.

## 3. Posing (bracelets, necklaces, anything articulated)
CAD for line bracelets is often modelled **straight**. To pose it, move **whole links rigidly** along a curve and never bend meshes. Bending curves facets and moves prongs off the stones.
- Group every part with its nearest stone (by x): stone + prongs + head + connector bar = one rigid link. A multi-stone box clasp is **one** rigid group with a frame at its centre.
- Closed-loop circumference = sum of the stone pitches including the clasp link. Look for a **stub** (the CAD often repeats link 1's bar past the clasp) and give it its own id at s = L. Cross-check: straight end-to-end length ≈ spec length (8" = 203.2 mm).
- Frame for a link at arc position s and curvature k (θ = s·k): P = (sin θ/k, (1−cos θ)/k), tangent T = (cos θ, sin θ), normal N = (−sin θ, cos θ). `obj.matrix_world = place @ Frame(s) @ Translation(-s_link) @ M_original`. Modes: **flat** (lies in XY, stones up, which matches CAD presentation renders) and **worn** (loop around Y with stones facing out, hinge height as the neutral line).
- Store `M0` (original matrix) per object so any pose can be recomputed, including per animation frame.

## 4. Verification (required, written to verification.json, quoted in the final message)
**Geometry.** Measure, don't assume:
- stone count per colour/type and the sequence string (e.g. WGWG…); girdle diameter min/max; depth; pitch set
- carat estimate from stone mesh volume × density against the spec total. A mismatch is a finding. Example: HBR0034 green stones gave 25.4 ct as emerald vs 28.7 ct as diamond, against 28.27 ct on the spec, so the greens were green diamonds. **Ask the user** when the stone type is ambiguous, and don't pick silently.
- prongs per stone (the 4 nearest prong parts by 3D distance) and the prong-to-girdle gap in the CAD (should be ≈0)
- for each pose: max rigid deviation within a link (relative matrix vs CAD, expect ~1e-5), max change in prong gap, and link-head interpenetration depth (BVH overlap on heads/stones only; skip 6-face connector boxes; depth from ray-parity inside test). Report anything above about 0.1 mm.
- Path B: metal grams and carats against the spec.
Note as-modeled facts honestly. Example: straight prong posts about 1.4 mm above the table are a pre-finishing state. Render them as modeled and tell the user the CAD would need updating to show finished beads.

**Render identity**, per still and per animation, so a render can be repeated and checked:
- Blender version and build hash; the device actually used (CPU, or the GPU's name and backend) and the thread count; seed, samples, bounce limits, clamp, denoiser, view transform
- a SHA-256 of the **decoded pixels** of each still (decode the PNG and hash the array). Compare pixels, not files: EXR files and files saved with `Image.save_render()` never repeated byte for byte even when their pixels did [M].
- Repeat test for a new rig or script: render one low-res frame twice in fresh processes and require identical pixel hashes. On the same build and device this held in every test, with the denoiser on or off and at one or two threads [M]. On another machine or a GPU expect "close", not equal: Blender's own tests pass a GPU render when at most 1% of pixels differ by more than 0.016 [S]. State which device made the deliverable.

**Picture truth**, written into `verification.json` and the final message:
- whether stones appear larger than life at the page size, with the millimetre sizes and carat weight to print near the gallery. US rule [S]: a stone pictured larger than actual size may mislead unless the true size is disclosed (16 CFR 23.1, note 3).
- that stones are rendered as ideal, colourless and clean unless the spec says otherwise; which metal preset stands for which alloy, and whether that preset is tested
- anything added that is not in the CAD (edge rounding, a chain, a stand)
- a suggested gallery line: the images are computer renderings of the design, enlarged to show detail. This is not legal advice.

## 5. Materials (Cycles)
**Stones: Principled BSDF.** Blender 5.3 has no socket called "Dispersion"; setting one fails [M]. Use the two real sockets, Scale 1.0 and the stone's own Abbe number:

| Stone | IOR | `Transmission Dispersion Abbe Number` | Colour |
|---|---|---|---|
| Diamond | 2.417 | 55 [M: equals the old 0.36 at Abbe 20] [S] | none |
| Coloured diamond | 2.417 | 55 | Volume Absorption (green: colour (0.03, 0.80, 0.30), density 0.45 for the 6.35 mm stones it was approved on) |
| Moissanite | 2.65 [E] | 25–27 [E] | none |
| Cubic zirconia | 2.16 [E] | 30–34 [E] | none |
| Sapphire / ruby | 1.77 | 72 [E] | blue/red absorption |
| Emerald | 1.58 | 71 [E] | green absorption |

```python
p.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)   # the default 0.8 dims every pass through the stone by 20 % [M]
p.inputs["Transmission Weight"].default_value = 1.0
p.inputs["Roughness"].default_value = 0.0
p.inputs["IOR"].default_value = 2.417
p.inputs["Transmission Dispersion Scale"].default_value = 1.0
p.inputs["Transmission Dispersion Abbe Number"].default_value = 55.0
```
- Colour comes only from a Volume Absorption node on the volume output. Absorption follows exp(−density × (1 − colour) × distance) per scene unit [M], so the same density makes a melee stone pale and a large stone dark. Store the stone diameter beside each density in the library and scale density by (approved diameter ÷ this diameter) [E].
- Dispersion costs almost no time per sample but 4.4 times the noise in the stone [M]: it is what the higher sample floor in section 6 pays for.
- Gem faces use flat shading (`use_smooth=False`). Shared gem mesh → material slot `link='OBJECT'` per stone.

**Metals.** Principled BSDF with `Metallic` 1.0, or the Metallic BSDF (`ShaderNodeBsdfMetallic`). The colours below were computed from measured spectra of the pure metals [S]; the karat alloys are estimates (no measured data exists for gold-silver-copper alloys; expect an error of about ΔE 5), so each alloy preset is `untested` until the user approves a render of it. The colours used before 2026-11-25 are kept in the last column because renders approved with them stand.

| Metal | Base colour (linear RGB) | Roughness | Before 2026-11-25 |
|---|---|---|---|
| Rhodium-plated white gold | (0.797, 0.765, 0.742) [S] | 0.07 | 0.86 grey: brighter than rhodium and neutral, where rhodium is slightly warm |
| Platinum (its own material) | (0.72, 0.68, 0.63) [S, ±0.08 between data sets] | 0.07 | shared the white gold preset |
| 18K yellow | (0.98, 0.77, 0.47) [E] | 0.08 | (1.0, 0.76, 0.38): as saturated as 22–24K |
| 14K yellow | (0.97, 0.77, 0.52) [E] | 0.08 | (1.0, 0.78, 0.45) |
| 14K rose | (0.97, 0.70, 0.49) [E] | 0.08 | (0.98, 0.68, 0.58): too pink |
| 18K red | (0.99, 0.70, 0.45) [E] | 0.08 | none |

For rhodium by its optical constants instead: `fresnel_type = 'PHYSICAL_CONDUCTOR'`, `inputs["IOR"] = (2.172, 1.961, 1.725)`, `inputs["Extinction"] = (5.720, 4.955, 4.401)` [S]. Metal is shade smooth by angle at 35°. Brushed finishes use anisotropy and need tangents: on a mesh over 10,000 faces with more than one thread, 1 render in 16 differed in 3 pixels by one float step [M]. It is invisible at 8 bits, but if a pixel hash must match, render that piece with one thread.

## 6. Render settings: one fixed block
Set every one of these in the script. None may be left to a default or to the user's preferences.

```python
c = scene.cycles; r = scene.render
# sampling: fixed, never tied to the clock
c.seed = 0; c.use_animated_seed = False
c.sampling_pattern = 'BLUE_NOISE'        # 'AUTOMATIC' resolves differently for viewport and final [S]
c.time_limit = 0.0                       # a 10 s limit gave 3 different images in 5 runs [M]
c.use_adaptive_sampling = True; c.adaptive_threshold = 0.01   # repeatable [M]; saves only ~3 % on a stone [M]
c.adaptive_min_samples = 64              # [E] so dark facets are not abandoned early
c.use_guiding = False
# light paths: internal reflections in a stone count as glossy bounces [S]
c.max_bounces = 32; c.glossy_bounces = 32; c.transmission_bounces = 32; c.diffuse_bounces = 3
c.blur_glossy = 0.2                      # no measurable change in the stone against 0 [M]
c.caustics_reflective = False; c.caustics_refractive = False   # see below
# denoiser: pinned, on the CPU
c.use_denoising = True; c.denoiser = 'OPENIMAGEDENOISE'
c.denoising_input_passes = 'RGB_ALBEDO_NORMAL'; c.denoising_prefilter = 'ACCURATE'
c.denoising_quality = 'HIGH'; c.denoising_use_gpu = False
# files whose bytes repeat [M]: these seven off, labels left on, saved by the render call
for f in ("date", "time", "render_time", "frame", "camera", "scene", "filename"):
    setattr(r, "use_stamp_" + f, False)
r.use_stamp_labels = True                # turning this off brings Cycles' time strings back [M]
r.use_persistent_data = False            # stills: one fresh process per piece
```
Save stills with `bpy.ops.render.render(write_still=True)`.

| | Draft | Final still | Animation frame |
|---|---|---|---|
| Samples (`c.samples`) | 64 | 256 or more when a stone fills the frame; 512 catalogue default [E] | 256 floor [E] |
| Bounces (total / glossy / transmission) | 16 / 16 / 16 | 32 / 32 / 32; 64 all round for a hero close-up | 32 / 32 / 32 |
| `c.sample_clamp_indirect` | 20 | 0 after the preview pair below | 20 |
| `c.sample_clamp_direct` | 0 | 0 | 0 |

What the tests behind this table showed, on the one test stone:
- **Glossy bounces [M].** With glossy 16 (the old setting), 17.7% of the stone's pixels were more than 10% too dark; total 32 with glossy 16 looked the same as 16 all round. Glossy 32 cost about 8% more time per sample. 64 all round added 1.8% light for 15% more time. Never set glossy below transmission.
- **Indirect clamp [M].** Clamp 20 removed 39% of the stone's light, and no stone pixel reached display white: that light is the sparkle. The test studio had three small bright panels; the effect on this workflow's strip-softbox rigs has not been measured, and with the clamp off noise in the stone rose about six times. So: for each rig, render one preview pair (clamp 20 and clamp 0, same seed), look at both, and use 0 for stills if the stone gains highlights without fireflies elsewhere. Record the choice per rig in the library.
- **Denoiser [M].** At 64 samples it matched 256 samples without it, but detail inside facets went soft; at 256 the detail was back; facet edges stayed sharp and nothing was invented. It repeated bit for bit on the CPU. Never use the OptiX denoiser for a deliverable: its model ships in the graphics driver and cannot be pinned [S].
- **Caustics [M].** Turning them on left the stone unchanged and changed the ground a little, with more noise. Leave them off for animation. For a still on a visible surface, try them on and look [E].

## 7. Camera, colour, light and scenes
**Camera.** Depth of field ignores the scene's unit scale [M]: at 1 unit = 1 mm, `aperture_fstop = 11` or `4` gives no blur at all. So the old "f/11" and "f/4" did nothing.
- Catalogue stills: `camera.data.dof.use_dof = False`. Everything sharp is also what photographers work for when they focus-stack rings [S].
- Macro with real fall-off: `use_dof = True` and `aperture_fstop` = the photographic f-number ÷ 1000 (f/8 → 0.008) [M]. Blurred sparkle needs two to four times the samples [E].
- Lenses: 135 mm for the three-quarter hero, 100 mm for macro. One focal length and one camera height per piece type across a catalogue.

**Colour.**
- White-background catalogue stills: `scene.view_settings.view_transform = 'Khronos PBR Neutral'`, `look = 'None'`, `exposure = 0.0`, `gamma = 1.0`; `scene.display_settings.display_device = 'sRGB'`. It ships in Blender and was designed for true product colour [S]. Yellow gold kept its colour strength under it (chroma 30.0) and lost about a third under AgX (17.0), which pulls every gold toward beige [M]. No render has been compared with a photograph or a swatch of real gold yet [E].
- Dark-background hero scenes: AgX is fine. "AgX - Base Contrast" gives the same picture as AgX with no look [M].
- **Pure white is made after the render, never by the render.** Render with `scene.render.film_transparent = True`, the ground as a shadow catcher (`obj.is_shadow_catcher = True`) and `scene.cycles.film_transparent_glass = False`, then composite over #FFFFFF with PIL. That gave exactly 255 at the corners under every view transform; a white floor inside the render reached 255 only under Standard [M]. After export, assert that the corner and border pixels equal 255. Pass the ICC profile through when saving with Pillow (`icc_profile=im.info.get("icc_profile")`): Blender embeds one, Pillow drops it unless told [M]. JPEG compression can leave 253–254 next to edges, so check the JPEG too.
- Never set the `OCIO` or `BLENDER_OCIO` environment variables: either replaces Blender's colour configuration [S].

**Light.** Diamonds need **dark/bright structure** to sparkle. An all-white environment makes them flat grey-white. Use:
- a procedural world dome (generated-Z colour ramp with alternating dark/bright bands) for reflections; it needs no HDRI download
- 6–8 vertical emissive strip softboxes in a ring around the subject (`visible_camera=False`, `visible_shadow=False`) plus one large top softbox: large soft light is what shapes polished metal [S]
- [E] 3 to 8 small emissive discs for fire, 3 to 10 mm across, 300 to 600 mm away, 40 to 75° up, with `visible_camera = False` and `visible_glossy = False` so they light the stones without spotting the metal; and a black card near the camera axis so the table shows contrast. Small hard sources are what give a stone fire [S]; every size and distance here is an estimate to be approved on a real piece.

**Scenes** that worked for HBR0034 (approved with the settings in force before 2026-11-25):
1. **White e-commerce:** a dimmer world (top 0.55), shadow-catcher floor, film transparent, composited onto #FFFFFF. Camera 3/4 high, 135 mm.
2. **Black velvet:** piece lying flat on velvet (base 0.004, sheen 0.25, roughness 0.95), low strip ring at strength about 18, top softbox, camera high so stones face it. Don't use a worn loop on a T-bar: the stones show their profiles and it looks weak.
3. **Marble:** wave + noise texture veins with subtle contrast (ramp 0.55→0.88, distortion 5), coat 0.3, warm window light from one side.
4. **Macro detail:** 100 mm across the stones toward the clasp, with depth of field set as above. Crop to 16:9 and use it as a detail/QC shot.

Always do a low-res preview first (about 500–640 px, 64 samples). Composite the previews into one image, look at them, fix what you see, then do finals. Look at every final at full size and at a crop before sending, and send each still as soon as it's done.

## 8. The product-page set
Per piece, from the batch's one rig:
1. **Main image:** 2048 × 2048 px, pure white, the piece filling about 85% of the frame, in the standard angle for its type (rings three-quarter; earrings as a pair; pendants on their chain; bracelets laid or looped). 2048 px is Shopify's recommended size [S]; 85% fill and exact white are what marketplace style guides ask for [S].
2. **Two files from that one render:** with the soft contact shadow, and with the alpha cut to the piece so the ground is pure white with no shadow. Some marketplaces want no shadow on the main image.
3. **Second angle** (top or side profile) and a **macro detail**.
4. **A scale image:** the piece beside a millimetre scale or a size diagram built from the verified dimensions. 42% of shoppers judge size from pictures and many sites give them nothing to judge by [S]. It also answers the true-size rule in section 4.
5. **One mood scene** (velvet or marble) when asked for.
6. **Metal variants** as separate renders from the same camera and lights.

Export: sRGB with the profile embedded. Keep a PNG master; JPEG at quality 92–95 for upload. Platforms convert to WebP or AVIF themselves [S].

Say these plainly when they apply:
- **Etsy** requires at least one unedited photograph of the actual item (policy updated 22 October 2026) [S]. A render-only set does not satisfy it; renders can fill the other slots.
- **Google Merchant Center** bars main images that are mockups or illustrations not depicting the physical product [S]. Whether a faithful CAD render counts is not stated anywhere I could read.
- **Amazon**: its own image-requirements page could not be opened; pure white 255, 85% fill and "actual product, no illustrations" come from Amazon staff posts and its seller blog, and no rule naming renders was found. Have the seller confirm in Seller Central before relying on renders there.
- A live 3D viewer on the page cannot show a gemstone's internal reflections [S]: offer the pre-rendered loop or spin frames instead.

## 9. Animation
Everything is rendered from the model. Always render **numbered frames**, never straight to a video file.

**Spin (the default).** Turn the piece, not the camera: a turning piece passes every facet through every light, while an orbiting camera carries the same lighting round with it [E]. 144 frames at 24 fps is a 6-second loop, and every second or fourth frame makes a 72- or 36-frame drag-to-spin set.
```python
import bpy, math
from bpy_extras import anim_utils
sc = bpy.context.scene; N = 144; sc.render.fps = 24
sc.frame_start, sc.frame_end = 1, N                      # render 1..N only
piv = bpy.data.objects.new("pivot", None); sc.collection.objects.link(piv)
piv.location = centre                                    # bbox centre of the stone centres, not an object origin
bpy.context.view_layer.update()                          # without this the pivot's matrix is still identity and the piece jumps by `centre` [M]
for o in root_objects:
    o.parent = piv; o.matrix_parent_inverse = piv.matrix_world.inverted()
piv.rotation_euler[2] = 0.0;      piv.keyframe_insert("rotation_euler", index=2, frame=1)
piv.rotation_euler[2] = math.tau; piv.keyframe_insert("rotation_euler", index=2, frame=N + 1)   # N+1, not N
ad = piv.animation_data
fc = anim_utils.action_get_channelbag_for_slot(ad.action, ad.action_slot).fcurves.find("rotation_euler", index=2)
for k in fc.keyframe_points: k.interpolation = 'LINEAR'  # new keys default to Bezier, which eases
fc.extrapolation = 'LINEAR'
```
Keying the last pose on frame N instead of N+1 gives a duplicated frame and a stutter once per loop [M, scripting interface].

**Sparkle shot [E].** At 2.5° a frame a flash can last less than one frame and strobe. When sparkle is the point, add a slower move of 1° a frame or less: a ±15° rock, or a light sweeping over a still piece.

**Curl (bracelets).** Closure goes from 0 to 1 over the first 60% (cosine ease), then holds while the piece turns 50°. Each frame, re-pose by rigid links and recentre on the **bbox centre of the stone centres**. Metal object origins are not positions. Auto-fit the lens to the piece's extent so the straight piece stays in frame.

**Frame settings**, on top of section 6:
```python
c.use_animated_seed = False              # locked camera, denoiser on: steadier than an animated seed [M]
r.use_persistent_data = True; r.use_motion_blur = False
r.image_settings.media_type = 'IMAGE'; r.image_settings.file_format = 'PNG'
r.image_settings.color_mode = 'RGBA'; r.image_settings.color_depth = '16'
r.filepath = "//frames/tt_####"; r.use_overwrite = False; r.use_placeholder = True   # restartable, shareable [S]
```
- On static ground with the denoiser, a fixed seed flickered 0.037–0.040 of 255 per frame against 0.054–0.071 with an animated seed [M]. Noise on the moving piece itself was not separated from its motion. When the camera moves, use an animated seed [E].
- Blender has no flicker-reducing denoiser in the normal render path [S]. Flicker is bought down with samples, not a switch. Keep the indirect clamp at 20 for frames.
- If a render stops, start it again with the same command: it fills the missing frames.

**Verify, in four steps:**
1. No render: evaluate the curve at each frame and confirm the step is exactly 360/N; rerun the rigidity checks of section 4 at the frames to be rendered.
2. A contact sheet of 8–12 key frames at tiny resolution.
3. 8–10 **consecutive** frames at final settings, played as a loop and watched. A still can look clean while the sequence flickers.
4. After the render: the frame count equals N; no zero-byte files (a placeholder passes a name-only check); `ffprobe` shows N frames; the first-to-last pair differs no more than an ordinary neighbouring pair; and the frame check below flags nothing. Write the results to `verification.json`.
```python
# flicker_check.py "frames/tt_*.png" [z]: brightness pops, duplicates, the wrap step
import sys, glob, numpy as np
from PIL import Image
files = sorted(glob.glob(sys.argv[1])); ZT = float(sys.argv[2]) if len(sys.argv) > 2 else 6.0
def load(p):
    im = Image.open(p).convert("RGBA"); bg = Image.new("RGBA", im.size, (255, 255, 255, 255)); bg.alpha_composite(im)
    im = bg.convert("L"); im.thumbnail((640, 640)); return np.asarray(im, dtype=np.float32)
fr = [load(p) for p in files]; n = len(fr)
mask = np.min(fr, axis=0) < 250
mean = np.array([f[mask].mean() for f in fr])
step = np.array([np.abs(fr[i] - fr[i-1])[mask].mean() for i in range(n)])
res  = np.array([np.abs(fr[i] - (fr[i-1] + fr[(i+1) % n]) / 2)[mask].mean() for i in range(n)])
pop  = np.array([mean[i] - (mean[i-1] + mean[(i+1) % n]) / 2 for i in range(n)])
def z(x): m = np.median(x); mad = np.median(np.abs(x - m)) or 1e-6; return (x - m) / (1.4826 * mad)
print(f"frames {n}; wrap/typical step = {step[0] / np.median(step):.2f}")
for name, arr in (("brightness pop", pop), ("residual", res)):
    zz = z(arr); print(name, [(files[i].split('/')[-1], round(float(zz[i]), 1)) for i in np.where(np.abs(zz) > ZT)[0]])
```
On synthetic frames it caught a 3% brightness pop, a duplicated frame and a black frame; it missed one noisier frame inside fast motion, which is why step 3 needs eyes [M]. Its threshold has not been calibrated on a real render [E].

**Encode with an explicit colour conversion.** `-pix_fmt yuv420p` alone turned pure green into (0, 215, 0), so a green stone loses about 15%; the filter below gave (0, 254, 0) [M, FFmpeg 6.1.1].
```bash
IN='-framerate 24 -start_number 1 -i frames/tt_%04d.png -f lavfi -i color=c=white:s=1080x1080:r=24'
FLT='[1:v][0:v]overlay=shortest=1:format=auto,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p'
TAGS='-color_range tv -colorspace bt709 -color_primaries bt709 -color_trc iec61966-2-1'
ffmpeg $IN -filter_complex "$FLT" -c:v libx264 -preset slow -crf 18 $TAGS -movflags +faststart -an tt_h264.mp4          # plays everywhere
ffmpeg $IN -filter_complex "$FLT" -c:v libx265 -preset slow -crf 22 -tag:v hvc1 $TAGS -movflags +faststart -an tt_hevc.mp4   # smaller, Apple devices
ffmpeg $IN -filter_complex "[1:v][0:v]overlay=shortest=1:format=auto,select='not(mod(n\,2))'" -fps_mode passthrough -start_number 0 -q:v 3 spin/tt-%d.jpg   # 72 spin frames, over white
```
The frames are transparent, so every line lays them over white first: a JPEG or MP4 made straight from them comes out on black [M]. The size in `color=...:s=` must match the frames, with even numbers. A loop gets no held last frame; hold the end (`tpad=stop_mode=clone:stop_duration=1.5` before the `scale`) only for the one-shot curl. On the page a silent loop needs `muted playsinline autoplay loop` [S]. These lines ran on FFmpeg 6.1.1 with synthetic frames (144 frames in, 144 out at 6.000 s, tagged bt709; 72 spin frames on white); no browser was used, and file sizes for real renders are unknown.

## 10. Deliverables
- The product-page set of section 8 as PNG masters and JPEGs, each sent with SendUserFile as soon as it's verified
- The loop as MP4 (H.264, plus HEVC), and the spin frames
- `verification.json`: geometry, render identity and picture truth (section 4), animation checks (section 9)
- `kit.zip`: import script, scene script (argparse: `--scene`, `--res`, `--samples`, `--cycles-device`, `--anim`, `--frames`, `--frame_start/step`, `--save_blend`, `--no_render`, `--verify`), `flat.blend`, ready-to-open scene .blends, `verification.json`, and a README.
  - Launch line: `blender -b --factory-startup --python-exit-code 1 -P scene.py -- --scene white --res 2048 --samples 512 --cycles-device METAL`. `--factory-startup` ignores the user's preferences and add-ons, so the script sets the device itself [S]: `prefs = bpy.context.preferences.addons['cycles'].preferences; prefs.compute_device_type = 'METAL'; prefs.refresh_devices()`, set `use = True` on the wanted entries of `prefs.devices`, `prefs.metalrt = 'OFF'`, `scene.cycles.device = 'GPU'`. Then print the devices in use and stop if none is enabled: asking for the GPU with no device enabled renders on the CPU without an error [S]. This line was assembled from Blender's source and has not been run on a GPU or a Mac [E].
  - The README says: use Blender 5.3.0; a GPU render is close to the CPU preview, not identical; time one frame on your machine before a long render.
- Final message: one line per deliverable, the key verified numbers, the device and build that made each picture, any as-modeled caveats and anything added that is not in the CAD, which settings used were still `untested`, one line on what the library learned (or "nothing new"), and one next step.

## Pitfalls hit before
- In a batch, stone colour layers differ between CAD files. Never assume layer 11 = white from an earlier piece; re-derive the mapping from each piece's own reference image.
- Waiting on renders: `pgrep -f "hbr_scene.py --scene"` inside `bash -c '...'` matches its own command line and loops forever. Wait on the PID with `kill -0 PID` instead.
- Background jobs die a few minutes after the reply ends, so poll with `sleep` inside the turn until finals finish.
- `Mesh.vertices[::3]` isn't sliceable: use `list(...)[::3]`.
- Mixing per-part frames (each prong with its own x) shifts prongs about 0.2 mm off the stone. Always use per-link frames.
- Wrong closing length leaves a gap or overlap at the clasp, so check the clasp region in an ortho view.
- A loose Brep bounding box made one clasp latch look 181 mm long. Measure from the mesh.
- A time limit, a changed sample count, or a different seed each gives a different picture [M]. Changing `samples` changes the whole noise pattern, not only its level [S], so compare two renders only at the same sample count.
- Glossy bounces below transmission bounces darken stones while looking like a harmless speed-up (section 6).
- An f-number typed as in photography does nothing at millimetre scale (section 7).
- Comparing files instead of pixels reports a difference that is only a date stamp (section 4).
