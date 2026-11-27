import type {
  BrepFace,
  File3dm,
  InstanceReference,
  Mesh,
  MeshType,
  RhinoModule,
  Transform,
  UnitSystem,
} from 'rhino3dm'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseMesh } from '../mesh/parse/index'
import { loadRhino3dm } from '../runtime/rhino'
import { MAX_RHINO_FILE_BYTES, readRhino3dm } from './rhino'

let rhino: RhinoModule
beforeAll(async () => {
  rhino = await loadRhino3dm()
})

function writeFile(make: (doc: File3dm) => void, units: UnitSystem = rhino.UnitSystem.Millimeters) {
  const doc = new rhino.File3dm()
  doc.settings().modelUnitSystem = units
  make(doc)
  return doc.toByteArray()
}

function quad(x = 0, z = 0) {
  const mesh = new rhino.Mesh()
  const vertices = mesh.vertices()
  vertices.add(x, -1, z)
  vertices.add(x + 1, -1, z)
  vertices.add(x + 1, 1, z)
  vertices.add(x, 1, z)
  mesh.faces().addQuadFace(0, 1, 2, 3)
  return mesh
}

function named(name: string, layerIndex = 0) {
  const attrs = new rhino.ObjectAttributes()
  attrs.name = name
  attrs.layerIndex = layerIndex
  return attrs
}

function blockReference(id: string, xform: Transform) {
  // The binding's (definition id, transform) constructor is missing from its .d.ts.
  const BlockReference = rhino.InstanceReference as unknown as new (
    id: string,
    xform: Transform,
  ) => InstanceReference
  return new BlockReference(id, xform)
}

