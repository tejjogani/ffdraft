import { describe, expect, it } from 'vitest'
import { planStartsOpen } from './plan-open'

const store = (v: string | null) => ({ getItem: () => v })
const now = Date.parse('2026-11-25T10:00:30.000Z')

describe('the job plan panel', () => {
  it('opens by itself only for a job that just started', () => {
    expect(planStartsOpen('r', '2026-11-25T10:00:25.000Z', now, store(null))).toBe(true)
    expect(planStartsOpen('r', '2026-11-25T09:00:00.000Z', now, store(null))).toBe(false)
  })

  it('stays as the person left it, also after a reload', () => {
    expect(planStartsOpen('r', '2026-11-25T10:00:25.000Z', now, store('closed'))).toBe(false)
    expect(planStartsOpen('r', '2026-11-25T09:00:00.000Z', now, store('open'))).toBe(true)
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
    }
    expect(planStartsOpen('r', '2026-11-25T09:00:00.000Z', now, broken)).toBe(false)
  })
})
