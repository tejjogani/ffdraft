/**
 * Messages between the kernel pool (main thread) and its `worker_threads`. Only plain data
 * crosses: a design in; facts, file bytes (transferred, not copied) or a package out.
 */
import type { ExportFormat, ExportResult } from '@pave/kernel/types'
import type { Manifest, PieceInfo, ProductionOptions, RenderImage } from '@pave/production'
import type { Design, EvaluationSummary, PieceSpec } from '@pave/schema'
import type { RenderSubject } from '../../services'

/** What the package builder needs besides the design; the worker evaluates it itself. */
export interface PackageBuild {
  piece: PieceInfo
  revision: number
  spec: PieceSpec | null
  renders: RenderImage[]
  options: ProductionOptions
}

export type KernelTask =
  | { kind: 'evaluate'; design: Design; detail: 'draft' | 'production' }
  | { kind: 'export'; design: Design; format: ExportFormat; stones: boolean }
  | { kind: 'renderInput'; design: Design }
  | { kind: 'package'; design: Design; build: PackageBuild }

export type TaskKind = KernelTask['kind']

export interface TaskResults {
  evaluate: EvaluationSummary
  export: ExportResult
  renderInput: { glb: Uint8Array; subject: RenderSubject }
  package: { zip: Uint8Array; manifest: Manifest; root: string; timings: Record<string, number> }
}

/** What the pool tells a worker when it starts. */
export interface WorkerConfig {
  /** Kernels (one per organisation and piece) the worker keeps warm. */
  kernels: number
}

export type ToWorker =
  /**
   * `cache` names the kernel to run on: one per organisation and piece, so a tenant's geometry
   * (built from its private assets) never answers another's request.
   */
  | { type: 'run'; id: number; cache: string; task: KernelTask }
  | { type: 'abort'; id: number }
  | { type: 'asset'; request: number; bytes?: Uint8Array; error?: string }

/** `memory` is what the worker's isolate holds after the task (JS heap and WASM), in bytes. */
export type FromWorker =
  | { type: 'done'; id: number; result: TaskResults[TaskKind]; memory: number }
  | { type: 'failed'; id: number; message: string; aborted: boolean; memory: number }
  | { type: 'progress'; id: number; value: number }
  /** The worker needs an asset's bytes; only the main thread can read the org's store. */
  | { type: 'asset'; id: number; request: number; assetId: string }
