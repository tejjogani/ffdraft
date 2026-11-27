/**
 * Pattern: polar, linear or mirrored copies of its sources' metal *and* stones. The sources stay
 * where they are; the pattern node carries the copies.
 *
 * The pattern's own transform places its axis (or mirror plane): a copy is the source moved by
 * T·Mₖ·T⁻¹, where Mₖ is the k-th rotation, step or reflection about the world axis. The builder
 * returns sources moved by Mₖ·T⁻¹ and the evaluator applies T, as it does for every node.
 */
import type { NodeOf } from '@pave/schema'
import {
  type Addition,
  type Body,
  type BuildContext,
  type Cut,
  defineFeature,
  type Frame,
  type Mat4,
  type NodeResult,
  type Stone,
} from '../core'
import {
  composeTransform,
  cross,
  IDENTITY,
  invertSimilarity,
  multiply,
  transformFrame,
  translation,
  uniformScaleOf,
} from '../geometry/vec'
import { isMirror } from '../solid/meshing'

type PatternNode = NodeOf<'pattern'>

/** Everything a node contributed, moved by one matrix. */
export interface Copy {
  bodies: Body[]
  stones: Stone[]
  cuts: Cut[]
  additions: Addition[]
}

/**
 * A frame moved by any similarity. A reflection would leave it left-handed; rebuilding x from
 * the mirrored y and z keeps a stone's table and length pointing the mirrored way while staying
 * a proper rotation, so the instanced gem is not turned inside out.
 */
export function moveFrame(m: Mat4, frame: Frame): Frame {
  const moved = transformFrame(m, frame)
  return isMirror(m) ? { ...moved, x: cross(moved.y, moved.z) } : moved
}

/** Setting style per gem id, for gems whose setting is among `results` (copies keep it). */
export function settingStyles(results: readonly NodeResult[]): Map<string, string> {
  const styles = new Map<string, string>()
  for (const { node } of results) if (node.kind === 'setting') styles.set(node.gem, node.style)
  return styles
}

/**
 * Copies one node's output. `retarget` maps the node ids that cuts and additions aim at (a seat
 * aimed at a copied head must cut the copy, which now belongs to the copying node).
 */
export function copyOutput(
  result: NodeResult,
  m: Mat4,
  retarget: (id: string) => string,
  styles: ReadonlyMap<string, string>,
): Copy {
  const s = uniformScaleOf(m)
  const setting = styles.get(result.id)
  return {
    bodies: result.bodies.map((b) => ({
      ...b,
      from: b.from ?? result.id,
      solid: b.solid.transformed(m),
      ...(b.nativeImport && {
        nativeImport: { ...b.nativeImport, matrix: multiply(m, b.nativeImport.matrix) },
      }),
    })),
    stones: result.stones.map((stone) => ({
      ...stone,
      frame: moveFrame(m, stone.frame),
      dims: {
        length: stone.dims.length * s,
        width: stone.dims.width * s,
        depth: stone.dims.depth * s,
      },
      ...(setting && { setting }),
    })),
    cuts: result.cuts.map((c) => ({
      ...c,
      solid: c.solid.transformed(m),
      targets: c.targets === 'all' ? 'all' : c.targets.map(retarget),
    })),
    additions: result.additions.map((a) => ({
      ...a,
      solid: a.solid.transformed(m),
      target: retarget(a.target),
    })),
  }
}

const AXES = { x: 0, y: 1, z: 2 } as const

/** Rotation about a world axis. */
function rotation(axis: 0 | 1 | 2, angle: number): Mat4 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const [i, j] = [(axis + 1) % 3, (axis + 2) % 3]
  const m = [...IDENTITY]
  m[i * 4 + i] = c
  m[i * 4 + j] = s
  m[j * 4 + i] = -s
  m[j * 4 + j] = c
  return m
}

/** The copy matrices Mₖ about the world axis (the identity, i.e. the source, is not included). */
function copyMatrices(node: PatternNode): Mat4[] {
  const axis = AXES[node.axis]
  switch (node.type) {
    case 'mirror': {
      const m = [...IDENTITY]
      m[axis * 5] = -1
      return [m]
    }
    case 'linear': {
      return Array.from({ length: node.count - 1 }, (_, k) => {
        const t: [number, number, number] = [0, 0, 0]
        t[axis] = (k + 1) * node.spacing
        return translation(t)
      })
    }
    case 'polar': {
      // A full turn spaces copies evenly; a partial arc puts the last copy at its end.
      const full = node.angle >= 360 - 1e-9
      const step = (node.angle * Math.PI) / 180 / (full ? node.count : node.count - 1)
      return Array.from({ length: node.count - 1 }, (_, k) => rotation(axis, (k + 1) * step))
    }
  }
}

function buildPattern(node: PatternNode, ctx: BuildContext): Copy {
  const sources = node.sources.map((id) => ctx.input(id))
  const ids = new Set(node.sources)
  const retarget = (id: string) => (ids.has(id) ? node.id : id)
  const styles = settingStyles(sources)
  const own = node.transform
    ? composeTransform(node.transform.position, node.transform.rotation, node.transform.scale)
    : IDENTITY
  const toAxis = invertSimilarity(own)
  const out: Copy = { bodies: [], stones: [], cuts: [], additions: [] }
  for (const m of copyMatrices(node)) {
    const move = multiply(m, toAxis)
    for (const source of sources) {
      const copy = copyOutput(source, move, retarget, styles)
      out.bodies.push(...copy.bodies)
      out.stones.push(...copy.stones)
      out.cuts.push(...copy.cuts)
      out.additions.push(...copy.additions)
    }
  }
  return out
}

export const pattern = defineFeature('pattern', (node, ctx) => buildPattern(node, ctx))
