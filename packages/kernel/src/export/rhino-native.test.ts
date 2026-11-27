import { applyOps, designFrom, type NodeInput, replaceStone } from '@pave/schema'
import { importSTEP, measureVolume, type Shape3D } from 'replicad'
import type { InstanceReference, Mesh, MeshType, RhinoModule, Transform } from 'rhino3dm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type RhinoMeshObject, readRhino3dm } from '../import/rhino'
import { createKernel } from '../kernel'
import { freeRhino, loadRhino3dm } from '../runtime/rhino'

let rhino: RhinoModule
const kernel = createKernel()
beforeAll(async () => {
  rhino = await loadRhino3dm()
})
afterAll(() => kernel.dispose())

async function importedSpheres(blockScale = -1, shear = 0, denseSeam = false) {
  const doc = new rhino.File3dm()
  doc.settings().modelUnitSystem = rhino.UnitSystem.Centimeters
  const sphere = rhino.Brep.createFromSphere(new rhino.Sphere([0, 0, 0], 1))
  const mesh = new rhino.Mesh()
  const vertices = mesh.vertices()
  const equator: [number, number][] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ]
  if (denseSeam) equator.splice(1, 0, [Math.cos(0.00002), Math.sin(0.00002)])
  for (const [x, y] of equator) vertices.add(x, y, 0)
  vertices.add(0, 0, 1)
  vertices.add(0, 0, -1)
  const faces = mesh.faces()
  for (let i = 0; i < equator.length; i++) {
    faces.addTriFace(i, (i + 1) % equator.length, equator.length)
    faces.addTriFace((i + 1) % equator.length, i, equator.length + 1)
  }
  const face = sphere.faces().get(0)
  const setMesh = face.setMesh as unknown as (mesh: Mesh, type: MeshType) => boolean
  expect(setMesh.call(face, mesh, rhino.MeshType.Render)).toBe(true)
  const attrs = new rhino.ObjectAttributes()
  attrs.name = 'Sphere'
  const objects = doc.objects()
  objects.addBrep(sphere, attrs)

  const definitions = doc.instanceDefinitions()
  const index = definitions.add('Round', '', '', '', [0, 0, 0], [sphere], [attrs])
  const def = definitions.get(index)
  const Ref = rhino.InstanceReference as unknown as new (
    id: string,
    t: Transform,
  ) => InstanceReference
  const matrix = rhino.Transform.identity()
  matrix.m00 = blockScale
  matrix.m01 = shear
  matrix.m03 = 8
  const first = new Ref(def.id, matrix)
  const second = new Ref(def.id, rhino.Transform.translationXYZ(15, 0, 0))
  attrs.name = 'First'
  objects.addInstanceObject(first, attrs)
  attrs.name = 'Second'
  objects.addInstanceObject(second, attrs)

  const { objects: parts } = await readRhino3dm(doc.toByteArray())
  for (const handle of [
    first,
    second,
    matrix,
    def,
    definitions,
    objects,
    attrs,
    face,
    vertices,
    faces,
    mesh,
    sphere,
    doc,
  ])
    freeRhino(handle)
  return parts
}

async function importedBoxes(count = 2) {
  const doc = new rhino.File3dm()
  doc.settings().modelUnitSystem = rhino.UnitSystem.Millimeters
  const parent = new rhino.Layer()
  parent.name = 'Workshop'
  const layers = doc.layers()
  const parentIndex = layers.add(parent)
  const layer = new rhino.Layer()
  layer.name = 'Stock'
  layer.parentLayerId = layers.get(parentIndex).id
  const layerIndex = layers.add(layer)
  const objects = doc.objects()
  for (let i = 0; i < count; i++) {
    const box = rhino.Brep.createFromBoundingBox(
      new rhino.BoundingBox([2 * i, 0, 0], [2 * i + 2, 2, 2]),
    )
    const faces = box.faces()
    const vertices = box.vertices()
    for (let j = 0; j < faces.count; j++) {
      const face = faces.get(j)
      const trims = face.outerLoop().trims
      const display = new rhino.Mesh()
      const points = display.vertices()
      for (let k = 0; k < trims.count; k++) {
        const [x, y, z] = vertices.get(trims.get(k).startVertexIndex).location
        points.add(x!, y!, z!)
      }
      if (face.orientationIsReversed) display.faces().addQuadFace(0, 3, 2, 1)
      else display.faces().addQuadFace(0, 1, 2, 3)
      const cache = face.setMesh as unknown as (mesh: Mesh, type: MeshType) => boolean
      expect(cache.call(face, display, rhino.MeshType.Render)).toBe(true)
    }
    const attrs = new rhino.ObjectAttributes()
    attrs.name = `Stock ${i + 1}`
    attrs.layerIndex = layerIndex
    objects.addBrep(box, attrs)
  }
  const result = await readRhino3dm(doc.toByteArray())
  expect(result.skipped).toEqual([])
  expect(result.objects.every((o) => o.native)).toBe(true)
  return result.objects
}

