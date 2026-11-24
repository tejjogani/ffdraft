# @pave/match

Reference match: given the silhouettes of one to four photos of a piece, find each photo's camera and
the parametric design that explains them. No model is called. Models name things (the read, the
masks); this package measures them. The plan is [`docs/plans/reference-match.md`](../../docs/plans/reference-match.md)
and the research is [`docs/research/11-image-to-cad.md`](../../docs/research/11-image-to-cad.md).

- **Pure TypeScript on typed arrays.** No DOM, no native modules, no image codecs, no I/O. It runs in Node, a
  Worker or the browser.
- **The caller supplies the kernel** as `evaluate(design) → Evaluation`. `@pave/schema` is the only runtime
  dependency, and `@pave/kernel` is used for types (and as a dev dependency for the tests and the benchmark).
- **Deterministic.** All randomness comes from `mulberry32(seed)`. The evaluation budget is counted, so the
  same inputs give the same `FitResult`. The time budget is only a safety cap.
- **Cancellable in-process.** Rendering is synchronous, so every search loop checks the `AbortSignal` and the
  time budget before each render and yields to the event loop every 40 ms (`guard.ts`). An abort from a timer,
  a request or a Worker message stops a fit within a render or two.
- **Fails safely** (plan §2 step 9, §8). A target that no fit can explain (subject under 1 % or over 90 % of
  the frame, or touching all four borders) is refused before any build (`stopped: 'rejected'`,
  `match.badTarget`). A fit whose best view is under `FIT_FLOOR` (loose overlap 0.9, stone overlap 0.25) is
  `stopped: 'poor'`, never `converged`, with `quality: 'poor'` and a `match.poorFit` diagnostic, and
  `runMatch` routes the piece down the ladder (`outcome.fit.route`). The floor is calibrated on synthetic
  masks only.

## Running it locally

From the repository root (Node 22 or later, pnpm 10):

```sh
pnpm install                                   # once; links @pave/match into the workspace
pnpm vitest run packages/match                 # unit tests, plus kernel tests at draft detail (about 1 minute)
pnpm --filter @pave/match typecheck            # tsc on the package
pnpm match:bench                               # the six pull-request cases; prints the tables (5 to 15 minutes)
pnpm match:bench --only 0 --overlays /tmp/ov   # one case, writing target | fit | difference PNGs
pnpm match:bench --suite grid --templates solitaire --seeds 1,2 --views one --levels clean
pnpm match:bench --check                       # exits 1 when a floor is missed (for CI)
```

The benchmark levels are `clean`, `noisy` and `hard` (closed-world: the truth is drawn from the search bands
and differs from the start only in the free numbers) and `misspec` (the truth comes from bands widened by 30 %
and also changes fields the fit holds fixed: band profile, shoulders, band taper, ring size, head taper,
prong tips). Cases carry part masks (head and band, body and bail). The camera is scored by reprojection, so
any symmetry of the piece counts as a twin. A floor "met" on the six pull-request cases says nothing about the
grid: the per-recipe table says what misses where.

The benchmark uses one core and a real kernel. On a shared machine, cap its memory with
`NODE_OPTIONS=--max-old-space-size=3072`.

## The loop in code

```ts
import { createKernel } from '@pave/kernel'
import { paramsFor, chooseDiscrete, observability, applyAnchor, type TargetView } from '@pave/match'

const kernel = createKernel()
const evaluate = (d) => kernel.evaluate(d, { detail: 'draft' })

const anchor = applyAnchor(design, {
  type: 'ringSize',
  nodeId: 'band',
  size: { system: 'us', value: 6 },
})
const start = applyOps(design, anchor.ops).design
const params = paramsFor(start, ['center.width', 'band.widthTop', 'band.thicknessTop'], {
  bands: { 'band.widthTop': [1.6, 4] }, // the canon's band, as plain numbers
  pins: anchor.pins,
  ties: { 'band.widthTop': ['band.widthBottom'] },
})
const views: TargetView[] = [
  { id: 'photo1', width, height, matte, stones, seed: { azimuth: 45, elevation: 42 } },
]
const input = { design: start, params, views, evaluate }
const { ranked, decided } = await chooseDiscrete({
  ...input,
  candidates: [
    { id: '4 claws', ops: [{ t: 'update', id: 'head', patch: { prongCount: 4 } }] },
    { id: '6 claws', ops: [{ t: 'update', id: 'head', patch: { prongCount: 6 } }] },
  ],
})
const result = await observability(ranked[0].result, input) // unseen numbers become 'assumed' or 'weak'
if (result.quality !== 'good') {
  // Under the floor: the recipe does not explain the photo. Do not present it as the design.
}
// result.ops is an ordinary op list: apply it as one undoable change.
```

