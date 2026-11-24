interface Waiter {
  grant(): void
  onAbort?: () => void
  signal?: AbortSignal
}

/** A counting semaphore: at most `size` holders at once, served in arrival order. */
export class Limit {
  #free: number
  readonly #waiting: Waiter[] = []

  constructor(size: number) {
    this.#free = Math.max(1, Math.floor(size))
  }

  /** Resolves with a release function once a place is free; rejects if `signal` aborts first. */
  acquire(signal?: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason)
      let released = false
      const release = () => {
        if (released) return
        released = true
        this.#release()
      }
      if (this.#free > 0) {
        this.#free--
        return resolve(release)
      }
      const waiter: Waiter = { grant: () => resolve(release) }
      if (signal) {
        waiter.signal = signal
        waiter.onAbort = () => {
          this.#waiting.splice(this.#waiting.indexOf(waiter), 1)
          reject(signal.reason)
        }
        signal.addEventListener('abort', waiter.onAbort, { once: true })
      }
      this.#waiting.push(waiter)
    })
  }

  #release(): void {
    const next = this.#waiting.shift()
    if (!next) {
      this.#free++
      return
    }
    if (next.onAbort) next.signal?.removeEventListener('abort', next.onAbort)
    next.grant()
  }
}
