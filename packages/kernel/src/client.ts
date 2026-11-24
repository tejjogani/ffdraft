/**
 * `createKernelClient()`: the kernel behind a Worker, for browsers. Evaluation never blocks the
 * UI thread; geometry arrives as transferred typed arrays, and only the parts that changed.
 */
import type { Design } from '@pave/schema'
import { PartLedger, type Port, type Request, type Response } from './protocol'
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

export interface KernelClientOptions {
  /**
   * The Worker (or any message port serving the kernel). Defaults to this package's module
   * Worker, which needs a bundler that understands `new Worker(new URL(…, import.meta.url))`.
   */
  port?: Port<Request, Response> & { terminate?(): void }
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
  let terminated = false

  const call = <T>(
    build: (id: number) => Request,
    assets?: AssetResolver,
  ): { id: number; promise: Promise<T> } => {
    const id = nextId++
    const promise = new Promise<T>((resolve, reject) => {
      if (terminated) return reject(new Error('The kernel client was terminated'))
      pending.set(id, { resolve: resolve as (value: never) => void, reject, assets })
      port.postMessage(build(id))
    })
    return { id, promise }
  }

  port.onmessage = ({ data }) => {
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
      const evaluation = ledger.decode(data.evaluation)
      entry?.resolve(evaluation as never)
    } else if (data.type === 'ready') {
      kinds = data.kinds
      formats = data.formats
      entry?.resolve(undefined as never)
    } else if (data.type === 'exported') entry?.resolve(data.result as never)
    else entry?.reject(data.aborted ? abortError() : new Error(data.message))
  }

  const whenReady = (): Promise<void> => {
    ready ??= call<void>((id) => ({ type: 'ready', id })).promise.catch((error) => {
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
      if (latest !== null && pending.has(latest)) port.postMessage({ type: 'abort', id: latest })
      const { id, promise } = call<Evaluation>(
        (id) => ({ type: 'evaluate', id, design, detail: opts.detail, assets: !!opts.assets }),
        opts.assets,
      )
      latest = id
      const onAbort = () => port.postMessage({ type: 'abort', id })
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
      const { assets, ...rest } = opts
      return call<ExportResult>(
        (id) => ({ type: 'export', id, design, format, options: rest, assets: !!assets }),
        assets,
      ).promise
    },
    terminate() {
      terminated = true
      port.terminate?.()
      for (const entry of pending.values())
        entry.reject(new Error('The kernel client was terminated'))
      pending.clear()
    },
  }
}
