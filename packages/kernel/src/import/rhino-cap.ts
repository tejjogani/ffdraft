import type { Brep, BrepFace, RhinoModule } from 'rhino3dm'
import {
  addScaled,
  composeTransform,
  cross,
  dot,
  isIdentity,
  length,
  normalize,
  scale,
  sub,
  transformDirection,
  transformPoint,
  type Vec3,
} from '../geometry/vec'
import { freeRhino, loadRhino3dm } from '../runtime/rhino'
import { MAX_RHINO_FILE_BYTES, readRhino3dm } from './rhino'

type Point = [number, number, number]

export interface RhinoCapFace {
  faceIndex: number
  oppositeFaceIndex: number
  /** Unit outward normal. */
  normal: Point
  /** Center of the cap's trim bounds, projected onto its plane. */
  center: Point
  /** Perpendicular distance to the opposite cap, in millimetres. */
  spanMm: number
  innerLoops: number
}

const AXES = [0, 1, 2] as const
const GEOMETRY_TOLERANCE = 1e-7
const ANGULAR_TOLERANCE = 1e-9
const MAX_FACES = 256
const UNSUPPORTED = 'This Rhino source does not have editable caps on a straight closed prism.'

type Hold = <T extends object | null>(handle: T) => T

function withHandles<T>(read: (hold: Hold) => T): T {
  const handles: object[] = []
  try {
    return read((handle) => {
      if (handle) handles.push(handle)
      return handle
    })
  } finally {
    for (const handle of handles.reverse()) freeRhino(handle)
  }
}

function point(values: readonly number[]): Point {
  return [values[0]! + 0, values[1]! + 0, values[2]! + 0]
}

/** Place a cap on a project node, using the same XYZ Euler rotation as the viewport. */
export function placeRhinoCapFace(
  cap: RhinoCapFace,
  transform?: { position: Vec3; rotation: Vec3; scale: number },
): RhinoCapFace {
  if (!transform) return cap
  const matrix = composeTransform(transform.position, transform.rotation, transform.scale)
  return {
    ...cap,
    center: point(transformPoint(matrix, cap.center)),
    normal: point(normalize(transformDirection(matrix, cap.normal))),
    spanMm: cap.spanMm * Math.abs(transform.scale),
  }
}

function similarity(matrix: readonly number[] | undefined): { size: number; reflected: boolean } {
  if (!matrix) return { size: 1, reflected: false }
  if (
    matrix.length !== 16 ||
    Array.from(matrix).some((value) => !Number.isFinite(value)) ||
    matrix[3] !== 0 ||
    matrix[7] !== 0 ||
    matrix[11] !== 0 ||
    matrix[15] !== 1
  )
    throw new Error('The Rhino source has an invalid placement matrix.')
  const [x, y, z] = [0, 4, 8].map((i) => point(matrix.slice(i, i + 3))) as [Point, Point, Point]
  const size = length(x)
  if (!Number.isFinite(size) || size < 1e-12)
    throw new Error('The Rhino source placement collapses its geometry.')
  const [a, b, c] = [x, y, z].map((v) => scale(v, 1 / size)) as [Vec3, Vec3, Vec3]
  if (
    Math.abs(length(b) - 1) > ANGULAR_TOLERANCE ||
    Math.abs(length(c) - 1) > ANGULAR_TOLERANCE ||
    Math.abs(dot(a, b)) > ANGULAR_TOLERANCE ||
    Math.abs(dot(b, c)) > ANGULAR_TOLERANCE ||
    Math.abs(dot(c, a)) > ANGULAR_TOLERANCE
  )
    throw new Error('The Rhino source placement must use uniform scale without shear.')
  return { size, reflected: dot(cross(a, b), c) < 0 }
}

interface TrimLoop {
  kind: 'outer' | 'inner'
  edges: number[]
}

interface FaceInfo {
  face: BrepFace
  loops: TrimLoop[]
  plane: { origin: Point; normal: Point } | null
}

