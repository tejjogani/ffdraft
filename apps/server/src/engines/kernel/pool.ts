/**
 * The kernel off the event loop: a small pool of `worker_threads` (./worker), each running one
 * task at a time, so an evaluation never stalls other requests.
 *
 *  - One queue for the whole pool, dispatched whenever a worker is free: interactive evaluation
 *    first, then exports and render input, then packages and background work. Heavy work never
 *    takes the last worker (when there is more than one), so an evaluation never waits behind
 *    a 30 s STEP export.
 *  - Work for one piece goes to the worker that last handled it when that worker is free: its
 *    kernel for the piece caches every node, so a repeat evaluation is nearly free.
 *  - Workers start on demand, stop after a while idle, and are retired once idle when their
 *    memory (WASM heaps never shrink) exceeds the budget; the next task starts a fresh one.
 *  - A task that outlives its timeout, or is aborted and does not stop within a grace period,
 *    has its worker terminated (WASM cannot be interrupted mid-feature); a worker that dies is
 *    replaced. Either way only that task fails; the queue behind it carries on.
 */
import { createRequire } from 'node:module'
import { availableParallelism } from 'node:os'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { AppError, type ErrorCode } from '../../errors'
import type { FromWorker, KernelTask, TaskKind, TaskResults, WorkerConfig } from './protocol'

export interface RunOptions {
  /** The organisation the work is for; workers keep each one's caches apart. */
  tenant: string
  /** Work sharing a key (one piece) runs on its own warm kernel, on the worker that last did it. */
  affinity?: string
  /** Nobody is waiting on it (a facts refresh): it runs after everything else. */
  background?: boolean
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
  /** A worker holding more than this (JS heap and WASM) after a task is retired. */
  memoryBudgetMb?: number
  /** Pieces each worker keeps warm; each costs memory until the budget retires the worker. */
  kernelsPerWorker?: number
}

const DEFAULT_TIMEOUT_MS: Record<TaskKind, number> = {
  evaluate: 120_000,
  export: 300_000,
  renderInput: 300_000,
  subject: 120_000,
  package: 900_000,
  picture: 120_000,
  // The fit stops itself at its own budget (at most two minutes); this is the backstop.
  photoFit: 180_000,
}

const VERB: Record<TaskKind, string> = {
  evaluate: 'evaluate this design',
  export: 'export this design',
  renderInput: 'prepare this design for rendering',
  subject: 'measure this design for framing',
  package: 'build this production package',
  picture: 'draw this design',
  photoFit: 'fit this design to the photo',
}

/** Queue order: lower first. Anything above 0 is heavy and may not take the last free worker. */
const RANK: Record<TaskKind, number> = {
  evaluate: 0,
  picture: 0,
  export: 1,
  renderInput: 1,
  subject: 0,
  // A fit holds a worker for up to two minutes: heavy, so it never takes the last free one.
  photoFit: 2,
  package: 2,
}
const BACKGROUND_RANK = 2

/** What the kernel refuses on purpose: the caller's request, not the server, is at fault. */
const REFUSALS: [RegExp, ErrorCode][] = [
  [/^Nothing to export/, 'conflict'],
  [/reference each other in a cycle/, 'bad_request'],
  [/is not available in this build/, 'bad_request'],
]

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

function failure(kind: TaskKind, message: string): AppError {
  const refused = REFUSALS.find(([pattern]) => pattern.test(message))
  return refused
    ? new AppError(refused[1], message.slice(0, 500))
    : new AppError(
        'internal',
        `The geometry engine could not ${VERB[kind]}: ${message.slice(0, 500)}`,
      )
}

interface Job {
  id: number
  task: KernelTask
  options: RunOptions
  rank: number
  /** Where it runs; null while it waits in the queue. */
  slot: Slot | null
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
  idle: NodeJS.Timeout | null
  /** What the worker reported holding after its last task, in bytes. */
  memory: number
}

