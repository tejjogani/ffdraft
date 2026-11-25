/**
 * The upgrade card: what a `plan_limit` refusal says, calmly, with the way on. The modal one is
 * mounted once in the shell and opened by `reportPlanLimit`; the inline one sits under an
 * assistant tool call that hit the limit.
 */
import { ALLOWANCE_WORDS, type Allowance, PLANS } from '@pave/schema'
import { Button, buttonClass, cn, Dialog } from '@pave/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { Sparkles } from 'lucide-react'
import { useRpc } from '../../lib/query'
import { closePlanLimit, type PlanLimit, resetDay, usePlanLimitCard } from './plan-limit'

const titleOf = (l: PlanLimit) =>
  l.fairUse
    ? 'This month’s fair-use ceiling is reached'
    : `Your free ${ALLOWANCE_WORDS[l.allowance].many} for this month are used`

/** "5 of 5 free renders used · resets 1 December". */
function UseLine({ limit }: { limit: PlanLimit }) {
  const w = ALLOWANCE_WORDS[limit.allowance]
  const share = limit.limit > 0 ? Math.min(1, limit.used / limit.limit) : 1
  return (
    <div className="flex flex-col gap-1.5">
      <div className="h-1 overflow-hidden rounded-full bg-bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-fg-muted" style={{ width: `${share * 100}%` }} />
      </div>
      <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-xs text-fg-subtle">
        <span className="tabular">
          {limit.used} of {limit.limit} {limit.fairUse ? '' : 'free '}
          {w.many} used
        </span>
        <span>Resets {resetDay(limit.resetsAt)}</span>
      </div>
    </div>
  )
}

/** The modal card, opened from anywhere through `reportPlanLimit`. */
export function PlanLimitCard() {
  const { limit, alternative } = usePlanLimitCard()
  const navigate = useNavigate()
  return (
    <Dialog
      open={limit !== null}
      onOpenChange={(open) => {
        if (!open) closePlanLimit()
      }}
      title={limit ? titleOf(limit) : ''}
      // Prices and limits sit on a solid surface, never on glass.
      className="bg-bg!"
      footer={
        limit && (
          <>
            {alternative && (
              <Button
                variant="ghost"
                onClick={() => {
                  closePlanLimit()
                  alternative.run()
                }}
              >
                {alternative.label}
              </Button>
            )}
            <Button onClick={closePlanLimit}>Not now</Button>
            {!limit.fairUse && (
              <Button
                variant="primary"
                onClick={() => {
                  closePlanLimit()
                  void navigate({ to: '/upgrade' })
                }}
              >
                <Sparkles aria-hidden /> See {PLANS.pro.label}
              </Button>
            )}
          </>
        )
      }
    >
      {limit && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-fg-muted">{limit.message}</p>
          <UseLine limit={limit} />
        </div>
      )}
    </Dialog>
  )
}

/**
 * The same, under an assistant tool call that hit the limit. The call keeps only the sentence the
 * model saw, so the numbers come from the plan as it is now.
 */
export function PlanLimitNotice({
  allowance,
  message,
  className,
}: {
  allowance: Allowance
  message: string
  className?: string
}) {
  const plan = useRpc('plan.get', {})
  const a = plan.data?.allowances.find((x) => x.allowance === allowance)
  const fairUse = message.includes('fair-use')
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-md bg-bg p-3 text-sm shadow-[inset_0_0_0_1px_var(--line)]',
        className,
      )}
    >
      <div>
        <div className="font-medium">
          {fairUse
            ? 'This month’s fair-use ceiling is reached'
            : `Your free ${ALLOWANCE_WORDS[allowance].many} for this month are used`}
        </div>
        <p className="mt-0.5 text-fg-muted">{message}</p>
      </div>
      {a && plan.data && a.limit !== null && (
        <UseLine
          limit={{
            plan: plan.data.plan,
            allowance,
            limit: a.limit,
            used: a.used,
            resetsAt: plan.data.resetsAt,
            fairUse,
            message,
          }}
        />
      )}
      {!fairUse && (
        <Link to="/upgrade" className={cn(buttonClass({ size: 'sm' }), 'self-start')}>
          <Sparkles aria-hidden /> See {PLANS.pro.label}
        </Link>
      )}
    </div>
  )
}
