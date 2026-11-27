import { deepStrictEqual, ok } from 'node:assert/strict'
import { pointOnNurbs } from '@pave/schema'
import type { Brep, Curve, File3dm, RhinoModule } from 'rhino3dm'
import { addScaled, dot, normalize, sub, type Vec3 } from '../geometry/vec'
import type { RhinoMeshObject, RhinoNativePart } from '../import/rhino'
import { listRhinoCapFaces, offsetRhinoCap, type RhinoCapFace } from '../import/rhino-cap'
import { inspectRhinoEdges } from '../import/rhino-edges'
import { archive, handles } from './rhino-archive'

type NativePart = RhinoMeshObject & { native: RhinoNativePart }
type Place = (point: readonly number[]) => Vec3

const edgeFractions = [0, 0.0625, 0.17, 0.31, 0.5, 0.66, 0.83, 0.94, 1]
const trimFractions = [0, 0.2, 0.4, 0.6, 0.8, 1]
const maxEdgesScanned = 128
const offsetMm = 0.25
const toleranceMm = 1e-6

const xyz = (p: readonly number[]): Vec3 => [p[0]!, p[1]!, p[2]!]
const distance = (a: Vec3, b: Vec3) => Math.hypot(...sub(a, b))
const interpolate = (start: number, end: number, fraction: number) =>
  fraction === 1 ? end : start + (end - start) * fraction

export function retainedParts(parts: readonly RhinoMeshObject[]): NativePart[] {
  return parts.filter((part): part is NativePart => !!part.native)
}

function originalSolid<T>(
  rhino: RhinoModule,
  doc: File3dm,
  { objectId, instancePath }: RhinoNativePart,
  unitMm: number,
  read: (solid: Brep, place: Place) => T,
): T {
  return handles((hold) => {
    const objects = hold(doc.objects())
    const definitions = hold(doc.instanceDefinitions())
    const path = [...instancePath, objectId]
    const transforms = instancePath.map((id, i) => {
      const object = hold(objects.findId(id))
      ok(
        hold(object.attributes()).isInstanceDefinitionObject === i > 0,
        'Archived block placement did not start at a top-level instance.',
      )
      const instance = hold(object.geometry())
      ok(instance instanceof rhino.InstanceReference, 'Expected an archived block instance.')
      const definition = hold(definitions.findId(instance.parentIdefId))
      const members = definition?.getObjectIds()
      ok(
        Array.isArray(members) && members.includes(path[i + 1]),
        'Archived block membership changed.',
      )
      return hold(instance.xform)
    })
    const object = hold(objects.findId(objectId))
    const attrs = hold(object.attributes())
    ok(
      attrs.id === objectId && attrs.isInstanceDefinitionObject === !!transforms.length,
      'Retained source did not resolve to its archived solid.',
    )
    const geometry = hold(object.geometry())
    const brep = geometry instanceof rhino.Extrusion ? hold(geometry.toBrep(true)) : geometry
    ok(
      brep instanceof rhino.Brep && brep.isSolid,
      'Expected a closed solid in the original archive.',
    )
    transforms.reverse()
    return read(brep, (point) => {
      let [x, y, z] = xyz(point)
      for (const t of transforms)
        [x, y, z] = [
          t.m00 * x + t.m01 * y + t.m02 * z + t.m03,
          t.m10 * x + t.m11 * y + t.m12 * z + t.m13,
          t.m20 * x + t.m21 * y + t.m22 * z + t.m23,
        ]
      return [x * unitMm, y * unitMm, z * unitMm]
    })
  })
}

function edgeSamples(edge: Curve, place: Place) {
  const [start, end] = edge.domain as [number, number]
  return edgeFractions.map((fraction) => {
    const parameter = interpolate(start, end, fraction)
    // The source can be an analytic arc with a different parameterization from its NURBS form.
    const [mapped, nurbsParameter] = edge.getNurbsFormParameterFromCurveParameter(parameter) as [
      boolean,
      number,
    ]
    return {
      position: place(edge.pointAt(parameter)),
      fraction: mapped ? (nurbsParameter - start) / (end - start) : fraction,
    }
  })
}

