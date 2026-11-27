import { designFrom, type NodeInputOf } from '@pave/schema'
import type { RhinoModule } from 'rhino3dm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readRhino3dm } from '../import/rhino'
import { createKernel } from '../kernel'
import { loadRhino3dm } from '../runtime/rhino'

const kernel = createKernel()
afterAll(() => kernel.dispose())

let rhino: RhinoModule
beforeAll(async () => {
  rhino = await loadRhino3dm()
})

const sourceObjectId = 'e5366f22-96ac-4673-a64d-572a2819dd8d'
const rail: NodeInputOf<'nurbsCurve'> = {
  id: 'rail',
  kind: 'nurbsCurve',
  name: 'Swept shoulder',
  degree: 2,
  knots: [2, 2, 6, 6],
  controlPoints: [
    [2, 0, 1, 1],
    [2, 2, 6, 0.5],
    [0, 2, 3, 1],
  ],
  rhinoLayer: 'Profiles::Rails',
  sourceObjectId,
}

describe('Rhino curve export', () => {
  it('exports curves-only documents as exact Rhino NURBS and restores their imported provenance', async () => {
    const design = designFrom('other', [rail])
    const { bytes } = await kernel.export(design, '3dm')
    const doc = rhino.File3dm.fromByteArray(bytes)
    expect(doc.settings().modelUnitSystem).toBe(rhino.UnitSystem.Millimeters)
    const table = doc.objects()
    expect(table.count).toBe(1)
    const obj = table.get(0)
    const curve = obj.geometry()
    expect(curve).toBeInstanceOf(rhino.NurbsCurve)
    if (!(curve instanceof rhino.NurbsCurve)) throw new Error('Expected exact Rhino NURBS')
    expect(curve.degree).toBe(2)
    expect(curve.domain).toEqual([2, 6])
    expect(curve.knots().toList()).toEqual([2, 2, 6, 6])
    expect(curve.points().get(1)).toEqual([1, 1, 3, 0.5])
    const position = curve.pointAt(4)
    for (const [axis, expected] of [4 / 3, 4 / 3, 10 / 3].entries())
      expect(position[axis]).toBeCloseTo(expected, 12)
    expect(obj.attributes().name).toBe('Swept shoulder')
    expect(doc.layers().findIndex(obj.attributes().layerIndex).fullPath).toBe('Profiles::Rails')
    expect(obj.attributes().getUserString('paveSourceObjectId')).toBe(sourceObjectId)

    const reopened = await readRhino3dm(bytes, { includeCurves: true })
    expect(reopened.skipped).toEqual([])
    expect(reopened.curves).toMatchObject([
      {
        name: rail.name,
        layer: rail.rhinoLayer,
        sourceObjectId,
        controlPoints: rail.controlPoints,
        knots: rail.knots,
        converted: false,
      },
    ])
  })

  it('includes only visible and selected curves', async () => {
    const next = { ...rail, id: 'next', name: 'Other rail' }
    const hidden = { ...rail, id: 'hidden', name: 'Hidden rail', visible: false }
    const design = designFrom('other', [rail, next, hidden])
    const ordinary = await kernel.export(design, '3dm')
    const selected = await kernel.export(design, '3dm', { only: ['next', 'hidden'] })
    const labels = async (bytes: Uint8Array) =>
      (await readRhino3dm(bytes, { includeCurves: true })).curves.map(({ name }) => name)
    await expect(labels(ordinary.bytes)).resolves.toEqual(['Swept shoulder', 'Other rail'])
    await expect(labels(selected.bytes)).resolves.toEqual(['Other rail'])
  })
})
