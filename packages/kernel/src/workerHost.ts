/** Serves a kernel over a message port: the Worker side of `createKernelClient()`. */
import type { LocalKernel } from './kernel'
import {
  type Locks,
  PartLedger,
  type Port,
  platformLocks,
  type Request,
  type Response,
} from './protocol'
import type { AssetResolver } from './types'

/** Takes `name` and holds it until this Worker ends. Resolves to whether it is held. */
function holdLock(locks: Locks | undefined, name: string | undefined): Promise<boolean> {
  if (!locks || !name) return Promise.resolve(false)
  return new Promise((held) => {
    locks
      .request(name, {}, () => {
        held(true)
        return new Promise(() => {})
      })
      .catch(() => held(false))
  })
}

export function serveKernel(
  kernel: LocalKernel,
  port: Port<Response, Request>,
  locks: Locks | undefined = platformLocks(),
): void {
  let ledger = new PartLedger()
  const running = new Map<number, AbortController>()
  const assets = new Map<number, { resolve(bytes: Uint8Array): void; reject(error: Error): void }>()
  let nextAsset = 0
  // Taken once per Worker. The lock outlives a ready that failed (a WASM download cut off), and
  // a second request for it from this same Worker would queue behind itself for ever.
  let held: Promise<boolean> | undefined
  // Asset bytes live on the main thread (it knows how to fetch them); ask for each one.
  const resolveAsset: AssetResolver = (assetId) =>
    new Promise((resolve, reject) => {
      const request = nextAsset++
      assets.set(request, { resolve, reject })
      port.postMessage({ type: 'asset', request, assetId })
    })
  const fail = (id: number, error: unknown, signal?: AbortSignal) =>
    port.postMessage({
      type: 'failed',
      id,
      message: error instanceof Error ? error.message : String(error),
      aborted: signal?.aborted ?? false,
    })

  port.onmessage = ({ data }) => {
    // Anything that is not one of our messages is ignored rather than thrown on: an uncaught
    // error here is reported to the page as a Worker error.
    if (typeof data !== 'object' || data === null) return
    switch (data.type) {
      case 'ready':
        held ??= holdLock(locks, data.lock)
        Promise.all([kernel.ready(), held])
          .then(([, locked]) =>
            port.postMessage({
              type: 'ready',
              id: data.id,
              kinds: [...kernel.kinds],
              formats: [...kernel.formats],
              locked,
            }),
          )
          .catch((error) => fail(data.id, error))
        break
      case 'evaluate': {
        const controller = new AbortController()
        running.set(data.id, controller)
        kernel
          .evaluate(data.design, {
            ...(data.detail ? { detail: data.detail } : {}),
            signal: controller.signal,
            ...(data.assets ? { assets: resolveAsset } : {}),
          })
          .then((evaluation) => {
            const { wire, transfer } = ledger.encode(evaluation)
            try {
              port.postMessage({ type: 'evaluated', id: data.id, evaluation: wire }, transfer)
            } catch (error) {
              // The ledger now counts these buffers as held by the client, which never got
              // them: the next result would leave them out and the client could not rebuild
              // it. Forget everything, so what comes next is sent whole.
              ledger = new PartLedger()
              throw error
            }
          })
          // After the result too: a result that cannot be posted must still answer the request.
          .catch((error) => fail(data.id, error, controller.signal))
          .finally(() => running.delete(data.id))
        break
      }
      case 'export': {
        const controller = new AbortController()
        running.set(data.id, controller)
        kernel
          .export(data.design, data.format, {
            ...data.options,
            signal: controller.signal,
            ...(data.assets ? { assets: resolveAsset } : {}),
          })
          .then((result) =>
            port.postMessage({ type: 'exported', id: data.id, result }, [
              result.bytes.buffer as ArrayBuffer,
            ]),
          )
          .catch((error) => fail(data.id, error, controller.signal))
          .finally(() => running.delete(data.id))
        break
      }
      case 'abort':
        running.get(data.id)?.abort()
        break
      case 'asset': {
        const pending = assets.get(data.request)
        assets.delete(data.request)
        if (data.bytes) pending?.resolve(data.bytes)
        else pending?.reject(new Error(data.error ?? 'The asset could not be loaded'))
        break
      }
    }
  }
}
