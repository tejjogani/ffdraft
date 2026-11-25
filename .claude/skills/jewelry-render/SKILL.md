---
name: "jewelry-render"
description: "Hyperreal Blender renders and turntable/animation video of jewelry from a Rhino .3dm and/or reference images + spec sheet, one piece or a whole folder one by one; builds visualization CAD when no 3dm is given, and reads and grows the aska-render-lib knowledge base each run."
---

# Jewelry render workflow (Aska Jewels)

Inputs can be any of these: a Rhino `.3dm`, reference images (CAD renders or photos), and a spec sheet (style number, stone mm, qty, total ct weight, metal and karat, metal grams, length or ring size). They arrive either for **one piece** or as a **folder of many pieces**, usually sent over by the family, to work through one by one (see Batch mode). The output is website stills in several settings, an animation, a verification report, and a Blender kit the user can re-render on a GPU.

The rule that matters most: **verifiable, no hallucination.** Every dimension comes from the CAD or the spec. Every claim in the final message is backed by a number the scripts measured. Whatever is inferred instead of measured gets labelled as inferred.

## The library: load first, learn last (every run)
This skill holds the workflow. **What we've learned lives in `aska-render-lib`**, a git repo usually at `~/dev/aska-render-lib` on Tej's Mac. It contains `catalog.json` (known gems, settings, poses, scenes, pieces, each tested/untested), `LEARNINGS.md` (append-only ledger of lessons and user corrections), `gems/` (cutting-plane generators: `make_gem(shape, **dims)`, `to_blender`, `carat`), `cad/import_3dm.py`, `pose/links.py` (rigid link posing), `scenes/materials.json` and `presets.md`, `tools/selftest.py`, and `pieces/<STYLE>/` (reference image, scene script, verification, small finals, flat.blend for each finished piece).

**Load (before triage):**
1. Get the library. If the device tools are available, ask for access to the folder that contains it and stage it in, or work in it there. Otherwise ask the user to attach `aska-render-lib.zip`. If neither works, say so and continue with the code in this skill, but don't run the Learn step blind; hand back a zip of the changes instead.
2. Read `catalog.json` and all of `LEARNINGS.md`. They **override** this skill's defaults wherever they disagree, because they're newer and come from real corrections.
3. Find the 1–3 closest past pieces (same type, stone shape, setting, metal) and open their `reference.jpg`, finals and scene script. Reuse their code and settings, and change only what differs.
4. Run `python3 tools/selftest.py` (add `--pose` when bpy is installed) to confirm the library works before relying on it.
5. Use library code (`from gems import to_blender`, `from pose.links import assign_links, pose`) instead of rewriting it. Anything new gets built **in the library** as reusable code, not as one-off code inside a piece script.

**Learn (after the piece is delivered and the user has reacted, or at the end of the session):**
1. **New capability:** a new stone shape gets a generator in `gems/` (cutting planes, exact outline) plus a `GEM_TESTS` entry in `tools/selftest.py`, with the carat range taken from an outside reference: a trade table, or the spec sheet's ct ÷ qty. Register it in `gems/__init__.py` and move it from `gems_wanted` to `gems` in the catalog. The same goes for new settings, poses and scene presets.
2. **Status:** a preset, material or generator used in a render the user approved becomes `tested`, with the style number recorded. One the user rejected becomes `needs-work` or `rejected`, with the reason.
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
4. **One piece at a time, the full workflow** (sections 0–8) per piece, with outputs in `renders/<style>/` (stills, preview MP4, verification.json, kit). Reuse the scripts already built this session. Only the importer/build step and the scene parameters change per piece, so rebuild nothing that's unchanged.
5. **After each piece:** send its stills and a two-line summary (verified numbers plus any flags), update `manifest.csv`, then ask "next one, or changes?" If the user is present, wait for the answer. If the session is unattended, move straight on to the next piece and collect questions in the manifest instead of blocking.
6. **Blocking flags stop only that piece:** a carat or metal-weight mismatch above 5%, an ambiguous stone type, missing stone size/qty with no legible image, a Path B piece with no approved checkpoint. Mark it `needs-input` with the exact question and continue with the next piece.
7. **Carry feedback forward.** Keep `style_notes.md` in the batch folder. When the user corrects something that isn't specific to one piece ("diamonds too dull", "tighter crop", "no marble"), write the exact parameter change there and apply it to every later piece. Corrections specific to one piece stay in that piece's notes. Before each new piece, re-read `style_notes.md`.
8. **Resume across sessions.** `manifest.csv` and `style_notes.md` are the state. A new session starts by reading them, reporting what's done and what's next, and picking up at the first piece that isn't done.

