---
name: "jewelry-render"
description: "Hyperreal Blender renders and turntable/animation video of jewelry from a Rhino .3dm and/or reference images + spec sheet, one piece or a whole folder one by one; builds visualization CAD when no 3dm is given, and reads and grows the aska-render-lib knowledge base each run."
---

# Jewelry render workflow (Aska Jewels)

Inputs can be any of these: a Rhino `.3dm`, reference images (CAD renders or photos), and a spec sheet (style number, stone mm, qty, total ct weight, metal and karat, metal grams, length or ring size). They arrive either for **one piece** or as a **folder of many pieces**, usually sent over by the family, to work through one by one (see Batch mode). The output is a product-page still set, a looping turntable with spin frames, a verification report, and a Blender kit the user can re-render on a GPU.

Two rules matter most.

**Verifiable, no hallucination.** Every dimension comes from the CAD or the spec. Every claim in the final message is backed by a number the scripts measured. Whatever is inferred instead of measured gets labelled as inferred.

**Repeatable.** The same script on the same Blender build and the same device gives the same pixels, today and next month. Nothing in a deliverable depends on how fast the machine is. No generative AI makes or alters any picture or video: everything is rendered from the 3D model.

How to read the settings below.

**Revision 2026-11-26 (evening).** Four sessions of look work in Pavé were written in: the 18k colour now follows ISO 8654 (section 5); dispersion stays off; section 7 is reorganised into general rules, stones, and **lighting and grounds by scene type** (white, soft grey, charcoal, black acrylic, daylight, warm sweep, velvet and marble), each rule marked; four earlier claims are corrected where a later render disagreed (the stones' room, the warm sweep's backdrop light, the flat band side, the seat holes in rose gold); the old "strip ring plus banded dome" and "small sparkle discs for fire" estimates are replaced by what the renders showed. Sources from that work were read as search summaries only (the session could not open pages), so treat their [S] as weaker than a standard or Blender's own source. No render has yet been compared with a photograph of a real piece, and nothing here has been approved by the user on a family piece.

They were first revised on 2026-11-25 from tests in Blender 5.3.0 on a CPU (one small scene: a 6.5 mm round diamond in a yellow gold ring; no GPU, no Mac). Each is marked:
- **[M]** measured in those tests;
- **[M, Pavé]** rendered with and without, and looked at whole and cropped on the stone and the ground, through Pavé's render worker (Blender 5.3.0, Cycles on two CPU threads of a shared 4-core Linux machine, no GPU), on a 6.4 mm diamond solitaire in 18k yellow gold, a platinum eternity band of 1.8 mm stones, a sapphire pendant in rhodium-plated white gold, face-up 18k studs and a rose-gold three-stone with pavé shoulders, at 512 to 768 px and 64 samples unless a line says otherwise. That worker builds its scenes in metres, with emissive panels sized in multiples of the piece's radius ("radii") and placed by azimuth as seen from the camera (0° behind the camera, 180° behind the piece), so its numbers are ratios, not millimetres. The pairs and pictures are in `docs/research/spikes/25-look-realism/` and `docs/research/24-render-realism-measured.md` of the Pavé repository;
- **[S]** read at a source (Blender source or manual, a platform's own page, a standard, a photographer's guide);
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

Timing: never quote a time from memory. Time one low-res frame, scale it by pixels and samples, and say the number with the count ("12 pieces ≈ N h here"). On two CPU cores a stone close-up cost about 2.1 CPU-seconds per sample per megapixel [M]; a whole bright Daylight frame at 1600 px and 384 samples took 943 s on two threads, 1.9 CPU-seconds per sample per megapixel, and black acrylic 401 s, 0.8, because adaptive sampling stops early on black [M, Pavé]. So a 2048 px, 256-sample still is about 15 to 19 minutes on a bright set [E, scaled]. Final-quality video is not feasible on two cores: plan previews here plus kits rendered on the user's GPU, and say so up front. No GPU or Mac timing has been measured for this workflow.

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

