import { describe, expect, it } from 'vitest'
import { add, and, clamp, evalExpr, iff, mul, or, printExpr, snap, v } from './expr'

describe('expr', () => {
  it('evaluates formulas over facts and is undefined when a fact is missing', () => {
    const e = clamp(mul(0.3, v('W')), 1.8, 2.4)
    expect(evalExpr(e, { W: 6.5 })).toBeCloseTo(1.95)
    expect(evalExpr(e, { W: 10 })).toBe(2.4)
    expect(evalExpr(e, {})).toBeUndefined()
    expect(evalExpr(snap(add(mul(0.1, v('W')), 0.6)), { W: 6.5 })).toBe(1.25)
    expect(evalExpr(iff(v('halo'), 1, 2), { halo: 0 })).toBe(2)
  })

  it('evaluates if, and and or lazily, so an untaken branch may use unknown facts', () => {
    expect(evalExpr(iff(v('halo'), v('haloD'), 2), { halo: 0 })).toBe(2)
    expect(evalExpr(iff(v('halo'), v('haloD'), 2), { halo: 1 })).toBeUndefined()
    expect(evalExpr(and(v('halo'), v('haloD')), { halo: 0 })).toBe(0)
    expect(evalExpr(or(v('halo'), v('haloD')), { halo: 1 })).toBe(1)
    expect(evalExpr(and(v('halo'), v('haloD')), { halo: 1 })).toBeUndefined()
  })

  it('prints readably', () => {
    expect(printExpr(clamp(mul(0.3, v('W')), 1.8, 2.4))).toBe('clamp(0.3·W, 1.8, 2.4)')
    expect(printExpr(add(mul(0.1, v('W')), 0.35))).toBe('(0.1·W) + 0.35')
  })
})
