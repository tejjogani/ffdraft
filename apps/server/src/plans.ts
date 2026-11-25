/**
 * Plan allowances: the one owner of counting. Each counted action (a Blender take, a Rhino or
 * STEP export, a production package with those files) claims one slot before its work starts,
 * and settles the claim when the work ends: `used` when it was delivered, `released` when it
 * failed or was canceled first, which gives the slot back.
 *
 * The database decides races: a claim inserts a row holding the lowest free slot number of its
 * month, and the unique index on (org, allowance, period, slot) lets only one row hold a slot.
 * Two tabs (or an agent run and an MCP client) asking for the last free render both try slot 5;
 * one insert wins, the other conflicts, looks again, finds no slot left and is refused.
 *
 * Every claim has an idempotency key derived from the work (`render:<takeId>`,
 * `export:<runId>:<toolCallId>`), so a retried request is counted once.
 */
import {
  ALLOWANCE_WORDS,
  ALLOWANCES,
  type Allowance,
  type AllowanceStatus,
  ceilingOf,
  DEFAULT_PLAN,
  exportCounts,
  PLANS,
  type PlanLimitDetails,
  type PlanName,
  type PlanStatus,
  periodEnd,
  periodOf,
  planLimitMessage,
} from '@pave/schema'
import { and, eq, isNotNull, like, lt } from 'drizzle-orm'
import type { Ctx } from './context'
import type { Db } from './db/client'
import * as t from './db/schema'
import { AppError, conflict, forbidden, notFound } from './errors'
import { createId } from './ids'

type ClaimRow = typeof t.planClaim.$inferSelect

/**
 * How many times a claim looks for a free slot again after losing one to a concurrent claim.
 * Each loss means another claim took a slot, so this bounds how many claims may race at once.
 */
const CLAIM_ATTEMPTS = 25

/**
 * How long an export claim may stay held before it is given back. A studio export claims first
 * and settles once the file is saved; a tab closed in between never settles, and neither does a
 * server export interrupted by a restart. Exports take minutes at most (the kernel's own timeouts
 * are shorter), so a claim held this long is abandoned. Renders and packages are not swept: their
 * jobs settle them, and boot recovery settles the ones a restart cut short.
 */
export const STALE_EXPORT_MS = 30 * 60_000

/**
 * Settles export claims held past {@link STALE_EXPORT_MS}. A server export cut short by a restart
 * delivered nothing, so its slot is given back. A client's claim is counted: the server never
 * learns whether that file was saved, and giving it back would let a client export for free by
 * never settling.
 */
export async function releaseStale(ctx: Ctx, now = new Date()): Promise<void> {
  const before = new Date(now.getTime() - STALE_EXPORT_MS)
  const stale = (prefix: string) =>
    and(
      eq(t.planClaim.state, 'held'),
      lt(t.planClaim.createdAt, before),
      like(t.planClaim.idempotencyKey, prefix),
    )!
  await ctx.repo.planClaims.update(stale('export:%'), {
    state: 'released',
    slot: null,
    settledAt: now,
  })
  await ctx.repo.planClaims.update(stale('browser:%'), { state: 'used', settledAt: now })
}

/** The plan the organisation is on, and what set it. */
export async function planOf(ctx: Ctx): Promise<{ plan: PlanName; source: PlanStatus['source'] }> {
  if (ctx.planOverride) return { plan: ctx.planOverride, source: 'env' }
  const settings = await ctx.repo.settings.first()
  const stored = settings?.plan
  if (stored && stored in PLANS) return { plan: stored, source: 'org' }
  return { plan: DEFAULT_PLAN, source: 'default' }
}

/** Claims that count in a period: held (work running) or used (delivered). */
const counting = (allowance: Allowance, period: string) =>
  and(
    eq(t.planClaim.allowance, allowance),
    eq(t.planClaim.period, period),
    isNotNull(t.planClaim.slot),
  )!

async function takenSlots(ctx: Ctx, allowance: Allowance, period: string): Promise<Set<number>> {
  const rows = await ctx.repo.planClaims.select(
    { slot: t.planClaim.slot },
    counting(allowance, period),
  )
  return new Set(rows.map((r) => r.slot!))
}

/** The plan and this month's use of each allowance. */
export async function planStatus(ctx: Ctx, at = new Date()): Promise<PlanStatus> {
  const { plan, source } = await planOf(ctx)
  const period = periodOf(at)
  const allowances = await Promise.all(
    ALLOWANCES.map(async (allowance): Promise<AllowanceStatus> => {
      const used = await ctx.repo.planClaims.count(counting(allowance, period))
      const ceiling = ceilingOf(plan, allowance)
      return {
        allowance,
        label: ALLOWANCE_WORDS[allowance].label,
        used,
        limit: PLANS[plan].limits[allowance],
        ceiling,
        left: Math.max(0, ceiling - used),
      }
    }),
  )
  return {
    plan,
    label: PLANS[plan].label,
    source,
    localInstall: ctx.authMode === 'local',
    period,
    resetsAt: periodEnd(at).toISOString(),
    allowances,
  }
}

/** What is left of one allowance this month, and whether it is a real limit (not fair use). */
export async function allowanceLeft(
  ctx: Ctx,
  allowance: Allowance,
): Promise<{ left: number; limited: boolean }> {
  const status = await planStatus(ctx)
  const a = status.allowances.find((x) => x.allowance === allowance)!
  return { left: a.left, limited: a.limit !== null }
}

export function planLimitError(details: PlanLimitDetails): AppError {
  return new AppError('plan_limit', planLimitMessage(details), { ...details })
}

