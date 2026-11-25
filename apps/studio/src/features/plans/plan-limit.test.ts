import { describe, expect, it } from 'vitest'
import { RpcError } from '../../lib/rpc'
import { planLimitOf, reportPlanLimit, resetDay, usePlanLimitCard } from './plan-limit'

const body = {
  plan: 'free',
  allowance: 'render',
  limit: 5,
  used: 5,
  resetsAt: '2026-12-01T00:00:00.000Z',
  fairUse: false,
}
const message = 'You have used your 5 free renders this month. Pro has unlimited renders.'

describe('the upgrade card', () => {
  it('opens for a plan limit and for nothing else', () => {
    expect(planLimitOf(new RpcError('plan_limit', message, 402, body))).toMatchObject({
      allowance: 'render',
      limit: 5,
      message,
    })
    expect(planLimitOf(new RpcError('budget_exceeded', 'Over budget', 402, {}))).toBeNull()
    expect(planLimitOf(new RpcError('plan_limit', message, 402, { plan: 'gold' }))).toBeNull()
    expect(planLimitOf(new Error(message))).toBeNull()

    expect(reportPlanLimit(new RpcError('conflict', 'x', 409))).toBe(false)
    expect(usePlanLimitCard.getState().limit).toBeNull()
    expect(reportPlanLimit(new RpcError('plan_limit', message, 402, body))).toBe(true)
    expect(usePlanLimitCard.getState().limit?.allowance).toBe('render')
  })

  it('says when the count resets', () => {
    expect(resetDay('2026-12-01T00:00:00.000Z')).toBe('1 December')
  })
})
