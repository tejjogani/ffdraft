/**
 * The kernel contract: a design document in, geometry and facts out.
 *
 * Everything here is plain data (typed arrays and JSON) so an evaluation can cross a Worker
 * boundary, be cached, or be produced on the server. Consumers — the viewport, the render
 * compiler, drawings, the BOM, sourcing — depend on this file only, never on kernel internals.
 */
import type {
  Design,
  FinishId,
  GemCutId,
  GemDims,
  GemMaterialId,
  MetalId,
  Op,
  PlatingId,
} from '@pave/schema'

/** Indexed triangle mesh in mm, Z up. Normals are per-vertex; hard edges split vertices. */
export interface MeshData {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
}

export interface Bounds {
  min: [number, number, number]
  max: [number, number, number]
}

/**
 * One metal body. At draft: one part per node (`id` is the node id). At production: one
 * watertight shell per connected casting, plus one part per node for bodies made of many
 * separate shells that touch nothing else (the links of a chain).
 */
export interface Part {
  id: string
  nodeId: string
  /**
   * Changes exactly when this part's geometry or alloy changes. A viewer that already holds
   * (`id`, `rev`) can keep its buffers; the Worker client does not re-send such parts.
   */
  rev: string
  name: string
  material: MetalId
  finish: FinishId
  plating: PlatingId
  mesh: MeshData
  /** Feature edges as line segments (x0,y0,z0,x1,y1,z1,…) for crisp CAD display and drawings. */
  edges: Float32Array
  volumeMm3: number
  areaMm2: number
  bounds: Bounds
  /** Exact B-rep exists for this part (it will be in STEP exports); otherwise it is a mesh. */
  exact: boolean
  /**
   * Nodes fused into this part whose finish or plating differs from the part's own. At
   * production every body of one alloy is one casting, so a rhodium-plated head or a matte face
   * on a polished band is finished selectively on that casting; this keeps it on record.
   */
  regions?: PartRegion[]
}

/** A node's metal inside a fused part, finished or plated differently from the rest of it. */
export interface PartRegion {
  nodeId: string
  name: string
  finish: FinishId
  plating: PlatingId
}

/**
 * A stone in the piece. Stones are instanced: `meshKey` selects a unit mesh (girdle width = 1,
 * table toward +Z, girdle plane at z = 0) from {@link Evaluation.gemMeshes} and `matrix`
 * (column-major 4×4) places and scales it.
 */
export interface StoneInstance {
  /** `${nodeId}:${index}` — stable as long as the layout parameters are unchanged. */
  id: string
  nodeId: string
  cut: GemCutId
  stone: GemMaterialId
  dims: GemDims
  carat: number
  meshKey: string
  matrix: number[]
  role: 'center' | 'side' | 'accent' | 'melee'
  setting: string
}

export interface StoneLot {
  cut: GemCutId
  stone: GemMaterialId
  /** Girdle width and length in mm (equal for round). */
  width: number
  length: number
  count: number
  caratEach: number
  caratTotal: number
  setting: string
  role: StoneInstance['role']
  nodeIds: string[]
}

export interface Diagnostic {
  level: 'error' | 'warning' | 'info'
  /** Stable machine code, e.g. `wall.thin`, `feature.failed`, `prong.small`. */
  code: string
  message: string
  nodeId?: string
  /** Where to point the camera / draw a marker. */
  at?: [number, number, number]
  /** The measured value and the threshold it was compared to, in mm. */
  value?: number
  limit?: number
  /** A one-click repair, when the fix is unambiguous: apply `ops` to the design. */
  fix?: { label: string; ops: Op[] }
}

export interface Report {
  metals: { material: MetalId; volumeMm3: number; massG: number }[]
  metalMassG: number
  lots: StoneLot[]
  stoneCount: number
  caratTotal: number
  bounds: Bounds
  /** Finger size for rings, in mm inner diameter. */
  ringInnerDiameter?: number
}

export type Detail = 'draft' | 'production'

export interface Evaluation {
  detail: Detail
  parts: Part[]
  stones: StoneInstance[]
  gemMeshes: Record<string, MeshData>
  report: Report
  diagnostics: Diagnostic[]
  /** Wall-clock milliseconds, total and per node, for the performance HUD and traces. */
  ms: number
  timings: Record<string, number>
}

/** Fetches binary assets referenced by nodes (imported meshes, height maps). */
export type AssetResolver = (assetId: string) => Promise<Uint8Array>

export interface EvaluateOptions {
  /**
   * draft: fast, for interaction — stones are placed but seats/azures are not cut and beads are
   * omitted. production: everything a caster needs, fused per metal and watertight.
   */
  detail?: Detail
  assets?: AssetResolver
  signal?: AbortSignal
}

export type ExportFormat = 'stl' | 'step' | '3dm' | 'glb' | 'obj' | '3mf'

export interface ExportOptions {
  /** Include stones as reference geometry. Default: false for stl/3mf/step, true otherwise. */
  stones?: boolean
  /** Restrict to these node ids. */
  only?: string[]
  assets?: AssetResolver
}

export interface ExportResult {
  bytes: Uint8Array
  mime: string
  extension: string
  /** Anything the recipient should know (e.g. "mesh bodies are omitted from STEP"). */
  notes: string[]
}

/** The public surface of @pave/kernel. */
export interface Kernel {
  /** Loads WASM runtimes. Idempotent; called implicitly by the other methods. */
  ready(): Promise<void>
  evaluate(design: Design, options?: EvaluateOptions): Promise<Evaluation>
  export(design: Design, format: ExportFormat, options?: ExportOptions): Promise<ExportResult>
  /** Node kinds this build can evaluate; the UI only offers these. */
  readonly kinds: readonly string[]
  /** Export formats this build can write; the UI only offers these. */
  readonly formats: readonly ExportFormat[]
}
