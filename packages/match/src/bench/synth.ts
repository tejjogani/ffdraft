/**
 * Benchmark cases (plan §12): a template, free numbers drawn inside their bands, a discrete
 * option, a scale anchor, and target views rendered from the TRUE design at random cameras near
 * a canon view. The fit then starts from the template's defaults and only sees the masks, which
 * carry the stone mask and named part masks (head and band, body and bail) a segmenter would give.
 *
 * The bands below stand in for the canon's (this package may not import `@pave/canon`): they
 * are plausible ranges for each recipe, narrower than the schema's declared ranges, which also
 * allow pieces nobody would make.
 *
 * Every level but `misspec` is closed-world: the truth is drawn from the very bands that bound
 * the search and differs from the start only in the free numbers. `misspec` breaks that, as a
 * real piece would: the truth's numbers come from bands widened by 30 % on each side (inside the
 * schema's range), and fields the fit holds fixed are changed too (band profile, shoulders, taper
 * of the band, ring size, head taper and prong tips). Its masks are clean.
 */
import type { Evaluation } from '@pave/kernel/types'
import {
  applyOps,
  type Design,
  METALS,
  type MetalId,
  type Op,
  type RingSize,
  ringInnerDiameter,
} from '@pave/schema'
import { boundsDiagonal, VIEW_SEEDS, type ViewSeed, visibleBounds } from '../camera'
import { fieldOp } from '../loop'
import { opsFor, paramsFor } from '../params'
import { rasterize } from '../raster'
import { mulberry32 } from '../rng'
import { applyAnchor } from '../scale'
import { projectStones } from '../stones'
import type { Camera, Evaluate, FitParam, ScaleAnchor, TargetView } from '../types'
import { degrade, type Level } from './degrade'

export type ViewSet = 'one' | 'two' | 'top'

export interface BenchRecipe {
  templateId: string
  kind: 'ring' | 'pendant' | 'earrings'
  keys: string[]
  bands: Record<string, [number, number]>
  ties?: Record<string, string[]>
  /** Discrete field and its options; every option is built as a candidate. */
  discrete?: { field: string; options: string[] }
  hide?: string[]
  /** Keys that a single three-quarter view sees only through foreshortening. */
  depthLike: string[]
  /** The anchor, given the true design. */
  anchor: (truth: Design) => ScaleAnchor
  /** Two-view set: rings use top and through-the-finger, pendants front and side. */
  two: [ViewSeed, ViewSeed]
  heldOut: ViewSeed
  /** Named regions of the masks and the nodes that draw them. */
  parts?: { key: string; nodeIds: string[] }[]
}

const ringSize = (d: Design): ScaleAnchor => ({
  type: 'ringSize',
  nodeId: 'band',
  size: (d.nodes.band as { size: RingSize }).size,
})
const ring = {
  kind: 'ring' as const,
  anchor: ringSize,
  two: ['top', 'front'] as [ViewSeed, ViewSeed],
  heldOut: 'side' as ViewSeed,
}
const pendant = {
  kind: 'pendant' as const,
  two: ['front', 'side'] as [ViewSeed, ViewSeed],
  heldOut: 'threeQuarter' as ViewSeed,
}
const headAndBand = (head: string[]) => [
  { key: 'head', nodeIds: head },
  { key: 'band', nodeIds: ['band'] },
]
const bodyAndBail = (body: string[]) => [
  { key: 'body', nodeIds: body },
  { key: 'bail', nodeIds: ['bail'] },
]
const bandTie = { 'band.widthTop': ['band.widthBottom'] }

