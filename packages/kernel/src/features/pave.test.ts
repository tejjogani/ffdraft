/**
 * Automatic pavé at production: what the casting gains from seats, holes and beads. Each case
 * here is a finding of the core engine test pass that the layout once got wrong.
 */
import { buildDesign, designFrom, type NodeInput, TEMPLATES } from '@pave/schema'
import type { Manifold } from 'manifold-3d'
import { afterAll, describe, expect, it } from 'vitest'
import { createKernel, type LocalKernel } from '../kernel'
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

  it('keeps metal between every bead and the side of a narrow bar, square to the row', async () => {
    // A 3 mm standing bar takes one row of 1.8 mm stones.
    const design = designFrom('pendant', [
      {
        id: 'b',
        kind: 'vectorBody',
        source: { type: 'svg', d: 'M0 0 H3 V30 H0 Z' },
        height: 30,
        thickness: 2.5,
        bevel: 'flat',
        bevelSize: 0,
      },
      { id: 'ice', kind: 'pave', host: 'b', sizeMax: 1.8, sizeMin: 1.8 },
    ])
    const scene = await kernel.scene(design, { detail: 'production' })
    const bar = scene.nodes.get('b')!.bodies[0]!.solid.bounds()
    const stones = scene.evaluation.stones.filter((s) => s.nodeId === 'ice')
    expect(stones.length).toBeGreaterThan(10)
    const beads = scene.nodes.get('ice')!.additions[0]!.solid.manifold(QUALITY.production)
    const pieces = beads.decompose()
    expect(pieces.length).toBeGreaterThanOrEqual(stones.length)
    let square = 0
    let side = 0
    for (const piece of pieces) {
      const box = piece.boundingBox()
      const c = [0, 1, 2].map((k) => (box.min[k]! + box.max[k]!) / 2)
      const r = (box.max[0]! - box.min[0]!) / 2
      const metal = Math.min(c[0]! - bar.min[0], bar.max[0] - c[0]!) - r
      expect(metal, `bead at ${c.map((x) => x.toFixed(2))}`).toBeGreaterThanOrEqual(0.1 - 0.005)
      // A side bead (beside its stone rather than between two) sits square to the row (Z).
      const near = stones.reduce((a, s) =>
        Math.hypot(s.matrix[12]! - c[0]!, s.matrix[14]! - c[2]!) <
        Math.hypot(a.matrix[12]! - c[0]!, a.matrix[14]! - c[2]!)
          ? s
          : a,
      )
      const dx = Math.abs(c[0]! - near.matrix[12]!)
      const dz = Math.abs(c[2]! - near.matrix[14]!)
      if (dx > dz) {
        side++
        if (Math.atan2(dz, dx) < (2 * Math.PI) / 180) square++
      }
      piece.delete()
    }
    // The two end stones have one neighbour and are held round their open end.
    expect(square).toBeGreaterThanOrEqual(side - 4)
  }, 60_000)
})
