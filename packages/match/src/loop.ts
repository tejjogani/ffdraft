/**
 * Steps 4 to 12 of the loop (plan §2), deterministic and keyless: the read picks the recipe and
 * orders the discrete candidates; the anchor fixes scale; each photo gets a camera; unsure
 * choices are settled by building them, one field at a time, most consequential first; the free
 * numbers are fitted; what the photos could not see is marked assumed or weak; whatever stays
 * open becomes a question ranked by consequence; and a fit under the floor is not passed off as a
 * design: the outcome says so and routes the piece down the ladder (plan §4, §8 "failing safely").
 */
import { applyOps, type Design, type Op } from '@pave/schema'
import { rankQuestions } from './ask'
import { boundsDiagonal, VIEW_SEEDS, visibleBounds } from './camera'
import { chooseDiscrete } from './choose'
import { FINE_PX, fitDesign, viewAt, WORK_PX, withoutHidden } from './fit'
import { observability } from './observe'
import { paramsFor } from './params'
import { rasterize } from './raster'
import { type PhotoRead, type PhotoReader, readStatus } from './read'
import { routePart } from './route'
import { applyAnchor, mmPerPixel } from './scale'
import { checkTarget } from './score'
import type {
  Evaluate,
  FitInput,
  FitResult,
  Question,
  ScaleAnchor,
  TargetView,
  ViewScore,
} from './types'

/** What the loop needs to know about a recipe; the canon supplies it in the product. */
export interface Recipe {
  templateId: string
  design: Design
  /** Continuous free numbers (at most 12). */
  keys: string[]
  bands?: Record<string, [number, number]>
  ties?: Record<string, string[]>
  /** Discrete fields and their options, as strings. */
  discrete?: Record<string, string[]>
  /** Nodes left out of rendering (chain, pavé). */
  hide?: string[]
}

type Route = ReturnType<typeof routePart>

export interface MatchOutcome {
  read: PhotoRead
  templateId: string
  anchorLabel: string
  scaleAssumed: boolean
  /**
   * One entry per discrete field, each with its own margin. `built`: the options fitted; any
   * option left out by `maxCandidates` is listed in `notBuilt`, never silently dropped.
   */
  choices: {
    field: string
    value: string
    status: 'seen' | 'decided' | 'question'
    margin: number | null
    built: string[]
    notBuilt: string[]
  }[]
  result: FitResult
  questions: Question[]
  /**
   * Whether the recipe explains the photos. `good`: use the design. `poor`: the best fit is under
   * the floor; `route` says what to build instead (outline, relief or a generated mesh), and
   * the design is only a starting point. `failed`: nothing was fitted (a refused photo, a design
   * that does not build, or a cancelled run); `reason` says which.
   */
  fit: {
    quality: FitResult['quality']
    reason: string
    route: Route | null
    /** Per named part of each fitted view, when the views carry part masks. */
    parts: { viewId: string; key: string; iou: number; route: Route }[]
  }
}

function parseValue(s: string): string | number | boolean {
  if (s === 'true' || s === 'false') return s === 'true'
  const n = Number(s)
  return s.trim() !== '' && Number.isFinite(n) ? n : s
}

/** An op setting a discrete field (`head.prongCount` = "6"). */
export function fieldOp(key: string, value: string): Op {
  const [id, ...path] = key.split('.')
  const patch: Record<string, unknown> = {}
  let o = patch
  for (const p of path.slice(0, -1)) {
    o[p] = {}
    o = o[p] as Record<string, unknown>
  }
  o[path[path.length - 1]!] = parseValue(value)
  return { t: 'update', id: id!, patch }
}

