/**
 * The plan's limits as the studio meets them. The server decides every count; when it refuses
 * with `plan_limit`, this turns the refusal into the calm upgrade card (one at a time, mounted in
 * the shell) instead of an error toast.
 */
import { ALLOWANCES, type Allowance, PLAN_NAMES, type PlanName } from '@pave/schema'
import { create } from 'zustand'
import { RpcError } from '../../lib/rpc'

export interface PlanLimit {
  plan: PlanName
  allowance: Allowance
  limit: number
  used: number
  resetsAt: string
  fairUse: boolean
  /** The server's sentence, the same one the assistant and MCP get. */
  message: string
}

/** Another way to get what the person asked for without the counted part. */
export interface Alternative {
  label: string
  run: () => void
}

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v)

/** Reads a `plan_limit` error body; null for anything else. */
export function readPlanLimit(
  code: unknown,
  message: unknown,
  d: Record<string, unknown>,
): PlanLimit | null {
  if (code !== 'plan_limit' || typeof message !== 'string') return null
  if (!isOneOf(PLAN_NAMES, d.plan) || !isOneOf(ALLOWANCES, d.allowance)) return null
  return {
    plan: d.plan,
    allowance: d.allowance,
    limit: typeof d.limit === 'number' ? d.limit : 0,
    used: typeof d.used === 'number' ? d.used : 0,
    resetsAt: typeof d.resetsAt === 'string' ? d.resetsAt : '',
    fairUse: d.fairUse === true,
    message,
  }
}

/** The limit an RPC failed on, if that is why it failed. */
export const planLimitOf = (e: unknown): PlanLimit | null =>
  e instanceof RpcError ? readPlanLimit(e.code, e.message, e.details) : null

interface CardState {
  limit: PlanLimit | null
  alternative: Alternative | null
}

export const usePlanLimitCard = create<CardState>(() => ({ limit: null, alternative: null }))

export const showPlanLimit = (limit: PlanLimit, alternative: Alternative | null = null) =>
  usePlanLimitCard.setState({ limit, alternative })

export const closePlanLimit = () => usePlanLimitCard.setState({ limit: null, alternative: null })

/** Shows the upgrade card when `e` is a plan limit. True if it did, so the caller says nothing more. */
export function reportPlanLimit(e: unknown, alternative: Alternative | null = null): boolean {
  const limit = planLimitOf(e)
  if (!limit) return false
  showPlanLimit(limit, alternative)
  return true
}

/** "1 December": when the count starts again, as the card and settings say it. */
export const resetDay = (iso: string): string =>
  iso
    ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })
    : 'the first of next month'
