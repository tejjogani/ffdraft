/** Builds one node: runs its feature, applies the node transform, and never lets it throw. */
import {
  importRoleOf,
  importSourceRole,
  isImportReference,
  type Node,
  nodeRefs,
} from '@pave/schema'
import {
  type AnyFeature,
  BlockedError,
  type BuildContext,
  type Deletable,
  type FeatureOutput,
  type NodeResult,
  type NodeStatus,
  type Quality,
  type Solid,
} from '../core'
import {
  composeTransform,
  IDENTITY,
  type Mat4,
  multiply,
  transformFrame,
  uniformScaleOf,
} from '../geometry/vec'
import { isRuntimeFault } from '../runtime/index'
import { meshVolume } from '../solid/meshing'
import { isClosedByConstruction, surfaceDefectsOf, withSolidScope } from '../solid/solid'
import type { AssetResolver, Detail, Diagnostic } from '../types'

export interface BuildEnvironment {
  detail: Detail
  quality: Quality
  signal: AbortSignal | undefined
  assets: AssetResolver | undefined
  /** Results of the nodes evaluated so far. */
  results: ReadonlyMap<string, NodeResult>
}

export const labelOf = (node: Node): string => node.name ?? node.id

const matrixOf = (node: Node): Mat4 =>
  node.transform
    ? composeTransform(node.transform.position, node.transform.rotation, node.transform.scale)
    : IDENTITY

type Placed = Required<Omit<FeatureOutput, 'data'>> & { data: unknown }

/** The builder's output moved by the node's own transform. */
function place(out: FeatureOutput, matrix: Mat4): Placed {
  const still = matrix === IDENTITY
  const move = (solid: Solid) => (still ? solid : solid.transformed(matrix))
  const s = uniformScaleOf(matrix)
  return {
    sheets: (out.sheets ?? []).map((b) => ({ ...b, solid: move(b.solid) })),
    bodies: (out.bodies ?? []).map((b) => ({
      ...b,
      solid: move(b.solid),
      ...(b.nativeImport &&
        !still && {
          nativeImport: { ...b.nativeImport, matrix: multiply(matrix, b.nativeImport.matrix) },
        }),
    })),
    stones: (out.stones ?? []).map((st) =>
      still
        ? st
        : {
            ...st,
            frame: transformFrame(matrix, st.frame),
            dims: {
              length: st.dims.length * s,
              width: st.dims.width * s,
              depth: st.dims.depth * s,
            },
          },
    ),
    cuts: (out.cuts ?? []).map((c) => ({ ...c, solid: move(c.solid) })),
    additions: (out.additions ?? []).map((a) => ({ ...a, solid: move(a.solid) })),
    frames: Object.fromEntries(
      Object.entries(out.frames ?? {}).map(([k, f]) => [k, still ? f : transformFrame(matrix, f)]),
    ),
    consumes: out.consumes ?? [],
    data: out.data,
  }
}

/**
 * What one node may ask of the kernel. Nothing in the document bounds geometry by itself —
 * nested patterns multiply, scale multiplies through hosts — so a few schema-valid edits could
 * otherwise hang the kernel or exhaust the WASM heap. Over a limit the node fails with the
 * number and the limit, and the rest of the piece still evaluates.
 */
export const NODE_LIMITS = {
  stones: 50_000,
  triangles: { draft: 2_000_000, production: 6_000_000 },
} as const

const count = (n: number) => Math.round(n).toLocaleString('en-US')

/**
 * Tessellates every solid the node returned and rejects any that is not a closed body with
 * volume. Solids are lazy, so without this a bad body would only fail later, in assembly or an
 * export, where it takes the whole evaluation down instead of this one node. The triangles are
 * cached on the solid, so the work is not repeated by assembly. Cutters are only used (and so
 * only checked) at production.
 */
