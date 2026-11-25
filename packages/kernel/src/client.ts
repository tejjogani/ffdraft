/**
 * `createKernelClient()`: the kernel behind a Worker, for browsers. Evaluation never blocks the
 * UI thread; geometry arrives as transferred typed arrays, and only the parts that changed.
 */
import type { Design } from '@pave/schema'
import {
  type Locks,
  PartLedger,
  type Port,
  platformLocks,
  type Request,
  type Response,
} from './protocol'
import type {
  AssetResolver,
  EvaluateOptions,
  Evaluation,
  ExportFormat,
  ExportOptions,
  ExportResult,
  Kernel,
} from './types'

export interface KernelClient extends Kernel {
  /** Stops the Worker and rejects everything still pending. The client cannot be used afterwards. */
  terminate(): void
}

/** Events a real Worker raises when it fails to start, throws, or cannot be messaged. */
interface WorkerEvents {
  addEventListener?(type: 'error' | 'messageerror', listener: (event: unknown) => void): void
}

export interface KernelClientOptions {
  /**
   * The Worker (or any message port serving the kernel). Defaults to this package's module
   * Worker, which needs a bundler that understands `new Worker(new URL(…, import.meta.url))`.
   */
  port?: Port<Request, Response> & { terminate?(): void } & WorkerEvents
  /**
   * Called once when the Worker fails: it could not load or threw while starting, it died
   * (killed, out of memory: learnt from a Web Lock it holds while it lives), or a message could
   * not be delivered. Everything pending has been rejected with a {@link WorkerCrashedError}
   * and the client is unusable: start a new one.
   */
  onCrash?(error: WorkerCrashedError): void
  /** The Web Locks API; defaults to `navigator.locks`. Without one a dead Worker goes unseen. */
  locks?: Locks
}

/**
 * The kernel Worker failed: it could not be loaded, threw outside a request, or a message to
 * or from it could not be delivered. Its state is unknown, so the client stops using it.
 */
export class WorkerCrashedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkerCrashedError'
  }
}

interface Pending {
  resolve(value: never): void
  reject(error: Error): void
  assets?: AssetResolver | undefined
}

const abortError = (): Error =>
  new DOMException('The evaluation was superseded or aborted', 'AbortError')

