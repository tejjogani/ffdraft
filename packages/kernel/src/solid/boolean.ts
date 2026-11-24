/**
 * Booleans between solids. Policy: stay exact (OpenCascade) when every operand has a B-rep and
 * the job is one OpenCascade does reliably; otherwise — or when the exact result fails its
 * sanity check — do it on Manifold meshes, which cannot fail on valid input.
 */
import type { Manifold } from 'manifold-3d'
import type { Shape3D } from 'replicad'
import type { BooleanOptions, Solid } from '../core'
import { runtime } from '../runtime/index'
import { boundsOverlap } from './meshing'
import { type BooleanOp, booleanShapes, shapeVolume } from './occt'
import { QUALITY, solidFromBrep, solidFromManifold } from './solid'

/** Beyond this many tools an exact boolean stops being interactive (01-cad.md §4 timings). */
const MAX_EXACT_TOOLS = 12

function disjoint(tools: readonly Solid[]): boolean {
  const boxes = tools.map((t) => t.bounds())
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) if (boundsOverlap(boxes[i]!, boxes[j]!)) return false
  return true
}

/** The exact result, or null when it is implausible (OpenCascade can return garbage silently). */
function exact(op: BooleanOp, target: Solid, tools: readonly Solid[]): Solid | null {
  let shape: Shape3D | null = null
  try {
    shape = booleanShapes(
      op,
      target.brep()!,
      tools.map((t) => t.brep()!),
    )
    const volume = shapeVolume(shape)
    const before = target.volume()
    const slack = 1e-6 * Math.max(1, before)
    const plausible =
      Number.isFinite(volume) &&
      volume > slack &&
      (op === 'union' ? volume >= before - slack : volume <= before + slack)
    if (!plausible) {
      shape.delete()
      return null
    }
    return solidFromBrep(shape)
  } catch {
    shape?.delete()
    return null
  }
}

function mesh(
  op: BooleanOp,
  target: Solid,
  tools: readonly Solid[],
  options: BooleanOptions,
): Solid {
  const { manifold: mf } = runtime()
  const quality = options.quality ?? QUALITY.production
  const a = target.manifold(quality)
  const b = tools.map((t) => t.manifold(quality))
  let result: Manifold
  if (op === 'union') result = mf.Manifold.union([a, ...b])
  else if (op === 'intersect') result = mf.Manifold.intersection([a, ...b])
  else {
    const all = b.length === 1 ? null : mf.Manifold.union(b)
    try {
      result = a.subtract(all ?? b[0]!)
    } finally {
      all?.delete()
    }
  }
  return solidFromManifold(result)
}

function run(
  op: BooleanOp,
  target: Solid,
  tools: readonly Solid[],
  options: BooleanOptions,
): Solid {
  if (tools.length === 0)
    return target.transformed([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const canBeExact =
    options.prefer !== 'mesh' &&
    target.exact &&
    tools.every((t) => t.exact) &&
    tools.length <= MAX_EXACT_TOOLS &&
    // A compound of overlapping cutters makes OpenCascade return an empty solid without an error.
    (op !== 'subtract' || tools.length === 1 || disjoint(tools))
  return (canBeExact ? exact(op, target, tools) : null) ?? mesh(op, target, tools, options)
}

/** Fuses solids into one. */
export const union = (solids: readonly Solid[], options: BooleanOptions = {}): Solid => {
  if (solids.length === 0) throw new Error('union needs at least one solid')
  return run('union', solids[0]!, solids.slice(1), options)
}

/** Removes `tools` from `target`. */
export const subtract = (
  target: Solid,
  tools: readonly Solid[],
  options: BooleanOptions = {},
): Solid => run('subtract', target, tools, options)

/** Keeps only what `target` shares with every tool. */
export const intersect = (
  target: Solid,
  tools: readonly Solid[],
  options: BooleanOptions = {},
): Solid => run('intersect', target, tools, options)
