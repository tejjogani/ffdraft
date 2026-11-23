/** Turns an evaluation into drawable bodies: metal parts with their line candidates, placed stones. */
import type { Evaluation, MeshData } from '@pave/kernel/types'
import { type EdgeTable, edgeTable, faceNormals, instanceMesh, weld } from '../geometry/mesh'
import { transformPoint } from '../geometry/vec'
import type { SceneBody } from './hlr'

/** Dihedral angle above which an edge is drawn as a crease when the kernel supplies none. */
const CREASE_DEG = 30

export function sceneBodies(evaluation: Evaluation): SceneBody[] {
  const bodies: SceneBody[] = []
  for (const part of evaluation.parts) {
    const { positions, indices, normals } = part.mesh
    const tris = { positions, indices }
    const edges = edgeTable(indices, weld(positions))
    const fn = faceNormals(tris)
    const features = part.edges.length > 0 ? part.edges : creases(positions, edges, fn)
    bodies.push({
      kind: 'metal',
      positions,
      indices,
      ...(normals.length === positions.length ? { normals } : {}),
      features: concat(features, boundaries(positions, edges)),
    })
  }

  const unit = new Map<string, { edges: EdgeTable; table: Float32Array }>()
  const unitOf = (key: string, mesh: MeshData) => {
    let u = unit.get(key)
    if (!u) {
      u = { edges: edgeTable(mesh.indices, weld(mesh.positions)), table: tableOutline(mesh) }
      unit.set(key, u)
    }
    return u
  }
  for (const stone of evaluation.stones) {
    const mesh = evaluation.gemMeshes[stone.meshKey]
    if (!mesh) continue
    const u = unitOf(stone.meshKey, mesh)
    const tris = instanceMesh(mesh, stone.matrix)
    // Melee read as outlines; only centre and side stones show their table, as on a hand drawing.
    const showTable = stone.role === 'center' || stone.role === 'side'
    bodies.push({
      kind: 'stone',
      positions: tris.positions,
      indices: tris.indices,
      faceNormals: faceNormals(tris),
      edges: u.edges,
      ...(showTable ? { features: transformSegments(u.table, stone.matrix) } : {}),
    })
  }
  return bodies
}

function creases(p: Float32Array, e: EdgeTable, fn: Float32Array): Float32Array {
  const cos = Math.cos((CREASE_DEG * Math.PI) / 180)
  const out: number[] = []
  for (let k = 0; k < e.count; k++) {
    const f0 = e.f0[k]!
    const f1 = e.f1[k]!
    if (f1 < 0) continue
    const d = fn[f0 * 3]! * fn[f1 * 3]! + fn[f0 * 3 + 1]! * fn[f1 * 3 + 1]! + fn[f0 * 3 + 2]! * fn[f1 * 3 + 2]!
    if (d < cos) pushEdge(out, p, e.a[k]!, e.b[k]!)
  }
  return Float32Array.from(out)
}

function boundaries(p: Float32Array, e: EdgeTable): Float32Array {
  const out: number[] = []
  for (let k = 0; k < e.count; k++) if (e.uses[k] === 1) pushEdge(out, p, e.a[k]!, e.b[k]!)
  return Float32Array.from(out)
}

const pushEdge = (out: number[], p: Float32Array, a: number, b: number) =>
  out.push(p[a * 3]!, p[a * 3 + 1]!, p[a * 3 + 2]!, p[b * 3]!, p[b * 3 + 1]!, p[b * 3 + 2]!)

function concat(a: Float32Array, b: Float32Array): Float32Array {
  if (b.length === 0) return a
  const out = new Float32Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

/** The table facet outline of a unit gem: its top-most vertices, ordered around their centroid. */
function tableOutline(mesh: MeshData): Float32Array {
  const p = mesh.positions
  let top = -Infinity
  for (let i = 2; i < p.length; i += 3) top = Math.max(top, p[i]!)
  const pts: [number, number][] = []
  for (let i = 0; i < p.length; i += 3) if (p[i + 2]! > top - 1e-4) pts.push([p[i]!, p[i + 1]!])
  const unique = [...new Map(pts.map((q) => [`${q[0].toFixed(5)},${q[1].toFixed(5)}`, q])).values()]
  if (unique.length < 3) return new Float32Array(0)
  const cx = unique.reduce((s, q) => s + q[0], 0) / unique.length
  const cy = unique.reduce((s, q) => s + q[1], 0) / unique.length
  unique.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx))
  const out: number[] = []
  unique.forEach((q, i) => {
    const r = unique[(i + 1) % unique.length]!
    out.push(q[0], q[1], top, r[0], r[1], top)
  })
  return Float32Array.from(out)
}

function transformSegments(segs: Float32Array, m: readonly number[]): Float32Array {
  const out = new Float32Array(segs.length)
  for (let i = 0; i < segs.length; i += 3) out.set(transformPoint(m, segs[i]!, segs[i + 1]!, segs[i + 2]!), i)
  return out
}
