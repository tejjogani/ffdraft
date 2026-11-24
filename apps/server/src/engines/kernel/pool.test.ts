/** The kernel pool's failure behaviour: killed workers, timeouts and aborts. */
import { buildDesign, TEMPLATES } from '@pave/schema'
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