Timing per piece here is about 1.5–2 h (4 stills plus a preview) on 2 cores, so a large batch is better served by previews here plus kits rendered on the user's GPU. Say so up front, with the count: "12 pieces ≈ 20 h here, or about 2–3 h on your Mac's GPU with the kits."

## 0. Triage (first reply)
Say in one sentence what you're about to do, set up a task list (import/build → verify → look-dev → stills → video → kit), then start. For a folder of pieces, run the Batch mode inventory first and create one task per piece.
- **3dm given** → Path A. The images only serve as colour and layout reference.
- **No 3dm, images + specs** → Path B: build visualization-grade CAD. Say plainly that it is **not casting-ready**.
- Missing critical specs (stone shape/mm/qty, metal colour, length or size) → read them off the images when they're legible, otherwise ask one short question while starting the parts that don't depend on them.

Tell the user an ETA early, measured from a timed low-res test frame. The cloud workspace is about 2 CPU cores: a 1600 px, 160-sample still takes roughly 10–25 min, and video at full quality is not feasible here. Plan for a low-res motion preview plus a kit for the user's GPU.

## 1. Environment
```
pip install --break-system-packages bpy rhino3dm scipy   # bpy = Blender as a Python module (5.x), Cycles CPU
which ffmpeg
```
Units: 1 BU = 1 mm (`scene.unit_settings.scale_length = 0.001`). **All lights are emissive meshes.** Their radiance doesn't depend on scale, while area-light watts assume metres. Keep scripts in a work dir, and put outputs in `final/` and the kit in `kit/`.

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
Measure, don't assume:
- stone count per colour/type and the sequence string (e.g. WGWG…); girdle diameter min/max; depth; pitch set
- carat estimate from stone mesh volume × density against the spec total. A mismatch is a finding. Example: HBR0034 green stones gave 25.4 ct as emerald vs 28.7 ct as diamond, against 28.27 ct on the spec, so the greens were green diamonds. **Ask the user** when the stone type is ambiguous, and don't pick silently.
- prongs per stone (the 4 nearest prong parts by 3D distance) and the prong-to-girdle gap in the CAD (should be ≈0)
- for each pose: max rigid deviation within a link (relative matrix vs CAD, expect ~1e-5), max change in prong gap, and link-head interpenetration depth (BVH overlap on heads/stones only; skip 6-face connector boxes; depth from ray-parity inside test). Report anything above about 0.1 mm.
- Path B: metal grams and carats against the spec.
Note as-modeled facts honestly. Example: straight prong posts about 1.4 mm above the table are a pre-finishing state. Render them as modeled and tell the user the CAD would need updating to show finished beads.

## 5. Materials (Cycles, Principled BSDF)
| Material | Settings |
|---|---|
| White gold / platinum (rhodium) | metallic 1, base 0.86, roughness 0.07 |
| Yellow gold 14K/18K | metallic 1, base (1.0, 0.78, 0.45) / (1.0, 0.76, 0.38), roughness 0.08 |
| Rose gold | metallic 1, base (0.98, 0.68, 0.58), roughness 0.08 |
| Diamond (white) | transmission 1, roughness 0, IOR 2.417, Dispersion 0.36 |
| Coloured diamond | same + Volume Absorption on the volume output (green: colour (0.03, 0.80, 0.30), density 0.45) |
| Emerald | IOR 1.58, dispersion 0.03, green absorption |
| Sapphire/ruby | IOR 1.77, dispersion 0.05, blue/red absorption |
Gem faces use flat shading (`use_smooth=False`). Metal is shade smooth by angle at 35°. Shared gem mesh → material slot `link='OBJECT'` per stone.

