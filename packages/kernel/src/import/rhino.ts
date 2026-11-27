import type { RhinoContext } from '@pave/schema'
import type {
  Brep,
  File3dm,
  File3dmLayerTable,
  File3dmObject,
  GeometryBase,
  Layer,
  Mesh,
  RhinoModule,
  Transform,
  UnitSystem,
} from 'rhino3dm'
import type { Mat4 } from '../geometry/vec'
import { writeStl } from '../mesh/stl'
import { freeRhino, loadRhino3dm } from '../runtime/rhino'
import type { IndexedTriangles } from '../solid/meshing'
import type { Bounds } from '../types'
import { readStullerMaterial } from './matrix-stuller'
import {
  inheritedMaterial,
  inheritedMaterialAppearance,
  RHINO_INHERITED_MATERIAL,
  rhinoContextReader,
} from './rhino-context'
import {
  CURVE_SOURCE_ID_KEY,
  type PlacedRhinoCurve,
  RhinoCurveReadError,
  readPlacedCurve,
} from './rhino-curve'

export {
  hasRecoverableRhinoLabels,
  type RhinoLabelRecovery,
  recoverRhinoLabels,
} from './recover-rhino-labels'

const MAX_FILE_MIB = 64
export const MAX_RHINO_FILE_BYTES = MAX_FILE_MIB * 1024 * 1024
const MAX_OBJECTS = 5_000
const MAX_VERTICES = 3_000_000
const MAX_TRIANGLES = 1_000_000
const MAX_BREP_FACES = 20_000
const MAX_BLOCK_DEPTH = 32

const MESH_IN_RHINO =
  'In Rhino, run Mesh on the originals and use Export Selected to save the resulting meshes as a .3dm with model units.'
const EXPLODE_IN_RHINO = 'Use Explode in Rhino to turn block instances into placed objects.'
const TOO_COMPLEX =
  'This Rhino model exceeds the import complexity limit. Export fewer objects or use a coarser mesh.'

interface RhinoObjectLabel {
  name: string
  layer: string | null
}

interface RhinoSourceObject extends RhinoObjectLabel {
  rhinoContext?: RhinoContext
}

export interface RhinoMeshObject extends RhinoSourceObject {
  /** Binary STL in Rhino's world coordinates, converted to millimetres with Z up. */
  bytes: Uint8Array<ArrayBuffer>
  bounds: Bounds
  native?: RhinoNativePart
}

export interface RhinoNativePart {
  /** One solid BRep in millimetres, without the original document or block definition. */
  bytes: Uint8Array<ArrayBuffer>
  objectId: string
  /** The original Rhino instance object IDs, outside in. */
  instancePath: readonly string[]
  /** A block placement in millimetres, column-major. */
  transform?: Mat4
}

export interface RhinoCurveObject extends RhinoSourceObject, PlacedRhinoCurve {
  sourceObjectId?: string
}

export interface RhinoSkippedObject extends RhinoObjectLabel {
  reason: string
}

export interface RhinoImport {
  units: string
  objects: readonly RhinoMeshObject[]
  curves: readonly RhinoCurveObject[]
  skipped: readonly RhinoSkippedObject[]
}

interface RemainingGeometry {
  vertices: number
  triangles: number
  brepFaces: number
}

interface MeshPlacement {
  pointInMillimetres: (point: number[]) => number[]
  mirrored: boolean
}

interface BlockPlacement extends RhinoObjectLabel {
  stullerMaterial?: RhinoContext['stullerMaterial']
  world: Transform
  meshPlacement: MeshPlacement
  instancePath: readonly string[]
  groups: RhinoContext['groups']
  placements: RhinoContext['placements']
}

class SkippedGeometry extends Error {}

