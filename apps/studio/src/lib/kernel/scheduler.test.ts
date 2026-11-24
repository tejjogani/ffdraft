import type { Evaluation } from '@pave/kernel'
import { applyOps, buildDesign, type Design, TEMPLATES } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { createScheduler, type Evaluator } from './scheduler'

const design = buildDesign(TEMPLATES.find((t) => t.id === 'halo')!.spec)
const nodeOf = (kind: string) => design.order.find((id) => design.nodes[id]!.kind === kind)!

/** A kernel that takes `ms` per evaluation and records what it was asked. */
function fakeKernel(ms = 5) {
  const seen: Design[] = []
  let active = 0
  let maxActive = 0
  const kernel: Evaluator = {
    async evaluate(d) {
      seen.push(d)
      maxActive = Math.max(maxActive, ++active)
      await new Promise((r) => setTimeout(r, ms))
      active--
      const timings = Object.fromEntries(
        d.order.map((id) => [id, d.nodes[id]!.kind === 'halo' ? 120 : 20]),
      )
      return { ms: 200, timings } as unknown as Evaluation
    },
  }
  return { kernel, seen, maxActive: () => maxActive }
}

const variant = (w: number) =>
  applyOps(design, [{ t: 'update', id: nodeOf('ringShank'), patch: { widthTop: w } }]).design

describe('evaluation scheduler', () => {
  it('runs one evaluation at a time and only the latest request per key', async () => {
    const fake = fakeKernel()
    const s = createScheduler(() => fake.kernel)
    const designs = [2, 2.2, 2.4, 2.6].map(variant)
    const results = await Promise.all(designs.map((d) => s.request('p1', d)))
    // The first was already running; the two in between were replaced by the last.
    expect(results.map((r) => r !== null)).toEqual([true, false, false, true])
    expect(fake.seen).toEqual([designs[0], designs[3]])
    expect(fake.maxActive()).toBe(1)
  })

  it('serves repeated requests for the same design from cache', async () => {
    const fake = fakeKernel()
    const s = createScheduler(() => fake.kernel)
    const d = variant(3)
    const a = await s.request('p1', d)
    const b = await s.request('p2', d)
    expect(b).toBe(a)
    expect(fake.seen).toHaveLength(1)
  })

  it('does not let one busy key starve another', async () => {
    const fake = fakeKernel()
    const s = createScheduler(() => fake.kernel)
    const other = variant(5)
    const busy = [2, 2.1, 2.2].map((w) => s.request('busy', variant(w)))
    const quiet = s.request('quiet', other)
    s.request('busy', variant(2.3))
    expect(await quiet).not.toBeNull()
    await Promise.all(busy)
    expect(fake.seen).toContain(other)
  })

  it('gives every caller waiting for the same design its result', async () => {
    const fake = fakeKernel()
    const s = createScheduler(() => fake.kernel)
    const busy = s.request('other', variant(2))
    const d = variant(2.4)
    // Two screens showing one piece ask while the kernel is busy.
    const [a, b] = await Promise.all([s.request('p1', d), s.request('p1', d), busy])
    expect(a).not.toBeNull()
    expect(b).toBe(a)
    expect(fake.seen.filter((x) => x === d)).toHaveLength(1)
  })

  it('learns per-node cost including dependents', async () => {
    const fake = fakeKernel(1)
    const s = createScheduler(() => fake.kernel)
    await s.request('p', design)
    // The halo depends on the gem, so the gem's closure includes the halo's 120 ms.
    expect(s.costOf(design, nodeOf('gem'))).toBeGreaterThan(150)
    expect(s.costOf(design, nodeOf('halo'))).toBeLessThan(150)
    expect(s.expectedMs).toBe(200)
  })

  it('passes kernel failures to the caller', async () => {
    const s = createScheduler(() => ({ evaluate: () => Promise.reject(new Error('boom')) }))
    await expect(s.request('p', design)).rejects.toThrow('boom')
  })
})
