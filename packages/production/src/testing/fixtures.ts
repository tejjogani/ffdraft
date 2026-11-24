/**
 * Procedural stand-ins for kernel evaluations, built from the real templates' parameters: a
 * platinum solitaire (one fused, seated metal part and a brilliant) and an iced initial pendant
 * (rimmed body with ~200 graded pavé seats, beads, a ribbon bail). Meshes come from signed
 * distance functions, so they are closed and manifold like production output. Test only.
 */
import type {
  Diagnostic,
  Evaluation,
  ExportFormat,
  ExportOptions,
  ExportResult,
  Kernel,
  MeshData,
  Part,
  StoneInstance,
  StoneLot,
} from '@pave/kernel/types'
import {
  buildDesign,
  type Design,
  type GemCutId,
  type GemMaterialId,
  gemCarat,
  gemDims,
  type MetalId,
  metalMassG,
  resolveDesign,
  TEMPLATES,
} from '@pave/schema'
import { analyzeTopology, mergeTris } from '../geometry/mesh'
import { writeBinaryStl } from '../geometry/stl'
import { meshSdf, type SdfMesh } from './mesher'
import { capsule, extrude, polygon, roundBox2, smin, stoneSolid } from './sdf'

export const templateDesign = (id: string): Design =>
  buildDesign(TEMPLATES.find((t) => t.id === id)!.spec)

/** Unit round brilliant: girdle width 1, table toward +Z, girdle plane at z = 0. */
export function roundBrilliantMesh(): MeshData {
  const g = 0.0175
  const zt = g + 0.15
  const zc = -g - 0.43
  const pos: number[] = []
  const T = (k: number) => k
  for (let k = 0; k < 8; k++)
    pos.push(0.285 * Math.cos((k * Math.PI) / 4), 0.285 * Math.sin((k * Math.PI) / 4), zt)
  const GT = (j: number) => 8 + (j % 32)
  for (let j = 0; j < 32; j++)
    pos.push(0.5 * Math.cos((j * Math.PI) / 16), 0.5 * Math.sin((j * Math.PI) / 16), g)
  const GB = (j: number) => 40 + (j % 32)
  for (let j = 0; j < 32; j++)
    pos.push(0.5 * Math.cos((j * Math.PI) / 16), 0.5 * Math.sin((j * Math.PI) / 16), -g)
  const C = 72
  pos.push(0, 0, zc)
  const idx: number[] = []
  for (let k = 1; k < 7; k++) idx.push(T(0), T(k), T(k + 1))
  for (let k = 0; k < 8; k++) {
    const a = T(k)
    const b = T((k + 1) % 8)
    const j = 4 * k
    idx.push(
      a,
      GT(j),
      GT(j + 1),
      a,
      GT(j + 1),
      GT(j + 2),
      a,
      GT(j + 2),
      b,
      b,
      GT(j + 2),
      GT(j + 3),
      b,
      GT(j + 3),
      GT(j + 4),
    )
  }
  for (let j = 0; j < 32; j++) {
    idx.push(GT(j), GB(j), GB(j + 1), GT(j), GB(j + 1), GT(j + 1))
    idx.push(GB(j + 1), GB(j), C)
  }
  const positions = Float32Array.from(pos)
  return { positions, normals: new Float32Array(0), indices: Uint32Array.from(idx) }
}

