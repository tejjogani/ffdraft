# 12 — Rhino parity: the jewelry designer's Rhino and plug-in toolset, ranked, with feasibility

Research date: 2026-11-24. Scope: every Rhino tool and jewelry plug-in capability (MatrixGold, RhinoGold / RhinoArtisan, Panther3D / CrossGems, smaller tools) a working jewelry CAD designer reaches for, how often, whether Pavé's engines can do it, what Pavé has today, and in which step of the build brief it lands. Build brief: [`docs/plans/freeform-cad.md`](../plans/freeform-cad.md). Domain model and kernel background: [`01-cad.md`](./01-cad.md); meshes, pavé and freeform on-ramps: [`06-freeform.md`](./06-freeform.md).

**How to read the evidence.** `[V]` was checked this session: by a spike against the repo's own runtimes (replicad 1.2.1 with replicad-opencascadejs 1.2.1, manifold-3d 3.5.5, rhino3dm 8.35), or by reading the shipped `replicad_single.d.ts`. `[S]` is a web fact taken from search summaries, because vendor pages (gemvision.com and most others) could not be opened. `[E]` is judgement or working knowledge of Rhino and jewelry CAD. Frequencies are `[E]` throughout.

- **Frequency:** **A** nearly every piece · **B** most weeks · **C** occasional · **D** rare or specialist.
- **Feasibility:** **native** = one engine call or a thin wrapper · **needs work** = known algorithm, days of kernel work, or mostly interaction · **research** = no engine support or robustness unknown.
- **Step:** the build-order step in the brief (1–8), **Today** (Pavé already does the job, often as a jewelry node), **Later** (named, not scheduled), **Not planned** (deliberately left out; §5 says why).

## 1. The short answer

- **The plug-in layer is already replaced.** Ring builder and size change, gem library with mm ↔ ct, heads, bezels, halos, channel and shared-prong rows, auto pavé with beads and seats, cutters, engraving, bails, findings, chains, relief, weight and stone reports, casting checks and "dynamic" builders all exist as parametric nodes the AI can drive. A bridal or pavé piece needs no low-level modeling in Pavé today. **On template pieces only:** today `StoneHost`, `gemRow.host`, `placement.ringTop` and inside/outside engraving work only on `ringShank` [V gem.ts, nodes.ts, engraving.ts], so on a drawn band a head stands on its own base ring. They work on drawn bodies from build step 3 (a generic stone host and ring data from ring-rail sweeps).
- **What is missing is the from-scratch layer underneath:** curves drawn and edited point by point, snaps and construction planes with typed numbers, the surface verbs that consume curves (extrude, loft, sweep, flow), edge fillets on picked edges, and the gumball. That is what "create from scratch" asks for.
- **The engines are not the bottleneck.** The shipped OpenCascade build has loft, both sweep classes, fillet and chamfer, shell, offset, section, splitter, filling, the STEP reader and writer, and shape history [V]. What it lacks (non-uniform B-rep transform, Gordon/Coons surfaces, curve projection, 3D curve–curve extrema, IGES) has workarounds or is deferred. Manifold covers mesh warps, many-cutter booleans and clearance [V].
- **Traps found and measured [V]:** a fillet that is slightly too big returns `IsDone` with an **invalid solid whose volume grew** (r 1.6 on a 15-edge prism: 56.1 → 77.5 mm³, `BRepCheck_Analyzer` false), and filleting the seam edges of a full revolve throws a raw `WebAssembly.Exception`. A follow-up spike round (2026-11-24) added: an r 0.6 fillet where a head is fused onto a band is mostly **not done** (every radius from 0.1 fails when the head sits on the band; 10 of 10 drags failed) and a failed attempt can take 7 s; replicad's `normalAt` evaluates the wrong spot on station-sweep B-spline faces, so smooth joins measure as 11–84° creases (crease detection must use `BRepLib.EncodeRegularity` and `BRep_Tool.Continuity`); `MakeThickSolid` returns a done, valid shell that removes **nothing** on a body with rounded edges, throws on revolved domes, and with no open face returns the inner offset solid. Any fillet or shell node must check validity and expected volume change, offer only crease edges by regularity, and run under a time limit; rounds where a head meets a band belong in the head or the profiles.
- **Counts (core Rhino, the A and B rows of §3):** 74 tools; 22 covered today (on templates; the jewelry ones on drawn bodies from step 3); 42 added by build steps 1–8; 8 deferred (Project, CurvatureGraph, NetworkSrf, EdgeSrf, FlowAlongSrf, four viewports, curvature analysis, blocks); 2 not planned (BlendSrf, exact SubD). The one A-frequency tool deferred is four-up viewports, which instant view switching stands in for. **Plug-ins (§4, 21 rows):** 12 replaced today, 5 land in steps 6–7, 3 deferred, 1 not planned (Clayoo-style exact SubD; a mesh SubD node is Later).