A stone mask that is supplied but all zeros means "no stones in the photo" and penalises a recipe that draws
one; leave `stones` undefined only when the segmenter did not look for stones.

**What each number's status means** (`FitResult.params[].status`):

| Status    | Meaning                                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `fitted`  | Measured: after the camera is re-polished on a nudged build, the loss rise stands out of the fit's residual.                  |
| `clamped` | The search ended on a bound of the band; the truth may lie beyond it.                                                         |
| `weak`    | Not observable from these photos: the change the residual could hide (`uncertainty`) exceeds min(0.5, a quarter of the band). |
| `unmoved` | Free, but the search never moved it from its start.                                                                           |
| `assumed` | No pixel of any fitted view changes; back at its start.                                                                       |
| `pinned`  | Fixed by the anchor or the jeweler.                                                                                           |

`runMatch` (in `loop.ts`) runs the same steps from a `PhotoReader`. Open discrete fields are settled one at a
time, most consequential first (by the metal and carats their options change), each with its own margin and
question; every option is built up to `maxCandidates`, and options left out are listed in `notBuilt`. `scriptedReader` is a fixture reader that
reads the truth, with seeded errors biased toward the familiar answer, so the whole loop can be tested without
any model.

## Conventions

- Millimetres; right-handed; Z up. A ring's finger axis is Y and its head is at +Z. Flat pieces face −Y.
- Camera: azimuth, elevation and roll in degrees, with the basis of `@pave/render`'s `cameraBasis` (a fixture test
  locks this). `distance` sets perspective only. `span` is the number of mm across the larger image side at the
  target's depth, and sets scale. `shift` is the principal-point offset, as fractions of the larger side. No focal
  length is used, because photos are cropped.
- Image pixels: x to the right and y down. Pixel (x, y) has its centre at (x + 0.5, y + 0.5).
- Parameter keys are `${nodeId}.${field path}` (`band.widthTop`, `center.placement.elevation`). Bounds, steps and
  integer-ness are read from the schema's field declarations.

## Files

| File                               | What it does                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `camera.ts`                        | `cameraBasis`, `project`, `unproject`, `VIEW_SEEDS`, `defaultCamera`                                                                                          |
| `raster.ts`                        | z-buffered software rasteriser: class, node, depth and face buffers                                                                                           |
| `mask.ts`                          | moments, edges, chamfer distance, resize, components, dilate, erode                                                                                           |
| `score.ts`                         | IoU, stone IoU, symmetric edge distance, per-part scores, stone marks, and the fixed loss                                                                     |
| `pose.ts`                          | `alignCamera` (span and shift from moments), `searchPose`, `refineCamera`                                                                                     |
| `params.ts`                        | `paramsFor` (bounds from field metadata), `opsFor` (candidates as `update` ops)                                                                               |
| `guard.ts`                         | `makeGuard`: abort and deadline checks inside synchronous search loops, and yields                                                                            |
| `fit.ts`                           | `fitDesign`: coordinate search with a pattern move and basin-hopping restarts, the camera re-polished on every trial build; refused targets and the fit floor |
| `choose.ts`                        | `chooseDiscrete`: build every candidate; decided only with a 1.5× margin and a fit above the floor                                                            |
| `observe.ts`                       | `observability` (sensitivity after a camera re-polish, against the residual: assumed, weak), `suggestView`                                                    |
| `scale.ts`, `stones.ts`, `lift.ts` | anchors, stone marks and pavé statistics, lifting 2D marks onto a 3D body                                                                                     |
| `route.ts`, `ask.ts`, `overlay.ts` | the per-part ladder, questions ranked by consequence, overlay buffers                                                                                         |
| `read.ts`, `loop.ts`               | the read interface and its scripted fixture, and the keyless loop                                                                                             |
| `bench/`                           | synthetic cases, degradation, the runner, thresholds, report and CLI                                                                                          |

## Status

The plan and the benchmark output (`pnpm match:bench`) give the measured numbers. Not built yet: the `route`,
`scripted-jeweler`, `lift` and `sculpt-sim` benchmark suites, the CI wiring of `match:bench --check` and the
nightly grid (the workflow file is outside this package), the server job (which should run the fit in a worker
thread), a noise-calibrated decision margin (it stays a fixed 1.5× ratio of losses), and every model-backed step
(segmentation and the read). The fit floor, the loose-overlap tolerance and the weak threshold are calibrated on
synthetic masks only.
