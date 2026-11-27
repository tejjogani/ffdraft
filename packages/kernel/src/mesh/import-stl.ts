import { boundsOfPositions } from '../solid/meshing'
import { parseMesh } from './parse/index'
import { writeStl } from './stl'

export { unionBounds } from '../solid/meshing'

/** The available STL scale choices all express source coordinates in millimetres. */
export function readStlModel(bytes: Uint8Array<ArrayBuffer>, millimetresPerUnit: number) {
  const { mesh, format } = parseMesh(bytes)
  if (format !== 'stl') throw new Error('The selected file does not contain STL geometry.')
  if (millimetresPerUnit !== 1) {
    for (let i = 0; i < mesh.positions.length; i++) {
      mesh.positions[i] = mesh.positions[i]! * millimetresPerUnit
      if (!Number.isFinite(mesh.positions[i]))
        throw new Error('This STL has coordinates outside the supported size range.')
    }
  }
  return {
    bounds: boundsOfPositions(mesh.positions),
    triangles: mesh.indices.length / 3,
    bytes: millimetresPerUnit === 1 ? bytes : writeStl([mesh], 'Pave STL, millimetres'),
  }
}