**Edges.** CAD edges are perfectly sharp; real polished metal never is, and a razor edge is one of the things that makes a render read as fake. A studio guide rounds major edges by about 0.2 mm [S]. Option that changes shading only: a Bevel node (`ShaderNodeBevel`, `samples = 6`, `inputs["Radius"]` 0.1 mm) into the metal's `Normal`. On a flat-sided eternity band [M, Pavé]: with no radius the top face meets the side in a line that catches no light; 0.06 mm gives a hairline highlight that is barely there at 512 px; 0.15 mm a soft, plainly rounded edge; 0.1 mm sits between. On a round-wire solitaire not one pixel changed, so it only acts where the CAD is sharp, and the render time did not move outside the noise. Never on stones. It is an addition that is not in the CAD, so record it in `verification.json` and say so.

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
- Dispersion costs almost no time per sample but 4.4 times the noise in the stone [M].
- **Leave dispersion off (`Transmission Dispersion Scale` 0) at every sample count, until a measured pair says otherwise [M, Pavé, 2026-11-26].** Cycles traces it by giving each path one of three colour channels, each with its own IOR: Blender 5.3's dispersion is RGB-based, not spectral [S: 80.lv, "Understanding Native Dispersion In Blender 5.3"]. Thirty bounces inside a brilliant send the three down different facets, so the converged picture is a per-pixel mosaic of red, green and blue, not fire. On an 18k solitaire on black acrylic, the share of stone pixels with CIELAB chroma above 30: 22 % at 384 samples (threshold 0.02 or 0.005, the same), 14.6 % at 1024 samples, 14.8 % at 1024 with the denoiser off, 8.8 % at 1024 with the Abbe number quadrupled to 221, 20 % at 1600 px and 1024 samples (facets readable again, every edge fringed with rainbow; 14.8 % downsized to 800 px), and 3.9 % with dispersion off (the rest is the gold seen through the stone). The denoiser is not keeping noise and more samples do not resolve it, because it is not noise. An earlier line here, "set Scale 1.0 from about 384 samples, where the colour resolves into flashes", was wrong. Measure every take: count the stone pixels (render a second 8-sample pass with the metal as holdout, `obj.is_holdout = True`, and the ground hidden, for the stone matte) whose chroma is above 30, and reject a take above 5 %. Fire then comes only from the small lights' white flashes; say so with the pictures.
- Gem faces use flat shading (`use_smooth=False`). Shared gem mesh → material slot `link='OBJECT'` per stone.

**Metals.** Principled BSDF with `Metallic` 1.0, or the Metallic BSDF (`ShaderNodeBsdfMetallic`). The colours below were computed from measured spectra of the pure metals [S]; the karat alloys are estimates (no measured spectra exist for gold-silver-copper alloys; expect an error of about ΔE 5) except 18K yellow, checked against the ISO 8654 nominal colour, so each alloy preset is `untested` until the user approves a render of it. The colours used before 2026-11-25 are kept in the last column because renders approved with them stand.

| Metal | Base colour (linear RGB) | Roughness | Before 2026-11-25 |
|---|---|---|---|
| Rhodium-plated white gold | (0.797, 0.765, 0.742) [S] | 0.07 | 0.86 grey: brighter than rhodium and neutral, where rhodium is slightly warm |
| Platinum (its own material) | (0.72, 0.68, 0.63) [S, ±0.08 between data sets] | 0.07 | shared the white gold preset |
| 18K yellow | (0.98, 0.75, 0.47) [S: ISO 8654 2N within ΔE 1, section 7; M, Pavé: 0.77 in the green rendered paler] | 0.08 | (1.0, 0.76, 0.38): as saturated as 22–24K |
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
- **Glossy bounces [M].** With glossy 16 (the old setting), 17.7% of the stone's pixels were more than 10% too dark; total 32 with glossy 16 looked the same as 16 all round. Glossy 32 cost about 8% more time per sample. 64 all round added 1.8% light for 15% more time. Never set glossy below transmission. Seen again from 12 to 32 [M, Pavé]: 22.8% of the stone's pixels changed and its mean rose 2.2%. One warning from that pair: the black facets at a low depth look like contrast, and in a bright tent removing them leaves the stone *flatter*. Depth takes out false blacks; only the light puts real darks in (section 7).
- **Indirect clamp [M].** Clamp 20 removed 39% of the stone's light, and no stone pixel reached display white: that light is the sparkle. The test studio had three small bright panels; with the clamp off noise in the stone rose about six times. On soft strip-and-softbox rigs whose panels stay under 3.5 [M, Pavé], clamp 30 against off changed 0.2% of the stone's pixels at 64 samples and nothing a person could see: with no small hot source there is little above the clamp to lose. So the clamp matters in proportion to how small and bright the sources are. For each rig, render one preview pair (clamp 20 and clamp 0, same seed), look at both, and use 0 for stills if the stone gains highlights without fireflies elsewhere. Record the choice per rig in the library.
- **Denoiser [M].** At 64 samples it matched 256 samples without it, but detail inside facets went soft; at 256 the detail was back; facet edges stayed sharp and nothing was invented. It repeated bit for bit on the CPU. Never use the OptiX denoiser for a deliverable: its model ships in the graphics driver and cannot be pinned [S].
- **Caustics [M].** Turning them on left the stone unchanged and changed the ground a little, with more noise. Leave them off for animation. On a shadow-catcher ground under a small sun, and on a paper sweep under a large key [M, Pavé], on against off changed 0.5% and 0.7% of pixels and drew no visible spot of light at 64 samples. Turn them on only for a still on a ground that takes light, with a hard source, and expect little.
- **Samples, with dispersion off [M, Pavé].** At 64 samples and 768 px stones showed clean facets once dispersion was off; the coloured grain once blamed on too few samples was dispersion (section 5). 384 samples at 1600 px gave clean facets and crisp edges on black acrylic and Daylight.
- **Cost per tier on two CPU threads [M, Pavé].** 768 px at 64 samples: 48 to 128 s a frame across six looks and three pieces (median 85 s; about 2 s per million pixel-samples after a fixed cost of about 15 s a pass). 1600 px at 384 samples, noise threshold 0.02: 401 s on black acrylic (adaptive sampling stops early on black), 943 s on a bright Daylight set with caustics. 800 px at 1024 samples: 218 to 330 s on black acrylic. A 1600 px take at 1024 samples was not timed.