## 2. The 18 tools that cover most from-scratch jewelry modeling, ranked

Ranked by how much of a from-scratch piece depends on them `[E]`.

| Rank | Tool (Rhino names) | Feasibility | Evidence | Step |
|---|---|---|---|---|
| 1 | Control-point and interpolated curves, polyline, circle, arc, with point editing (Curve, InterpCrv, Polyline, Circle, Arc, PointsOn) | native kernel; needs work UI | `Geom_BSplineCurve`, `GeomAPI_Interpolate` [V]; kernel `geometry/bspline.ts` | 1 (data), 2 (drawing) |
| 2 | Osnaps, grid, ortho, numeric entry, Top/Front/Right construction planes | needs work (UI + curve snap points from the kernel) | none in OCCT; pure geometry | 2 |
| 3 | Gumball: move, rotate, scale, mirror | needs work (UI) | `base.transform` exists; planned `Gizmo.tsx` never written | 4 |
| 4 | Offset curve, planar (Offset) | native | `BRepOffsetAPI_MakeOffset` [V]; Manifold `CrossSection.offset` [V] | 2 |
| 5 | Sweep1 and Sweep2 (profiles along one or two rails) | Sweep1 native; Sweep2 needs work | multi-profile station sweep on a drawn profile: 23 ms tessellation, 69 ms exact B-rep, volumes agree to 0.01 % [V]; two rails work with closest-in-section-plane matching (valid, within 0.003 mm of rail 2, 11–28 ms), not by parameter (2.71 mm off), and `MakePipeShell` auxiliary mode throws [V]; profiles must be anchored in the rail frame to survive a resize | 3 (one rail, silhouette laws for cathedrals), 7 (two general rails) |
| 6 | Revolve from a drawn profile | native; the node exists | `revolve` takes an SVG path today | 1 |
| 7 | Loft | native; naming needs work | `ThruSections` 3 circles 33 ms [V]; with mismatched sections it pairs edges by arc length, many-to-many, so no face keeps one key [V]; key-driven segment splitting keeps names (102 ms) [V] | 3 |
| 8 | ExtrudeCrv (straight, tapered) and Cap | native | `MakePrism` [V], `DraftAngle` [V] | 3 |
| 9 | Boolean union, difference, split on drawn bodies | native; the node exists | exact B-rep 137 ms, but 175–600 ms for a sweep ∪ head and 2.1 s for a shank ∪ head at production; draft booleans are Manifold meshes (fillets downstream need them exact); Manifold 2,000 cutters 1.6 s [V]; `Splitter` [V]; `pattern` is not yet a body kind, so arrays cannot be cutters [V] | 3 (union/difference), 6 (split) |
| 10 | FilletEdge, ChamferEdge | native; **robustness needs work** | 8–144 ms on prisms, 41–58 ms on sweep creases (r ≤ 0.5); invalid-but-done above the limit; seam edges crash; fused head-to-band seams mostly not done, up to 7 s per attempt; 200-fillet fuzz: guard caught both invalid results, ladder p95 1.8 s [V] | 3 (feature rounds, flared heads), 5 (picked edges, exact worker, time-boxed) |
| 11 | Flow along a curve (flat → ring), Bend | needs work (curves and station sweeps: exact; meshes: warp); general exact B-rep is research | a bar centred on the base curve keeps volume (0.000 %), one whose bottom edge is the base gains 9.7 % (geometry); rotation-minimising frames roll 20.6–50.1° on wavy closed rails, so 'up' framing is the default; open S-rail 64 ms [V]; Manifold `warp` 15 ms [V] | 7 |
| 12 | Polar array, array along a curve | polar native and exists; along a curve needs work (small) | `pattern{polar}` exists | 4 |
| 13 | Orient on surface, Gem on surface by clicking | native kernel; UI needs work | `GeomAPI_ProjectPointOnSurf` [V]; `gem.placement{surface}` exists, but a surface stone has no host today (flush only) [V gem.ts] | 3 (host on any body), 6 (click) |
| 14 | Scale1D / Scale2D / ScaleNU | needs work | `BRepBuilderAPI_GTransform` absent [V]; exact on curve points and station sections, mesh otherwise | 4 (curves), 7 (bodies) |
| 15 | Pipe along a drawn curve | native; the node exists | `pipe.points` today | 1 |
| 16 | Measure: distance, radius, weight | native; weight already in the HUD | `BRepExtrema_DistShapeShape` [V] | 8 |
| 17 | NetworkSrf, EdgeSrf (heads, bombés, organic shoulders) | needs work | Gordon and Coons absent [V]; `MakeFilling` patch over 4 B-spline edges ok [V]; organic shoulders come from profile interpolation and silhouette laws on one sweep (step 3) instead | Later |
| 18 | Layers as groups; hide, isolate, lock | needs work (UI) | `group` exists | 8 |

