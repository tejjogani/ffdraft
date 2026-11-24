# Reference match: the best CAD or sculpt from a photo of a piece

Build brief: the judged synthesis of three independent proposals (scores and evidence: [`research/11-image-to-cad.md`](../research/11-image-to-cad.md)). Extends [`design-intelligence.md`](./design-intelligence.md) (the canon and the design read) and [`ideate-and-freeform.md`](./ideate-and-freeform.md) (the Make rail, `freeform.analyze`, `mesh3d.*`). No live model was called for this brief; statements about models on jewelry are unverified until the bake-offs in section 11.

## 1. The answer

**Models name things; code measures them; the jeweler fixes what is left with a tap.**

- A photo becomes a **read** (what the piece is, part by part, and what the photo does not show), then a **recipe build** from the canon, then a **fit**: Pavé renders its own design from the photo's angle and adjusts a handful of numbers until the outlines agree.
- Only a part that no recipe can explain is sculpted, and only that part. Stones, settings, bail and chain stay parametric even on a sculpted body.
- Every number carries a status: **seen**, **unsure**, **assumed** or **pinned by you**. Depth that the photo hides is reported as assumed, never as a result.
- The output is an ordinary design document, applied as one undoable change.

Spine: the parametric-first proposal (the only one with a measured core). Grafted from designer-in-the-loop: the read card, questions ranked by consequence, pin-and-refit, the correction count as the product metric. Grafted from sculpt-first: the per-part ladder, lifting 2D stone masks onto a sculpted body, the overlap gate on generated meshes, the degraded-mesh test.

## 2. The loop

| # | Step | Done by | Output |
|---|---|---|---|
| 1 | Intake: 1 to 4 photos, origin flags, one scale tap (section 5) | designer, vision flags | `origin`, `ScaleAnchor` |
| 2 | Isolate: subject matte; instance masks for stones; named regions (head, band, body, bail, chain) | segmenter, then code | one `TargetView` per photo: matte, stone mask, stone marks, part masks |
| 3 | Read each region crop three times (section 3) | vision model | `PhotoRead` with visibility and agreement per field |
| 4 | Choose the recipe; flag a sculpted body | code on the read | archetype, or two or three candidates |
| 5 | Seed: `suggestDesign(spec)`, bands from `targetsFrom(read)`, anchor pins | code (canon) | start design, bounds, pins |
| 6 | Find each photo's camera (section 6) | `@pave/match` | `Camera` per view |
| 7 | Settle unsure discrete fields by building each candidate | `@pave/match` | choice with a margin, or a question |
| 8 | Fit the free numbers and the cameras together (section 7) | `@pave/match` | values, statuses, scores |
| 9 | Score each part; send failing bodies down the ladder (section 4) | `@pave/match`, then freeform services | route per part |
| 10 | Rebuild stones on a sculpted body from their masks | `@pave/match` lift | `gem`, `setting`, `pave` nodes |
| 11 | `lintDesign` and kernel diagnostics; clamp what cannot be made, and say so | canon, kernel | findings |
| 12 | Read card; each correction pins a field and the rest refits; accept applies one change | designer | design |
| 13 | Record `Critique.referenceDiff`; later human edits are the quality signal | op log | traces |

Steps 2 and 3 need providers. Steps 5 to 12 are deterministic and keyless.

## 3. The read

`PhotoRead` extends the canon's `DesignRead` (do not invent a second read):

- Every categorical field becomes `{ value, visible: 'yes' | 'partly' | 'no', agreement: 1 | 2 | 3 }`.
- `views[]`: `{ assetId, label }` using the canon's `VIEWS`; `regions[]`: `{ key, viewId, box, cropAssetId }`.
- `sculpted: { present, regionKeys[] }`; `scaleAnchor` gains `declaredHeight` and `referenceObject`.
- No stone totals and no millimetres anywhere. Ratios come from masks (step 2), not from the model.

How it is asked (research 11 §2):

1. One call per region crop, background removed, with a flat schema. Free-text reasoning first, the structured answer second.
2. The prong and feature-stone question does not name the archetype.
3. Three runs. Agreement, not stated confidence, sets the status: 3 of 3 and visible is **seen**; disagreement or `partly` is **unsure**; `no` is **assumed** and takes the canon default.
4. **Grounding in the canon.** The system prompt carries `UNIVERSAL_PRINCIPLES` and the `canonFor` pack of the candidate archetypes. The few-shot examples are the canon's own exemplars: a clay capture of `buildExemplar(e)` paired with `readDesign` of it, so every example read is correct by construction, and each anti-twin shows what a wrong proportion looks like. Whether this helps is unverified; it is one of the ablations in section 11.

