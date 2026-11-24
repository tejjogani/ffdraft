/** Serves a kernel over a message port: the Worker side of `createKernelClient()`. */
import type { LocalKernel } from './kernel'
import { PartLedger, type Port, type Request, type Response } from './protocol'
import type { AssetResolver } from './types'

export function serveKernel(kernel: LocalKernel, port: Port<Response, Request>): void {
  const ledger = new PartLedger()
  const running = new Map<number, AbortController>()
  const assets = new Map<number, { resolve(bytes: Uint8Array): void; reject(error: Error): void }>()
  let nextAsset = 0
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
    switch (data.type) {
      case 'ready':
        kernel.ready().then(
          () =>
            port.postMessage({
              type: 'ready',
              id: data.id,
              kinds: [...kernel.kinds],
              formats: [...kernel.formats],
            }),
          (error) => fail(data.id, error),
        )
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
          .then(
            (evaluation) => {
              const { wire, transfer } = ledger.encode(evaluation)
              port.postMessage({ type: 'evaluated', id: data.id, evaluation: wire }, transfer)
            },
            (error) => fail(data.id, error, controller.signal),
          )
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
          .then(
            (result) =>
              port.postMessage({ type: 'exported', id: data.id, result }, [
                result.bytes.buffer as ArrayBuffer,
              ]),
            (error) => fail(data.id, error, controller.signal),
          )
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