function part(
  id: string,
  name: string,
  material: MetalId,
  mesh: SdfMesh,
  opts: Partial<Part> = {},
): Part {
  const topo = analyzeTopology(mesh.positions, mesh.indices)
  let area = 0
  const p = mesh.positions
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a]!, p[i + a]!)
      max[a] = Math.max(max[a]!, p[i + a]!)
    }
  for (let f = 0; f < mesh.indices.length; f += 3) {
    const [i, j, k] = [mesh.indices[f]! * 3, mesh.indices[f + 1]! * 3, mesh.indices[f + 2]! * 3]
    const u = [p[j]! - p[i]!, p[j + 1]! - p[i + 1]!, p[j + 2]! - p[i + 2]!]
    const v = [p[k]! - p[i]!, p[k + 1]! - p[i + 1]!, p[k + 2]! - p[i + 2]!]
    area +=
      Math.hypot(
        u[1]! * v[2]! - u[2]! * v[1]!,
        u[2]! * v[0]! - u[0]! * v[2]!,
        u[0]! * v[1]! - u[1]! * v[0]!,
      ) / 2
  }
  return {
    id,
    nodeId: id,
    rev: '1',
    name,
    material,
    finish: 'polished',
    plating: 'none',
    mesh: { positions: mesh.positions, normals: mesh.normals, indices: mesh.indices },
    edges: new Float32Array(0),
    volumeMm3: topo.volumeMm3,
    areaMm2: area,
    bounds: { min, max },
    exact: false,
    ...opts,
  }
}

function stone(
  id: string,
  nodeId: string,
  stoneId: GemMaterialId,
  width: number,
  matrix: number[],
  role: StoneInstance['role'],
  setting: string,
  cut: GemCutId = 'round',
): StoneInstance {
  const dims = gemDims(cut, width)
  return {
    id,
    nodeId,
    cut,
    stone: stoneId,
    dims,
    carat: gemCarat(cut, dims, stoneId),
    meshKey: cut,
    matrix,
    role,
    setting,
  }
}

function lots(stones: StoneInstance[]): StoneLot[] {
  const map = new Map<string, StoneLot>()
  for (const s of stones) {
    const key = `${s.nodeId}|${s.cut}|${s.dims.width.toFixed(3)}`
    const lot = map.get(key)
    if (lot) {
      lot.count++
      lot.caratTotal += s.carat
    } else {
      map.set(key, {
        cut: s.cut,
        stone: s.stone,
        width: s.dims.width,
        length: s.dims.length,
        count: 1,
        caratEach: s.carat,
        caratTotal: s.carat,
        setting: s.setting,
        role: s.role,
        nodeIds: [s.nodeId],
      })
    }
  }
  return [...map.values()]
}

function evaluation(
  parts: Part[],
  stones: StoneInstance[],
  diagnostics: Diagnostic[],
  ringInnerDiameter?: number,
): Evaluation {
  const gem = roundBrilliantMesh()
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const p of parts)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a]!, p.bounds.min[a]!)
      max[a] = Math.max(max[a]!, p.bounds.max[a]!)
    }
  for (const s of stones) {
    const w = s.dims.width / 2
    const c = [s.matrix[12]!, s.matrix[13]!, s.matrix[14]!]
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a]!, c[a]! - w)
      max[a] = Math.max(max[a]!, c[a]! + w)
    }
  }
  const byMetal = new Map<MetalId, number>()
  for (const p of parts) byMetal.set(p.material, (byMetal.get(p.material) ?? 0) + p.volumeMm3)
  const metals = [...byMetal].map(([material, volumeMm3]) => ({
    material,
    volumeMm3,
    massG: metalMassG(material, volumeMm3),
  }))
  const stoneLots = lots(stones)
  return {
    detail: 'production',
    parts,
    stones,
    gemMeshes: { round: gem },
    report: {
      metals,
      metalMassG: metals.reduce((t, m) => t + m.massG, 0),
      lots: stoneLots,
      stoneCount: stones.length,
      caratTotal: stones.reduce((t, s) => t + s.carat, 0),
      bounds: { min, max },
      ...(ringInnerDiameter ? { ringInnerDiameter } : {}),
    },
    diagnostics,
    ms: 0,
    timings: {},
  }
}