export const BENCH_RECIPES: Record<string, BenchRecipe> = {
  solitaire: {
    ...ring,
    templateId: 'solitaire',
    keys: [
      'center.width',
      'band.widthTop',
      'band.thicknessTop',
      'head.prongDiameter',
      'center.placement.elevation',
    ],
    bands: {
      'center.width': [5, 9],
      'band.widthTop': [1.6, 4],
      'band.thicknessTop': [1.3, 2.6],
      'head.prongDiameter': [0.7, 1.4],
      'center.placement.elevation': [0.5, 3],
    },
    ties: bandTie,
    discrete: { field: 'head.prongCount', options: ['4', '6'] },
    depthLike: ['band.thicknessTop', 'center.placement.elevation'],
    parts: headAndBand(['head', 'center']),
  },
  halo: {
    ...ring,
    templateId: 'halo',
    keys: ['center.width', 'band.widthTop', 'halo.stoneWidth', 'halo.offset'],
    bands: {
      'center.width': [5, 8],
      'band.widthTop': [1.6, 3.5],
      'halo.stoneWidth': [1, 1.8],
      'halo.offset': [0.1, 0.6],
    },
    ties: bandTie,
    discrete: { field: 'halo.rows', options: ['1', '2'] },
    hide: ['row'],
    depthLike: [],
    parts: headAndBand(['head', 'center', 'halo']),
  },
  'three-stone': {
    ...ring,
    templateId: 'three-stone',
    keys: ['center.width', 'side1.width', 'band.widthTop'],
    bands: { 'center.width': [4.5, 7.5], 'side1.width': [2.5, 4.5], 'band.widthTop': [1.6, 3.5] },
    ties: { ...bandTie, 'side1.width': ['side2.width'] },
    depthLike: [],
    parts: headAndBand(['head', 'center', 'sideHead1', 'side1', 'sideHead2', 'side2']),
  },
  'wedding-band': {
    ...ring,
    templateId: 'wedding-band',
    keys: ['band.widthTop', 'band.thicknessTop'],
    bands: { 'band.widthTop': [2, 7], 'band.thicknessTop': [1.3, 2.6] },
    ties: { ...bandTie, 'band.thicknessTop': ['band.thicknessBottom'] },
    discrete: { field: 'band.profile', options: ['court', 'flat'] },
    depthLike: ['band.thicknessTop'],
  },
  eternity: {
    ...ring,
    templateId: 'eternity',
    keys: ['band.widthTop', 'band.thicknessTop', 'row.stoneWidth'],
    bands: {
      'band.widthTop': [2, 4],
      'band.thicknessTop': [1.4, 2.6],
      'row.stoneWidth': [1.5, 2.8],
    },
    ties: bandTie,
    depthLike: ['band.thicknessTop'],
  },
  signet: {
    ...ring,
    templateId: 'signet',
    keys: ['face.width', 'face.height', 'band.widthBottom', 'band.thicknessTop'],
    bands: {
      'face.width': [8, 14],
      'face.height': [9, 15],
      'band.widthBottom': [2.5, 4.5],
      'band.thicknessTop': [1.6, 3],
    },
    discrete: { field: 'face.outline', options: ['cushion', 'oval'] },
    depthLike: ['band.thicknessTop'],
    parts: headAndBand(['face']),
  },
  'pendant-solitaire': {
    ...pendant,
    templateId: 'pendant-solitaire',
    keys: ['head.wall', 'bail.opening', 'bail.width'],
    bands: { 'head.wall': [0.4, 1.2], 'bail.opening': [2.5, 5], 'bail.width': [2, 4] },
    discrete: { field: 'bail.style', options: ['loop', 'tube'] },
    hide: ['chain'],
    depthLike: [],
    parts: bodyAndBail(['head', 'center']),
    // The jeweler states the stone (0.5 ct in the template); its width sets the scale.
    anchor: (d) => ({
      type: 'stone',
      nodeId: 'center',
      widthMm: (d.nodes.center as { width: number }).width,
    }),
  },
  'name-pendant': {
    ...pendant,
    templateId: 'name-pendant',
    keys: ['body.thickness', 'bail.opening', 'bail.width'],
    bands: { 'body.thickness': [1, 2.5], 'bail.opening': [2.5, 5], 'bail.width': [2, 4] },
    hide: ['chain'],
    depthLike: ['body.thickness'],
    parts: bodyAndBail(['body']),
    anchor: (d) => ({
      type: 'height',
      nodeId: 'body',
      mm: (d.nodes.body as { height: number }).height,
    }),
  },
  studs: {
    kind: 'earrings',
    templateId: 'studs',
    keys: ['head.prongDiameter', 'post.length'],
    bands: { 'head.prongDiameter': [0.6, 1.2], 'post.length': [8, 12] },
    discrete: { field: 'head.prongCount', options: ['4', '6'] },
    depthLike: ['post.length'],
    parts: [
      { key: 'head', nodeIds: ['head', 'stone'] },
      { key: 'post', nodeIds: ['post'] },
    ],
    anchor: (d) => ({
      type: 'stone',
      nodeId: 'stone',
      widthMm: (d.nodes.stone as { width: number }).width,
    }),
    two: ['front', 'side'],
    heldOut: 'threeQuarter',
  },
  'iced-initial': {
    ...pendant,
    templateId: 'iced-initial',
    keys: ['body.thickness', 'bail.opening', 'bail.width'],
    bands: { 'body.thickness': [2.5, 5.5], 'bail.opening': [3, 7], 'bail.width': [3, 7] },
    hide: ['ice', 'chain'],
    depthLike: ['body.thickness'],
    parts: bodyAndBail(['body']),
    anchor: (d) => ({
      type: 'height',
      nodeId: 'body',
      mm: (d.nodes.body as { height: number }).height,
    }),
  },
}

