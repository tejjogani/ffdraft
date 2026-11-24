/**
 * Evaluation requests against one kernel worker. The worker evaluates one design at a time and
 * its client aborts whatever is running when a new request arrives, so every caller goes
 * through here:
 *
 *  - one evaluation in flight; per key (a piece) only the latest request waits behind it, and
 *    the requests it replaces resolve to null ("superseded");
 *  - an in-flight evaluation is allowed to finish, so a continuous scrub still shows a steady
 *    stream of results at the kernel's pace instead of aborting each one;
 *  - results are cached per design object, so several screens showing one piece share them;
 *  - per-node timings are smoothed (EWMA) so the UI can tell which edits are cheap enough to
 *    evaluate while scrubbing.
 */
import type { EvaluateOptions, Evaluation } from '@pave/kernel'
import { type Design, nodeRefs } from '@pave/schema'

export interface Evaluator {
  evaluate(design: Design, options?: EvaluateOptions): Promise<Evaluation>
}

interface Waiting {
  design: Design
  resolve: (e: Evaluation | null) => void
  reject: (e: unknown) => void
}

const ALPHA = 0.3

export interface EvaluationScheduler {
  /** Resolves with the evaluation of `design`, or null when a newer request for `key` replaced it. */
  request(key: string, design: Design): Promise<Evaluation | null>
  /** The cached evaluation of exactly this design object, if any. */
  cached(design: Design): Evaluation | undefined
  /** Smoothed cost (ms) of re-evaluating `nodeId` and everything that depends on it. */
  costOf(design: Design, nodeId: string): number
  /** Smoothed wall-clock time of a whole evaluation (ms). */
  readonly expectedMs: number
}

export function createScheduler(
  getKernel: () => Evaluator,
  options: Omit<EvaluateOptions, 'signal'> = {},
): EvaluationScheduler {
  const cache = new WeakMap<Design, Evaluation>()
  const waiting = new Map<string, Waiting>()
  const nodeMs = new Map<string, number>()
  let expectedMs = 0
  let running = false

  const learn = (e: Evaluation) => {
    expectedMs = expectedMs ? expectedMs + ALPHA * (e.ms - expectedMs) : e.ms
    for (const [id, ms] of Object.entries(e.timings)) {
      // A node served from the kernel's cache reports ~0 ms; that says nothing about its cost.
      if (ms < 0.5) continue
      const prev = nodeMs.get(id)
      nodeMs.set(id, prev === undefined ? ms : prev + ALPHA * (ms - prev))
    }
  }

  const run = async () => {
    if (running) return
    running = true
    try {
      for (let next = waiting.entries().next(); !next.done; next = waiting.entries().next()) {
        const [key, job] = next.value
        waiting.delete(key)
        const hit = cache.get(job.design)
        if (hit) {
          job.resolve(hit)
          continue
        }
        try {
          const evaluation = await getKernel().evaluate(job.design, options)
          cache.set(job.design, evaluation)
          learn(evaluation)
          job.resolve(evaluation)
        } catch (err) {
          job.reject(err)
        }
      }
    } finally {
      running = false
    }
  }

  return {
    request(key, design) {
      const hit = cache.get(design)
      if (hit) return Promise.resolve(hit)
      return new Promise((resolve, reject) => {
        waiting.get(key)?.resolve(null)
        // Re-inserting moves the key to the back, so busy keys cannot starve quiet ones.
        waiting.delete(key)
        waiting.set(key, { design, resolve, reject })
        void run()
      })
    },
    cached: (design) => cache.get(design),
    costOf(design, nodeId) {
      const closure = new Set([nodeId])
      for (let grew = true; grew; ) {
        grew = false
        for (const n of Object.values(design.nodes))
          if (!closure.has(n.id) && nodeRefs(n).some((r) => closure.has(r))) {
            closure.add(n.id)
            grew = true
          }
      }
      let ms = 0
      for (const id of closure) ms += nodeMs.get(id) ?? 0
      return ms
    },
    get expectedMs() {
      return expectedMs
    },
  }
}