## 3. Full inventory by family

### 3.1 Curves and sketching

| Tool (Rhino names) | Freq | Feasibility | Engine evidence | Pavé today | Step |
|---|---|---|---|---|---|
| Curve (control points), InterpCrv | A | native kernel; needs work UI | `Geom_BSplineCurve`, `GeomAPI_Interpolate` [V] | `pipe.points` only, fitted, not editable | 1 |
| Polyline, Line | A | native | `makeLine`, `makePolygon` | none as a user curve | 1 |
| Circle, Arc, Ellipse | A | native | `makeCircle`, `makeThreePointArc`, `makeEllipse` | inside features only | 1 |
| Offset curve (planar) | A | native | `MakeOffset` [V] | internal (bezel, halo) | 2 |
| Ring rails and profiles (plug-in ring wizard input) | A | native | station sweep | replaced by `ringShank`; rails not editable | Today |
| Rectangle (rounded), Polygon | B | native | `drawRoundedRectangle`, `drawPolysides` | `vectorBody.shape` presets | 1 |
| Curve fillet / chamfer of corners (FilletCorners) | B | native for planar curves | replicad drawing corner fillet; `ChFi2d` absent | none | 2 |
| BlendCrv (G1/G2) | B | needs work (closed-form poles from end derivatives) | no class | none | 7 |
| Text, TextObject | B | native | opentype + kernel `text.ts` | replaced: `vectorBody{text}`, `engraving` | Today |
| Picture and trace | B | needs work | studio-side tracing | `vectorBody{svg}`; Make-it-jewelry traces images | Today |
| DupEdge, DupBorder | B | native | topology explorer | none; a stone's girdle outline (`curveOp{outline}`) in step 3 | 5 |
| Project (curve onto surface) | B | needs work | `BRepOffsetAPI_NormalProjection`, `BRepProj` absent [V]; workaround: section of the extruded curve with the surface | none | Later |
| Helix, Spiral | C | native | `makeHelix` [V] | inside `chain` only | 1 |
| Intersect, Contour, Section | C | native | `BRepAlgoAPI_Section` sphere × plane = 2π·10 [V] | none | 5 |
| Offset curve on surface / 3D | C | needs work | no 3D `Geom_OffsetCurve` [V] | none | Later |
| Pull (closest point) | C | needs work | `GeomAPI_ProjectPointOnSurf` [V] + refit | none | Later |

### 3.2 Curve editing

| Tool (Rhino names) | Freq | Feasibility | Engine evidence | Pavé today | Step |
|---|---|---|---|---|---|
| PointsOn (F10), drag CVs and edit points, nudge | A | needs work (the central interaction) | data plus UI; keyed points make one drag one patch | none | 2 |
| Rebuild, FitCrv | A | native | `GeomAPI_PointsToBSpline` [V] | none | 5 |
| Join, Explode | A | native | `BRepBuilderAPI_MakeWire` | none | 5 |
| Trim, Split (curve by curve) | A | native in a plane; 3D needs work | `Geom2dAPI_InterCurveCurve` [V]; 3D extrema absent [V] | none | 5 |
| Mirror with symmetry (live Symmetry on a curve) | A | native | trivial; `points.symmetry` mirrored at evaluation, so a drag stays one patch | `pattern{mirror}` (nodes, not points) | 2 (curves), 4 (bodies) |
| Dir / Flip, CrvSeam, CloseCrv | B | native | trivial | none | 2 |
| CurvatureGraph | B | needs work (overlay) | `BRepAdaptor_Curve` D2 [V] | none | Later |
| InsertKink, InsertPoint, InsertKnot, RemoveKnot; tangent arc inside a curve | C | native kernel; UI | insert point, corner/smooth/arc in step 2 (arc as a rational quadratic span); per-key ranks keep concurrent inserts undoable [V]; knots later | none | 2 |
| Extend, MatchCrv, Fair | C | needs work | none | none | Later |

