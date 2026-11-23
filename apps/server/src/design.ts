/**
 * The one write path for design documents. Every change — a designer's edit, an assistant tool
 * call, a revert, a rebuild from spec — is committed here as `{ ops, inverse, actor }` together
 * with the new snapshot and version, in one transaction.
 */
import {
  applyOps,
  type Design,
  type EvaluationSummary,
  evaluationOrder,
  type Op,
  OpError,
  type PieceSummary,
  type StoredChange,
} from '@pave/schema'
import { and, eq } from 'drizzle-orm'
import { type Ctx, publish } from './context'
import * as t from './db/schema'
import { AppError, conflict } from './errors'
import { createId } from './ids'
import { getPiece } from './lookups'
import { serviceContext } from './service-context'

type ChangeRow = typeof t.designChange.$inferSelect

export const toStoredChange = (r: ChangeRow): StoredChange => ({
  id: r.id,
  pieceId: r.pieceId,
  seq: r.seq,
  ops: r.ops,
  inverse: r.inverse,
  actor: r.actor,
  label: r.label,
  at: r.at.toISOString(),
})

export interface CommitInput {
  pieceId: string
  ops: readonly Op[]
  label: string
  /** Reject with 409 unless the piece is still at this version. */
  baseVersion?: number
  /** Client-chosen id; committing the same id again returns the original change. */
  changeId?: string
  /** How an op that no longer applies is reported: a bad request, or a conflict with later edits. */
  invalidAs?: 'bad_request' | 'conflict'
}

/** Another writer committed between our read and our write. */
class StaleWrite extends Error {}

const MAX_ATTEMPTS = 5

export async function commitChange(
  ctx: Ctx,
  input: CommitInput,
): Promise<{ version: number; change: StoredChange }> {
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await ctx.repo.transaction((tx) => commitOnce(ctx, tx, input))
      if (!result.replayed) {
        publish(ctx, {
          type: 'design.changed',
          pieceId: input.pieceId,
          version: result.version,
          change: result.change,
        })
        refreshFacts(ctx, input.pieceId, result.version, result.design)
      }
      return { version: result.version, change: result.change }
    } catch (err) {
      // Without a base version the caller asked for "on top of whatever is current": retry.
      if (
        !(err instanceof StaleWrite) ||
        input.baseVersion !== undefined ||
        attempt >= MAX_ATTEMPTS
      )
        throw err instanceof StaleWrite
          ? conflict('The piece was changed concurrently; reload and retry')
          : err
    }
  }
}

async function commitOnce(ctx: Ctx, tx: Ctx['repo'], input: CommitInput) {
  if (input.changeId) {
    const existing = await tx.changes.first(eq(t.designChange.id, input.changeId))
    if (existing) {
      if (existing.pieceId !== input.pieceId)
        throw conflict(`Change id "${input.changeId}" is already used`)
      return { replayed: true as const, version: existing.seq, change: toStoredChange(existing) }
    }
  }
  const piece = await getPiece({ ...ctx, repo: tx }, input.pieceId)
  if (input.baseVersion !== undefined && input.baseVersion !== piece.version)
    throw conflict(`The piece is at version ${piece.version}, not ${input.baseVersion}`, {
      currentVersion: piece.version,
    })

  let applied: { design: Design; inverse: Op[] }
  try {
    applied = applyOps(piece.design, input.ops)
  } catch (err) {
    if (!(err instanceof OpError)) throw err
    throw new AppError(input.invalidAs ?? 'bad_request', err.message, { op: err.op })
  }

  const seq = piece.version + 1
  const at = new Date()
  const updated = await tx.pieces.update(
    and(eq(t.piece.id, piece.id), eq(t.piece.version, piece.version))!,
    {
      design: applied.design,
      version: seq,
      updatedAt: at,
    },
  )
  if (updated.length === 0) throw new StaleWrite()

  const actor = ctx.actor
  const row = await tx.changes.insert({
    id: input.changeId ?? createId('chg'),
    pieceId: piece.id,
    seq,
    ops: [...input.ops],
    inverse: applied.inverse,
    actor,
    actorType: actor.type,
    actorUserId: actor.type === 'system' ? null : ctx.user.id,
    runId: actor.type === 'agent' ? actor.runId : null,
    toolCallId: actor.type === 'agent' ? (actor.toolCallId ?? null) : null,
    label: input.label,
    at,
  })
  return {
    replayed: false as const,
    version: seq,
    change: toStoredChange(row),
    design: applied.design,
  }
}

/** Ops that turn `current` into `next`: remove every node (dependents first), then add the new ones. */
export function replaceDesignOps(current: Design, next: Design): Op[] {
  const removeOrder = (evaluationOrder(current) ?? current.order).toReversed()
  return [
    ...removeOrder.map((id): Op => ({ t: 'remove', id })),
    ...(next.kind !== current.kind ? [{ t: 'setKind', kind: next.kind } satisfies Op] : []),
    ...next.order.map((id): Op => ({ t: 'add', node: next.nodes[id]! })),
  ]
}

const factsFrom = (s: EvaluationSummary): NonNullable<PieceSummary['facts']> => ({
  metalMassG: s.metalMassG,
  caratTotal: s.caratTotal,
  stoneCount: s.stoneCount,
  metal: s.metals.toSorted((a, b) => b.massG - a.massG)[0]?.material ?? '',
})

/** Caches evaluation facts on the piece, unless the design moved on since `version`. */
export async function storeFacts(
  ctx: Ctx,
  pieceId: string,
  version: number,
  summary: EvaluationSummary,
) {
  const rows = await ctx.repo.pieces.update(
    and(eq(t.piece.id, pieceId), eq(t.piece.version, version))!,
    {
      facts: factsFrom(summary),
    },
  )
  if (rows.length) publish(ctx, { type: 'piece.updated', pieceId })
}

/**
 * Re-evaluates in the background after a change when a geometry engine is registered; without
 * one, `facts` stays null rather than guessed.
 */
export function refreshFacts(ctx: Ctx, pieceId: string, version: number, design: Design): void {
  if (!ctx.services.isConfigured('geometry')) return
  ctx.services
    .get('geometry')
    .evaluate(design, { detail: 'draft' }, serviceContext(ctx))
    .then((summary) => storeFacts(ctx, pieceId, version, summary))
    .catch((err: unknown) => console.error(`Evaluating piece ${pieceId} v${version} failed:`, err))
}
