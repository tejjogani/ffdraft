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

## Running it locally

From the repository root (Node 22 or later, pnpm 10):

```sh
pnpm install                                   # once; links @pave/match into the workspace
pnpm vitest run packages/match                 # unit tests, plus kernel tests at draft detail (about 1 minute)
pnpm --filter @pave/match typecheck            # tsc on the package
pnpm match:bench                               # the six pull-request cases; prints the tables (5 to 15 minutes)
pnpm match:bench --only 0 --overlays /tmp/ov   # one case, writing target | fit | difference PNGs
pnpm match:bench --suite grid --templates solitaire --seeds 1,2 --views one --levels clean
```

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
const result = await observability(ranked[0].result, input) // numbers no photo could see become 'assumed'
// result.ops is an ordinary op list: apply it as one undoable change.
```

`runMatch` (in `loop.ts`) runs the same steps from a `PhotoReader`. `scriptedReader` is a fixture reader that
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

| File                               | What it does                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `camera.ts`                        | `cameraBasis`, `project`, `unproject`, `VIEW_SEEDS`, `defaultCamera`                                 |
| `raster.ts`                        | z-buffered software rasteriser: class, node, depth and face buffers                                  |
| `mask.ts`                          | moments, edges, chamfer distance, resize, components, dilate, erode                                  |
| `score.ts`                         | IoU, stone IoU, symmetric edge distance, per-part scores, stone marks, and the fixed loss            |
| `pose.ts`                          | `alignCamera` (span and shift from moments), `searchPose`, `refineCamera`                            |
| `params.ts`                        | `paramsFor` (bounds from field metadata), `opsFor` (candidates as `update` ops)                      |
| `fit.ts`                           | `fitDesign`: coordinate search with a pattern move, with the camera re-polished on every trial build |
| `choose.ts`                        | `chooseDiscrete`: build every candidate; decided only with a 1.5× margin                             |
| `observe.ts`                       | `observability` (marks unseen numbers as assumed), `suggestView` (which second photo helps)          |
| `scale.ts`, `stones.ts`, `lift.ts` | anchors, stone marks and pavé statistics, lifting 2D marks onto a 3D body                            |
| `route.ts`, `ask.ts`, `overlay.ts` | the per-part ladder, questions ranked by consequence, overlay buffers                                |
| `read.ts`, `loop.ts`               | the read interface and its scripted fixture, and the keyless loop                                    |
| `bench/`                           | synthetic cases, degradation, the runner, thresholds, report and CLI                                 |

## Status

The plan and the benchmark output (`pnpm match:bench`) give the measured numbers. Not built yet: the `route`,
`scripted-jeweler`, `lift` and `sculpt-sim` benchmark suites, the nightly grid in CI, and every model-backed
step (segmentation and the read).
