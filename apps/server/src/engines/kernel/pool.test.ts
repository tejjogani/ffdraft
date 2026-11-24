/** The kernel pool: scheduling, warm kernels, memory, killed workers, timeouts and aborts. */
import { applyOps, buildDesign, type Design, emptyDesign, TEMPLATES } from '@pave/schema'
import { afterAll, describe, expect, it } from 'vitest'
import { KernelPool } from './pool'

const design = (id: string) => buildDesign(TEMPLATES.find((t) => t.id === id)!.spec)
const evaluate = (
  pool: KernelPool,
  id: string,
  extra: Partial<Parameters<KernelPool['run']>[1]> = {},
) =>
  pool.run(
    { kind: 'evaluate', design: design(id), detail: 'production' },
    { tenant: 'org_test', ...extra },
  )

/** Resolves once the first worker thread exists (it starts with the first task). */
async function firstThread(pool: KernelPool) {
  for (;;) {
    const thread = pool.threads.find((t) => t !== null)
    if (thread) return thread
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('kernel pool', () => {
  const pool = new KernelPool({ size: 1, graceMs: 500 })
  afterAll(() => pool.dispose())

  it('replaces a worker that dies, failing only the task it was running', async () => {
    const doomed = evaluate(pool, 'iced-trophy')
    const queued = evaluate(pool, 'solitaire')
    const thread = await firstThread(pool)
    await new Promise((r) => setTimeout(r, 300))
    await thread.terminate()
    await expect(doomed).rejects.toThrow(/stopped while trying to evaluate/)
    expect((await queued).stoneCount).toBe(1)
    expect(pool.threads[0]).not.toBe(thread)
  })

  it('stops a task that outlives its timeout and carries on', async () => {
    await expect(evaluate(pool, 'iced-initial', { timeoutMs: 50 })).rejects.toThrow(
      /Stopped trying to evaluate this design after 0 s/,
    )
    expect((await evaluate(pool, 'wedding-band')).stoneCount).toBe(0)
  })

  it('abandons aborted work, queued or running', async () => {
    const running = new AbortController()
    const queued = new AbortController()
    const first = evaluate(pool, 'tennis', { signal: running.signal })
    const second = evaluate(pool, 'eternity', { signal: queued.signal })
    queued.abort()
    await expect(second).rejects.toThrow(/aborted/i)
    await firstThread(pool)
    running.abort()
    await expect(first).rejects.toThrow(/aborted/i)
    expect((await evaluate(pool, 'solitaire')).caratTotal).toBeCloseTo(1, 1)
  })

  it('rejects everything once disposed', async () => {
    const other = new KernelPool({ size: 1 })
    const pending = expect(evaluate(other, 'halo')).rejects.toThrow(/aborted/i)
    await other.dispose()
    await pending
    await expect(evaluate(other, 'halo')).rejects.toThrow(/aborted/i)
  })
})

/** A closed tetrahedron, small enough that `Buffer.from` puts it in Node's shared pool. */
const TETRAHEDRON = `solid t
${[
  ['0 0 0', '0 10 0', '10 0 0'],
  ['0 0 0', '10 0 0', '0 0 10'],
  ['0 0 0', '0 0 10', '0 10 0'],
  ['10 0 0', '0 10 0', '0 0 10'],
]
  .map(
    (v) =>
      `facet normal 0 0 0\nouter loop\n${v.map((p) => `vertex ${p}`).join('\n')}\nendloop\nendfacet`,
  )
  .join('\n')}
endsolid t
`

/** The solitaire with a sculpted charm whose mesh is the asset `assetId`. */
const withCharm = (assetId: string): Design =>
  applyOps(design('solitaire'), [
    {
      t: 'add',
      node: {
        id: 'charm',
        kind: 'meshBody',
        name: 'Charm',
        source: { type: 'asset', assetId },
        height: 10,
      } as never,
    },
  ]).design

describe('kernel pool scheduling', () => {
  it('never lets heavy work take the last worker, so an evaluation does not wait behind it', async () => {
    const pool = new KernelPool({ size: 2, graceMs: 200 })
    try {
      const heavy = new AbortController()
      const settled: string[] = []
      const exports = ['iced-trophy', 'iced-initial'].map((id) =>
        pool
          .run(
            { kind: 'export', design: design(id), format: 'step', stones: false },
            { tenant: 'org_test', affinity: id, signal: heavy.signal },
          )
          .catch(() => {})
          .finally(() => settled.push(id)),
      )
      await new Promise((r) => setTimeout(r, 200))
      const quick = await pool.run(
        { kind: 'evaluate', design: design('solitaire'), detail: 'draft' },
        { tenant: 'org_test', affinity: 'solitaire' },
      )
      expect(quick.stoneCount).toBe(1)
      // Both exports are still going (or waiting); the evaluation did not queue behind them.
      expect(settled).toEqual([])
      heavy.abort()
      await Promise.all(exports)
    } finally {
      await pool.dispose()
    }
  })

  it('serves queued evaluations before queued exports', async () => {
    const pool = new KernelPool({ size: 1, graceMs: 200 })
    try {
      const first = new AbortController()
      const order: string[] = []
      const running = pool
        .run(
          { kind: 'export', design: design('iced-initial'), format: 'stl', stones: false },
          { tenant: 'org_test', signal: first.signal },
        )
        .catch(() => {})
      const exported = pool
        .run(
          { kind: 'export', design: design('wedding-band'), format: 'stl', stones: false },
          { tenant: 'org_test' },
        )
        .then(() => order.push('export'))
      const evaluated = pool
        .run(
          { kind: 'evaluate', design: design('wedding-band'), detail: 'draft' },
          { tenant: 'org_test' },
        )
        .then(() => order.push('evaluate'))
      first.abort()
      await Promise.all([running, exported, evaluated])
      expect(order).toEqual(['evaluate', 'export'])
    } finally {
      await pool.dispose()
    }
  })

  it('keeps each piece warm on its own kernel, whatever else the worker evaluates', async () => {
    const pool = new KernelPool({ size: 1 })
    try {
      const timed = async (id: string) => {
        const started = performance.now()
        await pool.run(
          { kind: 'evaluate', design: design(id), detail: 'draft' },
          { tenant: 'org_test', affinity: id },
        )
        return performance.now() - started
      }
      await timed('wedding-band') // loads the runtime
      const cold = await timed('name-pendant')
      await timed('signet')
      const warm = await timed('name-pendant')
      expect(warm).toBeLessThan(cold / 5)
    } finally {
      await pool.dispose()
    }
  })

  it('retires a worker that holds more than its memory budget, and starts a fresh one', async () => {
    const pool = new KernelPool({ size: 1, memoryBudgetMb: 1 })
    try {
      expect((await evaluate(pool, 'wedding-band')).stoneCount).toBe(0)
      expect(pool.threads[0]).toBeNull()
      expect((await evaluate(pool, 'solitaire')).stoneCount).toBe(1)
    } finally {
      await pool.dispose()
    }
  })
})

describe('kernel pool requests and refusals', () => {
  const pool = new KernelPool({ size: 1 })
  afterAll(() => pool.dispose())

  it('hands a worker its own copy of an asset, even from a pooled buffer', async () => {
    const pooled = Buffer.from(TETRAHEDRON)
    expect(pooled.byteLength).toBeLessThan(pooled.buffer.byteLength)
    const summary = await pool.run(
      { kind: 'evaluate', design: withCharm('mesh'), detail: 'draft' },
      { tenant: 'org_test', readAsset: async () => pooled },
    )
    expect(summary.diagnostics.filter((d) => d.code === 'feature.failed')).toEqual([])
    // The store's buffer is untouched by the transfer.
    expect(pooled.toString()).toBe(TETRAHEDRON)
  })

  it('says in an export which features could not be built and are missing from the file', async () => {
    const { notes } = await pool.run(
      { kind: 'export', design: withCharm('gone'), format: 'stl', stones: false },
      {
        tenant: 'org_test',
        readAsset: async () => {
          throw new Error('Asset "gone" not found')
        },
      },
    )
    expect(notes[0]).toMatch(/Charm.*could not be built.*not in this file/)
  })

  it('reports what the kernel refuses as the caller’s problem, not the server’s', async () => {
    await expect(
      pool.run(
        { kind: 'export', design: emptyDesign(), format: 'stl', stones: false },
        { tenant: 'org_test' },
      ),
    ).rejects.toMatchObject({
      code: 'conflict',
      message: expect.stringMatching(/^Nothing to export/),
    })
  })
})
