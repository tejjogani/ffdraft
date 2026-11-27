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
import { and, eq, inArray } from 'drizzle-orm'
import { type Ctx, publish } from './context'
import { drawClayCover } from './covers'
import * as t from './db/schema'
import { AppError, badRequest, conflict } from './errors'
import { createId } from './ids'
import { getPiece } from './lookups'
import { validateMeshEdits } from './mesh-components'
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
  ...(r.reverts.length ? { reverts: r.reverts } : {}),
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
  /** Ids of earlier changes of this piece that these ops undo. */
  reverts?: readonly string[]
}

/** What to commit, worked out inside the commit transaction from the piece as it is there. */
export type CommitPlan = (
  tx: Ctx['repo'],
  design: Design,
  version: number,
) => Promise<Pick<CommitInput, 'ops' | 'label' | 'reverts'>>

/**
 * A commit whose ops depend on the history (a revert): `plan` runs in the same transaction as
 * the write, and runs again if a concurrent commit wins, so two undo requests never both pass.
 */
export type PlannedCommit = Omit<CommitInput, 'ops' | 'label' | 'reverts'> & { plan: CommitPlan }

/** Another writer committed between our read and our write. */
class StaleWrite extends Error {}

const MAX_ATTEMPTS = 5

export async function commitChange(
  ctx: Ctx,
  input: CommitInput | PlannedCommit,
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

async function commitOnce(ctx: Ctx, tx: Ctx['repo'], planned: CommitInput | PlannedCommit) {
  if (planned.changeId) {
    const existing = await tx.changes.first(eq(t.designChange.id, planned.changeId))
    if (existing) {
      if (existing.pieceId !== planned.pieceId)
        throw conflict(`Change id "${planned.changeId}" is already used`)
      return { replayed: true as const, version: existing.seq, change: toStoredChange(existing) }
    }
  }
  const piece = await getPiece({ ...ctx, repo: tx }, planned.pieceId)
  if (planned.baseVersion !== undefined && planned.baseVersion !== piece.version)
    throw conflict(`The piece is at version ${piece.version}, not ${planned.baseVersion}`, {
      currentVersion: piece.version,
    })
  const input: CommitInput =
    'plan' in planned
      ? { ...planned, ...(await planned.plan(tx, piece.design, piece.version)) }
      : planned

  let applied: { design: Design; inverse: Op[] }
  try {
    applied = applyOps(piece.design, input.ops, {
      checkRequestedFields: ctx.actor.type === 'agent',
    })
  } catch (err) {
    if (!(err instanceof OpError)) throw err
    throw new AppError(input.invalidAs ?? 'bad_request', err.message, { op: err.op })
  }

  await validateMeshEdits({ ...ctx, repo: tx }, piece.design, applied.design, input.ops)

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

  const reverted = input.reverts?.length
    ? await tx.changes.many({
        where: and(
          eq(t.designChange.pieceId, piece.id),
          inArray(t.designChange.id, [...input.reverts]),
        ),
      })
    : []
  const unknown = input.reverts?.find((id) => !reverted.some((c) => c.id === id))
  if (unknown) throw badRequest(`Change "${unknown}" is not part of this piece’s history`)

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
    reverts: [...(input.reverts ?? [])],
    at,
  })
  // A person undoing an assistant's edit is exact implicit feedback on its run, recorded once per
  // change; an assistant backing out its own edit is not feedback.
  const recorded =
    actor.type === 'user' && reverted.some((c) => c.runId !== null)
      ? await tx.feedback.many({
          where: and(
            eq(t.runFeedback.kind, 'undone'),
            inArray(
              t.runFeedback.changeId,
              reverted.map((c) => c.id),
            ),
          ),
        })
      : []
  const undone =
    actor.type === 'user'
      ? reverted.filter((c) => c.runId !== null && !recorded.some((f) => f.changeId === c.id))
      : []
  await tx.feedback.insertMany(
    undone.map((c) => ({
      id: createId('fb'),
      runId: c.runId!,
      stepId: null,
      source: 'implicit' as const,
      kind: 'undone' as const,
      changeId: c.id,
      note: `Undone by change ${seq}`,
      userId: actor.type === 'system' ? null : ctx.user.id,
    })),
  )
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

