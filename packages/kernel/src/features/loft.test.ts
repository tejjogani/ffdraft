import { applyOps, designFrom, type NodeInputOf } from '@pave/schema'
import { afterAll, expect, it } from 'vitest'
import { createKernel } from '../kernel'
import { runtime } from '../runtime/index'
import { scoped } from '../solid/occt'

const kernel = createKernel()
afterAll(() => kernel.dispose())

const circle = (id: string, z: number, radius: number): NodeInputOf<'nurbsCurve'> => ({
  id,
  kind: 'nurbsCurve',
  degree: 2,
  knots: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4],
  controlPoints: [
    [radius, 0, z, 1],
    [radius, radius, z, Math.SQRT1_2],
    [0, radius, z, 1],
    [-radius, radius, z, Math.SQRT1_2],
    [-radius, 0, z, 1],
    [-radius, -radius, z, Math.SQRT1_2],
    [0, -radius, z, 1],
    [radius, -radius, z, Math.SQRT1_2],
    [radius, 0, z, 1],
  ],
})

const line = (id: string, z: number): NodeInputOf<'nurbsCurve'> => ({
  id,
  kind: 'nurbsCurve',
  degree: 1,
  knots: [0, 1],
  controlPoints: [
    [-2, 0, z, 1],
    [2, 0, z, 1],
  ],
})

it('rebuilds a capped rational loft when an endpoint section changes', async () => {
  const design = designFrom('other', [
    circle('base', 0, 2),
    circle('rim', 3, 1),
    { id: 'loft', kind: 'loft', sections: ['base', 'rim'], ruled: true },
  ])
  const scene = await kernel.scene(design)
  const body = scene.nodes.get('loft')?.bodies[0]?.solid
  expect(scene.evaluation.diagnostics).toEqual([])
  expect(body?.exact).toBe(true)
  // Volume of a circular frustum: π h (R² + Rr + r²) / 3.
  expect(body?.volume()).toBeCloseTo(7 * Math.PI, 4)
  const edited = applyOps(design, [
    { t: 'update', id: 'rim', patch: { controlPoints: circle('rim', 3, 1.5).controlPoints } },
  ]).design
  const rebuilt = await kernel.scene(edited)
  expect(rebuilt.nodes.get('loft')?.bodies[0]?.solid.volume()).toBeCloseTo(9.25 * Math.PI, 4)
})

it('produces different surfaces for smooth and ruled interpolation', async () => {
  const design = designFrom('other', [
    circle('base', 0, 2),
    circle('middle', 3, 3),
    circle('rim', 6, 2),
    { id: 'loft', kind: 'loft', sections: ['base', 'middle', 'rim'] },
  ])
  const smooth = await kernel.scene(design)
  const smoothVolume = smooth.nodes.get('loft')?.bodies[0]?.solid.volume()
  const edited = applyOps(design, [{ t: 'update', id: 'loft', patch: { ruled: true } }]).design
  const ruled = await kernel.scene(edited)
  const ruledVolume = ruled.nodes.get('loft')?.bodies[0]?.solid.volume()
  expect(ruledVolume).toBeCloseTo(38 * Math.PI, 4)
  expect(smoothVolume).toBeGreaterThan(ruledVolume!)
})

it('builds exact non-metal sheets from open sections or closed uncapped sections', async () => {
  const design = designFrom('other', [
    line('lineA', 0),
    line('lineB', 3),
    circle('base', 0, 2),
    circle('rim', 3, 2),
    { id: 'flat', kind: 'loft', sections: ['lineA', 'lineB'] },
    { id: 'tube', kind: 'loft', sections: ['base', 'rim'], capped: false },
  ])
  const scene = await kernel.scene(design)
  expect(scene.evaluation.report.metalMassG).toBe(0)
  expect(scene.nodes.get('flat')?.sheets?.[0]?.solid.area()).toBeCloseTo(12, 5)
  const tube = scene.nodes.get('tube')?.sheets?.[0]?.solid.brep()
  expect(tube).toBeTruthy()
  scoped((own) => {
    const { oc } = runtime()
    const props = own(new oc.GProp_GProps())
    oc.BRepGProp.SurfaceProperties(tube!.wrapped, props, 1e-6, false)
    expect(props.Mass()).toBeCloseTo(12 * Math.PI, 4)
  })
})

it('reports conflicting section closure while leaving unrelated metal available', async () => {
  const design = designFrom('other', [
    line('line', 0),
    circle('rim', 3, 2),
    { id: 'broken', kind: 'loft', sections: ['line', 'rim'] },
    { id: 'other', kind: 'primitive', shape: 'box' },
  ])
  const scene = await kernel.scene(design)
  expect(scene.nodes.get('broken')?.status).toBe('failed')
  expect(scene.nodes.get('broken')?.diagnostics[0]?.message).toContain(
    'all be open or all be closed',
  )
  expect(scene.nodes.get('other')?.bodies).toHaveLength(1)
})

const square = (id: string, bowTie = false): NodeInputOf<'curve'> => ({
  id,
  kind: 'curve',
  plane: 'top',
  closed: true,
  points: (bowTie
    ? [
        [-2, -2],
        [2, 2],
        [-2, 2],
        [2, -2],
      ]
    : [
        [-2, -2],
        [2, -2],
        [2, 2],
        [-2, 2],
      ]
  ).map(([u, v], i) => ({ id: String(i), u: u!, v: v! })),
})

it('lofts between sections of different curve types and segment counts', async () => {
  const design = designFrom('other', [
    square('base'),
    circle('rim', 3, 1),
    { id: 'loft', kind: 'loft', sections: ['base', 'rim'] },
  ])
  const scene = await kernel.scene(design)
  expect(scene.evaluation.diagnostics).toEqual([])
  const body = scene.nodes.get('loft')?.bodies[0]?.solid
  expect(body?.exact).toBe(true)
  expect(body?.bounds().max[2]).toBeCloseTo(3, 6)
  expect(body?.volume()).toBeGreaterThan(3 * Math.PI)
  expect(body?.volume()).toBeLessThan(48)
})

it('rejects a self-crossing cap outline', async () => {
  const design = designFrom('other', [
    square('base', true),
    circle('rim', 3, 1),
    { id: 'loft', kind: 'loft', sections: ['base', 'rim'] },
  ])
  const scene = await kernel.scene(design)
  expect(scene.nodes.get('loft')?.status).toBe('failed')
  expect(scene.nodes.get('loft')?.diagnostics[0]?.code).toBe('feature.failed')
})
