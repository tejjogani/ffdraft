import { applyOps, designFrom, type NodeInputOf } from '@pave/schema'
import { importSTEP, isShape3D, measureVolume } from 'replicad'
import { afterAll, expect, it } from 'vitest'
import { createKernel } from '../kernel'
import { edgeTopology } from '../mesh/topology'

const kernel = createKernel()
afterAll(() => kernel.dispose())

const rectangle = (plane: 'top' | 'right'): NodeInputOf<'curve'> => ({
  id: 'section',
  kind: 'curve',
  plane,
  closed: true,
  points: [
    [-1, -1],
    [1, -1],
    [1, 3],
    [-1, 3],
  ].map(([r, y], i) => ({
    id: String(i),
    u: (plane === 'top' ? r : y)!,
    v: (plane === 'top' ? y : r)!,
  })),
})

it.each(['top', 'right'] as const)(
  'resizes the bore of a closed band on the %s plane without scaling the section',
  async (plane) => {
    const initial = designFrom('ring', [
      rectangle(plane),
      { id: 'band', kind: 'revolve', curve: 'section', size: { system: 'us', value: 6 } },
    ])
    const resized = applyOps(initial, [
      { t: 'update', id: 'band', patch: { size: { system: 'us', value: 7 } } },
    ]).design
    for (const [design, bore] of [
      [initial, 16.5068],
      [resized, 17.3196],
    ] as const) {
      const { nodes } = await kernel.scene(design, { detail: 'production' })
      const band = nodes.get('band')!
      expect(band.diagnostics).toEqual([])
      expect(band.bodies).toHaveLength(1)
      const { solid } = band.bodies[0]!
      expect(solid.exact).toBe(true)
      const mesh = solid.triangles()
      let inner = Infinity
      let outer = -Infinity
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const r = Math.hypot(mesh.positions[i]!, mesh.positions[i + 2]!)
        inner = Math.min(inner, r)
        outer = Math.max(outer, r)
      }
      expect(inner * 2).toBeCloseTo(bore, 4)
      expect(outer - inner).toBeCloseTo(2, 4)
      expect(solid.bounds().min[1]).toBeCloseTo(-1, 4)
      expect(solid.bounds().max[1]).toBeCloseTo(3, 4)
      expect(solid.volume()).toBeCloseTo(Math.PI * 8 * (bore + 2), 4)
      expect(edgeTopology(mesh)).toMatchObject({ open: 0, nonManifold: 0 })
    }

    const saved = await kernel.export(resized, 'step')
    expect(new TextDecoder().decode(saved.bytes)).toContain('MANIFOLD_SOLID_BREP')
    const shape = await importSTEP(new Blob([saved.bytes.slice()]))
    try {
      if (!isShape3D(shape)) throw new Error('STEP did not contain a 3D shape')
      expect(measureVolume(shape)).toBeCloseTo(Math.PI * 8 * 19.3196, 4)
    } finally {
      shape.delete()
    }
  },
)

it('preserves the in-plane axis and angle for an existing free-axis revolve', async () => {
  const source = rectangle('top')
  const design = designFrom('other', [
    { ...source, plane: 'front', planeOffset: 5 },
    { id: 'band', kind: 'revolve', curve: 'section', axis: 'vertical', axisOffset: -4, angle: 180 },
  ])
  expect(design.nodes.band).not.toHaveProperty('size')
  const scene = await kernel.scene(design, { detail: 'production' })
  const { solid } = scene.nodes.get('band')!.bodies[0]!
  expect(solid.volume()).toBeCloseTo(32 * Math.PI, 4)
  expect(solid.bounds().min[2]).toBeCloseTo(-1, 4)
  expect(solid.bounds().max[2]).toBeCloseTo(3, 4)
})