export function createKernelClient(options: KernelClientOptions = {}): KernelClient {
  // A Worker is a wider version of the port this file needs.
  const port =
    options.port ??
    (new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
      name: 'pave-kernel',
    }) as unknown as NonNullable<KernelClientOptions['port']>)
  const ledger = new PartLedger()
  const pending = new Map<number, Pending>()
  let nextId = 0
  let kinds: string[] = []
  let formats: ExportFormat[] = []
  let ready: Promise<void> | null = null
  /** The evaluate request currently in flight; a newer one supersedes it. */
  let latest: number | null = null
  /** Why the client can no longer be used: terminated by its owner, or the Worker failed. */
  let dead: Error | null = null
  /** The Worker has answered: it loaded, so a later uncaught error does not mean it is gone. */
  let started = false
  const locks = options.locks ?? platformLocks()
  // One lock per Worker; the name only has to be unique within this origin.
  const lockName = locks
    ? `pave-kernel:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}:${Math.random()}`}`
    : undefined
  /** Cancels waiting on the Worker's lock (when this client ends the Worker itself). */
  const watching = new AbortController()

  const rejectAll = (error: Error) => {
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
  }

  const crash = (what: string) => {
    if (dead) return
    const error = new WorkerCrashedError(`The geometry engine stopped: ${what}`)
    dead = error
    watching.abort()
    rejectAll(error)
    port.terminate?.()
    options.onCrash?.(error)
  }
  // Without these, a Worker that fails to load leaves every request (ready included) pending
  // forever. Once it has started, an uncaught error is not the end of it: the Worker keeps
  // running, the host answers every request it was given even when its handler fails, and a
  // Worker that does die is seen through its lock (below). A Worker killed from outside raises
  // no event; without Web Locks callers still need a timeout for that case.
  port.addEventListener?.('error', (event) => {
    if (started) return
    const message = (event as { message?: unknown }).message
    crash(typeof message === 'string' && message ? message : 'the worker failed to start or threw')
  })
  port.addEventListener?.('messageerror', () => crash('a message could not be delivered'))

  const call = <T>(
    build: (id: number) => Request,
    assets?: AssetResolver,
  ): { id: number; promise: Promise<T> } => {
    const id = nextId++
    const promise = new Promise<T>((resolve, reject) => {
      if (dead) return reject(dead)
      pending.set(id, { resolve: resolve as (value: never) => void, reject, assets })
      try {
        port.postMessage(build(id))
      } catch (error) {
        // A design that cannot be cloned (DataCloneError) never reached the Worker.
        pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    return { id, promise }
  }
  /** Posts a control message (abort), which must not throw into the caller's code. */
  const notify = (message: Request) => {
    if (dead) return
    try {
      port.postMessage(message)
    } catch {
      // Nothing to deliver it to; the request it refers to settles some other way.
    }
  }

  port.onmessage = ({ data }) => {
    started = true
    if (data.type === 'asset') {
      // Any pending request with a resolver can serve it; they all share the caller's resolver.
      const resolver = [...pending.values()].find((p) => p.assets)?.assets
      const reply = (
        message: Omit<Extract<Request, { type: 'asset' }>, 'type' | 'request'>,
        transfer: Transferable[] = [],
      ) => port.postMessage({ type: 'asset', request: data.request, ...message }, transfer)
      if (!resolver) return reply({ error: 'No asset resolver was provided' })
      resolver(data.assetId).then(
        (bytes) => {
          const copy = bytes.slice()
          reply({ bytes: copy }, [copy.buffer])
        },
        (error) => reply({ error: error instanceof Error ? error.message : String(error) }),
      )
      return
    }
    const entry = pending.get(data.id)
    pending.delete(data.id)
    if (data.type === 'evaluated') {
      // Decode even when nobody is waiting any more: the ledger must see every result.
      let evaluation: Evaluation
      try {
        evaluation = ledger.decode(data.evaluation)
      } catch (error) {
        // The request is no longer pending, so nothing else would ever settle it.
        entry?.reject(error instanceof Error ? error : new Error(String(error)))
        return
      }
      entry?.resolve(evaluation as never)
    } else if (data.type === 'ready') {
      kinds = data.kinds
      formats = data.formats
      // The Worker holds the lock while it lives, so this is granted only when it has died.
      if (data.locked && locks && lockName && !dead)
        locks
          .request(lockName, { signal: watching.signal }, async () =>
            crash('the worker stopped unexpectedly'),
          )
          .catch(() => {
            // Aborted: this client ended the Worker itself.
          })
      entry?.resolve(undefined as never)
    } else if (data.type === 'exported') entry?.resolve(data.result as never)
    else entry?.reject(data.aborted ? abortError() : new Error(data.message))
  }

  const whenReady = (): Promise<void> => {
    // A dead client must not keep answering "ready" from before it died.
    if (dead) return Promise.reject(dead)
    ready ??= call<void>((id) => ({
      type: 'ready',
      id,
      ...(lockName ? { lock: lockName } : {}),
    })).promise.catch((error) => {
      ready = null
      throw error
    })
    return ready
  }

  return {
    get kinds() {
      return kinds
    },
    get formats() {
      return formats
    },
    ready: whenReady,
    async evaluate(design: Design, opts: EvaluateOptions = {}): Promise<Evaluation> {
      opts.signal?.throwIfAborted()
      // Latest request wins: whatever is still running is no longer wanted.
      if (latest !== null && pending.has(latest)) notify({ type: 'abort', id: latest })
      const { id, promise } = call<Evaluation>(
        (id) => ({ type: 'evaluate', id, design, detail: opts.detail, assets: !!opts.assets }),
        opts.assets,
      )
      latest = id
      const onAbort = () => notify({ type: 'abort', id })
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        return await promise
      } finally {
        opts.signal?.removeEventListener('abort', onAbort)
      }
    },
    async export(
      design: Design,
      format: ExportFormat,
      opts: ExportOptions = {},
    ): Promise<ExportResult> {
      const { assets, signal, ...rest } = opts
      signal?.throwIfAborted()
      const { id, promise } = call<ExportResult>(
        (id) => ({ type: 'export', id, design, format, options: rest, assets: !!assets }),
        assets,
      )
      const onAbort = () => notify({ type: 'abort', id })
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        return await promise
      } finally {
        signal?.removeEventListener('abort', onAbort)
      }
    },
    terminate() {
      if (!dead) dead = new Error('The kernel client was terminated')
      watching.abort()
      port.terminate?.()
      rejectAll(dead)
    },
  }
}
export type * from './types'
