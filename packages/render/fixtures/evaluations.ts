/**
 * Procedural Evaluations for tests and the demo: a 1 ct four-prong solitaire and a 300-stone
 * pavé bar. Shapes are simple (torus band, capsule prongs) but obey the kernel contract: Z up,
 * mm, finger along Y, head at +Z, unit gem meshes placed by column-major matrices.
 */
import type { Bounds, Evaluation, MeshData, Part, StoneInstance } from '@pave/kernel/types'
import { type FinishId, gemCarat, gemDims, type GemMaterialId, type MetalId, type PlatingId } from '@pave/schema'
import { roundBrilliant } from './brilliant'

type P = [number, number, number]

class MeshBuilder {
  positions: number[] = []
  normals: number[] = []
  indices: number[] = []

  /** A (u × v) grid of vertices from `fn`, wrapped in u and optionally v. */
  grid(nu: number, nv: number, fn: (u: number, v: number) => [P, P], wrapV = true) {
    const base = this.positions.length / 3
    const rows = wrapV ? nv : nv + 1
    for (let i = 0; i < nu; i++)
      for (let j = 0; j < rows; j++) {
        const [p, n] = fn(i / nu, j / nv)
        this.positions.push(...p)
        this.normals.push(...n)
      }
    for (let i = 0; i < nu; i++)
      for (let j = 0; j < nv; j++) {
        const a = base + i * rows + j
        const b = base + ((i + 1) % nu) * rows + j
        const c = base + ((i + 1) % nu) * rows + ((j + 1) % rows)
        const d = base + i * rows + ((j + 1) % rows)
        this.indices.push(a, b, c, a, c, d)
      }
  }

  build(): MeshData {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      indices: new Uint32Array(this.indices),
    }
  }
}

const TAU = Math.PI * 2

/** Band around the Y axis with an elliptical (comfort-fit) section. */
function band(m: MeshBuilder, radius: number, thickness: number, width: number) {
  const a = thickness / 2
  const b = width / 2
  m.grid(128, 32, (u, v) => {
    const th = u * TAU
    const ph = v * TAU
    const radial: P = [Math.sin(th), 0, Math.cos(th)]
    const r = radius + a * Math.cos(ph)
    const y = b * Math.sin(ph)
    const nr = Math.cos(ph) / a
    const ny = Math.sin(ph) / b
    const l = Math.hypot(nr, ny)
    return [
      [radial[0] * r, y, radial[2] * r],
      [(radial[0] * nr) / l, ny / l, (radial[2] * nr) / l],
    ]
  })
}

/** Torus around Z (a gallery rail). */
function rail(m: MeshBuilder, center: P, radius: number, tube: number) {
  m.grid(64, 16, (u, v) => {
    const th = u * TAU
    const ph = v * TAU
    const n: P = [Math.cos(th) * Math.cos(ph), Math.sin(th) * Math.cos(ph), Math.sin(ph)]
    const r = radius + tube * Math.cos(ph)
    return [[center[0] + Math.cos(th) * r, center[1] + Math.sin(th) * r, center[2] + tube * Math.sin(ph)], n]
  })
}

/** Capsule from `a` to `b` (hemispherical ends), for prongs. */
function capsule(m: MeshBuilder, a: P, b: P, r: number) {
  const axis: P = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const len = Math.hypot(...axis)
  const w: P = [axis[0] / len, axis[1] / len, axis[2] / len]
  const tmp: P = Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const u0: P = [w[1] * tmp[2] - w[2] * tmp[1], w[2] * tmp[0] - w[0] * tmp[2], w[0] * tmp[1] - w[1] * tmp[0]]
  const ul = Math.hypot(...u0)
  const u: P = [u0[0] / ul, u0[1] / ul, u0[2] / ul]
  const v: P = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]]
  const rings = 24
  m.grid(
    24,
    rings,
    (s, t) => {
      const th = s * TAU
      // t ∈ [0,1]: bottom pole → equator → (cylinder) → equator → top pole.
      const phi = -Math.PI / 2 + t * Math.PI
      const cosp = Math.cos(phi)
      const sinp = Math.sin(phi)
      const along = t < 0.5 ? 0 : len
      const n: P = [
        (u[0] * Math.cos(th) + v[0] * Math.sin(th)) * cosp + w[0] * sinp,
        (u[1] * Math.cos(th) + v[1] * Math.sin(th)) * cosp + w[1] * sinp,
        (u[2] * Math.cos(th) + v[2] * Math.sin(th)) * cosp + w[2] * sinp,
      ]
      return [[a[0] + w[0] * along + n[0] * r, a[1] + w[1] * along + n[1] * r, a[2] + w[2] * along + n[2] * r], n]
    },
    false,
  )
}

