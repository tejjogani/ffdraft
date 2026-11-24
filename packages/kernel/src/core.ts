/**
 * The internal builder contract of @pave/kernel.
 *
 * The kernel is a pure function: design document in → solids, stones and facts out. It is
 * assembled from *features*: one builder per schema node kind, registered in
 * `features/index.ts`. This file is everything a feature (or an exporter, or a DFM check) needs
 * to know; nothing here depends on a particular feature.
 *
 * ── How a node is built ─────────────────────────────────────────────────────────────────────
 *
 * Nodes are evaluated in dependency order (`evaluationOrder`). For each node the evaluator
 *   1. hashes (node, detail, hashes of the nodes it references) and reuses the cached
 *      {@link NodeResult} when the hash is unchanged — so a slider drag rebuilds only the edited
 *      node and its dependents;
 *   2. otherwise calls the registered builder: `build(node, ctx) → FeatureOutput`;
 *   3. applies the node's own `transform` to everything the builder returned;
 *   4. stores the result. A builder that throws yields a `feature.failed` diagnostic and an
 *      empty result — the rest of the piece still evaluates. A kind with no registered builder
 *      yields `feature.unsupported` and is left out of `Kernel.kinds`.
 *
 * A builder returns a {@link FeatureOutput}:
 *   - `bodies`     metal this node contributes (each with its alloy/finish/plating);
 *   - `stones`     gems it places. Stones are never booleaned for display: the evaluator turns
 *                  each into a `StoneInstance` of a shared unit mesh;
 *   - `cuts`       solids to remove from other bodies at production detail (seats, azures,
 *                  engraving). `targets: 'all'` cuts every metal body the cutter touches;
 *   - `additions`  metal to add to *another* node's body in that body's alloy (beads, channel
 *                  walls, embossed text). Shown as separate geometry at draft, fused in at
 *                  production; `afterCuts` additions (beads, prong tips) survive seat cutting;
 *   - `frames`     named coordinate frames other features attach to (a gem publishes `stone`,
 *                  a bail publishes `opening`);
 *   - `data`       anything else dependents need, in node-local space (see NodeResult.data);
 *   - `consumes`   ids of input nodes whose bodies this node replaces (a boolean's operands).
 *
 * ── Rules ───────────────────────────────────────────────────────────────────────────────────
 *
 *  - Purity. A builder may read only its node, `ctx`, and `ctx.input(id)` for ids returned by
 *    the schema's `nodeRefs(node)`. Anything else would escape the cache key.
 *  - Space. Work in millimetres, Z up. Inputs arrive in world space with their transform already
 *    applied (`NodeResult.matrix`); return geometry in the same space — the evaluator then
 *    applies *this* node's transform on top.
 *  - Detail. `ctx.detail` is `draft` (interactive: skip cuts and beads, keep triangle counts
 *    low) or `production` (everything a caster needs). `ctx.quality` is the matching chord
 *    tolerance; pass it to anything that tessellates.
 *  - Ownership. Solids you return belong to the evaluator. Inputs are borrowed: never dispose
 *    them, and never return one — return `input.transformed(IDENTITY)` if you need a copy.
 *    Every other `Solid` created during the build is disposed automatically when the build
 *    ends (or fails). Raw OpenCascade/Manifold temporaries are yours: wrap them in
 *    `ctx.track(x)` and they are deleted when the build ends.
 *  - Failure. Throw an `Error` with a message a designer can act on. Use `ctx.report` for
 *    warnings that do not stop the build (thin wall, stone wider than its band).
 *  - Async. Builders may be async (asset loading). Check `ctx.signal` in long loops.
 *
 * ── Solids ──────────────────────────────────────────────────────────────────────────────────
 *
 * A {@link Solid} is either exact (it has, or can produce, an OpenCascade B-rep and will be in
 * STEP exports) or a mesh (a Manifold). Create one with
 *   - `solidFromBrep(shape)`     — a replicad/OpenCascade shape you built;
 *   - `solidFromManifold(m)`     — a Manifold mesh (imports, sculpts, anything non-parametric);
 *   - `lazySolid({ brep, mesh, volume })` — recipes evaluated on demand; `geometry/sweep.ts`
 *     uses this to give NURBS sweeps an exact B-rep *and* a millisecond analytic tessellation.
 * Combine them with `union` / `subtract` / `intersect`: exact when every operand is exact and
 * the job is small, Manifold otherwise or whenever the exact result fails its sanity check.
 *
 * ── Example ─────────────────────────────────────────────────────────────────────────────────
 *
 *   // features/finding.ts — a jump ring of the node's metal on top of its host
 *   export const finding = defineFeature('finding', (node, ctx) => {
 *     const host = node.host ? ctx.input(node.host) : null   // throws if the host did not build
 *     const top = host ? unionBounds(host.bodies.map((b) => b.solid.bounds())).max[2] : 0
 *     const ring = ctx.track(makeTorusShape(node.length / 2, node.wire / 2))  // raw temporary
 *     const solid = solidFromBrep(ring.translateZ(top + node.length / 2))     // owned by the result
 *     if (node.wire < 0.6) ctx.report({ level: 'warning', code: 'wire.thin', message: '…' })
 *     return { bodies: [{ solid, ...metalOf(node) }], frames: { opening: frameAt([0, 0, top]) } }
 *   })
 *   // …then add `finding` to the list in features/index.ts.
 *
 * Exporters and DFM checks consume a {@link Scene} (see `evaluate/evaluate.ts`), which exposes
 * every node's result with its exact solids, cutters and frames next to the public Evaluation.
 */