describe('readRhino3dm', () => {
  it('keeps independent Rhino objects, nested layer names, and their shared origin in millimetres', async () => {
    const bytes = writeFile((doc) => {
      const layers = doc.layers()
      const parent = new rhino.Layer()
      parent.name = 'Jewellery'
      const parentIndex = layers.add(parent)
      const child = new rhino.Layer()
      child.name = 'Settings'
      child.parentLayerId = layers.findIndex(parentIndex).id
      const childIndex = layers.add(child)
      doc.objects().addMesh(quad(-2, 2), named('Head', childIndex))
      doc.objects().addMesh(quad(3, -3), named('', parentIndex))
    }, rhino.UnitSystem.Inches)

    const result = await readRhino3dm(bytes)
    expect(result).toMatchObject({
      units: 'inches',
      skipped: [],
      objects: [
        { name: 'Head', layer: 'Jewellery::Settings' },
        { name: 'Part 1 (Jewellery)', layer: 'Jewellery' },
      ],
    })
    const [head, band] = result.objects
    expect(head!.bounds.min[0]).toBeCloseTo(-50.8)
    expect(head!.bounds.max[2]).toBeCloseTo(50.8)
    expect(band!.bounds.min[0] - head!.bounds.min[0]).toBeCloseTo(127)
    const headSTL = parseMesh(head!.bytes)
    expect(headSTL.format).toBe('stl')
    expect(headSTL.mesh.indices).toHaveLength(6)
    expect(Math.min(...headSTL.mesh.positions.filter((_, i) => i % 3 === 0))).toBeCloseTo(-50.8)
    expect(Math.max(...headSTL.mesh.positions.filter((_, i) => i % 3 === 1))).toBeCloseTo(25.4)
    expect(
      Math.min(...parseMesh(band!.bytes).mesh.positions.filter((_, i) => i % 3 === 2)),
    ).toBeCloseTo(-76.2)
  })

  it('assigns stable per-layer labels to unnamed parts on every open', async () => {
    const bytes = writeFile((doc) => {
      const layers = doc.layers()
      const parent = new rhino.Layer()
      parent.name = 'Components'
      const parentIndex = layers.add(parent)
      const child = new rhino.Layer()
      child.name = 'Mounts'
      child.parentLayerId = layers.findIndex(parentIndex).id
      const childIndex = layers.add(child)
      const objects = doc.objects()
      objects.addMesh(quad(), named('', childIndex))
      objects.addMesh(quad(3), named('Centre', childIndex))
      objects.addPoint([4, 0, 0], named('', childIndex))
      objects.addMesh(quad(6), named('', childIndex))
      objects.addMesh(quad(9), named('', parentIndex))
    })
    const readLabels = async () => {
      const result = await readRhino3dm(bytes)
      return result.objects.map(({ name, layer }) => ({ name, layer }))
    }
    const labels = await readLabels()
    expect(labels).toEqual([
      { name: 'Part 1 (Mounts)', layer: 'Components::Mounts' },
      { name: 'Centre', layer: 'Components::Mounts' },
      { name: 'Part 2 (Mounts)', layer: 'Components::Mounts' },
      { name: 'Part 1 (Components)', layer: 'Components' },
    ])
    await expect(readLabels()).resolves.toEqual(labels)
  })

  it('reads BReps with saved render meshes and reports only complete objects', async () => {
    let sourceId: string
    let instanceId: string
    const bytes = writeFile((doc) => {
      const sphere = rhino.Brep.createFromSphere(new rhino.Sphere([0, 0, 0], 1))
      const mesh = new rhino.Mesh()
      const vertices = mesh.vertices()
      vertices.add(1, 0, 0)
      vertices.add(0, 1, 0)
      vertices.add(-1, 0, 0)
      vertices.add(0, -1, 0)
      vertices.add(0, 0, 1)
      vertices.add(0, 0, -1)
      const faces = mesh.faces()
      for (let i = 0; i < 4; i++) {
        faces.addTriFace(i, (i + 1) % 4, 4)
        faces.addTriFace((i + 1) % 4, i, 5)
      }
      const partialBox = rhino.Brep.createFromBoundingBox(
        new rhino.BoundingBox([0, 0, 0], [1, 1, 1]),
      )
      // rhino3dm's current JS binding takes (mesh, type), in contrast to its .d.ts signature.
      const cache = (face: BrepFace, mesh: Mesh) =>
        (face.setMesh as unknown as (mesh: Mesh, type: MeshType) => boolean)(
          mesh,
          rhino.MeshType.Render,
        )
      expect(cache(sphere.faces().get(0), mesh)).toBe(true)
      expect(cache(partialBox.faces().get(0), quad())).toBe(true)
      sourceId = doc.objects().addBrep(sphere, named('Cached sphere'))
      doc.objects().addBrep(partialBox, named('Incomplete box'))
      const definitions = doc.instanceDefinitions()
      const id = definitions.add('Sphere', '', '', '', [0, 0, 0], [sphere], [named('Cache')])
      instanceId = doc
        .objects()
        .addInstanceObject(
          blockReference(definitions.get(id).id, rhino.Transform.translationXYZ(5, 0, 0)),
          named('Cached copy'),
        )
      doc.objects().addPolyline(
        [
          [0, 0, 0],
          [5, 0, 0],
        ],
        named('Construction'),
      )
    })

    const result = await readRhino3dm(bytes)
    expect(result.objects.map(({ name, bounds }) => ({ name, bounds }))).toEqual([
      { name: 'Cached sphere', bounds: { min: [-1, -1, -1], max: [1, 1, 1] } },
      { name: 'Cached copy / Cache', bounds: { min: [4, -1, -1], max: [6, 1, 1] } },
    ])
    for (const { bytes } of result.objects) {
      expect(parseMesh(bytes).mesh.indices).toHaveLength(24)
    }
    expect(result.objects[0]!.native).toMatchObject({ objectId: sourceId!, instancePath: [] })
    expect(result.objects[1]!.native).toMatchObject({
      instancePath: [instanceId!],
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1],
    })
    for (const part of result.objects) {
      const native = rhino.File3dm.fromByteArray(part.native!.bytes)
      expect(native.objects().count).toBe(1)
      expect(native.instanceDefinitions().count).toBe(0)
      expect(native.settings().modelUnitSystem).toBe(rhino.UnitSystem.Millimeters)
      const geom = native.objects().get(0).geometry()
      expect(geom).toBeInstanceOf(rhino.Brep)
      expect(geom.getBoundingBox(true).min).toEqual([-1, -1, -1])
    }
    expect(result.skipped).toMatchObject([
      { name: 'Incomplete box', reason: expect.stringMatching(/render mesh.*Mesh/) },
      { name: 'Construction', reason: expect.stringMatching(/curve/i) },
    ])
  })

  it('excludes hidden objects and objects on hidden parent layers from the import', async () => {
    const bytes = writeFile((doc) => {
      const layers = doc.layers()
      const parent = new rhino.Layer()
      parent.name = 'Hidden container'
      parent.visible = false
      const parentIndex = layers.add(parent)
      const child = new rhino.Layer()
      child.name = 'Hidden with parent'
      child.parentLayerId = layers.findIndex(parentIndex).id
      const childIndex = layers.add(child)
      const visible = new rhino.Layer()
      visible.name = 'Visible parts'
      const visibleIndex = layers.add(visible)
      const hiddenObject = named('Hidden object', visibleIndex)
      hiddenObject.mode = rhino.ObjectMode.Hidden
      const objects = doc.objects()
      objects.addMesh(quad(), hiddenObject)
      objects.addMesh(quad(3), named('Hidden layer member', childIndex))
      objects.addMesh(quad(6), named('Visible part', visibleIndex))
    })
    const result = await readRhino3dm(bytes)
    expect(result.objects.map((object) => object.name)).toEqual(['Visible part'])
  })

  it('imports a Rhino block at the instance placement and excludes its definition geometry', async () => {
    const bytes = writeFile((doc) => {
      const definitions = doc.instanceDefinitions()
      const index = definitions.add('Mount', '', '', '', [0, 0, 0], [quad()], [named('Definition')])
      expect(index).toBeGreaterThanOrEqual(0)
      const ref = blockReference(
        definitions.get(index).id,
        rhino.Transform.translationXYZ(100, 0, 0),
      )
      doc.objects().addInstanceObject(ref, named('Mount copy'))
      doc.objects().addMesh(quad(10), named('Freestanding'))
    })

    const result = await readRhino3dm(bytes)
    expect(result.objects).toMatchObject([
      { name: 'Mount copy / Definition', bounds: { min: [100, -1, 0], max: [101, 1, 0] } },
      { name: 'Freestanding', bounds: { min: [10, -1, 0], max: [11, 1, 0] } },
    ])
    expect(result.skipped).toEqual([])
  })

  it('composes nested block transforms before converting the units and preserves mirrored winding', async () => {
    const bytes = writeFile((doc) => {
      const definitions = doc.instanceDefinitions()
      const inner = definitions.add(
        'Leaf',
        '',
        '',
        '',
        [0, 0, 0],
        [quad(), new rhino.LineCurve([0, 0, 0], [1, 0, 0])],
        [named('Stone'), named('Guide')],
      )
      const mirror = rhino.Transform.mirror([0, 0, 0], [1, 0, 0])
      mirror.m03 = 3
      mirror.m13 = 4
      const nested = blockReference(definitions.get(inner).id, mirror)
      const outer = definitions.add('Mount', '', '', '', [0, 0, 0], [nested], [named('Mirrored')])
      const scale = rhino.Transform.scale([0, 0, 0], 2)
      scale.m03 = 10
      doc
        .objects()
        .addInstanceObject(blockReference(definitions.get(outer).id, scale), named('Outer'))
    }, rhino.UnitSystem.Centimeters)

    const result = await readRhino3dm(bytes)
    expect(result.objects).toMatchObject([
      { name: 'Outer / Mirrored / Stone', bounds: { min: [140, 60, 0], max: [160, 100, 0] } },
    ])
    const stl = new DataView(result.objects[0]!.bytes.buffer)
    expect(stl.getFloat32(84 + 8, true)).toBe(1)
    expect(stl.getFloat32(134 + 8, true)).toBe(1)
    expect(result.skipped).toMatchObject([
      { name: 'Outer / Mirrored / Guide', reason: expect.stringMatching(/curve/i) },
    ])
  })

  it('limits repeated block expansion before allocating unbounded output', async () => {
    const bytes = writeFile((doc) => {
      const definitions = doc.instanceDefinitions()
      const leaf = definitions.add('Leaf', '', '', '', [0, 0, 0], [quad()], [named('Part')])
      const leafId = definitions.get(leaf).id
      const copies = Array.from({ length: 71 }, (_, i) =>
        blockReference(leafId, rhino.Transform.translationXYZ(i, 0, 0)),
      )
      const layer = definitions.add(
        'Row',
        '',
        '',
        '',
        [0, 0, 0],
        copies,
        copies.map(() => named('Copy')),
      )
      const layerId = definitions.get(layer).id
      const objects = doc.objects()
      for (let i = 0; i < 71; i++) {
        objects.addInstanceObject(
          blockReference(layerId, rhino.Transform.translationXYZ(0, i, 0)),
          named('Row'),
        )
      }
    })
    await expect(readRhino3dm(bytes)).rejects.toThrow(/complexity limit/)
  })

  it('returns a review with zero parts when every object is unsupported', async () => {
    const bytes = writeFile((doc) => {
      doc.objects().addPoint([2, 0, 1], named('Marker'))
    })
    await expect(readRhino3dm(bytes)).resolves.toMatchObject({
      objects: [],
      skipped: [{ name: 'Marker', reason: expect.stringMatching(/point/i) }],
    })
  })

  it('accepts the 32-bit archive footer in Rhino 4 files', async () => {
    const doc = new rhino.File3dm()
    doc.settings().modelUnitSystem = rhino.UnitSystem.Centimeters
    doc.objects().addMesh(quad(2), named('Legacy mesh'))
    const options = new rhino.File3dmWriteOptions()
    options.version = 4
    await expect(readRhino3dm(doc.toByteArrayOptions(options))).resolves.toMatchObject({
      units: 'centimetres',
      objects: [{ name: 'Legacy mesh', bounds: { min: [20, -10, 0], max: [30, 10, 0] } }],
      skipped: [],
    })
  })

  it('rejects an archive with too many objects before preparing any assets', async () => {
    const bytes = writeFile((doc) => {
      const objects = doc.objects()
      const attrs = named('Marker')
      for (let i = 0; i < 5_001; i++) objects.addPoint([i, 0, 0], attrs)
    })
    await expect(readRhino3dm(bytes)).rejects.toThrow(/complexity limit/)
  })

  it('rejects unitless models so a missing scale cannot silently change dimensions', async () => {
    const bytes = writeFile((doc) => {
      doc.objects().addMesh(quad(), named('Mesh'))
    }, rhino.UnitSystem.None)
    await expect(readRhino3dm(bytes)).rejects.toThrow(/set.*model units/i)
  })

  it('rejects invalid, truncated, and oversized archives', async () => {
    const bytes = writeFile((doc) => {
      doc.objects().addMesh(quad(), named('Mesh'))
    })
    await expect(readRhino3dm(new Uint8Array(64))).rejects.toThrow(/Rhino.*file/)
    await expect(readRhino3dm(bytes.subarray(0, -1))).rejects.toThrow(/truncated|incomplete/)
    await expect(readRhino3dm(new Uint8Array(MAX_RHINO_FILE_BYTES + 1))).rejects.toThrow(/limit/)
  })
})
