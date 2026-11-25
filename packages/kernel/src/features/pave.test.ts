/**
 * Automatic pavé at production: what the casting gains from seats, holes and beads. Each case
 * here is a finding of the core engine test pass that the layout once got wrong.
 */
import { buildDesign, designFrom, type NodeInput, TEMPLATES } from '@pave/schema'
import type { Manifold } from 'manifold-3d'
import { afterAll, describe, expect, it } from 'vitest'
import { createKernel, type LocalKernel } from '../kernel'
import { TriangleBvh } from '../mesh/bvh'
import { QUALITY } from '../solid/solid'

const kernel: LocalKernel = createKernel()
afterAll(() => kernel.dispose())

/** Handles of a mesh, summed over its pieces (Manifold's genus wants one piece). */
function genus(m: Manifold): number {
  let g = 0
  for (const piece of m.decompose()) {
    g += piece.genus()
    piece.delete()
  }
  return g
}

type Scene = Awaited<ReturnType<LocalKernel['scene']>>

/**
 * The host with its seats cut (a new mesh, the caller's to delete), and the beads of the pavé
 * node that cut them (borrowed from the scene).
 */
function seatedHost(scene: Scene, hostId: string, iceId = 'ice') {
  const ice = scene.nodes.get(iceId)!
  const host = scene.nodes.get(hostId)!.bodies[0]!.solid.manifold(QUALITY.production)
  const seated = host.subtract(ice.cuts[0]!.solid.manifold(QUALITY.production))
  const beads = ice.additions[0]!.solid.manifold(QUALITY.production)
  return { seated, beads }
}

/** A 3 mm standing bar, which takes one row of 1.8 mm stones. */
const bar: NodeInput = {
  id: 'b',
  kind: 'vectorBody',
  source: { type: 'svg', d: 'M0 0 H3 V30 H0 Z' },
  height: 30,
  thickness: 2.5,
  bevel: 'flat',
  bevelSize: 0,
}
const barPave: NodeInput = { id: 'ice', kind: 'pave', host: 'b', sizeMax: 1.8, sizeMin: 1.8 }

/** Centre and radius of every bead the pavé node adds (each is its own piece). */
function beadsOf(scene: Scene, iceId = 'ice'): { c: number[]; r: number }[] {
  const pieces = scene.nodes
    .get(iceId)!
    .additions[0]!.solid.manifold(QUALITY.production)
    .decompose()
  return pieces.map((piece) => {
    const box = piece.boundingBox()
    piece.delete()
    return {
      c: [0, 1, 2].map((k) => (box.min[k]! + box.max[k]!) / 2),
      r: (box.max[0]! - box.min[0]!) / 2,
    }
  })
}