## 7. Camera, colour, light and scenes
**Camera.** Depth of field ignores the scene's unit scale [M]: at 1 unit = 1 mm, `aperture_fstop = 11` or `4` gives no blur at all. So the old "f/11" and "f/4" did nothing.
- Catalogue stills: `camera.data.dof.use_dof = False`. Everything sharp is also what photographers work for when they focus-stack rings [S].
- Macro with real fall-off: `use_dof = True` and `aperture_fstop` = the photographic f-number ÷ 1000 (f/8 → 0.008) [M]. Blurred sparkle needs two to four times the samples [E].
- A true photographic f-number is too shallow for a ring anyway [M, 2026-11-26, Pavé's render worker, which builds its scenes in metres so the f-number is a real lens's]: a 105 mm lens 60 mm from a 6.5 mm stone at f/5.6 smeared the back of the stone over 5.7% of the frame, and the whole stone read as out of focus; a 100 mm hero at f/2.8 left nothing sharp. The blur matched the thin-lens formula within 7%: blur as a share of the frame's width = f² × |d − D| ÷ (36 × N × D × d), with focal length f, focus distance D and the point's distance d in millimetres. Pick the blur you want on the far side of the stone (0.15% of the frame kept it sharp at 768 px) and solve for N, instead of typing a lens's f-number: that gave about f/240 for the macro, with the band behind just soft.
- Lenses: 135 mm for the three-quarter hero, 100 mm for macro. One focal length and one camera height per piece type across a catalogue.