function checkGeometry(placed: Placed, env: BuildEnvironment): void {
  const solids = [
    ...placed.bodies.map((b) => b.solid),
    ...placed.additions.map((a) => a.solid),
    ...(env.detail === 'production' ? placed.cuts.map((c) => c.solid) : []),
  ]
  if (placed.stones.length > NODE_LIMITS.stones)
    throw new Error(
      `it places ${count(placed.stones.length)} stones; the limit is ${count(NODE_LIMITS.stones)}. Use fewer copies or larger stones`,
    )
  // The schema keeps stone sizes positive, but a document from storage or an import is only
  // checked for shape at the boundary: a stone of zero or negative size would be counted,
  // weighed as zero or negative carats and handed to the viewer with a matrix of NaN.
  for (const { dims } of placed.stones)
    if (![dims.width, dims.length, dims.depth].every((v) => v > 0 && Number.isFinite(v)))
      throw new Error(
        `it places a stone with no usable size (${dims.width} × ${dims.length} mm); give the stone a size above zero`,
      )
  const budget = NODE_LIMITS.triangles[env.detail]
  let triangles = 0
  for (const { solid } of placed.sheets) {
    const mesh = solid.triangles(env.quality)
    if (!mesh.indices.length || !(solid.area() > 1e-9))
      throw new Error('The surface has no measurable area. Check the curves and their order.')
    triangles += mesh.indices.length / 3
    if (triangles > budget)
      throw new Error(`The surface exceeds the ${count(budget)} triangle limit.`)
  }
  for (const solid of solids) {
    const tris = solid.triangles(env.quality)
    // Checked as the meshes are made, so a runaway pattern stops at the limit, not after it.
    triangles += tris.indices.length / 3
    if (triangles > budget)
      throw new Error(
        `it needs more than ${count(budget)} triangles of geometry; use fewer copies, a smaller scale or simpler shapes`,
      )
    if (isClosedByConstruction(solid)) continue
    if (tris.indices.length === 0) throw new Error('the shape it describes has no surface')
    const { open, nonManifold } = surfaceDefectsOf(solid, env.quality)
    if (open > 0 || nonManifold > 0)
      throw new Error(
        'the shape it describes is not a closed solid (its surface has gaps or crosses itself); check its profile, path or size',
      )
    if (!(meshVolume(tris) > 1e-9))
      throw new Error('the shape it describes encloses no volume; check its profile or size')
  }
}

function* solidsOf(placed: Placed): Iterable<Solid> {
  for (const s of placed.sheets) yield s.solid
  for (const b of placed.bodies) yield b.solid
  for (const c of placed.cuts) yield c.solid
  for (const a of placed.additions) yield a.solid
}

function without(
  node: Node,
  hash: string,
  status: NodeStatus,
  diagnostics: Diagnostic[],
  ms: number,
): NodeResult {
  return {
    id: node.id,
    node,
    status,
    hash,
    matrix: matrixOf(node),
    bodies: [],
    stones: [],
    cuts: [],
    additions: [],
    frames: {},
    consumes: [],
    data: undefined,
    diagnostics,
    ms,
  }
}

