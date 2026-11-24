# Freeform CAD: modeling from scratch with Rhino's toolset, in the studio's calm look

Build brief: the judged synthesis of two independent design proposals ("direct modeling first, history underneath" and "history first"). Tool inventory and feasibility: [`docs/research/12-rhino-parity.md`](../research/12-rhino-parity.md). It builds on the CAD workspace ([`cad-workspace.md`](./cad-workspace.md)) and the assistant ([`assistant.md`](./assistant.md)). Labels: `[V]` checked in the repo or by a spike this session; `[S]` a web fact not opened at source; `[E]` judgement.

## 0. Does it offer all the Rhino features?

**No, and it should not try to.** It offers every Rhino tool a jewelry designer uses weekly or more, with Rhino's command names typed into the command bar landing on Pavé's tool, and it leaves out general-industry surfacing that jewelry rarely needs.

- **What parity means here.** A Rhino jeweler can build any ring, pendant, earring or bracelet from a blank piece with curves, snaps, construction planes, typed numbers, the gumball, extrude, revolve, loft, sweep, pipe, booleans, edge fillets, shell, arrays, mirror and flow. Rhino's names (`ExtrudeCrv`, `Sweep2`, `FilletEdge`, `ArrayPolar`, `PointsOn`, `Flow`) are aliases of Pavé's verbs. Everything a person does, the AI can do through the same nodes and ops.
- **The count** (research 12, §3, frequency A and B rows of core Rhino): 74 tools. 22 Pavé covers today, mostly as jewelry nodes that replace the plug-ins (ring builder, gems, heads, halo, rows, pavé, cutters, engraving, findings, weight, casting checks). Steps 1–8 add 42. 8 are deferred. 2 are not planned. Of 21 plug-in capabilities, 12 are replaced today and 5 land in steps 6–7.
- **Which tools come when:**

| Step | Tools a Rhino user recognises |
|---|---|
| 1 Curves in the document | Curve, InterpCrv, Polyline, Circle, Arc, Ellipse, Rectangle, Polygon, Helix, ring-size rail; Revolve and Pipe take drawn curves (AI first, by numbers) |
| 2 Drawing | CPlanes, grid, Osnaps (End, Mid, Cen, Quad, Int, Perp, Tan, OnCrv), Ortho, typed coordinates, PointsOn/F10, InsertPoint/InsertKink, CloseCrv, Offset, FilletCorners, Enter-repeats |
| 3 Solids from curves | ExtrudeCrv (tapered, with holes, rounded rims), Cap, Loft, Sweep1 with several profiles, BooleanUnion/Difference on drawn bodies |
| 4 Moving and arranging | Gumball (Move, Rotate, Scale, Scale1D/2D on curves), Copy/Duplicate, Mirror about a plane, Orient, Orient3Pt, Align, ArrayLinear/grid, ArrayCrv, ArrayPolar about a drawn axis, window select |
| 5 Edges, faces, curve tools | Selection filters, FilletEdge, ChamferEdge, Shell, OffsetSrf (solid), DupEdge, Section/Contour, Join, Explode, Trim/Split (planar), Rebuild |
| 6 Jewelry on drawn bodies | Gem on surface by click, gems along a curve, milgrain along an edge, galleries and piercings, BooleanSplit, editable ring rails ("Make editable") |
| 7 Shaping | Sweep2 (two rails), FlowAlongCrv, Bend, Twist, Scale1D/2D/NU on bodies, BlendCrv |
| 8 Hand-off | Distance/Length/Radius/Angle, layers, Isolate, Lock, STEP import, .3dm with exact curves and surfaces |

- **Deferred (Later):** NetworkSrf, EdgeSrf and Patch (as one closed `surface` node), Project and Pull, FlowAlongSrf, four-up viewports and named views, curvature and zebra display, blocks, MoveFace/push-pull of arbitrary faces, Make2D, 3DM import, SubD as a mesh.
- **Not planned:** BlendSrf, MatchSrf, RebuildSrf, ExtendSrf, Untrim, exact SubD (Clayoo-style), QuadRemesh, sculpting, Squish/Unroll, MergeAllFaces on named bodies, IGES, a 2D constraint solver (Rhino has none), a Grasshopper canvas (the design already is the graph and the assistant composes it). Reasons in research 12 §5.

**How the proposals scored** (1–5; for effort and risk, 5 = least):

| | Fit to the ask | Robustness | AI-operability | Effort | Risk | Total |
|---|---|---|---|---|---|---|
| Direct first (write-back, push/pull) | 5: the Shapr3D feel, drag any face | 3: a write-back map per kind; owner-less `pushPull`; names merged through `UnifySameDomain`, unverified | 3: the AI must predict write-back heuristics; `design.writeback` is a second write path | 2: +`pushPull`, `brepBody`, Freeze, write-back table | 2 | 15 |
| History first (every verb a node) | 4: all Rhino from-scratch tools; push/pull is Rhino frequency C | 4: pass-through modifiers, feature rounds need no names, names on demand | 5: verbs in a pure shared registry, word-like selectors, replayed reference pieces | 3 | 4 | 20 |

