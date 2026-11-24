/**
 * Steps 4 to 12 of the loop (plan §2), deterministic and keyless: the read picks the recipe and
 * orders the discrete candidates; the anchor fixes scale; each photo gets a camera; unsure
 * choices are settled by building them; the free numbers are fitted; what the photos could not
 * see is marked assumed; whatever stays open becomes a question ranked by consequence.
 */
import { applyOps, type Design, type Op } from '@pave/schema'
import { rankQuestions } from './ask'
import { VIEW_SEEDS } from './camera'
import { chooseDiscrete } from './choose'
import { fitDesign, viewAt, WORK_PX } from './fit'
import { observability } from './observe'
import { paramsFor } from './params'
import { rasterize } from './raster'
import { type PhotoRead, type PhotoReader, readStatus } from './read'
import { applyAnchor } from './scale'
import type { Evaluate, FitInput, FitResult, Question, ScaleAnchor, TargetView } from './types'

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

export interface MatchOutcome {
  read: PhotoRead
  templateId: string
  anchorLabel: string
  scaleAssumed: boolean
  choices: {
    field: string
    value: string
    status: 'seen' | 'decided' | 'question'
    margin: number | null
  }[]
  result: FitResult
  questions: Question[]
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
  /** Most candidate builds for the open discrete fields. Default 4. */
  maxCandidates?: number
  observe?: boolean
  signal?: AbortSignal
}): Promise<MatchOutcome> {
  const read = await i.reader.read(i.views, { signal: i.signal })
  const recipe = i.recipes.find((r) => r.templateId === read.template.value)
  if (!recipe) throw new Error(`runMatch: no recipe "${read.template.value}"`)
  const anchor = applyAnchor(recipe.design, i.anchor ?? { type: 'assumed' })

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

  // Seen fields are applied; unsure and assumed ones become candidates, the read's answer first.
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
  let candidates: { id: string; ops: Op[] }[] = [{ id: '', ops: [] }]
  for (const f of open)
    candidates = candidates.flatMap((c) =>
      f.options.map((v) => ({
        id: c.id ? `${c.id},${f.field}=${v}` : `${f.field}=${v}`,
        ops: [...c.ops, fieldOp(f.field, v)],
      })),
    )
  candidates = candidates.slice(0, i.maxCandidates ?? 4)

  const base = applyOps(recipe.design, [...anchor.ops, ...fixed]).design
  const params = paramsFor(base, recipe.keys, {
    bands: recipe.bands,
    pins: anchor.pins,
    ties: recipe.ties,
  })
  const input: FitInput = {
    design: base,
    params,
    views: fitViews,
    evaluate: i.evaluate,
    hide: recipe.hide,
    budget: i.budget,
    signal: i.signal,
  }

  let result: FitResult
  let margin: number | null = null
  let decided = true
  let ranked: { id: string; result: FitResult }[] = []
  if (candidates.length > 1) {
    const c = await chooseDiscrete({ ...input, candidates })
    ranked = c.ranked
    result = c.ranked[0]!.result
    margin = c.margin
    decided = c.decided
  } else result = await fitDesign(input)
  if (i.observe !== false) result = await observability(result, { ...input, design: base })

  const winner = ranked[0]?.id ?? ''
  const chosen = new Map(
    winner ? winner.split(',').map((kv) => kv.split('=') as [string, string]) : [],
  )
  const choices: MatchOutcome['choices'] = [
    ...Object.entries(recipe.discrete ?? {})
      .filter(([f]) => !open.some((o) => o.field === f))
      .map(([field]) => ({
        field,
        value: read.fields[field]!.value,
        status: 'seen' as const,
        margin: null,
      })),
    ...open.map((o) => ({
      field: o.field,
      value: chosen.get(o.field) ?? o.options[0]!,
      status: decided ? ('decided' as const) : ('question' as const),
      margin,
    })),
  ]

  // Open choices become questions, weighed by what each answer would change.
  let questions: Question[] = []
  if (!decided && ranked.length > 1) {
    const v0 = fitViews.find((v) => !v.heldOut)!
    const cam = result.cameras[v0.id]!
    const w = viewAt(v0, WORK_PX)
    const size = { width: w.width, height: w.height }
    const options = []
    let lead: Uint8Array | null = null
    for (const r of ranked) {
      const e = await i.evaluate(r.result.design, i.signal)
      const cls = rasterize(e, cam, size, { hide: recipe.hide }).cls
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
    questions = rankQuestions([{ field: open.map((o) => o.field).join(' + '), options }])
  }

  return {
    read,
    templateId: recipe.templateId,
    anchorLabel: anchor.label,
    scaleAssumed: anchor.assumed,
    choices,
    result,
    questions,
  }
}