### 3.3 Surfaces

| Tool (Rhino names) | Freq | Feasibility | Engine evidence | Pavé today | Step |
|---|---|---|---|---|---|
| ExtrudeCrv (straight, tapered), ExtrudeSrf | A | native | `MakePrism` [V], `DraftAngle` [V] | `vectorBody` (outline + bevel) | 3 |
| Revolve | A | native | `MakeRevol` | `revolve` node (SVG profile) | Today |
| Loft | A | native | `ThruSections` [V]; names only with key-matched sections [V] | none | 3 |
| Sweep1 | A | native | `MakePipeShell` [V]; kernel `sweep.ts` | `pipe`; every shank and prong is a sweep inside | 3 |
| Sweep2 (two rails) | A | needs work | `MakePipeShell` auxiliary mode throws a raw `WebAssembly.Exception` [V]; station sweep with rail 2 matched closest-in-section-plane: valid, 11–28 ms [V]; on rings the second outline is a height (Front) or width (Top) law, the silhouette sweep | `ringShank` covers the common case | 3 (silhouette laws), 7 (general) |
| PlanarSrf, Cap | A | native | `makeFace`, sewing | internal | 3 |
| FilletEdge (variable), ChamferEdge | A | native; robustness needs work | `BRepFilletAPI_MakeFillet` [V]; invalid-but-done case [V]; fused seams mostly not done [V] | `primitive.fillet`, `vectorBody.bevel` | 5 |
| OffsetSrf (solid) | A | native for prisms; by profile offset for revolves and sweeps | `MakeOffsetShape`, `MakeThickSolid` [V]; `MakeThickSolid` throws on revolved domes, where offsetting the 2D profile works in 6 ms [V] | `meshBody.hollow` (mesh) | 5 |
| Split, Trim (surface by surface) | A | native by surface; by curve needs Project | `BRepAlgoAPI_Splitter` → 2 solids [V] | none | 6 |
| NetworkSrf | B | needs work (several days) | `GeomFill_Gordon` absent [V] | none | Later |
| EdgeSrf (2–4 edges) | B | needs work | Coons absent [V]; `MakeFilling` [V] | none | Later |
| BlendSrf (G1/G2) | B | research | none | none | Not planned |
| FlowAlongSrf | B | mesh needs work; exact research | Manifold `warp` [V] | none | Later |
| RailRevolve | C | needs work | sweep with a scale law about the axis | none | Later |
| Patch | C | native (raw class) | `MakeFilling` area 102.5 mm² [V]; replicad's `makeNonPlanarFace` failed [V] | none | Later |
| Heightfield, SrfPtGrid | C | native | `PointsToBSplineSurface` [V] | replaced: `relief` | Today |
| MatchSrf, RebuildSrf, ExtendSrf, Untrim | C | needs work to research | partial | none | Not planned |
| Squish, UnrollSrf | D | research | none | none | Not planned |

### 3.4 Solids

| Tool (Rhino names) | Freq | Feasibility | Engine evidence | Pavé today | Step |
|---|---|---|---|---|---|
| BooleanUnion, Difference, Intersection | A | native | OCCT and Manifold [V] | `boolean` node; seats cut automatically | Today |
| Primitives: box, sphere, cylinder, cone, torus | A | native | [V] | `primitive` | Today |
| Pipe (variable radius) | A | native | `MakePipeShell` + law | `pipe` with taper | Today |
| BooleanSplit, Slab cut | B | native | `Splitter` [V]; Manifold `split` [V] | `meshBody.flatBack` | 6 |
| Shell, hollow back | B | native for prisms; needs work otherwise | `ThickSolid` open-top box 48 ms [V]; correct shells remove 54–62 % [V]; on a rounded heart it returned done, valid and removed 0 mm³; with no open face it returns the inner offset; after a boolean not done [V] | `meshBody.hollow` | 5 |
| Solid text, emboss, engrave | B | native | kernel | `engraving` | Today |
| Check, SelBadObjects, ShowEdges (naked) | B | native | `BRepCheck_Analyzer` [V] | diagnostics in the HUD | Today |
| MoveFace, OffsetFace, push-pull | C | needs work | `BRepFeat_MakeDPrism` only [V] | none (parameter handles in step 3 cover drag-to-edit) | Later |
| Draft (tapered walls) | C | native | `DraftAngle` [V] | extrude taper in step 3 | Later |
| MergeAllFaces | C | native, but breaks face names | `ShapeUpgrade_UnifySameDomain.History()` throws at runtime (unbound `BRepTools_History`) [V] | none | Not planned |
| Make2D (workshop drawings) | C | native | HLR `makeProjectedEdges` [V] | technical capture mode | Later |