function withHandles<T>(read: (hold: <H extends object | null>(handle: H) => H) => T): T {
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

function validateArchive(bytes: Uint8Array): void {
  if (bytes.byteLength > MAX_RHINO_FILE_BYTES)
    throw new Error(`Rhino files are limited to ${MAX_FILE_MIB} MB. Export a smaller selection.`)

  const header = new TextDecoder().decode(bytes.subarray(0, 32))
  const version = Number(/^3D Geometry File Format +([0-9]+)$/.exec(header)?.[1])
  if (header.length !== 32 || !Number.isInteger(version) || version < 1)
    throw new Error('The selected file is not a Rhino .3dm file.')

  // Some Rhino 1 archives predate the end marker. In later archives it records the exact file size.
  if (version === 1) return
  const width = version < 50 ? 4 : 8
  const at = bytes.byteLength - (4 + width * 2)
  if (at < 32) throw new Error('The Rhino file is incomplete. Save or download it again.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const readSize = (offset: number) =>
    width === 4 ? view.getUint32(offset, true) : Number(view.getBigUint64(offset, true))
  if (
    view.getUint32(at, true) !== 0x7fff ||
    readSize(at + 4) !== width ||
    readSize(at + 4 + width) !== bytes.byteLength
  ) {
    throw new Error('The Rhino file is incomplete or damaged. Save or download it again.')
  }
}

function fileUnits(rhino: RhinoModule, units: UnitSystem): { name: string; mm: number } {
  // rhino3dm exposes OpenNURBS unit names in JS, but does not expose UnitScale.
  const u = rhino.UnitSystem
  const known = new Map<UnitSystem, [string, number]>([
    [u.Angstroms, ['angstroms', 1e-7]],
    [u.Nanometers, ['nanometres', 1e-6]],
    [u.Microns, ['microns', 1e-3]],
    [u.Millimeters, ['millimetres', 1]],
    [u.Centimeters, ['centimetres', 10]],
    [u.Decimeters, ['decimetres', 100]],
    [u.Meters, ['metres', 1e3]],
    [u.Dekameters, ['dekametres', 1e4]],
    [u.Hectometers, ['hectometres', 1e5]],
    [u.Kilometers, ['kilometres', 1e6]],
    [u.Megameters, ['megametres', 1e9]],
    [u.Gigameters, ['gigametres', 1e12]],
    [u.Microinches, ['microinches', 25.4e-6]],
    [u.Mils, ['mils', 0.0254]],
    [u.Inches, ['inches', 25.4]],
    [u.Feet, ['feet', 304.8]],
    [u.Yards, ['yards', 914.4]],
    [u.Miles, ['miles', 1609344]],
    [u.PrinterPoints, ['printer points', 25.4 / 72]],
    [u.PrinterPicas, ['printer picas', 25.4 / 6]],
    [u.NauticalMiles, ['nautical miles', 1852e3]],
    [u.AstronomicalUnits, ['astronomical units', 1.4959787e14]],
    [u.LightYears, ['light years', 9.4607304725808e18]],
    [u.Parsecs, ['parsecs', 3.08567758e19]],
  ])
  const knownUnit = known.get(units)
  if (!knownUnit)
    throw new Error(
      'This file has missing or custom units. Set standard model units in Rhino and save it again.',
    )
  return { name: knownUnit[0], mm: knownUnit[1] }
}

function blockPlacement(mm: number, world: Transform): MeshPlacement {
  const determinant = world.determinant()
  if (!world.isAffine || !Number.isFinite(determinant) || determinant === 0)
    throw new SkippedGeometry(`This Rhino block has an invalid placement. ${EXPLODE_IN_RHINO}`)
  const { m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23 } = world
  return {
    pointInMillimetres: ([x, y, z]) => [
      (m00 * x! + m01 * y! + m02 * z! + m03) * mm,
      (m10 * x! + m11 * y! + m12 * z! + m13) * mm,
      (m20 * x! + m21 * y! + m22 * z! + m23) * mm,
    ],
    mirrored: determinant < 0,
  }
}

function addTriangle(
  indices: Uint32Array,
  at: number,
  positions: Float32Array,
  a: number,
  b: number,
  c: number,
): void {
  const ax = positions[a * 3]!
  const ay = positions[a * 3 + 1]!
  const az = positions[a * 3 + 2]!
  const ux = positions[b * 3]! - ax
  const uy = positions[b * 3 + 1]! - ay
  const uz = positions[b * 3 + 2]! - az
  const vx = positions[c * 3]! - ax
  const vy = positions[c * 3 + 1]! - ay
  const vz = positions[c * 3 + 2]! - az
  if (uy * vz === uz * vy && uz * vx === ux * vz && ux * vy === uy * vx)
    throw new SkippedGeometry('The mesh contains a collapsed triangle in millimetres.')
  indices[at] = a
  indices[at + 1] = b
  indices[at + 2] = c
}

/** A triangle mesh is copied out of WASM before the document is freed. */
function readMesh(
  mesh: Mesh,
  placement: MeshPlacement,
  budget: RemainingGeometry,
): IndexedTriangles {
  return withHandles((hold) => {
    const vertices = hold(mesh.vertices())
    const faces = hold(mesh.faces())
    const vertexCount = vertices.count
    const faceCount = faces.count
    if (vertexCount < 3 || faceCount < 1)
      throw new SkippedGeometry('The mesh has no triangle geometry.')
    if (vertexCount > budget.vertices || faceCount > budget.triangles) throw new Error(TOO_COMPLEX)
    budget.vertices -= vertexCount

    // A quad has four distinct indices. Rhino stores a triangle as [a, b, c, c].
    for (let i = 0; i < faceCount; i++) {
      const corners = faces.get(i)
      if (
        corners.length !== 4 ||
        corners.some((v) => !Number.isInteger(v) || v < 0 || v >= vertexCount)
      )
        throw new SkippedGeometry('The mesh has a face with invalid vertex indices.')
    }
    const quadCount = faces.quadCount
    const triangleCount = faceCount + quadCount
    if (triangleCount > budget.triangles) throw new Error(TOO_COMPLEX)
    budget.triangles -= triangleCount
    if (quadCount > 0 && !faces.convertQuadsToTriangles())
      throw new SkippedGeometry('Rhino could not triangulate a polygon in this mesh.')
    if (faces.count !== triangleCount)
      throw new SkippedGeometry('Some mesh faces could not be triangulated.')

    const positions = new Float32Array(vertexCount * 3)
    for (let i = 0; i < vertexCount; i++) {
      const point = placement.pointInMillimetres(vertices.point3dAt(i))
      for (let k = 0; k < 3; k++) {
        const value = Math.fround(point[k]!)
        if (!Number.isFinite(value))
          throw new SkippedGeometry('The mesh has invalid vertex coordinates.')
        positions[i * 3 + k] = value
      }
    }
    const indices = new Uint32Array(triangleCount * 3)
    for (let i = 0; i < triangleCount; i++) {
      const [a, b, c] = faces.get(i)
      // Reflection changes orientation. The original winding still describes the same side.
      if (placement.mirrored) addTriangle(indices, i * 3, positions, a!, c!, b!)
      else addTriangle(indices, i * 3, positions, a!, b!, c!)
    }
    return { positions, indices }
  })
}

function readBrep(
  rhino: RhinoModule,
  brep: Brep,
  placement: MeshPlacement,
  budget: RemainingGeometry,
): IndexedTriangles[] {
  return withHandles((hold) => {
    const faces = hold(brep.faces())
    const faceCount = faces.count
    if (faceCount > budget.brepFaces) throw new Error(TOO_COMPLEX)
    budget.brepFaces -= faceCount
    const missing = () =>
      new SkippedGeometry(`The BRep lacks a complete saved render mesh. ${MESH_IN_RHINO}`)
    if (faceCount < 1) throw missing()
    const meshes: IndexedTriangles[] = []
    for (let i = 0; i < faceCount; i++) {
      meshes.push(
        withHandles((holdFace) => {
          const face = holdFace(faces.get(i))
          const mesh = holdFace(face.getMesh(rhino.MeshType.Render))
          if (!mesh) throw missing()
          return readMesh(mesh, placement, budget)
        }),
      )
    }
    return meshes
  })
}

function objectMeshes(
  rhino: RhinoModule,
  geometry: GeometryBase,
  placement: MeshPlacement,
  budget: RemainingGeometry,
): IndexedTriangles[] {
  if (geometry instanceof rhino.Mesh) return [readMesh(geometry, placement, budget)]
  if (geometry instanceof rhino.Brep) return readBrep(rhino, geometry, placement, budget)
  if (geometry instanceof rhino.Extrusion)
    return withHandles((hold) => {
      const mesh = hold(geometry.getMesh(rhino.MeshType.Render))
      if (mesh) return [readMesh(mesh, placement, budget)]
      throw new SkippedGeometry(`The extrusion lacks a saved render mesh. ${MESH_IN_RHINO}`)
    })
  if (geometry instanceof rhino.Curve) throw new SkippedGeometry('Rhino curve.')
  if (geometry instanceof rhino.Point || geometry instanceof rhino.PointCloud)
    throw new SkippedGeometry('Rhino point or point cloud.')
  if (geometry instanceof rhino.Surface || geometry instanceof rhino.SubD)
    throw new SkippedGeometry(`This Rhino surface has no supported mesh. ${MESH_IN_RHINO}`)
  throw new SkippedGeometry('Unsupported Rhino object type.')
}

function meshBounds(meshes: readonly IndexedTriangles[]): Bounds {
  const min: Bounds['min'] = [Infinity, Infinity, Infinity]
  const max: Bounds['max'] = [-Infinity, -Infinity, -Infinity]
  for (const { indices, positions } of meshes) {
    for (const index of indices) {
      for (const axis of [0, 1, 2] as const) {
        const point = positions[index * 3 + axis]!
        min[axis] = Math.min(min[axis], point)
        max[axis] = Math.max(max[axis], point)
      }
    }
  }
  return { min, max }
}

function readLayer(
  layers: File3dmLayerTable,
  index: number,
  visibleById: Map<string, boolean>,
): { path: string | null; visible: boolean; materialIndex: number | undefined } {
  return withHandles((hold) => {
    const layer = hold(layers.findIndex(index))
    const visited = new Set<string>()
    let current: Layer | null = layer
    let visible = true
    while (current) {
      const id = current.id
      const cached = visibleById.get(id)
      if (cached !== undefined) {
        visible = cached
        break
      }
      if (!current.visible || visited.has(id)) {
        visible = false
        visibleById.set(id, visible)
        break
      }
      visited.add(id)
      const parent: string = current.parentLayerId
      current =
        parent === '00000000-0000-0000-0000-000000000000' ? null : hold(layers.findId(parent))
    }
    for (const id of visited) visibleById.set(id, visible)
    return {
      path: layer?.fullPath?.trim() || layer?.name?.trim() || null,
      visible,
      materialIndex: layer?.renderMaterialIndex,
    }
  })
}

function blockMatrix(t: Transform, mm: number): Mat4 {
  return [
    t.m00,
    t.m10,
    t.m20,
    0,
    t.m01,
    t.m11,
    t.m21,
    0,
    t.m02,
    t.m12,
    t.m22,
    0,
    t.m03 * mm,
    t.m13 * mm,
    t.m23 * mm,
    1,
  ]
}

interface NativeArchive {
  bytes: Uint8Array<ArrayBuffer>
  topology: string
}

function writeNativePart(
  rhino: RhinoModule,
  geometry: GeometryBase,
  millimetres: number,
): NativeArchive | null {
  if (!(geometry instanceof rhino.Brep || geometry instanceof rhino.Extrusion) || !geometry.isSolid)
    return null
  return withHandles((hold) => {
    const brep = hold(
      geometry instanceof rhino.Extrusion ? geometry.toBrep(true) : (geometry.duplicate() as Brep),
    )
    if (!brep?.isSolid) return null
    if (millimetres !== 1 && !brep.transform(hold(rhino.Transform.scale([0, 0, 0], millimetres))))
      return null
    if (!brep.isValid) return null

    const doc = hold(new rhino.File3dm())
    hold(doc.settings()).modelUnitSystem = rhino.UnitSystem.Millimeters
    const objects = hold(doc.objects())
    const attrs = hold(new rhino.ObjectAttributes())
    objects.addBrep(brep, attrs)
    if (objects.count !== 1) return null
    const opts = hold(new rhino.File3dmWriteOptions())
    opts.saveUserData = false
    const kind = geometry instanceof rhino.Extrusion ? 'Extrusion' : 'Brep'
    const counts = [hold(brep.faces()).count, hold(brep.edges()).count, hold(brep.vertices()).count]
    return { bytes: doc.toByteArrayOptions(opts).slice(), topology: [kind, ...counts].join(':') }
  })
}

/** Reads native Rhino meshes and complete render caches without changing their placement. */
export async function readRhino3dm(
  bytes: Uint8Array,
  { includeCurves = false }: { includeCurves?: boolean } = {},
): Promise<RhinoImport> {
  validateArchive(bytes)
  const rhino = await loadRhino3dm()
  return withHandles((hold) => {
    let doc: File3dm
    try {
      doc = hold(rhino.File3dm.fromByteArray(bytes))
      if (!doc) throw new Error('OpenNURBS could not read the archive')
    } catch (cause) {
      throw new Error('The Rhino file could not be read. Save or download it again.', { cause })
    }
    const objects = hold(doc.objects())
    const count = objects.count
    if (count > MAX_OBJECTS) throw new Error(TOO_COMPLEX)
    const layers = hold(doc.layers())
    const definitions = hold(doc.instanceDefinitions())
    const settings = hold(doc.settings())
    const units = fileUnits(rhino, settings.modelUnitSystem)
    const result: RhinoMeshObject[] = []
    const curves: RhinoCurveObject[] = []
    const skipped: RhinoSkippedObject[] = []
    const layerInfo = new Map<number, ReturnType<typeof readLayer>>()
    const visibleById = new Map<string, boolean>()
    const nativeById = new Map<string, NativeArchive | null>()
    let nativeBytes = 0
    const budget: RemainingGeometry = {
      vertices: MAX_VERTICES,
      triangles: MAX_TRIANGLES,
      brepFaces: MAX_BREP_FACES,
    }

    const filePlacement: MeshPlacement = {
      pointInMillimetres: (point) => point.map((coordinate) => coordinate * units.mm),
      mirrored: false,
    }
    const activeDefinitions = new Set<string>()
    const unnamedPartsByLayer = new Map<string | null, number>()
    let visitedObjects = 0

    const readObject = (
      getObject: () => File3dmObject,
      ordinal: number,
      parent?: BlockPlacement,
    ): void => {
      withHandles((holdObject) => {
        const object = holdObject(getObject())
        const attrs = object && holdObject(object.attributes())
        // Definition members have local coordinates. They only belong to placed references.
        if (!parent && attrs?.isInstanceDefinitionObject) return
        if (++visitedObjects > MAX_OBJECTS) throw new Error(TOO_COMPLEX)

        const layerIndex = attrs?.layerIndex ?? -1
        let info = layerInfo.get(layerIndex)
        if (!info) {
          info = readLayer(layers, layerIndex, visibleById)
          layerInfo.set(layerIndex, info)
        }
        if (attrs?.mode === rhino.ObjectMode.Hidden || !info.visible) return
        const layer = info.path ?? parent?.layer ?? null
        const objectName = attrs?.name?.trim()
        const layerName = layer?.split('::').at(-1)
        const fallbackName = layerName || `Rhino object ${ordinal}`
        const inContext = (label: string) => (parent ? `${parent.name} / ${label}` : label)
        let name = inContext(objectName || fallbackName)
        try {
          if (parent && !attrs?.isInstanceDefinitionObject)
            throw new SkippedGeometry(
              'The block references a missing or invalid definition member.',
            )
          if (attrs?.activeSpace === rhino.ActiveSpace.PageSpace)
            throw new SkippedGeometry('Rhino layout object outside model space.')
          const geometry = object && holdObject(object.geometry())
          if (!geometry) throw new SkippedGeometry('The object has no readable geometry.')
          const groups = context.groups(attrs, parent?.groups)
          const parentPlacements = parent?.placements ?? []
          const savedPlacements = context.savedPlacements(attrs, parentPlacements)
          const material = context.material(attrs, info.materialIndex)
          const stullerMaterial =
            readStullerMaterial(attrs) ??
            (material.materialFromParent ? parent?.stullerMaterial : undefined)
          if (geometry instanceof rhino.InstanceReference) {
            const definitionId = geometry.parentIdefId
            const definition = holdObject(definitions.findId(definitionId))
            const blockName = definition?.name?.trim()
            name = inContext(
              objectName || (blockName ? `${blockName} ${ordinal}` : `Block ${ordinal}`),
            )
            const ids = definition?.getObjectIds()
            // Linked definitions may have no embedded geometry. Never follow their external path.
            if (!Array.isArray(ids) || !ids.length)
              throw new SkippedGeometry(
                `This block has no embedded definition geometry. ${EXPLODE_IN_RHINO}`,
              )
            if (ids.length > MAX_OBJECTS) throw new Error(TOO_COMPLEX)
            if (activeDefinitions.has(definitionId) || activeDefinitions.size >= MAX_BLOCK_DEPTH)
              throw new SkippedGeometry(
                `This block is circular or too deeply nested. ${EXPLODE_IN_RHINO}`,
              )

            const relative = holdObject(geometry.xform)
            const world = parent
              ? holdObject(rhino.Transform.multiply(parent.world, relative))
              : relative
            const childPlacement = {
              stullerMaterial,
              world,
              name,
              layer,
              meshPlacement: blockPlacement(units.mm, world),
              instancePath: [...(parent?.instancePath ?? []), attrs?.id ?? ''],
              groups,
              placements:
                savedPlacements ??
                context.placement(
                  attrs?.id ?? '',
                  definitionId,
                  info.path,
                  material,
                  parentPlacements,
                ),
            }
            activeDefinitions.add(definitionId)
            try {
              for (const [i, id] of ids.entries()) {
                readObject(() => objects.findId(id), i + 1, childPlacement)
              }
            } finally {
              activeDefinitions.delete(definitionId)
            }
            return
          }
          const placements = savedPlacements ?? parentPlacements
          const inheritedAppearance = inheritedMaterialAppearance(placements)
          // The material on a baked member may have been projected from its archived occurrence.
          const inherited =
            savedPlacements &&
            attrs?.getUserString(RHINO_INHERITED_MATERIAL) === '1' &&
            material.material === inheritedMaterial(placements) &&
            material.materialAppearance?.color === inheritedAppearance?.color &&
            Math.abs(
              (material.materialAppearance?.opacity ?? 1) - (inheritedAppearance?.opacity ?? 1),
            ) < 1e-12
          const rhinoContext: RhinoContext | undefined =
            groups.length ||
            placements.length ||
            material.material ||
            material.materialAppearance ||
            material.materialFromParent ||
            stullerMaterial
              ? {
                  archiveId: context.archiveId,
                  groups,
                  placements,
                  ...(stullerMaterial && { stullerMaterial }),
                  ...(inherited ? { materialFromParent: true } : material),
                }
              : undefined
          const placement = parent?.meshPlacement ?? filePlacement
          if (includeCurves && geometry instanceof rhino.Curve) {
            const curve = readPlacedCurve(rhino, geometry, placement.pointInMillimetres)
            if (curve.controlPoints.length > budget.vertices) throw new Error(TOO_COMPLEX)
            budget.vertices -= curve.controlPoints.length
            const savedId = attrs?.getUserString(CURVE_SOURCE_ID_KEY)
            const sourceObjectId =
              savedId && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(savedId)
                ? savedId
                : attrs?.id
            curves.push({
              ...curve,
              name: objectName || inContext(`Curve ${ordinal}`),
              layer,
              ...(sourceObjectId && { sourceObjectId }),
              ...(rhinoContext && { rhinoContext }),
            })
            return
          }
          const meshes = objectMeshes(rhino, geometry, placement, budget)
          const objectId = attrs?.id
          let native: RhinoNativePart | undefined
          let topology: string | undefined
          if (objectId) {
            let archived = nativeById.get(objectId)
            if (archived === undefined) {
              archived = writeNativePart(rhino, geometry, units.mm)
              nativeById.set(objectId, archived)
              nativeBytes += archived?.bytes.byteLength ?? 0
              if (nativeBytes > MAX_RHINO_FILE_BYTES) throw new Error(TOO_COMPLEX)
            }
            if (archived) {
              topology = archived.topology
              native = {
                bytes: archived.bytes,
                objectId,
                instancePath: parent?.instancePath ?? [],
                ...(parent && { transform: blockMatrix(parent.world, units.mm) }),
              }
            }
          }
          if (!objectName) {
            const partNumber = (unnamedPartsByLayer.get(layer) ?? 0) + 1
            unnamedPartsByLayer.set(layer, partNumber)
            const context = layerName ? inContext(layerName) : parent?.name
            // Keep the distinguishing number visible in a truncated outliner label.
            name = context ? `Part ${partNumber} (${context})` : `Part ${partNumber}`
          }
          result.push({
            name,
            layer,
            bytes: writeStl(meshes, 'Pave STL from Rhino .3dm, millimetres'),
            bounds: meshBounds(meshes),
            ...(native && { native }),
            ...(topology
              ? {
                  rhinoContext: {
                    ...rhinoContext,
                    archiveId: context.archiveId,
                    groups,
                    placements,
                    topology,
                  },
                }
              : rhinoContext && { rhinoContext }),
          })
        } catch (error) {
          if (!(error instanceof SkippedGeometry || error instanceof RhinoCurveReadError))
            throw error
          skipped.push({ name, layer, reason: error.message })
        }
      })
    }

    const context = rhinoContextReader(rhino, doc)
    try {
      for (let i = 0; i < count; i++) readObject(() => objects.get(i), i + 1)
    } finally {
      context.dispose()
    }
    return { units: units.name, objects: result, curves, skipped }
  })
}