describe('pavé beads at the edge of the field', () => {
  // A bead squeezed between a girdle and a raised border wall touches the wall and the floor
  // and leaves a tunnel under it: the casting gains a handle investment cannot fill.
  it('adds no handles beside a raised border', async () => {
    const heart: NodeInput = {
      id: 'b',
      kind: 'vectorBody',
      source: { type: 'shape', shape: 'heart' },
      height: 30,
      thickness: 2.5,
      bevel: 'round',
      bevelSize: 0.4,
      border: 1,
    }
    for (const [sizeMax, sizeMin] of [
      [1.8, 1],
      [0.8, 0.8],
    ]) {
      const design = designFrom('pendant', [
        heart,
        { id: 'ice', kind: 'pave', host: 'b', sizeMax, sizeMin },
      ])
      const scene = await kernel.scene(design, { detail: 'production' })
      const { seated, beads } = seatedHost(scene, 'b')
      const joined = seated.add(beads)
      expect(genus(joined), `heart ${sizeMin}–${sizeMax}`).toBe(genus(seated))
      for (const m of [seated, joined]) m.delete()
    }
  }, 60_000)

  it('adds no handles to the iced initial template', async () => {
    const template = TEMPLATES.find((t) => t.id === 'iced-initial')!
    const design = buildDesign(template.spec)
    const hostId = (design.nodes.ice as { host: string }).host
    const scene = await kernel.scene(design, { detail: 'production' })
    const { seated, beads } = seatedHost(scene, hostId)
    const joined = seated.add(beads)
    expect(genus(joined)).toBe(genus(seated))
    for (const m of [seated, joined]) m.delete()
  }, 60_000)

  it('keeps metal between every bead and the side of a narrow bar', async () => {
    const scene = await kernel.scene(designFrom('pendant', [bar, barPave]), {
      detail: 'production',
    })
    const box = scene.nodes.get('b')!.bodies[0]!.solid.bounds()
    for (const { c, r } of beadsOf(scene)) {
      const metal = Math.min(c[0]! - box.min[0], box.max[0] - c[0]!) - r
      expect(metal, `bead at ${c.map((x) => x.toFixed(2))}`).toBeGreaterThanOrEqual(0.1 - 0.005)
    }
  }, 60_000)

  // Beads dropped near the field's edge once left stones held from one side only: a single row
  // had a bead at 3 and 9 o'clock and nothing along it, and the outer row inside a raised border
  // leaned on a wall 0.1–0.2 mm off its girdle with one bead on the other side.
  it('holds every stone round its whole girdle, by beads or by a wall against it', async () => {
    const initial: NodeInput = {
      id: 'b',
      kind: 'vectorBody',
      source: { type: 'text', text: 'A', font: 'block' },
      height: 32,
      thickness: 4,
      bevel: 'round',
      bevelSize: 0.4,
      border: 0.8,
    }
    for (const [label, host, pave] of [
      ['3 mm bar', bar, barPave],
      [
        'initial A, 0.8 mm',
        initial,
        { id: 'ice', kind: 'pave', host: 'b', sizeMax: 0.8, sizeMin: 0.8 },
      ],
    ] as const) {
      const scene = await kernel.scene(designFrom('pendant', [host, pave as NodeInput]), {
        detail: 'production',
      })
      const tris = scene.nodes.get('b')!.bodies[0]!.solid.triangles(QUALITY.production)
      const bvh = new TriangleBvh({
        positions: tris.positions.slice(),
        indices: tris.indices.slice(),
      })
      // Inside the host: an odd number of crossings up a ray.
      const inside = (p: number[], d: number[]) =>
        bvh.crossings(p[0]!, p[1]!, p[2]!, d[0]!, d[1]!, d[2]!).length % 2 === 1
      const beads = beadsOf(scene)
      const stones = scene.evaluation.stones.filter((x) => x.nodeId === 'ice')
      expect(stones.length, label).toBeGreaterThan(10)
      for (const stone of stones) {
        const m = stone.matrix
        const unit = (k: number) => {
          const v = [m[k]!, m[k + 1]!, m[k + 2]!]
          const len = Math.hypot(v[0]!, v[1]!, v[2]!)
          return v.map((x) => x / len)
        }
        const [u, v, n] = [unit(0), unit(4), unit(8)]
        const c = [m[12]!, m[13]!, m[14]!]
        const d = stone.dims.width
        const at = (q: number[], dot: number[]) => q.reduce((sum, x, k) => sum + x * dot[k]!, 0)
        const holds: number[] = []
        for (const b of beads) {
          const q = b.c.map((x, k) => x - c[k]!)
          const h = at(q, n)
          const radial = Math.sqrt(Math.max(0, at(q, q) - h * h))
          // A bead holds the stone when its edge reaches within 0.15 mm of the girdle.
          if (Math.abs(h) < d && radial - b.r <= d / 2 + 0.15)
            holds.push(Math.atan2(at(q, v), at(q, u)))
        }
        // A wall holds it where host metal stands over the girdle within 0.05 mm outside it.
        for (let k = 0; k < 24; k++) {
          const a = -Math.PI + ((k + 0.5) / 24) * 2 * Math.PI
          const r = d / 2 + 0.05
          const p = c.map(
            (x, j) =>
              x + u[j]! * r * Math.cos(a) + v[j]! * r * Math.sin(a) + n[j]! * (0.1 + 0.02 * d),
          )
          if (inside(p, n)) holds.push(a)
        }
        holds.sort((a, b) => a - b)
        let open = holds.length === 0 ? 2 * Math.PI : 0
        holds.forEach((a, i) => {
          open = Math.max(
            open,
            (i + 1 < holds.length ? holds[i + 1]! : holds[0]! + 2 * Math.PI) - a,
          )
        })
        expect(
          (open * 180) / Math.PI,
          `${label}: stone at ${c.map((x) => x.toFixed(2))}`,
        ).toBeLessThanOrEqual(180)
      }
    }
  }, 120_000)
})