export async function buildNode(
  feature: AnyFeature | undefined,
  node: Node,
  hash: string,
  env: BuildEnvironment,
): Promise<NodeResult> {
  if (!feature)
    return without(
      node,
      hash,
      'unsupported',
      [
        {
          level: 'warning',
          code: 'feature.unsupported',
          nodeId: node.id,
          message: `“${labelOf(node)}” was left out: ${node.kind} features are not available in this build.`,
        },
      ],
      0,
    )

  const started = performance.now()
  const diagnostics: Diagnostic[] = []
  const temporaries: Deletable[] = []
  const refs = new Set(nodeRefs(node))
  // Whether the build depended on the asset store, and whether the store let it down: such a
  // failure says nothing about the node and must not be memoised (see NodeResult.transient).
  let wantedAssets = false
  let assetFailed = false
  const resolver = env.assets
  const assets =
    resolver &&
    (async (assetId: string) => {
      try {
        return await resolver(assetId)
      } catch (error) {
        assetFailed = true
        throw error
      }
    })
  const importProblem = (id: string, source: Node): string | undefined => {
    if ((node.kind === 'gem' || node.kind === 'setting') && node.importSourceId === id) {
      const role = importSourceRole(node)
      if (
        source.kind !== 'meshBody' ||
        source.source.type !== 'asset' ||
        !source.keepSourcePlacement ||
        importRoleOf(source) !== role
      )
        return `“${labelOf(source)}” is not an imported ${role} source`
    } else if (isImportReference(source))
      return `“${labelOf(source)}” needs a confirmed metal role to supply metal`
  }
  const tryInput = (id: string): NodeResult | null => {
    if (!refs.has(id))
      throw new Error(`${node.kind} read node “${id}”, which is not one of its references`)
    const result = env.results.get(id)
    return result?.status === 'ok' && !importProblem(id, result.node) ? result : null
  }
  const ctx: BuildContext = {
    detail: env.detail,
    quality: env.quality,
    signal: env.signal,
    get assets() {
      wantedAssets = true
      return assets
    },
    tryInput,
    input(id) {
      const result = tryInput(id)
      if (result) return result
      const missing = env.results.get(id)?.node
      throw new BlockedError(
        id,
        missing
          ? (importProblem(id, missing) ??
              `“${labelOf(missing)}” (${missing.kind}) could not be built`)
          : `node “${id}” does not exist`,
      )
    },
    track(temporary) {
      temporaries.push(temporary)
      return temporary
    },
    report: (d) => diagnostics.push({ ...d, nodeId: node.id }),
  }

  const matrix = matrixOf(node)
  let faulted = false
  try {
    const placed = await withSolidScope(async () => {
      const out = place(
        await (feature.build as (n: Node, c: BuildContext) => FeatureOutput)(node, ctx),
        matrix,
      )
      checkGeometry(out, env)
      return out
    }, solidsOf)
    return {
      id: node.id,
      node,
      status: 'ok',
      hash,
      matrix,
      ...placed,
      diagnostics,
      ms: performance.now() - started,
    }
  } catch (error) {
    if (env.signal?.aborted) throw error
    // A fault inside a WASM runtime is not this node's failure: the heap is corrupt, and only
    // the evaluator can recover (forget every cached solid, reload the runtime). Caching it as
    // `feature.failed` would keep using the corrupt heap and memoise the fault.
    if (isRuntimeFault(error)) {
      faulted = true
      throw error
    }
    const blocked = error instanceof BlockedError
    const reason = error instanceof Error ? error.message : 'the geometry kernel rejected it'
    diagnostics.push({
      level: blocked ? 'warning' : 'error',
      code: blocked ? 'feature.blocked' : 'feature.failed',
      nodeId: node.id,
      message: blocked
        ? `“${labelOf(node)}” was left out because ${reason}.`
        : `“${labelOf(node)}” could not be built: ${reason}`,
      // The input that was unavailable, so the boundary can say why when it dropped that node.
      ...(blocked ? { related: [error.inputId] } : {}),
    })
    const transient = blocked
      ? env.results.get(error.inputId)?.transient === true
      : assetFailed || (wantedAssets && !resolver)
    return {
      ...without(
        node,
        hash,
        blocked ? 'blocked' : 'failed',
        diagnostics,
        performance.now() - started,
      ),
      ...(transient ? { transient } : {}),
    }
  } finally {
    // Raw temporaries live in the heap a fault corrupted; they are forgotten with it.
    if (!faulted) for (const t of temporaries.reverse()) t.delete()
  }
}

/**
 * The same node marked `failed`: used when its solids turn out to be unusable after the build
 * (in assembly), so the piece still evaluates without it. Takes ownership of `result`'s solids
 * and frees them.
 */
export function failedResult(result: NodeResult, reason: string): NodeResult {
  disposeResult(result)
  return without(
    result.node,
    result.hash,
    'failed',
    [
      ...result.diagnostics,
      {
        level: 'error',
        code: 'feature.failed',
        nodeId: result.id,
        message: `“${labelOf(result.node)}” could not be built: ${reason}`,
      },
    ],
    result.ms,
  )
}

export function disposeResult(result: NodeResult): void {
  for (const s of result.sheets ?? []) s.solid.dispose()
  for (const b of result.bodies) b.solid.dispose()
  for (const c of result.cuts) c.solid.dispose()
  for (const a of result.additions) a.solid.dispose()
}