**Colour.**
- White-background catalogue stills: `scene.view_settings.view_transform = 'Khronos PBR Neutral'`, `look = 'None'`, `exposure = 0.0`, `gamma = 1.0`; `scene.display_settings.display_device = 'sRGB'`. It ships in Blender and was designed for true product colour [S]. Yellow gold kept its colour strength under it (chroma 30.0) and lost about a third under AgX (17.0), which pulls every gold toward beige [M]. No render has been compared with a photograph or a swatch of real gold yet [E].
- **Check an alloy's colour against ISO 8654, not by eye [S].** The standard's nominal colour 2N (18 ct yellow) is L* 90.2, a* 3.47, b* 25.1 (3N: 89.1, 5.74, 23.05). Base colour (0.98, 0.75, 0.47) is L* 90.7, a* 3.5, b* 24.2: within ΔE 1 of 2N. Converted to linear sRGB, 2N is (0.97, 0.74, 0.45) and 3N (0.97, 0.71, 0.46). Real 18k gold mirroring a white light *is* pale; when a render's gold looks cream, it is the light (below), not the alloy. Retouchers lift the yellows of gold selectively after the shoot [S, search summaries only]; a render that has to be colour-true should not.
- Dark-background hero scenes: AgX is fine for white metal. "AgX - Base Contrast" gives the same picture as AgX with no look [M]. For gold it is not: on a warm cream sweep AgX turned 18k yellow gold a pale rose-beige and Neutral kept it golden [M, Pavé], so use Neutral wherever gold has to read as gold.
- **Neutral has a toe [M, Pavé].** Below 0.08 linear it returns 6.25 x²: 0.04 becomes 0.01 and 0.02 becomes 0.0025. Blacks stay black, but a dim backdrop, a dim mirror image or the shadow side of a piece renders far darker than its linear value. Anything meant to show as dark grey must sit near 0.08 before the view transform, and the shadow side of a piece needs fill of at least 0.1.
- **White balance the lights, colour the set [M, Pavé].** Lights at 3400 K made yellow gold copper and platinum rose. For a warm picture keep the lights at 5000 to 5600 K and make the ground warm.
- **Pure white is made after the render, never by the render.** Render with `scene.render.film_transparent = True`, the ground as a shadow catcher (`obj.is_shadow_catcher = True`) and `scene.cycles.film_transparent_glass = False`, then composite over #FFFFFF with PIL. That gave exactly 255 at the corners under every view transform; a white floor inside the render reached 255 only under Standard [M]. After export, assert that the corner and border pixels equal 255. Pass the ICC profile through when saving with Pillow (`icc_profile=im.info.get("icc_profile")`): Blender embeds one, Pillow drops it unless told [M]. JPEG compression can leave 253–254 next to edges, so check the JPEG too.
- Never set the `OCIO` or `BLENDER_OCIO` environment variables: either replaces Blender's colour configuration [S].

**Exposure of the rig [M, Pavé].** This was the largest single cause of renders that "don't read as photographs", larger than every Cycles setting in section 6 together.
- **Polished metal shows the rig, so a light's radiance is its brightness in the picture.** With emission strength 1 as display white, 18k gold mirrors a panel of 2 as saturated yellow just under white (display 0.96, 0.76, 0.51) and a panel of 6 as cream (0.99, 0.85, 0.69). Keep softboxes and strips between 1 and 3.5, the world well under 1, and exposure 0 under Neutral. Rigs with panels at 4 to 9 in a world near 1 gave beige metal with no darks and a flat white diamond.
- **The half of the room behind the camera is most of what a convex piece mirrors.** Fill it with soft white walls no brighter than about 1.2: walls of 1.6 turned an 18k band cream, 1.1 left it amber with darker strokes and the stone unchanged, because Neutral's shoulder takes the yellow out of anything above about 1.2. Draw the darks with thin black cards between the walls, a black card on the lens axis, and a long black belt card along the horizon in front for the line that runs round a band. Wide black cards there turn gold to bronze. Photographers say the same: black cards just outside the frame give metal its dark edges and lustre, and an all-white set flattens metal until white reflections merge the piece into the background [S: search summaries of [UniquePhoto](https://www.uniquephoto.com/community/qa/how-do-i-get-a-pure-white-background-for-jewelry-photos-without-losing-shine-and-sparkle), [Tryhylo](https://tryhylo.com/learn/guides/how-to-photograph-rings-without-reflections), [ExpertPhotography](https://expertphotography.com/jewelry-photography-mistakes/)].
- **Put the main softbox above and behind the piece** (60 to 70° up, behind as seen from the camera), not overhead. The contact shadow then falls toward the camera, where it is seen, and top faces carry one long highlight. Overhead, a thin ring hides its own shadow and seems to float.
- **Thin strips draw lines, big panels wash.** A strip's mirror image on a band is a crisp line; a large softbox lights the whole ring from one direction [S: search summaries of [Adaptalux](https://adaptalux.com/?p=26830), [Shopify](https://www.shopify.com/blog/jewelry-photography): two strips at opposing angles give defined highlight bands].
- **Give every emitter its strength as a constant in the shader** (`Emission` node `Strength`), never in a vertex colour or a texture alone. Cycles reads those constants to decide how often to sample each emitter; with strength hidden in a vertex colour a small sun 1500 times brighter than a softbox was sampled as if it were equal, and cast no shadow at any sample count tried.
- **On a dark set, fill the front and underside of a band from low behind the camera** [solitaire and eternity band, black acrylic and charcoal]. From 22° up a vertical metal face mirrors the floor about 22° below the horizon, and the round underside of a wire mirrors the low room behind the camera; on black both are black, and gold there renders olive-brown, the "dirty brass" look. A long low softbox behind the camera (3° up, 8 × 1 radii, strength 2.5 on black acrylic, 2.2 on charcoal, invisible to the camera) turned the band amber-gold with one bright gradient along its front, the largest gain of that session. Brighter walls in front (1.4/1.0 raised to 2.0/1.6) did almost nothing: the band does not see them.
- **On a white set, lay a black card low in front for the metal** [18k solitaire]. From 20° up the outer face of a band mirrors the floor about 20° below the horizon in front of it; on white that is bright, and the band read as one flat tan (L* p10 70, p50 80). A black card 16° below the horizon behind the camera, 7 × 1.6 radii at 4.5 radii, invisible to transmission rays and under the shadow catcher (which reflections do not see), drew a dark stroke along each face (p10 16, highlights unchanged at 92). A taller card (9 × 4, 22° down) only blackened the inside of the shank.
- **Find where a flat face looks before placing a card for it** [rose-gold three-stone]. A flat polished face is one mirror and shows one direction. Render a one-bounce reflection map: every metal a perfect mirror (Glossy, roughness 0), stones held out, the ground hidden, the world coloured by direction (`Texture Coordinate → Generated` × 0.5 + 0.5, view transform Raw, pixel filter 0.01, 8 samples, one glossy bounce), then a pass with each panel a flat ID colour and the world black. It takes seconds. In the hero shot (35° round, 24° up) the side of a flat-sided band mirrored 78° round and 33° below the horizon on every pixel; black flags placed by guess at ±70°, 5° up were mirrored by nothing. A gradient card there (3 × 3 radii at 4.5 radii, 38° down, bright at the bottom 2.4, black at the top, metal only) gave the side a run from dark under the head to bright at the bottom: L* p10/p50/p90 61/65/73 to 39/68/86. **Correction:** only the dark and bright ends moved; the median stayed at 68 (Catalogue white 77, the solitaire 68 to 80), so in the bright looks the face still reads as an evenly lit tan plane. A taller card darker at the top (3 × 5, gradient 1 to −0.2) is the next thing to try [E].

