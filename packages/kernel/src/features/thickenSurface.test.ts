import { applyOps, designFrom, type NodeInputOf } from '@pave/schema'
import { importSTEP, isShape3D, measureVolume } from 'replicad'
import { afterAll, describe, expect, it } from 'vitest'
import { createKernel } from '../kernel'
import { edgeTopology } from '../mesh/topology'

const kernel = createKernel()
afterAll(() => kernel.dispose())

const line = (
  id: string,
  a: [number, number, number],
  b: [number, number, number],
): NodeInputOf<'nurbsCurve'> => ({
  id,
  kind: 'nurbsCurve',
  degree: 1,
  knots: [0, 1],
  controlPoints: [
    [...a, 1],
    [...b, 1],
  ],
})

const planar = () =>
  designFrom('other', [
    line('start', [0, 0, 0], [5, 0, 0]),
    line('end', [0, 0, 10], [5, 0, 10]),
    { id: 'sheet', kind: 'loft', sections: ['start', 'end'], capped: false },
  ])
const thicken = (
  surface: string,
  thickness = 1,
  reverse = false,
): NodeInputOf<'thickenSurface'> => ({
  id: 'body',
  kind: 'thickenSurface',
  surface,
  thickness,
  reverse,
})

async function solidFrom(design: ReturnType<typeof planar>) {
  const scene = await kernel.scene(design)
  const r = scene.nodes.get('body')
  expect(r?.diagnostics).toEqual([])
  expect(r?.bodies).toHaveLength(1)
  const solid = r!.bodies[0]!.solid
  expect(solid.exact).toBe(true)
  const topology = edgeTopology(solid.triangles())
  expect(topology.open).toBe(0)
  expect(topology.nonManifold).toBe(0)
  return { scene, solid }
}

describe('thicken surface', () => {
  it('uses the exact source sheet once in the assembled piece and writes a STEP solid', async () => {
    const design = applyOps(planar(), [{ t: 'add', node: thicken('sheet', 0.8) }]).design
    const { scene, solid } = await solidFrom(design)
    expect(solid.volume()).toBeCloseTo(40, 4)
    expect(scene.nodes.get('sheet')?.sheets).toHaveLength(1)
    expect(scene.evaluation.parts.map((part) => part.nodeId)).toEqual(['body'])
    expect(scene.evaluation.referenceParts ?? []).toHaveLength(0)
    const exported = await kernel.export(design, 'step')
    expect(new TextDecoder().decode(exported.bytes)).toContain('MANIFOLD_SOLID_BREP')
    const shape = await importSTEP(new Blob([exported.bytes.slice()]))
    try {
      expect(isShape3D(shape)).toBe(true)
      if (!isShape3D(shape)) throw new Error('STEP did not contain a 3D shape')
      expect(measureVolume(shape)).toBeCloseTo(40, 4)
    } finally {
      shape.delete()
    }
  })

  it('places the same thickness on the opposite side when reversed', async () => {
    const design = applyOps(planar(), [{ t: 'add', node: thicken('sheet', 0.8) }]).design
    const first = (await solidFrom(design)).solid.bounds()
    const reverse = applyOps(design, [{ t: 'update', id: 'body', patch: { reverse: true } }]).design
    const bounds = (await solidFrom(reverse)).solid.bounds()
    expect(first.max[1] - first.min[1]).toBeCloseTo(0.8, 5)
    expect(bounds.max[1]).toBeCloseTo(-first.min[1], 5)
    expect(bounds.min[1]).toBeCloseTo(-first.max[1], 5)
  })

  it('rebuilds after a source edit and restores the sheet after undoing the feature', async () => {
    const source = planar()
    const added = applyOps(source, [{ t: 'add', node: thicken('sheet') }])
    expect((await solidFrom(added.design)).solid.volume()).toBeCloseTo(50, 4)
    const edited = applyOps(added.design, [
      {
        t: 'update',
        id: 'end',
        patch: {
          controlPoints: [
            [0, 0, 20, 1],
            [5, 0, 20, 1],
          ],
        },
      },
    ]).design
    expect((await solidFrom(edited)).solid.volume()).toBeCloseTo(100, 4)
    const undone = applyOps(added.design, added.inverse).design
    expect(undone).toEqual(source)
    const restored = await kernel.scene(undone)
    expect(restored.evaluation.parts).toHaveLength(0)
    expect(restored.evaluation.referenceParts).toMatchObject([
      { nodeId: 'sheet', modelingSheet: true },
    ])
    expect(restored.nodes.get('sheet')?.sheets).toHaveLength(1)
  })

  it('thickens a curved single-faced loft', async () => {
    const design = designFrom('other', [
      line('start', [0, 0, 0], [6, 0, 0]),
      line('middle', [0, 2, 5], [6, 2, 5]),
      line('end', [0, 0, 10], [6, 0, 10]),
      { id: 'sheet', kind: 'loft', sections: ['start', 'middle', 'end'], capped: false },
      thicken('sheet', 0.5),
    ])
    const { solid } = await solidFrom(design)
    expect(solid.volume()).toBeGreaterThan(28)
    expect(solid.volume()).toBeLessThan(38)
  })

  it('builds both sides of a quarter-cylinder rail sweep with the expected volumes', async () => {
    const rail: NodeInputOf<'nurbsCurve'> = {
      id: 'rail',
      kind: 'nurbsCurve',
      degree: 2,
      knots: [0, 0, 1, 1],
      controlPoints: [
        [2, 0, 0, 1],
        [2, 2, 0, Math.SQRT1_2],
        [0, 2, 0, 1],
      ],
    }
    const design = designFrom('other', [
      rail,
      line('profile', [2, 0, 0], [2, 0, 4]),
      { id: 'sheet', kind: 'railSweep', rails: ['rail'], sections: ['profile'], capped: false },
      thicken('sheet', 0.5),
    ])
    const a = (await solidFrom(design)).solid.volume()
    const reversed = applyOps(design, [
      { t: 'update', id: 'body', patch: { reverse: true } },
    ]).design
    const b = (await solidFrom(reversed)).solid.volume()
    expect(Math.min(a, b)).toBeCloseTo(1.75 * Math.PI, 3)
    expect(Math.max(a, b)).toBeCloseTo(2.25 * Math.PI, 3)
  })

  it('rejects using a solid or zero thickness', () => {
    const source = applyOps(planar(), [
      { t: 'add', node: { id: 'block', kind: 'primitive', shape: 'box' } },
    ]).design
    expect(() => applyOps(source, [{ t: 'add', node: thicken('block') }])).toThrow(
      /uncapped loft or rail sweep/i,
    )
    expect(() => applyOps(source, [{ t: 'add', node: thicken('sheet', 0) }])).toThrow(/thickness/i)
  })
})
