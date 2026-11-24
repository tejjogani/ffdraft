/**
 * Cancellation and time limits for the synchronous parts of a fit (pose search, camera polish).
 * Rendering is synchronous, so without a check inside those loops an abort from a timer, a
 * request or a Worker message would never be delivered while a fit runs in-process. `tick` checks
 * the signal and the deadline and, every `SLICE_MS`, yields one macrotask so those events can run.
 */

/** Why a guarded loop stopped: the caller's signal, or the time budget. */
export class Stop extends Error {
  constructor(readonly reason: 'budget' | 'aborted' | 'time') {
    super(reason)
  }
}

/** Longest stretch of synchronous work between yields. */
export const SLICE_MS = 40

export interface Guard {
  /** Throws `Stop` when aborted or past the deadline. */
  check(): void
  /** `check`, then yield to the event loop if the last yield was `SLICE_MS` ago, then `check` again. */
  tick(): Promise<void>
  readonly deadline: number
}

const yieldOnce = () => new Promise<void>((r) => setTimeout(r, 0))

export function makeGuard(signal?: AbortSignal, deadline = Infinity): Guard {
  let last = performance.now()
  const check = () => {
    if (signal?.aborted) throw new Stop('aborted')
    if (performance.now() >= deadline) throw new Stop('time')
  }
  return {
    deadline,
    check,
    async tick() {
      check()
      const now = performance.now()
      if (now - last >= SLICE_MS) {
        await yieldOnce()
        last = performance.now()
        check()
      }
    },
  }
}

/** A guard that never stops; for callers with no signal and no deadline. */
export const NO_GUARD: Guard = makeGuard()