### 3.5 Transforms and arrays

| Tool (Rhino names) | Freq | Feasibility | Engine evidence | Pavé today | Step |
|---|---|---|---|---|---|
| Move, Copy, Rotate, Scale (uniform), Mirror | A | native; UI is the gumball | `BRepBuilderAPI_Transform` [V] | `base.transform` (similarity only) | 4 |
| Gumball (handles, drag, typed values) | A | needs work (UI) | — | planned, absent | 4 |
| Scale1D, Scale2D, ScaleNU | A | needs work | `GTransform` absent [V] | `vectorBody.height`, `meshBody.height` | 4 |
| Orient, Orient3Pt | A | native (math) | — | none | 4 |
| OrientOnSrf | A | native kernel; UI | `ProjectPointOnSurf` + `BRepAdaptor_Surface` D1 [V] | stones only: `gem.placement{surface}` | 6 |
| ArrayPolar | A | native | math | `pattern{polar}` (world axes) | Today |
| ArrayCrv (milgrain, links, stones on a rail) | A | needs work (small) | curve frames | partly: `gemRow` on a band, `chain` | 4 |
| FlowAlongCrv (model flat or straight, bend into a ring; MatrixGold "Pull to Rail" [S]) | A | needs work (curves, station sweeps exact; meshes warp); research for general exact | spike-shank straight → flowed [V]; drawn open and closed rails valid, 'up' framing needed on closed wavy rails [V]; `warp` [V] | none | 7 |
| Array (rectangular), ArrayLinear | B | native | math | `pattern{linear}` (1D) | 4 |
| Bend, Twist | B | needs work | `warp` [V]; exact on station sweeps | `chain` rope twist inside | 7 |
| Align, Distribute, SetPt | B | native (math) | — | none | 4 |
| Taper, CageEdit, Splop | C | needs work | `warp` [V] | none | Later |
| ArrayCrvOnSrf, ArraySrf | C | needs work | frames on surface | `pave` for stones | Later |

### 3.6 History

| Tool (Rhino names) | Freq | Feasibility | Engine evidence | Pavé today | Step |
|---|---|---|---|---|---|
| Record History (Loft, Sweep, Flow, arrays update when inputs change) | A | native | the design DAG | replaced: nodes and `follows`, nothing "breaks history" | Today |
| Undo with named history | A | native | design session | replaced: undo that never clobbers AI edits | Today |
| Grasshopper; MatrixGold builders on Grasshopper [E] | B | — | nodes + command registry | replaced in spirit: the assistant composes nodes through commands; no node canvas | Today |

### 3.7 Construction planes, snaps, numeric entry

| Tool (Rhino names) | Freq | Feasibility | Engine evidence | Pavé today | Step |
|---|---|---|---|---|---|
| Osnaps: End, Mid, Cen, Quad, Int, Perp, Tan, Near, OnCrv | A | needs work (UI + kernel snap points) | pure geometry over curve polylines | none | 2 |
| Grid snap, Ortho, Planar | A | needs work (UI) | — | none | 2 |
| CPlane (Top, Front, Right, 3-point, to object, perpendicular to a curve) | A | needs work | one frame on curve nodes; planes attached to a rail station, face or stone so drawn parts follow a resize | none | 1 (attached data), 2 (UI), 5 (to face) |
| Numeric entry (`2.5` Enter, `@dx,dy`, `<45`) | A | needs work (UI) | — | inspector numbers | 2 |
| Four viewports, named views | A | needs work | stage | `1–4` presets in one viewport | 2 (two-up: plane view + perspective), Later (four-up) |
| SmartTrack, OnSrf and Knot snaps | C | needs work | BVH on-surface hits | none | Later |

### 3.8 Analysis and measuring