function originalEdges(rhino: RhinoModule, doc: File3dm, part: NativePart, unitMm: number) {
  return originalSolid(rhino, doc, part.native, unitMm, (solid, place) =>
    handles((hold) => {
      const edges = hold(solid.edges())
      const choices = new Map<'line' | 'curve' | 'rational', number>()
      for (let index = 0; index < Math.min(edges.count, maxEdgesScanned); index++) {
        handles((keep) => {
          const edge = keep(edges.get(index))
          if (edge.degree === 1 && edge.spanCount === 1 && !edge.isClosed) {
            if (!choices.has('line')) choices.set('line', index)
          } else if (!choices.has('rational')) {
            if (keep(edge.toNurbsCurve())?.isRational) choices.set('rational', index)
            else if (!choices.has('curve')) choices.set('curve', index)
          }
        })
        if (choices.has('line') && choices.has('rational')) break
      }
      const samples = new Map<number, ReturnType<typeof edgeSamples>>()
      const curved = choices.get('rational') ?? choices.get('curve')
      for (const index of [choices.get('line'), curved])
        if (index !== undefined) samples.set(index, edgeSamples(hold(edges.get(index)), place))
      return {
        edgeCount: edges.count,
        samples,
        line: choices.get('line'),
        rational: choices.get('rational'),
      }
    }),
  )
}

export async function probeNativeEdges(
  rhino: RhinoModule,
  original: Uint8Array,
  parts: readonly NativePart[],
  unitMm: number,
) {
  if (!parts.length) return { status: 'not run: no retained native solid' }
  const selected = [
    parts.find(({ native }) => !native.instancePath.length),
    parts.find(({ native }) => native.instancePath.length),
  ].filter((part) => part !== undefined)
  const references = archive(rhino, original, (doc) =>
    selected.map((part) => originalEdges(rhino, doc, part, unitMm)),
  )
  let linearEdges = 0
  let nonlinearEdges = 0
  let rationalEdges = 0
  let samples = 0
  let maxErrorMm = 0
  for (const [i, part] of selected.entries()) {
    const reference = references[i]!
    ok(reference.samples.size, 'The archived solid has no sampleable edges.')
    for (const [edgeIndex, expected] of reference.samples) {
      const { curve, edgeCount, edges } = await inspectRhinoEdges(part.native.bytes, {
        nativeTransform: part.native.transform,
        edgeIndex,
      })
      ok(
        curve &&
          edgeCount === reference.edgeCount &&
          edges.length === 1 &&
          edges[0]?.edgeIndex === edgeIndex,
        'Expected one exact curve for the archived edge.',
      )
      const rational = curve.controlPoints.some(([, , , weight]) => weight !== 1)
      if (edgeIndex === reference.rational)
        ok(rational, 'The exact edge lost its rational weights.')
      if (rational) rationalEdges++
      if (edgeIndex === reference.line) linearEdges++
      else nonlinearEdges++
      const start = curve.knots[curve.degree - 1]!
      const end = curve.knots[curve.controlPoints.length - 1]!
      for (const { fraction, position } of expected) {
        const actual = pointOnNurbs(curve, interpolate(start, end, fraction))
        const error = distance(position, actual)
        ok(error <= toleranceMm, `The exact curve differs from the archived edge by ${error} mm.`)
        maxErrorMm = Math.max(maxErrorMm, error)
        samples++
      }
    }
  }
  return {
    status: 'passed',
    partsChecked: selected.length,
    placedPartsChecked: selected.filter(({ native }) => native.instancePath.length).length,
    linearEdges,
    nonlinearEdges,
    rationalEdges,
    samples,
    maxErrorMm,
  }
}

function capTrim(solid: Brep, index: number, place: Place) {
  return handles((hold) => {
    const face = hold(hold(solid.faces()).get(index))
    const u = face.domain(0)
    const v = face.domain(1)
    const normal = xyz(face.normalAt((u[0]! + u[1]!) / 2, (v[0]! + v[1]!) / 2))
    const origin = place([0, 0, 0])
    const loops = hold(face.loops)
    const edges = hold(solid.edges())
    const topology = Array.from({ length: loops.count }, (_, i) =>
      handles((take) => {
        const loop = take(loops.get(i))
        const trims = take(loop.trims)
        const indices = Array.from({ length: trims.count }, (_, j) => take(trims.get(j)).edgeIndex)
        return { type: loop.loopType, indices }
      }),
    )
    const samples = topology.flatMap(({ indices }) =>
      indices.flatMap((edgeIndex) =>
        handles((take) => {
          const edge = take(edges.get(edgeIndex))
          const [start, end] = edge.domain as [number, number]
          return trimFractions.map((f) => place(edge.pointAt(interpolate(start, end, f))))
        }),
      ),
    )
    ok(samples.length, 'Expected trim boundaries on the native end face.')
    return { topology, samples, normal: normalize(sub(place(normal), origin)) }
  })
}

function trimMotion(
  before: ReturnType<typeof capTrim>,
  after: ReturnType<typeof capTrim>,
  normal: Vec3,
  offset: number,
) {
  deepStrictEqual(after.topology, before.topology, 'Native cap trim loops changed.')
  let maxErrorMm = 0
  for (const [i, point] of before.samples.entries()) {
    const error = distance(after.samples[i]!, addScaled(point, normal, offset))
    ok(error <= toleranceMm, `A native cap trim boundary differs by ${error} mm.`)
    maxErrorMm = Math.max(maxErrorMm, error)
  }
  return maxErrorMm
}

