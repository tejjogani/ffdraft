/**
 * The kernel off the event loop: a small pool of `worker_threads` (./worker), each running one
 * task at a time, so an evaluation never stalls other requests.
 *
 *  - Workers start on demand and stop after a while idle (their caches go with them).
 *  - Work for one piece goes back to the worker that last handled it when that worker is no
 *    busier than any other: its per-node cache makes a repeat evaluation nearly free.
 *  - A task that outlives its timeout, or is aborted and does not stop within a grace period,
 *    has its worker terminated (WASM cannot be interrupted mid-feature); a worker that dies is
 *    replaced. Either way only that task fails; the queue behind it carries on.
 */
import { createRequire } from 'node:module'
import { availableParallelism } from 'node:os'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { AppError } from '../../errors'
import type { FromWorker, KernelTask, TaskKind, TaskResults } from './protocol'

export interface RunOptions {
  /** The organisation the work is for; workers keep each one's cache apart. */
  tenant: string
  /** Work sharing a key (one piece) prefers the worker that last did it. */
  affinity?: string
  signal?: AbortSignal
  /** Overrides the pool's timeout for this kind of task. */
  timeoutMs?: number
  onProgress?(value: number): void
  /** Bytes of an asset the design references (meshes, height maps), from the tenant's store. */
  readAsset?(assetId: string): Promise<Uint8Array>
}

export interface KernelPoolOptions {
  /** Most workers at once. Default: one per CPU but one, between 1 and 4. */
  size?: number
  timeoutMs?: Partial<Record<TaskKind, number>>
  /** A worker idle this long is stopped. */
  idleMs?: number
  /** How long an aborted task may take to notice before its worker is terminated. */
  graceMs?: number
}

const DEFAULT_TIMEOUT_MS: Record<TaskKind, number> = {
  evaluate: 120_000,
  export: 300_000,
  renderInput: 300_000,
  package: 900_000,
}

const VERB: Record<TaskKind, string> = {
  evaluate: 'evaluate this design',
  export: 'export this design',
  renderInput: 'prepare this design for rendering',
  package: 'build this production package',
}

/** Remembered piece → worker routes; the oldest are forgotten beyond this. */
const MAX_ROUTES = 2_000

export const defaultPoolSize = (): number => Math.max(1, Math.min(4, availableParallelism() - 1))

/** The worker module next to this one; from TypeScript source it needs tsx's loader. */
function workerEntry(): { url: URL; execArgv: string[] } {
  const source = import.meta.url.endsWith('.ts')
  const url = new URL(source ? './worker.ts' : './worker.js', import.meta.url)
  if (!source) return { url, execArgv: [] }
  const tsx = createRequire(import.meta.url).resolve('tsx')
  return { url, execArgv: ['--import', pathToFileURL(tsx).href] }
}

const abortError = (signal?: AbortSignal): unknown =>
  signal?.reason ?? new DOMException('The geometry task was aborted', 'AbortError')

interface Job {
  id: number
  tenant: string
  task: KernelTask
  options: RunOptions
  slot: Slot
  timeoutMs: number
  resolve(value: unknown): void
  reject(error: unknown): void
  /** The caller has its answer; the worker may still be winding the task down. */
  answered: boolean
  timer?: NodeJS.Timeout
  grace?: NodeJS.Timeout
  onAbort?: () => void
}

interface Slot {
  index: number
  worker: Worker | null
  current: Job | null
  queue: Job[]
  idle: NodeJS.Timeout | null
}

export class KernelPool {
  readonly size: number
  readonly #timeouts: Record<TaskKind, number>
  readonly #idleMs: number
  readonly #graceMs: number
  readonly #slots: Slot[]
  readonly #routes = new Map<string, number>()
  readonly #entry = workerEntry()
  #nextId = 0
  #disposed = false

