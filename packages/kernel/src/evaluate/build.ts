/** Builds one node: runs its feature, applies the node transform, and never lets it throw. */
import { type Node, nodeRefs } from '@pave/schema'
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
  IDENTITY,
  type Mat4,
  composeTransform,
  transformFrame,
  uniformScaleOf,
} from '../geometry/vec'
import { withSolidScope } from '../solid/solid'
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
    bodies: (out.bodies ?? []).map((b) => ({ ...b, solid: move(b.solid) })),
    stones: (out.stones ?? []).map((st) =>
      still
        ? st
        : {
            ...st,
            frame: transformFrame(matrix, st.frame),
            dims: { length: st.dims.length * s, width: st.dims.width * s, depth: st.dims.depth * s },
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

function* solidsOf(placed: Placed): Iterable<Solid> {
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
  const tryInput = (id: string): NodeResult | null => {
    if (!refs.has(id))
      throw new Error(`${node.kind} read node “${id}”, which is not one of its references`)
    const result = env.results.get(id)
    return result?.status === 'ok' ? result : null
  }
  const ctx: BuildContext = {
    detail: env.detail,
    quality: env.quality,
    signal: env.signal,
    assets: env.assets,
    tryInput,
    input(id) {
      const result = tryInput(id)
      if (result) return result
      const missing = env.results.get(id)?.node
      throw new BlockedError(
        id,
        missing
          ? `“${labelOf(missing)}” (${missing.kind}) could not be built`
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
  try {
    const placed = await withSolidScope(
      async () => place(await (feature.build as (n: Node, c: BuildContext) => FeatureOutput)(node, ctx), matrix),
      solidsOf,
    )
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
    const blocked = error instanceof BlockedError
    const reason = error instanceof Error ? error.message : 'the geometry kernel rejected it'
    diagnostics.push({
      level: blocked ? 'warning' : 'error',
      code: blocked ? 'feature.blocked' : 'feature.failed',
      nodeId: node.id,
      message: blocked
        ? `“${labelOf(node)}” was left out because ${reason}.`
        : `“${labelOf(node)}” could not be built: ${reason}`,
    })
    return without(node, hash, blocked ? 'blocked' : 'failed', diagnostics, performance.now() - started)
  } finally {
    for (const t of temporaries.reverse()) t.delete()
  }
}

export function disposeResult(result: NodeResult): void {
  for (const b of result.bodies) b.solid.dispose()
  for (const c of result.cuts) c.solid.dispose()
  for (const a of result.additions) a.solid.dispose()
}