**Spine: history first.** Grafted from direct first: the command bar spec (slash menu with Rhino aliases right-aligned, option keywords, the numeric grammar); parameter handles (the parametric half of write-back: drag an extrude's end cap to edit `distance`); edit in place; the fillet validity guard and crease-edge filter (both reproduced here, §4.4); "never guess between candidates" when re-binding an edge; `viewport.pick`; plain-word sub-shape descriptions; `cloneNodes` for duplicate and paste; the per-node fault counter; STEP import as `brepBody`; the AI-parity end-to-end test; Screen C's graceful fillet failure.

## 1. Experience

**Principles.** One way to model: a drag, a typed command, a template and an AI tool call all end in `design.apply` ops, so every gesture is undoable, attributed and replayable as JSON. Modeless: no sketch mode or part mode. Select-first and verb-first both work. One gesture, one labelled history line ("Extruded Head 2.40 mm", "Moved point d of Profile"). Numbers are always typeable. Calm by subtraction: nothing floats unless it concerns the current selection or running command.

**Empty piece.** A fifth door, first in reading order for designers: **Start from a sketch**, "Draw curves and build the piece from them." An inline segmented control asks *What are you making?* Ring · Pendant · Earring · Other, which writes `setKind` and, for Ring, one `curve{shape: ring, size US 6}` on the Front plane (with today's ring-size chip, `viewport/Dimensions.tsx`); Pendant/Earring seed nothing but a framed Front view; Other seeds nothing. The camera goes square-on, the grid fades in, the tool rail appears, and the command bar shows *Type a command, or press /*. The four existing doors stay; drawn bodies can be added to any template too.

**The first five minutes.**

| Time | The designer | Written |
|---|---|---|
| 0:00 | Start from a sketch → Ring | `setKind`, `add curve{ring}`: "Started a ring sketch" |
| 0:20 | Presses `3` (side view; the plane follows: Right). Types `polyline` out of habit: it matches **Curve** (style polyline). Clicks six points; the first snaps to the ring's **Quad** (badge "Quad"); types `1.6` Enter for one length; clicks the first point to close | preview only while drawing; on close `add curve{points}`: "Drew Profile · 6 points" |
| 1:10 | `p` (or F10): drags point *d* up, Tab, `1.6`, Enter | `update {shape: {points: {d: {at}}}}`: "Moved point d of Profile" |
| 2:00 | With the profile selected the context bar shows *Extrude · Revolve · Sweep · Offset*; clicks Sweep, the prompt says *Pick a rail*, clicks the ring circle, Enter | `add sweep`: "Swept Profile along Ring size" |
| 3:00 | `mod+d`, `w`, drags the copy to the top quad with the snap, widens it with the gumball's side handle (Shift: symmetric) | `add curve` (copy, scale baked into its points) |
| 3:40 | Selects the sweep; context bar *Profiles 1 · + Add profile*; clicks the copy | `update sweep {profiles}`: the band now tapers |
| 4:30 | HUD `≈ 3.9 g 18k yellow`; changes the ring-size chip to US 7 | `update curve {shape: {size}}`; everything downstream re-evaluates |

**A signet ring from scratch** (10 nodes; the AI's run in §1 "The AI" writes the same):
1. Ring rail: `curve{ring, US 6}`. 2. Band profile on the Right plane, six keyed points, `a` and `b` corners for a comfort-fit flat inside. 3. Top profile: duplicate, widen. 4. `sweep{rails:[ring], profiles:[{prof, at:0}, {top, at:0.5}]}`, closed, no caps.
5. Head outline: `4` (Top), `/rect`, centre snapped to the top quad, Tab `8` Tab `8`, `r 1.2`: `curve{rect, plane top offset 10.4}`; parametric shapes keep width/height/corner, so the AI edits *width*, not points.
6. `/extrude`, drag the cap handle down into the band: `extrude{distance -2.4, taper 6, roundEnd 0.3}` (a rim round needs no edge names).
7. `/union`: `boolean{union, target: sweep, tools:[extrude]}`.
8. `q` until the filter reads Edges, double-click the join: the chain highlights; context bar *Round 0.60 mm*: `fillet{target, edges:["ext_head/side:*|swp_band/side:*"], radius 0.6}` (a word pattern, not indices).
9. `/stone`, click the signet face: `gem{placement: surface}`, then `setting{bezel}`.
10. HUD weight, carats, "Ready to cast" after the production check. Resize to US 7: rail, sweep, union, fillet, stone and bezel re-evaluate; the fillet's names still resolve.
Optional: draw a heart on the shoulder, `/extrude` with *Cut through*, `/mirror` (`pattern{mirror}` about the YZ plane).

**Finding tools.** One verb registry feeds five entries:
- **Command bar** (bottom centre, above the HUD row; next-step chips hide while a command runs). `/` or Space opens it; `/` on the canvas opens the same list as a menu at the cursor, grouped like Notion's block menu (Draw · Shape · Solid · Edit · Arrange · Jewelry · View). Each row: Pavé title, a one-line description in `fg-subtle`, the Rhino alias right-aligned in Geist Mono. After a verb is chosen the bar becomes Rhino's prompt line: the prompt, option keywords (Tab cycles, first letter toggles), the typed buffer on the right. Enter on an empty bar repeats the last verb.
- **⌘K** stays global and includes every verb (aliases in `Command.keywords`, already matched by `command-palette.tsx:90` [V]).
- **Tool rail**: a vertical glass cluster on the viewport's left edge, seven buttons, each a short popover: Select, Curve, Shape (circle, rect, polygon, ring), Solid (extrude, revolve, loft, sweep, wire), Edit (round edges, shell, flow, deform), Arrange (array, mirror, combine), Measure. *Rejected:* a flat top-centre rail of nine tools, which grows with every verb and crowds the existing top toolbar.
- **Context bar**: a glass pill 12 px above the selection's screen box (below when there is no room) with the two to five verbs that fit, one live number, and "✦ Ask". Closed curve: Extrude · Revolve · Pipe · Offset. Several curves: Loft · Sweep. Body: Round edges · Shell · Combine · Array. Edges: Round · Chamfer. During a command it carries the command's live fields (compact `FieldControl`).
- **Inspector** (generated, flat): new widgets `points` (a table of keyed points, 28 px mono rows, hover highlights the point, corner/smooth toggle), `edges` (removable pills plus "Pick in view"; a pill that matched nothing is struck through with a warning dot), `plane`, `curveRef`.

**Keyboard** (today's keys stay: `a`, `f`, `h`, `x`, `1–4`, `Shift+1–3`, F2, undo chords; no Alt chords):

| Key | Action |
|---|---|
| `/`, Space | Command bar; Enter on empty repeats |
| `c` / `l` | Curve (smooth) / Curve as polyline. Click adds, click on the first point or `c` closes, Enter ends open, Backspace removes the last point |
| `p`, F10 / F11 | Edit points on / off |
| `w` / `e` / `r` | Gumball move / rotate / scale (the CAD plan's W/E, plus R) |
| `q` | Selection filter: object → points → edges → faces |
| `mod+d`, `mod+c`, `mod+v` | Duplicate, copy, paste (subtrees with fresh ids, refs remapped) |
| Tab | Type the active value; Tab again for the next; Enter commits |
| Shift (held) | Ortho, 15° steps; symmetric scale |
| `mod` (held) | Snaps off for this gesture |
| `g` | Grid snap on/off |
| Esc | Cancel prompt, then sub-selection, then selection |

Numeric grammar (`model/parse.ts`): `2.5` a value; `2.5,1` plane coordinates; `@2,0` or `r2,0` relative; `<45` angle lock; `d2.5` diameter; arithmetic (`17.3/2`). mm, typed to 3 decimals, shown to 2. *Rejected:* `E` for Extrude (it is the plan's rotate key), and `F` meaning fillet when edges are selected (one key with two meanings).

**Construction planes.** The drawing plane follows the view preset, as each Rhino viewport has its own CPlane: `2` Front, `3` Right, `4` Top; the hero view keeps the last one. While a drawing tool runs, the context bar shows *Plane* (Top · Front · Right · Custom). "Plane to face" (step 5) and planes attached to a feature's frames (step 6, e.g. a stone's girdle) follow their host when it changes. A curve stores its plane at draw time.

**The look** (house rules, `packages/ui/src/styles.css:1-11`: jewelry is the colour, hairlines over shadows, glass only on floating chrome, one blue for selection, one gold for AI, Inter 13 px on a 4 px grid, Geist Mono numbers).
- Curves 1.25 px `--fg` at 70 %, 2 px on hover, `--select` when selected; curves consumed by a solid in `--fg-subtle`. Control polygon 1 px dashed `--fg-subtle`. Points 6 px squares, white with a 1 px ink border, filled `--select` when selected. Rubber band dashed 4/3.
- Faces: picked 14 % `--select` tint with boundary edges in `--select`; hover 8 %. Pickable edges appear only within 8 px of the pointer on the selected body, so a dense ring never turns into a wireframe. No glow, no outline pass.
- Grid drawn in the shader on the active plane: `--line` dots at 1 mm, hairlines at 5 mm, switching to 0.1/0.5 mm when the view is under 6 mm across, fading out over 40 mm. Axes and gumball arrows use three new muted tokens, `--axis-x` rose `#c9877f`, `--axis-y` sage `#86a88a`, `--axis-z` slate `#8f9bb8` (well apart from `--select`); nothing else gets a hue.
- Snaps: only the winning one shows, as a hollow ink glyph (square End, triangle Mid, circle Cen, diamond Quad, × Int) plus a 20 px glass badge in Geist Mono 11 px ("Quad"). The cursor readout `x 0.00 z −8.26 · 1.10 mm` is a glass tag; Tab turns it into fields.
- Glass (`glass` utility, blur 24 px, saturate 170 %, opaque fallbacks) only on: tool rail, command bar, slash menu, context bar, snap badge, cursor and gumball readouts. Outliner and inspector stay flat and opaque. Radii 8 for bars, 12 for the slash menu, 6 for chips.
- Outliner: modifiers nest over what they modify (`Round edges 0.6 › Combine › Sweep · Extrude`), curves under the solids that use them in `fg-subtle` with a dotted curve icon, like a Notion toggle list. A body that fell back to mesh shows a small "mesh" badge.

**Screens** (the screenshot matrix, §5):
- *A, blank ring sketch:* outliner with one row "Ring size · US 6"; Front view, grid, the ring circle ø 16.51 mm with its chip; left tool rail; command bar placeholder; HUD hidden until there is metal; inspector shows the curve (ring size, plane, offset) or, with nothing selected, a **Drawing** section: plane, grid step, snap chips, ortho switch (workspace preferences, not design data).
- *B, drawing a profile:* Right plane, committed points, rubber band, "Quad" badge, readout; command bar `Curve · Click the next point · Close C · Style: Smooth ▾ · Undo point ⌫ · Enter to finish`; the inspector's points table fills as points land.
- *C, edges picked, fillet failing gracefully:* three edges in `--select` 2.5 px; context bar `Round · 3 edges · 1.60 mm · Chamfer · ✓`. The kernel reports `fillet.invalid`: the view keeps the last good result (0.9 mm) with a dashed boundary, the radius field gets a 1 px `--danger` underline, and a line under the bar reads "1.6 mm is wider than the faces allow here. **Use 0.9 mm**" (the diagnostic's `fix`). Inspector: "Round edges · 3 edges", each edge in plain words ("top edge of the outer face").
- Plus the slash menu and point edit with the gumball on a point selection.

**Edit in place and handles.** Double-click a body to light up the curves it is made from on their planes, points visible, everything else dimmed to 40 %; Esc leaves. Fields with a `handle` meta draw a handle on the model: extrude's end cap cone edits `distance`, a disc on a fillet edits `radius`, shell's wall arrow edits `thickness`. Dragging previews `update` on that one field and commits one change; the value shows in a glass tag, ticking at whole and half mm.

**The AI does the same.** Its tools are the command registry; it writes nodes with `design.apply`, checks with `design.evaluate`, looks with `viewport.capture`. New: `design.inspect` (named faces and edges with plain words, positions, areas, normals; curve points; measures; what a selector would match) and `viewport.pick` (a pixel of a capture view → node and sub-shape), and sub-shape refs in `ui.context` and `viewport.select`, so "round these edges" means the designer's selection. "Make me a tapered comfort band, size 7, with a 2 mm rounded square signet" is: `design.apply` (rail, two profiles, sweep, head rectangle) → `design.apply` (extrude, union) → `design.inspect {what: 'resolve', selector}` → `design.apply` (fillet) → `design.evaluate` (applies any `fix.ops`) → `viewport.capture`. The designer watches as today: gold sweep on new nodes, the command bar showing "✦ Assistant · Sweep — Profile along Ring size", the chip with **Undo run** (`design.revert {runId}`). Right-click a face → "Ask AI…" sends its sub-shape ref. The verb registry's one-line descriptions and Rhino names are exported for the assistant's prompt.

**Failure, in plain words.** A modifier that cannot be built passes its input through and reports why, with a fix when there is one, so weight, stones and exports still work and "Ready to cast" waits. A body that became a mesh says so where it matters ("This Combine became a mesh, so its edges cannot be rounded. Round the parts before combining them."). A selection that no longer exists announces it once in the live region. A node that crashes the engine twice in a row is marked failed ("This operation crashed the geometry engine") and is not retried on every keystroke.

## 2. Structure

**`packages/schema/src/design/`**
- `nodes.ts`: the kinds in §3, `CURVE_KINDS`, `BODY_KINDS` extended, `nodeRefs` extended.
- `verbs.ts` (new, pure): `VerbDef {id, title, group, aliases (Rhino names), describe, writes: NodeKind, prompts: Prompt[], options, build(picks, options, design) → Op[]}`; `Prompt {key, pick: 'curve'|'body'|'edges'|'faces'|'point'|'number', min, max, text}`. Read by the command bar, context bar, tool rail, ⌘K and the assistant's prompt.
- `topo.ts` (new): `SubRef` grammar (`nodeId`, `nodeId/pt:<key>`, `nodeId/edge:<name>`, `nodeId/face:<name>`), face and edge name grammar, `matchSelector`, `describeSub` (plain words for history, inspector and the AI).
- `clone.ts` (new): `cloneNodes(design, ids) → Op[]` with fresh ids and remapped refs.
- `fields.ts`: widgets and the `handle` meta. `describe.ts`: labels for point patches and sub-shape lists.

**`packages/kernel/src/`**
- `geometry/curve.ts` (pure TS, no WASM; exported as `@pave/kernel/curve` so the studio's main thread draws live curves): every curve shape to cubic Bézier spans with segment keys; control-point style over `geometry/bspline.ts`; smooth style as Catmull-Rom tangents into `blendSegment` (`geometry/loop.ts`); display polylines; analytic snap points; planar offset; `planeFrame`.
- `features/{curve, curveOp, extrude, loft, sweepFeature, fillet, shell, flow, deform, brepBody}.ts`, registered in `features/index.ts`.
- `topology/names.ts` (provenance names; carried through `BRepAlgoAPI_*` by `Modified`/`Generated`/`IsDeleted`; ordinals for split faces; hash maps keyed by shape hash), `topology/select.ts` (`resolve(named, selector) → {edges, missing, ambiguous, rebound}`), `topology/facts.ts` (per-face and per-edge facts).
- `solid/occt.ts`: `prismNamed`, `filletGuarded` (guard and retry ladder, §4.4), `thickSolidNamed`, inside the existing `scoped()` and `occtError()`.
- `inspect.ts`: `Kernel.inspect(design, nodeId, what)`, served by the studio worker and the server kernel.
- `export/rhino3dm.ts`: NURBS curves, untrimmed NURBS faces, trimmed planar caps.

**`apps/studio/src/features/cad/`**
- `model/`: `CommandBar.tsx`, `SlashMenu.tsx` (on `packages/ui` `command-palette`'s list), `prompt.ts` (state machine `idle → choosing → prompting(i) → previewing → commit`; preview is `session.preview`, commit is `commitGesture`), `parse.ts`, `ContextBar.tsx`, `snaps.ts` and `cplane.ts` (pure), `tools/{drawCurve, drawShape, editPoints, pick, gumball}.ts` (state machines that emit ops, never touch three.js).
- `viewport/`: `Construction.ts` (grid, curves as `LineSegments2`, points, handles), `SubPick.ts` (faces from `Part.topology` triangle ranges over the existing BVH raycast; edges and points by 8 px screen distance), `Gumball.ts`, `Handles.ts`; hosted by `components/stage/viewer.ts`. This replaces the planned, never-written `Gizmo.tsx`.
- `inspector/widgets/{points, edges, plane, curveRef}.tsx`, one entry each in `FieldControl`.
- `state/workspace.ts` gains `tool`, `cplane`, `snaps`, `ortho`, `filter`, `sub: SubRef[]`, `editInPlace`.
- Outliner: Duplicate/copy/paste, the mesh badge, groups as layers (step 8); `suggestions.ts` gains **Curves** and **Shape** groups, so the disabled Revolve ("Needs a profile") and Wire ("Needs path points") go live once a curve exists.
- `empty/`: the fifth door; importers add `.step`/`.stp` → `brepBody` (step 8).

## 3. Contract changes

**New node kinds** (all hash-cached and per-node failing like today's):

| Kind (title) | Body | Fields |
|---|---|---|
| `curve` (Curve) | no | `plane`; `shape` = `points{style: smooth\|controlPoints\|polyline, degree?, closed, order: Key[], points: Record<Key, {at, kind?: corner\|smooth, w?}>}` · `circle{center, radius}` · `ellipse{center, rx, ry, angle}` · `rect{center, width, height, corner, angle}` · `polygon{center, sides, radius, corner}` · `arc{center, radius, start, sweep}` · `helix{radius, pitch, turns}` · `ring{size}` |
| `curveOp` (Offset curve, Round corners, Section, Copy edges, Join, Trim, Rebuild, Blend) | no | `op` = `offset{of, distance, corners}` · `roundCorners{of, radius, radii?: Record<Key, mm>}` · `section{body, plane}` · `edges{body, edges}` · `join{curves[]}` · `trim{of, by, keep: vec3}` · `rebuild{of, points, degree}` · `blend{a, b, continuity: G1\|G2}` (step 7) |
| `extrude` (Extrusion) | yes | metal; `profile`, `holes?: curve[]`; `distance`; `direction: normal\|both\|symmetric`; `taper` deg; `roundStart`, `roundEnd` |
| `loft` | yes | metal; `sections: curve[2..32]`; `style: smooth\|ruled`; `closed`; `caps` |
| `sweep` | yes | metal; `rails: curve[1..2]`; `profiles: {curve, at 0..1}[1..8]`; `orient: minimal\|up`, `up?`; `twist`; `caps: auto\|none\|flat` |
| `fillet` (Round edges) | yes, consumes | `target`; `edges: EdgeSelector`; `radius`; `kind: round\|chamfer`; `near?: Record<name, vec3>` |
| `shell` (Hollow) | yes, consumes | `target`; `thickness`; `open: FaceSelector`; `side: inside\|outside` |
| `flow` | yes or curve, consumes | `source`; `from: straightX\|curve`; `to: curve`; `stretch`; `keepUp` |
| `deform` (Stretch, Bend, Twist, Taper) | yes or curve, consumes | `target`; `op` = `scale{factors, frame}` · `bend{angle, axis}` · `twist{angle}` · `taper{ratio}` |
| `brepBody` (Imported solid) | yes | metal; `assetId` (STEP); whole-body use only |

**Extended:** `revolve` gains `curve?` and `axis` (exactly one of `profile`/`curve`); `pipe` gains `path?` (exactly one of `points`/`path`); `pattern` gains `type: curve{path, count, align}` and `grid{countX, countY, spacingX, spacingY}`, `axis` gains `frame{origin, direction}`, mirror gains a plane; `boolean.op` gains `split` (step 6); `group` gains `color?`, `locked?` (left out of the hash like `name`, `evaluate/hash.ts`). `BODY_KINDS` gains `extrude, loft, sweep, fillet, shell, flow, deform, brepBody`, so stones, pavé, engraving, bails and booleans accept drawn bodies with no feature code.

**Shared types** (`nodes.ts`, `topo.ts`):
- `PointKey = /^[a-z][a-z0-9]{0,7}$/` (never `__proto__`); at most 400 points per curve.
- `Plane = world{name: top|front|right, offset} | frame{origin, normal, xAxis} | attached{node, frame|face} | none` (3D curve).
- `EdgeSelector`/`FaceSelector = string[1..200]`: names or patterns with one `*` per part, plus `!`-prefixed exceptions.
- `validateDesign`: curve fields point at `CURVE_KINDS`, body fields at `BODY_KINDS`; `order` and `points` agree exactly; `plane.attached.node` is a ref (so a curve on a girdle evaluates after the stone) and cannot depend on its own dependents.
- **No schema version bump:** new fields are optional with "exactly one of" rules; old documents parse unchanged.
- `fields.ts`: widgets `points`, `edges`, `faces`, `plane`, `curveRef`; meta `handle?: {kind: distance|radius|thickness, face?: string, along?: normal|axis}`.

**Ops: none new.** Keyed points make a point drag an ordinary merge patch (`{shape: {points: {d: {at}}}}`), whose inverse `diffPatch` already computes and whose undo `guardPatch` already restricts to what is unchanged (`core.ts:255-276` [V]). Inserting a point adds a key and replaces `order`.

**Commands** (`api/commands.ts`, `api/client-tools.ts`):
- `design.inspect` (query, `tool: true`): `{pieceId, nodeId, what: 'topology'|'curve'|'measure'|'resolve', selector?, between?: [SubRef, SubRef]}` → `{faces: {name, words, kind, area, centroid, normal}[], edges: {name, words, length, mid, convex}[], points?, matches?: {names, missing, ambiguous}, measure?}`. Its description tells the model to call it before writing a selector. Served by the server kernel, so it works with the studio closed.
- `viewport.pick` (client tool, new): `{pieceId, view: CameraPreset|{azimuth, elevation}, size, x, y, filter?}` → `{nodeId?, sub?}`, using the same framing as `viewport.capture`.
- `viewport.select` accepts `SubRef` strings; `ui.context` adds `sub`, `cplane`, `tool`.
- `design.apply` unchanged: verbs compile to it (200 ops, `changeId` idempotency). Studio: one `Command` per verb with `keywords: aliases`, group `'Model'`.
- `design.export {format: 'step'|'3dm'}`: plan check (step 8, §4.11).

**Kernel types:** `FeatureOutput.curves?: CurveOut[]`; `Evaluation.curves: CurvePart[]` (`{id, nodeId, rev, polyline, points: {key, at, kind?}[], control?, closed, plane?, snaps}`), sent with the same `rev` skipping as parts; `Part.topology?: {faceNames, faceTriStarts, edgeNames, edgeStarts}` only for nodes in `topologyFor`; `EvaluateOptions.topologyFor?: string[]`, `gesture?: boolean`; `Kernel.inspect`.

**Diagnostic codes:** `curve.open` ("Close the curve to extrude it"), `curve.selfIntersects`, `extrude.noLoop`, `sweep.profileMismatch`, `fillet.edgeMissing` (warning), `fillet.rebound` (info), `fillet.partial` (warning, fix), `fillet.invalid` and `fillet.failed` (error, input passed through, fix), `fillet.noEdges`, `names.lostInMesh` (blocked), `boolean.mesh` (info), `deform.mesh` (info: "a mesh, not in STEP"), `engine.crashed`.

## 4. Hard parts and decisions

1. **One way to model.** Every verb is a node; gestures write ops; parameter handles edit one field. *Rejected:* direct-first write-back as the default (dragging a side face moves the two sketch points that made it). It needs a per-kind mapping the AI must predict, a `design.writeback` second write path, and a `pushPull` node for owner-less faces, for a tool Rhino jewelers use occasionally (MoveFace is frequency C). *Rejected:* separate direct and history modes, and Freeze (history off): nothing in Pavé "breaks history", and slow chains are handled by gesture evaluation (item 6).

2. **Curves as data: one curve per node, keyed points.** A curve node is one path or loop; holes are `extrude.holes`; joining is `curveOp{join}`. Points are `Record<Key, {at, kind?, w?}>` plus `order`, so one drag is one small patch, and the designer's undo of point *d* leaves the assistant's edit of point *b* alone. Point records must never carry a `type` key and point patches must not touch `shape.type`, because `guardPatch` restores any object with `type` whole or not at all [V]. *Rejected:* arrays like `pipe.points` (a merge patch replaces arrays whole, so guarded undo finds them changed and does nothing); a `sketch` node whose curves share points (a small 2D constraint system, harder for the AI to write and to validate); a `patchPoints` op (a sixth op every consumer must learn, for no gain).

3. **Topological naming: four layers, cheapest first, never guess.**
   - *Layer 0, avoid it:* `extrude.roundStart/roundEnd`, sweep caps, `primitive.fillet`, `vectorBody.bevel` take a radius and need no names; most jewelry rounding softens a rim [E].
   - *Layer 1, provenance names:* extrude `side:<segmentKey>`, `cap:start`, `cap:end`; sweep and loft one face per profile segment `side:<key>` plus caps; revolve `side:<key>`; primitive `top, bottom, …, wall`. Names are prefixed with the node id, carried through booleans by `Modified`/`Generated`/`IsDeleted` (in the build [V]), with ordinals `#k` for split faces outside the base name. An edge is its two faces' base names, sorted, joined by `|`. Two independent spikes kept every name through a moved point, a taller body, an inserted point and a moved, larger hole [V].
   - *Layer 2, selectors as rules:* a view pick stores exact names; chain and loop picks store a pattern; patterns pick up new segments (an inserted point *e* added `side:e` to `side:*`), exact names never gain edges.
   - *Layer 3, hints:* `near` stores each pick point. A vanished name re-binds only when exactly one crease edge lies within 0.2 mm and 10° (`fillet.rebound`); two or more candidates, or none, and the edge is reported missing with "Pick again". A wrong fillet in gold is worse than a missing one.
   - Mesh bodies have no names: sub-shape picking is off on them ("This body is a mesh: select it whole"), downstream edge nodes are `blocked` with `names.lostInMesh`, and the advice is the Rhino lore, round before combining (the DAG makes reordering a two-op fix).
   - `ShapeUpgrade_UnifySameDomain` is not run on named bodies: its `History()` is typed `unknown` in this build [V]. *Rejected:* the direct proposal's "merge names by the larger face" (unverified); OCAF/TNaming (not in the build, and it puts geometry state in the document); pure geometric matching (silently wrong under a ring's symmetry); index naming (the spike's "edge 5" moved from (6, 2, 0) to (4.5, −0.75, 0) after one insert [V]); geometric queries as stored selectors (`crease > 30°`, `parallel to Z`), deferred until patterns prove short.

4. **Fillet and shell robustness.** Reproduced here [V]: on a 15-edge prism r 0.3 and 0.9 are valid; **r 1.6 returns `IsDone` with an invalid solid whose volume grew from 56.1 to 77.5 mm³**; r 3 is not done; filleting a full revolve's seam edges throws a raw `WebAssembly.Exception`. Policy, inside `scoped()`/`occtError()`:
   1. Offer and accept only crease edges: two distinct faces with a dihedral above 10°.
   2. Guard every fillet, shell and offset result: `IsDone`, `BRepCheck_Analyzer` valid, finite positive volume, volume change bounded (and negative when every edge is convex). The guard costs about 6 ms [V].
   3. Ladder on failure: all edges at r; then each edge alone (up to 24) to fillet the good set and warn `fillet.partial` with the failing names; then at most 4 bisections (about 0.5 s, off the interactive path, in the production worker after idle) to attach `fix: "Use 0.42 mm"`.
   4. If nothing works, pass the input through with `fillet.failed`. Never throw, so dependents are never `blocked` by an ambitious radius.
   5. A per-node fault counter marks a node that faults the WASM runtime twice in a row `engine.crashed`.
   *Rejected:* failing the node outright (it blocks stones and exports downstream), and trusting `IsDone` alone (measured above to ship broken castings).

5. **Selection that survives re-evaluation.** Selections are `SubRef` strings, never triangle indices. Points survive anything but deletion. After each evaluation the workspace re-resolves edges and faces against `Part.topology`; refs that vanished drop out with one live-region notice, and if all go the selection falls back to the node. During a drag the gesture's names are frozen. Sub-shape selection is a draft-detail feature (production fuses parts per metal).

6. **Performance.** Curves never wait for the worker: the running tool and dragged points are drawn on the main thread from `@pave/kernel/curve`. Solids catch up through the latest-wins scheduler. Measured on one shared Node core [V]: drawn-profile sweep 23 ms analytic (69 ms exact B-rep on demand), extrude 1–13 ms, naming 13–80 ms, fillet 8–144 ms, cached re-evaluation 0.6–1.5 ms. Decisions: B-rep only when an exact operation downstream asks (fillet, shell, exact boolean, STEP); names only for nodes in `topologyFor` (the selected body in a sub-object filter, or a selector's target); during a gesture (`EvaluateOptions.gesture`), evaluation stops at the first heavy node (fillet, shell, exact boolean over B-rep, or EWMA over 40 ms), whose last result shows at 50 % with a 1 px progress hairline, and full evaluation runs on release. Targets: point drag feeding a sweep under 60 ms p95; templates keep the CAD plan's 120 ms.

7. **Bodies are closed.** Surfaces are construction, or come with a thickness, because casting needs closed metal and every body must be weighable; `checkGeometry` already rejects open shells. NetworkSrf, EdgeSrf and Patch therefore wait for a `surface` node with a built-in thickness.

8. **Non-uniform scale without `GTransform`.** `BRepBuilderAPI_GTransform` is not in the build [V]. On curves the gumball bakes the scale into points or the shape's fields (a circle becomes an ellipse); on bodies a non-uniform handle adds `deform{scale}`, exact for curves and the sweep family (the sections are scaled, then built), Manifold `warp` otherwise with the mesh badge. `base.transform` stays a similarity.

9. **Keys and planes.** `w/e/r` gumball keeps the CAD plan's W/E. Drawing keys are only `c`, `l`, `p`; everything else is one word away in the command bar. The plane follows the view preset, so a Rhino user's "Right view means Right CPlane" holds with no new keys. *Rejected:* `5/6/7/8` plane keys and hover-follows-face (surprising mid-gesture); "Plane to face" is an explicit verb.

10. **Jewelry on drawn bodies.** `BODY_KINDS` makes `gem.placement.surface`, `pave.host`, `engraving.host`, `bail.host` and `boolean` work at once (step 3). Step 6 adds `gemRow.along` (stones on a drawn rail, with graduation), `pave.region.faces`, `plane.attached` to feature frames, click-to-place stones on any body, milgrain and galleries as `pattern{curve}` over `curveOp{edges}`, and "Make editable" for `ringShank`: one undoable change into its rail, profiles and a `sweep` (the shank publishes rail and stations in `data`), with the ring-size field still driving the rail.

11. **.3dm, STEP and the paid line.** STEP (paid) is exact for every exact node; mesh fallbacks are left out with today's note; the exact sweep exported in 46 ms [V]. .3dm (paid): rhino3dm 8.35 writes and reads back exact `NurbsCurve`s, untrimmed `NurbsSurface` faces as `Brep`s and planar caps trimmed by a curve [V], so curves go out exact on a "Construction" layer, sweep-family and extrude faces as untrimmed surfaces with trimmed planar caps, one layer per node; faces with general trims (fillets, boolean results) go out as meshes with the note "rounded and combined faces are meshes in .3dm; STEP has them exact". STEP import is free. No export is gated anywhere today and no plan owns entitlements [V], so step 8 adds one check at `design.export` and the export menu for `step` and `3dm`, reading the plan field the platform work exposes; until it exists the formats stay open and the menu marks them.

12. **The designer and the assistant on one curve.** Different points of one curve edit and undo independently. An assistant edit during a gesture is handled by the session as today (pending and live gesture re-applied over the new confirmed state). If the assistant deletes a point the designer is dragging, the gesture's patch re-creates a key missing from `order`, `NodeSchema` rejects it, and the existing reject path drops it with a toast.

**Repo facts that correct the proposals.**
- The history proposal's fillet ladder trusted `IsDone`; the r 1.6 case above returns done and invalid [V, re-run].
- Its "Sweep2" spike was one rail with two profiles; a true two-rail sweep was not spiked (hence step 7 and spike S1).
- The direct proposal's name merge through `UnifySameDomain` has no reachable history in this build [V].
- This repo has no PR size cap; the 400-line figure in the history proposal belongs to another repo. Steps still commit with tests and a handoff note.
- `features/cad/viewport/` holds only `Dimensions.tsx`, `Marker.tsx` and `Toolbar.tsx`: the gizmo of the CAD plan was never built [V].
- Command keywords exist and the palette already matches them (`apps/studio/src/lib/commands.ts`, `command-palette.tsx:90`) [V].

**Decisions to confirm with the founder.** (1) History first, with parameter handles, and no general push/pull in this build. (2) Keyed points as the convention for every future geometry node. (3) Closed bodies only. (4) Lost edges reported, never guessed. (5) Three muted axis tokens. (6) .3dm exact for curves and untrimmed faces, meshes for trimmed faces; STEP the exact route; both paid; STEP import free. (7) One viewport with plane-following presets, no four-up.

## 5. Verification

- **Schema (Vitest, pure):** every new kind passes the `describe.ts` contract over `NODE_KINDS`; keyed-point invariants (order ↔ points, key pattern, `__proto__` rejected, no `type` in point records); `validateDesign` accepts curve and body refs only in their places; `cloneNodes` remaps refs and validates clean; `topo.ts` grammar round trip and `describeSub` for every role; `parse.ts` grammar and errors; **property test** on the existing fake server with real `applyOps`: a designer and an agent drag random distinct points of one curve, interleaved, and after each guarded undo only the undoer's points revert.
- **Verb registry:** every verb's `build` on its example picks applies cleanly; every Rhino alias in research 12 resolves to exactly one verb.
- **Kernel (Node):** closed-form volumes (extruded rectangle w·h·d; revolved rectangle by Pappus; loft of equal circles a cylinder; box with all edges filleted) within 0.1 %; analytic tessellation and B-rep within 0.05 %; the naming suite (the two spikes' cases as a table) plus a 200-case fuzz of move, insert and delete point, height and hole changes: exact selectors never gain edges, patterns gain only new segments' edges, vanished names warn and never throw; the failure suite: r 1.6 on the 15-edge prism reports `fillet.invalid` and passes the input through, its fix applies and evaluates clean, seam edges are never offered, a fillet after a mesh-fallback boolean is `blocked`, a forced `WebAssembly.Exception` reports; STEP round trip by the build's reader within 1e-3 volume and equal face count; .3dm read back through rhino3dm with the expected `NurbsCurve` and `Brep` counts and CVs; performance gates with 2× headroom: point drag → sweep under 60 ms, gesture evaluation stops at heavy nodes, cached re-evaluation under 3 ms.
- **Assistant:** five reference pieces built from scratch (comfort band, signet, bypass wire ring, bezel pendant, hoop earring) as recorded `design.apply`/`design.inspect` sequences replayed in CI without a model: all `ok`, weight within ±5 % of the reference, "Ready to cast" at production. The same prompts run nightly against the live assistant when keys exist.
- **Studio (Playwright, `apps/studio/e2e/shots.ts`):** keyboard-only signet ring (§1) by typed commands and coordinates; **AI parity**: the recorded AI run produces the same design as the keyboard run after id normalisation; typing `Sweep2`, `ExtrudeCrv`, `FilletEdge` runs the right verb; a cap-handle drag writes one `update distance`; selection survival (insert a point upstream and the edge stays selected; delete the segment and the selection falls back with the notice); the snap engine as pure tests on fixture polylines. Screenshots A, B, C, the slash menu and point edit, light and dark, 1440 and 390 px, reduced transparency and reduced motion. Pixel checks on glass chrome only; the canvas is checked through `Evaluation` facts.
- **Cannot be verified here:** real-GPU line rendering and frame times, trackpad and pen feel, Rhino opening our .3dm and joining it, the live assistant relay.

**Spikes before building** (each a scratch script against the repo's runtimes, run before the step that needs it):
- S1 (step 7): a true two-rail Sweep2 on the station sweep (width and orientation from rail 2), exact B-rep against tessellation, open and closed rails.
- S2 (step 5): fillets on station-sweep B-spline faces and on an extrude ∪ sweep join (the signet's r 0.6): success rate, guard verdicts, time.
- S3 (steps 3, 5): provenance names through a boolean whose tool and target are station sweeps; the pattern `ext/side:*|swp/side:*` resolves the whole join chain.
- S4 (step 5): whether `UnifySameDomain.History()` answers `Modified` at runtime; if not, that leaving coplanar faces unmerged does not hurt fillets or weight.
- S5 (step 5): the guard and ladder on 200 fuzzed fillets: no invalid solid passes, few false rejections, ladder within 0.5 s.
- S6 (step 3): sweeps and lofts whose profiles have different point counts (segment matching or resampling; `ThruSections` fallback) keep provenance names.
- S7 (step 7): exact flow of curves and sweeps along an arbitrary drawn rail (only a circle was spiked) and `deform{scale}` on sections.
- S8 (step 6): `ringShank` "Make editable" reproduces the template band's volume within 0.1 %.
- S9 (step 2): main-thread `@pave/kernel/curve` without WASM: bundle size and evaluation time for a 400-point curve per frame.
- S10 (step 5): in the browser draft worker, a point drag → sweep → union at under 60 ms p95 and topology on demand under 80 ms (only Node was measured).
- S11 (step 5): `viewport.pick` on a capture camera pose returns the sub-shape at the captured pixel.
- S12 (step 8): rhino3dm export of a full drawn ring; in Rhino (outside this environment), Join yields a closed polysurface.

## 6. Scope cuts

- MoveFace and push/pull of arbitrary faces, the `pushPull` node, Freeze, general write-back.
- NetworkSrf, EdgeSrf, Patch, BlendSrf, Match/Rebuild/Extend surface, RailRevolve; exact Flow of arbitrary B-rep (mesh warp instead); FlowAlongSrf.
- Project and Pull of curves onto surfaces (not in the build; a section-based workaround later), offset curves in 3D, curvature graphs, zebra and curvature analysis.
- SubD of any kind, QuadRemesh, sculpting.
- A 2D constraint solver and driven dimensions; geometric-query selectors; variable-radius fillet laws (`radii` per corner only on curves).
- Four-up viewports and named views; SmartTrack; on-surface and knot snaps until step 5's picking; window select on sub-shapes.
- Blocks and instances; 3DM and IGES import; Make2D drawings; shrinkage compensation at export.
- Sub-shape selection on production parts and on meshes; drawing with touch (touch keeps orbit, pan and select).

## 7. Build order

Each step ships on its own, leaves the product working, and commits with tests and a handoff note.

1. **Curves in the document (AI first).** `curve` (points, circle, rect, polygon, arc, ellipse, helix, ring), `Plane`, keyed points, `CURVE_KINDS`, `geometry/curve.ts`, the `curves` channel and construction display, the `points` inspector table (typed edits), `revolve.curve`, `pipe.path`, the verb registry skeleton. *Proof:* schema invariants and the keyed-point guarded-undo property test; a recorded AI run draws a profile and revolves and pipes it; Revolve and Wire are enabled in the add menu once a curve exists.
2. **Drawing.** Planes that follow the view, the shader grid, snaps (grid, end, mid, cen, quad, int in plane, perp, tan, on-curve), ortho, the `c`/`l`/shape tools, point editing (drag, insert, delete, corner/smooth, Tab entry), `curveOp` offset and round corners, the command bar, slash menu, Rhino aliases and numeric grammar, the "Start from a sketch" door. *Proof:* pure snap and parse tests; keyboard-only e2e draws a profile and revolves a band; screenshots A and B; S9.
3. **Solids from curves.** `extrude` (taper, holes, both/symmetric, roundStart/End), one-rail multi-profile `sweep`, `loft`, provenance face names inside them, `BODY_KINDS` extended, the context bar, parameter handles, edit in place. *Proof:* closed-form volumes, analytic against B-rep, STEP round trip; e2e builds the band and head of the signet (steps 1–7); S3 and S6 first.
4. **Moving and arranging.** Gumball `w/e/r` (similarity on bodies, baked into curves, non-uniform on curves), duplicate/copy/paste (`cloneNodes`), mirror about a plane, Orient/Orient3Pt/Align, `pattern` along a curve, grid and frame axes, window and crossing select. *Proof:* one labelled change per drag; arrays against expected frames; pasted subtrees validate clean.
5. **Edges, faces and curve tools.** The `q` filter, `Part.topology` on demand, `SubPick`, `design.inspect`, `viewport.pick`, `SubRef` in `ui.context` and `viewport.select`, `fillet`/chamfer with crease filter, guard and ladder, `shell`, "Plane to face", `curveOp` section, copy edges, join, trim, rebuild. *Proof:* the naming suite and fuzz, the failure suite (r 1.6 reported, never shipped), selection survival, the assistant replay of the signet's fillet, screenshot C; S2, S4, S5, S10, S11 first.
6. **Jewelry on drawn bodies.** Name propagation checked through every boolean, `boolean{split}`, click-to-place stones on any body, `gemRow.along`, `pave.region.faces`, `plane.attached` to feature frames, milgrain and galleries, "Make editable" for `ringShank`. *Proof:* the full signet keyboard-only and AI-parity e2e; stone counts and placements on fixtures; a resized ring keeps its stones; S8.
7. **Shaping.** Two-rail `sweep`, `flow` and `deform` (exact for curves and the sweep family, Manifold otherwise, badged), `curveOp{blend}`. *Proof:* an exact flow keeps volume with stretch off; mesh warps carry `deform.mesh`; S1 and S7 first.
8. **Hand-off.** .3dm with exact curves, untrimmed faces and trimmed planar caps plus the fidelity notes; STEP import as `brepBody`; the `step`/`3dm` plan check; groups as layers (colour, lock, isolate); the measure tool (distance, length, radius, angle). *Proof:* rhino3dm read-back counts; STEP import volume and face count; server tests for the plan check; S12.

**Later, unscheduled:** a closed `surface` node (Patch through `MakeFilling` first, then EdgeSrf and NetworkSrf on B-spline poles), Project/Pull, curvature display, four-up viewports, blocks, push/pull of faces, SubD as a castable mesh.
