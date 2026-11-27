import { pointOnNurbs, sampleNurbs } from '@pave/schema'
import type { Brep, RhinoModule } from 'rhino3dm'
import { beforeAll, expect, it } from 'vitest'
import { makeCappedPrismFixture } from '../../test-fixtures/capped-prism'
import { loadRhino3dm } from '../runtime/rhino'
import { readRhino3dm } from './rhino'
import { listRhinoFaceBorders } from './rhino-face-borders'

let rhino: RhinoModule
let sleeve: Uint8Array<ArrayBuffer>
beforeAll(async () => {
  rhino = await loadRhino3dm()
  sleeve = await makeCappedPrismFixture()
})

function archive(brep: Brep) {
  const doc = new rhino.File3dm()
  doc.settings().modelUnitSystem = rhino.UnitSystem.Millimeters
  doc.objects().addBrep(brep, new rhino.ObjectAttributes())
  return doc.toByteArray()
}

const signedAreaXY = (points: readonly number[][]) =>
  points.slice(1).reduce((area, [x, y], i) => area + points[i]![0]! * y! - points[i]![1]! * x!, 0) /
  2

it('copies the annular face as two exact closed NURBS loops and skips seamed walls', async () => {
  const page = await listRhinoFaceBorders(sleeve)
  expect(page.faceCount).toBe(4)
  expect(page.faces.map((face) => face.faceIndex)).toEqual([2, 3])
  expect(page.curves).toBeUndefined()
  expect((await listRhinoFaceBorders(sleeve, { limit: 2 })).faces).toEqual([])
  const wall = await listRhinoFaceBorders(sleeve, { faceIndex: 0 })
  expect(wall.curves).toBeUndefined()
  expect(wall.reason).toMatch(/seam|repeated/i)
  const bottom = await listRhinoFaceBorders(sleeve, { faceIndex: 2 })
  expect(bottom.curves?.map(({ kind }) => kind)).toEqual(['outer', 'inner'])
  for (const [index, curve] of bottom.curves!.entries()) {
    expect(curve.degree).toBe(2)
    const positions = sampleNurbs(curve)
    for (const [x, y, z] of positions) {
      expect(Math.hypot(x, y)).toBeCloseTo(index === 0 ? 3 : 1, 9)
      expect(z).toBeCloseTo(0, 9)
    }
    expect(positions[0]).toEqual(positions.at(-1))
    expect(Math.sign(signedAreaXY(positions))).toBe(index === 0 ? -1 : 1)
  }
})

it('keeps face-oriented winding under a reflected similarity transform in project millimetres', async () => {
  const nativeTransform = [-2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 10, 11, 12, 1]
  for (const [faceIndex, sign] of [
    [2, -1],
    [3, 1],
  ] as const) {
    const result = await listRhinoFaceBorders(sleeve, { faceIndex, nativeTransform })
    const outer = result.curves![0]!
    const polygon = sampleNurbs(outer)
    for (const [x, y, z] of polygon) {
      expect(Math.hypot(x - 10, y - 11)).toBeCloseTo(6, 9)
      expect(z).toBeCloseTo(faceIndex === 2 ? 12 : 16, 9)
    }
    expect(Math.sign(signedAreaXY(polygon))).toBe(sign)
    expect(Math.sign(signedAreaXY(result.faces[0]!.loops[0]!.preview))).toBe(sign)
    expect(Math.sign(signedAreaXY(sampleNurbs(result.curves![1]!)))).toBe(-sign)
  }
})

it('reads face borders in millimetres after importing a centimetre model', async () => {
  const original = rhino.File3dm.fromByteArray(sleeve)
  original.settings().modelUnitSystem = rhino.UnitSystem.Centimeters
  const imported = await readRhino3dm(original.toByteArray())
  expect(imported.units).toBe('centimetres')
  const part = imported.objects[0]!.native!
  const result = await listRhinoFaceBorders(part.bytes, { faceIndex: 3 })
  const [outside, bore] = result.curves!
  for (const [curve, radius] of [
    [outside!, 30],
    [bore!, 10],
  ] as const) {
    for (const [x, y, z] of sampleNurbs(curve)) {
      expect(Math.hypot(x, y)).toBeCloseTo(radius, 8)
      expect(z).toBeCloseTo(20, 8)
    }
  }
})

it('joins all four native box edges into one exact closed NURBS curve', async () => {
  const box = rhino.Brep.createFromBoundingBox(new rhino.BoundingBox([0, 0, 0], [1, 2, 3]))
  const data = archive(box)
  const page = await listRhinoFaceBorders(data)
  expect(page.faces).toHaveLength(6)
  const cap = page.faces.find((face) => face.loops[0]!.preview.every((point) => point[2] === 0))!
  expect(cap).toBeDefined()
  const curve = (await listRhinoFaceBorders(data, { faceIndex: cap.faceIndex })).curves![0]!
  expect(curve.degree).toBe(1)
  expect(curve.controlPoints).toHaveLength(5)
  const lo = curve.knots[0]!
  const hi = curve.knots[curve.controlPoints.length - 1]!
  expect(pointOnNurbs(curve, lo)).toEqual(pointOnNurbs(curve, hi))
  expect(signedAreaXY(sampleNurbs(curve))).toBeCloseTo(-2, 9)
  expect(new Set(curve.controlPoints.map(([x, y, z]) => `${x},${y},${z}`))).toEqual(
    new Set(['0,0,0', '0,2,0', '1,0,0', '1,2,0']),
  )
})

it('refuses singular trims on a sphere and invalid face indices', async () => {
  const sphere = rhino.Brep.createFromSphere(new rhino.Sphere([0, 0, 0], 1))
  const result = await listRhinoFaceBorders(archive(sphere), { faceIndex: 0 })
  expect(result.faces).toEqual([])
  expect(result.reason).toMatch(/edge|seam/i)
  await expect(listRhinoFaceBorders(sleeve, { faceIndex: 4 })).rejects.toThrow(/face/i)
})
