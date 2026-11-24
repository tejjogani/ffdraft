/**
 * Synthetic evaluations for unit tests: boxes and spheres with exactly known silhouettes, so the
 * rasteriser, camera and scores can be checked without starting a kernel.
 */
import type { Evaluation, MeshData, Part, StoneInstance } from '@pave/kernel/types'
import type { Vec3 } from './types'

export function boxMesh(min: Vec3, max: Vec3): MeshData {
  const positions: number[] = []
  for (let i = 0; i < 8; i++)
    positions.push(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2])
  // Outward-facing, counter-clockwise seen from outside.
  const quads = [
    [0, 2, 3, 1], // z min
    [4, 5, 7, 6], // z max
    [0, 1, 5, 4], // y min
    [2, 6, 7, 3], // y max
    [0, 4, 6, 2], // x min
    [1, 3, 7, 5], // x max
  ]
  const indices: number[] = []
  for (const [a, b, c, d] of quads) indices.push(a!, b!, c!, a!, c!, d!)
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(positions.length),
    indices: new Uint32Array(indices),
  }
}

export function sphereMesh(centre: Vec3, r: number, seg = 48): MeshData {
  const positions: number[] = []
  const indices: number[] = []
  const rings = seg / 2
  for (let i = 0; i <= rings; i++) {
    const th = (i / rings) * Math.PI
    for (let j = 0; j <= seg; j++) {
      const ph = (j / seg) * 2 * Math.PI
      positions.push(
        centre[0] + r * Math.sin(th) * Math.cos(ph),
        centre[1] + r * Math.sin(th) * Math.sin(ph),
        centre[2] + r * Math.cos(th),
      )
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j
      const b = a + seg + 1
      indices.push(a, b, a + 1, a + 1, b, b + 1)
    }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(positions.length),
    indices: new Uint32Array(indices),
  }
}

function boundsOf(meshes: MeshData[]) {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const m of meshes)
    for (let i = 0; i < m.positions.length; i += 3)
      for (let k = 0; k < 3; k++) {
        const v = m.positions[i + k]!
        if (v < min[k]!) min[k] = v
        if (v > max[k]!) max[k] = v
      }
  return { min, max }
}

/** An evaluation of the given parts, plus round stones of a unit sphere scaled to `width`. */
export function fakeEvaluation(
  parts: { nodeId: string; mesh: MeshData }[],
  stones: { nodeId: string; at: Vec3; width: number }[] = [],
): Evaluation {
  const unit = sphereMesh([0, 0, 0], 0.5, 24)
  const ps: Part[] = parts.map((p) => ({
    id: p.nodeId,
    nodeId: p.nodeId,
    rev: '1',
    name: p.nodeId,
    material: 'pt950',
    finish: 'polished',
    plating: 'none',
    mesh: p.mesh,
    edges: new Float32Array(0),
    volumeMm3: 0,
    areaMm2: 0,
    bounds: boundsOf([p.mesh]),
    exact: false,
  }))
  const ss: StoneInstance[] = stones.map((s, i) => ({
    id: `${s.nodeId}:${i}`,
    nodeId: s.nodeId,
    cut: 'round',
    stone: 'diamond',
    dims: { width: s.width, length: s.width, depth: s.width * 0.6 },
    carat: 0.1,
    meshKey: 'unit',
    // Column-major: uniform scale by width, then translate.
    matrix: [s.width, 0, 0, 0, 0, s.width, 0, 0, 0, 0, s.width, 0, s.at[0], s.at[1], s.at[2], 1],
    role: 'accent',
    setting: 'pave',
  }))
  const stoneMeshes = stones.map((s) => sphereMesh(s.at, s.width / 2, 8))
  return {
    detail: 'draft',
    parts: ps,
    stones: ss,
    gemMeshes: { unit },
    report: {
      metals: [],
      metalMassG: 0,
      lots: [],
      stoneCount: ss.length,
      caratTotal: 0,
      bounds: boundsOf([...parts.map((p) => p.mesh), ...stoneMeshes]),
    },
    diagnostics: [],
    ms: 0,
    timings: {},
  }
}

export const count = (a: Uint8Array) => {
  let n = 0
  for (const v of a) if (v) n++
  return n
}
