# Freeform CAD additions: all of Rhino's capability, and the jewelry and workshop layer

_25 November 2026._ This plan adds steps 9 to 34 to [`freeform-cad.md`](./freeform-cad.md); its eight steps stay as written. It rests on [`22-rhino-full-parity.md`](../research/22-rhino-full-parity.md) (R22: 195 Rhino 8 capabilities, 142 open after step 8), [`13-jewelry-cad-features.md`](../research/13-jewelry-cad-features.md) (R13: the plug-ins, the rivals' 2026 moves, 15 ranked gaps) and [`12-rhino-parity.md`](../research/12-rhino-parity.md) (R12: the kernel spikes). **It changes `freeform-cad.md` here:** §0's answer "No, and it should not try to" (capability parity is now the goal; interface parity is not); §4 item 7 "bodies are closed" (now "metal is closed"; surfaces become objects, step 20); §4 item 1 and §6 on push/pull (a history node, step 24; write-back stays rejected); §4 items 3, 8 and 11 where they rest on the shipped engine build (step 19) or rhino3dm's limits (step 21); the §6 cuts of Make2D drawings and shrinkage at export (steps 25, 10); and the "Later, unscheduled" list, all of which gets steps. New node kinds follow the feature-list rule of [`pave-file-format.md`](./pave-file-format.md) §3.4. Labels: `[V]` verified at source (by the research unless marked "this session"), `[S]` search extract, `[E]` estimate. Nothing was built or spiked for this plan; a step that leans on an unproven engine fact names its spike (§5).

The spine: **a ledger first, so "all of Rhino" is a number anyone can check; then the cheap daily capabilities and the workshop gaps on today's engines; then three structural changes (our own engine build, surfaces as objects, a SubD cage) that unlock the rest.**

## 1. Experience

**Capability, not interface.** Nothing here adds permanent chrome. The tool rail keeps seven buttons, the context bar two to five verbs, a prompt three option chips and `⋯`. Every capability is reached through the slash palette, a handle or the gumball, the inspector, or the assistant, and no other way.

- **Typing a Rhino name never dead-ends.** `/Zebra`, `/NetworkSrf`, `/SelOpenCrv`: the palette runs the verb if there is one. If the job is done differently here, the row reads like a Notion hint, with one button: "*SelOpenCrv* · Here: Select, then type *open curves* · **Do it**". If it is not built, the row says when ("Planned · step 22") or why not ("Left out: drives a measuring arm"), with **Ask the assistant**.
- **Coming from Rhino** (Help): one page, set like a Notion database. Search a Rhino command; see its name here and its state. The top line is the audit: "Rhino 8: 107 of 195 · Rhino 9: 3 of 13 · jewelry: 9 of 15 · report".
- **Surfaces** look like construction, not metal: a pale two-sided tint, ink edges, no weight. Open edges are dashed. *Join* or *Thicken* turns surfaces into metal; when they do not close, the HUD says "3 open edges keep this from becoming metal" with **Show me**.
- **Checks you can see.** View → Check: Thickness, Curvature, Stripes, Draft, Open edges, Clash, Section. One at a time, with a legend chip; Esc leaves. Ramps run ink to `--danger` or between two muted axis hues, never a rainbow.
- **The workshop sheet** is a live page beside CAD: the piece's facts, four dimensioned views, a stone map coloured by size with a legend, the stone list, cost lines and the checks. One switch, *For casting*, shows shrink and a sprue. Buttons: Download PDF, Send.
- **Weight.** The HUD gains a target: `≈ 3.9 g · target 3.5 g`. *Lighten* offers moves with their saving before anything is cut: "Scoop the band −0.3 g · Open azures under 14 stones −0.2 g".
- **Stone fields by hand.** With a field selected, `p` shows each stone as a point. Drag one and it is pinned; lock, delete, add, mirror. Overlaps are marked. Unpinned stones re-flow and say so: "12 pinned · 61 placed automatically".
- **Someone else's file.** Drop a `.3dm`, STEP or STL: a card says what it found ("A ring, about US 6¼ · mesh · 2 open edges") and offers Repair, Resize, Wrap or Open as reference.
- **Soft shapes** (SubD) start from Band, Signet, Bezel, Ring, Box or Sphere; a *Smooth* switch shows cage or surface; the mesh badge stays until *Make exact*.
- **Formulas and drawings.** Type `=` in any number field: `= $width * 0.12`; variables live in one small inspector block. The *History map* (on request) shows the piece as linked cards. A drawing is a sheet on a page: click two points to dimension; views follow the design.

**With the AI.** Each of the above is a verb the assistant calls through `design.run`. It asks first, then acts; the person watches, pauses or takes over as today. "Make this 3.5 g" → it asks the minimum wall, whether the inside stays comfort-fit, and whether azures may open under side stones; then scoops, opens azures, re-checks, and reports grams saved per move, each undoable. Jobs that take minutes (quad remesh, a fine wrap, soft shape to exact) show a progress line with Cancel; the view never freezes.

## 2. Structure

**`packages/schema/src/`**
- `parity/` (new): `capabilities.ts` (195 Rhino 8 rows, the Rhino 9 group, R13's 15 gaps; each with state, step, verbs, tests), `rhino8-names.json` (1,078), `rhino9-names.json`, `ledger.ts` (`lookup(name)` → verb | answer | planned | leftOut).
- `design/nodes.ts`: the kinds of §3, `SURFACE_KINDS`, `POINT_KINDS`; `design/expr.ts` (new, pure: the formula grammar; the studio's `model/parse.ts` uses it for arithmetic); `design/mount.ts#resolveDesign` evaluates formulas beside follow fields, so the kernel sees only numbers; `design/verbs/` (the registry of `freeform-cad.md` §2, split by group); `design/select.ts` (new: the selection query).

**`packages/occt/`** (new, step 19): `build/pave_occt.yml` (replicad's public build list plus ours), `build/shims/*.cpp`, a Dockerfile pinned by digest, generated typings. Its one `.wasm` replaces `replicad-opencascadejs/wasm` in `packages/kernel/src/runtime/index.ts` (one resolver line).

**`packages/kernel/src/`**
- `features/<kind>.ts` for each new kind of §3, registered in `features/index.ts`.
- `geometry/nurbsSurface.ts`, `geometry/subd/{cage,catmullClark,limit,ops}.ts`: pure TypeScript, so pole and cage drags preview on the main thread as curves do.
- `solid/occt.ts`: sewing, solid from shell, open-edge listing, general transform, NURBS conversion, projection.
- `mesh/{shrinkwrap,halfedge,delaunay,displace,resizeRing,boreFit}.ts`; `mesh/pave/layout.ts` takes pins; `jewelry/{scoop,azure}.ts`; `features/setting.ts` gains head styles.
- `analysis/{mass,curvature,thicknessMap,clash,deviation,balance}.ts`; `project.ts` (exact hidden lines from `HLRBRep_Algo`).
- `import/{rhino3dm,iges,dxf,points}.ts`; `export/{iges,dxf,amf,off}.ts`; `export/rhino3dm.ts` extended; `export/casting.ts` (shrink and sprue, at export only).

**`packages/production/src/drawing/`**: `exact.ts` (kernel lines into today's `ViewLines`), `annotations.ts` (user-placed), `sheetModel.ts` (editable sheets over `sheet.ts`).

**`apps/studio/src/features/`**: `production/` (a stub in the assistant build [V]) becomes the workshop sheet; under `cad/`: `parity/`, `analysis/`, `graph/HistoryMap.tsx`, `viewport/{Surfaces,Clip,FourUp,Cage}.ts`, `model/tools/{surfacePoints,subdCage,stonePins,lasso}.ts`, `inspector/widgets/{expr,pins,lattice}.tsx`, more extensions in `empty/importers.ts`; `drafting/`.

**`apps/server/src/engines/geometry/`** (new): long geometry jobs (`quadRemesh`, `shrinkWrapFine`, `subdToNurbs`) on the durable work model of `deploy-and-durable-jobs.md` step 1.

**Data flow.** Unchanged: a gesture, a typed command and a tool call all end in `design.apply` ops; geometry is a pure function of the document. One addition, **derived results**: a node whose result comes from a job (quad remesh) evaluates to its input with `job.pending` until the result is in a cache keyed by the node's input hash; the evaluator asks a `DerivedResolver` beside today's `AssetResolver`. The document stays pure; a file opened elsewhere recomputes.

**Local and hosted.** Everything runs on the laptop: draft and exact workers in the browser, the same kernel in the local server. Jobs use the local server's kernel pool now and hosted workers later, on the same contract.

## 3. Contract changes

All additive unless marked. No new op types: every node below follows the keyed-record rule of `freeform-cad.md` §4 item 2.

**New node kinds**

| Kind (title), step | Class | Fields |
|---|---|---|
| `points` (Points), 12 | point | `plane`; `points: Record<Key, {at, rank}>` |
| `surface` (Surface), 20–23 | surface | `op` = `planar{curves}` · `grid{rows: Record<Key, Record<Key, {at, w?}>>, degreeU, degreeV}` · `extrude{curve, distance, taper}` · `loft{sections}` · `sweep{rails, profiles}` · `revolve{curve, axis, rail?}` · `fromFaces{body, faces}` · `patch{edges, curves?, points?}` · `edge{curves[2..4]}` · `network{u[], v[]}` · `drape{of, step}` · `blend{a, b, continuity}` |
| `surfaceOp` (Trim, Untrim, Extend, Match, Rebuild, Offset, Join, Fillet), 20–23 | surface, consumes | `op` = `trim{of, by, keep}` · `untrim{of, what}` · `extend{of, edge, length}` · `match{of, edge, to, continuity}` · `rebuild{of, u, v, degree}` · `offset{of, distance}` · `join{surfaces[]}` · `fillet{a, b, radius \| law}` |
| `solidify` (Make metal), 20 | body | metal; `from: surface[]`; `mode: join \| cap \| thicken{thickness, side}` |
| `faceOp` (Push/pull, Move face, Inset, Merge faces), 24 | body, consumes | `target`; `faces: FaceSelector`; `op` = `pushPull{distance}` · `move{vector}` · `inset{distance}` · `merge` |
| `meshOp` (Wrap, Offset, Repair, Resize ring, Remesh, Displace, Edit), 16, 26, 28 | body, consumes | `of[]`; `op` = `shrinkWrap{offset, edge, smooth, fillHoles}` · `offset{distance}` · `repair{weld, fill, unify}` · `resizeRing{to, keep}` · `quadRemesh{faces, adaptivity}` · `remesh{edge}` · `displace{texture, height}` · `edit{patches}` |
| `subd` (Soft shape), 27 | body | metal; `verts: Record<Key, {at}>`; `faces: Record<Key, {v: Key[]}>`; `creases: Record<string, number>`; `symmetry?`; `level` |
| `convert` (Make exact), 28 | body | `of: subd`; `corners: g0 \| g1 \| g2` |
| `scoop`, `azure`, 11 | body, consumes | `scoop{target, wall, rim, arc: {from, to}, fade}`; `azure{stones, host, shape: square \| round \| hex, rib, taper, depthMax}` |
| `prongSet`, 14 | body | metal; `of: pave \| gemRow \| halo`; `mode: between \| corners \| perStone`; `diameter`, `height`, `tip` |
| `sprue`, 10 | casting only | `host`, `at`, `direction?`, `diameter`, `length`, `taper`; in no weight, render or export but the casting file |
| `band` (Matching band), 18 | body | metal; `beside: ref`; `gap`; `side`; `follow: contour \| straight`; band profile fields |
| `linked` (Linked piece), 18, 30 | reference | `pieceId`; `at: follow \| pinned{version}`; `include: boolean`; read-only, snappable |
| `component`, `instance`, 30 | body | `component{children[]}`; `instance{of, transform}` |
| `annotation`, `sheet`, 25 | none | `annotation{what: dim{type, refs: SubRef[], offset} \| note{text, at, leader?} \| hatch{boundary, pattern}, style}`; `sheet{size, views: Record<Key, {view, scale, at, hidden, tangent}>, title}` |
| `saved` (View, Plane, Selection, Position, Snapshot, Layer state, Clipping plane), 13, 15 | none | `what`-tagged record; left out of the geometry hash |
| `variables`, 33 | none | at most one per design; `values: Record<Key, {value \| expr, unit?, rank}>` |

**Extended.** `base.exprs?: Record<fieldPath, string>` (33; the stored number is the fallback if a formula fails) and `base.userText?: Record<string, string>` (13). `curve.shape` gains `conic`, `spiral`, `parabola`, `hyperbola`, `catenary`; a `handles` style; `onBody?: {host}` (points stay on the host). `curveOp.op` gains `tween`, `arcBlend`, `textOutline`, `isocurve`, `intersect`, `toPlane`, `twoViews`, `sub`, `refit`, `structure`, `boolean2d` (12), `project`, `pull`, `onSurfaceOffset`, `uv` (22), `match`, `fair`, `extend` (23), `silhouette` (25). `primitive.shape` gains `truncatedCone`, `tube`, `pyramid`, `ellipsoid`, `paraboloid`. `pattern.type` gains `onStones{of}` and `onSurface{host, u, v}`; `pattern.scale?: {from, to} | {random, seed}`. `pave` and `gemRow` gain `pins?: Record<Key, {at, size?, locked?}>`, `keepOut?: Record<Key, {at, radius}>`, `mirror?`. `gem` gains `custom?: {outline: curveRef, crown, pavilion}` and `meshAsset?`; `GEM_CUTS` gains `taperedBaguette`, `trapezoid`, `hexagon`, `lozenge`, `halfMoon`, `kite`. `setting.style` gains `trellis`, `tulip`, `martini`, `peg`, `cluster`; `halo.hidden?`. `fillet.radius` accepts a `Law` (23). `deform.op` gains `shear` (19), `cage{lattice}`, `soft{at, radius, vector}`, `flowSurface{from, to}`, `maelstrom`, `splop` (29). `vectorBody.source.text` and `engraving` gain `along?: curveRef`. `DesignSchema` gains `units?` (display only) and `tolerance?: {abs, angleDeg}`.

**Commands** (`api/commands.ts`, `api/client-tools.ts`)
- `design.verbs` (query, tool, new): `{search?, group?, ids?}` → verb definitions, and ledger answers for Rhino names with no verb. The prompt carries only a compact index. **No tool is added per capability**: the tool list stays one cacheable list (`packages/agent/src/tools.ts`, assistant build [V]).
- `design.inspect.what` gains `mass`, `curvature`, `thickness`, `openEdges`, `clash`, `deviation`, `balance`, `ringSize`.
- `design.import` (mutation, tool, approval): `{pieceId, assetId, as: auto | mesh | exact | reference}`.
- `design.export.format` gains `iges`, `dxf`, `amf`, `off`, `ply`, `usdz`; gains `casting?: {shrink: 'profile' | number, sprue: boolean}`.
- `parts.list` (tool), `parts.save`, `parts.update`, `parts.delete`; `geometry.jobs.create | get | cancel`; `drawings.export {pieceId, sheetId, format: pdf | svg | dxf}`.
- Client tools: `viewport.capture.mode` gains the check modes, so the assistant can see stripes or a thickness map; `viewport.set {display?, check?, clip?, view?}`.

**Kernel types.** `FeatureOutput.surfaces?`, `Evaluation.surfaces: SurfacePart[]` (mesh, open-edge polylines, `rev`), `Evaluation.points`, `EvaluateOptions.derived?: DerivedResolver`, `pieces?: PieceResolver` (for `linked`), `Kernel.project(design, nodeIds, view, options)`.

**Breaking, with migration.** `packages/production/src/manifest.ts`: `shrinkageCompensated: false` (a literal today [V code]) becomes a boolean with `shrinkage.appliedLinearPct`; manifest schema version goes up by one and readers accept both.

**Database.** `part` (org library: name, tags, node subtree, named inputs, thumbnail asset, version), `geometry_cache` (input hash, kind, asset id). One migration each.

**Config.** `PAVE_OCCT=own|stock` (step 19's rollback switch), `PAVE_GEOMETRY_JOBS=local|off`.

**Diagnostics.** `surface.open` (info, open-edge count), `solid.notClosed` (error; the surfaces stay shown), `job.pending`, `job.failed`, `scoop.thin` (warning, fix), `azure.noInside`, `pins.overlap`, `resize.limit`, `import.meshOnly`, `expr.failed`, `expr.cycle`, `subd.nonManifold`, `convert.deviation` (the largest gap in mm).

**File features** (names for `featuresOf`, by the rule in `pave-file-format.md` §3.4, so an older reader says "This file needs a newer Pavé" and never builds the wrong ring). `requires`: `design.points`, `design.surfaces`, `design.direct`, `design.mesh.ops`, `design.subd`, `design.jewelry.weight`, `design.jewelry.pins` (also the new cuts and head styles), `design.sets` (`band`, `linked`), `design.components`, `design.deform.cage`, `design.params`, `design.tolerance` (only when not default). `uses` (a reader may ignore them): `design.drafting`, `design.saved`, `design.userText`, `design.units`.

## 4. Hard parts and decisions

### 4.1 Parity is a ledger, not a promise
R22 counted 1,078 Rhino 8 command names in 195 capabilities; after step 8, 142 are not fully covered: 74 cheap on today's engines, 55 real work with known algorithms, 13 research or a new engine [V R22, recounted from its tables by script this session]. Decision: one checked-in ledger maps every name to a verb, a "how it is done here" answer, a planned step, or a leave-out with its reason; CI fails on an unmapped name and on a "done" row with no passing test. *Rejected:* a prose claim ("Rhino-class"), which cannot be audited; a command per Rhino command (119 `Sel…` alone), which breaks the calm product. R22 §6's interface differences are deliberate, not leave-outs.

### 4.2 Surfaces as objects (this changes `freeform-cad.md` §4 item 7)
Rhino treats an open surface as an ordinary object; about two dozen rows wait on that [E R22].

| Option | Verdict |
|---|---|
| Keep "bodies are closed"; a `surface` node with built-in thickness (today's plan) | Rejected: cannot express Untrim, ExtractSrf, Join, MatchSrf, BlendSrf, which act on open faces |
| Bodies may be open (a flag) | Rejected: every consumer of a body (weight, checks, stone hosts, exports) must learn "maybe open"; `checkGeometry` rejects open shells today |
| **Surfaces are their own class, like curves** | Recommended: bodies stay closed and weighable and no consumer changes; surfaces are construction until *Make metal* |

**Decision:** `SURFACE_KINDS` beside `CURVE_KINDS` and `BODY_KINDS`. `surface` and `surfaceOp` make and edit them; `solidify` is the only bridge to metal (sew with `BRepBuilderAPI_Sewing`, then a solid; cap; or thicken) and it fails per node with the open-edge list. `surface{fromFaces}` is the bridge back (ExtractSrf, Explode). Weight, "Ready to cast" and STL see bodies only; STEP, IGES and .3dm carry surfaces as surfaces. The rule becomes **"metal is closed"**.

### 4.3 Our own OpenCascade build
Facts: the shipped build is `replicad_single.wasm`, 22.9 MB, 7.2 MB gzipped [V measured this session]. Its build list is a public YAML of about 245 bindings and six C++ wrappers, compiled `-O3` with WebAssembly exceptions, 100 MB starting memory [V opened this session]. opencascade.js builds from such a YAML in a Docker image and accepts extra C++ [V]. The classes rows need and the build lacks are listed in R12 §6 and R22 §4 (`GTransform`, `NurbsConvert`, `GeomFill`, curve projection, 3D extrema, `MakerVolume`, `SplitShape`, `BRepTools_History`, IGES) [V type file]; this session's recheck adds `ShapeFix_Shell`, `ShapeAnalysis_FreeBounds`, `BRepLProp_SLProps` and `TColgp_Array1OfPnt2d` [V].

| Option | Verdict |
|---|---|
| Stay on the subset and work around each gap | Rejected: each workaround is its own fragile code, and IGES, exact shear, pole deformation, MakerVolume and SplitShape have none |
| **Fork replicad's list, add about 40 classes [E] and small shims; one binary for studio and server** | Recommended |
| The whole of OpenCascade | Rejected: size and start-up on the light laptop [E]; nothing needs it |
| Native OpenCascade on the server only | Rejected: the browser and the server would give different answers |

**Gates** (spike P1, on the founder's Air): download at most 25 % larger gzipped, engine start at most 20 % slower, the draft kernel still under research 18's 600 MB budget [E targets]. If a gate fails, the larger build loads only in the exact worker and the server; the draft worker keeps the stock build, and shapes cross as BREP text (replicad's build lists a `brep-io` wrapper [V this session]). The OpenCascade version stays the one replicad-opencascadejs 1.2.1 uses; upgrading it is a separate decision.

**Licence.** Open CASCADE Technology is LGPL 2.1 with an added exception [V vendor page, this session]. The exception lets object code that includes material from its header files be distributed under terms of our choosing, with a prominent notice [V exception file, this session]. The package in use today is already `LGPL-2.1-only` [V its package.json]. The posture does not change, but we become the builder: keep the engine a separate, replaceable `.wasm`; ship the licence, the exception and a notice; publish `packages/occt/build` so anyone can rebuild and swap it; compile nothing proprietary into it. This is practice, not legal advice [E]; a review by counsel is a founder decision.

### 4.4 SubD

| Option | Verdict |
|---|---|
| Own Catmull–Clark cage in TypeScript, limit mesh out | **Stage I.** Cage tools are keyed-record edits that live in TypeScript anyway; previews run on the main thread |
| OpenSubdiv (C++17, no core dependencies, no WebAssembly build documented [V]; licence in 4.16) | **Stage II** for patch tables, and the test oracle for stage I |
| openNURBS `ON_SubD`, own build | Needed anyway to write real SubD objects into .3dm; whether its public source converts SubD to NURBS is **not verified**. Spike P4 |
| Manifold `smoothOut` + `refine` (the old "Later") | Rejected: not Catmull–Clark, so a cage would not match Rhino's shape [V R22] |

**Decision: build, in two shippable grades.** Stage I (step 27): a `subd` cage with creases and symmetry whose result is a watertight mesh: castable, weighable, STL-ready, badged. Stage II (step 28): `convert` to exact patches sewn into a solid for STEP and .3dm, with a reported deviation and Rhino's corner choices. Stage II is conditional on spikes P4 and P5; if both fail, soft shapes stay mesh-grade and the ledger says "partly".

### 4.5 QuadRemesh, ShrinkWrap
- **QuadRemesh:** QuadriFlow (4.16) guarantees a watertight result only with a SAT step that is Unix only [V]. Decision: a server job (never the draft worker), WebAssembly first (spike P6) so no per-OS binary ships, a native sidecar if that fails; output goes through today's `repairMesh`; no guide curves at first. *Rejected:* QuadWild (GPL-3); Blender's remesher (ties CAD to Blender being installed); Instant Meshes (quad-dominant [E]).
- **ShrinkWrap:** the engine exists: `mesh/resurface.ts` rebuilds a surface as a level set, 150 cells across, 0.05 mm floor [V code]. Decision: `meshOp{shrinkWrap}` with offset, target edge (the grid step), smoothing and hole filling; finer grids than 150 cells are a job. OpenVDB (Apache 2.0, server only [V]) only if 0.05 mm proves too coarse. *Rejected:* CGAL Alpha Wrapping (GPL or a paid licence [V]).

### 4.6 Cage and free deformation
Rhino's own CageEdit refits objects, so it approximates too [V R22]. Three grades: exact for curves and the sweep family (step 7); exact for other bodies by converting faces to NURBS, refining knots and moving poles through the lattice (needs `NurbsConvert`; spike P7); Manifold `warp` with the mesh badge otherwise. The cage is a `deform{cage}` lattice of keyed points.

### 4.7 Make2D and drafting
`packages/production/src/drawing/` already draws mesh hidden-line views, a hatched section, dimensions and a title block [V code]; `HLRBRep_Algo` and `HLRBRep_HLRToShape` are in the shipped build [V type file, rechecked]. Decision: one *Drawing* verb; exact lines for exact bodies, today's mesh lines otherwise; output as curves and as PDF, SVG, DXF. DXF is our own writer. *Left out:* DWG (needs a GPL or commercial library [E]).

### 4.8 Grasshopper-class parametrics
The design is already a graph the assistant composes. Decision: **formulas and variables first** (`exprs`, one `variables` node, resolved before evaluation), **a read-and-rewire History map** (xyflow), and list patterns (`pattern.scale`). *Rejected for now:* a full canvas with list and tree nodes: a second editor of the same data, large, and it looks like a developer tool. *Left out:* running `.gh` files (needs Rhino Compute, a paid, online dependency on a competitor [V price; terms unverified]).

### 4.9 Scripting and extensibility
Macros (step 13) are recorded verb sequences: data, not code. Scripts (step 33) are JavaScript in a QuickJS sandbox (quickjs-emscripten: memory and time limits; not audited, by its authors' account [V this session]) with three calls only: `run`, `inspect`, `evaluate`. A run is one change with one undo; a script reaches no file, network or key, and one from someone else needs the approval an assistant run needs. The public API and MCP belong to `assistant.md` and the sister plan `accounts-and-developer-api.md` (named in `integrations-hub.md`; not in this working copy). *Left out:* VBScript, Python and Rhino's binary plug-ins.

### 4.10 Jewelry decisions
- **Scoop** is a second sweep with each profile inset by the wall, limited to an arc and faded at its ends (profile inset is the robust way to hollow [V `freeform-cad.md` §4 item 4]). **Azures** are one lofted cutter per stone, cut at production like seats (Manifold took 2,000 cutters in 1.6 s [V R12]), only where metal behind the stone ends within `depthMax`.
- **Pins** are keyed records the layout solver treats as fixed, so a designer's pin and the assistant's undo separately; unpinned stones have no identity, and the screen says so.
- **A set is two linked pieces**, not two rings in one design: the band is sized, weighed, priced and exported alone. `linked` arrives small in step 18 and becomes Rhino's linked blocks and worksessions in step 30.
- **Re-sizing a foreign ring** is a mesh warp of the lower arc only; the honest limit is about two sizes [E R13], and no vendor files were available to test. **Shrink** is one uniform scale at export, off by default, set by the caster profile.

### 4.11 Rhino files both ways
rhino3dm reads B-reps with their faces, surfaces, loops, trims and edge curves, plus SubD, annotations, blocks and layers [V type file, read this session]; it cannot join faces or build a general trimmed face [V R12; E]. Import (steps 16, 21): meshes, curves, layers and cached face meshes first; then faces rebuilt in OpenCascade from each surface and its edge loops, and sewn (spike P3). Exporting joined, trimmed solids needs our own openNURBS build with a small shim (spike P4, shared with SubD). Until then STEP is the exact route. **Rule:** every later step that adds an object type adds it to .3dm reading and writing in the same step.

### 4.12 Rhino 9
Rhino 9 is the version on sale [V R22]. Its help has a command list that tags entries "New in V9" (`AI`, `InflateCrv`, `Knife`, `GH2`, `GlobalEdgeContinuity`, `MatchSubD` among them) [V opened this session, first two thirds read; R22 had not opened it]. So Rhino 9 can be listed by command. That is no reason to move the baseline: MatrixGold 4.0 is built on Rhino 8 and job adverts name Rhino 8 [V R13]. **Decision: Rhino 8 stays the frozen baseline of 195; Rhino 9 is its own group** (R22's 14 rows, re-seeded by command from that page in step 9), reported on its own line.

### 4.13 The assistant, and what the rivals changed
Rhino 9 ships an assistant; one jewelry plug-in ships an MCP server and live diamond prices; one browser rival is free with an account and has MCP [V R13]. An assistant that operates CAD is no longer rare; the whole line, free, with checks and no Rhino underneath, still is. So: (1) no capability is done until its verb replays through `design.run` (§5); (2) the workshop sheet (step 10) reads stone prices from `StoneSourcing.priceUsd`, and from the Diaex partner API when linked; (3) Bring-in (step 16) is ahead of every engine-heavy Rhino step, because the free rival already opens STEP, STL and .3dm; (4) SubD has named steps. Recommended, outside this plan: build the MCP server of `assistant.md` before step 19.

### 4.14 Performance on the light laptop
`freeform-cad.md` §4 item 6 stands (60 ms point drags, gesture evaluation stops at heavy nodes, exact work on release). New budgets, all [E] targets to be measured on the Air:

| Work | Draft | On release or as a job |
|---|---|---|
| Surface pole drag | main-thread preview, 16 ms for a 20 × 20 grid | exact face rebuilt, under 300 ms |
| SubD cage drag | limit mesh at level 2, 16 ms at 2,000 cage faces | level 3 on release, level 5 at production |
| Check shaders | no CPU work while orbiting | attributes once per part revision, under 150 ms per 200,000 triangles |
| ShrinkWrap | 150 cells across, under 5 s | finer: a job |
| Exact drawing | mesh lines at once | exact lines per view under 2 s for 300 faces, else mesh lines stay |
| Four views | inactive views at pixel ratio 1, cheap gems | — |

### 4.15 Effort, honestly
R22 estimated 65 to 90 weeks of one build lane for Rhino parity [E]. Step by step here it is **71 to 85 lane-weeks for Rhino parity and about 14.5 for the jewelry and workshop layer: 86 to 99 in all [E]**, close to two years for one lane; SubD is the largest item (10 to 14). **The first three months of one lane** (13 weeks) deliver steps 9 to 13, and step 14 if nothing slips: the ledger, the workshop sheet, weight reduction, the everyday sweep, snaps, selection and macros, and hand control of stone fields. Rhino coverage goes from 53 to 85 of 195 (44 %); R13's gaps 1, 2, 3, 6, 9, 10, 11 and 12 close. Steps 9, 10, 11 and 17 need little or nothing from steps 1 to 8, so a second lane could build them now.

### 4.16 Licences in one place
Nothing GPL runs in-process; the rejected GPL or paid options are named in 4.5, 4.7 and 4.8. Every library below may run in-process in a proprietary product on the stated terms.

| Library (for) | Licence | Terms that matter |
|---|---|---|
| Open CASCADE Technology, own build (exact kernel) | LGPL 2.1 with exception [V this session] | a separate, replaceable module; recipe published (4.3) |
| occ_gordon (NetworkSrf) | Apache 2.0; needs only OpenCascade [V this session] | compiled into that module, published with it |
| Manifold (meshes); rhino3dm and openNURBS (.3dm) | Apache 2.0 [V R22]; MIT [V this session], no copyleft [V R22] | notices |
| OpenSubdiv (SubD oracle, patch tables) | Tomorrow Open Source Technology License 1.0: Apache 2.0 with a different trademark section [V licence file, this session; an estimate in R22] | notices; no use of the name |
| QuadriFlow (QuadRemesh) | MIT; Eigen MPL2 with the free-licence flag [V] | runs as a job |
| quickjs-emscripten (scripts); xatlas (unwrap); xyflow (History map); delaunator (mesh from points) | MIT, MIT [V this session]; MIT [V R22]; ISC [V this session] | notices |
| libigl core (flattening, step 34) | MPL2 [V R22] | its `copyleft/` modules stay out |

### Decisions that are the founder's
1. **The target.** Rhino 8 frozen at 195 with Rhino 9 tracked beside it. *Recommended.*
2. **Surfaces as objects**, with the rule "metal is closed" (4.2). *Recommended.*
3. **Our own OpenCascade build**, with 4.3's gates and one review of the LGPL posture by counsel. *Recommended.*
4. **SubD:** build stage I; build stage II if spikes P4 and P5 pass. *Recommended: both; the "all of Rhino" claim needs stage II.*
5. **Server jobs** for QuadRemesh and fine wraps; **parametrics** as formulas, variables and the History map, no canvas. *Both recommended.*
6. **Scripts in JavaScript only**, sandboxed; no Python. *Recommended.*
7. **The leave-out list** in §6, line by line; DWG in particular.
8. **Order:** the workshop sheet, weight and stone fields before most Rhino steps. *Recommended.* And whether a second lane starts steps 9 to 11 now.
9. **A set is two linked pieces.** *Recommended.*
10. **Shrink and sprue:** build both in step 10 (days), shown only under *For casting*. Who the first paying user is (R13's open question) decides the default.
11. **Paid line:** IGES and full .3dm count as paid exports like STEP; drawing PDF, SVG and DXF stay free. *Recommended.*
12. **A Rhino licence as referee** (US$995 [V R22]) for a manual release gate. *Recommended.* Public wording: "capability parity, proven by the report", never "runs Rhino plug-ins".

## 5. Verification

- **The ledger in CI.** Each of the 1,078 names, each Rhino 9 name and each jewelry gap maps to exactly one row; a row marked done lists verbs whose example picks build through `design.run` and a test tagged `parity:<ID>` that passed in this run. `pnpm parity:report` writes `docs/parity/REPORT.md` and `report.json`: counts by state and need, rows changed since the last commit, and what is unverified. That report is the audit of "all of Rhino", regenerated on every merge.
- **One geometry test per capability,** with closed forms where they exist: sphere r 10 has volume 4,188.79 mm³ and area 1,256.64 mm²; a torus by Pappus; a 2 × 3 × 4 box has moments m(b² + c²)/12; an offset sphere has radius r + t; an unrolled cylinder keeps its area; a network surface meets its curves within tolerance.
- **Mass properties three ways:** OpenCascade `GProp`, a mesh tetrahedron sum, the closed form; exact within 1e-6 relative, mesh within 0.1 %.
- **.3dm round trip through rhino3dm:** write, read back, compare object counts and types, layers, blocks, units, user strings, and control points and knots to 1e-9; then the reverse on public sample files, never the founder's father's. **STEP and IGES round trips:** valid, same face count, volume within 1e-3.
- **Surfaces:** `solidify` of a box's six extracted faces gives the box's volume; five faces report exactly four open edges.
- **SubD:** limit positions against OpenSubdiv's regression shapes (fixtures generated once, offline); stage II reports its largest deviation per corner option.
- **Jewelry:** the micro-setting behaviours R13 §2.3 lists (fill from a border, listed sizes only, add, move, lock, delete, mirror, overlaps flagged); a shrunk export times (1 − s) equals nominal; the sheet's numbers equal `production.create`'s.
- **Assistant parity:** per step, one recorded `design.run` sequence replayed in CI without a model; the tool-list snapshot changes once (`design.verbs`).
- **Performance gates** of 4.14 with 2× headroom in Node; real numbers on the Air are a manual gate. **Review lenses:** geometry; the founder's first hour; premium design for each new screen; security for scripts and imports.
- **The founder can try:** type any Rhino command into the palette; open the report; drop a vendor's ring and re-size it; ask the assistant for 0.4 g less. **Cannot be verified here:** Rhino opening our files (decision 12), real-GPU frame times, vendor files, the legal review.

**Spikes before building.** P1 (19) own build: size, start-up and memory on the Air; replicad's symbols all present. P2 (20) sew and solidify on 50 fuzzed face sets, no false "closed". P3 (21) a rhino3dm trimmed face rebuilt and sewn. P4 (21, 28) own openNURBS build: write a trimmed solid and a SubD; does the public source convert SubD to NURBS. P5 (28) OpenSubdiv in WebAssembly. P6 (28) QuadriFlow in WebAssembly. P7 (29) pole deformation of a filleted solid stays valid. P8 (22) occ_gordon in the build, on a 4 × 4 curve net. P9 (23) a quintic blend strip for BlendSrf. P10 (25) exact hidden lines timed on a pavé ring. P11 (11) the scoop sweep on five shank variants, US 4 to 12.

## 6. Scope cuts

**Left out, each for the founder to confirm** (decision 7). The ledger records every one with its reason.

| Left out | Rows | Why | Picked up when |
|---|---|---|---|
| Hydrostatics and marine formats; sun studies, site anchors, KMZ | M4, O13, parts of O10, P11 | ship design and architecture | never, unless asked |
| Revision clouds, wall tools, GD&T, layout to DWG | N10, part of Z9 | architectural drafting | same |
| ACIS, Parasolid, SolidWorks, DGN files | P9 | proprietary kernels; STEP carries the geometry | a paying customer needs one |
| Legacy render and niche formats; FBX, SketchUp, 3DS, LWO, VRML | P11, part of P7 | unrelated to the trade; several need outside libraries | a customer's pipeline needs one |
| DWG; AI and PDF as input; EPS, EMF, WMF; VDA | parts of P8, P5 | DWG needs a GPL or commercial library [E]; DXF and SVG in, and PDF, SVG, DXF out, cover the trade | the founder accepts a paid library |
| VBScript and Python runtimes, Rhino plug-ins, Rhino.Inside, `.gh` files | parts of R1, R2, R4 | cannot run in a browser, or depend on Rhino | never |
| Toolbar files, window layouts, floating viewports | parts of R5, O3, Z13 | interface parity | never |
| Edge Softening, Shut Lining; digitiser arms | part of E14; 11 names outside the 195 | render tricks; hardware a browser cannot reach | never |
| Print supports, casting trees, a catalogue of thousands of styles, a `.jcd` importer, Voronoi and filigree generators | R13 §6 | the printer's program, the caster and the assistant do these; `.jcd` is proprietary | customers ask |

**Still cut from `freeform-cad.md`:** a 2D constraint solver (Rhino has none), stored geometric-query selectors, write-back and Freeze, drawing with touch. **Not in this plan:** the MCP server and public API (4.9), in-view gem refraction (the own-renderer topic), prices beyond reading the partner link.

## 7. Build order

Each step ships on its own, tests first, with a handoff note; each adds its verbs and ledger rows, its `.pave` feature name with one golden file, and one recorded `design.run` replay. "After" names what must exist; steps 1 to 8 are `freeform-cad.md`'s. Effort is [E], in weeks of one lane. **Order:** steps 10, 11 and 14 (R13's gaps 1 to 3) come before most Rhino steps, and 16 to 18 before every engine-heavy one (19 on): R13 puts those jobs in a jeweler's day or week. The cheap, high-use Rhino rows (12, 13, 15) sit between them.

9. **The parity ledger.** *Delivers:* `parity/` seeded by a script from R22 §3 and McNeel's Rhino 9 list; `pnpm parity:report`; the palette's answer rows; the *Coming from Rhino* page. *Files:* `packages/schema/src/parity/*`, `scripts/parity-{seed,report}.mjs`, `features/cad/parity/`, `quick-commands.ts`. *Tests:* every name maps once; a done row without a passing tagged test fails; `/Zebra` shows "Planned · step 15". *Done means:* CI fails on an unmapped name; the report matches the coverage table below. 1 week. After: nothing.
10. **The workshop sheet.** *Delivers:* the sheet screen over `packages/production` (views, dimensions, stone map by size, list, cost with sourced prices, checks); the thickness map from `dfm/wallProbe.ts` (M7); balance and stone-gap checks; *For casting*: shrink at export, the `sprue` node, the manifest change. *Files:* `features/production/`, `kernel/analysis/`, `export/casting.ts`, `production/src/{manifest,rfq}.ts`. *Tests:* sheet facts equal `production.create`'s on three fixtures; the map's minimum equals the wall check's; the shrink round trip; the sprue is in no weight and no other export. *Done means:* a template ring's sheet opens, stays live and downloads. 2.5. After: nothing.
11. **Weight.** *Delivers:* `scoop`, `azure`, the HUD target, the *Lighten* verb with predicted savings. *Files:* `kernel/jewelry/`, `features/{scoop,azure}.ts`, `hud/Hud.tsx`. *Tests:* wall never under the caster profile's minimum at US 4 to 12; weight falls by the prediction within 5 %; "Ready to cast" holds; one cutter per stone, ribs kept. *Done means:* a 3.9 g band reaches a 3.5 g target in two undoable moves. 2. After: P11; step 3 for drawn bands.
12. **Everyday modeling sweep.** *Delivers* (17 rows): `points`; conics, spirals, handle and freehand curves; tween, arc blend, text outlines, isocurves, general intersect, flat projections, sub-curves, knots and weights, the refit and structure family, 2D booleans; five more primitives; holes, wire cut and boss as verbs over extrude and boolean; handles and graded or random scale on patterns along a curve (Rhino 9). *Files:* `geometry/curve.ts`, `features/{points,curveOp,primitive,pattern}.ts`. *Tests:* one closed-form test per row; 2D booleans against Manifold `CrossSection`. *Done means:* the report shows the 17 rows done. 2.5. After: steps 1 to 5.
13. **Snaps, selection, repeatable steps.** *Delivers* (14 rows): knot, vertex, point and near snaps; reference snaps; snaps on surfaces and meshes; tracking guides; an opt-in automatic plane on a hovered flat face; one *Select* verb with a typed query ("open curves on Stones", duplicates, by size, colour, name, metal), shared with the assistant; lasso, fence, brush and volume picks; sub-objects on meshes; `saved` planes and selections; macros; `userText`; settings export. *Files:* `model/snaps.ts`, `model/tools/lasso.ts`, `design/select.ts`. *Tests:* pure snap and query tests; a macro replays as one change; each of the 119 `Sel…` names resolves to a query. *Done means:* a keyboard-only run selects by query and replays a macro. 2.5. After: steps 2, 4, 5.
14. **Stone fields by hand.** *Delivers:* pins, keep-outs and mirror in `pave` and `gemRow`; `prongSet` (between stones, edited as one); `pattern{onStones}`; curves drawn on a body; text along a curve; the per-stone frame list, unless step 3 is still open and takes it. *Files:* `mesh/pave/layout.ts`, `features/{pave,gemRow,prongSet,pattern}.ts`, `model/tools/stonePins.ts`. *Tests:* R13's micro-setting behaviours; pins hold through a resize; guarded undo keeps a designer's and the assistant's pins apart. *Done means:* a field with a crest kept clear, built by hand and by a replay, is identical. 3. After: steps 3, 6.
15. **Views, display and checks.** *Delivers* (19 rows): wireframe, ghosted, pen and monochrome modes, per object too; four-up on request; the rest of navigation; `saved` views, snapshots, layer states, positions; a reference picture on a plane; centroids and moments; curvature graph; stripes, environment, draft and curvature shading with the all-edges continuity check (Rhino 9); deviation; general clash; clipping planes with caps and section styles; display units and document tolerance. *Files:* `cad/analysis/`, `viewport/{Clip,FourUp}.ts`, `kernel/analysis/*`. *Tests:* the mass suite; shaders by reading attributes, not pixels; a section loop equals `BRepAlgoAPI_Section`'s. *Done means:* the assistant captures a stripes view and names the bad edge. 4. After: steps 2, 5, 8.
16. **Bring-in.** *Delivers:* `design.import`; .3dm as meshes, curves, layers and cached face meshes; ring size from a bore fit; `meshOp` resize, repair, offset and wrap (E7, E11, E12). *Files:* `kernel/import/rhino3dm.ts`, `mesh/{resizeRing,boreFit,shrinkwrap}.ts`, `features/meshOp.ts`. *Tests:* the bore fit on template rings within 0.05 mm; a re-size keeps the head rigid and warns beyond two sizes; a wrap of two overlapping shells is one closed shell. *Done means:* a foreign ring goes from drop to "Ready to cast" at a new size. 3. After: step 8 for exact imports.
17. **Stones and heads II.** *Delivers:* six step cuts; a custom stone from a drawn outline; a mesh as a stone, its girdle outline cutting the seat; trellis, tulip, martini, peg and cluster heads; hidden halo; toi-et-moi layouts. *Files:* `domain/gems.ts`, `gems/`, `features/{gem,setting,halo}.ts`. *Tests:* carat for each cut against published tables where they exist, else volume by density; claws clear the stone; seats cut. *Done means:* each style passes "Ready to cast" on a fixture. 2.5. After: step 1 for custom outlines.
18. **Sets and parts.** *Delivers:* `linked`; `band` on the ring's contour with a fit gap; *Make a matching band*, which creates the second piece; the parts library (`part` table, `parts.*`, *Save as part*, insert with named inputs); hinge, bangle and hoop as the first parts. *Files:* `features/{linked,band}.ts`, server handlers and migration, `outliner/AddMenu.tsx`. *Tests:* the gap holds within 0.02 mm along the contour; the band follows a stone change in the ring; an inserted part validates clean. *Done means:* ring and band are two pieces that stay in step. 3. After: steps 3, 4.
19. **Our own OpenCascade build.** *Delivers:* `packages/occt`, CI build, the resolver switch, `PAVE_OCCT`; first uses: exact non-uniform scale and shear on any exact body (F4), `UnifySameDomain` history re-tested. *Files:* `packages/occt/*`, `kernel/runtime/index.ts`, `solid/occt.ts`. *Tests:* P1's gates; every symbol replicad calls exists; the whole kernel suite on both builds. *Done means:* the suite is green on the new build and the gates are met, or the fallback of 4.3 is in place. 2. After: P1.
20. **Surfaces as objects.** *Delivers* (7 rows): `SURFACE_KINDS`, `surface{planar, grid, extrude, loft, sweep, revolve, fromFaces}`, `surfaceOp{join, untrim, offset}`, `solidify`, open-edge display and checks (M8), surface control points with falloff moves (Rhino 9), symmetry on poles. *Files:* `features/{surface,surfaceOp,solidify}.ts`, `geometry/nurbsSurface.ts`, `viewport/Surfaces.ts`. *Tests:* §5's box cases; weight, checks and STL ignore surfaces; a pole drag is one patch. *Done means:* six surfaces become a weighable solid, and five do not, with the reason. 4. After: 19, P2.
21. **Rhino files both ways.** *Delivers:* .3dm import of exact solids and surfaces; .3dm export of joined, trimmed solids through our openNURBS build. *Files:* `kernel/import/rhino3dm.ts`, `export/rhino3dm.ts`, `packages/opennurbs/` (new, if P4 passes). *Tests:* the round-trip suite; "Join in Rhino" disappears from the notes only where the read-back is closed. *Done means:* a filleted, combined ring leaves as one closed polysurface. Conditional on P3 and P4; if P4 fails, import ships and export stays as step 8 left it. 4. After: 19, 20.
22. **Surface creation.** *Delivers* (11 rows): Patch, EdgeSrf, NetworkSrf (occ_gordon), RailRevolve, Drape, fin, ribbon and to-point extrusions, Project and Pull, curves and offsets on surfaces, UV curves, trim by curve or isocurve. *Files:* `features/{surface,surfaceOp,curveOp}.ts`, `solid/occt.ts`. *Tests:* a network surface meets its curves; a patch meets its edges; a projected curve lies on its surface within tolerance. *Done means:* a bombé top built from a curve net becomes metal. 5. After: 19, 20, P8.
23. **Surface continuity.** *Delivers* (10 rows, plus Rhino 9's Patch and setback fillets as far as the engine allows): curve and surface Match, Fair, Extend, soft edits; surface rebuild; fillets between surfaces; variable-radius fillets; BlendSrf. *Files:* `features/{surfaceOp,curveOp,fillet}.ts`. *Tests:* G1 and G2 measured across the shared edge; variable fillets pass the guard of `freeform-cad.md` §4 item 4. *Done means:* BlendSrf and setbacks are "done" or honestly "partly". 5 to 6. After: 22, P9.
24. **Direct editing.** *Delivers* (5 rows, plus Rhino 9 multi-face): `faceOp` push/pull, move face, inset, solid points on flat-faced bodies, merge faces; a curved face passes through with "not here yet". *Files:* `features/faceOp.ts`, `viewport/Handles.ts`. *Tests:* a pushed face changes volume by area × distance; face names survive. *Done means:* dragging a flat face is one history line, by hand and by replay. 3 to 4. After: 19.
25. **Drawings.** *Delivers* (10 rows): the *Drawing* verb with exact lines; `annotation` and `sheet`; styles, linetypes, hatches; silhouettes; print; DXF, SVG, PDF out; DXF and SVG in. *Files:* `kernel/project.ts`, `production/src/drawing/{exact,annotations,sheetModel}.ts`, `features/drafting/`, `export/dxf.ts`. *Tests:* exact and mesh lines agree within 0.05 mm on fixtures; dimensions follow a resize. *Done means:* a four-view sheet with dimensions exports as PDF and DXF. 5 to 6. After: 15; P10.
26. **Meshes complete.** *Delivers* (9 rows): a half-edge editor behind `meshOp{edit}`, mesh primitives, mesh from points, remesh, cuts by curves, displacement and thickening, facet-per-face mesh to NURBS, point clouds and point files, surface textures (R13 gap 15). *Files:* `mesh/{halfedge,delaunay,displace}.ts`, `features/meshOp.ts`, `import/points.ts`. *Tests:* every edit keeps a closed mesh closed; a displaced body keeps its minimum wall. *Done means:* the report shows the 9 rows done. 3. After: 16.
27. **Soft shapes I.** *Delivers* (6 rows; R13 gap 14): `subd`, cage tools as keyed patches, creases, symmetry, loop picks, six starters, MultiPipe, the limit mesh. *Files:* `geometry/subd/*`, `features/subd.ts`, `model/tools/subdCage.ts`, `viewport/Cage.ts`. *Tests:* against the OpenSubdiv fixtures; closed cages give closed meshes; one tool is one patch. *Done means:* a soft signet passes "Ready to cast". 6 to 8. After: 13.
28. **Soft shapes II and QuadRemesh.** *Delivers* (2 rows, plus Rhino 9): `convert`, SubD in .3dm, mesh to cage through the `quadRemesh` job, inflate. *Files:* `features/convert.ts`, `engines/geometry/`, `packages/opennurbs/`. *Tests:* the deviation is reported and under 0.01 mm away from corners [E target]; a killed job resumes. *Done means:* a soft signet exports to STEP as a valid solid, or the ledger says "partly". Conditional on P4, P5, P6. 4 to 6. After: 21, 27.
29. **Deformers.** *Delivers* (4 rows): cage lattice, soft moves, flow along a surface, Maelstrom, Splop, arrays on surfaces, in the three grades of 4.6. *Files:* `features/{deform,pattern}.ts`, `inspector/widgets/lattice.tsx`. *Tests:* an identity lattice changes nothing; the exact grade stays valid; the mesh grade is badged. *Done means:* each row names the grade it reached. 4. After: 19, P7.
30. **Blocks and linked pieces.** *Delivers* (3 rows, plus Rhino 9's panel): `component` and `instance`, edit in place, linked blocks and reference pieces on `linked`, blocks in .3dm. *Files:* `features/{component,instance,linked}.ts`, both `rhino3dm.ts` files. *Tests:* an edit to a component reaches every instance; a link cycle is refused; blocks round-trip. *Done means:* twelve instances of one claw weigh twelve times one. 3. After: 18, 21.
31. **More formats.** *Delivers* (2 rows): IGES in and out; AMF, OFF and PLY out; USDZ if three.js's exporter proves enough [E]. *Files:* `import/iges.ts`, `export/{iges,amf,off}.ts`. *Tests:* §5's IGES round trip. *Done means:* a ring saved as IGES re-opens with the same volume. 1.5 to 2. After: 19.
32. **Materials, mapping, lights, motion.** *Delivers* (4 rows): user materials; box, planar, cylindrical and unwrap mapping (xatlas); custom lights; path animation, all through the Render stage. *Files:* `packages/render/src/` (assistant build). *Tests:* one user material reaches the viewport and the Blender scene alike. *Done means:* an enamel colour and a custom light show in a render. 3 to 4. After: the render plans.
33. **Automation.** *Delivers* (3 rows): `exprs`, `variables`, the History map, the script sandbox; a canvas only if decision 5 changes. *Files:* `design/{expr,mount}.ts`, `graph/HistoryMap.tsx`, `apps/server/src/scripts/` (new). *Tests:* formula cycles are refused; a failed formula falls back to its stored number; a script cannot reach the network or a file and stops at its time limit. *Done means:* one variable re-sizes a band; a script's run undoes in one step. 4 to 8. After: 13.
34. **The long tail.** *Delivers* (4 rows): Unroll, Squish and Smash, DevLoft, VariableOffsetSrf; built only if the founder wants the last 2 %. *Files:* `features/surface.ts`, `mesh/flatten.ts` (new). *Tests:* an unrolled cone keeps its area. *Done means:* each row is done or declared "partly". 3 to 4. After: 22.

**Coverage.** Every open row of R22, and where it lands. After step 34, 190 of the 195 rows are covered (a few with a declared leave-out inside them, §6) and 5 whole rows are left out.

| Group (R22 section) | Open row → step |
|---|---|
| Curves (3.1 to 3.3) | A1, A4, A6, A8, A9, A11, A12, A14, A19, A21, A25, A26, A30 → 12 · A33 → 20 · A7, A13, A15, A18 → 22 · A24, A27, A28 → 23 · A16 → 25 |
| Surfaces (3.4) | B1, B24, B25 → 20 · B4, B10, B11, B12, B13, B14, B23 → 22 · B15, B16, B17, B18, B26, B27 → 23 · B6, B20, B21, B22 → 34 |
| Solids (3.5) | C2, C15, C16, C17 → 12 · C6, C10 → 20 · C8 → 23 · C11, C12, C13, C14, C18 → 24 |
| SubD (3.6) | D1, D2, D3, D4, D5, D7 → 27 · D6 → 28 |
| Meshes (3.7) | E7, E11, E12 → 16 · E2, E3, E5, E9, E10, E13, E14, E15 → 26 · E6 → 28 |
| Transforms (3.8) | F15 → 15 · F4 → 19 · F8, F12, F13, F14 → 29 |
| Planes, snaps (3.9) | H2, H3, I1, I2, I3, I4 → 13 |
| Selection (3.10) | J2, J3, J4, J5, J6 → 13 |
| Organisation (3.11) | K8 → 13 · K2 → 15 · K5, K6, K7 → 30 |
| Analysis (3.12) | M7 → 10 · M3, M5, M6, M9, M10, M11, M12 → 15 · M8 → 20 · M4 → left out |
| Drafting (3.13) | N9 → 15 · N1, N2, N3, N4, N5, N6, N7, N8 → 25 · N10 → left out |
| Display (3.14) | O1, O2, O3, O4, O5, O6, O9 → 15 · O7, O8, O10, O12 → 32 · O13 → left out |
| Files (3.15) | P1, P2 → 21 (P2's mesh half in 16) · P8 → 25 · P10 → 26 · P5, P7 → 31 · P9, P11 → left out |
| Units (3.16) | Q1, Q2 → 15 |
| Scripting (3.17) | R3, R5 → 13 · R1, R2, R4 → 33 |
| Rhino 9 (3.19) | Z7 → 12 · Z4 → 15 · Z3 → 20 · Z1, Z2 → 23 · Z5 → 24 · Z9 → 25 · Z6 → 28 · Z10 → 30 · Z8 → 32 · Z11 → 33 · Z12 done today · Z13, Z14 answered in the ledger, not built |
| Jewelry (R13 §5 ranks) | 3, 6, 12 → 10 · 1 → 11 · 2, 9, 10, 11 → 14 · 7 → 16 · 4 → 17 · 5, 8, 13 → 18 · 15 → 26 · 14 → 27, 28 |