describe('hollow bodies', () => {
  const sculpt = (name: string, height: number, hollow: number): NodeInput => ({
    id: 'm',
    kind: 'meshBody',
    source: { type: 'builtin', name: name as 'trophy' },
    height,
    hollow,
  })

  // Walls once came out 20 % thicker than asked, and every hollow piece weighed more for it.
  it('makes walls within a few per cent of the thickness asked for', async () => {
    for (const hollow of [0.7, 1.5]) {
      const solid = await kernel.scene(designFrom('pendant', [sculpt('dice', 30, 0)]))
      const skin = solid.nodes.get('m')!.bodies[0]!.solid.triangles(QUALITY.draft)
      const outside = new TriangleBvh({
        positions: skin.positions.slice(),
        indices: skin.indices.slice(),
      })
      const scene = await kernel.scene(designFrom('pendant', [sculpt('dice', 30, hollow)]))
      const tris = scene.nodes.get('m')!.bodies[0]!.solid.triangles(QUALITY.draft)
      const hit = { d2: 0, x: 0, y: 0, z: 0, triangle: -1 }
      const walls: number[] = []
      for (let v = 0; v < tris.positions.length; v += 3) {
        outside.closest(tris.positions[v]!, tris.positions[v + 1]!, tris.positions[v + 2]!, hit)
        const d = Math.sqrt(hit.d2)
        // Vertices on the outside are not wall; those on the escape holes run through it.
        if (d > 0.02 && d > 0.8 * hollow) walls.push(d)
      }
      walls.sort((a, b) => a - b)
      const median = walls[walls.length >> 1]!
      expect(median, `hollow ${hollow}`).toBeGreaterThanOrEqual(hollow - 0.01)
      expect(median, `hollow ${hollow}`).toBeLessThanOrEqual(hollow * 1.06)
    }
  }, 60_000)

  // Escape holes once started 2 mm inside the cavity, and a millimetre either side of the axis
  // their start cap ended in the metal beside it: skins of 0.02–0.07 mm under a dice pip, the
  // crown's edge and the trophy's cup, which break through in casting.
  it('keeps the wall asked for everywhere, escape holes included', async () => {
    for (const [name, height, hollow] of [
      ['dice', 40, 0.7],
      ['trophy', 40, 0.9],
      ['crown', 20, 0.3],
    ] as const) {
      const label = `${name} ${height} mm, hollow ${hollow}`
      const solid = await kernel.scene(designFrom('pendant', [sculpt(name, height, 0)]))
      const skin = solid.nodes.get('m')!.bodies[0]!.solid.triangles(QUALITY.draft)
      const outside = new TriangleBvh({
        positions: skin.positions.slice(),
        indices: skin.indices.slice(),
      })
      const scene = await kernel.scene(designFrom('pendant', [sculpt(name, height, hollow)]))
      expect(
        scene.evaluation.diagnostics.map((d) => d.code),
        label,
      ).toContain('mesh.drains')
      const tris = scene.nodes.get('m')!.bodies[0]!.solid.triangles(QUALITY.draft)
      const hit = { d2: 0, x: 0, y: 0, z: 0, triangle: -1 }
      let thinnest = Infinity
      for (let v = 0; v < tris.positions.length; v += 3) {
        outside.closest(tris.positions[v]!, tris.positions[v + 1]!, tris.positions[v + 2]!, hit)
        const d = Math.sqrt(hit.d2)
        // Vertices on the outside skin (and the rims where holes leave it) are not wall.
        if (d > 0.02) thinnest = Math.min(thinnest, d)
      }
      expect(thinnest, label).toBeGreaterThanOrEqual(0.95 * hollow)
    }
  }, 120_000)

  // The crown's points and band are only a little thicker than two walls: the cavity there was
  // a slit, pierced by over a hundred pillars, with sealed specks and loose crumbs.
  it('hollows the crown without a perforated cavity, sealed voids or loose pieces', async () => {
    for (const [height, hollow] of [
      [40, 1.5],
      [60, 1.5],
      [20, 0.3],
    ]) {
      const scene = await kernel.scene(designFrom('pendant', [sculpt('crown', height!, hollow!)]))
      const body = scene.nodes.get('m')!.bodies[0]!.solid.manifold()
      const label = `crown ${height} mm, hollow ${hollow}`
      // Every escape hole is a handle of its own; beyond those, a few at most.
      const drains = Number(
        scene.evaluation.diagnostics
          .find((d) => d.code === 'mesh.drains')
          ?.message.match(/\d+/)?.[0] ?? 0,
      )
      expect(body.genus(), label).toBeLessThanOrEqual(1 + drains + 3)
      const volumes = body.decompose().map((piece) => {
        const v = piece.volume()
        piece.delete()
        return v
      })
      expect(volumes, label).toHaveLength(1)
      expect(volumes[0], label).toBeGreaterThan(0)
    }
  }, 60_000)
})

