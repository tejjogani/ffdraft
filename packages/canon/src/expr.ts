/**
 * Serialisable formulas over {@link Facts}. A rule's numbers are data, not closures, so the canon
 * can be printed into a prompt, hashed into CANON_VERSION and diffed between versions.
 * Angles are degrees, like the schema. Comparisons return 1 or 0.
 */
import { snapToMelee } from '@pave/schema'
import { z } from 'zod'
import type { FactKey, Facts } from './facts'

export const OPS = [
  'add',
  'sub',
  'mul',
  'div',
  'min',
  'max',
  'clamp',
  'snapMelee',
  'asin',
  'cos',
  'gt',
  'lt',
  'eq',
  'and',
  'or',
  'if',
] as const
export type Op = (typeof OPS)[number]

export type Expr = number | { var: FactKey } | { op: Op; args: Expr[] }

export const ExprSchema: z.ZodType<Expr> = z.lazy(() =>
  z.union([
    z.number(),
    z.object({ var: z.string() }) as unknown as z.ZodType<{ var: FactKey }>,
    z.object({ op: z.enum(OPS), args: z.array(ExprSchema) }),
  ]),
)

const DEG = Math.PI / 180

/**
 * Evaluates `expr`; undefined when a fact it needs is unknown. `if`, `and` and `or` are lazy, so
 * a branch that is not taken may use facts the subject does not have (halo facts on a solitaire).
 */
export function evalExpr(expr: Expr, facts: Facts): number | undefined {
  if (typeof expr === 'number') return expr
  if ('var' in expr) return facts[expr.var]
  if (expr.op === 'if') {
    const [c, yes, no] = expr.args
    const cond = c === undefined ? undefined : evalExpr(c, facts)
    if (cond === undefined) return undefined
    const branch = cond !== 0 ? yes : no
    return branch === undefined ? undefined : evalExpr(branch, facts)
  }
  if (expr.op === 'and' || expr.op === 'or') {
    // Short-circuit: a decided result does not wait on unknown facts further along.
    let unknown = false
    for (const arg of expr.args) {
      const x = evalExpr(arg, facts)
      if (x === undefined) unknown = true
      else if ((x !== 0) === (expr.op === 'or')) return expr.op === 'or' ? 1 : 0
    }
    return unknown ? undefined : expr.op === 'or' ? 0 : 1
  }
  const a: number[] = []
  for (const arg of expr.args) {
    const v = evalExpr(arg, facts)
    if (v === undefined) return undefined
    a.push(v)
  }
  const [x = 0, y = 0, z3 = 0] = a
  switch (expr.op) {
    case 'add':
      return a.reduce((s, v) => s + v, 0)
    case 'sub':
      return x - y
    case 'mul':
      return a.reduce((s, v) => s * v, 1)
    case 'div':
      return x / y
    case 'min':
      return Math.min(...a)
    case 'max':
      return Math.max(...a)
    case 'clamp':
      return Math.min(z3, Math.max(y, x))
    case 'snapMelee':
      return snapToMelee(x)
    case 'asin':
      return Math.asin(Math.min(1, Math.max(-1, x))) / DEG
    case 'cos':
      return Math.cos(x * DEG)
    case 'gt':
      return x > y ? 1 : 0
    case 'lt':
      return x < y ? 1 : 0
    case 'eq':
      return Math.abs(x - y) < 1e-9 ? 1 : 0
  }
  return undefined
}

const INFIX: Partial<Record<Op, string>> = {
  add: ' + ',
  sub: ' − ',
  mul: '·',
  div: '/',
  gt: ' > ',
  lt: ' < ',
  eq: ' = ',
  and: ' and ',
  or: ' or ',
}

const trim = (n: number) => String(Number(n.toFixed(3)))

/** Human-readable form for prompts and docs: `clamp(0.3·W, 1.8, 2.4)`. */
export function printExpr(expr: Expr): string {
  if (typeof expr === 'number') return trim(expr)
  if ('var' in expr) return expr.var
  const inner = expr.args.map((arg) => {
    const s = printExpr(arg)
    return typeof arg === 'object' && 'op' in arg && INFIX[arg.op] && INFIX[expr.op] ? `(${s})` : s
  })
  const infix = INFIX[expr.op]
  if (infix) return inner.join(infix)
  if (expr.op === 'if') return `${inner[0]} ? ${inner[1]} : ${inner[2]}`
  if (expr.op === 'snapMelee') return `melee(${inner[0]})`
  return `${expr.op}(${inner.join(', ')})`
}

// ── Builders: keep rule files readable ───────────────────────────────────────────────────────

export const v = (name: FactKey): Expr => ({ var: name })
const op =
  (o: Op) =>
  (...args: Expr[]): Expr => ({ op: o, args })
export const add = op('add')
export const sub = op('sub')
export const mul = op('mul')
export const div = op('div')
export const min = op('min')
export const max = op('max')
export const asin = op('asin')
export const cos = op('cos')
export const gt = op('gt')
export const lt = op('lt')
export const eq = op('eq')
export const and = op('and')
export const or = op('or')
export const clamp = (x: Expr, lo: Expr, hi: Expr): Expr => ({ op: 'clamp', args: [x, lo, hi] })
export const snap = (x: Expr): Expr => ({ op: 'snapMelee', args: [x] })
export const iff = (c: Expr, a: Expr, b: Expr): Expr => ({ op: 'if', args: [c, a, b] })
