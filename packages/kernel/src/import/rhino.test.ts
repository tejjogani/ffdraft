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
        { name: 'Jewellery', layer: 'Jewellery' },
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

  it('reads BReps with saved render meshes and reports only complete objects', async () => {
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
      doc.objects().addBrep(sphere, named('Cached sphere'))
      doc.objects().addBrep(partialBox, named('Incomplete box'))
      doc.objects().addPolyline(
        [
          [0, 0, 0],
          [5, 0, 0],
        ],
        named('Construction'),
      )
    })

    const result = await readRhino3dm(bytes)
    expect(result.objects.map(({ name }) => name)).toEqual(['Cached sphere'])
    expect(result.objects[0]!.bounds).toEqual({ min: [-1, -1, -1], max: [1, 1, 1] })
    expect(parseMesh(result.objects[0]!.bytes).mesh.indices).toHaveLength(24)
    expect(result.skipped).toMatchObject([
      { name: 'Incomplete box', reason: expect.stringMatching(/render mesh.*Mesh/) },
      { name: 'Construction', reason: expect.stringMatching(/curve/i) },
    ])
  })

  it('does not import geometry inside a Rhino block at its definition coordinates', async () => {
    const bytes = writeFile((doc) => {
      const definitions = doc.instanceDefinitions()
      const index = definitions.add('Mount', '', '', '', [0, 0, 0], [quad()], [named('Definition')])
      expect(index).toBeGreaterThanOrEqual(0)
      // The binding's (definition id, transform) constructor is missing from its .d.ts.
      const BlockReference = rhino.InstanceReference as unknown as new (
        id: string,
        xform: Transform,
      ) => InstanceReference
      const ref = new BlockReference(
        definitions.get(index).id,
        rhino.Transform.translationXYZ(100, 0, 0),
      )
      doc.objects().addInstanceObject(ref, named('Mount copy'))
      doc.objects().addMesh(quad(10), named('Freestanding'))
    })

    const result = await readRhino3dm(bytes)
    expect(result.objects.map(({ name }) => name)).toEqual(['Freestanding'])
    expect(result.skipped).toMatchObject([
      { name: 'Definition', reason: expect.stringMatching(/block/i) },
      { name: 'Mount copy', reason: expect.stringMatching(/block/i) },
    ])
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
