import type {
  Brep,
  BrepFace,
  InstanceReference,
  Mesh,
  MeshType,
  RhinoModule,
  Transform,
} from 'rhino3dm'
import { beforeAll, describe, expect, it } from 'vitest'
import { makeCappedPrismFixture } from '../../test-fixtures/capped-prism'
import { loadRhino3dm } from '../runtime/rhino'
import { type RhinoMeshObject, readRhino3dm } from './rhino'
import { listRhinoCapFaces, offsetRhinoCap, placeRhinoCapFace } from './rhino-cap'

function triangle(rhino: RhinoModule): Mesh {
  const mesh = new rhino.Mesh()
  for (const [x, y] of [
    [0, 0],
    [1, 0],
    [0, 1],
  ] as const)
    mesh.vertices().add(x, y, 0)
  mesh.faces().addTriFace(0, 1, 2)
  return mesh
}

async function cachedBrepFile(brep: Brep): Promise<Uint8Array<ArrayBuffer>> {
  const rhino = await loadRhino3dm()
  const faces = brep.faces()
  for (let i = 0; i < faces.count; i++) {
    const face = faces.get(i)
    // Qualification must use native surfaces and trims regardless of tessellation.
    const setMesh = face.setMesh as unknown as (
      this: BrepFace,
      mesh: Mesh,
      meshType: MeshType,
    ) => boolean
    expect(setMesh.call(face, triangle(rhino), rhino.MeshType.Render)).toBe(true)
  }
  const doc = new rhino.File3dm()
  doc.settings().modelUnitSystem = rhino.UnitSystem.Millimeters
  doc.objects().addBrep(brep, new rhino.ObjectAttributes())
  return doc.toByteArray().slice()
}

let bytes: Uint8Array<ArrayBuffer>
let sleeve: RhinoMeshObject

beforeAll(async () => {
  bytes = await makeCappedPrismFixture()
  const imported = await readRhino3dm(bytes)
  expect(imported.skipped).toEqual([])
  expect(imported.objects).toHaveLength(1)
  expect(imported.objects[0]!.name).toBe('Sleeve')
  sleeve = imported.objects[0]!
})