interface Topology {
  faces: FaceInfo[]
  edgeFaces: number[][]
  vertices: Point[]
}

function trimLoops(rhino: RhinoModule, face: BrepFace, edgeCount: number): TrimLoop[] | null {
  const loopTypes = (
    rhino as RhinoModule & {
      BrepLoopType: { Outer: number; Inner: number }
    }
  ).BrepLoopType
  return withHandles((hold) => {
    const loops = hold(face.loops)
    const result: TrimLoop[] = []
    for (let i = 0; i < loops.count; i++) {
      const loop = hold(loops.get(i))
      // Embind exposes enum values as objects while the TS declaration models them as numbers.
      const kind =
        loop.loopType === loopTypes.Outer
          ? 'outer'
          : loop.loopType === loopTypes.Inner
            ? 'inner'
            : null
      if (!kind) return null
      const trims = hold(loop.trims)
      const edges: number[] = []
      for (let j = 0; j < trims.count; j++) {
        const { edgeIndex } = hold(trims.get(j))
        if (edgeIndex < 0 || edgeIndex >= edgeCount) return null
        edges.push(edgeIndex)
      }
      if (!edges.length) return null
      result.push({ kind, edges })
    }
    if (result.filter((loop) => loop.kind === 'outer').length !== 1) return null
    return result
  })
}

function facePlane(face: BrepFace): FaceInfo['plane'] {
  // Omitting tolerance passes NaN to the current JS binding.
  if (!(face.isPlanar as (tolerance: number) => boolean)(1e-8)) return null
  const [u, v] = ([0, 1] as const).map((axis) => {
    const [start, finish] = face.domain(axis)
    return (start! + finish!) / 2
  })
  const origin = point(face.pointAt(u!, v!))
  const normal = point(face.normalAt(u!, v!))
  if (![...origin, ...normal].every(Number.isFinite) || length(normal) < GEOMETRY_TOLERANCE)
    return null
  return { origin, normal: point(normalize(normal)) }
}

function capTopology(rhino: RhinoModule, brep: Brep, hold: Hold): Topology | null {
  if (!brep.isValid || !brep.isManifold || !brep.isSolid) return null
  const faces = hold(brep.faces())
  const edges = hold(brep.edges())
  const vertices = hold(brep.vertices())
  if (faces.count < 3 || faces.count > MAX_FACES || !vertices.count) return null
  const edgeFaces: number[][] = Array.from({ length: edges.count }, () => [])
  const info: FaceInfo[] = []
  for (let i = 0; i < faces.count; i++) {
    const face = hold(faces.get(i))
    const hasRenderMesh = withHandles((holdMesh) => {
      const mesh = holdMesh(face.getMesh(rhino.MeshType.Render))
      return mesh && holdMesh(mesh.vertices()).count >= 3 && holdMesh(mesh.faces()).count > 0
    })
    if (!hasRenderMesh) return null
    const loops = trimLoops(rhino, face, edges.count)
    if (!loops) return null
    for (const loop of loops) for (const edge of loop.edges) edgeFaces[edge]!.push(i)
    info.push({ face, loops, plane: facePlane(face) })
  }
  if (edgeFaces.some((incident) => incident.length !== 2)) return null
  return {
    faces: info,
    edgeFaces,
    vertices: Array.from({ length: vertices.count }, (_, i) =>
      point(hold(vertices.get(i)).location),
    ),
  }
}