| Tool (Rhino names) | Freq | Feasibility | Engine evidence | Pavé today | Step |
|---|---|---|---|---|---|
| Distance, Length, Angle, Radius, BoundingBox | A | native | `DistShapeShape`, `Bnd_OBB` [V] | dimension chips | 8 |
| Volume, Area → metal weight | A | native | `BRepGProp` [V] | HUD grams by alloy | Today |
| Wall thickness, minimum clearance | A | native | Manifold `minGap` 0.400 for 0.4 [V] | production checks, "Ready to cast" | Today |
| Stone report | A | native | kernel | HUD stones and carats | Today |
| CurvatureAnalysis, Zebra, EMap, DraftAngleAnalysis | B | needs work (shaders) | `BRepAdaptor_Surface` D2 [V]; Manifold `calculateCurvature` [V] | none | Later |

### 3.9 Mesh and SubD

| Tool (Rhino names) | Freq | Feasibility | Engine evidence | Pavé today | Step |
|---|---|---|---|---|---|
| Mesh from NURBS, STL | A | native | kernel tessellation | exports | Today |
| MeshRepair, Reduce, Smooth, mesh booleans | B | native | kernel `mesh/*`, Manifold | `meshBody` clean-up | Today |
| ShrinkWrap | B | native / needs work | `mesh/sdf`, `levelSet` [V] | `meshBody` | Today |
| SubD box modeling (Clayoo-style shanks) | B | needs work as a castable mesh (`smoothOut` + `refine` 2 ms [V]); research for exact NURBS | none in OCCT | none | Later (mesh, badged); Not planned (exact) |
| QuadRemesh | C | research | none | none | Not planned |
| Sculpt, displacement | C | research | SDF / mesh | image-to-3D route instead; carved tops by `relief` draped on a host face (step 6, mesh) | Not planned |

### 3.10 Layers, selection, display, files

| Tool (Rhino names) | Freq | Feasibility | Engine evidence | Pavé today | Step |
|---|---|---|---|---|---|
| Layers (colour, on/off, lock) | A | needs work (UI) | data | `group`, outliner | 8 |
| Hide, Show, Isolate, Lock | A | needs work (UI) | — | view-only hide | 8 |
| Selection filters, window and crossing select | A | needs work (UI) | — | single-node select | 4 (window), 5 (filters) |
| Display modes (Shaded, Rendered, Ghosted, X-ray, Technical) | A | needs work | stage | rendered, clay, technical, x-ray | Today |
| Render (Rhino Render, KeyShot, V-Ray) | A | — | Pavé Render stage | replaced | Today |
| Export STL, OBJ, 3MF, STEP, 3dm | A | native | `export/` [V]; STEP exact for exact bodies, round trip valid [V]; rhino3dm writes exact periodic NURBS faces but cannot join them [V] | exports exist; 3dm is mesh, curves and layers only (exact loose faces in step 8; STEP is the exact route into Rhino) | Today |
| Blocks and instances | B | needs work | stone instancing | `pattern` copies | Later |
| STEP import | C | native | STEP reader in the build [V] | none | 8 |
| 3DM import | C | needs work | rhino3dm reads NURBS | none | Later |
| IGES import and export | D | not in the build [V] | — | none | Not planned |

## 4. What the jewelry plug-ins add, and where Pavé stands