describe('Rhino capped-prism editing', () => {
  it('lists the two opposite annular caps by native face index', async () => {
    const caps = await listRhinoCapFaces(sleeve.native!.bytes)
    expect(caps).toHaveLength(2)
    expect(caps[0]).toEqual({
      faceIndex: 2,
      oppositeFaceIndex: 3,
      center: [0, 0, 0],
      normal: [0, 0, -1],
      spanMm: 2,
      innerLoops: 1,
    })
    expect(caps[1]).toEqual({
      faceIndex: 3,
      oppositeFaceIndex: 2,
      center: [0, 0, 2],
      normal: [0, 0, 1],
      spanMm: 2,
      innerLoops: 1,
    })
    const placed = placeRhinoCapFace(caps[1]!, {
      position: [1, 2, 3],
      rotation: [90, 0, 0],
      scale: 2,
    })
    expect(placed.center[0]).toBeCloseTo(1)
    expect(placed.center[1]).toBeCloseTo(-2)
    expect(placed.center[2]).toBeCloseTo(3)
    expect(placed.normal[1]).toBeCloseTo(-1)
    expect(placed.spanMm).toBe(4)
  })

  it('preserves the through bore, original opposite cap and render cache on reopen', async () => {
    const edited = await offsetRhinoCap(sleeve.native!.bytes, sleeve.bytes, undefined, 3, 0.25)
    const reopened = await readRhino3dm(edited.nativeBytes)
    expect(reopened.skipped).toEqual([])
    expect(reopened.objects).toHaveLength(1)
    expect(reopened.objects[0]!.bounds).toEqual({ min: [-3, -3, 0], max: [3, 3, 2.25] })
    expect(edited.meshBytes).toEqual(reopened.objects[0]!.bytes)

    const rhino = await loadRhino3dm()
    const brep = (source: Uint8Array) =>
      rhino.File3dm.fromByteArray(source).objects().get(0).geometry() as Brep
    const original = brep(sleeve.native!.bytes)
    const result = brep(edited.nativeBytes)
    expect(result.isValid).toBe(true)
    expect(result.isSolid).toBe(true)
    expect(result.faces().count).toBe(4)
    expect(result.edges().count).toBe(original.edges().count)
    for (const index of [2, 3]) {
      const before = original.faces().get(index).loops
      const after = result.faces().get(index).loops
      expect(after.count).toBe(2)
      for (let loop = 0; loop < 2; loop++)
        expect(after.get(loop).trims.get(0).edgeIndex).toBe(before.get(loop).trims.get(0).edgeIndex)
      const rim = result.edges().get(after.get(1).trims.get(0).edgeIndex)
      const first = rim.pointAt(rim.domain[0]!)
      const opposite = rim.pointAt((rim.domain[0]! + rim.domain[1]!) / 2)
      expect(first[2]).toBeCloseTo(index === 2 ? 0 : 2.25)
      expect(Math.hypot(first[0]! - opposite[0]!, first[1]! - opposite[1]!)).toBeCloseTo(2)
    }
    const shrink = await offsetRhinoCap(edited.nativeBytes, edited.meshBytes, undefined, 2, -0.5)
    const caps = await listRhinoCapFaces(shrink.nativeBytes)
    expect(caps[0]?.center[2]).toBeCloseTo(0.5)
    expect(caps[1]?.center[2]).toBeCloseTo(2.25)
    expect(caps[1]?.spanMm).toBeCloseTo(1.75)
  })

  it('refuses a collapsing offset or a mesh from a different revision', async () => {
    await expect(
      offsetRhinoCap(sleeve.native!.bytes, sleeve.bytes, undefined, 3, -2),
    ).rejects.toThrow(/collapse/i)
    const edited = await offsetRhinoCap(sleeve.native!.bytes, sleeve.bytes, undefined, 3, 1)
    await expect(offsetRhinoCap(edited.nativeBytes, sleeve.bytes, undefined, 3, 1)).rejects.toThrow(
      /mesh/i,
    )
    await expect(
      offsetRhinoCap(sleeve.native!.bytes, new Uint8Array(), undefined, 3, 1),
    ).rejects.toThrow(/mesh/i)
  })

  it('bakes a rotated, mirrored and uniformly scaled block in placed millimetres', async () => {
    const rhino = await loadRhino3dm()
    const body = rhino.File3dm.fromByteArray(bytes).objects().get(0).geometry()
    const doc = new rhino.File3dm()
    doc.settings().modelUnitSystem = rhino.UnitSystem.Millimeters
    const definitions = doc.instanceDefinitions()
    const attrs = new rhino.ObjectAttributes()
    const id = definitions.add('Sleeve', '', '', '', [0, 0, 0], [body], [attrs])
    const xform = rhino.Transform.identity()
    xform.m00 = 0
    xform.m02 = 2
    xform.m11 = 2
    xform.m20 = 2
    xform.m22 = 0
    xform.m03 = 9
    xform.m13 = -5
    xform.m23 = 1
    const BlockReference = rhino.InstanceReference as unknown as new (
      id: string,
      transform: Transform,
    ) => InstanceReference
    doc.objects().addInstanceObject(new BlockReference(definitions.get(id).id, xform), attrs)

    const imported = (await readRhino3dm(doc.toByteArray())).objects[0]!
    expect(imported.bounds).toEqual({ min: [9, -11, -5], max: [13, 1, 7] })
    const placement = imported.native!.transform
    const caps = await listRhinoCapFaces(imported.native!.bytes, placement)
    expect(caps[1]).toMatchObject({ center: [13, -5, 1], normal: [1, 0, 0], spanMm: 4 })
    const edited = await offsetRhinoCap(imported.native!.bytes, imported.bytes, placement, 3, 0.5)
    const reopened = (await readRhino3dm(edited.nativeBytes)).objects[0]!
    expect(reopened.bounds).toEqual({ min: [9, -11, -5], max: [13.5, 1, 7] })
    expect(reopened.native?.transform).toBeUndefined()
    expect(reopened.bytes).toEqual(edited.meshBytes)
    expect((await listRhinoCapFaces(edited.nativeBytes))[0]?.center[0]).toBeCloseTo(9)

    // Signed STL volume distinguishes outward winding from a mirrored inside-out cache.
    const stl = new DataView(edited.meshBytes.buffer)
    let volume = 0
    for (let at = 96; at < stl.byteLength; at += 50) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = Array.from({ length: 9 }, (_, index) =>
        stl.getFloat32(at + index * 4, true),
      ) as [number, number, number, number, number, number, number, number, number]
      volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6
    }
    expect(volume).toBeGreaterThan(440)
    expect(volume).toBeLessThan(455)
  })

  it('rejects degenerate and nonsimilarity placements', async () => {
    const shear = [1, 0, 0, 0, 0.25, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    const collapsed = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]
    await expect(listRhinoCapFaces(sleeve.native!.bytes, shear)).rejects.toThrow(/shear/i)
    await expect(
      offsetRhinoCap(sleeve.native!.bytes, sleeve.bytes, collapsed, 3, 1),
    ).rejects.toThrow(/collapses/i)
  })

  it('qualifies each opposing pair on a rectangular solid', async () => {
    const rhino = await loadRhino3dm()
    const box = rhino.Brep.createFromBoundingBox(new rhino.BoundingBox([0, 0, 0], [1, 2, 3]))
    const file = await cachedBrepFile(box)
    const caps = await listRhinoCapFaces(file)
    expect(caps).toHaveLength(6)
    expect(caps.map(({ spanMm }) => spanMm).sort()).toEqual([1, 1, 2, 2, 3, 3])
    expect(caps.every(({ innerLoops }) => innerLoops === 0)).toBe(true)
  })

  it('excludes a tapered solid with parallel caps', async () => {
    const rhino = await loadRhino3dm()
    const generator = new rhino.LineCurve([3, 0, 0], [2, 0, 2])
    const axis = new rhino.Line([0, 0, 0], [0, 0, 2])
    const surface = rhino.RevSurface.create(generator, axis, 0, 2 * Math.PI)
    const frustum = rhino.Brep.createFromRevSurface(surface, true, true)
    expect(frustum.isSolid).toBe(true)
    await expect(listRhinoCapFaces(await cachedBrepFile(frustum))).resolves.toEqual([])
  })

  it('excludes mesh objects and an archive with an extra solid', async () => {
    const rhino = await loadRhino3dm()
    const doc = rhino.File3dm.fromByteArray(bytes)
    const attrs = new rhino.ObjectAttributes()
    doc.objects().addBrep(doc.objects().get(0).geometry() as Brep, attrs)
    await expect(listRhinoCapFaces(doc.toByteArray())).resolves.toEqual([])

    const meshDoc = new rhino.File3dm()
    meshDoc.settings().modelUnitSystem = rhino.UnitSystem.Millimeters
    meshDoc.objects().addMesh(triangle(rhino), attrs)
    await expect(listRhinoCapFaces(meshDoc.toByteArray())).resolves.toEqual([])
  })
})
