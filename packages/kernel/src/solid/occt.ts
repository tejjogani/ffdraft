/**
 * The narrow, typed waist between the kernel and OpenCascade. Everything that touches raw `oc`
 * handles for solids — tessellation, transforms, booleans, integral properties — lives here so
 * features never see an untyped WASM object or an opaque `WebAssembly.Exception`.
 */
import { type Shape3D, cast, makeCompound, measureArea, measureVolume } from 'replicad'
import type { Mat4 } from '../geometry/vec'
import { runtime } from '../runtime/index'
import type { Bounds, MeshData } from '../types'

/** Anything owned by the WASM heap. */
export interface Deletable {
  delete(): void
}

/** Chord and angular tolerance of a tessellation. */
export interface Quality {
  /** Maximum distance between the mesh and the true surface, mm. */
  chord: number
  /** Maximum angle between adjacent facets on a curved surface, radians. */
  angle: number
}

/** Turns whatever OpenCascade threw into an `Error` with a readable message. */
export function occtError(error: unknown, doing: string): Error {
  if (error instanceof Error) return new Error(`${doing}: ${error.message}`)
  // Native C++ exceptions arrive as WebAssembly.Exception without a usable payload.
  return new Error(`${doing}: the geometry kernel rejected the operation`)
}

/** Runs `fn`, deleting every temporary registered through `own`, whether it throws or not. */
export function scoped<T>(fn: (own: <D extends Deletable>(d: D) => D) => T): T {
  const owned: Deletable[] = []
  try {
    return fn((d) => {
      owned.push(d)
      return d
    })
  } finally {
    for (const d of owned.reverse()) d.delete()
  }
}

/** Triangulates a B-rep. Vertices are per face with surface normals, so edges stay crisp. */
export function tessellateShape(shape: Shape3D, quality: Quality): MeshData {
  const { oc } = runtime()
  const raw = oc.ReplicadMeshExtractor.extract(shape.wrapped, quality.chord, quality.angle, false)
  try {
    const buffer = oc.wasmMemory.buffer
    const f32 = (ptr: number, size: number) => new Float32Array(buffer, ptr >>> 0, size).slice()
    return {
      positions: f32(raw.getVerticesPtr(), raw.getVerticesSize()),
      normals: f32(raw.getNormalsPtr(), raw.getNormalsSize()),
      indices: new Uint32Array(buffer, raw.getTrianglesPtr() >>> 0, raw.getTrianglesSize()).slice(),
    }
  } finally {
    raw.delete()
  }
}

/** A copy of `shape` moved by a similarity matrix (rotation, uniform scale, mirror, translation). */
export function transformShape(shape: Shape3D, m: Mat4): Shape3D {
  const { oc } = runtime()
  return scoped((own) => {
    const trsf = own(new oc.gp_Trsf())
    trsf.SetValues(
      m[0]!, m[4]!, m[8]!, m[12]!,
      m[1]!, m[5]!, m[9]!, m[13]!,
      m[2]!, m[6]!, m[10]!, m[14]!,
    ) // biome-ignore format: matrix rows
    const builder = own(new oc.BRepBuilderAPI_Transform(shape.wrapped, trsf, true))
    return cast(builder.Shape()) as Shape3D
  })
}

export const shapeVolume = (shape: Shape3D): number => measureVolume(shape)
export const shapeArea = (shape: Shape3D): number => measureArea(shape)

export function shapeBounds(shape: Shape3D): Bounds {
  const box = shape.boundingBox
  try {
    const [min, max] = box.bounds
    return { min: [...min], max: [...max] }
  } finally {
    box.delete()
  }
}

export type BooleanOp = 'union' | 'subtract' | 'intersect'

/**
 * Exact boolean of `target` with `tools`. The tools are applied as one compound (looping `cut`
 * is ~6× slower, docs/research/01-cad.md §4), so the caller must make sure they do not overlap
 * each other for `subtract`; unions and intersections are folded pairwise.
 */
export function booleanShapes(op: BooleanOp, target: Shape3D, tools: readonly Shape3D[]): Shape3D {
  try {
    if (op === 'subtract') {
      if (tools.length === 1) return target.cut(tools[0]!)
      const compound = makeCompound([...tools]) as Shape3D
      try {
        return target.cut(compound)
      } finally {
        compound.delete()
      }
    }
    let result = target
    for (const tool of tools) {
      const next = op === 'union' ? result.fuse(tool) : result.intersect(tool)
      if (result !== target) result.delete()
      result = next
    }
    return result
  } catch (error) {
    throw occtError(error, `B-rep ${op}`)
  }
}