describe('pavé on a hollow trophy at production', () => {
  // Seats and drill holes beside a cavity's corner once broke into it (tunnels in the casting),
  // and stones went under the cup and the handles, where no setter's tool can reach.
  it('adds no handles to the casting and sets no stone under overhanging metal', async () => {
    const design = designFrom('pendant', [
      {
        id: 'b',
        kind: 'meshBody',
        source: { type: 'builtin', name: 'trophy' },
        height: 50,
        hollow: 1.1,
      },
      { id: 'ice', kind: 'pave', host: 'b', region: { type: 'all' }, sizeMax: 1.8, sizeMin: 1 },
    ])
    const draft = await kernel.scene(design)
    const host = draft.nodes.get('b')!.bodies[0]!.solid.triangles(QUALITY.draft)
    const bvh = new TriangleBvh({
      positions: host.positions.slice(),
      indices: host.indices.slice(),
    })
    const stones = draft.evaluation.stones.filter((s) => s.nodeId === 'ice')
    expect(stones.length).toBeGreaterThan(500)
    for (const s of stones) {
      const m = s.matrix
      const n = [m[8]!, m[9]!, m[10]!]
      const len = Math.hypot(n[0]!, n[1]!, n[2]!)
      const u = n.map((x) => x / len)
      // From just above the table (0.2 d over the girdle), 3 mm up the axis.
      const lift = 0.2 * s.dims.width
      const o = [0, 1, 2].map((k) => m[12 + k]! + u[k]! * lift)
      expect(bvh.raycast(o[0]!, o[1]!, o[2]!, u[0]!, u[1]!, u[2]!, 0, 3), s.id).toBe(Infinity)
    }
    const scene = await kernel.scene(design, { detail: 'production' })
    const hostGenus = genus(scene.nodes.get('b')!.bodies[0]!.solid.manifold(QUALITY.production))
    expect(scene.parts).toHaveLength(1)
    expect(genus(scene.parts[0]!.fused!.manifold())).toBe(hostGenus)
  }, 120_000)
})

describe('pavé of large stones on sculpted hosts at production', () => {
  // A bead on the trophy's cup reached down to the stem's collar, and drill holes of a ring of
  // stones in a hollow leaned together (on the dice, one ran past a side face under a pip):
  // each added a handle to the casting.
  it('adds no handles to the trophy or the dice', async () => {
    for (const [name, height] of [
      ['trophy', 45],
      ['dice', 14],
    ] as const) {
      const design = designFrom('pendant', [
        { id: 'b', kind: 'meshBody', source: { type: 'builtin', name }, height },
        { id: 'ice', kind: 'pave', host: 'b', region: { type: 'all' }, sizeMax: 3, sizeMin: 3 },
      ])
      const scene = await kernel.scene(design, { detail: 'production' })
      const host = genus(scene.nodes.get('b')!.bodies[0]!.solid.manifold(QUALITY.production))
      const { seated, beads } = seatedHost(scene, 'b')
      const joined = seated.add(beads)
      expect(genus(seated), `${name}: seats`).toBe(host)
      expect(genus(joined), `${name}: beads`).toBe(host)
      for (const m of [seated, joined]) m.delete()
    }
  }, 120_000)
})