## 4. Parametric or sculpt, per part

The rule is **the lowest-freedom feature that explains the region**.

| Part | Route | Built as |
|---|---|---|
| Chain | always parametric; never taken from a mesh | `chain`; style from the read, length asked |
| Bail | always parametric | `bail`; opening and width from mask ratios |
| Feature stones (about 10 or fewer) | always parametric | `gem` + `setting`; on a sculpted host, `surface` placement from the lift |
| Pavé fields | always parametric | `pave`: size range from the histogram of mask diameters, coverage from masked area; the kernel reports the count |
| Ring band | parametric when the fit explains it | `ringShank`; a motif on top may still be sculpted |
| Body | the recipe's node if, after the fit, its part overlap is at least 0.90 and its mean edge distance is at most 3 % of its size | recipe node |
| Body, otherwise | 1. `vectorBody` from the matte outline when the read says flat and constant thickness. 2. `relief` (the default; depth is a hint only). 3. `meshBody` only with two or more real views or on request, and only if the generated mesh, registered to the photo, overlaps the matte by at least 0.85; otherwise relief | freeform node |

- The two thresholds are starting values; the `route` suite in section 12 calibrates them on known bodies.
- **Hybrid order.** Mask stones and findings out of the photo before any generation. Fit or generate the body with stone nodes hidden (pavé makes each evaluation about a second: `iced-trophy` measured 0.7 to 1.6 s). Then lift stone marks onto the body and add `pave`, `bail`, `chain`.
- Each part shows an **Editable** or **Sculpted** badge the jeweler can flip.
- Depends on contract changes already planned in `ideate-and-freeform.md` §3: a mask variant of `Pave.region` and a custom `Relief.outline`. Still missing from any plan: a front and up axis on `meshBody`.

## 5. Scale

Scale is asked, never inferred. One tap, with a default pre-selected so it can be skipped.

| Anchor | Effect |
|---|---|
| Ring size | pins the band's `size` (`ringInnerDiameter`) |
| Centre stone, in carats or millimetres | pins that gem's `width` (`gemDimsFromCarat`) |
| Pendant height | pins the body's `height` |
| A coin in the photo | pins that view's image scale; approximate, because the coin is not at the piece's depth |
| None | size 7 finger, or the canon's default height; the spec card says "scale assumed" and every millimetre is shown as assumed |

## 6. Camera

- **Seven numbers per photo:** azimuth, elevation, roll, distance, image span, and a two-axis shift. Distance sets perspective only; span (millimetres across the image at the piece) sets size. A cropped photo has no meaningful focal length, so none is fitted.
- **Start:** try 60 directions (12 azimuths by 5 elevations). For each, solve span and shift directly from the mask's area and centroid, then compare at low resolution. Refine the best three. The read's view label, when there is one, orders the candidates.
- **Distance** starts at ten times the piece's size and stays there unless a second photo or strong perspective constrains it (section 7, measured).
- **Symmetric pieces** have several equally good cameras; any of them gives the same overlay, so pose is judged by reprojection, not by angle.
- `onBody` photos are read but not fitted.

## 7. Comparison and fitter

**What is compared, per view and per part:**

| Score | Meaning |
|---|---|
| Silhouette overlap (IoU) | whole piece and each named part |
| Stone overlap | the stone mask, which carries the interior structure the silhouette lacks |
| Edge distance | mean distance between outlines, both ways, in pixels and in millimetres through the anchor |
| Stone marks | matched, missing and extra stones, and their mean offset; feature stones only |
| Count | the kernel's count beside the count of masks; reported, never fitted |

The loss is a fixed weighted sum (section 12). Views marked held-out are scored but not fitted.