import type {
  Design,
  FinishId,
  GemCutId,
  GemDims,
  GemMaterialId,
  MetalId,
  Node,
  NodeKind,
  NodeOf,
  PlatingId,
} from '@pave/schema'
import type { Manifold } from 'manifold-3d'
import type { Shape3D } from 'replicad'
import type { Frame, Mat4 } from './geometry/vec'
import type { IndexedTriangles, Tessellation } from './solid/meshing'
import type { Deletable, Quality } from './solid/occt'
import type {
  AssetResolver,
  Bounds,
  Detail,
  Diagnostic,
  Evaluation,
  ExportFormat,
  ExportOptions,
  ExportResult,
  Part,
  StoneInstance,
} from './types'

export type { Frame, Mat4, Vec2, Vec3 } from './geometry/vec'
export { IDENTITY } from './geometry/vec'
export { runtime } from './runtime/index'
export { intersect, subtract, union } from './solid/boolean'
export type { IndexedTriangles, Tessellation } from './solid/meshing'
export type { Deletable, Quality } from './solid/occt'
export { lazySolid, QUALITY, solidFromBrep, solidFromManifold } from './solid/solid'

// ── Solids ───────────────────────────────────────────────────────────────────────────────────

/** A closed body: an exact B-rep, a Manifold mesh, or recipes that produce either on demand. */
export interface Solid {
  /** An exact B-rep exists or can be built: the body will be a NURBS solid in STEP exports. */
  readonly exact: boolean
  /** The B-rep (built on first call for recipe solids), or null for mesh bodies. Borrowed. */
  brep(): Shape3D | null
  /** A guaranteed-manifold mesh for booleans; exact solids are tessellated at `quality`. Borrowed. */
  manifold(quality?: Quality): Manifold
  /** Welded, watertight, outward-wound triangles at `quality`. Do not mutate. */
  triangles(quality?: Quality): IndexedTriangles
  /** Display mesh (smooth within faces, split at creases) and feature edges. Do not mutate. */
  tessellate(quality?: Quality): Tessellation
  /** mm³ — from the B-rep or an analytic recipe when exact, from the mesh otherwise. */
  volume(): number
  /** mm². */
  area(): number
  bounds(): Bounds
  /** A new, independent solid moved by a similarity matrix (rotation, uniform scale, mirror). */
  transformed(matrix: Mat4): Solid
  /** Frees WASM memory. Only the owner calls this; the evaluator owns everything it was given. */
  dispose(): void
}

/** Welded triangles, optionally with a better display mesh than crease-angle normals give. */
export interface SurfaceMesh extends IndexedTriangles {
  display?: Tessellation
}

/** On-demand producers for {@link lazySolid}. Must be pure JS closures (no captured WASM objects). */
export interface SolidRecipe {
  /** Builds the exact B-rep. The caller takes ownership of the returned shape. */
  brep?: () => Shape3D
  /** Watertight tessellation at a quality; when absent the B-rep is meshed by OpenCascade. */
  mesh?: (quality: Quality) => SurfaceMesh
  /** Exact volume in mm³ if it is cheaper to compute than building the B-rep. */
  volume?: () => number
}

export interface BooleanOptions {
  /** Force the Manifold path (`mesh`), or allow the exact path when possible (default). */
  prefer?: 'exact' | 'mesh'
  /** Tessellation used when the operation runs on meshes; pass `ctx.quality`. */
  quality?: Quality
}

// ── What a feature returns ───────────────────────────────────────────────────────────────────

export interface MetalSpec {
  material: MetalId
  finish: FinishId
  plating: PlatingId
}

/** The alloy fields every metal node carries. */
export const metalOf = (node: MetalSpec): MetalSpec => ({
  material: node.material,
  finish: node.finish,
  plating: node.plating,
})

/** One piece of metal. A node may return several overlapping bodies; they fuse at production. */
export interface Body extends MetalSpec {
  solid: Solid
}

/** A placed gem. The evaluator derives the public `StoneInstance` (id, carat, matrix) from it. */
export interface Stone {
  cut: GemCutId
  stone: GemMaterialId
  /** Actual size in mm (the measured dimensions when the stone has been sourced). */
  dims: GemDims
  /** Girdle centre; +z out of the table, +y along the stone's length. */
  frame: Frame
  role: StoneInstance['role']
  /** How the stone is held, for the stone report. A `setting` node holding a gem overrides it. */
  setting: string
}