describe('pavé layout on flat fields', () => {
  // The seam between a field's frame row and its honeycomb was left bare where a void only
  // just took a stone: no sample landed on the one spot where it fit. Measured as bald.mts
  // measures it, on a 0.1 mm grid over the front face.
  it('leaves no seat for the smallest stone empty and packs the field densely', async () => {
    for (const [shape, density] of [
      ['circle', 0.62],
      ['heart', 0.61],
      ['tag', 0.59],
    ] as const) {
      const thickness = 2.5
      const design = designFrom('pendant', [
        {
          id: 'b',
          kind: 'vectorBody',
          source: { type: 'shape', shape },
          height: 30,
          thickness,
          bevel: 'flat',
          bevelSize: 0,
        },
        { id: 'ice', kind: 'pave', host: 'b', sizeMax: 1.8, sizeMin: 1 },
      ])
      const node = design.nodes.ice as { margin: number; gap: number }
      const scene = await kernel.scene(design)
      const tris = scene.nodes.get('b')!.bodies[0]!.solid.triangles(QUALITY.draft)
      const bvh = new TriangleBvh({
        positions: tris.positions.slice(),
        indices: tris.indices.slice(),
      })
      const box = scene.nodes.get('b')!.bodies[0]!.solid.bounds()
      const stones = scene.evaluation.stones
        .filter((x) => x.nodeId === 'ice')
        .map((x) => ({ x: x.matrix[12]!, z: x.matrix[14]!, r: x.dims.width / 2 }))
      const h = 0.1
      const nx = Math.ceil((box.max[0] - box.min[0]) / h) + 3
      const nz = Math.ceil((box.max[2] - box.min[2]) / h) + 3
      const at = (k: number) => [
        box.min[0] + ((k % nx) - 1) * h,
        box.min[2] + (Math.floor(k / nx) - 1) * h,
      ]
      // The front face, and each point's distance to its edge (two-pass chamfer).
      const edge = new Float32Array(nx * nz)
      for (let k = 0; k < edge.length; k++) {
        const [x, z] = at(k)
        const t = bvh.raycast(x!, -50, z!, 0, 1, 0)
        edge[k] = Number.isFinite(t) && Math.abs(t - 50 + thickness) < 0.02 ? 1e9 : 0
      }
      const relax = (k: number, o: number, w: number) => {
        if (edge[o]! + w < edge[k]!) edge[k] = edge[o]! + w
      }
      for (let j = 1; j < nz - 1; j++)
        for (let i = 1; i < nx - 1; i++) {
          const k = j * nx + i
          relax(k, k - 1, h)
          relax(k, k - nx, h)
          relax(k, k - nx - 1, h * Math.SQRT2)
          relax(k, k - nx + 1, h * Math.SQRT2)
        }
      for (let j = nz - 2; j > 0; j--)
        for (let i = nx - 2; i > 0; i--) {
          const k = j * nx + i
          relax(k, k + 1, h)
          relax(k, k + nx, h)
          relax(k, k + nx + 1, h * Math.SQRT2)
          relax(k, k + nx - 1, h * Math.SQRT2)
        }
      let face = 0
      const missed: string[] = []
      for (let k = 0; k < edge.length; k++) {
        if (edge[k] === 0) continue
        face++
        const [x, z] = at(k)
        let clear = Infinity
        for (const s of stones) clear = Math.min(clear, Math.hypot(x! - s.x, z! - s.z) - s.r)
        // The smallest stone fits here with gap and margin kept (0.1 mm of slack for the grid).
        const margin = Math.max(node.margin, 0.4)
        if (edge[k]! - margin >= 0.5 + 0.1 && clear - node.gap >= 0.5 + 0.1)
          missed.push(`${x!.toFixed(1)},${z!.toFixed(1)}`)
      }
      expect(missed, shape).toEqual([])
      const area = stones.reduce((sum, s) => sum + Math.PI * s.r * s.r, 0)
      expect(area / (face * h * h), shape).toBeGreaterThanOrEqual(density)
    }
  }, 60_000)
})

describe('pavé too large to cut', () => {
  it('says which stone size would fit the budget, without measuring every stone', async () => {
    const design = designFrom('pendant', [
      {
        id: 'b',
        kind: 'vectorBody',
        source: { type: 'shape', shape: 'circle' },
        bevel: 'flat',
        bevelSize: 0,
        height: 94,
        thickness: 2,
      },
      { id: 'ice', kind: 'pave', host: 'b', sizeMax: 0.8, sizeMin: 0.8 },
    ])
    const e = await kernel.evaluate(design, { detail: 'production' })
    const tooLarge = e.diagnostics.find((d) => d.code === 'pave.tooLarge')
    expect(tooLarge?.message).toMatch(/use stones of \d+(\.\d+)? mm or more/)
    expect(tooLarge!.limit!).toBeGreaterThan(0.8)
    expect(e.diagnostics.map((d) => d.code)).not.toContain('stone.inMetal')
  }, 60_000)
})
