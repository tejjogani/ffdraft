import type { BrepFace, Mesh, MeshType } from 'rhino3dm'
import { freeRhino, loadRhino3dm } from '../src/runtime/rhino'

/** A 2 mm long sleeve with an outer diameter of 6 mm and a through bore of 2 mm. */
export async function makeCappedPrismFixture(): Promise<Uint8Array<ArrayBuffer>> {
  const rhino = await loadRhino3dm()
  const handles: object[] = []
  const hold = <T extends object>(value: T): T => {
    handles.push(value)
    return value
  }

  try {
    const circle = hold(new rhino.Circle(3))
    const cylinder = hold(new rhino.Cylinder(circle, 2))
    const extrusion = hold(rhino.Extrusion.createPipeExtrusion(cylinder, 1, true, true))
    const brep = hold(extrusion.toBrep(true))
    const faces = hold(brep.faces())
    const sectors = 32

    // Rhino's pipe BRep orders the faces as outer wall, inner wall, bottom, top.
    for (let index = 0; index < 4; index++) {
      const mesh = new rhino.Mesh()
      const vertices = hold(mesh.vertices())
      const polygons = hold(mesh.faces())
      const rings = [
        [
          [3, 0],
          [3, 2],
        ],
        [
          [1, 0],
          [1, 2],
        ],
        [
          [3, 0],
          [1, 0],
        ],
        [
          [3, 2],
          [1, 2],
        ],
      ][index]!
      for (const [r, z] of rings) {
        for (let i = 0; i < sectors; i++) {
          const angle = (i * 2 * Math.PI) / sectors
          vertices.add(r! * Math.cos(angle), r! * Math.sin(angle), z!)
        }
      }
      for (let i = 0; i < sectors; i++) {
        const next = (i + 1) % sectors
        if (index === 1 || index === 2) polygons.addQuadFace(i, i + sectors, next + sectors, next)
        else polygons.addQuadFace(i, next, next + sectors, i + sectors)
      }

      const face = hold(faces.get(index))
      // The JS binding takes (mesh, mesh type), in contrast to its declaration.
      const setMesh = face.setMesh as unknown as (
        this: BrepFace,
        mesh: Mesh,
        type: MeshType,
      ) => boolean
      // On success the face takes ownership of the mesh.
      if (!setMesh.call(face, mesh, rhino.MeshType.Render)) {
        freeRhino(mesh)
        throw new Error('Could not cache sleeve.')
      }
    }

    const doc = hold(new rhino.File3dm())
    hold(doc.settings()).modelUnitSystem = rhino.UnitSystem.Millimeters
    const attributes = hold(new rhino.ObjectAttributes())
    attributes.name = 'Sleeve'
    hold(doc.objects()).addBrep(brep, attributes)
    return doc.toByteArray().slice()
  } finally {
    for (const handle of handles.reverse()) freeRhino(handle)
  }
}