export async function runMatch(i: {
  views: TargetView[]
  reader: PhotoReader
  recipes: Recipe[]
  anchor?: ScaleAnchor
  evaluate: Evaluate
  budget?: FitInput['budget']
  /** Most options built per open discrete field. Default 4; the rest are reported in `notBuilt`. */
  maxCandidates?: number
  observe?: boolean
  signal?: AbortSignal
}): Promise<MatchOutcome> {
  const read = await i.reader.read(i.views, { signal: i.signal })
  const recipe = i.recipes.find((r) => r.templateId === read.template.value)
  if (!recipe) throw new Error(`runMatch: no recipe "${read.template.value}"`)
  const anchor = applyAnchor(recipe.design, i.anchor ?? { type: 'assumed' })
  const hide = recipe.hide ?? []

  // View labels seed the pose search; a reference object holds that view's span.
  const views = i.views.map((v) => {
    const label = read.views.find((x) => x.viewId === v.id)?.label
    const seed = label && label !== 'onBody' ? VIEW_SEEDS[label] : undefined
    return {
      ...v,
      ...(seed && !v.seed ? { seed: { azimuth: seed[0], elevation: seed[1] } } : {}),
      ...(anchor.spanMm?.viewId === v.id ? { spanMm: anchor.spanMm.span } : {}),
    }
  })
  // onBody photos are read, not fitted.
  const fitViews = views.filter(
    (v) => read.views.find((x) => x.viewId === v.id)?.label !== 'onBody',
  )

  // Seen fields are applied; unsure and assumed ones are settled by building, the read's answer first.
  const fixed: Op[] = []
  const open: { field: string; options: string[] }[] = []
  for (const [field, options] of Object.entries(recipe.discrete ?? {})) {
    const r = read.fields[field]
    if (r && readStatus(r) === 'seen') fixed.push(fieldOp(field, r.value))
    else {
      const first = r?.value ?? options[0]!
      open.push({ field, options: [first, ...options.filter((o) => o !== first)] })
    }
  }

  const base = applyOps(recipe.design, [...anchor.ops, ...fixed]).design
  const params = paramsFor(base, recipe.keys, {
    bands: recipe.bands,
    pins: anchor.pins,
    ties: recipe.ties,
  })
  const observe = i.observe !== false
  const free = params.filter((p) => !p.pinned && p.max > p.min).length
  const input: FitInput = {
    design: base,
    params,
    views: fitViews,
    evaluate: i.evaluate,
    hide,
    // The visibility check runs under the same budget: two builds per number, plus one.
    budget: { ...i.budget, ...(observe ? { reserve: 2 * free + 2 } : {}) },
    signal: i.signal,
  }
  const cap = i.maxCandidates ?? 4

  // A refused photo stops here, before any build.
  const refused = fitViews.some((v) => !v.heldOut && checkTarget(v))
  const settled: Op[] = []
  const choices: MatchOutcome['choices'] = []
  const questionInputs: Parameters<typeof rankQuestions>[0] = []
  let result: FitResult | null = null

  if (!refused && open.length) {
    // Most consequential first: what each option changes in metal and carats, by one build each.
    const order = await consequenceOrder(base, open, i.evaluate, hide, i.signal)
    for (const f of order) {
      const built = f.options.slice(0, Math.max(1, cap))
      const later = order.filter((o) => o !== f && !settled.some((s) => isField(s, o.field)))
      const design = applyOps(base, [
        ...settled,
        ...later.map((o) => fieldOp(o.field, o.options[0]!)),
      ]).design
      const c = await chooseDiscrete({
        ...input,
        design,
        candidates: built.map((v) => ({ id: v, ops: [fieldOp(f.field, v)] })),
      })
      const winner = c.ranked[0]!
      settled.push(fieldOp(f.field, winner.id))
      result = winner.result
      const decided = built.length < 2 || c.decided
      choices.push({
        field: f.field,
        value: winner.id,
        status: decided ? 'decided' : 'question',
        margin: built.length > 1 ? c.margin : null,
        built,
        notBuilt: f.options.slice(built.length),
      })
      if (!decided)
        questionInputs.push({
          field: f.field,
          options: await questionOptions(c.ranked, fitViews, i.evaluate, hide, i.signal),
        })
      if (winner.result.quality === 'failed') break
    }
  }
  result ??= await fitDesign(input)
  if (observe) result = await observability(result, input)

  // Seen fields first, in the recipe's order, then the settled ones in the order they were settled.
  const seen = Object.keys(recipe.discrete ?? {})
    .filter((f) => !open.some((o) => o.field === f))
    .map((field) => ({
      field,
      value: read.fields[field]!.value,
      status: 'seen' as const,
      margin: null,
      built: [],
      notBuilt: [],
    }))
  // Fields never settled (the run stopped first) keep the read's answer, as questions.
  const unsettled = open
    .filter((o) => !choices.some((c) => c.field === o.field))
    .map((o) => ({
      field: o.field,
      value: o.options[0]!,
      status: 'question' as const,
      margin: null,
      built: [],
      notBuilt: o.options,
    }))

  return {
    read,
    templateId: recipe.templateId,
    anchorLabel: anchor.label,
    scaleAssumed: anchor.assumed,
    choices: [...seen, ...choices, ...unsettled],
    result,
    questions: rankQuestions(questionInputs),
    fit: await verdict(result, fitViews, read, i.evaluate, hide, i.signal),
  }
}

const isField = (op: Op, field: string) => {
  const [id, ...path] = field.split('.')
  if (op.t !== 'update' || op.id !== id) return false
  let o: unknown = op.patch
  for (const p of path) o = (o as Record<string, unknown> | undefined)?.[p]
  return o !== undefined
}