**What is free** (at most 12 numbers; everything else stays at the canon's value):

| Archetype | Continuous | Discrete, by building candidates |
|---|---|---|
| solitaire | `center.width`, `center.lw`, `center.elevation`, `band.widthTop` (bottom tied), `band.thicknessTop`, `head.prongDiameter` | `head.prongCount`, `head.style`, `center.cut`, `band.shoulder` |
| halo, threeStone | the above plus `halo.stoneWidth`, `halo.offset`, or `side1.width` (side2 tied) | `halo.rows` |
| band, eternity | `band.widthTop`, `band.thicknessTop`, `row.stoneWidth`, `row.coverage` | `band.profile`, `row.setting` |
| signet | `face.width`, `face.height`, `band.widthBottom`, `band.thicknessTop` | `face.outline` |
| pendants | `body.thickness`, `bail.opening`, `bail.width`, `center.width` or pavé sizes from mask statistics | font, `bail.style` |

- **Bounds:** the field's declared range (`describeNode`), narrowed by the canon band the caller passes in, narrowed to a point by a pin.
- **Search:** coordinate steps with a pattern move. After each trial build, the camera is re-polished on that build (rendering only, no kernel call), so shape and camera move together. The first prototype, which alternated them, stalled.
- **Stop:** when the largest step is under the field's own step, or the budget is spent (300 kernel evaluations or 30 s per candidate by default), or the designer cancels.
- **Then test what the photos could see.** Each fitted number is nudged; if no fitted view changes by more than a threshold it is reset to the canon default and marked **assumed**.
- **Ask for the right second photo.** The view that would move most under the assumed numbers is computed from the model, so the prompt can say "a photo looking through the ring fixes band thickness and head height".

**Measured on the prototype** (synthetic solitaire, unknown camera, scale from ring size; details in research 11 §8):

MEASURED_PLACEHOLDER

## 8. What the jeweler sees

- **Side by side:** the photo on the left, a clay render from the fitted camera on the right, an overlay slider, and a difference tint (model only, photo only) with an outline per part.
- **A chip per field.** Seen: quiet. Unsure: the two candidates as rendered thumbnails; tap one. Assumed: the value, with "not visible in your photo".
- **At most three questions before the first model**, ranked by how much the candidates differ in metal weight, carats and outline. A question that changes nothing is never asked.
- **Corrections in one gesture:** tap a chip; drag an edge on the overlay (a stone edge sets `center.width`, a band edge sets `band.widthTop`); tap the photo to mark "this is a stone"; right-click a part for the same part menu as the rest of the workspace, including Ask AI and replace. Each correction is one `design.apply` op that pins the field; the free fields refit.
- **Consequences, not counts:** "about 62 stones at 1.3 mm", from pitch and region.
- **One summary line:** "Sculpted body, 3 feature stones, iced front, bail, chain. Assumed: 45 mm tall, flat back." Each phrase is tappable.
- **Failing safely:** if the recipes disagree, two or three built directions to choose from. If the best fit is under the floor, an outline plus relief with the photo pinned behind the viewport for tracing. Manufacturability lints still gate export.

## 9. Contract to add later (do not edit `packages/schema` yet)

| Command | Kind | Sketch |
|---|---|---|
| `reference.segment` | mutation, tool, metered | `{ assetId, phrases?: string[] }` → `{ matteAssetId, stoneMaskAssetId, parts: [{ key, maskAssetId }], marks: [{ x, y, d }], flags }` |
| `reference.read` | mutation, tool, metered | `{ assetIds[1..4], kindHint? }` → `PhotoRead` |
| `match.start` | mutation, tool | `{ pieceId, assetIds[1..4], anchor?, heldOutAssetId? }` → `Match` (a job: `reading`, `fitting`, `ready`, `failed`) |
| `match.get`, `match.cancel` | query / mutation, tool | → `Match` |
| `match.pin` | mutation, tool | `{ id, pins: [{ key, value }], unpin?: string[] }` → `Match`, refitted |
| `match.apply` | mutation, tool | `{ id }` → `{ changeId }`: one `design.apply` with the fitted ops |
| `design.compare` | query, tool, keyless | `{ pieceId, matchId }` → per-view and per-part scores and an overlay asset; feeds `Critique.referenceDiff` |

- `Match`: `{ id, pieceId, status, views: [{ assetId, camera, score, heldOut }], params: [{ key, value, status, min, max }], choices, questions, routes, assumed: string[], usage }`.
- `viewport.capture` gains the camera pose and a subject mask in its output, an orthographic option, and `back` and `under` views.
- Sculpt steps reuse `freeform.analyze` and `mesh3d.create` (confirm, attestation) unchanged, with stones masked out of the input.
- The fit runs on the server so a person and the assistant share one traced path. The studio runs the same `@pave/match` code in a Worker only for the live overlay while dragging.
- Assistant skill: read, ask the scale question, start the match, relay the questions, check with `design.compare`. It never estimates a count or a millimetre itself.

## 10. Providers and fixtures

| Service | Does | Fixture for tests |
|---|---|---|
| `segment` (new) | matte and instance masks by short noun phrase | `synthetic`: exact masks from a kernel render, with seeded erosion, dropped stones and jitter |
| `vision.read` (new method) | the structured read | `scripted`: `readDesign` of the truth, with seeded errors biased toward the familiar answer (always four prongs) |
| `depth` (exists) | relief hint | a stored grey ramp |
| `mesh3d` (exists) | sculpted body | `fixture`: a truth mesh re-meshed at 0.34 mm cells with noise and smoothing |

Each provider also gets a `recorded` adapter that replays stored responses by content hash. No provider or model name is fixed here; the two bake-offs in section 11 choose them.

## 11. Cost, metering and evaluation

**Per photo (all prices unverified):** about 13 small vision calls (one route, four regions three times) and one segmentation call, on the `llm` and `image` meters with keys `match:${id}:read:${n}` and `match:${id}:segment`. The fit is CPU only: measured at about 19 s per candidate for five numbers on a shared machine. A sculpted body adds one `mesh3d` job (second-hand prices in research 06: $0.08 to $0.80), behind the existing estimate, confirmation and `monthlyBudgetUsd` check. A match shows its total before it starts and never retries a paid step silently.

**Evaluation in three tiers:**

1. **Standing benchmark (keyless, in CI).** Render our own templates with random parameters and cameras, hide the truth, run the loop, measure recovery. Specified in section 12.
2. **Real photos with known CAD.** A pilot jeweler's past pieces: parameter error, weight error, held-out view overlap.
3. **Real photos for human review.** About 24 photos (the eight reference-image briefs of `design-intelligence.md` §5, plus bands, solitaires, hip-hop and sculpted one-offs). Three jewelers judge blind pairs (the match against a human CAD, or against the previous version) on the canon's `fidelity` rubric. The standing product metric is **corrections and seconds to acceptance**, from the op log's `corrected` feedback.

**Two bake-offs before fixing defaults, both needing keys:** the read and the masks on about 20 real product photos against jeweler labels (with the exemplar few-shots on and off); image-to-3D on about 20 jewelry photos, with and without stones masked out and the matte pre-pass.

## 12. Build now: `packages/match` (`@pave/match`)

Pure TypeScript. Imports `@pave/schema` and the types of `@pave/kernel` only; the kernel itself is a dev dependency for tests. No I/O, no image codecs, no DOM: rasters are typed arrays, and the caller supplies `evaluate`. Runs in Node, a Worker and the browser.

```
packages/match/src/
  types.ts      Camera, LabelRaster, TargetView, Prepared, ViewScore, FitParam, FitResult, ScaleAnchor
  camera.ts     cameraBasis, project, unproject, VIEW_SEEDS
  raster.ts     rasterize: Evaluation + Camera -> class, node and depth buffers
  mask.ts       moments, edges, distanceTransform, resize, components
  score.ts      prepareTarget, scoreView, combineLoss, LOSS_WEIGHTS
  pose.ts       alignCamera, searchPose, refineCamera
  params.ts     paramsFor, opsFor
  fit.ts        fitDesign
  choose.ts     chooseDiscrete
  observe.ts    observability, suggestView
  scale.ts      applyAnchor, mmPerPixel
  stones.ts     projectStones, matchStones, paveStats, expectedCount
  lift.ts       liftToSurface
  route.ts      routePart
  ask.ts        rankQuestions
  overlay.ts    diffClasses, edgeHeat
  rng.ts        mulberry32
  bench/        synth.ts, degrade.ts, run.ts, thresholds.ts
```

```ts
type Evaluate = (design: Design, signal?: AbortSignal) => Promise<Evaluation>

interface Camera { azimuth: number; elevation: number; roll: number        // degrees; axes as @pave/render cameraBasis
  distance: number; span: number; shift: [number, number]; target: Vec3 } // mm, mm across the larger image side, fractions
interface LabelRaster { width: number; height: number; cls: Uint8Array     // 0 background, 1 metal, 2 stone
  node: Uint16Array; nodeIds: string[]; depth?: Float32Array; face?: Int32Array }
interface StoneMark { x: number; y: number; d: number }                    // pixels
interface TargetView { id: string; width: number; height: number; matte: Uint8Array; stones?: Uint8Array
  parts?: { key: string; mask: Uint8Array; nodeIds: string[] }[]; marks?: StoneMark[]
  seed?: { azimuth: number; elevation: number }; spanMm?: number; heldOut?: boolean }
interface ViewScore { loss: number; iou: number; stoneIou: number | null; edgePx: number; edgeMm: number
  stoneEdgePx: number | null; parts: { key: string; iou: number; edgePx: number }[]
  marks: { matched: number; missing: number; extra: number; meanPx: number } | null }
interface FitParam { key: string; nodeId: string; path: string[]; min: number; max: number; step: number
  start: number; tie?: string[]; pinned?: boolean; snap?: 'melee' }
type ParamStatus = 'fitted' | 'assumed' | 'pinned' | 'clamped'
interface FitResult { design: Design; ops: Op[]; cameras: Record<string, Camera>; scores: Record<string, ViewScore>
  loss: number; params: { key: string; value: number; status: ParamStatus; sensitivity: number }[]
  evaluations: number; rasters: number; stopped: 'converged' | 'budget' | 'aborted'; diagnostics: Diagnostic[] }

rasterize(e: Evaluation, c: Camera, size: { width: number; height: number }, o?: { hide?: string[]; depth?: boolean }): LabelRaster
prepareTarget(v: TargetView): Prepared                                     // edges, distance maps, moments, a 96 px copy
scoreView(r: LabelRaster, t: Prepared, c: Camera): ViewScore
alignCamera(e: Evaluation, c: Camera, t: Prepared, hide?: string[]): Camera // span and shift from area and centroid
searchPose(e: Evaluation, t: Prepared, o?: { distanceRatio?: number; hide?: string[] }): { camera: Camera; score: ViewScore }
refineCamera(e: Evaluation, c: Camera, t: Prepared, o?: { steps?: CameraSteps; fitDistance?: boolean }): { camera: Camera; score: ViewScore }
paramsFor(d: Design, keys: string[], o?: { bands?: Record<string, [number, number]>; pins?: Record<string, number> }): FitParam[]
opsFor(params: FitParam[], values: number[]): Op[]
fitDesign(i: { design: Design; params: FitParam[]; views: TargetView[]; evaluate: Evaluate; cameras?: Record<string, Camera>
  hide?: string[]; budget?: { evaluations?: number; ms?: number }; signal?: AbortSignal; onProgress?: (r: FitResult) => void }): Promise<FitResult>
chooseDiscrete(i: FitInput & { candidates: { id: string; ops: Op[] }[]; screen?: number }): Promise<{ ranked: { id: string; loss: number; result: FitResult }[]; margin: number; decided: boolean }>
observability(r: FitResult, i: FitInput): Promise<FitResult>                // marks unconstrained numbers assumed, resets them
suggestView(d: Design, assumed: FitParam[], evaluate: Evaluate): Promise<{ seed: keyof typeof VIEW_SEEDS; gain: number }[]>
applyAnchor(d: Design, a: ScaleAnchor): { ops: Op[]; pins: Record<string, number>; spanMm?: { viewId: string; span: number }; assumed: boolean; label: string }
projectStones(e: Evaluation, c: Camera, size: Size, o?: { nodeIds?: string[] }): (StoneMark & { id: string })[]
matchStones(a: StoneMark[], b: StoneMark[], maxPx: number): { pairs: [number, number][]; missing: number[]; extra: number[]; meanPx: number }
paveStats(marks: StoneMark[], mmPerPx: number, bodyAreaPx: number): { sizeMin: number; sizeMax: number; gap: number; coverage: number }
expectedCount(i: { areaMm2: number; sizeMin: number; sizeMax: number; gap: number; coverage: number }): number
liftToSurface(e: Evaluation, c: Camera, size: Size, px: { x: number; y: number }[], hostNodeId: string): ({ point: Vec3; normal: Vec3 } | null)[]
routePart(i: { iou: number; edgeMm: number; sizeMm: number; flat: boolean; realViews: number; meshOverlap?: number }): { route: 'parametric' | 'outline' | 'relief' | 'mesh'; reason: string }
rankQuestions(c: { field: string; options: { id: string; massG: number; carat: number; xorFraction: number }[] }[], cap?: number): Question[]
diffClasses(r: LabelRaster, t: Prepared): Uint8Array                        // 0 neither, 1 both, 2 model only, 3 photo only
```

**Fixed behaviour** (so two builds agree): the loss is `0.35·(1−IoU) + 0.25·(1−stoneIoU) + 0.25·E + 0.15·Es` with stones, `0.6·(1−IoU) + 0.4·E` without, where `E = min(1, 20·edgePx / width)`. Fit resolution is 192 px, pose search 96 px. The first parameter step is 12 % of its range. Random numbers come only from `mulberry32(seed)`. The same inputs give the same `FitResult` on any V8.

**Benchmark** (`pnpm match:bench`; a six-case subset on every pull request, the full grid nightly). A case is: a template, random free parameters inside their bounds (rebuilt until the kernel reports no error), random discrete options, a ring-size or height anchor, and photos rendered by `rasterize` at random cameras (azimuth and elevation within 25° of a canon view, roll ±8°, distance 5 to 20 times the piece, fill 50 to 75 %, shift ±5 %). Three view sets: one three-quarter view; top plus through-the-finger (or front plus side for pendants); top only. Three levels: `clean`; `noisy` (outline moved ±1 px in blocks, 10 % of stone marks dropped, marks jittered 2 px); `hard` (distance 3 to 6 times the piece, 2 px erosion, 3 % anchor error, holes of up to 2 % of the area). Suites besides the round trip: `route` (a wrong recipe must be rejected, a right one kept), `scripted-read` (seeded wrong answers must end as a correct choice or a question), `scripted-jeweler` (apply the truth to the top-ranked question until within tolerance; count the taps), `lift` and `sculpt-sim`.

THRESHOLDS_PLACEHOLDER

## 13. Decisions and what was rejected

1. **Fit, do not ask the model to measure.** Rejected: a model writing parameters or CAD code from the image (research 11 §6: far from reliable, and blind to prongs and pavé).
2. **One mesh for the whole piece is a dead end.** Rejected as the default spine: sculpt-first. Kept: its ladder, lift and gates, behind the router, which defaults to parametric when unsure.
3. **Camera and shape are fitted together.** The prototype that alternated them stalled at 0.75 to 0.87 overlap; re-polishing the camera on every trial build reached 0.95 to 0.97.
4. **Distance ratio, not focal length.** Photos are cropped.
5. **No stored count from a model, anywhere.** Size, pitch and region are stored; the kernel counts.
6. **The match is a server job; the package is isomorphic.** Same trace for person and assistant; the browser only draws the live overlay.
7. **`@pave/match` does not import `@pave/canon` or `@pave/render`.** Canon bands arrive as plain numbers; the camera convention is duplicated and locked by a fixture test.

Corrections to the proposals: scale by ring size does not fix perspective, so "known camera" results overstate accuracy; the informative second ring photo is through the finger, not from the side (measured); `custom` builds nothing off rings, so a sculpted pendant must be authored by ops, not by a spec.

## 14. Build order

1. **`@pave/match` core:** camera, raster, masks, score, pose, fit, bench smoke. Proof: the thresholds above in CI.
2. **Rest of the package:** choose, observe, scale, stones, lift, route, ask, overlay; the full bench grid.
3. **Contract:** `PhotoRead`, `Match`, the commands of section 9, the capture changes, the freeform node changes. Proof: schema and handler tests with the synthetic and scripted fixtures.
4. **Server job and read card.** Proof: scripted end-to-end run; Playwright shots in both themes; keyboard pass.
5. **Providers and the two bake-offs** (needs keys). Then the real-photo set and the first jeweler review.
6. **Sculpt hybrid:** masked generation, registration gate, lift, pavé from statistics. Proof: `sculpt-sim`, then real pieces.

**Cannot be verified here:** every model step; real masks on polished metal and stones; whether one view of a real photo fits at all; prices; the benefit of exemplar few-shots. Only the solitaire recipe was prototyped; other recipes, the lift and the router thresholds are specified, not measured.
