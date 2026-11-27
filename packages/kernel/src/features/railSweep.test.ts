import { applyOps, designFrom, type NodeInputOf } from '@pave/schema'
import { importSTEP, measureVolume, type Shape3D } from 'replicad'
import { afterAll, describe, expect, it } from 'vitest'
import { createKernel } from '../kernel'
import { type ClosestHit, TriangleBvh } from '../mesh/bvh'
import { edgeTopology } from '../mesh/topology'

const kernel = createKernel()
afterAll(() => kernel.dispose())

function rail(
  id: string,
  ...controlPoints: NodeInputOf<'nurbsCurve'>['controlPoints']
): NodeInputOf<'nurbsCurve'> {
  const degree = controlPoints.length - 1
  return {
    id,
    kind: 'nurbsCurve',
    degree,
    controlPoints,
    knots: [...Array(degree).fill(0), ...Array(degree).fill(1)],
  }
}

function profile(
  id: string,
  z: number,
  x: number,
  width: number,
  height: number,
): NodeInputOf<'nurbsCurve'> {
  return {
    id,
    kind: 'nurbsCurve',
    degree: 1,
    knots: [0, 1, 2, 3, 4],
    controlPoints: [
      [x, 0, z, 1],
      [x + width, 0, z, 1],
      [x + width, height, z, 1],
      [x, height, z, 1],
      [x, 0, z, 1],
    ],
  }
}

const centre = rail('centre', [0, 0, 0, 1], [0, 0, 10, 1])
const side = rail('side', [4, 0, 0, 1], [9, 0, 3, 1], [4, 0, 10, 1])
const base = profile('base', 0, 0, 4, 2)

function sweep(rails: string[], sections: string[], capped = true): NodeInputOf<'railSweep'> {
  return { id: 'sweep', kind: 'railSweep', rails, sections, capped }
}

async function swept(design: ReturnType<typeof designFrom>) {
  const result = (await kernel.scene(design)).nodes.get('sweep')
  expect(result?.diagnostics).toEqual([])
  expect(result?.status).toBe('ok')
  return result!
}

function distanceToBody(
  body: NonNullable<Awaited<ReturnType<typeof swept>>['bodies'][number]>,
  point: [number, number, number],
) {
  const triangles = body.solid.triangles({ chord: 0.001, angle: 0.05 })
  const bvh = new TriangleBvh(triangles)
  const hit: ClosestHit = { x: 0, y: 0, z: 0, d2: Infinity, triangle: -1 }
  expect(bvh.closest(...point, hit)).toBe(true)
  return Math.sqrt(hit.d2)
}

