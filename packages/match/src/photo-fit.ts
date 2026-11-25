/**
 * One photo, one built design: the assistant's `match.fit`. The free numbers are the few that a
 * recipe's outline depends on (plan §7's table), found on whatever nodes the design has; each is
 * searched within ±40 % of its built value (the canon set it, the photo moves it), the camera is
 * searched from the read's view, and what the photo could not see is marked and reset by the
 * observability check. Scale stays where the design put it: the ring size or the body height
 * holds it, and the camera's span absorbs the rest.
 */
import { type Design, resolveDesign } from '@pave/schema'
import { VIEW_SEEDS, type ViewSeed } from './camera'
import { fitDesign } from './fit'
import { Stop } from './guard'
import { observability } from './observe'
import { paramsFor } from './params'
import type { Evaluate, FitInput, FitParam, FitResult, TargetView } from './types'

/** Candidate numbers in priority order; only those the design has are fitted. */
const CANDIDATES = [
  'center.width',
  'band.widthTop',
  'band.thicknessTop',
  'head.prongDiameter',
  'halo.stoneWidth',
  'side1.width',
  'row.stoneWidth',
  'face.width',
  'face.height',
  'body.thickness',
  'bail.opening',
  'bail.width',
] as const

/** At most this many numbers: each one costs evaluations, and one photo constrains few. */
export const MAX_FIT_KEYS = 5

/** Nodes left out of the outline: chains dwarf a pendant, pavé is slow and adds no outline. */
const HIDDEN_KINDS = new Set(['chain', 'pave'])

export interface PhotoFitPlan {
  params: FitParam[]
  hide: string[]
}

/** The numbers to fit on this design, with ties (both sides of a band move together). */
export function photoFitPlan(design: Design): PhotoFitPlan {
  // The numbers as built: a follow field left to the stone (the claw wire) has no stored value,
  // but it is in the outline all the same (paramsFor starts from the same resolved design).
  const built = resolveDesign(design)
  const ties: Record<string, string[]> = {}
  const has = (key: string) => {
    const [id, field] = key.split('.') as [string, string]
    const node = built.nodes[id] as Record<string, unknown> | undefined
    return typeof node?.[field] === 'number'
  }
  if (has('band.widthBottom')) ties['band.widthTop'] = ['band.widthBottom']
  if (has('side2.width')) ties['side1.width'] = ['side2.width']
  // A plain band has no head to tell its thickness top from bottom.
  if (!design.nodes.center && has('band.thicknessBottom'))
    ties['band.thicknessTop'] = ['band.thicknessBottom']
  const params: FitParam[] = []
  for (const key of CANDIDATES) {
    if (params.length >= MAX_FIT_KEYS) break
    if (!has(key)) continue
    const [id, field] = key.split('.') as [string, string]
    const start = (built.nodes[id] as unknown as Record<string, number>)[field]!
    try {
      const [p] = paramsFor(design, [key], {
        bands: { [key]: [start * 0.6, start * 1.4] },
        ...(ties[key] ? { ties: { [key]: ties[key]! } } : {}),
      })
      params.push(p!)
    } catch {
      // A field without a declared range, or a band outside it: not fitted, kept as built.
    }
  }
  const hide = Object.entries(design.nodes)
    .filter(([, n]) => HIDDEN_KINDS.has((n as { kind: string }).kind))
    .map(([id]) => id)
  return { params, hide }
}

export interface PhotoFitInput {
  design: Design
  /** The photo's matte at its working resolution. */
  matte: Uint8Array
  width: number
  height: number
  view?: ViewSeed
  evaluate: Evaluate
  budgetMs: number
  signal?: AbortSignal
}

export interface PhotoFitOutcome {
  result: FitResult
  params: { key: string; from: number; to: number; status: FitResult['params'][number]['status'] }[]
  overlap: number | null
  camera: { azimuth: number; elevation: number } | null
}

export async function fitToPhoto(i: PhotoFitInput): Promise<PhotoFitOutcome> {
  const plan = photoFitPlan(i.design)
  const view: TargetView = {
    id: 'photo',
    width: i.width,
    height: i.height,
    matte: i.matte,
    ...(i.view
      ? { seed: { azimuth: VIEW_SEEDS[i.view][0], elevation: VIEW_SEEDS[i.view][1] } }
      : {}),
  }
  const input: FitInput = {
    design: i.design,
    params: plan.params,
    views: [view],
    evaluate: i.evaluate,
    hide: plan.hide,
    // A quarter of the evaluations is kept for checking what the photo could see.
    budget: { evaluations: 200, ms: i.budgetMs, reserve: 50 },
    ...(i.signal ? { signal: i.signal } : {}),
  }
  let result = await fitDesign(input)
  try {
    result = await observability(result, input)
  } catch (err) {
    // Out of time or cancelled during the check: the fit stands, its numbers stay "fitted".
    if (!(err instanceof Stop)) throw err
  }
  const score = result.scores.photo
  const camera = result.cameras.photo
  return {
    result,
    params: result.params.map((p) => ({
      key: p.key,
      from: plan.params.find((q) => q.key === p.key)!.start,
      to: p.value,
      status: p.status,
    })),
    overlap: score ? score.iou : null,
    camera: camera ? { azimuth: camera.azimuth, elevation: camera.elevation } : null,
  }
}
