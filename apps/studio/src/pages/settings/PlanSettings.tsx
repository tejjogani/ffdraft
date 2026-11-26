/**
 * Settings, Plan: the organisation's plan, this month's use of its allowances, when the counts
 * reset, and what is never counted. The numbers come from the server (`plan.get`).
 */
import { PLANS } from '@pave/schema'
import { buttonClass, Chip, InlineError, Skeleton } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { Sparkles } from 'lucide-react'
import { AllowanceMeter } from '../../features/plans/PlanUse'
import { resetDay } from '../../features/plans/plan-limit'
import { useRpc } from '../../lib/query'
import { SettingsGroup, SettingsTitle } from './SettingsLayout'

const SOURCE: Record<'env' | 'org' | 'default', string> = {
  env: 'Set by PAVE_PLAN in apps/server/.env, for testing on this computer.',
  org: 'Set for your organisation.',
  default: 'Every workspace starts on Free.',
}

/** What no plan ever counts, said once so nobody has to guess. */
const NEVER_COUNTED = [
  'Designing, CAD, checks and previews',
  'AI jobs and conversations with your own Claude key',
  'Browser previews and the pictures the assistant takes to see the design',
  'Saving and opening Pavé files (.pave)',
  'STL, 3MF, OBJ and GLB exports',
]

export function PlanSettings() {
  const plan = useRpc('plan.get', {})
  return (
    <>
      <SettingsTitle
        title="Plan"
        description="What your plan includes and what you have used this month."
      />
      {plan.isError ? (
        <InlineError message={plan.error.message} onRetry={() => void plan.refetch()} />
      ) : plan.isPending ? (
        <Skeleton className="h-72" />
      ) : (
        <>
          <section className="mb-10 flex flex-col gap-4 rounded-md p-4 shadow-[inset_0_0_0_1px_var(--line)] sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="studio-title leading-none">{plan.data.label}</span>
                {plan.data.source === 'env' && <Chip tone="warn">Set in .env</Chip>}
              </div>
              <p className="mt-1.5 text-sm text-fg-muted">{PLANS[plan.data.plan].blurb}</p>
              <p className="mt-0.5 text-xs text-fg-subtle">{SOURCE[plan.data.source]}</p>
            </div>
            <Link
              to="/upgrade"
              className={buttonClass({
                variant: plan.data.plan === 'free' ? 'primary' : 'secondary',
              })}
            >
              {plan.data.plan === 'free' ? (
                <>
                  <Sparkles aria-hidden /> Upgrade
                </>
              ) : (
                'Compare plans'
              )}
            </Link>
          </section>

          <SettingsGroup title="This month">
            {plan.data.allowances.map((a) => (
              <AllowanceMeter key={a.allowance} a={a} />
            ))}
          </SettingsGroup>
          <p className="-mt-7 mb-10 text-xs text-fg-subtle">
            Counts start again on {resetDay(plan.data.resetsAt)} (the first of each month, UTC). A
            render or export that fails or is canceled is given back.
          </p>

          <section className="mb-10">
            <h2 className="mb-2 text-sm font-medium">Never counted</h2>
            <ul className="flex flex-col gap-1.5 text-sm text-fg-muted">
              {NEVER_COUNTED.map((n) => (
                <li key={n} className="flex gap-2">
                  <span aria-hidden className="text-fg-faint">
                    –
                  </span>
                  {n}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  )
}