export interface ClaimRequest {
  allowance: Allowance
  key: string
  /** What it is for, e.g. the export format, kept on the record. */
  subject: string
  pieceId?: string | null
}

/**
 * Takes one unit of an allowance for work about to start, or refuses with `plan_limit` (402).
 * The same key returns the same claim (a retry is counted once); a key whose claim was given
 * back is refused, so a settled attempt is never silently reopened.
 */
export async function claim(ctx: Ctx, req: ClaimRequest): Promise<ClaimRow> {
  const at = new Date()
  const period = periodOf(at)
  const { plan } = await planOf(ctx)
  const ceiling = ceilingOf(plan, req.allowance)
  if (req.allowance === 'export') await releaseStale(ctx, at)
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    const existing = await ctx.repo.planClaims.first(eq(t.planClaim.idempotencyKey, req.key))
    if (existing?.state === 'released') throw conflict('That claim was given back; make a new one.')
    if (existing) return existing
    const taken = await takenSlots(ctx, req.allowance, period)
    let slot = 1
    while (taken.has(slot)) slot++
    if (slot > ceiling)
      throw planLimitError({
        plan,
        allowance: req.allowance,
        limit: ceiling,
        used: taken.size,
        resetsAt: periodEnd(at).toISOString(),
        fairUse: PLANS[plan].limits[req.allowance] === null,
      })
    // Does nothing when another claim took this slot (or this key) meanwhile: look again.
    const row = await ctx.repo.planClaims.insertIfAbsent({
      id: createId('clm'),
      idempotencyKey: req.key,
      allowance: req.allowance,
      period,
      slot,
      state: 'held',
      subject: req.subject,
      pieceId: req.pieceId ?? null,
      userId: ctx.user.id,
      actor: ctx.actor,
      // The same clock as the period and the stale sweep, not the database's.
      createdAt: at,
    })
    if (row) return row
  }
  throw new AppError('conflict', 'Too many requests for the allowance at once; try again.')
}

/**
 * Ends a held claim: `used` keeps it counted; `released` gives its slot back. Only a held claim
 * changes, so settling twice (a retry, a late engine update) does nothing the second time.
 */
export async function settle(
  ctx: Ctx,
  key: string,
  outcome: 'used' | 'released',
): Promise<ClaimRow | undefined> {
  const [row] = await ctx.repo.planClaims.update(
    and(eq(t.planClaim.idempotencyKey, key), eq(t.planClaim.state, 'held'))!,
    {
      state: outcome,
      ...(outcome === 'released' ? { slot: null } : {}),
      settledAt: new Date(),
    },
  )
  return row
}

/**
 * Runs `work` under a claim: released if it throws (including a cancel), used if it returns.
 * For work that delivers before it returns, like an export.
 */
export async function withClaim<R>(ctx: Ctx, key: string, work: () => Promise<R>): Promise<R> {
  let result: R
  try {
    result = await work()
  } catch (err) {
    await settle(ctx, key, 'released')
    throw err
  }
  await settle(ctx, key, 'used')
  return result
}

/** A claim by id, for the studio's browser exports. */
export async function getClaim(ctx: Ctx, id: string): Promise<ClaimRow> {
  const row = await ctx.repo.planClaims.first(eq(t.planClaim.id, id))
  if (!row) throw notFound('Claim', id)
  return row
}

/**
 * The claim an export runs under, or null for a format that is never counted. A studio export
 * that fell back to the server brings the claim it already made (`claimId`), so it is counted
 * once; that claim must be the caller's own, still held, and for this piece and format.
 */
export async function exportClaim(
  ctx: Ctx,
  input: { pieceId: string; format: string; claimId?: string | undefined },
): Promise<string | null> {
  if (input.claimId) {
    const row = await getClaim(ctx, input.claimId)
    if (row.userId !== ctx.user.id) throw forbidden('That claim is someone else’s')
    if (row.state !== 'held') throw conflict(`That claim is already ${row.state}`)
    if (row.allowance !== 'export' || row.subject !== input.format || row.pieceId !== input.pieceId)
      throw conflict('That claim is for another export')
    return row.idempotencyKey
  }
  if (!exportCounts(input.format)) return null
  const key = exportKey(ctx)
  await claim(ctx, { allowance: 'export', key, subject: input.format, pieceId: input.pieceId })
  return key
}

// ── Keys, one per kind of counted work ────────────────────────────────────────────────────

export const renderKey = (takeId: string) => `render:${takeId}`
/**
 * Every key a take claims: one per render it counts as (an animation counts as
 * `ANIMATION_RENDER_COST`), so each holds its own numbered slot and is settled with the take.
 */
export const renderKeys = (takeId: string, cost: number): string[] =>
  Array.from({ length: Math.max(1, cost) }, (_, i) =>
    i === 0 ? renderKey(takeId) : `${renderKey(takeId)}#${i + 1}`,
  )
export const packageKey = (packageId: string) => `package:${packageId}`

/** An assistant's retried call claims once; anything else is a new export each time. */
export function exportKey(ctx: Ctx): string {
  const a = ctx.actor
  return a.type === 'agent' && a.toolCallId
    ? `export:${a.runId}:${a.toolCallId}`
    : `export:${createId('exp')}`
}

/** For boot recovery, which fails work with no user context: give its claim back. */
export async function releaseOrphan(db: Db, orgId: string, key: string): Promise<void> {
  await db
    .update(t.planClaim)
    .set({ state: 'released', slot: null, settledAt: new Date() })
    .where(
      and(
        eq(t.planClaim.orgId, orgId),
        eq(t.planClaim.idempotencyKey, key),
        eq(t.planClaim.state, 'held'),
      ),
    )
}