/** Material to remove at production detail. */
export interface Cut {
  solid: Solid
  /** Node ids whose bodies are cut, or every metal body the cutter touches. */
  targets: 'all' | readonly string[]
}

/** Metal added to another node's body, in that body's alloy. */
export interface Addition {
  solid: Solid
  /** The node whose (first) body receives the metal. */
  target: string
  /** Fuse after cuts, so seats do not remove it (beads, prong tips). */
  afterCuts?: boolean
}

export interface FeatureOutput {
  bodies?: Body[]
  stones?: Stone[]
  cuts?: Cut[]
  additions?: Addition[]
  frames?: Record<string, Frame>
  /** Ids of referenced nodes whose bodies this node replaces. */
  consumes?: string[]
  /** Feature-specific facts for dependents, in node-local (pre-transform) space. */
  data?: unknown
}

// ── What a feature receives ──────────────────────────────────────────────────────────────────

/** `ok` built; `failed` threw; `blocked` an input was unavailable; `unsupported` no builder. */
export type NodeStatus = 'ok' | 'failed' | 'blocked' | 'unsupported'

/** A node's evaluated, cached output, in world space. */
export interface NodeResult {
  readonly id: string
  readonly node: Node
  readonly status: NodeStatus
  readonly hash: string
  /** The node's own transform, already applied to bodies, stones, cuts, additions and frames. */
  readonly matrix: Mat4
  readonly bodies: readonly Body[]
  readonly stones: readonly Stone[]
  readonly cuts: readonly Cut[]
  readonly additions: readonly Addition[]
  readonly frames: Readonly<Record<string, Frame>>
  readonly consumes: readonly string[]
  /** Node-local data published by the builder; map through `matrix` to reach world space. */
  readonly data: unknown
  readonly diagnostics: readonly Diagnostic[]
  /** Build time in ms (0 when served from cache). */
  readonly ms: number
  /**
   * Not ok because of something outside the document (an asset that could not be loaded, or
   * no asset store yet): rebuilt on the next evaluation instead of being served from cache.
   */
  readonly transient?: boolean
}

export interface BuildContext {
  readonly detail: Detail
  readonly quality: Quality
  readonly signal: AbortSignal | undefined
  readonly assets: AssetResolver | undefined
  /**
   * The result of a referenced node. Throws when the node could not be built, which marks this
   * node `blocked` (reported as `feature.blocked`, not as a failure of this feature).
   */
  input(id: string): NodeResult
  /** Like `input`, but returns null instead of throwing when the node is unavailable. */
  tryInput(id: string): NodeResult | null
  /** Registers a raw WASM temporary for deletion when the build ends. Returns it. */
  track<T extends Deletable>(temporary: T): T
  /** Adds a diagnostic for this node. */
  report(diagnostic: Omit<Diagnostic, 'nodeId'>): void
}

// ── Registry ─────────────────────────────────────────────────────────────────────────────────

export interface Feature<K extends NodeKind = NodeKind> {
  kind: K
  build(node: NodeOf<K>, ctx: BuildContext): FeatureOutput | Promise<FeatureOutput>
}

/** Any registered feature (the union over kinds, so a list can hold all of them). */
export type AnyFeature = { [K in NodeKind]: Feature<K> }[NodeKind]

/** Declares the builder for a node kind; list it in `features/index.ts` to register it. */
export const defineFeature = <K extends NodeKind>(
  kind: K,
  build: Feature<K>['build'],
): Feature<K> => ({ kind, build })

/** Thrown by `ctx.input` when a referenced node is unavailable. */
export class BlockedError extends Error {
  constructor(
    readonly inputId: string,
    reason: string,
  ) {
    super(reason)
    this.name = 'BlockedError'
  }
}

// ── What exporters and checks receive ────────────────────────────────────────────────────────

/** A final metal part with the solids behind it. */
export interface ScenePart {
  /** The public part (display mesh, volume, alloy). */
  part: Part
  /** The fused, watertight mesh body at production detail; null at draft (nothing is fused). */
  fused: Solid | null
  /** The node bodies that make up this part — exact wherever the design is parametric. */
  sources: readonly { nodeId: string; body: Body }[]
}

export interface SceneStone {
  instance: StoneInstance
  stone: Stone
}

/** One evaluated design with kernel internals attached. Valid until the next evaluation. */
export interface Scene {
  design: Design
  detail: Detail
  quality: Quality
  /** Every node's result in evaluation order (hidden and consumed nodes included). */
  nodes: ReadonlyMap<string, NodeResult>
  parts: readonly ScenePart[]
  stones: readonly SceneStone[]
  evaluation: Evaluation
}

export interface Exporter {
  format: ExportFormat
  /** Detail the scene is evaluated at before `run` is called. */
  detail: Detail
  run(scene: Scene, options: ExportOptions): ExportResult | Promise<ExportResult>
}

/** Declares an exporter; list it in `export/index.ts` to register it. */
export const defineExporter = (exporter: Exporter): Exporter => exporter
