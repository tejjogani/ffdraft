/**
 * What counts against a plan's allowances, and how the plan's state is shown. The numbers are in
 * `./config`; the server enforces them (apps/server/src/plans.ts) and everything else reads the
 * `PlanStatus` it returns.
 */
import { z } from 'zod'
import {
  ALLOWANCE_WORDS,
  ALLOWANCES,
  type Allowance,
  FAIR_USE,
  PLAN_NAMES,
  PLANS,
  type PlanName,
} from './config'

/**
 * Export formats that count as one export. STL is always free (the founder's decision), and so
 * are the other mesh formats (3MF, OBJ, GLB): only editable CAD for other software counts.
 */
export const COUNTED_EXPORT_FORMATS = ['3dm', 'step'] as const

export const exportCounts = (format: string): boolean =>
  (COUNTED_EXPORT_FORMATS as readonly string[]).includes(format)

/** The allowance period a moment falls in: its calendar month in UTC, as `YYYY-MM`. */
export const periodOf = (at: Date): string => at.toISOString().slice(0, 7)

/** When the period that `at` falls in ends: midnight UTC on the first of the next month. */
export const periodEnd = (at: Date): Date =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1))

/** The most an allowance allows in a period: the plan's limit, or the fair-use ceiling. */
export const ceilingOf = (plan: PlanName, allowance: Allowance): number =>
  PLANS[plan].limits[allowance] ?? FAIR_USE[allowance]

export const AllowanceStatusSchema = z.object({
  allowance: z.enum(ALLOWANCES),
  label: z.string(),
  /** Counted this period, including work still running (it is released if it fails). */
  used: z.number().int(),
  /** The plan's limit; null = unlimited (up to `ceiling`, the fair-use ceiling). */
  limit: z.number().int().nullable(),
  ceiling: z.number().int(),
  /** What is left before the limit or ceiling. */
  left: z.number().int(),
})
export type AllowanceStatus = z.infer<typeof AllowanceStatusSchema>

export const PlanStatusSchema = z.object({
  plan: z.enum(PLAN_NAMES),
  label: z.string(),
  /**
   * `env`: PAVE_PLAN in apps/server/.env (local installs only, for testing); `org`: set on the
   * organisation; `default`: no plan has been set.
   */
  source: z.enum(['env', 'org', 'default']),
  /** A local install, where PAVE_PLAN in apps/server/.env can switch plans for testing. */
  localInstall: z.boolean(),
  /** The calendar month (UTC) being counted, `YYYY-MM`. */
  period: z.string(),
  /** When the counts start again (ISO). */
  resetsAt: z.string(),
  allowances: z.array(AllowanceStatusSchema),
})
export type PlanStatus = z.infer<typeof PlanStatusSchema>

/** What a `plan_limit` error carries, so the studio can say it calmly and offer the upgrade. */
export interface PlanLimitDetails {
  plan: PlanName
  allowance: Allowance
  limit: number
  used: number
  resetsAt: string
  /** True when this was the fair-use ceiling of an unlimited plan, not a plan limit. */
  fairUse: boolean
}

/** The sentence a `plan_limit` error says, the same for people, the assistant and MCP. */
export function planLimitMessage(d: PlanLimitDetails): string {
  const w = ALLOWANCE_WORDS[d.allowance]
  const resets = new Date(d.resetsAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
  if (d.fairUse)
    return `This month’s fair-use ceiling of ${d.limit} ${w.many} is reached. It resets on ${resets}.`
  const free = d.limit === 1 ? `your 1 free ${w.one}` : `your ${d.limit} free ${w.many}`
  return `You have used ${free} this month. ${PLANS.pro.label} has unlimited ${w.many}. The count resets on ${resets}.`
}

/**
 * Which allowance a `plan_limit` sentence is about, read back from its words: a tool result in a
 * conversation keeps only the text the model saw. Null for any other text.
 */
export function planLimitAllowanceOf(text: string): Allowance | null {
  for (const a of ALLOWANCES) {
    const many = ALLOWANCE_WORDS[a].many
    if (
      (text.includes('You have used your') && text.includes(`free ${many} this month`)) ||
      (text.includes('You have used your 1 free') && text.includes(ALLOWANCE_WORDS[a].one)) ||
      (text.includes('fair-use ceiling of') && text.includes(` ${many} is reached`))
    )
      return a
  }
  return null
}

/** One line per allowance for the assistant's context: what is left this month. */
export function allowanceLine(status: PlanStatus): string {
  const parts = status.allowances.map((a) => {
    const w = ALLOWANCE_WORDS[a.allowance]
    return a.limit === null
      ? `${w.label} unlimited`
      : `${w.label} ${a.left} of ${a.limit} left this month`
  })
  return `${status.label} plan: ${parts.join('; ')} (resets ${status.resetsAt.slice(0, 10)}). Browser previews, captures and STL, 3MF, OBJ and GLB exports are never counted.`
}
