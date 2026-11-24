import { buildDesign, designFrom, type NodeInput, TEMPLATES } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cross, dot } from '../geometry/vec'
import { createKernel, type LocalKernel } from '../kernel'
import { meshVolume } from '../solid/meshing'

let kernel: LocalKernel
beforeAll(() => {
  kernel = createKernel()
})
afterAll(() => kernel.dispose())

const at = (x: number, y: number, z: number, rz = 0) => ({
  position: [x, y, z] as [number, number, number],
  rotation: [0, 0, rz] as [number, number, number],
  scale: 1,
})
const cone: NodeInput = {
  id: 'cone',
  kind: 'primitive',
  shape: 'cone',
  size: [2, 2, 4],
  transform: at(5, 0, 0),
}
const gem: NodeInput = { id: 'g', kind: 'gem', cut: 'pear', width: 3, transform: at(5, 3, 0, 30) }

describe('pattern', () => {
  it('polar: count − 1 copies evenly round the axis; the source stays', async () => {
    const scene = await kernel.scene(
      designFrom('other', [
        cone,
        { id: 'p', kind: 'pattern', sources: ['cone'], type: 'polar', axis: 'z', count: 4 },
      ]),
    )
    const copies = scene.nodes.get('p')!.bodies
    expect(copies).toHaveLength(3)
    const centres = copies.map((b) => {
      const box = b.solid.bounds()
      return [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2]
    })
    for (const [i, [x, y]] of [
      [0, 5],
      [-5, 0],
      [0, -5],
    ].entries()) {
      expect(centres[i]![0]).toBeCloseTo(x!, 4)
      expect(centres[i]![1]).toBeCloseTo(y!, 4)
    }
    expect(scene.evaluation.parts).toHaveLength(2)
  })

  it('linear and partial polar arcs place copies along the axis / to the arc end', async () => {
    const scene = await kernel.scene(
      designFrom('other', [
        cone,
        {
          id: 'l',
          kind: 'pattern',
          sources: ['cone'],
          type: 'linear',
          axis: 'x',
          count: 3,
          spacing: 6,
        },
        {
          id: 'arc',
          kind: 'pattern',
          sources: ['cone'],
          type: 'polar',
          axis: 'z',
          count: 3,
          angle: 90,
        },
      ]),
    )
    expect(scene.nodes.get('l')!.bodies.map((b) => Math.round(b.solid.bounds().min[0]))).toEqual([
      10, 16,
    ])
    const last = scene.nodes.get('arc')!.bodies[1]!.solid.bounds()
    expect((last.min[1] + last.max[1]) / 2).toBeCloseTo(5, 4)
  })

  it('mirror: copies keep outward-facing triangles and right-handed stone frames', async () => {
    const scene = await kernel.scene(
      designFrom('other', [
        cone,
        gem,
        { id: 'm', kind: 'pattern', sources: ['cone', 'g'], type: 'mirror', axis: 'x' },
      ]),
    )
    const copy = scene.nodes.get('m')!
    const tris = copy.bodies[0]!.solid.triangles()
    expect(meshVolume(tris)).toBeGreaterThan(0)
    expect(copy.bodies[0]!.solid.volume()).toBeCloseTo(
      scene.nodes.get('cone')!.bodies[0]!.solid.volume(),
      4,
    )
    const source = scene.nodes.get('g')!.stones[0]!.frame
    const mirrored = copy.stones[0]!.frame
    expect(dot(cross(mirrored.x, mirrored.y), mirrored.z)).toBeCloseTo(1, 6)
    expect(mirrored.origin[0]).toBeCloseTo(-source.origin[0], 6)
    // The pear's point (stone +y) is mirrored, not rotated.
    expect(mirrored.y[0]).toBeCloseTo(-source.y[0], 6)
    expect(mirrored.y[1]).toBeCloseTo(source.y[1], 6)
  })

  it('studs: the mirrored pair carries its stone, head and post, with the setting style', async () => {
    const e = await kernel.evaluate(buildDesign(TEMPLATES.find((t) => t.id === 'studs')!.spec))
    expect(e.stones).toHaveLength(2)
    expect(new Set(e.stones.map((s) => s.setting)).size).toBe(1)
    const xs = e.stones.map((s) => s.matrix[12]!)
    expect(xs[0]).toBeCloseTo(-xs[1]!, 6)
    expect(e.diagnostics.filter((d) => d.level === 'error')).toEqual([])
    // Each earring casts as one piece: the post is fused to its head (bridged by a pad).
    const production = await kernel.evaluate(
      buildDesign(TEMPLATES.find((t) => t.id === 'studs')!.spec),
      { detail: 'production' },
    )
    expect(production.parts).toHaveLength(2)
  })
})