/** The "solitaire" template: Pt950 court band, four-claw head, 1 ct round brilliant. */
export function solitaireRing(h = 0.06): { design: Design; evaluation: Evaluation } {
  const design = templateDesign('solitaire')
  const band = design.nodes.band!
  const gemNode = design.nodes.center!
  const head = resolveDesign(design).nodes.head!
  if (band.kind !== 'ringShank' || gemNode.kind !== 'gem' || head.kind !== 'setting')
    throw new Error('template changed')
  const R = (11.63 + 0.8128 * band.size.value) / 2
  const W = gemNode.width
  const crown = 0.15 * W
  const pav = 0.43 * W
  const zg = R + band.thicknessTop + 0.45 + pav
  const pr = (head.prongDiameter ?? 1) / 2
  const prongs: [[number, number, number], [number, number, number], [number, number, number]][] =
    []
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2
    const c = Math.cos(a)
    const s = Math.sin(a)
    prongs.push([
      [1.45 * c, 1.45 * s, R + band.thicknessTop - 0.5],
      [(W / 2 + pr * 0.55) * c, (W / 2 + pr * 0.55) * s, zg],
      [(W / 2 - 0.05) * c, (W / 2 - 0.05) * s, zg + crown * 0.55],
    ])
  }
  const railZ = zg - 1.15
  const railR =
    1.45 +
    ((W / 2 + pr * 0.55 - 1.45) * (railZ - (R + band.thicknessTop - 0.5))) /
      (zg - (R + band.thicknessTop - 0.5))
  const sdf = (x: number, y: number, z: number) => {
    const rho = Math.hypot(x, z)
    const t = (1 - z / (rho || 1)) / 2
    const T = band.thicknessTop + (band.thicknessBottom - band.thicknessTop) * t
    const Wb = band.widthTop + (band.widthBottom - band.widthTop) * t
    const ring = roundBox2(rho - (R + T / 2), y, T / 2, Wb / 2, Math.min(T, Wb) * 0.42)
    if (z < R - 1) return ring
    let headD = Infinity
    for (const [a, b, c] of prongs)
      headD = Math.min(headD, capsule(x, y, z, a, b, pr), capsule(x, y, z, b, c, pr * 0.92))
    headD = smin(headD, Math.hypot(Math.hypot(x, y) - railR, z - railZ) - 0.42, 0.25)
    const seat = stoneSolid(z - zg, Math.hypot(x, y), W / 2 + 0.02, crown, pav)
    headD = Math.max(headD, -seat)
    return smin(ring, headD, 0.35)
  }
  const ext = R + band.thicknessBottom + 0.6
  const mesh = meshSdf(sdf, [-ext, -W / 2 - 1, -ext], [ext, W / 2 + 1, zg + crown + 0.8], h)
  const metal = part('band', 'Ring', band.material, mesh)
  const centre = stone(
    'center:0',
    'center',
    gemNode.stone,
    W,
    [W, 0, 0, 0, 0, W, 0, 0, 0, 0, W, 0, 0, 0, zg, 1],
    'center',
    'prong',
  )
  return { design, evaluation: evaluation([metal], [centre], [], 2 * R) }
}

/** Block "A" outline (mm, centred), outer boundary and counter. */
const A_OUTER: [number, number][] = [
  [-13, -16],
  [-7.2, -16],
  [-4.575, -6],
  [4.575, -6],
  [7.2, -16],
  [13, -16],
  [4.6, 16],
  [-4.6, 16],
]
const A_COUNTER: [number, number][] = [
  [-3.26, -1],
  [3.26, -1],
  [0, 11.4],
]