function fixture(parts: readonly RhinoMeshObject[]) {
  const data = new Map<string, Uint8Array>()
  const nodes = parts.map((part, i): NodeInput => {
    const assetId = `mesh-${i}`
    const nativeAssetId = `native-${i}`
    const native = part.native
    data.set(assetId, part.bytes)
    if (native) data.set(nativeAssetId, native.bytes)
    return {
      id: `part-${i}`,
      name: part.name,
      kind: 'meshBody',
      source: {
        type: 'asset',
        assetId,
        nativeAssetId,
        nativeMeshAssetId: assetId,
        rhinoLayer: part.layer ?? undefined,
        nativeTransform: native?.transform && [...native.transform],
        rhinoObjectId: native?.objectId,
        rhinoInstancePath: native?.instancePath && [...native.instancePath],
      },
      keepSourcePlacement: true,
      importRole: 'metal',
    }
  })
  const assets = async (id: string) => {
    const bytes = data.get(id)
    if (!bytes) throw new Error('Asset unavailable')
    return bytes
  }
  return { design: designFrom('other', nodes), assets, data }
}

function readRhinoExport(bytes: Uint8Array) {
  const doc = rhino.File3dm.fromByteArray(bytes)
  const objects = doc.objects()
  try {
    return Array.from({ length: objects.count }, (_, i) => {
      const object = objects.get(i)
      const geometry = object.geometry()
      const attributes = object.attributes()
      const box = geometry.getBoundingBox(true)
      try {
        const native = geometry instanceof rhino.Brep
        let trims = 0
        let min = box.min
        let max = box.max
        if (native) {
          const faces = geometry.faces()
          const face = faces.get(0)
          const loop = face.outerLoop()
          trims = loop.trimCount
          const [u0, u1] = face.domain(0) as [number, number]
          const [v0, v1] = face.domain(1) as [number, number]
          const samples = Array.from({ length: 9 }, (_, u) =>
            Array.from({ length: 9 }, (_, v) =>
              face.pointAt(u0 + ((u1 - u0) * u) / 8, v0 + ((v1 - v0) * v) / 8),
            ),
          ).flat()
          // A nonuniform transform can turn the sphere into a rational spline. Its fast
          // bounding box follows the control hull, so sample the exported surface itself.
          min = box.min.map((_, i) => Math.min(...samples.map((p) => p[i]!)))
          max = box.max.map((_, i) => Math.max(...samples.map((p) => p[i]!)))
          for (const handle of [loop, face, faces]) freeRhino(handle)
        }
        return {
          native,
          valid: geometry.isValid,
          trims,
          min,
          max,
          guid: attributes.id,
          rhinoId: attributes.getUserString('rhinoObjectId'),
          instancePath: attributes.getUserString('rhinoInstancePath'),
          nodeIds: attributes.getUserString('nodeIds'),
          volume: Number(attributes.getUserString('volumeMm3')),
        }
      } finally {
        for (const handle of [box, geometry, attributes, object]) freeRhino(handle)
      }
    })
  } finally {
    freeRhino(objects)
    freeRhino(doc)
  }
}