/** The six cases every pull request runs (plan §12). */
export const PR_CASES: { templateId: string; views: ViewSet; level: Level; seed: number }[] = [
  { templateId: 'solitaire', views: 'one', level: 'clean', seed: 1 },
  { templateId: 'solitaire', views: 'two', level: 'clean', seed: 2 },
  { templateId: 'solitaire', views: 'one', level: 'noisy', seed: 3 },
  { templateId: 'wedding-band', views: 'two', level: 'clean', seed: 4 },
  { templateId: 'pendant-solitaire', views: 'one', level: 'clean', seed: 5 },
  { templateId: 'signet', views: 'two', level: 'clean', seed: 6 },
]

export interface BenchCase {
  id: string
  recipe: BenchRecipe
  viewSet: ViewSet
  level: Level
  seed: number
  start: Design
  truth: Design
  params: FitParam[]
  truthValues: number[]
  truthOption: string | null
  candidates: { id: string; ops: Op[] }[]
  anchorLabel: string
  views: TargetView[]
  truthCameras: Record<string, Camera>
  truthWeightG: number
  truthCarat: number
}

/** Metal weight and carats of what is drawn (a chain's weight would hide a pendant's error). */
export function visibleFacts(
  e: Evaluation,
  hide: readonly string[] = [],
): { weightG: number; carat: number } {
  let weightG = 0
  let carat = 0
  for (const p of e.parts)
    if (!hide.includes(p.nodeId))
      weightG += (p.volumeMm3 / 1000) * (METALS[p.material as MetalId]?.density ?? 0)
  for (const s of e.stones) if (!hide.includes(s.nodeId)) carat += s.carat
  return { weightG, carat }
}

const hasError = (e: Evaluation) => e.diagnostics.some((d) => d.level === 'error')

/** A random camera within 25° of a canon view. `near`: distance 3 to 6 × the piece (the `hard` level). */
function cameraNear(
  e: Evaluation,
  seed: ViewSeed,
  rnd: () => number,
  hide: string[],
  near: boolean,
): Camera {
  const U = (a: number, b: number) => a + (b - a) * rnd()
  const b = visibleBounds(e, hide)
  const diag = boundsDiagonal(b)
  const [az, el] = VIEW_SEEDS[seed]
  const elevation = el >= 65 ? 90 - U(0, 25) : el <= -65 ? -90 + U(0, 25) : el + U(-25, 25)
  const [lo, hi] = near ? [3, 6] : [5, 20]
  const cam: Camera = {
    azimuth: az + U(-25, 25),
    elevation,
    roll: U(-8, 8),
    distance: diag * Math.exp(U(Math.log(lo), Math.log(hi))),
    span: diag,
    shift: [0, 0],
    target: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2],
  }
  // Fill: the larger side of the subject's projected box covers 50 to 75 % of the frame.
  const fill = U(0.5, 0.75)
  const n = 128
  const r = rasterize(e, cam, { width: n, height: n }, { hide })
  let x0 = n
  let x1 = -1
  let y0 = n
  let y1 = -1
  for (let k = 0; k < n * n; k++)
    if (r.cls[k]) {
      const x = k % n
      const y = (k - x) / n
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
  const extent = x1 >= 0 ? Math.max(x1 - x0 + 1, y1 - y0 + 1) / n : 0.5
  cam.span = (cam.span * extent) / fill
  cam.shift = [U(-0.05, 0.05), U(-0.05, 0.05)]
  return cam
}