  constructor(options: KernelPoolOptions = {}) {
    this.size = Math.max(1, Math.floor(options.size ?? defaultPoolSize()))
    this.#timeouts = { ...DEFAULT_TIMEOUT_MS, ...options.timeoutMs }
    this.#idleMs = options.idleMs ?? 10 * 60_000
    this.#graceMs = options.graceMs ?? 3_000
    this.#slots = Array.from({ length: this.size }, (_, index) => ({
      index,
      worker: null,
      current: null,
      queue: [],
      idle: null,
    }))
  }

  /** The live worker threads by slot (null where none is running) — for diagnostics. */
  get threads(): readonly (Worker | null)[] {
    return this.#slots.map((s) => s.worker)
  }

  run<K extends TaskKind>(
    task: Extract<KernelTask, { kind: K }>,
    options: RunOptions,
  ): Promise<TaskResults[K]> {
    return new Promise<TaskResults[K]>((resolve, reject) => {
      if (this.#disposed) return reject(abortError())
      if (options.signal?.aborted) return reject(abortError(options.signal))
      const slot = this.#pick(options.affinity)
      const job: Job = {
        id: this.#nextId++,
        tenant: options.tenant,
        task,
        options,
        slot,
        timeoutMs: options.timeoutMs ?? this.#timeouts[task.kind],
        resolve: resolve as (value: unknown) => void,
        reject,
        answered: false,
      }
      if (options.signal) {
        job.onAbort = () => this.#abort(job)
        options.signal.addEventListener('abort', job.onAbort, { once: true })
      }
      slot.queue.push(job)
      if (!slot.current) this.#next(slot)
    })
  }

  /** Stops every worker; whatever is queued or running rejects as aborted. */
  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    const exits: Promise<number>[] = []
    for (const slot of this.#slots) {
      for (const job of [slot.current, ...slot.queue]) {
        if (!job) continue
        this.#clearTimers(job)
        this.#answer(job, { error: abortError() })
      }
      slot.current = null
      slot.queue = []
      if (slot.idle) clearTimeout(slot.idle)
      if (slot.worker) exits.push(slot.worker.terminate())
      slot.worker = null
    }
    await Promise.allSettled(exits)
  }

  #load(slot: Slot): number {
    return (slot.current ? 1 : 0) + slot.queue.length
  }

  #pick(affinity: string | undefined): Slot {
    const min = Math.min(...this.#slots.map((s) => this.#load(s)))
    const routed = affinity === undefined ? undefined : this.#routes.get(affinity)
    const slot =
      routed !== undefined && this.#load(this.#slots[routed]!) <= min
        ? this.#slots[routed]!
        : // Among the least loaded, a running worker before starting another.
          this.#slots
            .filter((s) => this.#load(s) === min)
            .sort((a, b) => Number(!!b.worker) - Number(!!a.worker))[0]!
    if (affinity !== undefined) {
      this.#routes.delete(affinity)
      this.#routes.set(affinity, slot.index)
      if (this.#routes.size > MAX_ROUTES) this.#routes.delete(this.#routes.keys().next().value!)
    }
    return slot
  }

  /** Starts the slot's next task, or lets its worker idle. */
  #next(slot: Slot): void {
    if (this.#disposed) return
    const job = slot.queue.shift()
    if (!job) {
      if (slot.worker && !slot.idle)
        slot.idle = setTimeout(() => {
          slot.idle = null
          if (!slot.current && slot.queue.length === 0) this.#terminate(slot)
        }, this.#idleMs).unref()
      return
    }
    if (slot.idle) clearTimeout(slot.idle)
    slot.idle = null
    slot.current = job
    const worker = slot.worker ?? this.#spawn(slot)
    job.timer = setTimeout(() => this.#timedOut(job), job.timeoutMs)
    worker.postMessage({ type: 'run', id: job.id, tenant: job.tenant, task: job.task })
  }

  #spawn(slot: Slot): Worker {
    const worker = new Worker(this.#entry.url, {
      execArgv: this.#entry.execArgv,
      name: `pave-kernel-${slot.index}`,
      // OpenCascade's STEP writer prints transfer statistics to stdout; errors use stderr.
      stdout: true,
    })
    worker.stdout.resume()
    // Pending work, not an idle worker, is what should keep a process alive.
    worker.unref()
    let lastError: unknown = null
    worker.on('message', (message: FromWorker) => {
      if (slot.worker === worker) this.#message(slot, worker, message)
    })
    worker.on('error', (err) => {
      lastError = err
    })
    worker.on('exit', (code) => {
      // Workers this pool stopped itself are already detached from their slot.
      if (slot.worker !== worker) return
      slot.worker = null
      console.error(`Kernel worker ${slot.index} exited (code ${code}):`, lastError ?? '')
      const job = slot.current
      if (!job) return
      this.#answer(job, {
        error: new AppError(
          'internal',
          `The geometry engine stopped while trying to ${VERB[job.task.kind]}; try again.`,
        ),
      })
      this.#finish(slot, job)
    })
    slot.worker = worker
    return worker
  }

  #message(slot: Slot, worker: Worker, message: FromWorker): void {
    const job = slot.current
    if (!job || job.id !== message.id) return
    switch (message.type) {
      case 'done':
        this.#answer(job, { value: message.result })
        return this.#finish(slot, job)
      case 'failed':
        this.#answer(job, {
          error: message.aborted
            ? abortError(job.options.signal)
            : new AppError(
                'internal',
                `The geometry engine could not ${VERB[job.task.kind]}: ${message.message.slice(0, 500)}`,
              ),
        })
        return this.#finish(slot, job)
      case 'progress':
        if (!job.answered) job.options.onProgress?.(message.value)
        return
      case 'asset': {
        const reply = (bytes?: Uint8Array, error?: string) => {
          if (slot.worker !== worker) return
          worker.postMessage(
            { type: 'asset', request: message.request, bytes, error },
            bytes ? [bytes.buffer as ArrayBuffer] : [],
          )
        }
        const read = job.options.readAsset
        if (!read) return reply(undefined, 'Assets cannot be read here')
        read(message.assetId).then(
          // A copy, so the transfer cannot detach a buffer the asset store still holds.
          (bytes) => reply(bytes.slice()),
          (err: unknown) => reply(undefined, err instanceof Error ? err.message : String(err)),
        )
        return
      }
    }
  }

  #abort(job: Job): void {
    const { slot } = job
    if (slot.current !== job) {
      slot.queue = slot.queue.filter((j) => j !== job)
      return this.#answer(job, { error: abortError(job.options.signal) })
    }
    this.#answer(job, { error: abortError(job.options.signal) })
    slot.worker?.postMessage({ type: 'abort', id: job.id })
    job.grace = setTimeout(() => {
      if (slot.current !== job) return
      this.#terminate(slot)
      this.#finish(slot, job)
    }, this.#graceMs)
  }

  #timedOut(job: Job): void {
    const { slot } = job
    if (slot.current !== job) return
    this.#answer(job, {
      error: new AppError(
        'internal',
        `Stopped trying to ${VERB[job.task.kind]} after ${Math.round(job.timeoutMs / 1000)} s.`,
      ),
    })
    // Whatever it is stuck in cannot be interrupted from outside the thread.
    this.#terminate(slot)
    this.#finish(slot, job)
  }

  #answer(job: Job, outcome: { value: unknown } | { error: unknown }): void {
    if (job.answered) return
    job.answered = true
    if (job.onAbort) job.options.signal?.removeEventListener('abort', job.onAbort)
    if ('value' in outcome) job.resolve(outcome.value)
    else job.reject(outcome.error)
  }

  #clearTimers(job: Job): void {
    clearTimeout(job.timer)
    clearTimeout(job.grace)
  }

  /** The worker is free of `job`: move on to the next. */
  #finish(slot: Slot, job: Job): void {
    this.#clearTimers(job)
    if (slot.current === job) slot.current = null
    this.#next(slot)
  }

  #terminate(slot: Slot): void {
    const worker = slot.worker
    slot.worker = null
    void worker?.terminate()
  }
}
