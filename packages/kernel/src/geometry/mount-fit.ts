import { type GemDims, type MountFit, type NodeOf, stoneDims } from '@pave/schema'
import type { StoneInstance } from '../types'
import {
  composeTransform,
  type Frame,
  frameMatrix,
  IDENTITY,
  invertSimilarity,
  type Mat4,
  multiply,
  normalize,
  transformFrame,
  uniformScaleOf,
  WORLD,
} from './vec'

export function mountFitFrameMatrix(fit: MountFit, frame: Frame, dims: GemDims): Mat4 {
  const scale = [
    dims.width / fit.base.width,
    dims.length / fit.base.length,
    dims.depth / fit.base.depth,
  ] as const
  if (!scale.every((v) => Number.isFinite(v) && v > 0))
    throw new Error('The fitted stone dimensions cannot be used to scale this mount')
  const source = composeTransform(fit.frame.position, fit.frame.rotation, 1)
  const target = frameMatrix(frame, scale)
  if (
    scale.every((v) => v === 1) &&
    target.slice(12, 15).every((v, i) => v === source[12 + i]) &&
    target.slice(0, 12).every((v, i) => Math.abs(v - source[i]!) < 1e-14)
  )
    return IDENTITY
  return multiply(target, invertSimilarity(source))
}

/** The same world-space fit for an eligible free gem, without loading any source assets. */
export function mountFitToGemMatrix(fit: MountFit, gem: NodeOf<'gem'>): Mat4 {
  const transform = gem.transform
    ? composeTransform(gem.transform.position, gem.transform.rotation, gem.transform.scale)
    : IDENTITY
  const scale = uniformScaleOf(transform)
  const { width, length, depth } = stoneDims(gem)
  return mountFitFrameMatrix(fit, transformFrame(transform, WORLD), {
    width: width * scale,
    length: length * scale,
    depth: depth * scale,
  })
}

/** World-space deformation around the mounted stone. Apply after the manual cage. */
export function mountFitMatrix(fit: MountFit, stone: Pick<StoneInstance, 'matrix' | 'dims'>): Mat4 {
  const m = stone.matrix
  return mountFitFrameMatrix(
    fit,
    {
      origin: [m[12]!, m[13]!, m[14]!],
      x: normalize([m[0]!, m[1]!, m[2]!]),
      y: normalize([m[4]!, m[5]!, m[6]!]),
      z: normalize([m[8]!, m[9]!, m[10]!]),
    },
    stone.dims,
  )
}