function viewOf(
  e: Evaluation,
  c: Camera,
  px: number,
  id: string,
  hide: string[],
  partsOf: BenchRecipe['parts'] = [],
): TargetView {
  const size = { width: px, height: px }
  const r = rasterize(e, c, size, { hide })
  const marks = projectStones(e, c, size).filter((m) => !hide.includes(m.id.split(':')[0]!))
  // Part masks as a segmenter would draw them: each region's visible pixels.
  const parts = partsOf
    .map((p) => {
      const want = new Set(p.nodeIds.map((n) => r.nodeIds.indexOf(n) + 1).filter((k) => k > 0))
      return { ...p, mask: Uint8Array.from(r.node, (n) => (want.has(n) ? 1 : 0)) }
    })
    .filter((p) => p.mask.some((x) => x))
  return {
    id,
    width: px,
    height: px,
    matte: r.cls.map((v) => (v ? 1 : 0)),
    stones: r.cls.map((v) => (v === 2 ? 1 : 0)),
    ...(parts.length ? { parts } : {}),
    // Feature stones only: pavé fields are counted, not matched one by one.
    ...(marks.length && marks.length <= 12
      ? { marks: marks.map(({ x, y, d }) => ({ x, y, d })) }
      : {}),
  }
}

export async function makeCase(
  o: {
    templateId: string
    views: ViewSet
    level: Level
    seed: number
    px?: number
    template: Design
  },
  evaluate: Evaluate,
): Promise<BenchCase> {
  const recipe = BENCH_RECIPES[o.templateId]
  if (!recipe) throw new Error(`no bench recipe for ${o.templateId}`)
  const rnd = mulberry32(o.seed * 7919 + o.templateId.length)
  const px = o.px ?? 192
  const hide = recipe.hide ?? []
  const params = paramsFor(o.template, recipe.keys, { bands: recipe.bands, ties: recipe.ties })

  // Truth: uniform inside the bands (widened for `misspec`), redrawn until the kernel reports no error.
  const misspec = o.level === 'misspec'
  const schemaRange = paramsFor(o.template, recipe.keys)
  const drawFrom = params.map((p, j) => {
    if (!misspec) return p
    const pad = 0.3 * (p.max - p.min)
    const s = schemaRange[j]!
    return { ...p, min: Math.max(s.min, p.min - pad), max: Math.min(s.max, p.max + pad) }
  })
  let truth: Design | null = null
  let truthEv: Evaluation | null = null
  let truthValues: number[] = []
  let truthOption: string | null = null
  for (let tries = 0; tries < 20 && !truth; tries++) {
    truthValues = drawFrom.map((p) => {
      const v = p.min + (p.max - p.min) * rnd()
      return p.integer ? Math.round(v) : Math.round(v * 100) / 100
    })
    truthOption = recipe.discrete
      ? recipe.discrete.options[Math.floor(rnd() * recipe.discrete.options.length)]!
      : null
    const extra =
      recipe.discrete && truthOption ? [fieldOp(recipe.discrete.field, truthOption)] : []
    const held = misspec ? heldFieldOps(o.template, recipe, rnd) : []
    // Held fields first; the free numbers (and the taper's own bottom width) after.
    const d = applyOps(o.template, [
      ...held,
      ...extra,
      ...opsFor(drawFrom, truthValues),
      ...(misspec ? taperOps(o.template, recipe, truthValues, params, rnd) : []),
    ]).design
    const e = await evaluate(d)
    if (!hasError(e)) {
      truth = d
      truthEv = e
    }
  }
  if (!truth || !truthEv) throw new Error(`${o.templateId}: no error-free truth in 20 draws`)

  // Scale: the anchor is read from the truth; `hard` gets a 3 % error on it.
  let anchor = recipe.anchor(truth)
  if (o.level === 'hard') {
    const k = 1 + (rnd() < 0.5 ? -0.03 : 0.03)
    if (anchor.type === 'ringSize')
      anchor = {
        ...anchor,
        size: { system: 'mm', value: Math.round(ringInnerDiameter(anchor.size) * k * 100) / 100 },
      }
    else if (anchor.type === 'height') anchor = { ...anchor, mm: anchor.mm * k }
    else if (anchor.type === 'stone' && anchor.widthMm)
      anchor = { ...anchor, widthMm: anchor.widthMm * k }
  }
  const a = applyAnchor(o.template, anchor)
  const start = applyOps(o.template, a.ops).design
  const fitParams = paramsFor(start, recipe.keys, {
    bands: recipe.bands,
    ties: recipe.ties,
    pins: a.pins,
  })

  const seeds: ViewSeed[] =
    o.views === 'one' ? ['threeQuarter'] : o.views === 'top' ? ['top'] : recipe.two
  const views: TargetView[] = []
  const truthCameras: Record<string, Camera> = {}
  const near = o.level === 'hard'
  for (const [j, s] of [...seeds, recipe.heldOut].entries()) {
    const id = j < seeds.length ? `${s}` : `held-${s}`
    const cam = cameraNear(truthEv, s, rnd, hide, near)
    truthCameras[id] = cam
    const v = degrade(
      viewOf(truthEv, cam, px, id, hide, recipe.parts),
      j < seeds.length ? o.level : 'clean',
      rnd,
    )
    // The read's view label seeds the pose search: a camera off by up to 25°.
    views.push({
      ...v,
      seed: { azimuth: VIEW_SEEDS[s][0], elevation: VIEW_SEEDS[s][1] },
      ...(j >= seeds.length ? { heldOut: true } : {}),
    })
  }

  const candidates = recipe.discrete
    ? recipe.discrete.options.map((v) => ({ id: v, ops: [fieldOp(recipe.discrete!.field, v)] }))
    : [{ id: '-', ops: [] }]
  const facts = visibleFacts(truthEv, hide)
  return {
    id: `${o.templateId}/${o.views}/${o.level}/${o.seed}`,
    recipe,
    viewSet: o.views,
    level: o.level,
    seed: o.seed,
    start,
    truth,
    params: fitParams,
    truthValues,
    truthOption,
    candidates,
    anchorLabel: a.label,
    views,
    truthCameras,
    truthWeightG: facts.weightG,
    truthCarat: facts.carat,
  }
}