function translatedWall(face: BrepFace, origin: Vec3, axis: Vec3, span: number): boolean {
  return withHandles((hold) => {
    const surface = hold(face.toNurbsSurface())
    if (!surface) return false
    const points = hold(surface.points())
    const counts = [points.countU, points.countV]
    for (const direction of [0, 1] as const) {
      const degree = surface.degree(direction)
      if ((degree !== 1 && degree !== 2) || counts[direction] !== degree + 1) continue
      const size = counts[1 - direction]!
      const controlPoint = (row: number, column: number) =>
        direction === 0 ? points.get(row, column) : points.get(column, row)
      const rowHeights: number[] = []
      const firstWeights: number[] = []
      let straight = true
      for (let column = 0; column < size && straight; column++) {
        const start = controlPoint(0, column)
        const base = scale(point(start), 1 / start[3]!)
        for (let row = 0; row <= degree; row++) {
          const control = controlPoint(row, column)
          const weight = control[3]!
          const current = scale(point(control), 1 / weight)
          const height = dot(sub(current, origin), axis)
          const weightRatio = weight / start[3]!
          if (column === 0) {
            rowHeights.push(height)
            firstWeights.push(weightRatio)
          }
          const displacement = sub(current, base)
          if (
            !control.every(Number.isFinite) ||
            !Number.isFinite(height) ||
            !(weight > 0) ||
            Math.abs(weightRatio / firstWeights[row]! - 1) > ANGULAR_TOLERANCE ||
            Math.abs(height - rowHeights[row]!) > GEOMETRY_TOLERANCE ||
            length(cross(displacement, axis)) > GEOMETRY_TOLERANCE
          ) {
            straight = false
            break
          }
        }
      }
      if (!straight || size < 2) continue
      const first = rowHeights[0]!
      const last = rowHeights[degree]!
      const forward = first < last
      if (
        Math.abs(forward ? first : last) <= GEOMETRY_TOLERANCE &&
        Math.abs((forward ? last : first) - span) <= GEOMETRY_TOLERANCE &&
        (degree === 1 ||
          (rowHeights[1]! > Math.min(first, last) && rowHeights[1]! < Math.max(first, last)))
      )
        return true
    }
    return false
  })
}

function trimCenter(brep: Brep, cap: FaceInfo & { plane: NonNullable<FaceInfo['plane']> }): Point {
  return withHandles((hold) => {
    const edges = hold(brep.edges())
    const min: Point = [Infinity, Infinity, Infinity]
    const max: Point = [-Infinity, -Infinity, -Infinity]
    for (const loop of cap.loops) {
      for (const index of loop.edges) {
        const box = hold(hold(edges.get(index)).getBoundingBox(true))
        const lo = box.min
        const hi = box.max
        for (const i of AXES) {
          min[i] = Math.min(min[i], lo[i]!)
          max[i] = Math.max(max[i], hi[i]!)
        }
      }
    }
    const center = AXES.map((i) => (min[i] + max[i]) / 2) as Point
    const { origin, normal } = cap.plane
    return point(addScaled(center, normal, -dot(sub(center, origin), normal)))
  })
}

function oppositeRims(topology: Topology, a: number, b: number): boolean {
  const walls = (cap: number) =>
    topology.faces[cap]!.loops.map(({ kind, edges }) => {
      const neighbors = edges.map((edge) => topology.edgeFaces[edge]!.find((face) => face !== cap))
      if (neighbors.some((face) => face === undefined || face === a || face === b)) return ''
      return `${kind}:${neighbors.sort((left, right) => left! - right!).join(',')}`
    }).sort()
  const aWalls = walls(a)
  const bWalls = walls(b)
  return aWalls.length === bWalls.length && aWalls.every((wall, i) => wall && wall === bWalls[i])
}