export class KernelPool {
  readonly size: number
  readonly #timeouts: Record<TaskKind, number>
  readonly #idleMs: number
  readonly #graceMs: number
  readonly #budget: number
  readonly #workerConfig: WorkerConfig
  readonly #slots: Slot[]
  /** Waiting jobs, by rank and then arrival. */
  #queue: Job[] = []
  readonly #routes = new Map<string, number>()
  readonly #entry = workerEntry()
  #nextId = 0
  #disposed = false

  constructor(options: KernelPoolOptions = {}) {
    this.size = Math.max(1, Math.floor(options.size ?? defaultPoolSize()))
    this.#timeouts = { ...DEFAULT_TIMEOUT_MS, ...options.timeoutMs }
    this.#idleMs = options.idleMs ?? 2 * 60_000
    this.#graceMs = options.graceMs ?? 3_000
    this.#budget = (options.memoryBudgetMb ?? 1_536) * 1024 * 1024
    this.#workerConfig = { kernels: Math.max(1, Math.floor(options.kernelsPerWorker ?? 3)) }
    this.#slots = Array.from({ length: this.size }, (_, index) => ({
      index,
      worker: null,
      current: null,
      idle: null,
      memory: 0,
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
      const job: Job = {
        id: this.#nextId++,
        task,
        options,
        rank: options.background ? BACKGROUND_RANK : RANK[task.kind],
        slot: null,
        timeoutMs: options.timeoutMs ?? this.#timeouts[task.kind],
        resolve: resolve as (value: unknown) => void,
        reject,
        answered: false,
      }
      if (options.signal) {
        job.onAbort = () => this.#abort(job)
        options.signal.addEventListener('abort', job.onAbort, { once: true })
      }
      const at = this.#queue.findIndex((queued) => queued.rank > job.rank)
      this.#queue.splice(at < 0 ? this.#queue.length : at, 0, job)
      this.#dispatch()
    })
  }

  /** Stops every worker; whatever is queued or running rejects as aborted. */
  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    for (const job of this.#queue) this.#answer(job, { error: abortError() })
    this.#queue = []
    const exits: Promise<number>[] = []
    for (const slot of this.#slots) {
      if (slot.current) {
        this.#clearTimers(slot.current)
        this.#answer(slot.current, { error: abortError() })
      }
      slot.current = null
      if (slot.idle) clearTimeout(slot.idle)
      if (slot.worker) exits.push(slot.worker.terminate())
      slot.worker = null
    }
    await Promise.allSettled(exits)
  }

  /** Starts queued work on free workers, highest rank first, then lets the rest idle. */
  #dispatch(): void {
    if (this.#disposed) return
    const maxHeavy = Math.max(1, this.size - 1)
    let heavy = this.#slots.filter((s) => s.current && s.current.rank > 0).length
    for (let i = 0; i < this.#queue.length; ) {
      const free = this.#slots.filter((s) => !s.current)
      if (free.length === 0) break
      const job = this.#queue[i]!
      if (job.rank > 0 && heavy >= maxHeavy) {
        i++
        continue
      }
      this.#queue.splice(i, 1)
      if (job.rank > 0) heavy++
      this.#start(this.#choose(job, free), job)
    }
    for (const slot of this.#slots)
      if (slot.worker && !slot.current && !slot.idle)
        slot.idle = setTimeout(() => {
          slot.idle = null
          if (!slot.current) this.#terminate(slot)
        }, this.#idleMs).unref()
  }

  /** The piece's own worker if free; else a running worker before starting another. */
  #choose(job: Job, free: Slot[]): Slot {
    const { affinity } = job.options
    const routed = affinity === undefined ? undefined : this.#routes.get(affinity)
    const slot =
      free.find((s) => s.index === routed) ?? free.find((s) => s.worker !== null) ?? free[0]!
    if (affinity !== undefined) {
      this.#routes.delete(affinity)
      this.#routes.set(affinity, slot.index)
      if (this.#routes.size > MAX_ROUTES) this.#routes.delete(this.#routes.keys().next().value!)
    }
    return slot
  }

  #start(slot: Slot, job: Job): void {
    if (slot.idle) clearTimeout(slot.idle)
    slot.idle = null
    slot.current = job
    job.slot = slot
    const worker = slot.worker ?? this.#spawn(slot)
    job.timer = setTimeout(() => this.#timedOut(job), job.timeoutMs)
    // The tenant is part of the key whatever the affinity says, so caches never cross orgs.
    const cache = `${job.options.tenant}\u0000${job.options.affinity ?? ''}`
    worker.postMessage({ type: 'run', id: job.id, cache, task: job.task })
  }

  #spawn(slot: Slot): Worker {
    const budgetMb = Math.round(this.#budget / 1024 / 1024)
    const worker = new Worker(this.#entry.url, {
      execArgv: this.#entry.execArgv,
      name: `pave-kernel-${slot.index}`,
      workerData: this.#workerConfig,
      // Geometry lives in WASM memory, outside this limit; it only stops a runaway JS heap.
      resourceLimits: { maxOldGenerationSizeMb: Math.max(512, budgetMb) },
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
      slot.memory = 0
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
    slot.memory = 0
    return worker
  }

  #message(slot: Slot, worker: Worker, message: FromWorker): void {
    const job = slot.current
    if (!job || job.id !== message.id) return
    switch (message.type) {
      case 'done':
        slot.memory = message.memory
        this.#answer(job, { value: message.result })
        this.#finish(slot, job)
        return
      case 'failed':
        slot.memory = message.memory
        this.#answer(job, {
          error: message.aborted
            ? abortError(job.options.signal)
            : failure(job.task.kind, message.message),
        })
        this.#finish(slot, job)
        return
      case 'progress':
        if (!job.answered) job.options.onProgress?.(message.value)
        return
      case 'asset': {
        const reply = (bytes?: Uint8Array, error?: string) => {
          if (slot.worker !== worker) return
          try {
            worker.postMessage(
              { type: 'asset', request: message.request, bytes, error },
              bytes ? [bytes.buffer as ArrayBuffer] : [],
            )
          } catch (err) {
            worker.postMessage({
              type: 'asset',
              request: message.request,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }
        const read = job.options.readAsset
        if (!read) {
          reply(undefined, 'Assets cannot be read here')
          return
        }
        read(message.assetId).then(
          // A real copy in a buffer of its own: transferring it can never detach (or trip over)
          // a buffer the asset store still holds, pooled or cached.
          (bytes) => reply(new Uint8Array(bytes)),
          (err: unknown) => reply(undefined, err instanceof Error ? err.message : String(err)),
        )
        return
      }
    }
  }

  #abort(job: Job): void {
    const { slot } = job
    this.#answer(job, { error: abortError(job.options.signal) })
    if (!slot) {
      this.#queue = this.#queue.filter((j) => j !== job)
      return
    }
    if (slot.current !== job) return
    slot.worker?.postMessage({ type: 'abort', id: job.id })
    job.grace = setTimeout(() => {
      if (slot.current !== job) return
      this.#terminate(slot)
      this.#finish(slot, job)
    }, this.#graceMs)
  }

  #timedOut(job: Job): void {
    const { slot } = job
    if (!slot || slot.current !== job) return
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

  /** The worker is free of `job`: retire it if it grew too big, then hand out the next task. */
  #finish(slot: Slot, job: Job): void {
    this.#clearTimers(job)
    if (slot.current === job) slot.current = null
    if (slot.worker && slot.memory > this.#budget) {
      console.info(
        `Kernel worker ${slot.index} retired holding ${Math.round(slot.memory / 1024 / 1024)} MB.`,
      )
      this.#terminate(slot)
    }
    this.#dispatch()
  }

  #terminate(slot: Slot): void {
    const worker = slot.worker
    slot.worker = null
    slot.memory = 0
    if (slot.idle) clearTimeout(slot.idle)
    slot.idle = null
    void worker?.terminate()
  }
}
