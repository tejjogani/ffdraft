/**
 * The Upgrade screen: Free and Pro side by side, from the plans config, with this month's use.
 * There is no checkout: payments are not part of this build, and the screen says so and how a
 * plan is switched meanwhile (PAVE_PLAN on a local install; the server's operator otherwise).
 */
import {
  ALLOWANCE_WORDS,
  ALLOWANCES,
  FAIR_USE,
  PLAN_FEATURES,
  PLAN_NAMES,
  PLANS,
  type PlanName,
} from '@pave/schema'
import { Chip, cn, InlineError, Skeleton } from '@pave/ui'
import { Check } from 'lucide-react'
import { Column, PageHeader } from '../../components/Page'
import { AllowanceMeter } from '../../features/plans/PlanUse'
import { useRpc } from '../../lib/query'

/** One row per feature: the uncounted ones from the config, then the counted ones from limits. */
const rows = (): { label: string; values: Record<PlanName, string> }[] => [
  ...PLAN_FEATURES.map((f) => ({ label: f.label, values: { free: f.free, pro: f.pro } })),
  ...ALLOWANCES.map((a) => ({
    label: ALLOWANCE_WORDS[a].label,
    values: Object.fromEntries(
      PLAN_NAMES.map((p) => {
        const limit = PLANS[p].limits[a]
        return [p, limit === null ? 'Unlimited' : `${limit} a month`]
      }),
    ) as Record<PlanName, string>,
  })),
]

export function UpgradePage() {
  const plan = useRpc('plan.get', {})
  const current = plan.data?.plan
  return (
    <>
      <PageHeader crumbs={[{ label: 'Plans' }]} />
      <Column className="pt-10">
        <h1 className="studio-title">Plans</h1>
        <p className="mt-1 max-w-[60ch] text-sm text-fg-muted">
          The whole CAD studio is free, with AI jobs on your own Claude key. Pro adds unlimited
          Blender renders and Rhino and STEP exports.
        </p>

        {plan.isError && (
          <InlineError
            className="mt-6"
            message={plan.error.message}
            onRetry={() => void plan.refetch()}
          />
        )}

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          {PLAN_NAMES.map((p) => (
            <section
              key={p}
              aria-label={`${PLANS[p].label} plan`}
              className={cn(
                'flex flex-col rounded-lg bg-bg p-5',
                // Pro is the one to look at: an ink edge and the lift of the pop shadow.
                p === 'pro'
                  ? 'shadow-[inset_0_0_0_1px_var(--ink),var(--shadow-md)]'
                  : 'shadow-[inset_0_0_0_1px_var(--line)]',
              )}
            >
              <div className="flex items-center gap-2">
                <h2 className="studio-heading">{PLANS[p].label}</h2>
                {current === p && <Chip>Your plan</Chip>}
                {p === 'pro' && (
                  <span className="ml-auto text-2xs text-fg-subtle">Everything in Free, plus</span>
                )}
              </div>
              <p className="mt-1 text-sm text-fg-muted">{PLANS[p].blurb}</p>
              <ul className="mt-5 flex flex-col divide-y divide-line border-y border-line">
                {rows().map((r) => (
                  <li key={r.label} className="flex items-baseline justify-between gap-4 py-2.5">
                    <span className="text-sm">{r.label}</span>
                    <span
                      className={cn(
                        'flex shrink-0 items-center gap-1 text-sm tabular',
                        // What Pro adds over Free reads in full ink; what both share stays quiet.
                        p === 'pro' && r.values.pro !== r.values.free
                          ? 'font-medium text-fg'
                          : 'text-fg-muted',
                      )}
                    >
                      {(r.values[p] === 'Included' || r.values[p] === 'Unlimited') && (
                        <Check className="size-3.5 text-fg-subtle" aria-hidden />
                      )}
                      {r.values[p]}
                    </span>
                  </li>
                ))}
              </ul>
              {p === 'pro' && (
                <p className="mt-3 text-xs text-fg-subtle">
                  Unlimited within fair use: {FAIR_USE.render} renders and {FAIR_USE.export} Rhino
                  or STEP exports a month.
                </p>
              )}
            </section>
          ))}
        </div>

        <section
          aria-label="Upgrading"
          className="mt-6 rounded-lg bg-bg-subtle p-4 text-sm shadow-[inset_0_0_0_1px_var(--line)]"
        >
          <div className="font-medium">Payments are not part of this build yet</div>
          <p className="mt-1 text-fg-muted">
            There is no checkout, and nothing is charged.{' '}
            {plan.data?.localInstall
              ? 'To try Pro on this computer, add PAVE_PLAN=pro to apps/server/.env and restart Pavé.'
              : 'Ask whoever runs this Pavé server to switch your organisation’s plan.'}
          </p>
        </section>

        <section className="mt-10">
          <h2 className="mb-2 text-sm font-medium">This month</h2>
          {plan.isPending ? (
            <Skeleton className="h-28" />
          ) : plan.data ? (
            <div className="divide-y divide-line border-y border-line">
              {plan.data.allowances.map((a) => (
                <AllowanceMeter key={a.allowance} a={a} />
              ))}
            </div>
          ) : null}
        </section>
      </Column>
    </>
  )
}