async function checkCap(
  rhino: RhinoModule,
  original: Uint8Array,
  part: NativePart,
  unitMm: number,
  cap: RhinoCapFace,
) {
  const { native } = part
  const [beforeMoved, beforeFixed] = archive(rhino, original, (doc) =>
    originalSolid(rhino, doc, native, unitMm, (solid, place) => [
      capTrim(solid, cap.faceIndex, place),
      capTrim(solid, cap.oppositeFaceIndex, place),
    ]),
  )
  const separation = sub(beforeMoved.samples[0]!, beforeFixed.samples[0]!)
  const normal =
    dot(separation, beforeMoved.normal) < 0
      ? addScaled([0, 0, 0], beforeMoved.normal, -1)
      : beforeMoved.normal
  const beforeSpanMm = dot(separation, normal)
  ok(
    beforeSpanMm > 0 && Math.abs(beforeSpanMm - cap.spanMm) <= toleranceMm,
    'Advertised cap span differs from the archived trim boundaries.',
  )
  ok(
    beforeMoved.topology.length === cap.innerLoops + 1 &&
      beforeFixed.topology.length === cap.innerLoops + 1,
    'Advertised cap loop count differs from the original trim topology.',
  )
  const edited = await offsetRhinoCap(
    native.bytes,
    part.bytes,
    native.transform,
    cap.faceIndex,
    offsetMm,
  )
  return archive(rhino, edited.nativeBytes, (doc, hold) => {
    const objects = hold(doc.objects())
    ok(
      objects.count === 1 && hold(doc.settings()).modelUnitSystem === rhino.UnitSystem.Millimeters,
      'Expected one edited native solid in millimetres.',
    )
    const solid = hold(hold(objects.get(0)).geometry())
    ok(
      solid instanceof rhino.Brep && solid.isValid && solid.isSolid && solid.isManifold,
      'Expected a valid closed BRep after the native cap move.',
    )
    const moved = capTrim(solid, cap.faceIndex, xyz)
    const fixed = capTrim(solid, cap.oppositeFaceIndex, xyz)
    const movedEndMaxErrorMm = trimMotion(beforeMoved, moved, normal, offsetMm)
    const fixedEndMaxErrorMm = trimMotion(beforeFixed, fixed, normal, 0)
    const afterSpanMm = dot(sub(moved.samples[0]!, fixed.samples[0]!), normal)
    ok(
      Math.abs(afterSpanMm - beforeSpanMm - offsetMm) <= toleranceMm,
      'Native cap edit did not increase the trimmed span by 0.25 mm.',
    )
    return {
      beforeSpanMm,
      afterSpanMm,
      fixedEndMaxErrorMm,
      movedEndMaxErrorMm,
      innerLoops: beforeMoved.topology.length - 1,
      samples: moved.samples.length + fixed.samples.length,
    }
  })
}

export async function probeNativeCaps(
  rhino: RhinoModule,
  original: Uint8Array,
  parts: readonly NativePart[],
  unitMm: number,
) {
  if (!parts.length) return { status: 'not run: no retained native solid', candidatesChecked: 0 }
  const bySource = new Map<string, NativePart[]>()
  for (const part of parts) {
    const group = bySource.get(part.native.objectId)
    if (group) group.push(part)
    else bySource.set(part.native.objectId, [part])
  }
  let candidatesChecked = 0
  let selected: { part: NativePart; cap: RhinoCapFace } | undefined
  // Import bounds the number of objects and total retained bytes. Probe each distinct source
  // once and stop once we have an eligible cap with a hole, keeping a solid cap as a fallback.
  for (const group of bySource.values()) {
    candidatesChecked++
    const unplaced = await listRhinoCapFaces(group[0]!.native.bytes)
    if (!unplaced.length) continue
    for (const part of group) {
      const { native } = part
      let caps: RhinoCapFace[]
      try {
        caps = native.transform ? await listRhinoCapFaces(native.bytes, native.transform) : unplaced
      } catch (error) {
        // An affine block can have an exact edge but is ineligible for the cap tool.
        if (error instanceof Error && error.message.includes('uniform scale without shear'))
          continue
        throw error
      }
      const cap = caps.find(({ innerLoops }) => innerLoops > 0) ?? caps[0]
      if (cap && (!selected || cap.innerLoops)) selected = { part, cap }
      if (cap) break
    }
    if (selected?.cap.innerLoops) break
  }
  if (!selected) return { status: 'not run: no eligible end caps', candidatesChecked }
  return {
    status: 'passed',
    candidatesChecked,
    ...(await checkCap(rhino, original, selected.part, unitMm, selected.cap)),
  }
}