describe('rail sweep', () => {
  it('carries a closed located section over the full first rail and caps a native solid', async () => {
    const design = designFrom('other', [
      centre,
      profile('base', 0, -1, 2, 3),
      sweep(['centre'], ['base']),
    ])
    const body = (await swept(design)).bodies[0]!
    expect(body.solid.volume()).toBeCloseTo(60, 5)
    const { min, max } = body.solid.bounds()
    expect(min[0]).toBeCloseTo(-1, 5)
    expect(max[2]).toBeCloseTo(10, 5)
    const topology = edgeTopology(body.solid.triangles())
    expect(topology.open).toBe(0)
    expect(topology.inconsistent).toBe(0)
  })

  it('keeps two differently sized placed sections on a one-rail sweep', async () => {
    const design = designFrom('other', [
      centre,
      profile('base', 0, -1, 2, 3),
      profile('tip', 10, -2, 4, 6),
      sweep(['centre'], ['base', 'tip']),
    ])
    const body = (await swept(design)).bodies[0]!
    expect(body.solid.volume()).toBeCloseTo(140, 4)
    expect(distanceToBody(body, [2, 6, 10])).toBeLessThan(0.001)
  })

  it('follows a bowed second rail between sections and changes after a guide edit', async () => {
    const design = designFrom('other', [
      centre,
      side,
      base,
      profile('tip', 10, 0, 4, 2),
      sweep(['centre', 'side'], ['base', 'tip']),
    ])
    const body = (await swept(design)).bodies[0]!
    // Evaluate the quadratic guide directly. The same normalized parameter on the straight
    // first rail has a different height, so parameter pairing would miss the second curve.
    for (const t of [0.19, 0.43, 0.58, 0.76]) {
      expect(distanceToBody(body, [4 + 10 * t * (1 - t), 0, 6 * t + 4 * t * t])).toBeLessThan(0.01)
    }
    expect(body.solid.volume()).toBeGreaterThan(105)
    const topology = edgeTopology(body.solid.triangles())
    expect(topology.open).toBe(0)
    expect(topology.inconsistent).toBe(0)

    const edited = applyOps(design, [
      {
        t: 'update',
        id: 'side',
        patch: {
          controlPoints: [
            [4, 0, 0, 1],
            [4, 0, 3, 1],
            [4, 0, 10, 1],
          ],
        },
      },
    ]).design
    const straight = (await swept(edited)).bodies[0]!
    expect(straight.solid.volume()).toBeCloseTo(80, 4)
    expect(distanceToBody(straight, [6.5, 0, 4])).toBeGreaterThan(2)
  })

  it('keeps a linked intermediate section and rebuilds after it is edited', async () => {
    const design = designFrom('other', [
      centre,
      side,
      base,
      profile('middle', 4, 0, 6.5, 3),
      profile('tip', 10, 0, 4, 2),
      sweep(['centre', 'side'], ['base', 'middle', 'tip']),
    ])
    const body = (await swept(design)).bodies[0]!
    expect(distanceToBody(body, [6.5, 3, 4])).toBeLessThan(0.01)
    const volume = body.solid.volume()
    const changed = applyOps(design, [
      {
        t: 'update',
        id: 'middle',
        patch: { controlPoints: profile('middle', 4, 0, 6.5, 4).controlPoints },
      },
    ]).design
    const revised = (await swept(changed)).bodies[0]!
    expect(distanceToBody(revised, [6.5, 4, 4])).toBeLessThan(0.01)
    expect(revised.solid.volume()).toBeGreaterThan(volume + 15)
  })

  it('retains an uncapped section sweep as native sheet geometry', async () => {
    const design = designFrom('other', [centre, base, sweep(['centre'], ['base'], false)])
    const result = await swept(design)
    expect(result.bodies).toHaveLength(0)
    expect(result.sheets).toHaveLength(1)
    const sheet = result.sheets?.[0]
    expect(sheet?.solid.area()).toBeCloseTo(120, 4)
    expect(edgeTopology(sheet!.solid.triangles()).open).toBeGreaterThan(0)
  })

  it('rejects a second rail that misses a section', async () => {
    const off = rail('off', [8, 0, 0, 1], [8, 0, 10, 1])
    const design = designFrom('other', [centre, off, base, sweep(['centre', 'off'], ['base'])])
    const result = (await kernel.scene(design)).nodes.get('sweep')
    expect(result?.bodies).toHaveLength(0)
    expect(
      result?.diagnostics.some(
        (d) => d.code === 'feature.failed' && /second rail/i.test(d.message),
      ),
    ).toBe(true)
  })

  it('round trips a capped two-rail body through STEP', async () => {
    const design = designFrom('other', [centre, side, base, sweep(['centre', 'side'], ['base'])])
    const exported = await kernel.export(design, 'step')
    expect(new TextDecoder().decode(exported.bytes)).toContain('MANIFOLD_SOLID_BREP')
    const shape = (await importSTEP(new Blob([exported.bytes.slice()]))) as Shape3D
    try {
      // Area at height z is 2 × (4 + 10t(1 − t)), with z = 6t + 4t².
      expect(measureVolume(shape)).toBeCloseTo(340 / 3, 1)
    } finally {
      shape.delete()
    }
  })
})
