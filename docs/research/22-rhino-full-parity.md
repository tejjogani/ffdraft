# 22 — Full Rhino parity: every Rhino 8 capability (and what Rhino 9 adds), checked against the plan and the product

Research date: 2026-11-25. Scope: the complete list of Rhino's own CAD capabilities, checked row by row against the product today, the eight-step build brief ([`docs/plans/freeform-cad.md`](../plans/freeform-cad.md)) and the product's engines. Rhino 8 is the baseline inventory; Rhino 9, the version McNeel sells today, is a separate marked group. Builds on [`12-rhino-parity.md`](./12-rhino-parity.md) (the jeweler's subset and the kernel spikes), [`06-freeform.md`](./06-freeform.md), [`01-cad.md`](./01-cad.md) and [`cad-workspace.md`](../plans/cad-workspace.md). The jewelry plug-ins are topic 13's file, not this one.

**How to read the evidence.** `[V]` I opened the page this session and the claim is on it; the link is beside it. `[V d.ts]` I read the engines' shipped type files this session (replicad-opencascadejs 1.2.1 `replicad_single.d.ts`, 353 class names; rhino3dm 8.35.0 `rhino3dm.d.ts`). `[V code]` or a file path means I read that file in the repository. `[12]` was measured by research 12's spikes and not rerun here. `[S]` is a search summary only. `[E]` is my estimate; engine ratings and jeweler need are `[E]` unless marked.

## 1. The short answer

- **The size of "all of Rhino".** McNeel's Rhino 8 command list holds **1,078 command names** [V]. Grouped by what they do, they are **195 capabilities** (§3), plus 40 names that are not CAD (digitiser arms, licence, help). Rhino 9 adds 14 more groups.
- **The count today.** Of the 195: **16 are there, 58 partly, 121 not**. The eight planned steps finish **37** more and touch **19** in part. **After step 8, 142 of 195 (73 %) are still not fully covered**: 85 the plan never mentions, 33 it cuts on purpose, 5 it defers, 19 it covers in part. By jeweler's need those 142 are 14 A, 36 B, 56 C, 36 D. The plan was scoped to the jeweler's subset and does that well; it is far from all of Rhino.
- **Most of the gap is not an engine problem.** Of the 142: **74 are cheap** on today's engines, **55 are real work with known algorithms**, and only **13 need research or something the engines do not have** (SubD, QuadRemesh, flattening doubly curved surfaces, G2 surface blends, exact cage deformation, other kernels' file formats).
- **Three structural causes sit under most rows.** (1) The plan's rule "bodies are closed": Rhino's surface modeling treats an open surface as an ordinary object, so about two dozen rows wait on reversing that rule [E]. (2) The shipped OpenCascade build is a 353-class subset [V d.ts]; the missing classes (non-uniform transform, Gordon and Coons fills, curve projection, NURBS conversion, IGES, face features) exist in OpenCascade and need **our own WebAssembly build**. (3) There is no SubD engine at all.
- **Two things in the brief's "needs a new engine" list are closer than assumed.** Make2D: exact hidden-line classes are in the shipped build [V d.ts], and the production package already draws hidden-line sheets with dimensions and a title block [V code]. ShrinkWrap: the level-set re-surfacing behind it already runs inside mesh repair [V code]; it lacks a tool and controls.
- **Recommendations for the hard seven** (§5): SubD: build (own cage node; OpenSubdiv or own evaluator; patches to NURBS). QuadRemesh: adopt QuadriFlow (MIT) as a server job, after SubD. ShrinkWrap: build on what exists. Cage deformers: do differently (exact by moving surface poles, mesh otherwise). Grasshopper: do differently (graph view and formulas first; a canvas only if the founder wants it). Make2D: build on the exact classes. Worksessions: do differently (linked reference pieces).
- **Rhino moved.** Rhino 9 is the version on sale (US$995, seen 25 Nov 2026 [V]). It adds setback fillets, a new Patch, multi-face push/pull, patterns along curves, gem caustics, Grasshopper 2 and **RhinoAI, an assistant inside Rhino that works with Claude and other models** [V]. An AI assistant is no longer something Rhino lacks.
- **Parity of capability, not of interface.** Every one of the 1,078 names should resolve in the slash palette: to a verb, or to a one-line answer saying how the product does it. No toolbars, no 119 separate selection commands.
- **Cost.** Fifteen further steps (§8), very roughly 65 to 90 weeks of one build lane [E]; SubD is the largest single item.
- **Proposed to leave out, for the founder to confirm** (§6): digitiser arms, marine tools and formats, sun studies, legacy render exports, architectural drafting marks, the VBScript runtime, loading Rhino's binary plug-ins, proprietary kernel formats (SAT, Parasolid).

## 2. What was counted, and how