| Capability (seen in) | Freq | Feasibility | Pavé today | Step |
|---|---|---|---|---|
| Ring builder / Ring Wizard (all; RhinoGold [S]) | A | native | replaced: `ringShank` | Today |
| Ring size change that keeps head and stones (all) | A | native | replaced: size field, placements follow | Today |
| Gem library / Gem Studio, mm ↔ ct (all) | A | native | replaced: `gem` | Today |
| Head and prong builder, bezel, halo (all) | A | native | replaced: `setting`, `halo` (on `ringShank` and free stones; on drawn bodies a head has no host until step 3) | Today (templates), 3 (drawn bodies) |
| Channel, bar, shared prong, eternity (all) | A | native | replaced: `gemRow` (host `ringShank` only today) | Today (templates), 3 (drawn ring bands) |
| Auto pavé with beads (all; CrossGems on NURBS, SubD and mesh [S]) | A | native | replaced: `pave` | Today |
| Cutters and seats (all; MatrixGold 3.10 [S]) | A | native | replaced: automatic at production detail | Today |
| Bails, jump rings, posts, clasps, chains | A | native | replaced: `bail`, `finding`, `chain` | Today |
| Weight, stone report, cost | A | native | replaced: HUD | Today |
| Dynamic, editable builders (MatrixGold on Grasshopper, CrossGems "100% parametric" [S]) | A | native | replaced: everything is a node | Today |
| Editable ring rails; Gem on Ring Rail; Pull to Rail (MatrixGold [S]) | A | needs work | rails fixed; eight profiles cannot reproduce the shank (cathedral −12 %), width/thickness/centre laws at the shank's stations can (4 of 5 variants exact), a split shank needs two sweeps [V] | 6 ("Make editable"), 7 (flow to rail) |
| Gem on Surface by click (MatrixGold, RhinoGold [S]) | A | native kernel; UI | by numbers only | 6 |
| Gems along a curve with graduation (all) | A | needs work | `gemRow` on bands only | 6 |
| Milgrain, beading along an edge | B | needs work | none | 6 |
| Gallery, under-gallery, piercing patterns | B | needs work | none | 6 |
| Text on ring, engraving | B | native | replaced | Today |
| Signet, relief | B | native | replaced: `relief` (flat-based, preset outlines); drawn signets by one sweep and a planar cut (step 3); relief on a drawn outline and host face (step 6) | Today |
| Manual pavé, Gem Springs relaxation (MatrixGold [S]) | B | needs work | none (per-stone edits cut in the CAD plan) | Later |
| Prong on surface, free prong rows (MatrixGold, CrossGems [S]) | B | needs work | `pave.beads` only | Later |
| Shrinkage compensation at export | B | native (uniform scale) | none | Later |
| SubD organic modeling (Clayoo in RhinoGold / RhinoArtisan [S]) | B | research for exact | none | Not planned |

Products: MatrixGold (Gemvision / Stuller); RhinoGold, now sold as RhinoArtisan [S]; Panther3D and its successor CrossGems, which reads gems made in Matrix, RhinoGold and Panther [S]; smaller tools Peacock, Logis3D ProJ (PaveTool, BezelCreator) [S], ProJewels [S].

## 5. Deliberately not planned, and why

- **BlendSrf, MatchSrf, RebuildSrf, ExtendSrf, Untrim:** no engine support for G2 blends; robustness unknown; rare in jewelry once feature rounds and edge fillets exist `[E]`.
- **Exact SubD:** neither engine has Catmull–Clark; regular quads are exact bicubic patches but extraordinary points need special patches (research). A mesh-only `subd` node over Manifold `smoothOut` + `refine` is Later (badged as a mesh).
- **QuadRemesh, sculpting, Squish, Unroll:** research; the image-to-3D route covers sculpted forms (`06-freeform.md`).
- **MergeAllFaces on named bodies:** `ShapeUpgrade_UnifySameDomain.History()` throws at runtime in this build ("unbound types: handle<BRepTools_History>") [V], so face names would be lost; Pavé keeps the unmerged faces (fused signets carry 20–25).
- **IGES:** not in the OpenCascade build [V]; STEP is the exchange format.
- **A 2D constraint solver:** Rhino has none; snaps, typed numbers and parametric shapes cover jewelry work `[E]`.
- **A Grasshopper-style node canvas:** the design document is already a node graph, and the assistant composes it through commands; a canvas would be a second editor of the same data.

## 6. Engine facts that set the ratings

| In the shipped OpenCascade build [V] | Not in the build [V] |
|---|---|
| `ThruSections`, `MakePipeShell`, `MakePipe`, `MakeFilling`, `MakeOffset`, `MakeOffsetShape`, `MakeThickSolid`, `DraftAngle`, `MakeFillet`, `MakeChamfer`, `BRepAlgoAPI_Fuse/Cut/Common/Section/Splitter`, `Sewing`, `UnifySameDomain` (its `History()` throws), `ShapeFix_Face/Solid/Wire`, `BRepCheck_Analyzer`, `GeomAPI_Interpolate`, `PointsToBSpline(Surface)`, `ProjectPointOnSurf`, `Geom_BSplineCurve/Surface`, `Geom2dAPI_InterCurveCurve`, `BRepExtrema_DistShapeShape`, `BRepGProp`, `Bnd_OBB`, HLR, `Law_*`, `BRepFeat_MakeDPrism`, STEP reader and writer; `Generated`/`Modified`/`IsDeleted` on `BRepBuilderAPI_MakeShape` and `BRepAlgoAPI_BuilderAlgo`; `BRepAlgoAPI_Fuse.SectionEdges()`; `BRepLib.EncodeRegularity`, `BRep_Tool.Continuity`; `BRepAdaptor_Surface.D1` | `BRepBuilderAPI_GTransform`, `GeomFill_Gordon/Coons/BSplineCurves`, `BRepOffsetAPI_NormalProjection`, `BRepProj`, `GeomAPI_IntCS/IntSS`, `GeomAPI_ExtremaCurveCurve`, `BRepClass3d_SolidClassifier`, `ShapeFix_Shape`, `GeomPlate`, `MakeEvolved`, `BRepFeat_SplitShape`, `Geom_OffsetCurve` (3D), `BRepTools_History`, `NurbsConvert`, IGES; present but unusable: `MakePipeShell.SetMode(auxSpine)` (throws) |