Render settings: max bounces 32, transmission 32, glossy 16, diffuse 3, caustics off, blur_glossy 0.2, clamp indirect 20, adaptive sampling 0.01, OIDN denoise, AgX view with Base Contrast look.

## 6. Lighting and scenes
Diamonds need **dark/bright structure** to sparkle. An all-white environment makes them flat grey-white. Use:
- a procedural world dome (generated-Z colour ramp with alternating dark/bright bands) for reflections; it needs no HDRI download
- 6–8 vertical emissive strip softboxes in a ring around the subject (`visible_camera=False`, `visible_shadow=False`) plus one large top softbox

Scenes that worked for HBR0034:
1. **White e-commerce:** a dimmer world (top 0.55), shadow-catcher floor, film transparent, then composite onto #FFFFFF with PIL. Camera 3/4 high, 135 mm, f/11.
2. **Black velvet:** piece lying flat on velvet (base 0.004, sheen 0.25, roughness 0.95), low strip ring at strength about 18, top softbox, camera high so stones face it. Don't use a worn loop on a T-bar: the stones show their profiles and it looks weak.
3. **Marble:** wave + noise texture veins with subtle contrast (ramp 0.55→0.88, distortion 5), coat 0.3, warm window light from one side.
4. **Macro detail:** 100 mm at f/4 across the stones toward the clasp. Crop to 16:9 and use it as a detail/QC shot.
Frame tightly: the piece should fill about 70% of the frame.

Always do a low-res preview first (about 500–640 px, 24–48 samples). Composite the previews into one image, look at them, fix what you see, then do finals (1600 px, 160 samples here). Look at every final at full size and at a crop before sending, and send each still as soon as it's done.

## 7. Animation
- **curl:** closure goes from 0 to 1 over the first 60% (cosine ease), then holds while the camera drifts 50°. Each frame, re-pose and recentre on the **bbox centre of the stone centres**. Metal object origins are not positions. Auto-fit the lens to the piece's extent so the straight piece stays in frame.
- **orbit:** 360° camera around the closed piece.
Check 3–6 key frames at tiny resolution before the full run. Here: 72 frames at 480 px and 16 samples ≈ 25 min. Encode with ffmpeg: `-framerate 18 ... -vf tpad=stop_mode=clone:stop_duration=1.5 -c:v libx264 -pix_fmt yuv420p -crf 16`.

## 8. Deliverables
- Stills as JPG q95 (white composited), each sent with SendUserFile as soon as it's verified
- Motion preview MP4
- `kit.zip`: import script, scene script (argparse: `--scene`, `--res`, `--samples`, `--gpu`, `--anim`, `--frames`, `--frame_start/step`, `--save_blend`, `--no_render`, `--verify`), `flat.blend`, ready-to-open scene .blends, `verification.json`, and a README with exact GPU commands (`blender -b -P scene.py -- --scene white --res 3000 --samples 1024 --gpu`). On a decent GPU a full 1080p video takes about 10–20 min.
- Final message: one line per deliverable, the key verified numbers, any as-modeled caveats, one line on what the library learned (or "nothing new"), and one next step.

## Pitfalls hit before
- In a batch, stone colour layers differ between CAD files. Never assume layer 11 = white from an earlier piece; re-derive the mapping from each piece's own reference image.
- Waiting on renders: `pgrep -f "hbr_scene.py --scene"` inside `bash -c '...'` matches its own command line and loops forever. Wait on the PID with `kill -0 PID` instead.
- Background jobs die a few minutes after the reply ends, so poll with `sleep` inside the turn until finals finish.
- `Mesh.vertices[::3]` isn't sliceable: use `list(...)[::3]`.
- Mixing per-part frames (each prong with its own x) shifts prongs about 0.2 mm off the stone. Always use per-link frames.
- Wrong closing length leaves a gap or overlap at the clasp, so check the clasp region in an ortho view.
- A loose Brep bounding box made one clasp latch look 181 mm long. Measure from the mesh.