/** Open fields ordered by how much their options change metal weight and carats. */
async function consequenceOrder(
  base: Design,
  open: { field: string; options: string[] }[],
  evaluate: Evaluate,
  hide: string[],
  signal?: AbortSignal,
) {
  const lean = withoutHidden(base, hide)
  const firsts = open.map((o) => fieldOp(o.field, o.options[0]!))
  const scored: { f: (typeof open)[number]; k: number; weight: number }[] = []
  for (const [k, f] of open.entries()) {
    const facts: { massG: number; carat: number }[] = []
    for (const v of f.options) {
      const ops = firsts.map((op, j) => (j === k ? fieldOp(f.field, v) : op))
      try {
        const e = await evaluate(applyOps(lean, ops).design, signal)
        facts.push({ massG: e.report.metalMassG, carat: e.report.caratTotal })
      } catch {
        // An option that does not build has no consequence to weigh; it is still fitted.
      }
    }
    const lead = facts[0]
    let weight = 0
    if (lead)
      for (const x of facts.slice(1))
        weight = Math.max(
          weight,
          Math.abs(x.massG - lead.massG) / Math.max(lead.massG, 0.01) +
            Math.abs(x.carat - lead.carat) / Math.max(lead.carat, 0.05),
        )
    scored.push({ f, k, weight })
  }
  return scored.sort((a, b) => b.weight - a.weight || a.k - b.k).map((x) => x.f)
}

/** Each ranked option's metal, carats and outline change against the leader, at the first view's camera. */
async function questionOptions(
  ranked: { id: string; result: FitResult }[],
  views: TargetView[],
  evaluate: Evaluate,
  hide: string[],
  signal?: AbortSignal,
) {
  const v0 = views.find((v) => !v.heldOut)!
  const cam = ranked[0]!.result.cameras[v0.id]
  const w = viewAt(v0, WORK_PX)
  const size = { width: w.width, height: w.height }
  const options = []
  let lead: Uint8Array | null = null
  for (const r of ranked) {
    const e = await evaluate(withoutHidden(r.result.design, hide), signal)
    const cls = cam ? rasterize(e, cam, size, { hide }).cls : new Uint8Array(0)
    let xor = 0
    let area = 0
    if (lead)
      for (let k = 0; k < cls.length; k++) {
        if (!!cls[k] !== !!lead[k]) xor++
        if (lead[k]) area++
      }
    lead ??= cls
    options.push({
      id: r.id,
      massG: e.report.metalMassG,
      carat: e.report.caratTotal,
      xorFraction: area ? xor / area : 0,
    })
  }
  return options
}

/** Whether the recipe explains the photos, and where to go when it does not (plan §4). */
async function verdict(
  r: FitResult,
  views: TargetView[],
  read: PhotoRead,
  evaluate: Evaluate,
  hide: string[],
  signal?: AbortSignal,
): Promise<MatchOutcome['fit']> {
  const fitted = views.filter((v) => !v.heldOut && r.scores[v.id] && r.cameras[v.id])
  const flat = read.kind === 'pendant' || read.kind === 'brooch'
  const parts: MatchOutcome['fit']['parts'] = []
  for (const v of fitted) {
    const s = r.scores[v.id]!
    const fine = viewAt(v, FINE_PX)
    const mmPx = mmPerPixel(r.cameras[v.id]!, { width: fine.width, height: fine.height })
    for (const p of s.parts) {
      const mask = fine.parts?.find((x) => x.key === p.key)?.mask
      parts.push({
        viewId: v.id,
        key: p.key,
        iou: p.iou,
        route: routePart({
          iou: p.iou,
          edgeMm: p.edgePx * mmPx,
          sizeMm: mask ? extentPx(mask, fine.width) * mmPx : 0,
          flat,
          realViews: fitted.length,
        }),
      })
    }
  }
  if (r.quality === 'failed') {
    const why = r.diagnostics.filter((d) => d.level === 'error').map((d) => d.message)
    return {
      quality: 'failed',
      reason: why.join(' ') || `Nothing was fitted (${r.stopped}).`,
      route: null,
      parts,
    }
  }
  if (r.quality === 'good')
    return {
      quality: 'good',
      reason: 'Every fitted view is at or above the floor.',
      route: null,
      parts,
    }
  // Poor: route the whole piece from its worst view.
  const worst = fitted
    .map((v) => ({ v, s: r.scores[v.id]! }))
    .sort((a, b) => a.s.looseIou - b.s.looseIou)[0]!
  const e = await evaluate(withoutHidden(r.design, hide), signal)
  const sizeMm = boundsDiagonal(visibleBounds(e, hide))
  const route = routePart({
    iou: worst.s.looseIou,
    edgeMm: worst.s.edgeMm,
    sizeMm,
    flat,
    realViews: fitted.length,
    stoneIou: worst.s.stoneIou,
  })
  const why = r.diagnostics.find((d) => d.code === 'match.poorFit')?.message ?? scoreLine(worst.s)
  return { quality: 'poor', reason: why, route, parts }
}

const scoreLine = (s: ViewScore) => `loose overlap ${s.looseIou.toFixed(3)}`

/** The larger side of a mask's bounding box, in pixels. */
function extentPx(mask: Uint8Array, width: number): number {
  let x0 = Infinity
  let x1 = -1
  let y0 = Infinity
  let y1 = -1
  for (let k = 0; k < mask.length; k++)
    if (mask[k]) {
      const x = k % width
      const y = (k - x) / width
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  return x1 < 0 ? 0 : Math.max(x1 - x0 + 1, y1 - y0 + 1)
}