/** The "iced-initial" template: rimmed block A, graded moissanite pavé with beads, ribbon bail. */
export function pavePendant(h = 0.1): { design: Design; evaluation: Evaluation } {
  const base = templateDesign('iced-initial')
  // Finer melee than the template's default, for a field of a couple of hundred stones.
  const design: Design = {
    ...base,
    nodes: {
      ...base.nodes,
      ice: {
        ...base.nodes.ice!,
        ...{ sizeMax: 1.1, sizeMin: 0.8, gap: 0.15 },
      } as Design['nodes'][string],
    },
  }
  const body = design.nodes.body!
  const ice = design.nodes.ice!
  const bail = design.nodes.bail!
  if (body.kind !== 'vectorBody' || ice.kind !== 'pave' || bail.kind !== 'bail')
    throw new Error('template changed')
  const d2 = (x: number, z: number) => Math.max(polygon(x, z, A_OUTER), -polygon(x, z, A_COUNTER))
  const border = body.border
  const field = -1.6
  const girdleY = field - 0.05

  // Graded layout: a hex field of the largest size, then the smallest size into what is left.
  const big = ice.sizeMax
  const small = ice.sizeMin
  const placed: { x: number; z: number; w: number }[] = []
  const pitch = big + ice.gap
  for (let row = 0, z = -16; z < 16; row++, z += pitch * Math.sin(Math.PI / 3)) {
    for (let x = -13 + (row % 2) * (pitch / 2); x < 13; x += pitch) {
      if (d2(x, z) < -(border + ice.margin + big / 2)) placed.push({ x, z, w: big })
    }
  }
  for (let z = -16; z < 16; z += 0.25) {
    for (let x = -13; x < 13; x += 0.25) {
      if (d2(x, z) >= -(border + ice.margin + small / 2)) continue
      if (placed.every((s) => Math.hypot(s.x - x, s.z - z) >= s.w / 2 + small / 2 + ice.gap))
        placed.push({ x, z, w: small })
    }
  }
  const beads: [number, number][] = []
  const seen = new Set<string>()
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i]!
    const near = placed.filter(
      (b) => b !== a && Math.hypot(b.x - a.x, b.z - a.z) < (a.w + b.w) / 2 + ice.gap + 0.15,
    )
    for (let j = 0; j < near.length; j++)
      for (let k = j + 1; k < near.length; k++) {
        const b = near[j]!
        const c = near[k]!
        if (Math.hypot(b.x - c.x, b.z - c.z) > (b.w + c.w) / 2 + ice.gap + 0.15) continue
        const bx = (a.x + b.x + c.x) / 3
        const bz = (a.z + b.z + c.z) / 3
        const key = `${bx.toFixed(2)},${bz.toFixed(2)}`
        if (!seen.has(key)) {
          seen.add(key)
          beads.push([bx, bz])
        }
      }
  }

  const cell = 2
  const grid = new Map<string, { stones: typeof placed; beads: [number, number][] }>()
  const bin = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`
  const slot = (k: string) => {
    let s = grid.get(k)
    if (!s) {
      s = { stones: [], beads: [] }
      grid.set(k, s)
    }
    return s
  }
  for (const s of placed)
    for (const dx of [-1, 0, 1])
      for (const dz of [-1, 0, 1]) slot(bin(s.x + dx * cell, s.z + dz * cell)).stones.push(s)
  for (const b of beads)
    for (const dx of [-1, 0, 1])
      for (const dz of [-1, 0, 1]) slot(bin(b[0] + dx * cell, b[1] + dz * cell)).beads.push(b)

  const bodySdf = (x: number, y: number, z: number) => {
    const d = d2(x, z)
    const plate = extrude(d, y - 0.2, 1.8, 0.45)
    const rim = extrude(Math.max(d, -(d + border)), y + 1.6, 0.4, 0.12)
    let s = smin(plate, rim, 0.12)
    const local = grid.get(bin(x, z))
    if (!local || y > 2.3) return s
    for (const st of local.stones) {
      const r = st.w / 2
      const rho = Math.hypot(x - st.x, z - st.z)
      if (rho > r + 0.3) continue
      const seat = Math.min(
        stoneSolid(girdleY - y, rho, r * 0.98, 0.6, 0.43 * st.w),
        Math.max(rho - r * 0.42, y - 2.5, girdleY - y),
      )
      s = Math.max(s, -seat)
    }
    for (const [bx, bz] of local.beads)
      s = Math.min(s, Math.hypot(x - bx, y - girdleY, z - bz) - 0.24)
    return s
  }
  const bodyMesh = meshSdf(bodySdf, [-13.6, -2.4, -16.6], [13.6, 2.6, 16.6], h)
  const Rb = bail.opening / 2 + bail.wire / 2
  const zc = 16 + Rb - 0.6
  const bailSdf = (x: number, y: number, z: number) =>
    roundBox2(Math.hypot(y, z - zc) - Rb, x, bail.wire / 2, bail.width / 2, 0.45)
  const bailMesh = meshSdf(
    bailSdf,
    [-bail.width / 2 - 0.3, -Rb - 1, zc - Rb - 1],
    [bail.width / 2 + 0.3, Rb + 1, zc + Rb + 1],
    h * 0.8,
  )
  const finish = { finish: body.finish, plating: body.plating }
  const parts = [
    part('body', 'Body', body.material, bodyMesh, finish),
    part('bail', 'Bail', bail.material, bailMesh, finish),
  ]
  // Face −Y: rotate the unit gem's +Z table onto −Y.
  const stones = placed.map((s, i) =>
    stone(
      `ice:${i}`,
      'ice',
      ice.stone,
      s.w,
      [s.w, 0, 0, 0, 0, 0, s.w, 0, 0, -s.w, 0, 0, s.x, girdleY, s.z, 1],
      'melee',
      'pave',
    ),
  )
  const diagnostics: Diagnostic[] = [
    {
      level: 'info',
      code: 'pave.layout',
      message: `${stones.length} stones in two sizes, ${beads.length} beads`,
      nodeId: 'ice',
    },
  ]
  return { design, evaluation: evaluation(parts, stones, diagnostics) }
}

/**
 * A kernel that exports the evaluation it was built from: binary STL per `only` node set, and
 * small labelled stand-ins for the B-rep formats.
 */
export function fixtureKernel(evaluation: Evaluation): Kernel {
  return {
    kinds: [],
    formats: ['stl', 'step', '3dm', '3mf'],
    ready: async () => {},
    evaluate: async () => evaluation,
    async export(
      _design: Design,
      format: ExportFormat,
      options: ExportOptions = {},
    ): Promise<ExportResult> {
      const parts = evaluation.parts.filter((p) => !options.only || options.only.includes(p.nodeId))
      if (format === 'stl') {
        const mesh = mergeTris(
          parts.map((p) => ({ positions: p.mesh.positions, indices: p.mesh.indices })),
        )
        return {
          bytes: writeBinaryStl(mesh, 'fixture kernel'),
          mime: 'model/stl',
          extension: 'stl',
          notes: [],
        }
      }
      const text = `fixture ${format} export of ${parts.map((p) => p.nodeId).join(', ')}\n`
      const mime = {
        step: 'model/step',
        '3dm': 'model/vnd.3dm',
        '3mf': 'model/3mf',
        obj: 'model/obj',
        glb: 'model/gltf-binary',
      }[format]
      return {
        bytes: new TextEncoder().encode(text),
        mime,
        extension: format,
        notes:
          format === 'step' ? ['Mesh bodies are tessellated; no exact B-rep in this fixture.'] : [],
      }
    },
  }
}

/** An evaluation from bare meshes, for tests: one metal part per mesh. */
export function evaluationOf(
  parts: { id: string; name?: string; material?: MetalId; mesh: MeshData }[],
  stones: StoneInstance[] = [],
  diagnostics: Diagnostic[] = [],
): Evaluation {
  return evaluation(
    parts.map((p) =>
      part(p.id, p.name ?? p.id, p.material ?? 'au18k-yellow', {
        positions: p.mesh.positions,
        normals: p.mesh.normals,
        indices: p.mesh.indices,
      }),
    ),
    stones,
    diagnostics,
  )
}

/** A unit-gem stone instance placed at `c` with its table toward +Z. */
export const stoneAt = (
  id: string,
  nodeId: string,
  width: number,
  c: [number, number, number],
  role: StoneInstance['role'] = 'center',
  setting = 'prong',
): StoneInstance =>
  stone(
    id,
    nodeId,
    'diamond',
    width,
    [width, 0, 0, 0, 0, width, 0, 0, 0, 0, width, 0, c[0], c[1], c[2], 1],
    role,
    setting,
  )
