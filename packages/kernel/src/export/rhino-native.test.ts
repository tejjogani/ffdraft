import { applyOps, designFrom, type NodeInput } from '@pave/schema'
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

async function importedSpheres(blockScale = -1, shear = 0) {
  const doc = new rhino.File3dm()
  doc.settings().modelUnitSystem = rhino.UnitSystem.Centimeters
  const sphere = rhino.Brep.createFromSphere(new rhino.Sphere([0, 0, 0], 1))
  const mesh = new rhino.Mesh()
  const vertices = mesh.vertices()
  for (const p of [
    [1, 0, 0],
    [0, 1, 0],
    [-1, 0, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ])
    vertices.add(p[0]!, p[1]!, p[2]!)
  const faces = mesh.faces()
  for (let i = 0; i < 4; i++) {
    faces.addTriFace(i, (i + 1) % 4, 4)
    faces.addTriFace((i + 1) % 4, i, 5)
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
        nativeTransform: native?.transform && [...native.transform],
        rhinoObjectId: native?.objectId,
        rhinoInstancePath: native?.instancePath && [...native.instancePath],
      },
      keepSourcePlacement: true,
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