/**
 * `misspec`: changes to fields the fit holds fixed, as a real piece has them. Only fields the
 * template has, and never the recipe's own discrete field.
 */
function heldFieldOps(d: Design, recipe: BenchRecipe, rnd: () => number): Op[] {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!
  const own = recipe.discrete?.field
  const ops: Op[] = []
  const band = d.nodes.band as { kind?: string } | undefined
  if (band?.kind === 'ringShank') {
    const patch: Record<string, unknown> = {
      size: { system: 'us', value: Math.round((4.5 + rnd() * 5.5) * 4) / 4 },
    }
    if (own !== 'band.profile')
      patch.profile = pick(['court', 'dShape', 'flat', 'flatCourt', 'knifeEdge'])
    // Shoulders only where a head rises from the band.
    if (d.nodes.head) patch.shoulder = pick(['plain', 'cathedral', 'split'])
    ops.push({ t: 'update', id: 'band', patch })
  }
  const head = d.nodes.head as { kind?: string; style?: string } | undefined
  if (head?.kind === 'setting' && (head.style ?? 'prong') === 'prong') {
    const patch: Record<string, unknown> = { taper: Math.round(rnd() * 80) / 100 }
    if (own !== 'head.prongTip') patch.prongTip = pick(['round', 'claw', 'tab', 'double'])
    ops.push({ t: 'update', id: 'head', patch })
  }
  return ops
}

/** `misspec`: a tapered band, its base 50 to 100 % of its top, where the recipe ties the two. */
function taperOps(
  d: Design,
  recipe: BenchRecipe,
  values: number[],
  params: FitParam[],
  rnd: () => number,
): Op[] {
  const j = params.findIndex((p) => p.key === 'band.widthTop')
  if (j < 0 || !recipe.ties?.['band.widthTop']?.includes('band.widthBottom')) return []
  if ((d.nodes.band as { kind?: string } | undefined)?.kind !== 'ringShank') return []
  const top = values[j]!
  const bottom = Math.max(1, Math.round(top * (0.5 + 0.5 * rnd()) * 100) / 100)
  return [{ t: 'update', id: 'band', patch: { widthBottom: bottom } }]
}