/**
 * The one detail level cached facts come from. Draft leaves stone seats uncut and overstates
 * metal by up to a third, so facts written at both levels would flip with whoever wrote last;
 * production is what a caster weighs, and the cost estimates on cards are built on it.
 */
export const FACTS_DETAIL: 'draft' | 'production' = 'production'

/**
 * Caches evaluation facts (at {@link FACTS_DETAIL}) on the piece, unless the design moved on
 * since `version`.
 */
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
  return rows.length > 0
}

/** How long a piece must stay unchanged before its facts are re-evaluated. */
const FACTS_DEBOUNCE_MS = 300

interface FactsRefresh {
  timer: NodeJS.Timeout | null
  /** The newest change not evaluated yet; null once taken. */
  next: { ctx: Ctx; version: number; design: Design } | null
  running: boolean
}

/** Pending refreshes per server (its service registry) and piece. */
const refreshes = new WeakMap<Ctx['services'], Map<string, FactsRefresh>>()

/** Reading an old project must not reset a pending edit's timer or duplicate a running evaluation. */
export function refreshMissingFacts(ctx: Ctx, pieceId: string, version: number, design: Design) {
  if (!refreshes.get(ctx.services)?.has(`${ctx.orgId}:${pieceId}`))
    refreshFacts(ctx, pieceId, version, design)
}

/**
 * Re-evaluates in the background after a change when a geometry engine is registered; without
 * one, `facts` stays null rather than guessed. Debounced per piece: a slider drag commits many
 * changes, and only the design it settles on is evaluated — never while another evaluation of
 * the same piece is still running, and never on the commit's own path.
 */
export function refreshFacts(ctx: Ctx, pieceId: string, version: number, design: Design): void {
  if (!ctx.services.isConfigured('geometry')) return
  const byPiece = refreshes.get(ctx.services) ?? new Map<string, FactsRefresh>()
  refreshes.set(ctx.services, byPiece)
  const key = `${ctx.orgId}:${pieceId}`
  const entry: FactsRefresh = byPiece.get(key) ?? { timer: null, next: null, running: false }
  byPiece.set(key, entry)
  entry.next = { ctx, version, design }
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => void flush(byPiece, key, pieceId), FACTS_DEBOUNCE_MS)
  entry.timer.unref()
}

const isAbort = (err: unknown) => err instanceof Error && err.name === 'AbortError'

async function flush(byPiece: Map<string, FactsRefresh>, key: string, pieceId: string) {
  const entry = byPiece.get(key)
  if (!entry) return
  entry.timer = null
  // A change that lands while evaluating is picked up when the running evaluation finishes.
  if (entry.running || !entry.next) return
  const { ctx, version, design } = entry.next
  entry.next = null
  entry.running = true
  try {
    const summary = await ctx.services
      .get('geometry')
      .evaluate(design, { detail: FACTS_DETAIL, pieceId, background: true }, serviceContext(ctx))
    if (await storeFacts(ctx, pieceId, version, summary))
      await drawClayCover(ctx, pieceId, version, design, summary).catch((err: unknown) => {
        // A missing cover leaves the card's placeholder; it is not worth failing the refresh.
        if (!isAbort(err)) console.error(`Drawing a cover of piece ${pieceId} failed:`, err)
      })
  } catch (err) {
    // The server closing under a pending refresh is not a failure worth reporting.
    if (!isAbort(err)) console.error(`Evaluating piece ${pieceId} v${version} failed:`, err)
  } finally {
    entry.running = false
    if (entry.next && !entry.timer) void flush(byPiece, key, pieceId)
    else if (!entry.next && !entry.timer) byPiece.delete(key)
  }
}
