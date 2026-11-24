/**
 * Design directions on a piece (see @pave/schema design/directions.ts for why they live on the
 * piece): built here with the canon's proportions, evaluated, priced roughly and drawn, then
 * stored with their designs. Choosing one makes its design the piece's, as one undoable change.
 */
import { lintDesign, suggestDesign } from '@pave/canon'
import { roughCost } from '@pave/production'
import {
  buildDesign,
  type CommandParsedInput,
  type Design,
  type Direction,
  type DirectionFacts,
  directionLetter,
  type EvaluationSummary,
  MAX_DIRECTIONS,
  mixSpecs,
  type PieceSpec,
  PieceSpecSchema,
  planDesign,
  STAGES,
  type StoredDirection,
  TEMPLATES,
} from '@pave/schema'
import { and, eq } from 'drizzle-orm'
import { putAsset } from './assets/assets'
import { type Ctx, publish } from './context'
import * as t from './db/schema'
import { commitChange, FACTS_DETAIL, replaceDesignOps } from './design'
import { badRequest, conflict, notFound } from './errors'
import { createId } from './ids'
import { getPiece } from './lookups'
import { pngOf } from './photos'
import { serviceContext } from './service-context'

type PieceRow = typeof t.piece.$inferSelect
type ProposeInput = CommandParsedInput<'pieces.proposeDirections'>
type Item = ProposeInput['directions'][number]

/** The direction as the API shows it: everything but its design. */
export const toDirection = ({ design: _design, ...d }: StoredDirection): Direction => d

/** Up to this many findings per card; the rest are in the evaluation once it is chosen. */
const MAX_NOTES = 6
const PREVIEW_SIZE = 512

/** A direction named by id or by letter ("B"), which is how people and the model refer to them. */
function find(directions: readonly StoredDirection[], key: string): StoredDirection | undefined {
  return directions.find((d) => d.id === key || d.letter === key.trim().toUpperCase())
}

interface Resolved {
  spec: PieceSpec
  name: string
  idea: string
  origin: Direction['origin']
  basis: string | null
}

const firstSentence = (s: string) => (s.match(/^.*?[.!?](\s|$)/)?.[0] ?? s).trim().slice(0, 240)

function resolve(ctx: Ctx, item: Item, existing: readonly StoredDirection[]): Resolved {
  const byAssistant = ctx.actor.type === 'agent'
  if (item.templateId) {
    const template = TEMPLATES.find((x) => x.id === item.templateId)
    if (!template) throw badRequest(`Unknown template "${item.templateId}"`)
    const spec = PieceSpecSchema.parse(template.spec)
    return {
      spec,
      name: item.name ?? spec.title,
      idea: item.idea ?? firstSentence(spec.summary),
      origin: byAssistant ? 'assistant' : 'template',
      basis: null,
    }
  }
  if (item.mix) {
    const base = find(existing, item.mix.base)
    if (!base) throw notFound('Direction', item.mix.base)
    const takes = item.mix.take.map((take) => {
      const from = find(existing, take.from)
      if (!from) throw notFound('Direction', take.from)
      return { from, parts: take.parts }
    })
    let spec: PieceSpec
    try {
      spec = mixSpecs(
        base.spec,
        takes.map((x) => ({ spec: x.from.spec, parts: x.parts })),
      )
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : String(err))
    }
    const lent = takes.map((x) => `${x.parts.join(' and ')} of ${x.from.letter}`)
    const basis = `${lent.join(', ')}, the rest of ${base.letter}`
    const name = item.name ?? `${base.letter} with ${takes.map((x) => x.from.letter).join(', ')}`
    return {
      spec: { ...spec, title: item.name ?? spec.title },
      name,
      idea:
        item.idea ??
        `${base.name} with the ${takes
          .map((x) => `${x.parts.join(' and ')} of ${x.from.name}`)
          .join(', and the ')}.`,
      origin: 'mix',
      basis,
    }
  }
  const spec = item.spec!
  return {
    spec,
    name: item.name ?? spec.title,
    idea: item.idea ?? firstSentence(spec.summary),
    origin: byAssistant ? 'assistant' : 'person',
    basis: null,
  }
}

