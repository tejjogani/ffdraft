/**
 * A kernel worker thread: runs one task at a time for the pool (see ./pool). It keeps a few
 * kernels warm, one per organisation and piece: a kernel caches exactly one design (nodes the
 * current design lacks are disposed), so sharing one between pieces would throw each piece's
 * cache away whenever another is evaluated. Keyed by organisation too, so one tenant's geometry
 * (built from its private assets) can never answer another's request. The WASM runtime
 * underneath is loaded once and shared by every kernel here.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { createKernel, type LocalKernel } from '@pave/kernel'
import type { AssetResolver, Kernel } from '@pave/kernel/types'
import { fitToPhoto, shade, viewCamera } from '@pave/match'
import { buildProductionPackage } from '@pave/production/node'
import { subjectOf } from '@pave/render'
import type { Design } from '@pave/schema'
import type { FromWorker, KernelTask, TaskResults, ToWorker, WorkerConfig } from './protocol'
import { summarize } from './summary'

if (!parentPort) throw new Error('The kernel worker must run in a worker thread')
const port = parentPort
const config = workerData as WorkerConfig

const kernels = new Map<string, LocalKernel>()

/** The kernel for `key`, most recently used last; the least recently used beyond the limit is freed. */
function kernelFor(key: string): LocalKernel {
  const warm = kernels.get(key)
  if (warm) {
    kernels.delete(key)
    kernels.set(key, warm)
    return warm
  }
  const kernel = createKernel()
  kernels.set(key, kernel)
  for (const [oldest, cold] of kernels) {
    if (kernels.size <= Math.max(1, config.kernels)) break
    cold.dispose()
    kernels.delete(oldest)
  }
  return kernel
}

/** JS heap plus WASM memory (counted as external) of this isolate: what retiring the worker frees. */
const memory = () => {
  const { heapUsed, external } = process.memoryUsage()
  return heapUsed + external
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

/**
 * One note per feature that failed to build: an export silently missing a body is worse than
 * no file, and the exporter itself cannot tell a missing body from an absent one.
 */
async function missingBodies(
  kernel: LocalKernel,
  design: Design,
  assets: AssetResolver,
  signal: AbortSignal,
): Promise<string[]> {
  // Every CAD exporter writes production geometry, which the export has just cached.
  const { diagnostics } = await kernel.evaluate(design, { detail: 'production', assets, signal })
  return diagnostics
    .filter((d) => d.level === 'error' && d.code === 'feature.failed')
    .map((d) => `${d.message.replace(/[.\s]+$/, '')} — it is not in this file.`)
}

async function run(
  id: number,
  cache: string,
  task: KernelTask,
  signal: AbortSignal,
): Promise<{ result: TaskResults[KernelTask['kind']]; transfer: ArrayBuffer[] }> {
  const kernel = kernelFor(cache)
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
      const missing = await missingBodies(kernel, task.design, assets, signal)
      return {
        result: { ...exported, bytes, notes: [...missing, ...exported.notes] },
        transfer: [bytes.buffer],
      }
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
    case 'subject': {
      // The production evaluation, as for a take, so framing matches what Blender frames.
      const evaluation = await kernel.evaluate(task.design, {
        detail: 'production',
        assets,
        signal,
      })
      return { result: subjectOf(evaluation), transfer: [] }
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
    case 'picture': {
      const evaluation = await kernel.evaluate(task.design, { detail: 'draft', assets, signal })
      const hide = Object.entries(task.design.nodes)
        .filter(([, n]) => (n as { kind: string }).kind === 'chain')
        .map(([id]) => id)
      // Rasterising is synchronous; check between views so a cancel lands between pictures.
      const images: Uint8Array<ArrayBuffer>[] = []
      const jobs = task.shots
        ? task.shots.map((s) => ({ camera: s.camera, size: { width: s.width, height: s.height } }))
        : task.views.map((view) => ({
            camera: viewCamera(evaluation, view, { hide }),
            size: { width: task.size, height: task.size },
          }))
      for (const { camera, size } of jobs) {
        signal.throwIfAborted()
        images.push(own(shade(evaluation, camera, size, { focus: task.focus, hide })))
      }
      return {
        result: { images, summary: summarize(evaluation) },
        transfer: images.map((i) => i.buffer),
      }
    }
    case 'photoFit': {
      const out = await fitToPhoto({
        design: task.design,
        ...task.fit,
        evaluate: (design, s) =>
          kernel.evaluate(design, { detail: 'draft', assets, signal: s ?? signal }),
        signal,
      })
      // The fitted design is the input plus the ops; leave it behind rather than copy it back.
      const { design: _design, ...result } = out.result
      return { result: { ...out, result }, transfer: [] }
    }
  }
}

const running = new Map<number, AbortController>()

port.on('message', (message: ToWorker) => {
  switch (message.type) {
    case 'run': {
      const controller = new AbortController()
      running.set(message.id, controller)
      run(message.id, message.cache, message.task, controller.signal)
        .then(
          ({ result, transfer }) =>
            post({ type: 'done', id: message.id, result, memory: memory() }, transfer),
          (error: unknown) =>
            post({
              type: 'failed',
              id: message.id,
              message: error instanceof Error ? error.message : String(error),
              aborted: controller.signal.aborted,
              memory: memory(),
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
