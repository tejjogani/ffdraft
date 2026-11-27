import { buildDesign, TEMPLATES } from '@pave/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Fake kernel clients: each behaves like the real one when its Worker dies (everything pending
 * rejects with WorkerCrashedError, then onCrash is called once) whenever the test says so.
 */
const made: { exportCalls: number; onCrash?: (e: Error) => void; die(): void }[] = []
let ready: Promise<void> | undefined
vi.mock('@pave/kernel/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('@pave/kernel/client')>()
  return {
    ...real,
    createKernelClient: (options: { onCrash?: (e: Error) => void } = {}) => {
      const pending: ((e: Error) => void)[] = []
      let dead: Error | null = null
      const fake = {
        onCrash: options.onCrash,
        exportCalls: 0,
        die() {
          dead = new real.WorkerCrashedError('The geometry engine stopped: killed')
          for (const reject of pending.splice(0)) reject(dead)
          options.onCrash?.(dead)
        },
      }
      made.push(fake)
      return {
        kinds: ['primitive'],
        formats: [],
        ready: () => (dead ? Promise.reject(dead) : (ready ?? Promise.resolve())),
        evaluate: () =>
          dead
            ? Promise.reject(dead)
            : new Promise((resolve, reject) => {
                pending.push(reject)
                // A live Worker answers; the test kills the first one before it does.
                setTimeout(() => resolve({ ms: 1, timings: {}, parts: [] }), 20)
              }),
        export: () => {
          fake.exportCalls++
          return Promise.resolve({ extension: 'glb' })
        },
        terminate() {},
      }
    },
  }
})
vi.stubGlobal('location', { search: '' })

const design = buildDesign(TEMPLATES[0]!.spec)

describe('studio kernel', () => {
  beforeEach(() => {
    made.length = 0
    ready = undefined
    vi.resetModules()
  })

  it('replaces a draft Worker that dies under a request, and asks the new one', async () => {
    const { evaluationScheduler, warmKernel } = await import('./client')
    warmKernel()
    await Promise.resolve()
    const result = evaluationScheduler('draft').request('piece', design)
    await new Promise((resolve) => setTimeout(resolve, 5))
    made[0]!.die()
    expect(await result).toMatchObject({ ms: 1 })
    expect(made).toHaveLength(2)
  })

  it('waits for a newly started production Worker before sending an export', async () => {
    const { exportDesign } = await import('./client')
    let release!: () => void
    ready = new Promise<void>((resolve) => {
      release = resolve
    })

    const result = exportDesign(design, 'glb')
    expect(made[0]!.exportCalls).toBe(0)

    release()
    await expect(result).resolves.toMatchObject({ extension: 'glb' })
    expect(made[0]!.exportCalls).toBe(1)
  })

  it('reports crashed after the replacement dies too', async () => {
    const { evaluationScheduler, warmKernel } = await import('./client')
    warmKernel()
    await Promise.resolve()
    const first = evaluationScheduler('draft').request('piece', design)
    await new Promise((resolve) => setTimeout(resolve, 5))
    made[0]!.die()
    await new Promise((resolve) => setTimeout(resolve, 5))
    made[1]!.die()
    await expect(first).rejects.toMatchObject({ name: 'WorkerCrashedError' })
    await expect(evaluationScheduler('draft').request('piece', { ...design })).rejects.toThrow(
      /stopped/,
    )
    expect(made).toHaveLength(2)
  })
})