function isPrism(
  brep: Brep,
  topology: Topology,
  a: number,
  b: number,
  origin: Point,
  axis: Vec3,
  span: number,
): boolean {
  const height = (p: readonly number[]) => dot(sub(point(p), origin), axis)
  const onCap = (h: number) =>
    Math.abs(h) <= GEOMETRY_TOLERANCE || Math.abs(h - span) <= GEOMETRY_TOLERANCE
  if (topology.vertices.some((p) => !onCap(height(p))) || !oppositeRims(topology, a, b))
    return false

  return withHandles((hold) => {
    const edges = hold(brep.edges())
    return topology.faces.every(({ face, loops }, index) => {
      if (index === a || index === b) return true
      if (loops.length !== 1 || loops[0]!.edges.length !== 4) return false
      let lowerRims = 0
      let upperRims = 0
      for (const edgeIndex of loops[0]!.edges) {
        const incident = topology.edgeFaces[edgeIndex]!
        if (incident.includes(a)) lowerRims++
        else if (incident.includes(b)) upperRims++
        else {
          // A rail (or a closed wall's seam) must be straight and join the two end planes.
          const edge = hold(edges.get(edgeIndex))
          const first = point(edge.pointAtStart)
          const last = point(edge.pointAtEnd)
          if (
            !(edge.isLinear as (tolerance: number) => boolean)(GEOMETRY_TOLERANCE) ||
            !onCap(height(first)) ||
            !onCap(height(last)) ||
            Math.abs(Math.abs(height(first) - height(last)) - span) > GEOMETRY_TOLERANCE ||
            length(cross(sub(first, last), axis)) > GEOMETRY_TOLERANCE
          )
            return false
        }
      }
      return lowerRims === 1 && upperRims === 1 && translatedWall(face, origin, axis, span)
    })
  })
}

function findCaps(brep: Brep, topology: Topology): RhinoCapFace[] {
  const result: RhinoCapFace[] = []
  for (const [a, lower] of topology.faces.entries()) {
    if (!lower.plane) continue
    const { origin, normal } = lower.plane
    for (let b = a + 1; b < topology.faces.length; b++) {
      const upper = topology.faces[b]!
      if (!upper.plane || length(cross(normal, upper.plane.normal)) > ANGULAR_TOLERANCE) continue
      const signedSpan = dot(sub(upper.plane.origin, origin), normal)
      const span = Math.abs(signedSpan)
      if (!Number.isFinite(span) || span <= GEOMETRY_TOLERANCE) continue
      const axis = scale(normal, Math.sign(signedSpan))
      if (!isPrism(brep, topology, a, b, origin, axis, span)) continue
      const cap = (
        faceIndex: number,
        oppositeFaceIndex: number,
        direction: number,
      ): RhinoCapFace => {
        const info = topology.faces[faceIndex]!
        return {
          faceIndex,
          oppositeFaceIndex,
          normal: point(scale(axis, direction)),
          center: trimCenter(brep, { ...info, plane: info.plane! }),
          spanMm: span,
          innerLoops: info.loops.length - 1,
        }
      }
      const pair = [cap(a, b, -1), cap(b, a, 1)]
      if (pair.every(({ center }) => center.every(Number.isFinite))) result.push(...pair)
    }
  }
  return result.sort((a, b) => a.faceIndex - b.faceIndex)
}

function readPart(rhino: RhinoModule, nativeBytes: Uint8Array, hold: Hold): Brep | null {
  if (nativeBytes.byteLength > MAX_RHINO_FILE_BYTES)
    throw new Error('The Rhino source is too large.')
  const doc = hold(rhino.File3dm.fromByteArray(nativeBytes))
  if (!doc) throw new Error('The Rhino source archive could not be opened.')
  const objects = hold(doc.objects())
  if (objects.count !== 1 || hold(doc.settings()).modelUnitSystem !== rhino.UnitSystem.Millimeters)
    return null
  const geometry = hold(hold(objects.get(0)).geometry())
  return geometry instanceof rhino.Brep ? geometry : null
}