describe('native Rhino solid export', () => {
  it('keeps touching same-alloy imports and their Rhino layers separate from generated metal', async () => {
    const parts = await importedBoxes()
    const { design, assets } = fixture(parts)
    const model = applyOps(design, [
      {
        t: 'add',
        node: {
          kind: 'primitive',
          id: 'authored',
          shape: 'box',
          size: [2, 2, 2],
          transform: { position: [4, 0, 0] },
        },
      },
      {
        t: 'add',
        node: {
          kind: 'nurbsCurve',
          id: 'profile',
          degree: 2,
          knots: [0, 0, 1, 1],
          controlPoints: [
            [1, 0, 0, 1],
            [1, 1, 0, Math.SQRT1_2],
            [0, 1, 0, 1],
          ],
        },
      },
    ]).design
    const production = await kernel.evaluate(model, { detail: 'production', assets })
    expect(production.parts).toHaveLength(1)
    const casting = await kernel.export(model, 'stl', { assets })
    const exported = await kernel.export(model, '3dm', { assets, stones: false })
    expect(exported.notes[0]).toMatch(
      /2 native Rhino solids.*1 evaluated mesh body.*1 editable NURBS curve/,
    )
    const readback = await readRhino3dm(exported.bytes, { includeCurves: true })
    expect(
      readback.objects.filter((o) => o.native).map((o) => [o.name, o.layer, o.bounds]),
    ).toEqual(parts.map((o) => [o.name, o.layer, o.bounds]))
    expect(readback.objects.filter((o) => !o.native)).toHaveLength(1)
    expect(readback.curves[0]?.controlPoints[1]?.[3]).toBeCloseTo(Math.SQRT1_2, 12)
    const scoped = await kernel.export(model, '3dm', { assets, only: ['part-1'] })
    expect(readRhinoExport(scoped.bytes)).toMatchObject([{ nodeIds: 'part-1', native: true }])
    expect((await kernel.evaluate(model, { detail: 'production', assets })).parts).toEqual(
      production.parts,
    )
    expect((await kernel.export(model, 'stl', { assets })).bytes).toEqual(casting.bytes)
  })

  it('exports only the surviving imported body and a separate result of a Boolean on its neighbour', async () => {
    const { design, assets } = fixture(await importedBoxes())
    const model = applyOps(design, [
      {
        t: 'add',
        node: {
          kind: 'primitive',
          id: 'tool',
          shape: 'box',
          size: [1, 1, 3],
          transform: { position: [1, 1, 0] },
        },
      },
      {
        t: 'add',
        node: { kind: 'boolean', id: 'cut', op: 'subtract', target: 'part-0', tools: ['tool'] },
      },
    ]).design
    const exported = await kernel.export(model, '3dm', { assets, stones: false })
    const objects = readRhinoExport(exported.bytes)
    expect(objects.find((o) => o.nodeIds === 'part-1')).toMatchObject({ native: true })
    expect(objects.find((o) => o.nodeIds === 'cut')).toMatchObject({ native: false })
    expect(objects).toHaveLength(2)
  })

  it('keeps a production engraving on one import without withholding its untouched neighbour', async () => {
    const { design, assets } = fixture(await importedBoxes())
    const model = applyOps(design, [
      {
        t: 'add',
        node: {
          id: 'engraved',
          kind: 'engraving',
          host: 'part-0',
          where: 'front',
          text: 'H',
          size: 0.8,
          depth: 0.3,
        },
      },
    ]).design
    const exported = await kernel.export(model, '3dm', { assets, stones: false })
    const objects = readRhinoExport(exported.bytes)
    expect(objects).toHaveLength(2)
    const cut = objects.find((o) => o.nodeIds === 'part-0')
    expect(cut?.native).toBe(false)
    expect(cut!.volume).toBeLessThan(8)
    expect(objects.find((o) => o.nodeIds === 'part-1')).toMatchObject({ native: true, volume: 8 })
  })

  it('maintains cross-alloy seating priority when a distant body leaves an alloy group', async () => {
    const { design, assets } = fixture(await importedBoxes())
    const model = applyOps(design, [
      { t: 'update', id: 'part-1', patch: { transform: { position: [20, 0, 0] } } },
      {
        t: 'add',
        node: {
          id: 'inset',
          kind: 'primitive',
          shape: 'box',
          size: [3, 2, 2],
          material: 'au18k-white',
          transform: { position: [0, 1, 1] },
        },
      },
    ]).design
    const exported = await kernel.export(model, '3dm', { assets, only: ['part-0'] })
    expect(readRhinoExport(exported.bytes)).toMatchObject([
      { nodeIds: 'part-0', native: false, min: [1.5, 0, 0], volume: 2 },
    ])
  })

  it('falls back separately for stale and unavailable native sources touching an untouched import', async () => {
    const { design, assets, data } = fixture(await importedBoxes(3))
    data.delete('native-1')
    const source = design.nodes['part-2']
    if (source?.kind !== 'meshBody' || source.source.type !== 'asset')
      throw Error('Fixture is missing its mesh')
    const model = applyOps(design, [
      {
        t: 'update',
        id: 'part-2',
        patch: { source: { ...source.source, nativeMeshAssetId: 'stale' } },
      },
    ]).design
    const exported = await kernel.export(model, '3dm', { assets, stones: false })
    expect(exported.notes[0]).toMatch(/1 native Rhino solid.*2 evaluated mesh bodies/)
    expect(
      readRhinoExport(exported.bytes).sort((a, b) => a.nodeIds.localeCompare(b.nodeIds)),
    ).toMatchObject([
      { nodeIds: 'part-0', native: true },
      { nodeIds: 'part-1', native: false },
      { nodeIds: 'part-2', native: false },
    ])
    expect(exported.notes.some((note) => /Stock 2.*source archive/.test(note))).toBe(true)
  })

  it('retains the original BRep when casting cleanup collapses a short cache edge', async () => {
    const { design, assets } = fixture((await importedSpheres(-1, 0, true)).slice(0, 1))
    const native = await kernel.export(design, '3dm', { assets, stones: false })
    expect(readRhinoExport(native.bytes)).toMatchObject([{ nodeIds: 'part-0', native: true }])
  })

  it('keeps the mesh where production removes metal for another alloy', async () => {
    const { design, assets } = fixture((await importedSpheres(-1, 0, true)).slice(0, 1))
    const assembled = applyOps(design, [
      {
        t: 'add',
        node: {
          id: 'inset',
          kind: 'primitive',
          shape: 'box',
          size: [4, 4, 8],
          material: 'au18k-white',
          transform: { position: [6, 0, 0] },
        },
      },
    ]).design
    const exported = await kernel.export(assembled, '3dm', {
      assets,
      stones: false,
      only: ['part-0'],
    })
    expect(readRhinoExport(exported.bytes)).toMatchObject([{ nodeIds: 'part-0', native: false }])
  })

  it('writes real trimmed BReps with mm conversion, block identity and current placement', async () => {
    const parts = await importedSpheres()
    expect(parts[1]!.native?.bytes).toBe(parts[2]!.native?.bytes)
    const { design, assets } = fixture(parts)
    const changed = applyOps(design, [
      {
        t: 'update',
        id: 'part-1',
        patch: { transform: { position: [4, 3, 7], rotation: [0, 0, 90], scale: 2 } },
      },
      {
        t: 'add',
        node: {
          id: 'authored',
          kind: 'primitive',
          shape: 'box',
          size: [2, 2, 2],
          transform: { position: [190, 0, 0] },
        },
      },
    ]).design
    const { bytes } = await kernel.export(changed, '3dm', { assets, stones: false })
    const objects = readRhinoExport(bytes)
    expect(objects).toHaveLength(4)
    expect(new Set(objects.map((o) => o.guid)).size).toBe(4)
    const direct = objects.find((o) => o.nodeIds === 'part-0')
    expect(direct).toMatchObject({
      native: true,
      valid: true,
      min: [-10, -10, -10],
      max: [10, 10, 10],
      rhinoId: parts[0]!.native!.objectId,
    })
    expect(direct!.trims).toBeGreaterThan(0)
    const block = objects.find((o) => o.nodeIds === 'part-1')
    expect(block).toMatchObject({
      native: true,
      valid: true,
      rhinoId: parts[1]!.native!.objectId,
      instancePath: JSON.stringify(parts[1]!.native!.instancePath),
    })
    // Placed centre [80, 0, 0], multiplied by 2, rotated 90° about Z, then translated.
    expect(block!.min[2]).toBeCloseTo(-13)
    expect(block!.max[2]).toBeCloseTo(27)
    expect(block!.min[1]).toBeCloseTo(143)
    expect(block!.max[1]).toBeCloseTo(183)
    expect(objects.find((o) => o.nodeIds === 'part-2')).toMatchObject({ native: true })
    expect(objects.find((o) => o.nodeIds === 'authored')).toMatchObject({ native: false })

    const scoped = await kernel.export(changed, '3dm', { assets, stones: false, only: ['part-1'] })
    expect(readRhinoExport(scoped.bytes)).toMatchObject([{ nodeIds: 'part-1', native: true }])
  })

  it('keeps an exact affine instance when baking its analytic surface would distort it', async () => {
    const parts = await importedSpheres(-2, 0.25)
    const { design, assets } = fixture(parts)
    const { bytes } = await kernel.export(design, '3dm', { assets, only: ['part-1'] })
    const doc = rhino.File3dm.fromByteArray(bytes)
    const table = doc.objects()
    const defs = doc.instanceDefinitions()
    expect(table.count).toBe(2)
    expect(defs.count).toBe(1)
    const objects = [table.get(0), table.get(1)]
    const [placed, leaf] = objects
      .map((object) => object.geometry())
      .sort(
        (a, b) =>
          Number(b instanceof rhino.InstanceReference) -
          Number(a instanceof rhino.InstanceReference),
      )
    expect(placed).toBeInstanceOf(rhino.InstanceReference)
    expect(leaf).toBeInstanceOf(rhino.Brep)
    const definition = defs.findId((placed as InstanceReference).parentIdefId)
    expect(definition.getObjectIds()).toHaveLength(1)
    const transform = (placed as InstanceReference).xform
    expect([transform.m00, transform.m01, transform.m11, transform.m22, transform.m03]).toEqual([
      -2, 0.25, 1, 1, 80,
    ])
    const box = leaf!.getBoundingBox(true)
    expect(box.min).toEqual([-10, -10, -10])
    expect(box.max).toEqual([10, 10, 10])
    for (const obj of [box, transform, definition, leaf!, placed!, ...objects, defs, table, doc])
      freeRhino(obj)
  })

  it('exports evaluated meshes after changes and restores the native BRep on undo', async () => {
    const { design, assets } = fixture((await importedSpheres()).slice(0, 1))
    const edited = applyOps(design, [{ t: 'update', id: 'part-0', patch: { flatBack: 0.2 } }])
    const types = async (d: typeof design) =>
      readRhinoExport((await kernel.export(d, '3dm', { assets })).bytes)
    expect(await types(edited.design)).toMatchObject([{ native: false }])
    expect(await types(applyOps(edited.design, edited.inverse).design)).toMatchObject([
      { native: true },
    ])

    const consumed = applyOps(design, [
      {
        t: 'add',
        node: {
          id: 'tool',
          kind: 'primitive',
          shape: 'box',
          size: [6, 20, 20],
          transform: { position: [7, 0, 0] },
        },
      },
      {
        t: 'add',
        node: { id: 'cut', kind: 'boolean', op: 'subtract', target: 'part-0', tools: ['tool'] },
      },
    ]).design
    expect(await types(consumed)).toMatchObject([{ native: false, nodeIds: 'cut' }])
  })

  it('omits hidden parts and falls back to the mesh when the source archive is missing', async () => {
    const { design, assets, data } = fixture(await importedSpheres())
    data.delete('native-0')
    const hidden = applyOps(design, [
      { t: 'update', id: 'part-2', patch: { visible: false } },
    ]).design
    const result = await kernel.export(hidden, '3dm', { assets, stones: false })
    expect(
      readRhinoExport(result.bytes).sort((a, b) => a.nodeIds.localeCompare(b.nodeIds)),
    ).toMatchObject([
      { nodeIds: 'part-0', native: false },
      { nodeIds: 'part-1', native: true },
    ])
    expect(result.notes.some((n) => n.includes('source archive'))).toBe(true)
  })
})

