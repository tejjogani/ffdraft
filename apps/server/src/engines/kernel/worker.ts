/**
 * A kernel worker thread: runs one task at a time for the pool (see ./pool). Each organisation
 * gets its own kernel here, so one tenant's cached geometry (built from its private assets) can
 * never answer another's request; the WASM runtime underneath is loaded once and shared.
 */
import { parentPort } from 'node:worker_threads'
import { createKernel, type LocalKernel } from '@pave/kernel'
import type { AssetResolver, Kernel } from '@pave/kernel/types'
import { buildProductionPackage } from '@pave/production/node'
import { subjectOf } from '@pave/render'
import type { FromWorker, KernelTask, TaskResults, ToWorker } from './protocol'
import { summarize } from './summary'

if (!parentPort) throw new Error('The kernel worker must run in a worker thread')
const port = parentPort

/** Kernels kept warm per tenant; the least recently used is disposed beyond this. */
const TENANTS_PER_WORKER = 3
const kernels = new Map<string, LocalKernel>()

function kernelFor(tenant: string): LocalKernel {
  const warm = kernels.get(tenant)
  if (warm) {
    kernels.delete(tenant)
    kernels.set(tenant, warm)
    return warm
  }
  const kernel = createKernel()
  kernels.set(tenant, kernel)
  for (const [oldest, cold] of kernels) {
    if (kernels.size <= TENANTS_PER_WORKER) break
    cold.dispose()
    kernels.delete(oldest)
  }
  return kernel
}

const post = (message: FromWorker, transfer: ArrayBuffer[] = []) =>
  port.postMessage(message, transfer)

/** A buffer that holds exactly `bytes`, so transferring it moves no more than the result. */
function own(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes as Uint8Array<ArrayBuffer>)
    : (bytes.slice() as Uint8Array<ArrayBuffer>)
}

let nextAsset = 0
const assetRequests = new Map<number, { resolve(b: Uint8Array): void; reject(e: Error): void }>()

const resolverFor =
  (id: number): AssetResolver =>
  (assetId) =>
    new Promise((resolve, reject) => {
      const request = nextAsset++
      assetRequests.set(request, { resolve, reject })
      post({ type: 'asset', id, request, assetId })
    })

async function run(
  id: number,
  tenant: string,
  task: KernelTask,
  signal: AbortSignal,
): Promise<{ result: TaskResults[KernelTask['kind']]; transfer: ArrayBuffer[] }> {
  const kernel = kernelFor(tenant)
  const assets = resolverFor(id)
  switch (task.kind) {
    case 'evaluate': {
      const evaluation = await kernel.evaluate(task.design, { detail: task.detail, assets, signal })
      return { result: summarize(evaluation), transfer: [] }
    }
    case 'export': {
      const exported = await kernel.export(task.design, task.format, {
        stones: task.stones,
        assets,
      })
      const bytes = own(exported.bytes)
      return { result: { ...exported, bytes }, transfer: [bytes.buffer] }
    }
    case 'renderInput': {
      // GLB is written from a production evaluation; the subject comes from the same one,
      // which the export has just cached, so the second call costs no geometry.
      const glb = own((await kernel.export(task.design, 'glb', { stones: true, assets })).bytes)
      signal.throwIfAborted()
      const evaluation = await kernel.evaluate(task.design, {
        detail: 'production',
        assets,
        signal,
      })
      return { result: { glb, subject: subjectOf(evaluation) }, transfer: [glb.buffer] }
    }
    case 'package': {
      const evaluation = await kernel.evaluate(task.design, {
        detail: 'production',
        assets,
        signal,
      })
      post({ type: 'progress', id, value: 0.4 })
      // The builder exports CAD through this kernel; meshes and height maps resolve as above.
      const withAssets: Kernel = {
        ...kernel,
        export: (design, format, options) => kernel.export(design, format, { ...options, assets }),
      }
      const built = await buildProductionPackage({
        ...task.build,
        design: task.design,
        evaluation,
        kernel: withAssets,
      })
      const zip = own(built.zip)
      return {
        result: { zip, manifest: built.manifest, root: built.root, timings: built.timings },
        transfer: [zip.buffer],
      }
    }
  }
}

const running = new Map<number, AbortController>()

port.on('message', (message: ToWorker) => {
  switch (message.type) {
    case 'run': {
      const controller = new AbortController()
      running.set(message.id, controller)
      run(message.id, message.tenant, message.task, controller.signal)
        .then(
          ({ result, transfer }) => post({ type: 'done', id: message.id, result }, transfer),
          (error: unknown) =>
            post({
              type: 'failed',
              id: message.id,
              message: error instanceof Error ? error.message : String(error),
              aborted: controller.signal.aborted,
            }),
        )
        .finally(() => running.delete(message.id))
      break
    }
    case 'abort':
      running.get(message.id)?.abort()
      break
    case 'asset': {
      const pending = assetRequests.get(message.request)
      assetRequests.delete(message.request)
      if (message.bytes) pending?.resolve(message.bytes)
      else pending?.reject(new Error(message.error ?? 'The asset could not be read'))
      break
    }
  }
})