describe('group', () => {
  it('carries its children, and moves them as a unit when it has a transform', async () => {
    const still = await kernel.scene(
      designFrom('other', [cone, gem, { id: 'grp', kind: 'group', children: ['cone', 'g'] }]),
    )
    expect(still.evaluation.parts.map((p) => p.nodeId)).toEqual(['grp'])
    expect(still.evaluation.stones).toHaveLength(1)
    const moved = await kernel.scene(
      designFrom('other', [
        cone,
        gem,
        { id: 'grp', kind: 'group', children: ['cone', 'g'], transform: at(0, 0, 10) },
      ]),
    )
    expect(moved.evaluation.parts.map((p) => p.nodeId)).toEqual(['grp'])
    expect(moved.evaluation.parts[0]!.bounds.min[2]).toBeCloseTo(
      still.evaluation.parts[0]!.bounds.min[2] + 10,
      6,
    )
    expect(moved.evaluation.stones).toHaveLength(1)
    expect(moved.evaluation.stones[0]!.matrix[14]).toBeCloseTo(10, 6)
    expect(moved.nodes.get('grp')!.frames['g/stone']).toBeDefined()
  })

  it('a plain group nested in a moved group moves with it', async () => {
    const scene = await kernel.scene(
      designFrom('other', [
        cone,
        gem,
        { id: 'box', kind: 'primitive', shape: 'box', size: [2, 2, 2] },
        { id: 'inner', kind: 'group', children: ['cone', 'g'] },
        { id: 'outer', kind: 'group', children: ['inner', 'box'], transform: at(20, 0, 0) },
      ]),
    )
    const box = scene.evaluation.parts[0]!.bounds
    // Cone (x 4..6) and box (x −1..1), both 20 further along.
    expect(box.min[0]).toBeCloseTo(19, 4)
    expect(box.max[0]).toBeCloseTo(26, 4)
    expect(scene.evaluation.stones[0]!.matrix[12]).toBeCloseTo(25, 6)
  })

  it('a pattern of a plain group copies everything in it', async () => {
    const scene = await kernel.scene(
      designFrom('other', [
        cone,
        gem,
        { id: 'grp', kind: 'group', children: ['cone', 'g'] },
        {
          id: 'row',
          kind: 'pattern',
          sources: ['grp'],
          type: 'linear',
          axis: 'z',
          count: 3,
          spacing: 10,
        },
      ]),
    )
    expect(scene.evaluation.stones).toHaveLength(3)
    const [source, copies] = scene.evaluation.parts
    expect(copies!.nodeId).toBe('row')
    expect(copies!.volumeMm3).toBeCloseTo(2 * source!.volumeMm3, 3)
    expect(copies!.bounds.max[2]).toBeCloseTo(source!.bounds.max[2] + 20, 4)
  })

  it('reports a node outside a moved group that refers to something inside it', async () => {
    const scene = await kernel.scene(
      designFrom('pendant', [
        { id: 'box', kind: 'primitive', shape: 'box', size: [6, 2, 6] },
        { id: 'grp', kind: 'group', children: ['box'], transform: at(20, 0, 0) },
        { id: 'ring', kind: 'finding', type: 'jumpRing', host: 'box' },
      ]),
      { detail: 'production' },
    )
    const codes = scene.evaluation.diagnostics.filter((d) => d.nodeId === 'ring').map((d) => d.code)
    expect(codes).toContain('group.reference')
  })
})