describe('Rhino import roles', () => {
  it('keeps source and reference geometry out of both reports and casting, while preserving BReps in 3dm', async () => {
    const { design, assets } = fixture(await importedBoxes(3))
    const classified = applyOps(design, [
      { t: 'update', id: 'part-0', patch: { importRole: null } },
      { t: 'update', id: 'part-1', patch: { importRole: 'reference' } },
      { t: 'update', id: 'part-2', patch: { importRole: 'metal' } },
    ]).design
    const draft = await kernel.evaluate(classified, { assets })
    expect(draft.referenceParts?.map((p) => [p.nodeId, p.importRole])).toEqual([
      ['part-0', 'unassigned'],
      ['part-1', 'reference'],
    ])
    expect(draft.parts.map((p) => p.nodeId)).toEqual(['part-2'])
    expect(draft.report.metals).toMatchObject([{ volumeMm3: 8 }])
    expect(draft.report.bounds.min[0]).toBe(4)
    const production = await kernel.evaluate(classified, { assets, detail: 'production' })
    expect(production.report.metals).toMatchObject([{ volumeMm3: 8 }])
    expect(production.parts).toHaveLength(1)
    const cast = await kernel.export(classified, 'stl', { assets })
    const castMetal = await kernel.export(classified, 'stl', { assets, only: ['part-2'] })
    expect(cast.bytes).toEqual(castMetal.bytes)
    const archive = await kernel.export(classified, '3dm', { assets })
    expect(
      readRhinoExport(archive.bytes)
        .map((o) => [o.nodeIds, o.native])
        .sort(),
    ).toEqual([
      ['part-0', true],
      ['part-1', true],
      ['part-2', true],
    ])
  })

  it('keeps an unassigned source out of grouped and patterned metal', async () => {
    const { design, assets } = fixture(await importedBoxes())
    const model = applyOps(design, [
      { t: 'update', id: 'part-0', patch: { importRole: 'unassigned' } },
      { t: 'add', node: { kind: 'group', id: 'group', children: ['part-0', 'part-1'] } },
      { t: 'add', node: { kind: 'pattern', id: 'copies', sources: ['part-0'] } },
    ]).design
    const evaluation = await kernel.evaluate(model, { assets, detail: 'production' })
    expect(evaluation.report.metals).toHaveLength(1)
    expect(evaluation.report.metals[0]?.volumeMm3).toBeCloseTo(8, 10)
    expect(evaluation.referenceParts?.map((p) => p.nodeId)).toEqual(['part-0'])
    expect(evaluation.diagnostics).toContainEqual(
      expect.objectContaining({
        nodeId: 'copies',
        code: 'feature.blocked',
      }),
    )
  })

  it('preserves a confirmed source gem and head and uses the measured stone to refit only its head', async () => {
    const { design, assets } = fixture(await importedBoxes())
    const transform = { position: [1, 1, 1.2] as [number, number, number] }
    const model = applyOps(design, [
      { t: 'update', id: 'part-0', patch: { importRole: 'stone' } },
      { t: 'update', id: 'part-1', patch: { importRole: 'setting' } },
      {
        t: 'add',
        node: {
          id: 'gem',
          kind: 'gem',
          importSourceId: 'part-0',
          importSourceFit: { cut: 'round', width: 2, length: 2, depth: 2, transform },
          width: 2,
          transform,
        },
      },
      {
        t: 'add',
        node: {
          id: 'head',
          kind: 'setting',
          gem: 'gem',
          importSourceId: 'part-1',
          style: 'bezel',
        },
      },
      {
        t: 'add',
        node: {
          id: 'neighbor',
          kind: 'primitive',
          shape: 'box',
          size: [0.3, 0.3, 0.3],
          transform: { position: [1.8, 1, 0.65] },
        },
      },
    ]).design
    const draft = await kernel.evaluate(model, { assets })
    expect(draft.parts.map((p) => p.nodeId)).toEqual(['head', 'neighbor'])
    expect(draft.parts[0]?.bounds).toEqual({ min: [2, 0, 0], max: [4, 2, 2] })
    expect(draft.report.stoneCount).toBe(1)
    expect(draft.stones[0]?.dims).toEqual({ length: 2, width: 2, depth: 2 })
    const original = await kernel.export(model, '3dm', { assets, only: ['gem', 'head'] })
    const native = (await readRhino3dm(original.bytes)).objects.filter((o) => o.native)
    expect(native.map((o) => o.bounds)).toEqual(
      expect.arrayContaining([
        { min: [0, 0, 0], max: [2, 2, 2] },
        { min: [2, 0, 0], max: [4, 2, 2] },
      ]),
    )
    expect(native).toHaveLength(2)

    const meshOnly = applyOps(model, [
      { t: 'update', id: 'part-0', patch: { source: { nativeMeshAssetId: null } } },
      { t: 'update', id: 'part-1', patch: { source: { nativeMeshAssetId: null } } },
    ]).design
    const meshArchive = await kernel.export(meshOnly, '3dm', { assets, only: ['gem', 'head'] })
    const meshObjects = (await readRhino3dm(meshArchive.bytes)).objects
    expect(meshObjects.map((o) => [o.name, o.layer]).sort()).toEqual([
      ['Stock 1', 'Workshop::Stock'],
      ['Stock 2', 'Workshop::Stock'],
    ])
    expect(meshObjects.every((o) => !o.native)).toBe(true)

    const moved = applyOps(model, [
      { t: 'update', id: 'gem', patch: { transform: { position: [7, 1, 1.2] } } },
    ]).design
    const movedArchive = await kernel.export(moved, '3dm', { assets, only: ['gem', 'head'] })
    const movedNative = (await readRhino3dm(movedArchive.bytes)).objects
      .filter((o) => o.native)
      .map((o) => o.bounds)
    expect(movedNative).toEqual(
      expect.arrayContaining([
        { min: [6, 0, 0], max: [8, 2, 2] },
        { min: [8, 0, 0], max: [10, 2, 2] },
      ]),
    )

    const change = replaceStone(
      model,
      { nodeId: 'gem' },
      {
        fit: {
          provider: 'lab',
          sku: 'new-round',
          measured: { length: 3.1, width: 2.9, depth: 2.2 },
          listedCarat: 0.41,
        },
      },
    )
    const refit = applyOps(model, change.ops).design
    const updated = await kernel.evaluate(refit, { assets })
    expect(updated.parts[0]?.bounds).not.toEqual(draft.parts[0]?.bounds)
    expect(updated.stones[0]?.dims).toEqual({ length: 3.1, width: 2.9, depth: 2.2 })
    expect(updated.report.caratTotal).toBe(0.41)
    const metal = await kernel.export(refit, '3dm', { assets, only: ['neighbor'] })
    expect(readRhinoExport(metal.bytes)).toMatchObject([{ nodeIds: 'neighbor', volume: 0.03 }])
    const exact = await kernel.export(refit, 'step', { assets, only: ['neighbor'] })
    const solid = (await importSTEP(new Blob([exact.bytes.slice()]))) as Shape3D
    try {
      expect(measureVolume(solid)).toBeCloseTo(0.027, 8)
    } finally {
      solid.delete()
    }

    const copied = applyOps(refit, [
      { t: 'add', node: { id: 'group', kind: 'group', children: ['gem', 'head'] } },
    ]).design
    const copiedMetal = await kernel.export(copied, '3dm', { assets, only: ['neighbor'] })
    expect(readRhinoExport(copiedMetal.bytes)).toMatchObject([
      { nodeIds: 'neighbor', volume: 0.03 },
    ])
  })

  it('keeps the original geometry when a replacement is hidden or absent', async () => {
    const { design, assets } = fixture(await importedBoxes(1))
    const hidden = applyOps(design, [
      { t: 'update', id: 'part-0', patch: { importRole: 'stone' } },
      {
        t: 'add',
        node: { id: 'gem', kind: 'gem', importSourceId: 'part-0', visible: false },
      },
    ]).design
    const removed = applyOps(hidden, [{ t: 'remove', id: 'gem' }]).design
    for (const model of [hidden, removed]) {
      const draft = await kernel.evaluate(model, { assets })
      expect(draft.parts).toEqual([])
      expect(draft.referenceParts?.map((p) => p.nodeId)).toEqual(['part-0'])
      expect(draft.report.metals).toEqual([])
      expect(draft.report.stoneCount).toBe(0)
      const archive = await kernel.export(model, '3dm', { assets })
      expect(readRhinoExport(archive.bytes)).toMatchObject([{ nodeIds: 'part-0', native: true }])
    }
  })
})