Measured on one shared core [V]: loft 33 ms; sweep1 39 ms; fillet all edges of a box 38 ms; shell 48 ms; exact booleans 137 ms; section 62.83 mm = 2π·10; splitter 2 solids; Manifold 2,000 cutters 1.6 s; `warp` 15 ms; `smoothOut` + `refine` 2 ms; `minGap` exact. Naming through an extrude, a cut and point insertion kept every provenance name (two independent spikes). rhino3dm 8.35 writes and reads back exact `NurbsCurve`, untrimmed `NurbsSurface` as `Brep` (periodic closed bands within 7.1e-15 mm, 48 ms), and planar faces trimmed by a curve; it has no join, joinBreps, merge or boolean union, so faces arrive in Rhino loose [V], and no constructor was found for general trimmed faces `[E]`.

Second spike round (2026-11-24) [V]: draft drag through a sweep mesh and a Manifold union 9.2/22.3 ms p50/p95; the exact chain (sweep B-rep and fuse) 203/347 ms; an exact shank ∪ head union 2.1 s at production and its STEP export 8.1 s; polar pattern of 12 revolved beads 3–6 ms; main-thread curve module 4.2 kB gzipped, 0.23 ms p95 per frame at 400 points; `deform{scale}` on sweep sections within 0.0001 % of the exact affine volume. Caution: replicad's `normalAt` is wrong on station-sweep B-spline faces; use a UV search and `BRepAdaptor_Surface.D1` with face orientation, or edge regularity.

Fixes worth knowing: embind overloads are `new oc.BRepAlgoAPI_Section(a, b, true)`; lists are `oc.NCollection_List_TopoDS_Shape`; use the raw `BRepFill`-style `MakeFilling`, not replicad's `makeNonPlanarFace`.

## 7. Still to prove

Spikes the brief depends on are listed in its section 5 ("Spikes before building"), with the 2026-11-24 results. Settled since the first draft [V]: two-rail Sweep2 works with closest-in-plane matching; `UnifySameDomain.History()` throws; fillets on sweep creases work to about r 0.5, and fused head-to-band seams do not fillet dependably. The ones that still change a rating here: the silhouette sweep for cathedrals; a flared extrude base as the head-to-band round; Gordon (NetworkSrf) from skinned B-spline poles; Rhino opening a .3dm of loose untrimmed faces and joining them, and opening our STEP as a solid; and the browser worker's timings.

Sources consulted (search summaries only, pages not opened) [S]: [Matrix 9 Essentials 20, Pavé tools and Gem on Surface](https://www.cadjewelleryskills.com/lesson/matrix-9-essentials-20-pave-tools-gem-on-surface/), [Introducing MatrixGold 3.10](https://blog.stuller.com/introducing-matrixgold-3-10-the-efficiency-update/), [RG vs MG 2026 tool features (PDF)](https://gemvision.com/Manuals/RG_vs_MG_2026_Tool_Features_JAN.pdf), [MatrixGold Essentials course](https://www.udemy.com/course/matrixgold-essentials-for-jewelers-video-training-course/), [CrossGems, new jewelry plugin (McNeel forum)](https://discourse.mcneel.com/t/crossgems-new-jewelry-plugin/150594), [CrossGems Pro (Novedge)](https://novedge.com/products/buy-crossgems-pro), [ProJ (food4rhino)](https://www.food4rhino.com/en/app/proj), [RhinoGold ring tutorial (Materialise)](https://i.materialise.com/blog/?p=20707), [RhinoArtisan (Novedge)](https://novedge.com/collections/jewelry-design/products/buy-rhinoartisan), [Rhino for the Jeweler](https://www.rhino3d.com/jewelry/).
