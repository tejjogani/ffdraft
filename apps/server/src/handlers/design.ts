import {
  applyOps,
  type Design,
  type EvaluationSummary,
  IntentError,
  type IntentResult,
  type Op,
  OpError,
  replaceStone,
  type StoredChange,
} from '@pave/schema'
import { and, desc, eq, lt, sql } from 'drizzle-orm'
import { putAsset } from '../assets/assets'
import * as t from '../db/schema'
import { commitChange, FACTS_DETAIL, storeFacts, toStoredChange } from '../design'
import { AppError, badRequest, conflict, notFound } from '../errors'
import { getPiece } from '../lookups'
import { exportClaim, withClaim } from '../plans'
import { serviceContext } from '../service-context'
import { assertAttested } from './pieces'
import type { HandlerGroup } from './types'

type ChangeRow = typeof t.designChange.$inferSelect

/**
 * Whether a change is undone now, given the piece's revert changes: some revert of it is itself
 * in effect (a revert that was reverted in turn — a redo — puts the change back).
 */
function undoneIn(reverts: readonly ChangeRow[]): (id: string) => boolean {
  const memo = new Map<string, boolean>()
  const undone = (id: string): boolean => {
    const known = memo.get(id)
    if (known !== undefined) return known
    memo.set(id, false)
    const value = reverts.some((r) => r.reverts.includes(id) && !undone(r.id))
    memo.set(id, value)
    return value
  }
  return undone
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a))
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  if (!isObject(a) || !isObject(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => deepEqual(a[k], b[k]))
}

interface Written {
  nodeId: string
  path: string[]
  value: unknown
}

/**
 * The values a change left behind, leaf by leaf: what its adds and updates wrote, last write
 * winning. Deletions (merge-patch nulls) are left out: what they leave is the field's default.
 */
function writtenBy(change: ChangeRow): Written[] {
  const out: Written[] = []
  const overlaps = (a: readonly string[], b: readonly string[]) =>
    a.every((k, i) => i >= b.length || b[i] === k)
  const write = (nodeId: string, path: string[], value: unknown) => {
    for (let i = out.length - 1; i >= 0; i--)
      if (out[i]!.nodeId === nodeId && overlaps(out[i]!.path, path)) out.splice(i, 1)
    if (value !== null) out.push({ nodeId, path, value })
  }
  const walk = (nodeId: string, value: Record<string, unknown>, path: string[] = []) => {
    for (const [k, v] of Object.entries(value))
      if (isObject(v)) walk(nodeId, v, [...path, k])
      else write(nodeId, [...path, k], v)
  }
  for (const op of change.ops) {
    if (op.t === 'add') walk(op.node.id, op.node as Record<string, unknown>)
    else if (op.t === 'update') walk(op.id, op.patch)
    else if (op.t === 'remove')
      for (let i = out.length - 1; i >= 0; i--) if (out[i]!.nodeId === op.id) out.splice(i, 1)
  }
  return out
}