/** The canon's design for a spec; the plain recipe when the canon cannot read it. */
function designFor(spec: PieceSpec): { design: Design; notes: string[] } {
  const recipe = planDesign(spec)
  try {
    return { design: suggestDesign(spec, { correct: false }).design, notes: recipe.notes }
  } catch {
    return { design: buildDesign(spec), notes: recipe.notes }
  }
}

function factsOf(summary: EvaluationSummary): DirectionFacts {
  let costUsd: number | null = null
  try {
    const cost = roughCost(summary).perPiece.cost
    costUsd = cost > 0 ? Math.round(cost) : null
  } catch {
    costUsd = null
  }
  return {
    metalMassG: summary.metalMassG,
    caratTotal: summary.caratTotal,
    stoneCount: summary.stoneCount,
    metal: summary.metals.toSorted((a, b) => b.massG - a.massG)[0]?.material ?? '',
    boundsMm: summary.boundsMm,
    costUsd,
    errors: summary.diagnostics.filter((d) => d.level === 'error').length,
    warnings: summary.diagnostics.filter((d) => d.level === 'warning').length,
  }
}

/**
 * Builds one direction: design, evaluation, findings and a preview. The kernel is optional
 * (tests, a server without engines): the direction is still stored, without facts or pictures.
 */
async function build(
  ctx: Ctx,
  pieceId: string,
  resolved: Resolved,
  tradeOff: string,
): Promise<Omit<StoredDirection, 'letter'>> {
  const id = createId('dir')
  const { design, notes: recipeNotes } = designFor(resolved.spec)
  const geometry = ctx.services.isConfigured('geometry') ? ctx.services.get('geometry') : null
  const call = { pieceId, ...(ctx.signal ? { signal: ctx.signal } : {}) }
  let summary: EvaluationSummary | null = null
  let previewAssetIds: string[] = []
  if (geometry) {
    const [evaluated, pictured] = await Promise.allSettled([
      geometry.evaluate(design, { detail: FACTS_DETAIL, ...call }, serviceContext(ctx)),
      geometry.picture?.(
        design,
        { views: ['hero'], size: PREVIEW_SIZE, focus: [], ...call },
        serviceContext(ctx),
      ),
    ])
    ctx.signal?.throwIfAborted()
    if (evaluated.status === 'fulfilled') summary = evaluated.value
    else console.error(`Evaluating direction ${id} failed:`, evaluated.reason)
    if (pictured.status === 'fulfilled' && pictured.value) {
      for (const rgba of pictured.value.images) {
        const asset = await putAsset(ctx, {
          bytes: await pngOf(rgba, PREVIEW_SIZE, PREVIEW_SIZE),
          name: `direction-${id}.png`,
          kind: 'image',
        })
        previewAssetIds = [...previewAssetIds, asset.id]
      }
    } else if (pictured.status === 'rejected')
      console.error(`Drawing direction ${id} failed:`, pictured.reason)
  }
  let findings: ReturnType<typeof lintDesign> = []
  try {
    findings = lintDesign(design, summary ?? undefined)
  } catch {
    findings = []
  }
  const kernel = (summary?.diagnostics ?? []).filter(
    (d) => d.level === 'error' || d.level === 'warning',
  )
  const notes = [
    ...new Set([
      ...kernel.map((d) => d.message),
      ...findings.filter((f) => f.level === 'warning').map((f) => f.message),
      ...recipeNotes,
      ...findings.filter((f) => f.level !== 'warning').map((f) => f.message),
    ]),
  ].slice(0, MAX_NOTES)
  const actor = ctx.actor
  return {
    id,
    name: resolved.name.slice(0, 60),
    idea: resolved.idea.slice(0, 240),
    tradeOff: tradeOff.slice(0, 240),
    spec: resolved.spec,
    design,
    facts: summary ? factsOf(summary) : null,
    notes,
    previewAssetIds,
    origin: resolved.origin,
    basis: resolved.basis,
    runId: actor.type === 'agent' ? actor.runId : null,
    toolCallId: actor.type === 'agent' ? (actor.toolCallId ?? null) : null,
    createdAt: new Date().toISOString(),
  }
}