- **Source of names.** The [Rhino 8 command list](https://docs.mcneel.com/rhino/8/help/en-us/commandlist/command_list.htm) [V], read in two parts and de-duplicated: 1,078 names. Three look like page slips and are kept as printed (`ApplyCurves`, `SelPolysurface`, `Synchronize Views`). The mesh modifiers (Displacement and its siblings) and the object snaps are properties and toggles, not commands; they come from their own help pages [V].
- **Completeness check.** A script confirmed that every one of the 1,078 names appears in §3. 119 start with `Sel`, 27 with `Extract`, 24 with `Mesh`, 18 with `SubD`.
- **Rows.** A row is one capability a user would name ("fillet an edge", "array along a curve"). Near-identical commands share a row and are all listed. Counts in §1 and §4 were computed from the tables by script.
- **How this relates to research 12.** Research 12 counted 74 tools: the A and B rows of a jeweler's Rhino. This file counts everything, so its A and B rows are a superset and the C and D rows are new.
- **Rhino 9.** McNeel's [sales page](https://www.rhino3d.com/sales/) prices only Rhino 9 and its [download page](https://www.rhino3d.com/download/) lists Rhino 8 as an archive [V]. I could not find the release date at source. The Rhino 9 help command list was not opened, so §3.19 lists Rhino 9 by feature, not by command.
## 3. The inventory and the parity matrix

Every table has the same columns. **Today**: yes / partly / no, with the file. **Plan**: the step of `freeform-cad.md` (1–8); **Today** = already there; "part" = the step covers only some of the row; **Later** = named there as unscheduled; **Cut** = in its "Scope cuts" or "Not planned"; **—** = not mentioned. **Engine**: native / work / research / new engine, then the reason. **Need**: A–D as in research 12 (jeweler's frequency, [E]). Paths: `K/` = `packages/kernel/src/`, `S/` = `packages/schema/src/`, `UI/` = `apps/studio/src/features/cad/`, `P/` = `packages/production/src/`, `AB:` = the assistant build export. That a command exists in Rhino 8 is [V] for every name below: all come from [McNeel's Rhino 8 command list](https://docs.mcneel.com/rhino/8/help/en-us/commandlist/command_list.htm). Extra page links are given per area. Engine ratings are [E] unless marked.

### 3.1 Points and curves: creation

| ID | Capability: Rhino commands | Today | Plan | Engine: reason | Need |
|---|---|---|---|---|---|
| A1 | Point objects: Point, Points, PointGrid, ClosestPt, Divide, DivideAlongCreases, MarkFoci, DrapePt, ExtractPt | no | — | native: data and display only | C |
| A2 | Lines and polylines: Line, Lines, LineThroughPt, Polyline, InsertLineIntoCrv, CurveThroughPolyline | no | 1 | native: kernel curve module [12] | A |
| A3 | Free curves: Curve, InterpCrv, ContinueCurve, ContinueInterpCrv, CurveThroughPt | partly: `pipe.points` only (`K/features/pipe.ts`) | 1 | native: `Geom_BSplineCurve`, `GeomAPI_Interpolate` [12] | A |
| A4 | Handle and freehand curves: HandleCurve, HBar, Sketch | no | — | native: Bézier spans; freehand fitted by `GeomAPI_PointsToBSpline` | C |
| A5 | Circle, Arc, Ellipse, Rectangle, Polygon (with tangent, 3-point and around-curve options) | partly: inside features and `vectorBody.shape` (`K/features/vectorBody.ts`) | 1 | native; tangent-to-curve options need own math (`Geom2dGcc` not in the build [V d.ts]) | A |
| A6 | Special curves: Helix, Spiral, Conic, Parabola, Parabola3Pt, Hyperbola, Catenary | partly: helix inside `chain` | 1 part (Helix) | native: rational quadratics and sampled fits | D |
| A7 | Curves on a surface or mesh: InterpCrvOnSrf, PolylineOnMesh, ShortPath | no | Cut | work: UV-space curve with surface evaluation; geodesic on the mesh, then refit | C |
| A8 | Derived curves: TweenCurves, ArcBlend, Bounce | no | — | native: pole interpolation, arcs, ray reflection | C |
| A9 | Text as curves: TextObject (curve output) | partly: text goes straight to solids (`K/text.ts`) | — | native: the outlines already exist | B |

### 3.2 Curves from objects

| ID | Capability: Rhino commands | Today | Plan | Engine: reason | Need |
|---|---|---|---|---|---|
| A10 | Edge and border curves: DupEdge, DupBorder, DupFaceBorder | no | 5 | native: topology explorer | B |
| A11 | Isocurves and wireframe: ExtractIsocurve, MoveExtractedIsocurve, ExtractWireframe, ExtractControlPolygon | no | — | native: iso curves of `Geom_BSplineSurface` | C |
| A12 | Intersections and sections: Intersect, IntersectTwoSets, IntersectSelf, Section, Contour, CSec | no | 5 part (Section, Contour) | native: `BRepAlgoAPI_Section` [12]; 3D curve-to-curve extrema absent, so work | B |
| A13 | Project, Pull | no | Later | work: `BRepOffsetAPI_NormalProjection` and `BRepProj` not in the build [12]; own build, or extrude and section | B |
| A14 | Flat projections: ProjectToCPlane, Crv2View | no | — | native: math; Crv2View is the section of two extrusions | C |
| A15 | UV curves: CreateUVCrv, ApplyCrv, ApplyCurves, PointsFromUV, EvaluateUVPt, EvaluatePt | no | — | work: pcurve to 3D through `BRepAdaptor_Surface` | D |
| A16 | Outlines: Silhouette, MeshOutline | no (drawings only: `P/drawing/hlr.ts`) | — | native: `HLRBRep_Algo` is in the build [V d.ts] | C |
| A17 | Offset in a plane: Offset, OffsetMultiple | partly: internal (bezel, halo) | 2 | native: `BRepOffsetAPI_MakeOffset` [12] | A |
| A18 | Offset off the plane: OffsetCrvOnSrf, OffsetNormal, RibbonOffset | no | Cut | work: no 3D offset curve class in the build [12]; sample, offset, refit | C |
| A19 | Sub-curves: SubCrv, ExtractSubCrv, DeleteSubCrv | no | — | native: segment keys already name spans | C |

### 3.3 Curve editing

| ID | Capability: Rhino commands | Today | Plan | Engine: reason | Need |
|---|---|---|---|---|---|
| A20 | Point editing: PointsOn, PointsOff, EditPtOn, InsertControlPoint, RemoveControlPoint, InsertEditPoint, InsertKink, InsertPoint, HidePt, ShowPt, PtOffSelected, InvertPt, CullControlPolygon | no | 2 | work: interaction; the data is keyed points | A |
| A21 | Knots, weights, drag frames: InsertKnot, RemoveKnot, RemoveMultiKnot, Weight, MoveUVN, DragMode, DragStrength | no | — | native: knot and weight calls on `Geom_BSplineCurve` | C |
| A22 | Corners and radii: Fillet, Chamfer, FilletCorners, Connect, ModifyRadius | no | 2 | native in a plane; `ChFi2d` absent [V d.ts], own arcs | B |
| A23 | BlendCrv, Blend | no | 7 | work: closed-form poles from end derivatives | B |
| A24 | Match, MatchCrvDir, AlignProfiles, GCon | no | — | work: move the end poles; GCon is a reading | C |
| A25 | Rebuild and refit: Rebuild, RebuildCrvNonUniform, FitCrv, SimplifyCrv, ReducePolyline, Convert | no | 5 part (Rebuild) | native: `GeomAPI_PointsToBSpline` [12] | A |
| A26 | Structure: ChangeDegree, MakeUniform, MakePeriodic, MakeNonPeriodic, ConvertToBeziers, ConvertToSingleSpans, Reparameterize, Domain | no | — | native: B-spline degree and periodic calls; `GeomConvert` is in the build [V d.ts] | D |
| A27 | Fairing and soft edits: Fair, Smooth, SoftEditCrv, FixedLengthCrvEdit, EndBulge, MoveCrv | no | — | work: least-squares fairing; falloff-weighted pole moves | C |
| A28 | Extend, ExtendDynamic, ExtendCrvOnSrf | no | — | work: `GeomLib` is in the build, its extension calls unverified | C |
| A29 | Trim, Split (curve by curve) | no | 5 | native in a plane (`Geom2dAPI_InterCurveCurve` [12]); 3D is work | A |
| A30 | 2D booleans: CurveBoolean, PlanarUnion, PlanarDifference, PlanarIntersection | no | — | native: Manifold `CrossSection` or planar OpenCascade booleans | B |
| A31 | Join, JoinCopy, Explode, MergeCrv | no | 5 | native: `BRepBuilderAPI_MakeWire` | A |
| A32 | Direction and seam: Dir, Flip, CloseCrv, CrvSeam, CrvStart, CrvEnd, ShowDir, ShowDirOff, ShowEnds, ShowEndsOff | no | 2 | native | B |
| A33 | Symmetry (live mirror while editing) | no | 2 part (curves) | native: mirror at evaluation; on surfaces it needs open-surface bodies | A |

### 3.4 Surfaces

Rhino treats an open surface as an ordinary object. The plan does not: its decision 7 is "bodies are closed", so open surfaces exist only inside solids. Most rows below depend on reversing that (see §8, step 11).

| ID | Capability: Rhino commands | Today | Plan | Engine: reason | Need |
|---|---|---|---|---|---|
| B1 | Planes and point surfaces: PlanarSrf, Plane, CutPlane, PlaneThroughPt, InfinitePlane, SrfPt, SrfPtGrid, SrfControlPtGrid | no | 3 part (caps only) | native: `BRepBuilderAPI_MakeFace`, `GeomAPI_PointsToBSplineSurface` [V d.ts] | A |
| B2 | Straight extrusions: ExtrudeCrv, ExtrudeCrvTapered, ExtrudeSrf, ExtrudeSrfTapered, UseExtrusions, ConvertExtrusion | partly: `vectorBody` outline with bevel | 3 | native: `MakePrism`, `DraftAngle` [12] | A |
| B3 | Extrusions along a curve: ExtrudeCrvAlongCrv, ExtrudeSrfAlongCrv | partly: `pipe` | 3 | native: one-rail sweep | A |
| B4 | Other extrusions: ExtrudeCrvToPoint, ExtrudeSrfToPoint, Fin, Ribbon, Slab, Rib | no | — | native: loft to a point, offset then extrude; Fin needs surface normals | C |
| B5 | Loft (normal, loose, tight, straight sections; closed) | no | 3 | native: `ThruSections`; names need key matching [12] | A |
| B6 | DevLoft (developable) | no | — | research: no class; ruling search | D |
| B7 | Sweep1 | partly: `pipe`; shanks and prongs are sweeps inside (`K/geometry/sweep.ts`) | 3 | native: station sweep [12] | A |
| B8 | Sweep2 | partly: `ringShank` covers ring cases | 7 | work: closest-in-plane rail matching [12] | A |
| B9 | Revolve | yes: `K/features/revolve.ts` | 1 (takes drawn curves) | native: `MakeRevol` | A |
| B10 | RailRevolve | no | Cut | work: sweep with a scale law about the axis | C |
| B11 | NetworkSrf | no | Later | work: Gordon surface; `GeomFill` not in the build [V d.ts]; occ_gordon (Apache 2.0) in an own build | B |
| B12 | EdgeSrf | no | Later | work: Coons patch on B-spline poles | B |
| B13 | Patch, PatchSingleFace | no | Later | native: `BRepOffsetAPI_MakeFilling` [12] | C |
| B14 | Height surfaces: Heightfield, Drape | partly: `relief` from an image (`K/features/relief.ts`) | — | native: depth samples into `PointsToBSplineSurface` | C |
| B15 | BlendSrf, VariableBlendSrf | no | Cut | research: no G2 blend class; quintic Hermite strip from edge derivatives | B |
| B16 | MatchSrf, MergeSrf, ConnectSrf, TweenSurfaces | no | Cut | work: rewrite the first pole rows after knot refinement | C |
| B17 | Fillets between surfaces: FilletSrf, ChamferSrf, FilletSrfCrv, FilletSrfToRail | no | — | work: sew, then `BRepFilletAPI` on the shared edge; apart surfaces are research (`ChFi3d` not exposed) | C |
| B18 | Variable fillets between surfaces: VariableFilletSrf, VariableChamferSrf | no | Cut | work: `BRepFilletAPI_MakeFillet` radius laws | C |
| B19 | OffsetSrf (surface or solid) | partly: mesh hollow (`K/mesh/shell.ts`) | 5 | native on prisms; by profile on revolves and sweeps [12] | A |
| B20 | VariableOffsetSrf | no | — | research: pole displacement by a scalar field, then refit | D |
| B21 | Unroll: UnrollSrf, UnrollSrfUV | no | Cut | work: closed form for cones, cylinders, ruled faces | D |
| B22 | Flatten double curvature: Squish, SquishBack, SquishInfo, Smash, FlattenSrf | no | Cut | new engine: mesh parameterisation (LSCM or ARAP) | D |
| B23 | Split and Trim surfaces (by surface, curve or isocurve) | no | 6 part (BooleanSplit) | native by surface (`Splitter` [12]); by curve needs Project | A |
| B24 | Untrim and shrink: Untrim, UntrimAll, UntrimBorder, UntrimHoles, ShrinkTrimmedSrf, ShrinkTrimmedSrfToEdge, RefitTrim, SplitRefitSurface | no | Cut | work: face from the underlying surface; needs open-surface bodies | C |
| B25 | Surface control points: PointsOn on surfaces, SetPt, SoftEditSrf, SetSurfaceTangent, SrfSeam, CurveThroughSrfControlPt | no | — | work: a surface node that stores a keyed pole grid | C |
| B26 | Surface structure: Rebuild (surfaces), RebuildUV, FitSrf, FitCurveToSurface, MakeUniformUV | no | Cut | work: `PointsToBSplineSurface`, `GeomConvert` | C |
| B27 | ExtendSrf | no | Cut | work: `GeomLib` extension (unverified call) | C |

### 3.5 Solids

Help pages opened: [PushPull](https://docs.mcneel.com/rhino/8/help/en-us/commands/pushpull.htm) [V]; Inset, Auto CPlane and the gumball's extrude handle on [New in Rhino 8](https://www.rhino3d.com/8/new/) [V].

| ID | Capability: Rhino commands | Today | Plan | Engine: reason | Need |
|---|---|---|---|---|---|
| C1 | Primitives: Box, Sphere, Cylinder, Cone, Torus | yes: `K/features/primitive.ts` | Today | native | A |
| C2 | More primitives: TruncatedCone, Tube, Pyramid, TruncatedPyramid, Ellipsoid, Paraboloid, SphereTangentToThreeSurfaces | no | — | native: revolve, loft or extrude of a drawn profile | D |
| C3 | Pipe (round, variable radius) | yes: `K/features/pipe.ts` | 1 (takes drawn curves) | native | A |
| C4 | BooleanUnion, BooleanDifference, BooleanIntersection | yes: `K/features/boolean.ts` | 3 (on drawn bodies) | native: OpenCascade and Manifold [12] | A |
| C5 | BooleanSplit, Boolean2Objects | no | 6 | native: `BRepAlgoAPI_Splitter` [12] | B |
| C6 | Solids from surfaces: CreateSolid, CreateRegions, NonmanifoldMerge, Cap | no | 3 part (Cap) | work: `BOPAlgo_MakerVolume` not in the build [V d.ts] | C |
| C7 | FilletEdge, ChamferEdge (constant) | partly: `primitive.fillet`, `vectorBody.bevel` | 5 | native, with the validity guard [12] | A |
| C8 | Variable and blended edges: FilletEdge handles, BlendEdge | no | Cut | work for variable radius (fillet laws); research for G2 BlendEdge | C |
| C9 | Shell | partly: mesh hollow | 5 | native on prisms; by profile elsewhere [12] | B |
| C10 | Faces as objects: ExtractSrf, DeleteFaces, Join, JoinEdge, UnjoinEdge, MergeEdge, MergeAllEdges, SplitEdge, ReplaceEdge, RebuildEdges, RemoveAllNakedMicroEdges | no | — | native: `BRepBuilderAPI_Sewing` [V d.ts]; needs open-surface bodies | B |
| C11 | Move faces and edges: MoveFace, MoveEdge, MoveUntrimmedFace, MoveUntrimmedEdge, FoldFace, SplitFace | no | Cut | work on planar faces (prism plus boolean); research on curved | C |
| C12 | PushPull and the gumball's extrude/extend handles (Rhino 8) | no | Cut | work: Extrude mode is a prism plus boolean; Extend mode is MoveFace | B |
| C13 | Inset (Rhino 8) | no | — | work: offset the face boundary, split the face (`BRepFeat_SplitShape` absent [12]) | C |
| C14 | SolidPtOn (solid point editing) | no | — | work on planar-faced solids; research on curved | C |
| C15 | WireCut | no | — | native: extrude the curve, then split or cut | C |
| C16 | Holes: MakeHole, PlaceHole, RoundHole, RevolvedHole, ArrayHole, ArrayHolePolar, CopyHole, MoveHole, RotateHole, MirrorHole | no | 3 part (extrude with Cut, arrays as tools) | native | B |
| C17 | Boss | no | — | native: extrude plus union | D |
| C18 | Merge faces: MergeAllCoplanarFaces, MergeCoplanarFace, MergeFaces, Merge2MeshFaces | no | Cut | work: `UnifySameDomain` loses names in this build [12] | D |
| C19 | Solid text and engraving: TextObject (solids) | yes: `vectorBody{text}`, `K/features/engraving.ts` | Today | native | B |

### 3.6 SubD

Pages opened: [SubD features](https://www.rhino3d.com/features/subd/) [V], [ToNURBS](https://docs.mcneel.com/rhino/8/help/en-us/commands/tonurbs.htm) [V], [QuadRemesh](https://docs.mcneel.com/rhino/8/help/en-us/commands/quadremesh.htm) [V]. The plan cuts "SubD of any kind"; a mesh-only node is Later. Neither engine has Catmull–Clark surfaces [12], so every row is "new engine" until §5.1 is built.

| ID | Capability: Rhino commands | Today | Plan | Engine: reason | Need |
|---|---|---|---|---|---|
| D1 | SubD primitives: SubDBox, SubDSphere, SubDCylinder, SubDCone, SubDTruncatedCone, SubDTorus, SubDEllipsoid, SubDPlane | no | Cut | new engine: a control-cage node plus a limit-surface evaluator | B |
| D2 | SubD from curves: SubDLoft, SubDSweep1, SubDSweep2, MultiPipe, MakeSubDFriendly, SubDUnfriend, SelSubDFriendlyCrv | no | Cut | new engine; cage built from curve stations | C |
| D3 | Cage editing: ExtrudeSubD, Bevel, Bridge, InsertEdge, Stitch, Fill, SubDivide, SubDExpandEdges, SubDSpinEdge, Slide, OffsetSubD, PackSubDFaces, RepairSubD | no | Cut | new engine: half-edge cage operations (known algorithms) | B |
| D4 | Creases, with Rhino 8's weighted creases: Crease, SubDCrease, RemoveCrease, CreaseSplitting | no | Cut | new engine: crease-aware subdivision rules | B |
| D5 | Symmetry: Reflect, Radiate, RadiateFind, RemoveSymmetry | no | Cut | new engine; evaluated like curve symmetry | B |
| D6 | Conversion: ToSubD, ToNURBS, AutomaticSubDFromMesh; smooth/flat display: SubDDisplayToggle, SubDFaceEdgeVertexToggle | no | Cut | new engine: bicubic patches for regular quads, special patches at extraordinary points, sewn in OpenCascade | B |
| D7 | Loop and ring selection: SelEdgeLoop, SelEdgeRing, SelFaceLoop, SelFacesToBoundary, SelSubD, SelSubDEdges, SelClosedSubD, SelOpenSubD | no | Cut | native once a cage exists | C |

### 3.7 Meshes

Pages opened: [ShrinkWrap](https://docs.mcneel.com/rhino/8/help/en-us/commands/shrinkwrap.htm) [V], [Displacement](https://docs.mcneel.com/rhino/8/help/en-us/properties/displacement.htm) [V].

| ID | Capability: Rhino commands | Today | Plan | Engine: reason | Need |
|---|---|---|---|---|---|
| E1 | Mesh from NURBS: Mesh, ExtractRenderMesh, ExtractAnalysisMesh, SetMeshSurfaceParameters, PolygonCount | yes: `K/solid/meshing.ts` | Today | native | A |
| E2 | Mesh primitives and builders: MeshBox, MeshCone, MeshCylinder, MeshEllipsoid, MeshPlane, MeshSphere, MeshTorus, MeshTruncatedCone, MeshPolyline, PlanarMesh, 3DFace, MeshFromLines | no | — | native: Manifold constructors | D |
| E3 | Mesh from points: MeshFromPoints, MeshPatch | no | — | work: Delaunay triangulation (own code) | D |
| E4 | ReduceMesh, Smooth | yes: `K/mesh/simplify.ts`, `K/mesh/smooth.ts` (as `meshBody` fields) | Today | native: Manifold simplify, Taubin smoothing | B |
| E5 | Remesh to triangles or quads without flow: RebuildMesh, RebuildMeshNormals, TriangulateMesh, TriangulateNonPlanarQuads, TriangulateRenderMeshes, QuadrangulateMesh, AddNgonsToMesh, DeleteMeshNgons | no | — | work: own half-edge code; n-gons are display grouping | D |
| E6 | QuadRemesh | no | Cut | new engine: field-aligned quad meshing (§5.2) | C |
| E7 | Repair: MeshRepair, FillMeshHole, FillMeshHoles, UnifyMeshNormals, Weld, WeldEdge, WeldVertices, Unweld, UnweldEdge, UnweldVertex, AlignVertices, MatchMeshEdge, CullDegenerateMeshFaces, ExtractDuplicateMeshFaces, ExtractNonManifoldMeshEdges, SplitDisjointMesh | partly: automatic on import (`K/mesh/repair.ts`, `fill.ts`, `weld.ts`, `pieces.ts`), not as separate tools | — | native: the code exists; add verbs | B |
| E8 | Mesh booleans: MeshBooleanUnion, MeshBooleanDifference, MeshBooleanIntersection | yes: Manifold (`K/solid/boolean.ts`) | Today | native | B |
| E9 | Mesh cuts: MeshBooleanSplit, MeshSplit, MeshTrim, MeshIntersect, MeshSelfIntersect, SplitMeshWithCurve, SplitMeshEdge | partly: `meshBody.flatBack` | 6 part (split) | native: Manifold `split`; curves on meshes are work | C |
| E10 | Mesh face and edge editing: CollapseMeshEdge, CollapseMeshFace, CollapseMeshVertex, CollapseMeshFacesByArea, CollapseMeshFacesByAspectRatio, CollapseMeshFacesByEdgeLength, SwapMeshEdge, ExtractMeshFaces, ExtractMeshFacesByArea, ExtractMeshFacesByAspectRatio, ExtractMeshFacesByDraftAngle, ExtractMeshFacesByEdgeLength, ExtractConnectedMeshFaces, ExtractMeshPart, ExtractMeshEdges, DupMeshEdge, DupMeshHoleBoundary, ExtrudeMesh | no | — | work: a half-edge editor | D |
| E11 | OffsetMesh | partly: hollow to a wall (`K/mesh/shell.ts`) | — | native: level-set offset | C |
| E12 | ShrinkWrap (meshes, NURBS, SubD, points in; offset, edge length, smoothing, fill holes) | partly: level-set re-surfacing inside repair and hollow (`K/mesh/resurface.ts`, `K/mesh/sdf.ts`); no tool, no offset or edge-length controls | — | native: Manifold `levelSet` [12]; fine grids are slow in a browser | B |
| E13 | Mesh to NURBS: MeshToNURB, ToNURBS (mesh input) | no | — | native for face-per-facet; a fitted surface is research | D |
| E14 | Displacement and render-mesh modifiers: Displacement, Edge Softening, Shut Lining, Thickening, Curve Piping (object properties); ExtractPipedCurve, ApplyMesh, ApplyMeshUVN | partly: `relief` on a flat base | 6 part (relief on a face) | work: refine, then move along normals by a texture | C |
| E15 | Point clouds and scans: PointCloud, PointCloudContour, PointCloudSection, ReducePointCloud | no | — | work: display and sectioning only | D |

### 3.8 Transforms and the gumball

Page opened: [CageEdit](https://docs.mcneel.com/rhino/8/help/en-us/commands/cageedit.htm) [V].

| ID | Capability: Rhino commands | Today | Plan | Engine: reason | Need |
|---|---|---|---|---|---|
| F1 | Move, Copy, Rotate, Rotate3D, Scale, Mirror, Delete | partly: typed `base.transform`, `pattern{mirror}` | 4 | native: `BRepBuilderAPI_Transform` | A |
| F2 | Gumball: Gumball, GumballAlignment, GumballAutoReset, GumballDynamicRelocate, GumballRelocate, GumballReset, GumballScaleMode, GumballSettings, DragCopy | no | 4 | work: interaction | A |
| F3 | Scale1D, Scale2D, ScaleNU, ScaleByPlane, ScalePositions, Stretch | partly: `vectorBody.height`, `meshBody.height` | 7 | work: `BRepBuilderAPI_GTransform` not in the build [12]; exact on curves and sweeps, mesh otherwise | A |
| F4 | Shear | no | — | work: the same missing class; own build or pole transform | D |
| F5 | Orient, Orient3Pt, OrientOnCrv, OrientCrvToEdge, RemapCPlane | no | 4 | native: math | A |
| F6 | OrientOnSrf | partly: stones only (`gem.placement{surface}`) | 6 | native: `GeomAPI_ProjectPointOnSurf` [12] | A |
| F7 | Arrays: Array, ArrayLinear, ArrayPolar, ArrayCrv | partly: `K/features/pattern.ts` (polar, linear, mirror) | 4 | native | A |
| F8 | Arrays on surfaces: ArrayCrvOnSrf, ArraySrf | partly: `pave` for stones | — | work: frames on a surface | C |
| F9 | Align, Distribute, SetPt, BoxEdit | no | 4 | native: math | B |
| F10 | Copy and paste: CopyToClipboard, Cut, Paste, RememberCopyOptions | no | 4 | native: `cloneNodes` | A |
| F11 | Flow, Bend, Twist, Taper | no | 7 | work: exact on curves and the sweep family; Manifold `warp` otherwise [12] | A |
| F12 | FlowAlongSrf | no | Cut | work on meshes; exact needs §5.4 | B |
| F13 | Cage and free deformers: Cage, CageEdit, ReleaseFromCage, ExtractOriginalCaptives, SelCaptives, SelControls, Maelstrom, Splop | no | — | research for exact NURBS (§5.4); mesh `warp` is native | C |
| F14 | Soft moves: SoftMove, SoftTransform | no | — | work: falloff-weighted moves of points or mesh vertices | C |
| F15 | NamedPosition, ModelBasepoint | no | — | native: stored transforms | D |

### 3.9 Construction planes, snaps and modeling aids

Pages opened: [Object snaps](https://docs.mcneel.com/rhino/8/help/en-us/user_interface/object_snaps.htm) [V]; Auto CPlane on [New in Rhino 8](https://www.rhino3d.com/8/new/) [V]. **Rhino 8 has no constraint solver:** neither the command list nor the new-features page names one [V]. Its "constraints" are ortho, planar, distance and angle locks and tracking lines [E]. The "sketch-style aids" of Rhino 8 are Auto CPlane, the gumball's extrude handle and PushPull [V].

| ID | Capability: Rhino commands | Today | Plan | Engine: reason | Need |
|---|---|---|---|---|---|
| H1 | CPlane (world, view, 3-point, object, surface, curve, elevation, rotate, previous/next), MPlane, CopyCPlaneToAll, CopyCPlaneSettingsToAll, SynchronizeCPlanes, Plan | no | 2 | work: one frame per curve; attached planes [plan §1] | A |
| H2 | NamedCPlane | no | — | native: a stored list | C |
| H3 | AutoAlignCPlane (Rhino 8 Auto CPlane) | no | 5 part ("Plane to face" is explicit) | work: interaction | B |
| I1 | Simple snaps: End, Near, Point, Mid, Cen, Int, Perp, Tan, Quad, Knot, Vertex; Osnap, ShowOsnap, DisableOsnap | no | 2 part (no Knot, Vertex, Point) | work: analytic snap points in the curve module | A |
| I2 | Reference snaps: From, Between, Along, AlongParallel, PerpFrom, TanFrom, Percent | no | — | native: pure geometry | B |
| I3 | On-object snaps: OnCrv, OnSrf, OnPolysrf, OnMesh and their persistent forms; SnapToMeshes, SnapToMeshObject, SnapToSubDObject, SnapToLocked, SnapToOccluded | no | 2 part (OnCrv; surfaces from step 5) | work: BVH hits on bodies | B |
| I4 | SmartTrack, AddGuide, RemoveGuide | no | Cut | work: interaction | C |
| I5 | Ortho, OrthoAngle, SetOrtho, OrthoSnapToCPlaneZ, Planar, SetPlanar, Grid, Snap, SnapSize, SetSnap, ProjectOsnap | no | 2 | work: interaction | A |
| I6 | Typed input: coordinates, relative and polar entry, distance and angle locks, Calc, CalcRPN, DecimalPoint | partly: inspector numbers | 2 | native: `model/parse.ts` grammar | A |

### 3.10 Selection

| ID | Capability: Rhino commands | Today | Plan | Engine: reason | Need |
|---|---|---|---|---|---|
| J1 | Basic picks: Select, SelWindow, SelCrossing, SelAll, SelNone, Invert, SelLast, SelPrev, SelVisible, SelConnected | partly: single node, outliner (`UI/state/workspace.ts`) | 4 | native | A |
| J2 | Shaped picks: Lasso, SelFence, SelBrush, SelBrushPoints, SelBoundary, SelCircular, SelRectangular, SelBox, SelVolumeObject, SelVolumePipe, SelVolumeSphere | no | — | native: screen-space tests on the BVH | C |
| J3 | By object type: SelCrv, SelClosedCrv, SelOpenCrv, SelPlanarCrv, SelLine, SelPolyline, SelShortCrv, SelSelfIntersectingCrv, SelSrf, SelClosedSrf, SelOpenSrf, SelPlanarSrf, SelTrimmedSrf, SelUntrimmedSrf, SelPolysrf, SelPolysurface, SelClosedPolysrf, SelOpenPolysrf, SelExtrusion, SelMesh, SelClosedMesh, SelOpenMesh, SelPt, SelPtCloud, SelText, SelDot, SelHatch, SelLeader, SelPicture, SelLight, SelDetail, SelClippingPlane, SelClippingPlaneInViewport, SelDim, SelDimAngular, SelDimCentermark, SelDimLinear, SelDimOrdinate, SelDimOverride, SelDimRadial, SelDimTextOverride, SelBlockInstance, SelBlockInstanceNamed, SelMirroredBlocks, SelMappingWidget, SelNamedViewWidget | no | — | native: one filtered search over node kinds | C |
| J4 | By property: SelLayer, SelLayerNumber, SelColor, SelRenderColor, SelName, SelID, SelGroup, SelMaterialName, SelLinetype, SelAnnotationStyle, SelFontUse, SelKey, SelKeyValue, SelValue, SelDup, SelDupAll, SelSmall, SelBadObjects, SelNonManifold, SelObjectsWithHistory, SelChildren, SelParents | partly: outliner tree; issues select their node (`UI/hud/issues.ts`) | — | native: the same search | C |
| J5 | Sub-objects: SelectionFilter, SelectionFilterEdges, SelectionFilterFaces, SelectionFilterVertices, SelectionFilterNone, SelectionFilterEnable, SelectionFilterToggle, SelChain, SelControlPoint, SelControlPointRegion, SelU, SelV, SelUV, NextU, NextV, PrevU, PrevV, AddNextU, AddNextV, AddPrevU, AddPrevV, SelMeshEdges, SelMeshPart, SelConnectedMeshFaces, SelMeshFacesByArea, SelMeshFacesByAspectRatio, SelMeshFacesByDraftAngle, SelMeshFacesByEdgeLength, SelNakedMeshEdgePt | no | 5 part (edges, faces, points on exact bodies) | work: named sub-shapes; none on meshes | A |
| J6 | NamedSelections | no | — | native: stored `SubRef` lists | C |

### 3.11 Layers, groups, blocks, worksessions, history

Pages opened: [History](https://docs.mcneel.com/rhino/8/help/en-us/commands/history.htm) [V], [Worksession](https://docs.mcneel.com/rhino/8/help/en-us/commands/worksession.htm) [V]. Rhino's history covers about 110 named commands and breaks when a child is edited [V]; the product's design graph covers every node and cannot break.

| ID | Capability: Rhino commands | Today | Plan | Engine: reason | Need |
|---|---|---|---|---|---|
| K1 | Layers: Layer, LayerBook, ChangeLayer, ChangeToCurrentLayer, CopyToLayer, DupLayer, MatchLayer, OneLayerOn, OneLayerOff, SetLayerToObject, HighlightObjectLayers | partly: `group` and the outliner (`UI/outliner/`) | 8 | native: groups with colour and lock | A |
| K2 | LayerStateManager | no | — | native: stored visibility sets | D |
| K3 | Groups: Group, Ungroup, UngroupAll, AddToGroup, RemoveFromGroup, SetGroupName | yes: `group` node (`S/design/nodes.ts`) | Today | native | A |
| K4 | Visibility and locking: Hide, Show, ShowSelected, HideSwap, Lock, Unlock, UnlockSelected, LockSwap, Isolate, Unisolate, IsolateLock, UnisolateLock | partly: hide and show all (`UI/commands.ts`) | 8 | native | A |
| K5 | Blocks, embedded: Block, Insert, BlockManager, BlockEdit, ExplodeBlock, ReplaceBlock, CreateUniqueBlock, AddObjectsToBlock, BlockResetScale, RescueBlockOrphans, ConvertTextToBlockAttribute, AddMissingBlockAttributeKeys | partly: `pattern` copies; stones are instanced | Later | work: a component node (definition plus instances); rhino3dm has `InstanceDefinition` and `InstanceReference` [V d.ts] | B |
| K6 | Blocks, linked: ExportLinkedBlocks, CopyLinkedBlockDefinition | no | Cut | work: a reference to another piece file | C |
| K7 | Worksession, LimitReferenceModel, PurgeRefObjects | no | — | work: read-only reference pieces; a product feature, not geometry (§5.7) | D |
| K8 | Properties and user data: Properties, PropertiesPage, MatchProperties, SetObjectName, SetUserText, GetUserText, SetDocumentUserText, GetDocumentUserText, DocumentText, Hyperlink, Notes, What, List | partly: name, metal and fields in the inspector (`UI/inspector/`) | — | native: key-value fields on nodes | C |
| K9 | Files and templates: New, Open, Save, SaveAs, SaveACopy, SaveSmall, IncrementalSave, SaveAsTemplate, Revert, Autosave, Import, Export, ExportWithOrigin, Purge, Audit, Audit3dmFile, Rescue3dmFile | yes: pieces saved continuously (`UI/hud/SavePill.tsx`); the `.pave` file (`AB: packages/schema/src/files/pave.ts`) | Today | native | A |
| K10 | Undo: Undo, Redo, UndoMultiple, RedoMultiple, UndoSelected, ClearUndo | yes: design session, guarded per author (`UI/ops.ts`) | Today | native | A |
| L1 | History: History, HistoryUpdate, HistoryPurge | yes: every node is history (`K/evaluate/`) | Today | native | A |

### 3.12 Analysis

New in Rhino 8: section styles, selective clipping, clipping drawings, SectionTools built in ([New in Rhino 8](https://www.rhino3d.com/8/new/) [V]).

| ID | Capability: Rhino commands | Today | Plan | Engine: reason | Need |
|---|---|---|---|---|---|
| M1 | Measure: Distance, Length, Angle, Radius, Diameter, BoundingBox | partly: dimension chips (`UI/viewport/Dimensions.tsx`) | 8 | native: `BRepExtrema_DistShapeShape`, `Bnd_OBB` [12] | A |
| M2 | Area, Volume (and weight) | yes: `K/evaluate/report.ts`, `K/solid/occt.ts` | Today | native: `BRepGProp` | A |
| M3 | Centroids and moments: AreaCentroid, AreaMoments, VolumeCentroid, VolumeMoments | no | — | native: `GProp_GProps` is in the build [V d.ts]; meshes by tetrahedron sums | C |
| M4 | Hydrostatics, CutVolume | no | — | native but marine; see §6 | D |
| M5 | Curve checks: CurvatureGraph, CurvatureGraphOff, Curvature, CrvDeviation, ExtractCurvatureGraph | no | Cut | native: second derivatives in the curve module | B |
| M6 | Surface shading checks: CurvatureAnalysis, CurvatureAnalysisOff, Zebra, ZebraOff, EMap, EMapOff, DraftAngleAnalysis, DraftAngleAnalysisOff, DraftAnglePoint, ClearAnalysisMeshes | no | Cut | work: shaders on mesh normals; curvature from Manifold or surface derivatives [12] | B |
| M7 | ThicknessAnalysis, ThicknessAnalysisOff | partly: wall checks with markers (`K/dfm/walls.ts`, `K/dfm/wallProbe.ts`), no colour map | — | native: the probe exists; add a colour map | A |
| M8 | Edge checks: ShowEdges, ShowEdgesOff, EdgeContinuity, ZoomNaked, ZoomNonManifold, Check, CheckNewObjects, ExtractBadSrf | partly: open-mesh and validity diagnostics (`K/evaluate/diagnostics.ts`) | — | native: `BRepCheck_Analyzer`; edge continuity by `BRep_Tool.Continuity` [12] | B |
| M9 | PointDeviation | no | — | native: closest-point queries | D |
| M10 | Clash | partly: stone, metal and chain collisions (`K/dfm/stones.ts`, `K/dfm/chains.ts`) | — | native: Manifold `minGap` [12] | B |
| M11 | Clipping planes: ClippingPlane, ClippingPlaneProperties, EnableClippingPlane, DisableClippingPlane | no | — | native: three.js clip planes with stencil caps | B |
| M12 | Section styles and drawings (Rhino 8): ClippingSections, ClippingDrawings, EditClippingDrawings, UpdateClippingDrawings, ExportClippingDrawings, NestedClippingDrawing, ExportClippingSectionInfo, ExtractClippingSections, ExtractClippingSlices, ClearClippingSections, SaveClippingSectionCPlanes, SaveClippingSectionViews, ViewClippingSections | partly: one hatched section view in the production sheet (`P/drawing/section.ts`) | — | native: `BRepAlgoAPI_Section` for exact loops; mesh slicing exists | C |

### 3.13 Drafting and annotation

Page opened: [Make2D](https://docs.mcneel.com/rhino/8/help/en-us/commands/make2d.htm) [V]. The production package already draws hidden-line views with dimensions, a section, leaders and a title block, automatically and with no editing.

| ID | Capability: Rhino commands | Today | Plan | Engine: reason | Need |
|---|---|---|---|---|---|
| N1 | Dimensions: Dim, DimAligned, DimRotated, DimAngle, DimRadius, DimDiameter, DimOrdinate, DimArea, DimCurveLength, DimCreaseAngle, DimVolume, DimRecenterText, Centermark | partly: automatic only (`P/drawing/dimensions.ts`) | — | native: 2D code; rhino3dm has `DimLinear`, `DimAngular`, `DimRadial`, `DimOrdinate` [V d.ts] | B |
| N2 | Text and callouts: Text, Leader, Dot, ConvertDots, FindText, RTextEdit, RLeaderEdit, TextProperties, ScaleTextHeight | partly: automatic leader notes (`P/drawing/annotate.ts`) | — | native | C |
| N3 | Hatch, HatchBase, HatchScale | partly: section hatching | — | native | D |
| N4 | Annotation styles: DupAnnotationStyle, ImportAnnotationStyles, MatchAnnotation, SetCurrentAnnotationStyle, SetDimensionLayer, Arrowhead | partly: one fixed ISO 129-1 style | — | native | D |
| N5 | Linetypes and draw order: Linetypes, LinetypeDisplay, SetLinetype, SetLinetypeScale, SetCustomLinetype, SetLayerLinetype, ExtractLineTypeSegments, BringForward, BringToFront, SendBackward, SendToBack, ClearDrawOrder | no | — | native | D |
| N6 | Make2D (hidden lines, tangent edges, silhouettes, four-view) | partly: mesh hidden-line views (`P/drawing/hlr.ts`, `views.ts`) | Cut | native: exact `HLRBRep_Algo` and `HLRBRep_HLRToShape` are in the build [V d.ts] | B |
| N7 | Layouts and details: Layout, Layouts, LayoutProperties, CopyLayout, ImportLayout, Detail, CopyDetailToViewport, CopyViewportToDetail, ChangeSpace, HideInDetail, ShowInDetail, ShowSelectedInDetail, HideLayersInDetail, ShowLayersInDetail; title blocks | partly: one fixed sheet with title block (`P/drawing/sheet.ts`) | — | work: an editable sheet model | C |
| N8 | Print and capture: Print, PrintDisplay, ViewCaptureToFile, ViewCaptureToClipboard, ScreenCaptureToFile, ScreenCaptureToClipboard | partly: PDF spec sheet (`P/pdf/`), view capture (`UI/capture-tool.ts`) | — | native | B |
| N9 | Reference images: Picture, BackgroundBitmap | partly: reference window (`AB: apps/studio/src/features/references`) | — | native | A |
| N10 | RevCloud | no | — | native; architectural mark-up | D |

### 3.14 Display, rendering, views

New in Rhino 8: Monochrome mode, the UV Editor, procedural textures, updated Cycles with caustics and dispersion, more gem presets [V, new-features page]. Mode names other than Monochrome are [E].

| ID | Capability: Rhino commands | Today | Plan | Engine: reason | Need |
|---|---|---|---|---|---|
| O1 | Display modes (Wireframe, Shaded, Rendered, Ghosted, X-Ray, Technical, Artistic, Pen, Arctic, Raytraced, Monochrome): SetDisplayMode, Shade, ShadeSelected, FlatShade, RenderArctic, DisplayProperties | partly: rendered, clay, technical, x-ray (`UI/commands.ts`) | — | native: three.js materials | A |
| O2 | Per-object display: SetObjectDisplayMode, ClearAllObjectDisplayModes, ShowRenderMesh, HideRenderMesh, ToggleRenderMesh, RefreshShade, ClearAllMeshes | no | — | native | D |
| O3 | Viewport layout: 4View, 3View, OneView, MaxViewport, Maximize, SetMaximizedViewport, NewViewport, NewFloatingViewport, ToggleFloatingViewport, CloseViewport, SplitViewportHorizontal, SplitViewportVertical, ViewportTabs, ViewportProperties, SetActiveViewport, NextViewport, PrevViewport, NextOrthoViewport, NextPerspectiveViewport, NextViewportToTop, BringViewportToTop, PushViewportToBack, LockViewport, ReadViewportsFromFile, Synchronize Views | partly: one viewport | 2 part (two-up; four-up is Cut) | work: more cameras over one scene | A |
| O4 | Navigation and cameras: Zoom, ZoomLens, ZoomEnds, Zoom1To1Calibrate, Pan, RotateView, RotateCamera, TiltView, DollyZoom, WalkAbout, Camera, PerspectiveAngle, PerspectiveMatch, Isometric, SetView, SwapView, UndoView, RedoView, GradientView, Fullscreen, SetZoomExtentsBorder, SetViewFocusDistance, MoveTargetToObjects, OrientCameraToSrf, ShowZBuffer | partly: orbit, pan, zoom, fit, four presets (`UI/commands.ts`) | — | native | A |
| O5 | NamedView | partly: render shots keep cameras (`AB: packages/render/src/shot-history.ts`) | Cut | native | B |
| O6 | Snapshots | no | — | native: stored view, visibility and material sets | D |
| O7 | Materials and libraries: Materials, Textures, Environments, Libraries, RenderAssignMaterialToObjects, RenderAssignMaterialToLayer, RenderAssignMaterialToLayersOfObjects, RenderMergeIdenticalMaterials, SynchronizeRenderColors, AssignBlankTexture, DownloadLibraryTextures, RefreshAllTextures, ExportBitmaps, ContentFilter | partly: metals and gems only (`AB: packages/render/src/materials/`) | — | work: user materials in three.js and Blender | B |
| O8 | Texture mapping: ApplyBoxMapping, ApplyPlanarMapping, ApplyCylindricalMapping, ApplySphericalMapping, ApplySurfaceMapping, ApplyCustomMapping, ApplyOcsMapping, MappingWidget, MappingWidgetOff, MatchMapping, RemoveMappingChannel, BakeMapping, ExtractCustomMappingObject, Unwrap, UVEditor, ExtractUVMesh, PackTextures, UnpackTextures; decals | no | — | work: projections are math; unwrap needs an atlas library | D |
| O9 | Vertex and face colours: ComputeVertexColors, SetPerFaceColorByFacePack, RemovePerFaceColors | no | — | native | D |
| O10 | Lights, sun, ground: Lights, PointLight, Spotlight, DirectionalLight, RectangularLight, LinearLight, Sun, GroundPlane, EditLightByHighlight, EditLightByLooking, SetSpotlightToView, SetViewToSpotlight | partly: curated light rigs and ground (`AB: packages/render/src/looks.ts`, `rig.ts`, `ground.ts`) | — | native in Blender | C |
| O11 | Rendering: Render, RenderWindow, RenderInWindow, RenderPreview, RenderPreviewInWindow, RenderPreviewWindow, RenderBlowup, Rendering, SetCurrentRenderPlugIn, BatchRenderNamedViews, SaveRenderWindowAs, CloseRenderWindow, CopyRenderWindowToClipboard, RenderOpenLastRendering, RenderOpenRenderImage, RenderReportImageFiles, RenderReportMissingImageFiles | yes: Blender Cycles worker (`workers/render`), Render stage (`AB: apps/studio/src/features/render`) | Today | native (separate GPL program) | A |
| O12 | Animation: Turntable, SetTurntableAnimation, SetPathAnimation, SetFlythroughAnimation, RecordAnimation, PlayAnimation, ViewFirstFrame, ViewLastFrame, ViewNextFrame, ViewPreviousFrame, ViewFrameNumber | partly: turntable and orbit arcs (`AB: packages/render/src/animation.ts`) | — | native in Blender | B |
| O13 | Sun studies and site: SetOneDaySunAnimation, SetSeasonalSunAnimation, EarthAnchorPoint | no | — | native; architectural, see §6 | D |

### 3.15 File input and output

McNeel's own list has 56 format rows ([File formats](https://www.rhino3d.com/features/file-formats/) [V]). The product opens STL, OBJ, GLB, 3MF, PLY, SVG and images (`UI/empty/importers.ts`) and saves GLB, STL, 3MF, OBJ, STEP and 3DM (`K/export/index.ts`).

| ID | Capability: formats in McNeel's list (open / save) | Today | Plan | Engine: reason | Need |
|---|---|---|---|---|---|
| P1 | 3DM save (.3dm; also .3dmbak, .rws on Windows) | partly: meshes, curves, layers (`K/export/rhino3dm.ts`) | 8 part (exact curves, loose faces; no joined solids) | work: rhino3dm cannot join or build general trimmed faces [12] | A |
| P2 | 3DM open | no | Cut | work: rhino3dm reads curves, surfaces, B-reps, meshes, blocks, layers [V d.ts]; rebuild them in OpenCascade | A |
| P3 | STEP save (.stp, .step) | yes: `K/export/step.ts` | Today | native [12] | A |
| P4 | STEP open | no | 8 | native: reader in the build [12] | B |
| P5 | IGES open and save (.igs, .iges); VDA (.vda) | no | Cut | work: `IGESControl` exists in OpenCascade, not in this build [12]; VDA has no reader | D |
| P6 | Mesh formats: STL, OBJ, 3MF, PLY, glTF/GLB (open and save) | yes: `K/export/`, `K/mesh/parse/` (PLY open only) | Today | native | A |
| P7 | More mesh and scene formats: AMF, 3DS, FBX, DAE (save), USD/USDZ (save), LWO, DirectX .x, VRML/Inventor, X3D (save), SketchUp, OFF (open), GTS, RAW, ZPR, SLC | no | — | work: writers for USD, AMF, OFF, RAW, SLC are simple; FBX, SKP, 3DS, LWO, ZPR need outside libraries | D |
| P8 | 2D vector: DWG, DXF, AI, PDF, SVG (open and save); EPS (open); EMF, WMF (save) | partly: SVG open; SVG and PDF sheets saved (`P/drawing/`, `P/pdf/`) | — | work: DXF and SVG own code; DWG needs a library (GPL or commercial) [E] | B |
| P9 | Other kernels: ACIS .sat (save), Parasolid .x_t (save), SOLIDWORKS .sldprt/.sldasm (open), MicroStation .dgn (open) | no | — | new engine: proprietary formats; STEP is the route | C |
| P10 | Points and scans: .asc, .csv, .xyz, .pts, .txt, .cgo_ascii, E57, NextEngine .scn, Recon .m | no | — | native for text formats; E57 needs a library | D |
| P11 | Niche and legacy: GHS .gf/.gft/.pm, WAMIT .gdf, KMZ, POV-Ray, RenderMan .rib, Moray .udo, Cult3D .cd, XGL, XAML, embroidery .dst/.exp, object properties .csv | partly: stone list and BOM as CSV (`P/csv.ts`) | — | native where text; see §6 | D |

### 3.16 Units and tolerances

Rhino stores model units, layout units, absolute and angle tolerance and custom units per document; default mm and 0.01 mm ([Units](https://docs.mcneel.com/rhino/8/help/en-us/documentproperties/units.htm) [V]).

| ID | Capability | Today | Plan | Engine: reason | Need |
|---|---|---|---|---|---|
| Q1 | Model units (mm, cm, m, in, ft, custom) with scaling on change: DocumentProperties, DocumentPropertiesPage | partly: mm model; inches shown on drawings (`P/format.ts`) | — | native: display conversion; keep mm inside | B |
| Q2 | Absolute and angle tolerance per document; StepUnitsAndTolerance | no: fixed inside the kernel (`K/solid/solid.ts`) | — | native: OpenCascade takes tolerances per operation | C |

### 3.17 Scripting and extensibility

Pages opened: [Scripting guides](https://developer.rhino3d.com/guides/scripting/) [V], [Compute](https://developer.rhino3d.com/guides/compute/) [V], [Rhino.Inside](https://www.rhino3d.com/features/rhino-inside/) [V]. Rhino 8 added the Script Editor, CPython and .NET 7 [V, new-features page].

| ID | Capability: Rhino commands | Today | Plan | Engine: reason | Need |
|---|---|---|---|---|---|
| R1 | Grasshopper: Grasshopper, GrasshopperPlayer, Bake, GrasshopperFolders, GrasshopperPluginList, GrasshopperIgnorePlugin, GrasshopperLoadOneByOne, GrasshopperDeveloperSettings, GrasshopperGetSDKDocumentation | no (the design is a node graph, but has no canvas, expressions or lists) | Cut | work: interface over the existing graph (§5.5) | B |
| R2 | Scripts: ScriptEditor, RunPythonScript, EditPythonScript, RunScript, EditScript, LoadScript | partly: JSON commands the assistant calls (`S/api/commands.ts`); MCP for outside agents is planned, not built | 1 part (`design.run`) | work: a sandboxed script runner over the verb registry | C |
| R3 | Command line and macros: Commands, CommandList, CommandHistory, CommandPrompt, Repeat, MacroEditor, Macros, ReadCommandFile, Run, Pause, MultiPause, Enter, EnterEnd, Cancel, Echo, NoEcho, SetRedrawOff, SetRedrawOn, aliases and shortcuts | partly: ⌘K palette (`UI/commands.ts`, `UI/quick-commands.ts`) | 2 part (command bar, aliases, repeat; no macros) | native: recorded verb sequences | A |
| R4 | SDKs and plug-ins: RhinoCommon, C++ SDK, openNURBS, PlugInManager, PackageManager, MigratePlugins | partly: schema and command registry; MCP planned | — | work: a public verb and node API; Rhino's binary plug-ins cannot load (§6) | C |
| R5 | Interface customising: Toolbar, ToolbarLock, ShowToolbar, PopupToolbar, PopupMenu, PopupPopular, Menus, ExportRuiFile, WindowLayout, SaveWindowLayout, Containers, ToggleLeftSidebar, ToggleRightSidebar, Options, OptionsPage, OptionsExport, OptionsImport, AcadSchemes | partly: settings and pinnable palettes (plan step 2) | 2 part | native; see §6 | D |

### 3.18 Platform, licence and price (not counted)

| | Rhino | The product |
|---|---|---|
| Desktop | Windows 10/11 (Intel, AMD), macOS 12.4 or later; no Linux or iPad ([requirements](https://www.rhino3d.com/8/system-requirements/) [V]) | Browser studio and a local server, any desktop OS |
| Embedded and headless | Rhino.Inside in 64-bit Windows hosts [V]; Rhino Compute, a REST API on Windows servers (Linux with Rhino 9), $0.10 per core per hour of uptime ([billing](https://developer.rhino3d.com/guides/compute/core-hour-billing/) [V]) | The server kernel; MCP planned |
| File library | openNURBS reads and writes .3dm with no copyleft ([openNURBS](https://www.rhino3d.com/features/developer/opennurbs/) [V]); rhino3dm wraps it | Uses rhino3dm 8.35 |
| Price, seen 25 Nov 2026 | Only Rhino 9 is priced: US$995 full; upgrade US$595, US$395 until 1 Mar 2027; student US$195; perpetual, no maintenance fee ([sales](https://www.rhino3d.com/sales/) [V]). Rhino 8 is an archive download ([download](https://www.rhino3d.com/download/) [V]) | CAD free; renders and .3dm/STEP exports paid |

### 3.19 New in Rhino 9 (counted separately)

Rhino 9 is the version on sale; Rhino 8 stays the baseline above because plug-ins and the trade still name it [E]. Every row is from [New in Rhino 9](https://www.rhino3d.com/9/new/) [V]; the page names few commands, so rows are described by function.

| ID | Capability (Rhino 9) | Today | Plan | Engine: reason | Need |
|---|---|---|---|---|---|
| Z1 | Patch rewritten: untrimmed fills matched to neighbours, MultiBlend for holes with five or more sides | no | Later | work to research: `MakeFilling` with edge constraints; n-sided splitting | B |
| Z2 | FilletEdge with setbacks where several fillets meet; surface fillets that run across tangent faces | no | — | research: OpenCascade has no setback corner [E] | B |
| Z3 | Control points moved along U, V or N, with falloff; point reduction within a tolerance | no | — | work: same surface node as B25 | C |
| Z4 | Surface analysis with stripes, dots or colours; continuity check across all edges (G0, G1, G2) | no | Cut | work: shaders; edge sampling | B |
| Z5 | Multi-face push/pull, inset of adjacent faces as one region, angle change with neighbours kept attached | no | Cut | work on planar faces; research on curved | B |
| Z6 | SubD and mesh: match SubD edges to surface edges, inflate a closed curve into a soft body, cut new edges by drawing lines, falloff moves | no | Cut | new engine (SubD); inflate is native as a mesh | B |
| Z7 | Repeat objects along a curve with in-view handles for spacing, scale and turn; random or graded per-object scale | no | 4 part (`pattern` along a curve) | native | A |
| Z8 | Gem rendering: light focused and split through stones, coloured transparency in Rendered mode, more gem materials, decals with full materials | partly: Blender Cycles gems (`AB: packages/render/src/materials/gems.ts`) | — | native in Blender; in-view refraction is topic 15's renderer | A |
| Z9 | Drafting: drawings that update from the model, non-rectangular details, reusable section styles, GD&T, custom hatches, layout to DWG, 2D block library, single-stroke walls | partly: automatic sheets | — | work; mostly architectural | D |
| Z10 | Worksession panel on Mac and Windows, nested block edit in place, comments and redlines, layout groups, file-size map | no | — | work: product features | C |
| Z11 | Grasshopper 2 (rewrite, parallel and cancellable solves, loops, metadata) and Grasshopper 1 additions | no | Cut | work: see §5.5 | C |
| Z12 | RhinoAI: an assistant tied to the open Rhino and Grasshopper document; works with Claude, Codex, other assistants or local models, limited to tools the user allows | yes: the assistant with approvals (`AB: packages/agent`) | Today | native | A |
| Z13 | Interface: new icons, one command line on both systems, single-key commands, shared workspaces | partly | 2 part | native; see §6 | D |
| Z14 | Platform: Direct3D display (Windows on ARM, Parallels, VMware), C++ SDK on Mac, Compute on Linux, CPython 3.13, .NET 10 | partly: runs in any browser | — | native | D |

### 3.20 Command names not counted as CAD capability

Listed so that every name on McNeel's page is accounted for. None needs a geometry engine.

- **Digitiser arms (§6: leave out):** DigBeep, DigCalibrate, DigCamera, DigClick, DigDisconnect, Digitize, DigLine, DigPause, DigScale, DigSection, DigSketch.
- **Licence, account, help, system:** About, Login, Logout, CheckInLicense, CheckOutLicense, Help, CommandHelp, Tutorials, Notifications, SystemInfo, WebBrowser, OpenURL, GetIssueState, Alerter, Exit, FileExplorer, SetWorkingFolder, ResetMessageBoxes, Reset, Restore, Elmo.
- **Minimise and window chrome:** Minimize, DisplayCommandPrompt.
- **Import settings and marine links:** IgesImportOptions, IGESStudy, ReadEveryIGESEntity, SetIgesLayerLevelMap, STEPTree, AttachGHSData.

## 4. The honest count and the gap list

| | Rows | Share |
|---|---|---|
| Rhino 8 capabilities (from 1,078 command names) | 195 | 100 % |
| In the product today: yes | 16 | 8 % |
| In the product today: partly | 58 | 30 % |
| Finished by plan steps 1–8 (beyond the 16) | 37 | 19 % |
| Still open after step 8 | 142 | 73 % |
| of which: touched in part by a step / Later / Cut / never mentioned | 19 / 5 / 33 / 85 | |
| of which by engine: native / work / research / new engine | 74 / 55 / 4 / 9 | |
| of which by need: A / B / C / D | 14 / 36 / 56 / 36 | |
| Rhino 9 groups: total / there / open | 14 / 1 / 13 | |

The 14 open A rows are mostly finishing work on things the plan starts: Rebuild's siblings (A25), symmetry beyond curves (A33), planar surfaces as objects (B1), trim by curve (B23), sub-object selection on meshes (J5), snaps (I1), thickness colour map (M7), reference images (N9), display modes (O1), four viewports and navigation (O3, O4), macros (R3), and full .3dm in both directions (P1, P2).

### Tier 1: cheap on the current engines (74 rows)

Each is a verb, a stored list or a shader over code that exists.

- **Curves (15):** A1 point objects, A4 handle and freehand curves, A6 conics and spirals, A8, A9 text as curves, A11 isocurves, A12 general Intersect, A14, A16 silhouettes, A19, A21 knots and weights, A25 refit family, A26, A30 2D booleans, A33 symmetry.
- **Surfaces and solids (10):** B1 planes and point-grid surfaces, B4, B13 Patch, B14 Drape, B23 split by surface, C2, C10 sewing and face extraction (once open surfaces exist), C15 WireCut, C16 holes, C17.
- **SubD and meshes (7):** D7 (once a cage exists), E2, E7 repair tools as verbs, E9, E11, E12 ShrinkWrap as a tool, E13.
- **Aids, selection, organisation (9):** F15, H2 named CPlanes, I2 reference snaps, J2 lasso and brush, J3 and J4 as one selection search, J6 named selections, K2, K8 user text.
- **Analysis (9):** M3 centroids and moments (`GProp_GProps`), M4, M5 curvature graph, M7 thickness colour map, M8 naked edges and edge continuity, M9, M10 general Clash, M11 clipping planes, M12 section styles.
- **Drafting and display (18):** N1–N5 user-placed dimensions, text, hatches, styles, linetypes; N6 exact Make2D; N8, N9, N10; O1, O2 display modes; O4; O5, O6 named views and snapshots; O9; O10, O12, O13 through Blender.
- **Files, units, commands (6):** P10, P11, Q1, Q2, R3 macros, R5.

### Tier 2: real work, known algorithms (55 rows)

| Gap (rows) | Algorithm or OpenCascade class | Needs own build? |
|---|---|---|
| Open-surface bodies; Untrim, shrink, CreateSolid (B24, C6, and the base for C10) | `TopoDS_Shell` bodies, `BRepBuilderAPI_Sewing` (in build); `BOPAlgo_MakerVolume` | partly |
| NetworkSrf, EdgeSrf (B11, B12) | Gordon surface (occ_gordon, Apache 2.0, from TiGL [V](https://github.com/rainman110/occ_gordon)); Coons patch or `GeomFill_BSplineCurves` | yes |
| Project, Pull, offsets and curves on surfaces, UV curves (A13, A18, A7, A15) | `BRepOffsetAPI_NormalProjection`, `BRepProj_Projection`, pcurves | yes |
| RailRevolve (B10) | sweep with a scale law (`Law_*` is in the build) | no |
| Match, Fair, Extend, soft edits (A24, A27, A28, B16, B27) | end-pole rewriting; least-squares fairing; `GeomLib` extension | no |
| Surface points and structure (B25, B26) | a surface node with a keyed pole grid; `GeomAPI_PointsToBSplineSurface` | no |
| Fillets between surfaces, variable radius (B17, B18, C8) | `BRepFilletAPI_MakeFillet` with radius laws after sewing | no |
| Exact non-uniform scale and shear (F4, and all of F3) | `BRepBuilderAPI_GTransform` | yes |
| FlowAlongSrf, soft moves, arrays on surfaces (F12, F14, F8) | pole-space deformation (§5.4); surface frames | yes (`BRepBuilderAPI_NurbsConvert`) |
| MoveFace, PushPull, Inset, solid points, merge faces (C11–C14, C18) | prism plus boolean on planar faces; `BRepFeat_SplitShape`, `LocOpe`, `BRepTools_ReShape` | yes |
| Unroll developable faces (B21) | closed form for cylinders, cones, ruled faces | no |
| Mesh editing, mesh from points, remesh, point clouds, displacement (E3, E5, E10, E14, E15) | half-edge structure; Delaunay; refine and displace | no |
| Auto CPlane, SmartTrack, snaps on bodies and meshes, sub-objects on meshes (H3, I1, I3, I4, J5) | interaction over the BVH | no |
| Blocks, linked blocks, reference pieces (K5, K6, K7) | component node; rhino3dm `InstanceDefinition` | no |
| Analysis shaders (M6) | zebra, environment map, draft and curvature shading | no |
| Layouts and details (N7) | editable sheet model over the production drawing code | no |
| Viewports, user materials, texture mapping (O3, O7, O8) | more cameras; material editor; projections and an atlas library | no |
| Full .3dm both ways, IGES, DXF and more formats (P1, P2, P5, P7, P8) | rebuild rhino3dm geometry in OpenCascade; `IGESControl`; own DXF writer | IGES: yes |
| Grasshopper-class graph, scripts, API (R1, R2, R4) | §5.5 | no |

**The own OpenCascade build is the shared precondition.** opencascade.js builds from a YAML list of classes in a Docker image and can include extra C++ [V](https://ocjs.org/docs/app-dev-workflow/custom-builds). replicad's build is such a list [E; its repository page would not open]. Cost [E]: one to two weeks including CI, plus a larger download. Risk to measure first: memory and start-up time on the 2023 MacBook Air.

### Tier 3: research or a new engine (13 rows)

D1–D6 (SubD), E6 (QuadRemesh), F13 (CageEdit, Maelstrom, Splop): see §5. The rest, briefly: **B22 Squish and Smash** need mesh parameterisation; libigl's core is MPL2 and has it, but its `copyleft/` modules must stay out ([licence](https://libigl.github.io/license/) [V]); defer (need D). **B15 BlendSrf** is worth a research spike in step 13, since Rhino jewelers use it. **B6 DevLoft** and **B20 VariableOffsetSrf**: defer. **P9** (SAT, Parasolid, SolidWorks, DGN): leave out (§6).

## 5. The hard seven: options and recommendations

### 5.1 True SubD, with limit surfaces and SubD to NURBS

Rhino's SubD is a Catmull–Clark cage with creases; `ToNURBS` packs quad grids into NURBS and offers G0 to G2 choices at extraordinary vertices, each with a stated trade-off [V](https://docs.mcneel.com/rhino/8/help/en-us/commands/tonurbs.htm).

| Option | Licence | Fit |
|---|---|---|
| OpenSubdiv (Pixar) | Apache-2.0-based [E; the licence file would not open]; C++17, no core dependencies [V](https://github.com/PixarAnimationStudios/OpenSubdiv) | Best evaluator. Its patch tables give bicubic patches for regular faces and special patches near extraordinary vertices [S]. Needs a WebAssembly build [E]. |
| Own Catmull–Clark with creases | ours | A few hundred lines for the limit mesh [E]. Exact patches at extraordinary vertices are the hard part. |
| openNURBS `ON_SubD` | no copyleft [V](https://www.rhino3d.com/features/developer/opennurbs/) | Would match Rhino exactly and write real SubD objects to .3dm. rhino3dm exposes only `subdivide`, `isSolid` and cache calls [V d.ts]; whether the public source converts SubD to NURBS is **not verified**. Needs a spike and our own openNURBS build. |
| Manifold `smoothOut` + `refine` | Apache 2.0 [V](https://github.com/elalish/manifold) | In the stack, but not Catmull–Clark: a cage would not match Rhino's shape. |

**Recommendation: build, in two stages.** Stage 1: a `subd` cage node (keyed vertices, faces, crease weights, symmetry), cage tools, limit mesh; castable, weighable, STL-ready, badged as a mesh. Stage 2: exact patches sewn in OpenCascade for STEP and .3dm, with the same continuity choices Rhino offers. Spike first: OpenSubdiv in WebAssembly against our own evaluator, and the openNURBS question.

### 5.2 QuadRemesh

Rhino's tool takes surfaces, meshes or SubDs and has target count, adaptivity, symmetry and guide curves [V](https://docs.mcneel.com/rhino/8/help/en-us/commands/quadremesh.htm).

| Option | Licence | Fit |
|---|---|---|
| QuadriFlow | MIT; Eigen's LGPL parts avoidable with `BUILD_FREE_LICENSE` [V](https://github.com/hjwdzh/QuadriFlow) | Pure quads from a manifold triangle mesh; sharp-edge option; not guaranteed watertight without its SAT step (Unix only) [V]. |
| Instant Meshes | BSD-3-style with an added enhancements clause [V](https://github.com/wjakob/instant-meshes/blob/master/LICENSE.txt) | Fast; output is quad-dominant, not pure quads [E]. |
| QuadWild with Bi-MDF | GPL-3.0 [V](https://github.com/cgg-bern/quadwild-bimdf) | Best feature alignment [E]; cannot run in-process. |
| Blender's QuadriFlow remesh | GPL, already a separate program here | Usable through the render worker [E]; ties a CAD tool to Blender being installed. |

**Recommendation: adopt QuadriFlow as a native server job, after SubD stage 1.** Quad remeshing mainly feeds mesh-to-SubD. Not in the browser; no guide curves at first.

### 5.3 ShrinkWrap

Rhino's version wraps NURBS, SubD, meshes and points, with edge length, offset, smoothing and hole filling [V](https://docs.mcneel.com/rhino/8/help/en-us/commands/shrinkwrap.htm). The product's `mesh/resurface.ts` already rebuilds a surface as a level set of a sampled distance field [V code].

| Option | Licence | Fit |
|---|---|---|
| Existing distance grid + Manifold `levelSet` | Apache 2.0 | In the stack; resolution limited by grid memory. |
| OpenVDB | Apache 2.0 since relicensing [V](https://github.com/AcademySoftwareFoundation/openvdb) | Sparse grids for fine detail; no WebAssembly build documented [V]; server only. |
| CGAL 3D Alpha Wrapping | GPL, or a commercial licence from GeometryFactory [V](https://www.cgal.org/license.html) | Strict enclosure guarantee [V](https://doc.cgal.org/latest/Alpha_wrap_3/index.html); not usable in-process without paying. |

**Recommendation: build on what exists.** Add a `shrinkWrap` tool with offset, target edge length (grid step), smoothing and inflate-points, with fine grids as a server job. Look at OpenVDB only if the grid proves too coarse at 0.05 mm.

### 5.4 Cage and free deformations on NURBS

Rhino's CageEdit works on curves, surfaces and meshes, and with `PreserveStructure=No` it refits objects with more control points [V](https://docs.mcneel.com/rhino/8/help/en-us/commands/cageedit.htm). So Rhino itself approximates. No open library does this on B-reps [E].

**Recommendation: do it differently, in three grades.** Exact for curves and the sweep family (the plan's step 7). For other exact bodies: convert faces to NURBS, refine knots, move the poles through the deformation, rebuild edge curves; the trims live in parameter space, so topology survives [E]. This needs `BRepBuilderAPI_NurbsConvert` in the own build and a spike on validity. Manifold `warp` with the mesh badge for the rest. The cage itself is a trivariate free-form lattice (Sederberg and Parry) [E].

### 5.5 Grasshopper-class visual programming

The design is already a node graph that the assistant composes. What Grasshopper adds is a canvas, numeric expressions, lists and data trees, and a plug-in ecosystem. Rhino 9 ships Grasshopper 2 beside RhinoAI [V].

| Option | Notes |
|---|---|
| Graph view of the design (read, rewire, no new semantics) | React Flow is MIT [V](https://github.com/xyflow/xyflow). Small. |
| Formulas in fields (`width = size * 0.12`), named variables, list patterns | Schema work; gives most of the parametric power a jeweler uses [E]. |
| Full editable canvas with list and tree nodes | A second editor of the same data; large. |
| Run a customer's `.gh` file on Rhino Compute | $0.10 per core-hour [V]; terms for a competing product not verified. |

**Recommendation: do it differently.** Graph view and formulas first; the assistant stays the main way to compose. A full canvas is a founder decision.

### 5.6 Make2D hidden-line drawings

`HLRBRep_Algo` and `HLRBRep_HLRToShape` are in the shipped build [V d.ts], and replicad's projection wrapper worked in research 12 [12]. The production package draws mesh-based hidden-line views, a hatched section, ISO-style dimensions and a title block (`P/drawing/`) [V code]. **Recommendation: build.** One "Drawing" verb with Make2D's options (four-view, hidden lines, tangent edges, silhouettes [V](https://docs.mcneel.com/rhino/8/help/en-us/commands/make2d.htm)), exact lines for exact bodies, mesh lines otherwise, output as curves on a sheet and as SVG, PDF, DXF.

### 5.7 Worksessions

A worksession attaches other files as read-only reference geometry; the list lives in a private `.rws` file [V](https://docs.mcneel.com/rhino/8/help/en-us/commands/worksession.htm), which McNeel's format list marks Windows only [V]; Rhino 9 brings the panel to the Mac [V]. It exists because Rhino files are single-writer. **Recommendation: do it differently.** Linked reference pieces inside a project (visible, snappable, not editable, updated when the source changes), which also gives linked blocks. Hosted multi-user editing later replaces the need.

### 5.8 Rhino itself as a fallback engine

Rhino Compute exposes Rhino's geometry and Grasshopper over REST [V]. It would cover every Tier 3 row at once, and could check our output in CI (§7). Against it: a paid, online dependency on a competitor, for a product that must run on a laptop; McNeel's terms for a competing CAD are not verified. **Recommendation: not in the product. Consider it only as a test oracle.**

## 6. Where "all of Rhino" should be literal, and where not

**Literal:** the geometry capability of every row; Rhino's command names as aliases; units and tolerances; what a .3dm carries in both directions (curves, surfaces, solids, meshes, layers, blocks, annotations, named views: rhino3dm has classes for all of these [V d.ts]).

**Not literal:**

| Rhino as-is | Why it would hurt a calm product | Offer instead |
|---|---|---|
| 1,078 commands across dozens of toolbars | hundreds of icons | Slash palette with every Rhino name as an alias; seven-button tool rail; context bar |
| Command-line option lists | long, modal, easy to miss | At most three option chips, the rest under `⋯` (plan §1) |
| 119 `Sel…` commands | a command per filter | One selection search: "open curves on layer Stones" typed or asked |
| A command per near-variant (ten hole commands, eight mesh primitives) | noise | One verb with a shape or mode field |
| Paired on/off commands (`ZebraOff`, `PointsOff`) | doubles the list | Toggles |
| Four viewports by default | crowds a laptop screen | One view, two-up, four-up on request |
| History that silently breaks | surprises | The graph never breaks; "Detach" is explicit |

An unknown or unsupported Rhino name typed in the palette should never dead-end: it either runs the product's verb or hands the name to the assistant, which explains or does the job through `design.run`.

**Proposed to leave out. Each is the founder's decision, not a silent cut:**

| Feature | Reason |
|---|---|
| Digitiser commands (11 `Dig…`) | drive measuring arms; no browser access to that hardware |
| Hydrostatics, GHS and WAMIT formats | ship design |
| Sun studies, EarthAnchorPoint, KMZ | architecture |
| RevCloud, reflected ceiling plans, wall tools (Rhino 9) | architectural drafting |
| POV-Ray, RenderMan, Moray, Cult3D, XGL, XAML, embroidery | legacy or unrelated formats |
| ACIS, Parasolid, SolidWorks, DGN | proprietary kernels; STEP carries the geometry |
| DWG | needs a GPL or commercial library [E]; DXF covers the trade |
| RhinoScript (VBScript), .NET and C++ plug-ins, Rhino.Inside | cannot run in a browser; MatrixGold-style plug-ins cannot load, so plug-in parity is topic 13's native features |
| Toolbar files and window-layout export | interface parity |
| Edge Softening, Shut Lining | render tricks for product design; real fillets and grooves exist |

## 7. Verification: proving parity

1. **The ledger.** A checked-in table of all 1,078 names (plus Rhino 9 features), each mapped to a verb, a "how it is done here" answer, or "left out, because". CI fails on an unmapped name, and on a verb whose example picks do not build through `design.run`.
2. **One geometry test per capability row**, with closed-form answers where they exist. Examples: sphere r 10: volume 4,188.79 mm³, area 1,256.64 mm²; torus by Pappus; box 2 × 3 × 4: centroid at the centre, moments of inertia m(b² + c²)/12 about each axis; unrolled cylinder area equals the face area; offset of a sphere by t has radius r + t; a network surface interpolates its curves within tolerance; a two-rail sweep stays within 0.01 mm of rail 2.
3. **Mass properties three ways:** OpenCascade `GProp`, a mesh tetrahedron sum, and the closed form; exact within 1e-6 relative, mesh within 0.1 %.
4. **.3dm round trip through rhino3dm:** write, read back, compare object counts and types, the layer tree, block definitions and instances, units, user strings, and control points and knots to 1e-9. Then the reverse on public sample .3dm files. Never the founder's father's files.
5. **STEP round trip** through the build's reader: valid, same face count, volume within 1e-3.
6. **SubD:** limit positions against OpenSubdiv's own regression shapes; deviation of our NURBS conversion from the limit surface, reported per continuity option.
7. **Rhino as referee (optional, needs a licence):** open our .3dm and STEP in Rhino, run `Check`, `Volume`, `ShowEdges`; today a manual release gate, automatable with Compute.
8. **Studio:** a keyboard-only Playwright script per area, and AI parity by replaying the same `design.run` sequence.
9. **Performance gates** on the light machine for every new heavy operation.

## 8. What this means for the plan

Inputs for `docs/plans/freeform-cad-additions.md`: the steps after the existing eight, in priority order. Effort is [E], in weeks of one build lane, judged against the size of the existing steps.

| Step | What | Rows | Effort | Depends on |
|---|---|---|---|---|
| 9 | The parity ledger and alias table; Tier 1 curve, snap and selection sweep; macros | the native A rows, H2, I1–I4, J2–J6, R3 | 3 | steps 2, 5 |
| 10 | Own OpenCascade build, with a memory and start-up spike on the light machine | enables 12–14, 18, 21 | 2 | — |
| 11 | Open-surface bodies: sew, join, explode, extract, untrim, cap; naked edges; surface points | B1, B24, B25, C6, C10, M8 | 4 | reverses plan decision 7 |
| 12 | Surface creation: Patch, EdgeSrf, NetworkSrf, RailRevolve, Drape, Project, Pull, curves and offsets on surfaces | A7, A13, A15, A18, B4, B10–B14, B23 | 5 | 10, 11 |
| 13 | Surface continuity: Match, Blend, fillets between surfaces, variable radius, Extend, Rebuild; zebra, curvature, draft, edge continuity | A24, A27, A28, B15–B18, B26, B27, C8, M5, M6, Z1, Z2, Z4 | 6 | 11, 12 |
| 14 | Direct editing: PushPull, MoveFace, Inset, solid points, holes, WireCut, Auto CPlane | C2, C11–C18, H3, Z5 | 4 | 10 |
| 15 | Analysis: centroids and moments, thickness map, Clash, clipping planes, section styles, units and tolerances | M3, M7, M9–M12, Q1, Q2 | 3 | — |
| 16 | Meshes as first-class objects: repair verbs, ShrinkWrap tool, mesh editing, displacement, point clouds | E2, E3, E5, E7, E9–E15 | 4 | — |
| 17 | SubD: cage node, tools, creases, symmetry, MultiPipe; then NURBS conversion; QuadRemesh job | D1–D7, E6, Z6 | 10–14 | 10, 16 |
| 18 | Deformers: CageEdit, Maelstrom, Splop, soft moves, FlowAlongSrf, exact shear and non-uniform scale | F4, F8, F12–F14 | 4 | 10 |
| 19 | Drafting: annotation objects and styles, exact Make2D, editable sheets, print, DXF | N1–N8, A16, P8 | 6 | — |
| 20 | Organisation: blocks, linked reference pieces, named views, CPlanes, snapshots, layer states, four-up | K2, K5–K8, O3–O6, F15 | 4 | — |
| 21 | Interop: .3dm import and full export (trimmed solids, blocks, annotations, SubD), IGES, more mesh formats | P1, P2, P5, P7, P10 | 5 | 10, 17, 20 |
| 22 | Display: wireframe, ghosted and pen modes, user materials, texture mapping, lights, path animation | O1, O2, O7–O10, O12 | 4 | topic 15's renderer |
| 23 | Automation: formulas and variables, graph view, script runner, public API; a canvas only if chosen | R1, R2, R4, Z11 | 4–8 | — |

Leftovers (B6, B20, B21, B22 and the remaining D-need rows) go last or stay out. N9 (reference images) arrives with the assistant build.

**Decisions for the founder.**
1. **The target:** Rhino 8 as the frozen baseline with Rhino 9 additions tracked (recommended), or Rhino 9 outright.
2. **Open surfaces.** Full parity requires reversing "bodies are closed". Recommended: allow open-surface bodies, shown as construction; weight, checks and casting still need closed metal.
3. **SubD:** build it (10–14 weeks, the largest item), and to which grade: castable mesh only, or exact NURBS too.
4. **Our own OpenCascade build:** accept a bigger download and a build pipeline to unlock about 20 rows.
5. **Server-only tools:** QuadRemesh and fine ShrinkWrap as jobs on the local or hosted server, not in the browser.
6. **Grasshopper:** graph view and formulas (recommended), or a full canvas.
7. **The leave-out list in §6**, item by item; DWG in particular.
8. **Four viewports:** on request (recommended) or as a default layout.
9. **Rhino as a test referee:** buy one licence for release gates, or keep the gate manual.
10. **What "parity" may be claimed publicly:** capability parity proven by the ledger, never "runs Rhino plug-ins".

**Open questions I could not settle.** Whether the public openNURBS source converts SubD to NURBS. Whether McNeel's terms allow Compute behind a competing product. The Rhino 9 release date and its command list. OpenSubdiv's exact licence wording. Memory cost of a larger OpenCascade build on the light machine.

## 9. Repo notes for the lead

- Research 12 rates Extend, MatchCrv, Fair, CageEdit, Splop, ArrayCrvOnSrf and ArraySrf as "Later", but the plan's Later list (§0, §7) and scope cuts (§6) name none of them. This file marks them "—".
- Research 12 and the plan treat Make2D as absent ("technical capture mode", scope cut). `packages/production/src/drawing/` already produces hidden-line views, a section, dimensions and a title block.
- Research 12 §3.9 lists ShrinkWrap as "Today (`meshBody`)". The code has level-set re-surfacing inside repair and hollowing (`mesh/resurface.ts`), not a tool.
- The plan, research 12 and my brief assume Rhino 8 is current. McNeel now sells Rhino 9, which includes RhinoAI.
- The working copy has no `node_modules`. I read the engine type files from another checkout on this machine with the same versions as `packages/kernel/package.json` (replicad-opencascadejs 1.2.1, rhino3dm 8.35.0).
- `GProp_GProps`, `GeomConvert`, `GeomLib`, `STEPCAFControl_Writer` and the `XCAFDoc` tools are in the shipped build but missing from research 12 §6.

## 10. Sources

**McNeel, opened [V]:** [Rhino 8 command list](https://docs.mcneel.com/rhino/8/help/en-us/commandlist/command_list.htm) · [New in Rhino 8](https://www.rhino3d.com/8/new/) · [New in Rhino 9](https://www.rhino3d.com/9/new/) · [File formats](https://www.rhino3d.com/features/file-formats/) · [Sales and prices](https://www.rhino3d.com/sales/) · [Download](https://www.rhino3d.com/download/) · [System requirements](https://www.rhino3d.com/8/system-requirements/) · help pages: [ShrinkWrap](https://docs.mcneel.com/rhino/8/help/en-us/commands/shrinkwrap.htm), [QuadRemesh](https://docs.mcneel.com/rhino/8/help/en-us/commands/quadremesh.htm), [ToNURBS](https://docs.mcneel.com/rhino/8/help/en-us/commands/tonurbs.htm), [Make2D](https://docs.mcneel.com/rhino/8/help/en-us/commands/make2d.htm), [Worksession](https://docs.mcneel.com/rhino/8/help/en-us/commands/worksession.htm), [CageEdit](https://docs.mcneel.com/rhino/8/help/en-us/commands/cageedit.htm), [History](https://docs.mcneel.com/rhino/8/help/en-us/commands/history.htm), [PushPull](https://docs.mcneel.com/rhino/8/help/en-us/commands/pushpull.htm), [Object snaps](https://docs.mcneel.com/rhino/8/help/en-us/user_interface/object_snaps.htm), [Units](https://docs.mcneel.com/rhino/8/help/en-us/documentproperties/units.htm), [Displacement](https://docs.mcneel.com/rhino/8/help/en-us/properties/displacement.htm) · [SubD features](https://www.rhino3d.com/features/subd/) · [Scripting guides](https://developer.rhino3d.com/guides/scripting/) · [Compute guides](https://developer.rhino3d.com/guides/compute/) · [Core-hour billing](https://developer.rhino3d.com/guides/compute/core-hour-billing/) · [Rhino.Inside](https://www.rhino3d.com/features/rhino-inside/) · [openNURBS](https://www.rhino3d.com/features/developer/opennurbs/) · [openNURBS repository](https://github.com/mcneel/opennurbs).

**Libraries and licences, opened [V]:** [OpenSubdiv repository](https://github.com/PixarAnimationStudios/OpenSubdiv) · [QuadriFlow](https://github.com/hjwdzh/QuadriFlow) · [Instant Meshes licence](https://github.com/wjakob/instant-meshes/blob/master/LICENSE.txt) · [quadwild-bimdf](https://github.com/cgg-bern/quadwild-bimdf) · [libigl licence](https://libigl.github.io/license/) (MPL2; its `copyleft/` modules pull in GPL code) · [CGAL licence](https://www.cgal.org/license.html) · [CGAL package list](https://doc.cgal.org/latest/Manual/packages.html) (Alpha Wrapping, mesh processing and simplification are GPL; kernel and subdivision LGPL) · [CGAL Alpha Wrapping](https://doc.cgal.org/latest/Alpha_wrap_3/index.html) · [OpenVDB](https://github.com/AcademySoftwareFoundation/openvdb) · [Open CASCADE Technology](https://occt3d.com/open-cascade-technology/index.html) (LGPL 2.1 with an exception) · [opencascade.js custom builds](https://ocjs.org/docs/app-dev-workflow/custom-builds) · [occ_gordon](https://github.com/rainman110/occ_gordon) · [Manifold](https://github.com/elalish/manifold) · [xyflow](https://github.com/xyflow/xyflow).

**Opened, with limits:** [Digital Production on Rhino 9, 18 Nov 2026](https://digitalproduction.com/2026/11/18/rhino-9-patches-subds-and-the-ai-in-the-room/) [V]: confirms Rhino 9's Patch, setback fillets, RhinoAI and Grasshopper 2; gives no release date.

**Would not open:** the Rhino 8 help file-formats page (the features page was used), the Rhino 8 help index and SetDisplayMode body, OpenSubdiv's `LICENSE.txt`, the OpenSubdiv documentation site (redirected), the replicad build folder on GitHub.

**Search summaries only [S]:** [OpenSubdiv Far tutorials](https://graphics.pixar.com/opensubdiv/docs/far_tutorial_5_1.html) and [BFR overview](https://graphics.pixar.com/opensubdiv/docs/bfr_overview.html) (patch tables and limit evaluation exist) · [AutoRemesher Final Goes MIT](https://digitalproduction.com/2026/07/28/autoremesher-final-goes-mit/) (another permissive quad remesher; not examined) · [McNeel forum, Rhino 9 beta](https://discourse.mcneel.com/t/help-shape-rhino-9-the-beta-is-here/220246).

**Local, read this session:** `replicad_single.d.ts` (replicad-opencascadejs 1.2.1), `rhino3dm.d.ts` (rhino3dm 8.35.0), and the repository files named in §3.