const at = (value: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>((v, k) => (isObject(v) ? v[k] : undefined), value)

/**
 * Refuses (409, naming the nodes) to revert changes whose features were edited since: each
 * target, newest first, must find what it wrote still in place, so a later edit — a person's
 * correction after an assistant run — is never silently overwritten by an undo.
 */
function assertUntouched(design: Design, targets: readonly ChangeRow[]): void {
  let working = design
  for (const target of targets) {
    const touched = new Set<string>()
    for (const { nodeId, path, value } of writtenBy(target))
      if (!deepEqual(at(working.nodes[nodeId], path), value)) touched.add(nodeId)
    if (touched.size)
      throw conflict(
        `Later edits changed ${[...touched].join(', ')} since “${target.label}”; undo those first or edit by hand`,
        { reason: 'edited_since', nodeIds: [...touched] },
      )
    try {
      working = applyOps(working, target.inverse).design
    } catch (err) {
      if (!(err instanceof OpError)) throw err
      throw conflict(err.message, { reason: 'edited_since', op: err.op })
    }
  }
}

type Diagnostic = EvaluationSummary['diagnostics'][number]
const diagnosticKey = (d: Diagnostic) => `${d.level}|${d.code}|${d.nodeId ?? ''}`

/** What a targeted edit changed in the facts: deltas and the diagnostics it added or cleared. */
function compareFacts(before: EvaluationSummary | null, after: EvaluationSummary | null) {
  if (!before || !after)
    return { before, after, delta: null, diagnostics: { added: [], resolved: [] } }
  const had = new Set(before.diagnostics.map(diagnosticKey))
  const has = new Set(after.diagnostics.map(diagnosticKey))
  return {
    before,
    after,
    delta: {
      metalMassG: after.metalMassG - before.metalMassG,
      caratTotal: after.caratTotal - before.caratTotal,
      stoneCount: after.stoneCount - before.stoneCount,
    },
    diagnostics: {
      added: after.diagnostics.filter((d) => !had.has(diagnosticKey(d))),
      resolved: before.diagnostics.filter((d) => !has.has(diagnosticKey(d))),
    },
  }
}

/**
 * The answer to a repeated apply: the change as it was recorded. Its notes and facts were given
 * with the first answer and are not recomputed (the design may have moved on since).
 */
function replayed(change: StoredChange) {
  return {
    applied: true,
    version: change.seq,
    change,
    ops: change.ops,
    label: change.label,
    notes: [`Already applied as change ${change.seq}; this is the change as recorded.`],
    warnings: [],
    ...compareFacts(null, null),
  }
}

/** The stone intent on a design, with its errors as a bad request. */
function planStone(design: Design, input: Parameters<typeof replaceStone>): IntentResult {
  try {
    return replaceStone(design, input[1], input[2])
  } catch (err) {
    if (err instanceof IntentError) throw badRequest(err.message)
    throw err
  }
}

export const design: HandlerGroup<'design'> = {
  'design.apply': async (ctx, input) =>
    commitChange(ctx, {
      pieceId: input.pieceId,
      // The wire schema types `add.node` loosely; applyOps validates each node against NodeSchema.
      ops: input.ops as Op[],
      label: input.label,
      baseVersion: input.baseVersion,
      changeId: input.changeId,
      reverts: input.reverts,
    }),

  'design.history': async (ctx, input) => {
    await getPiece(ctx, input.pieceId)
    const cond = eq(t.designChange.pieceId, input.pieceId)
    const rows = await ctx.repo.changes.many({
      where: input.before === undefined ? cond : and(cond, lt(t.designChange.seq, input.before)),
      orderBy: desc(t.designChange.seq),
      limit: input.limit,
    })
    return rows.map(toStoredChange)
  },

  // A run reverts as one change: the inverses of its changes not undone yet, newest first,
  // worked out inside the commit so two undo requests (a double click, a retry) cannot both pass.
  'design.revert': async (ctx, input) => {
    await getPiece(ctx, input.pieceId)
    return commitChange(ctx, {
      pieceId: input.pieceId,
      // Later edits removed what is being restored: a conflict, not a malformed request.
      invalidAs: 'conflict',
      plan: async (tx, current) => {
        const onPiece = eq(t.designChange.pieceId, input.pieceId)
        const [asked, revertsOnPiece] = await Promise.all([
          tx.changes.many({
            where:
              input.runId !== undefined
                ? and(onPiece, eq(t.designChange.runId, input.runId))
                : and(onPiece, eq(t.designChange.seq, input.seq!)),
            orderBy: desc(t.designChange.seq),
          }),
          tx.changes.many({
            where: and(onPiece, sql`jsonb_array_length(${t.designChange.reverts}) > 0`),
          }),
        ])
        if (asked.length === 0)
          throw input.runId !== undefined
            ? notFound(`Changes by run "${input.runId}" to piece`, input.pieceId)
            : notFound(`Change ${input.seq} of piece`, input.pieceId)
        const undone = undoneIn(revertsOnPiece)
        // A run's own undo changes are not its edits; its edits already undone are skipped.
        const targets = asked.filter(
          (c) => !undone(c.id) && (input.runId === undefined || c.reverts.length === 0),
        )
        if (targets.length === 0)
          throw conflict(
            input.runId !== undefined
              ? 'Everything this run changed on the piece is already undone'
              : `Change ${input.seq} is already undone`,
            { reason: 'already_undone' },
          )
        assertUntouched(current, targets)
        const label =
          input.runId !== undefined
            ? `Undo assistant edits: ${targets
                .map((c) => c.label)
                .toReversed()
                .join('; ')}`
            : `Revert: ${targets[0]!.label}`
        return {
          ops: targets.flatMap((c) => c.inverse),
          label: label.length > 200 ? `${label.slice(0, 199)}…` : label,
          reverts: targets.map((c) => c.id),
        }
      },
    })
  },

  // A targeted edit: the pure intent turns "make the centre a 2 ct oval" into ops. A preview
  // evaluates the design before and after and writes nothing; an apply recomputes the intent on
  // the design as it is inside the commit (it is deterministic, so there is no stale plan to
  // replay) and commits it as one attributed change.
  'design.replaceStone': async (ctx, input) => {
    const piece = await getPiece(ctx, input.pieceId)
    const args: Parameters<typeof replaceStone> = [piece.design, input.target, input.change]
    const geometry = ctx.services.isConfigured('geometry') ? ctx.services.get('geometry') : null
    const evaluate = (design: Design) =>
      geometry
        ? geometry.evaluate(design, { detail: 'draft', pieceId: piece.id }, serviceContext(ctx))
        : Promise.resolve(null)
    const actor = ctx.actor
    const changeId =
      input.changeId ??
      (actor.type === 'agent' && actor.toolCallId ? `chg_${actor.toolCallId}` : undefined)
    // A retry of an apply (a dropped response, the same tool call) must get back the change it
    // made. Recomputing the intent on the already-changed design would find nothing to do and
    // answer "not applied", so look the change up first.
    if (!input.dryRun && changeId) {
      const existing = await ctx.repo.changes.first(eq(t.designChange.id, changeId))
      if (existing && existing.pieceId === piece.id) return replayed(toStoredChange(existing))
    }
    const preview = planStone(piece.design, args)
    const outcome = (intent: IntentResult) => ({
      ops: intent.ops,
      label: intent.label,
      notes: intent.notes,
      warnings: intent.warnings,
    })
    if (input.dryRun || preview.ops.length === 0) {
      let next: Design
      try {
        next = applyOps(piece.design, preview.ops).design
      } catch (err) {
        if (!(err instanceof OpError)) throw err
        throw new AppError('bad_request', err.message, { op: err.op })
      }
      const before = await evaluate(piece.design)
      const after = preview.ops.length ? await evaluate(next) : before
      return {
        applied: false,
        version: piece.version,
        ...outcome(preview),
        ...compareFacts(before, after),
      }
    }
    // Set by the plan inside the commit (a holder object, as TypeScript does not follow
    // assignments made in a callback).
    const planned: { intent: IntentResult | null; base: Design } = {
      intent: null,
      base: piece.design,
    }
    const { version, change } = await commitChange(ctx, {
      pieceId: input.pieceId,
      baseVersion: input.baseVersion,
      changeId,
      plan: async (_tx, current) => {
        const intent = planStone(current, [current, input.target, input.change])
        planned.intent = intent
        planned.base = current
        return { ops: intent.ops, label: intent.label }
      },
    })
    const committed = planned.intent
    const base = planned.base
    // The same change id was committed between the lookup above and this commit (two retries
    // racing): the commit replayed it without planning.
    if (!committed) return replayed(change)
    const before = await evaluate(base)
    const after = await evaluate(applyOps(base, committed.ops).design)
    return { applied: true, version, change, ...outcome(committed), ...compareFacts(before, after) }
  },

  'design.evaluate': async (ctx, input) => {
    const piece = await getPiece(ctx, input.pieceId)
    const summary = await ctx.services
      .get('geometry')
      .evaluate(piece.design, { detail: input.detail, pieceId: piece.id }, serviceContext(ctx))
    // All zeros with no diagnostics reads as "fine"; an empty design is worth saying out loud.
    if (Object.keys(piece.design.nodes).length === 0)
      summary.diagnostics = [
        ...summary.diagnostics,
        {
          level: 'warning',
          code: 'empty_design',
          message:
            'The design is empty: there is nothing to measure or check. Build it from a spec, start from a template, or model it.',
        },
      ]
    // Facts come from one detail level only, so a draft answer never overwrites production facts.
    if (input.detail === FACTS_DETAIL) await storeFacts(ctx, piece.id, piece.version, summary)
    return summary
  },

  'design.export': async (ctx, input) => {
    const piece = await getPiece(ctx, input.pieceId)
    assertAttested(piece)
    const geometry = ctx.services.get('geometry')
    const work = async () => {
      const { file, notes } = await geometry.export(
        piece.design,
        { format: input.format, stones: input.stones ?? true, pieceId: piece.id },
        serviceContext(ctx),
      )
      const asset = await putAsset(ctx, { ...file, kind: 'mesh' })
      return { asset, notes }
    }
    // Rhino and STEP claim one export first; an export that fails gives it back.
    const key = await exportClaim(ctx, input)
    return key ? withClaim(ctx, key, work) : work()
  },
}