const MAX_ATTEMPTS = 5

/**
 * Read, change and write the piece's directions, retrying when another write landed in between
 * (the piece's `updatedAt` is the token), so two rounds proposed at once both survive.
 */
async function updateDirections<R>(
  ctx: Ctx,
  pieceId: string,
  change: (row: PieceRow) => { directions: StoredDirection[]; result: R } & Partial<PieceRow>,
): Promise<R> {
  for (let attempt = 1; ; attempt++) {
    const row = await getPiece(ctx, pieceId)
    const { result, ...patch } = change(row)
    const updated = await ctx.repo.pieces.update(
      and(eq(t.piece.id, pieceId), eq(t.piece.updatedAt, row.updatedAt))!,
      { ...patch, updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)) },
    )
    if (updated.length) {
      publish(ctx, { type: 'piece.updated', pieceId })
      return result
    }
    if (attempt >= MAX_ATTEMPTS) throw conflict('The piece was changed concurrently; retry')
  }
}

export async function proposeDirections(ctx: Ctx, input: ProposeInput) {
  const piece = await getPiece(ctx, input.pieceId)
  // Resolve everything first, so a bad mix or template fails before any work is done.
  const resolved = input.directions.map((item) => ({
    resolved: resolve(ctx, item, piece.directions),
    tradeOff: item.tradeOff ?? '',
  }))
  const built = await Promise.all(resolved.map((r) => build(ctx, piece.id, r.resolved, r.tradeOff)))
  return updateDirections(ctx, piece.id, (row) => {
    const added: StoredDirection[] = built.map((d, i) => ({
      ...d,
      letter: directionLetter(row.directionCount + i + 1),
    }))
    // A piece keeps twelve: the oldest directions nobody chose give way.
    let kept = [...row.directions, ...added]
    const dropped: string[] = []
    while (kept.length > MAX_DIRECTIONS) {
      const at = kept.findIndex((d) => d.id !== row.chosenDirectionId && !added.includes(d))
      if (at === -1) break
      dropped.push(kept[at]!.letter)
      kept = kept.toSpliced(at, 1)
    }
    return {
      directions: kept,
      directionCount: row.directionCount + added.length,
      result: { directions: added.map(toDirection), dropped },
    }
  })
}

/** Moves a piece on to having a design, never back (stages are a status, as in `pieces.ts`). */
const atLeastDesign = (stage: PieceRow['stage']): PieceRow['stage'] =>
  STAGES.indexOf(stage) < STAGES.indexOf('design') ? 'design' : stage

export async function chooseDirection(
  ctx: Ctx,
  { pieceId, directionId }: CommandParsedInput<'pieces.chooseDirection'>,
) {
  const piece = await getPiece(ctx, pieceId)
  const direction = find(piece.directions, directionId)
  if (!direction) throw notFound('Direction', directionId)
  const ops = replaceDesignOps(piece.design, direction.design)
  const { version } =
    ops.length === 0
      ? { version: piece.version }
      : await commitChange(ctx, {
          pieceId,
          ops,
          label: `Chose direction ${direction.letter}: ${direction.name}`.slice(0, 200),
          baseVersion: piece.version,
        })
  await updateDirections(ctx, pieceId, (row) => ({
    directions: row.directions,
    spec: direction.spec,
    chosenDirectionId: direction.id,
    stage: atLeastDesign(row.stage),
    result: null,
  }))
  return { version, direction: toDirection(direction) }
}

export async function removeDirection(
  ctx: Ctx,
  { pieceId, directionId }: CommandParsedInput<'pieces.removeDirection'>,
) {
  return updateDirections(ctx, pieceId, (row) => {
    const direction = find(row.directions, directionId)
    if (!direction) throw notFound('Direction', directionId)
    if (direction.id === row.chosenDirectionId)
      throw conflict('The chosen direction is the piece’s design; choose another one first')
    return {
      directions: row.directions.filter((d) => d.id !== direction.id),
      result: { ok: true as const },
    }
  })
}
