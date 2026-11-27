import type { File3dm, InstanceReference, RhinoModule, Transform } from 'rhino3dm'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadRhino3dm } from '../runtime/rhino'
import { readRhino3dm } from './rhino'

let rhino: RhinoModule
beforeAll(async () => {
  rhino = await loadRhino3dm()
})

const knots = [2, 2, 4, 7, 7]

function weightedSpline() {
  const spline = new rhino.NurbsCurve(3, true, 3, 4)
  const points = spline.points()
  // OpenNURBS stores weighted (homogeneous) coordinates.
  points.set(0, [2, 3, 4, 1])
  points.set(1, [1.5, 2, 3.5, 0.5])
  points.set(2, [8, 6, 4, 2])
  points.set(3, [6, 5, 1, 1])
  const knotList = spline.knots()
  for (const [index, knot] of knots.entries()) knotList.set(index, knot)
  return spline
}

function layer(doc: File3dm, name: string, parentLayerId?: string) {
  const entry = new rhino.Layer()
  entry.name = name
  if (parentLayerId) entry.parentLayerId = parentLayerId
  return doc.layers().add(entry)
}

function attributes(name: string, layerIndex: number) {
  const attrs = new rhino.ObjectAttributes()
  attrs.name = name
  attrs.layerIndex = layerIndex
  return attrs
}

describe('Rhino curve import', () => {
  it('imports rational nonplanar curves only when requested and retains authored names and IDs', async () => {
    const doc = new rhino.File3dm()
    doc.settings().modelUnitSystem = rhino.UnitSystem.Centimeters
    const parent = layer(doc, 'Profiles')
    const nested = layer(doc, 'Rails', doc.layers().findIndex(parent).id)
    const id = doc.objects().addCurve(weightedSpline(), attributes('Bent rail', nested))
    const bytes = doc.toByteArray()
    const ordinary = await readRhino3dm(bytes)
    expect(ordinary.skipped).toEqual([
      { name: 'Bent rail', layer: 'Profiles::Rails', reason: 'Rhino curve.' },
    ])
    expect(ordinary.curves).toEqual([])

    const included = await readRhino3dm(bytes, { includeCurves: true })
    expect(included.skipped).toEqual([])
    expect(included.curves).toMatchObject([
      {
        name: 'Bent rail',
        layer: 'Profiles::Rails',
        sourceObjectId: id,
        converted: false,
        degree: 2,
        knots,
        controlPoints: [
          [20, 30, 40, 1],
          [30, 40, 70, 0.5],
          [40, 30, 20, 2],
          [60, 50, 10, 1],
        ],
      },
    ])
    const bounds = included.curves[0]?.bounds
    expect(bounds?.min).toEqual([20, 30, 10])
    expect(bounds?.max[2]).toBeGreaterThan(40)
  })

  it('places block curves in world millimetres without changing knot domains or weights', async () => {
    const doc = new rhino.File3dm()
    doc.settings().modelUnitSystem = rhino.UnitSystem.Centimeters
    const index = layer(doc, 'Rails')
    const definitions = doc.instanceDefinitions()
    const definitionIndex = definitions.add(
      'Custom mount',
      '',
      '',
      '',
      [0, 0, 0],
      [weightedSpline()],
      [attributes('Bent rail', index)],
    )
    const definition = definitions.get(definitionIndex)
    const Ref = rhino.InstanceReference as unknown as new (
      id: string,
      t: Transform,
    ) => InstanceReference
    const placement = rhino.Transform.translationXYZ(2, -3, 1)
    placement.m00 = -1
    doc.objects().addInstanceObject(new Ref(definition.id, placement), attributes('Copy', index))

    const result = await readRhino3dm(doc.toByteArray(), { includeCurves: true })
    expect(result.skipped).toEqual([])
    expect(result.curves).toMatchObject([
      {
        name: 'Bent rail',
        layer: 'Rails',
        degree: 2,
        knots,
        controlPoints: [
          [0, 0, 50, 1],
          [-10, 10, 80, 0.5],
          [-20, 0, 30, 2],
          [-40, 20, 20, 1],
        ],
      },
    ])
  })

  it('reports an actionable omission for a disconnected PolyCurve and keeps other curves', async () => {
    const doc = new rhino.File3dm()
    doc.settings().modelUnitSystem = rhino.UnitSystem.Millimeters
    const index = layer(doc, 'Profiles')
    const poly = new rhino.PolyCurve()
    expect(poly.appendSegment(new rhino.LineCurve([0, 0, 0], [1, 0, 0]))).toBe(true)
    expect(poly.appendSegment(new rhino.LineCurve([3, 0, 0], [4, 0, 0]))).toBe(true)
    doc.objects().addCurve(poly, attributes('Disconnected', index))
    doc.objects().addCurve(weightedSpline(), attributes('Bent rail', index))

    const result = await readRhino3dm(doc.toByteArray(), { includeCurves: true })
    expect(result.curves.map(({ name }) => name)).toEqual(['Bent rail'])
    expect(result.skipped).toEqual([
      {
        name: 'Disconnected',
        layer: 'Profiles',
        reason: expect.stringMatching(/gaps.*segments.*separately/i),
      },
    ])
  })

  it('converts connected mixed PolyCurves to one NURBS curve and preserves their domain', async () => {
    const doc = new rhino.File3dm()
    doc.settings().modelUnitSystem = rhino.UnitSystem.Millimeters
    const poly = new rhino.PolyCurve()
    expect(poly.appendSegment(new rhino.LineCurve([0, 0, 0], [2, 0, 0]))).toBe(true)
    const arc = rhino.Arc.createFromPoints([2, 0, 0], [3, 1, 0], [4, 0, 0])
    expect(poly.appendSegment(rhino.ArcCurve.createFromArc(arc))).toBe(true)
    poly.domain = [6, 21]
    doc.objects().addCurve(poly, attributes('Line and arc', layer(doc, 'Profiles')))
    const result = await readRhino3dm(doc.toByteArray(), { includeCurves: true })
    expect(result.skipped).toEqual([])
    expect(result.curves).toMatchObject([{ name: 'Line and arc', converted: true, degree: 2 }])
    const curve = result.curves[0]!
    expect(curve.knots[curve.degree - 1]).toBe(6)
    expect(curve.knots[curve.controlPoints.length - 1]).toBe(21)
    expect(curve.controlPoints.some((p) => p[3] < 1)).toBe(true)
    expect(curve.bounds.max[1]).toBeCloseTo(1, 8)
  })
})