**Stones: light them apart from the mount.** A diamond sparkles from a pattern of bright and dark facets, not from brightness; the dark arrows of a round brilliant are the camera and the dark above the table mirrored in the pavilion [S: search summaries of [Whiteflash](https://www.whiteflash.com/diamond-education/dark-arrows-in-diamond-photos/), [Pricescope](https://www.pricescope.com/blog/role-contrast-diamond-appearance)]. A white tent makes a diamond flat [S: [Rapaport](https://rapaport.com/magazine-article/photographing-a-diamond-how-to-bring-out-the-bling/)]; many large sources wash diamonds out, and render artists light stones and mount with different lights [S: search summary of [Blender Artists](https://blenderartists.org/t/how-to-achieve-realistic-diamond-caustics-and-light-play-in-cycles/1605044)]; direct light for fire, diffused light for metal [S: [GIA](https://gia.edu/gem-photography)]. What the renders showed [M, Pavé]:
- **A dim room for light that has left a stone.** In the world shader multiply the background by a factor when `Light Path → Is Transmission Ray` is set; the metal still sees the full room. At 1 a solitaire on Studio soft was light grey with little dark; at 0.3 it showed dark and bright facets and a readable table. **Correction:** once the stone cards below are in, 0.3 is too bright. Face-up studs on Studio soft had 1.3 % of stone pixels darker than 60 of 255 (three-stone 0.5 %): crushed ice, not a diamond. At 0.05 the same studs had 6.4 % (three-stone 2.7 %) with the median still 224, the arrows and contrast facets back and no loss of whiteness (a reviewer's pair at 768 px). Use 0.05 with stone cards; Pavé's looks still carry 0.3 (0.2 in Daylight) at this revision.
- **Give a stone that faces the lens its own white cards.** With a dim room a face-up stone mirrors the dark round the lens and stays slate grey (p50 122 to 142). Two panels either side of the lens, seen only by light leaving a stone (`visible_glossy = visible_diffuse = False`, light-linked to the stones), 1.5 × 5 radii at 5 radii: at ±25°, 16° up, strength 5 they lit the crown's edge only (table p50 138 to 156); at ±18°, 10° up, strength 8 the crown mirrors them across the table (p50 222 to 234 on Studio soft and Catalogue white, 220 in Daylight at strength 6, where without them stones read as milky glass, p50 189). They make stones bright more than contrasty: pair them with the 0.05 room. Narrower cards (1 × 3) and a wider lens card are untested [E].
- **Keep the black card on the lens axis**, which draws the arrows, **and every other black card off the stones**: a black belt card or a card behind the piece shows as a grey bar or a dark patch in every face-up stone; make them invisible to transmission rays (`visible_transmission = False`) and the metal still mirrors them.
- **A colourless stone in a coloured mount picks up the mount** [rose-gold three-stone]. Seen from the side a pavilion shows the claws and gallery behind it; in rose gold the centre stone read as morganite (R − B 33 against 7 in yellow-gold studs), and whiter stone cards changed nothing. Mix the metal's base colour and edge tint 70 % toward their own luminance when `Light Path → Transmission Depth` is above 0 (a path that has passed through a stone): R − B 14, white with a trace of warmth; at 100 % the stone looked set in white gold. `Is Transmission Ray` alone reached only 22, because light bounced on between claws. A deliberate departure from physics: say so in `verification.json`.
- **Small "sparkle" lights add white flashes, not fire, and little of either.** Twelve discs 2.3° across seen only by stones changed 1.6 % of a diamond's pixels at 256 samples; at 0.5° across, 0.2 %. Pavé keeps four discs 1.3° across. The flashes in these renders come from the edges of the softboxes. A second set for pavé (four discs 0.3° across near the lens axis, strength 60, linked to stones under 2.5 mm) made no visible difference at 768 px, where a 0.9 mm stone is five pixels; 1.8 mm and 0.9 mm pavé stays dull grey beads in every look. Fire itself cannot be rendered cleanly in Cycles 5.3 (section 5). The earlier recipe of 3 to 8 discs 3 to 10 mm across at 300 to 600 mm remains an untested estimate [E].

**Lighting and grounds by scene type.** One rig per batch (Batch mode 5). Pavé's six looks are the tested starting points; the values are its, in radii.

1. **White catalogue** (marketplace main image).
   - Ground and backdrop: a shadow catcher, film transparent, composited over #FFFFFF after the render (Colour). Photographers light the white background apart from the piece [S: search summaries of [Visual Education](https://visualeducation.com/jewellery-photography-top-tips-for-how-to-photograph-jewellery/), UniquePhoto]; a backlit white table gives white in camera but can wash a foggy halo into the piece's edges [S: search summary of [Orbitvu](https://orbitvu.com/blog/how-photograph-jewelry-10-tips-make-your-pictures-pro)]; compositing avoids both [M].
   - Light [M, Pavé]: top softbox above and behind (2.4, 7 × 5 radii); walls behind the camera at 1.15 and 1.0; side gradient cards for flat band sides; the low black card for the metal; the two stone cards; the stones' room at 0.05.
   - Seen [M, Pavé]: gold is colour-true (ISO 2N) and paler than retouched product photos, whose yellows are lifted selectively afterwards [S: search summaries of [Path](https://pathedits.com/blogs/tips/how-to-edit-jewelry-product-photos-like-a-pro), UniquePhoto]; a render that promises true colour should not lift them. Face-up studs framed small (5 % of the frame) and face-on at 6° read as flat discs; the black-acrylic rule (raised to 16°, turned 15°) reads far better there, untested on white [E].
   - HBR0034's approved white set (before 2026-11-25): a dimmer world (top 0.55), shadow-catcher floor, film transparent, camera 3/4 high, 135 mm.
2. **Soft grey studio.** The white rig on a pale grey gradient (0.97 to 0.86) [M, Pavé]. It reads as the same light as white on another backdrop (three-stone stone p5/p50/p95 103/169/245 against 117/185/246) [M, Pavé]. Separating them by key ratio (brighter walls and no belt card on white) is untested [E].
3. **Charcoal contrast.** A real diffuse sweep of albedo 0.085, not a shadow catcher: over a dark backdrop a catcher shows no shadow and the piece floats [M, Pavé]. Four wide strips with gaps and black flags, a rim strip at −150° (3.2), top 2.6, the low strip behind the camera at 2.2, a room of 0.12 to 0.16 [M, Pavé]. Dark grey backdrops strengthen metal reflections [S: search summary of [Will Gibbons](https://www.willgibbons.com/blog/jewelry)]. Seen: still dark overall; a background light on the sweep left a line where floor meets cove in every version tried [M, Pavé].
4. **Black acrylic** (not yet approved on a family piece).
   - Sheet [M, Pavé]: base colour 0.004, roughness 0.06, IOR 1.49, PMMA's refractive index [S: [Edmund Optics](https://edmundoptics.co.uk/f/Acrylic-PMMA-Plastic-Windows/39834)].
   - Reflection fall-off is set by the camera's height [S: Fresnel equations at n 1.49, computed]: unpolarised reflectance 4 % top-down, 5 % at 45° up, 9 % at 30°, 15 % at 22°, 23 % at 16°, 56 % at 6°. At a 22° hero the mirror image is dim and softens with distance from the contact [M, Pavé]; from a low camera the sheet is nearly a mirror. Photographers use a dark rather than a clear mirror for the same reason [S: search summary of [Photigy](https://www.photigy.com/photographing-jewelry-the-lighting-setup-tips-and-tricks-plus-bonus-video/)].
   - Camera 16° up or more [M, Pavé, studs]: from 6° the camera saw the horizon glow itself, a mid-grey wall (126 to 129 of 255) with a hard line where the sheet starts and a mirror image nearly as bright as the stones. Pavé raises lower shots to 16°, and turns a raised shot within 15° of face-on to 15°, so a stud's post reads as a post.
   - Backdrop: the camera sees the world (`film_transparent = False`), a glow along the horizon of 0.26 falling to 0.04 overhead (0.26 because of Neutral's toe); mirrored in the sheet it runs from charcoal at the top of the frame to black at the bottom, and the sheet reads as a surface, not a void [M, Pavé]. Photographers make the same gradient with a gridded spot on the backdrop, keeping the main light off it [S: Photigy].
   - Rig [M, Pavé]: top softbox above and behind (2.2), side strips, rim strips behind at ±145° (a flagged backlight for rim light [S: search summaries of [Venus](https://www.venuslens.net/black-product-photography/), [Path](https://pathedits.com/blogs/tips/how-to-photograph-reflective-products-tips-and-examples)]), two thin bright strips just off the lens axis (±16 to 20°, 20° up, 0.45 radii wide, strength 4 and 5: one crisp line down each side of a band), the long low softbox behind the camera (above), panels 1 to 3.5, exposure 0, Neutral.
   - Keep the rig out of the camera's view of the sheet [M, Pavé], or a high camera shows the top softbox as a grey rectangle across the black. Two planes: the one the camera sees is excluded from every panel's light-linking receivers (`panel.light_linking.receiver_collection`, the plane's `link_state = 'EXCLUDE'`) and invisible to glossy, diffuse and transmission rays; a second plane 2 µm lower is invisible to the camera and mirrors the whole rig for rays leaving the piece. Exactly coincident planes halve the mirror image.
   - Aim a little low [M, Pavé]: drop the aim by 15 % of the frame's half height times cos(elevation), or a standing ring's mirror image is cut mid-band. Lower down it is still cut.
   - Still weak [M, Pavé, seen]: the flat outer face of a flat-sided band renders gunmetal (it mirrors the black sheet at a grazing angle; tilting the band or a card in that reflection is untested [E]); the mirror image of gold is a dim olive-brown under Neutral's toe; the frame's bottom corners (0 to 1 of 255 against 8) are a black side card blocking the glow in the reflection, found with a reflection map, not the world's nadir; a pendant stands on its lowest point with the chain rising out of frame, where a hanging piece should hover or have no ground [E].
5. **Daylight.** A small sun with its strength as a shader constant (2.4° across, 30° up, strength 2200 at 5200 K, behind and to the left), a 7000 K window to the right, a pale blue-grey sweep (0.45, 0.5, 0.56), the stones' room at 0.2 and stone cards at 6 [M, Pavé]. Lowered from 48° to 30° the sun's shadow is about twice as long and crisp; it is the most photographic of the bright looks. Caustics on changed 0.5 % of pixels, no visible spot. Seen: the hard sun puts no pinpoint glints on the stones (stud p5 132, no flash above the general level), which no photograph of diamonds in sun would lack; a sparkle set aimed from the sun's direction is untested [E].
6. **Warm sweep** (editorial). Lights at 5000 to 5600 K and the warmth in the sweep (albedo 0.86, 0.80, 0.72): at 3400 K yellow gold went copper and platinum rose; Neutral, not AgX, which turned gold rose-beige [M, Pavé]. The backdrop needs its own light: one just behind the piece facing the cove painted a near-white band along the horizon with the top still brown; a long low panel 14 radii in front, 2° below the piece, 18 × 3 radii, strength 50, light-linked to the sweep, invisible to glossy and transmission rays and casting no shadow from the piece, took the band away (brightest row 18 to 26 levels above the top, from 66 to 94; the target of 15 is not met). **Correction:** because it casts no shadow from the piece, it also lights the floor under the piece and fills the key's contact shadow: the darkest ground under the three-stone went from 70 to 146 on a 217 ground and the ring floats [M, Pavé, reviewer's crop]. Split the sweep into floor and wall at the cove and link that light to the wall only [E]. Also seen: stones stay champagne (three-stone R − B 51) and the band is one flat peach plane (L* p90 − p50 = 2).
7. **Approved for HBR0034** (settings before 2026-11-25): **black velvet**, the piece lying flat on velvet (base 0.004, sheen 0.25, roughness 0.95), a low strip ring at strength about 18, top softbox, camera high so stones face it; never a worn loop on a T-bar, where the stones show their profiles. **Marble**, wave + noise veins with subtle contrast (ramp 0.55→0.88, distortion 5), coat 0.3, warm window light from one side. **Macro detail**, 100 mm across the stones toward the clasp, depth of field as above, cropped to 16:9 as a detail and QC shot.

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
- On static ground with the denoiser, a fixed seed flickered 0.037–0.040 of 255 per frame against 0.054–0.071 with an animated seed [M]. Noise on the moving piece itself was not separated from its motion.
- **On a held shot a fixed seed stops the stones boiling [M, Pavé, rack focus, 512 px, 32 samples].** With an animated seed, frames where camera and focus stand still changed 1,600 to 1,850 stone pixels by more than 30 levels each step (mean 6.3 levels in the stone region); with a fixed seed those frames were identical (0 pixels). Where the focus starts to move, the per-step change fell from 2,064 to 100 pixels. Pavé now renders every frame with the same seed. Whether a fixed seed reads as a "dirty lens" on a fast camera move has not been tested.
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
- Lights several times brighter than display white, in a world near 1, give beige metal and white stones whatever the Cycles settings (section 7, exposure of the rig).
- An emitter whose strength is only in a vertex colour is under-sampled: its shadow never forms (section 7).
- A shadow catcher over a dark background shows no shadow (section 7).
- Two exactly coincident mirror planes with different ray visibility: rays leaving one hit the other half the time (section 7, black acrylic).
- An f-number typed as in photography does nothing at millimetre scale (section 7).
- Comparing files instead of pixels reports a difference that is only a date stamp (section 4).
- Cycles 5.3's dispersion is RGB, not spectral: more samples, a lower noise threshold or no denoiser leave a per-pixel colour mosaic in the stone, not fire (section 5).
- Gold that looks cream or olive is the light, not the alloy: check the colour against ISO 8654 before touching it. Raising 18k's green made it paler; the cause was walls above 1.2 on white and nothing lit for the band to mirror on black (section 7).
- A stones' room bright enough to look right without stone cards is too bright with them: face-up stones went to crushed ice (section 7, stones).
- A light-linked backdrop light that casts no shadow from the piece also fills the piece's contact shadow, and the piece floats (section 7, warm sweep).
- Drilled seat holes in a red or rose alloy glow orange: light bouncing metal to metal inside the bore saturates the colour over many bounces. The through-stone desaturation does not reach them (94 orange pixels after against 102 before, the same row of eight dots, three-stone on Studio soft) [M, Pavé]. Capping metal-to-metal colour above about three glossy bounces, closing the seats in the visualisation mesh, or a dark rough bore are untested [E].
- A fix reported done is a claim until a crop shows it: the seat holes above were reported gone and were not. Compare the same crop before and after at full size.
- In a worker test, `assertIs` on two bpy objects fails even when they are the same datablock: bpy hands out a new Python wrapper on every access. Compare the data (names, nodes, pointers) [M, Pavé].
