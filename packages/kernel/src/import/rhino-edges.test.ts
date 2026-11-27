import { pointOnNurbs } from '@pave/schema'
import type { Brep, RhinoModule } from 'rhino3dm'
import { beforeAll, expect, it } from 'vitest'
import { makeCappedPrismFixture } from '../../test-fixtures/capped-prism'
import { loadRhino3dm } from '../runtime/rhino'
import { readPlacedCurve } from './rhino-curve'
import { inspectRhinoEdges } from './rhino-edges'

let rhino: RhinoModule
let bytes: Uint8Array<ArrayBuffer>
beforeAll(async () => {
  rhino = await loadRhino3dm()
  bytes = await makeCappedPrismFixture()
})

it('pages native edge indices and closes the sampled rim at its seam', async () => {
  const page = await inspectRhinoEdges(bytes, { offset: 0, limit: 2 })
  expect(page.edgeCount).toBe(6)
  expect(page.edges.map(({ edgeIndex, closed }) => [edgeIndex, closed])).toEqual([
    [0, true],
    [1, false],
  ])
  expect(page.curve).toBeUndefined()
  expect(page.edges[0]?.preview[0]).toEqual([3, 0, 0])
  expect(page.edges[0]?.preview.at(-1)).toEqual([3, 0, 0])
  expect(page.edges[1]?.preview).toEqual([
    [3, 0, 0],
    [3, 0, 2],
  ])
  expect((await inspectRhinoEdges(bytes, { offset: 5, limit: 30 })).edges).toHaveLength(1)
  expect((await inspectRhinoEdges(bytes, { offset: 6, limit: 30 })).edges).toEqual([])
})

it('returns one editable exact curve in the reflected and scaled block frame', async () => {
  // (x,y,z) -> (9 + 4z, -5 + 3y, 1 + 2x), a reflected non-uniform block.
  const placement = [0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0, 0, 9, -5, 1, 1]
  const result = await inspectRhinoEdges(bytes, { edgeIndex: 0, nativeTransform: placement })
  expect(result.edges).toHaveLength(1)
  expect(result.edges[0]).toMatchObject({ edgeIndex: 0, closed: true })
  expect(result.edges[0]?.preview[0]).toEqual([9, -5, 7])
  expect(result.curve?.degree).toBe(2)
  expect(result.curve?.controlPoints.some(([, , , w]) => w < 1)).toBe(true)
  const curve = result.curve!
  const start = curve.knots[curve.degree - 1]!
  const end = curve.knots[curve.controlPoints.length - 1]!
  for (let i = 0; i <= 20; i++) {
    const [x, y, z] = pointOnNurbs(curve, start + ((end - start) * i) / 20)
    expect(x).toBeCloseTo(9, 9)
    expect(((y + 5) / 9) ** 2 + ((z - 1) / 6) ** 2).toBeCloseTo(1, 10)
  }
  const rail = (await inspectRhinoEdges(bytes, { edgeIndex: 1, nativeTransform: placement })).curve!
  expect(rail.degree).toBe(1)
  expect(rail.controlPoints).toEqual([
    [9, -5, 7, 1],
    [17, -5, 7, 1],
  ])
  expect((await inspectRhinoEdges(bytes, { edgeIndex: 1 })).edges[0]?.preview).toEqual([
    [3, 0, 0],
    [3, 0, 2],
  ])
})

it('reuses the exact trimmed, reversed nonlinear curve proxy interval', () => {
  const archive = rhino.File3dm.fromByteArray(bytes)
  const part = archive.objects().get(0).geometry() as Brep
  const edge = part.edges().get(0)
  const [start, end] = edge.domain as [number, number]
  // Splitting an OpenNURBS CurveProxy makes two proxies that still share the underlying full
  // circle. Reverse only one proxy and confirm the standalone curve keeps the arc and direction.
  const cut = start + (end - start) * 0.3
  const expectedStart = edge.pointAt(cut)
  const [trimmed] = edge.split(cut)
  expect(trimmed?.constructor.name).toBe('CurveProxy')
  expect(trimmed!.reverse()).toBe(true)
  const exact = readPlacedCurve(rhino, trimmed!, (point) => point)
  const lo = exact.knots[exact.degree - 1]!
  const hi = exact.knots[exact.controlPoints.length - 1]!
  expect([lo, hi]).toEqual(trimmed!.domain)
  expect(pointOnNurbs(exact, lo)[0]).toBeCloseTo(expectedStart[0]!, 10)
  expect(pointOnNurbs(exact, lo)[1]).toBeCloseTo(expectedStart[1]!, 10)
  expect(pointOnNurbs(exact, hi)).toEqual([3, 0, 0])
  let previousAngle = Infinity
  for (let i = 0; i <= 20; i++) {
    const [x, y] = pointOnNurbs(exact, lo + ((hi - lo) * i) / 20)
    expect(Math.hypot(x, y)).toBeCloseTo(3, 10)
    const angle = Math.atan2(y, x)
    expect(angle).toBeLessThan(previousAngle)
    previousAngle = angle
  }
  expect(edge.domain).toEqual([start, end])
  expect(edge.isClosed).toBe(true)
})

it('refuses invalid edge references and collapsed block placements', async () => {
  await expect(inspectRhinoEdges(bytes, { edgeIndex: 6 })).rejects.toThrow(/edge/i)
  await expect(
    inspectRhinoEdges(bytes, {
      nativeTransform: [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    }),
  ).rejects.toThrow(/placement/i)
})