/** Find eligible planar cap pairs in the part's placed import coordinates. */
export async function listRhinoCapFaces(
  nativeBytes: Uint8Array,
  nativeTransform?: readonly number[],
): Promise<RhinoCapFace[]> {
  const placement = similarity(nativeTransform)
  const rhino = await loadRhino3dm()
  return withHandles((hold) => {
    const part = readPart(rhino, nativeBytes, hold)
    const topology = part && capTopology(rhino, part, hold)
    if (!part || !topology) return []
    const caps = findCaps(part, topology)
    if (!nativeTransform) return caps
    return caps
      .map((cap) => ({
        ...cap,
        center: point(transformPoint(nativeTransform, cap.center)),
        normal: point(normalize(transformDirection(nativeTransform, cap.normal))),
        spanMm: cap.spanMm * placement.size,
      }))
      .filter(
        ({ center, spanMm }) =>
          center.every(Number.isFinite) && Number.isFinite(spanMm) && spanMm > GEOMETRY_TOLERANCE,
      )
  })
}

function matchesSourceMesh(
  source: Uint8Array,
  known: Uint8Array,
  transform: readonly number[] | undefined,
  reflected: boolean,
): boolean {
  // Import writes fixed-size binary STL records. Compare the oriented triangle coordinates,
  // ignoring the header, stored facet normal and attribute bytes.
  if (source.byteLength !== known.byteLength || source.byteLength < 84) return false
  const actual = new DataView(source.buffer, source.byteOffset, source.byteLength)
  const reference = new DataView(known.buffer, known.byteOffset, known.byteLength)
  if (actual.getUint32(80, true) !== reference.getUint32(80, true)) return false
  const pointAt = (view: DataView, offset: number): Point =>
    AXES.map((axis) => view.getFloat32(offset + axis * 4, true)) as Point
  const corners = reflected ? [0, 2, 1] : AXES
  const placementScale = transform ? length(point(transform)) : 1
  for (let at = 84; at < known.byteLength; at += 50) {
    for (const [i, j] of corners.entries()) {
      const original = pointAt(reference, at + 12 + j * 12)
      const expected = transform ? transformPoint(transform, original) : original
      const current = pointAt(actual, at + 12 + i * 12)
      const roundoff = Math.max(1e-8, length(original) * placementScale * 2 ** -22)
      if (
        !current.every(Number.isFinite) ||
        AXES.some(
          (axis) =>
            !Number.isFinite(expected[axis]) ||
            Math.abs(current[axis] - Math.fround(expected[axis])) > roundoff,
        )
      )
        return false
    }
  }
  return true
}