function boundsOf(points: ArrayLike<number>, into?: Bounds): Bounds {
  const b: Bounds = into ?? { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  for (let i = 0; i < points.length; i += 3)
    for (let c = 0; c < 3; c++) {
      b.min[c] = Math.min(b.min[c]!, points[i + c]!)
      b.max[c] = Math.max(b.max[c]!, points[i + c]!)
    }
  return b
}

interface Look3 {
  material: MetalId
  finish: FinishId
  plating: PlatingId
}

function part(id: string, name: string, mesh: MeshData, metal: Look3): Part {
  return {
    id,
    nodeId: id,
    rev: `${id}@1`,
    name,
    ...metal,
    mesh,
    edges: new Float32Array(),
    volumeMm3: 0,
    areaMm2: 0,
    bounds: boundsOf(mesh.positions),
    exact: false,
  }
}

function stoneAt(
  id: string,
  nodeId: string,
  matrix: number[],
  width: number,
  stone: GemMaterialId,
  role: StoneInstance['role'],
): StoneInstance {
  const dims = gemDims('round', width)
  return {
    id,
    nodeId,
    cut: 'round',
    stone,
    dims,
    carat: gemCarat('round', dims, stone),
    meshKey: 'round',
    matrix,
    role,
    setting: role === 'center' ? 'prong' : 'pave',
  }
}

function evaluation(parts: Part[], stones: StoneInstance[], gem: MeshData): Evaluation {
  const bounds = parts.reduce<Bounds | undefined>((b, p) => boundsOf(p.mesh.positions, b), undefined)!
  for (const s of stones) {
    const w = Math.hypot(s.matrix[0]!, s.matrix[1]!, s.matrix[2]!)
    const c: P = [s.matrix[12]!, s.matrix[13]!, s.matrix[14]!]
    boundsOf([c[0] - w / 2, c[1] - w / 2, c[2] - w / 2, c[0] + w / 2, c[1] + w / 2, c[2] + w / 2], bounds)
  }
  return {
    detail: 'draft',
    parts,
    stones,
    gemMeshes: { round: gem },
    report: {
      metals: [],
      metalMassG: 0,
      lots: [],
      stoneCount: stones.length,
      caratTotal: stones.reduce((s, x) => s + x.carat, 0),
      bounds,
    },
    diagnostics: [],
    ms: 0,
    timings: {},
  }
}

export interface RingOptions extends Partial<Look3> {
  stone?: GemMaterialId
  /** Centre stone girdle width in mm (6.5 ≈ 1 ct). */
  stoneWidth?: number
}

/** A four-prong solitaire, size ~US 7 (17.3 mm inner diameter). */
export function solitaireRing(o: RingOptions = {}): Evaluation {
  const metal: Look3 = {
    material: o.material ?? 'au18k-yellow',
    finish: o.finish ?? 'polished',
    plating: o.plating ?? 'none',
  }
  const width = o.stoneWidth ?? 6.5
  const innerR = 8.65
  const thickness = 1.7
  const shank = new MeshBuilder()
  band(shank, innerR + thickness / 2, thickness, 2.2)

  const girdleZ = innerR + thickness + 3.4
  const crown = 0.1675 * width
  const head = new MeshBuilder()
  rail(head, [0, 0, girdleZ - 0.25 * width], 0.32 * width, 0.35)
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2
    const dir: P = [Math.cos(a), Math.sin(a), 0]
    const r0 = 0.22 * width
    const r1 = 0.5 * width + 0.05
    capsule(head, [dir[0] * r0, dir[1] * r0, innerR + thickness - 0.6], [dir[0] * r1, dir[1] * r1, girdleZ + crown * 0.45], 0.42)
  }
  const s = width
  const matrix = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, girdleZ, 1]
  return evaluation(
    [part('shank', 'Shank', shank.build(), metal), part('head', 'Head', head.build(), metal)],
    [stoneAt('center:0', 'center', matrix, width, o.stone ?? 'diamond', 'center')],
    roundBrilliant(),
  )
}

/** A 40 × 14 mm bar standing in the XZ plane, facing −Y, set with 30 × 10 melee in a hex grid. */
export function paveBar(o: Partial<Look3> & { stone?: GemMaterialId } = {}): Evaluation {
  const metal: Look3 = {
    material: o.material ?? 'au18k-white',
    finish: o.finish ?? 'polished',
    plating: o.plating ?? 'rhodium',
  }
  const [w, h, d] = [42, 14, 1.6]
  const faces: P[][] = []
  const v = (x: number, y: number, z: number): P => [x * w / 2, y * d - d, z * h / 2 + h / 2]
  const quads: [P, P, P, P][] = [
    [v(-1, 0, -1), v(1, 0, -1), v(1, 0, 1), v(-1, 0, 1)],
    [v(-1, 1, -1), v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1)],
    [v(-1, 0, -1), v(-1, 0, 1), v(-1, 1, 1), v(-1, 1, -1)],
    [v(1, 0, -1), v(1, 1, -1), v(1, 1, 1), v(1, 0, 1)],
    [v(-1, 0, 1), v(1, 0, 1), v(1, 1, 1), v(-1, 1, 1)],
    [v(-1, 0, -1), v(-1, 1, -1), v(1, 1, -1), v(1, 0, -1)],
  ]
  faces.push(...quads)
  const plate = boxMesh(faces)

  const melee = 1.3
  const pitch = melee * 1.08
  const stones: StoneInstance[] = []
  for (let row = 0; row < 10; row++)
    for (let col = 0; col < 30; col++) {
      const x = (col - 14.5) * pitch + (row % 2 ? pitch / 2 : 0) - pitch / 4
      const z = h / 2 + (row - 4.5) * pitch * 0.866
      // Table toward −Y: rotate the unit gem +90° about X.
      const matrix = [melee, 0, 0, 0, 0, 0, melee, 0, 0, -melee, 0, 0, x, -d - 0.05, z, 1]
      stones.push(stoneAt(`pave:${row * 30 + col}`, 'pave', matrix, melee, o.stone ?? 'diamond', 'melee'))
    }
  return evaluation([part('bar', 'Bar', plate, metal)], stones, roundBrilliant())
}

function boxMesh(quads: P[][]): MeshData {
  const m = new MeshBuilder()
  for (const q of quads) {
    const [a, b, c] = q as [P, P, P]
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const n: P = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!]
    const l = Math.hypot(...n)
    const base = m.positions.length / 3
    for (const p of q) {
      m.positions.push(...p)
      m.normals.push(n[0] / l, n[1] / l, n[2] / l)
    }
    m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return m.build()
}