/** Stretch the certified prism along its axis about the fixed opposite cap. */
export async function offsetRhinoCap(
  nativeBytes: Uint8Array,
  meshBytes: Uint8Array,
  nativeTransform: readonly number[] | undefined,
  faceIndex: number,
  offsetMm: number,
): Promise<{ nativeBytes: Uint8Array<ArrayBuffer>; meshBytes: Uint8Array<ArrayBuffer> }> {
  if (!Number.isSafeInteger(faceIndex) || faceIndex < 0)
    throw new Error('The Rhino cap face index is invalid.')
  if (!Number.isFinite(offsetMm)) throw new Error('The Rhino cap offset must be finite.')
  const placement = similarity(nativeTransform)
  const rhino = await loadRhino3dm()
  const { edited, expectedCenter, fixedCenter, expectedSpan } = withHandles((hold) => {
    const part = readPart(rhino, nativeBytes, hold)
    const topology = part && capTopology(rhino, part, hold)
    if (!part || !topology) throw new Error(UNSUPPORTED)
    const caps = findCaps(part, topology)
    const cap = caps.find((candidate) => candidate.faceIndex === faceIndex)
    if (!cap) throw new Error(UNSUPPORTED)
    const opposite = caps.find((candidate) => candidate.faceIndex === cap.oppositeFaceIndex)!
    const placedSpan = cap.spanMm * placement.size
    const localOffset = offsetMm / placement.size
    if (
      !Number.isFinite(placedSpan + offsetMm) ||
      placedSpan + offsetMm <= GEOMETRY_TOLERANCE ||
      cap.spanMm + localOffset <= GEOMETRY_TOLERANCE
    )
      throw new Error('The Rhino cap offset would collapse the prism.')
    const duplicate = hold(part.duplicate() as Brep)
    const stretch = hold(rhino.Transform.identity())
    const ratio = localOffset / cap.spanMm
    const anchor = dot(opposite.center, cap.normal)
    for (const i of AXES) {
      for (const j of AXES)
        stretch[`m${i}${j}`] = Number(i === j) + ratio * cap.normal[i] * cap.normal[j]
      stretch[`m${i}3`] = -ratio * anchor * cap.normal[i]
    }
    if (!duplicate.transform(stretch)) throw new Error('Rhino could not stretch the selected cap.')
    if (nativeTransform && !isIdentity(nativeTransform)) {
      const matrix = hold(rhino.Transform.identity())
      for (const i of AXES) {
        for (const j of AXES) matrix[`m${i}${j}`] = nativeTransform[j * 4 + i]!
        matrix[`m${i}3`] = nativeTransform[12 + i]!
      }
      if (!duplicate.transform(matrix))
        throw new Error('Rhino could not bake the source placement.')
      // Brep.Transform reflects the geometry and cached vertices without fixing winding.
      if (placement.reflected) duplicate.flip()
    }
    const changed = capTopology(rhino, duplicate, hold)
    if (
      !changed ||
      changed.vertices.length !== topology.vertices.length ||
      JSON.stringify(changed.faces.map((f) => f.loops)) !==
        JSON.stringify(topology.faces.map((f) => f.loops))
    )
      throw new Error('The cap edit did not preserve a valid closed Rhino solid.')
    const doc = hold(new rhino.File3dm())
    hold(doc.settings()).modelUnitSystem = rhino.UnitSystem.Millimeters
    const attributes = hold(new rhino.ObjectAttributes())
    hold(doc.objects()).addBrep(duplicate, attributes)
    const options = hold(new rhino.File3dmWriteOptions())
    options.saveUserData = false
    const fixedCenter = nativeTransform
      ? transformPoint(nativeTransform, opposite.center)
      : opposite.center
    const originalCenter = nativeTransform
      ? transformPoint(nativeTransform, cap.center)
      : cap.center
    const direction = nativeTransform
      ? normalize(transformDirection(nativeTransform, cap.normal))
      : cap.normal
    return {
      edited: doc.toByteArrayOptions(options).slice(),
      expectedCenter: addScaled(originalCenter, direction, offsetMm),
      fixedCenter,
      expectedSpan: placedSpan + offsetMm,
    }
  })
  const source = (await readRhino3dm(nativeBytes)).objects[0]
  if (!source || !matchesSourceMesh(meshBytes, source.bytes, nativeTransform, placement.reflected))
    throw new Error(
      'The current paired Rhino render mesh is missing or does not match this source.',
    )
  const reopened = await readRhino3dm(edited)
  const output = reopened.objects[0]
  if (!output?.native || reopened.objects.length !== 1 || reopened.skipped.length)
    throw new Error('Rhino could not reopen the edited solid with its render mesh.')
  const caps = await listRhinoCapFaces(edited)
  const moved = caps.find((cap) => cap.faceIndex === faceIndex)
  const fixed = caps.find((cap) => cap.faceIndex === moved?.oppositeFaceIndex)
  // A world-aligned trim bounding box can change its in-plane center under rotation.
  // Compare the two actual cap planes using the projected separation.
  if (
    !moved ||
    !fixed ||
    Math.abs(moved.spanMm - expectedSpan) > GEOMETRY_TOLERANCE ||
    Math.abs(dot(sub(moved.center, expectedCenter), moved.normal)) > GEOMETRY_TOLERANCE ||
    Math.abs(dot(sub(fixed.center, fixedCenter), fixed.normal)) > GEOMETRY_TOLERANCE
  )
    throw new Error('Rhino could not preserve the two cap planes at the requested offset.')
  return { nativeBytes: edited, meshBytes: output.bytes }
}
