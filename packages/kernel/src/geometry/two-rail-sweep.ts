import { type NodeOf, type NurbsControlPoint, pointFromCurvePlane } from '@pave/schema'
import { assembleWire, makeLine, makeSolid, type Shape3D, Shell, type Wire } from 'replicad'
import { type BuildContext, runtime } from '../core'
import { type ClosestHit, TriangleBvh } from '../mesh/bvh'
import { scoped, shapeVolume, tessellateShape, wrapShape } from '../solid/occt'
import {
  type CurveInput,
  crossRail,
  type RailPath,
  railParameter,
  railPath,
  railTangent,
  reverseRail,
} from './rail-path'
import { curveWire } from './section-wires'
import {
  add,
  addScaled,
  cross,
  distance,
  dot,
  type Frame,
  fromFrame,
  IDENTITY,
  length,
  lerp,
  lerp3,
  normalize,
  scale,
  sub,
  toFrame,
  transformPoint,
  type Vec3,
} from './vec'

interface SweepCurve {
  source: CurveInput
  wire: Wire
  closed: boolean
}
interface OriginalProfile {
  points: Vec3[]
  weights: number[]
  nurbs?: NodeOf<'nurbsCurve'>
}
interface ProfileStation extends OriginalProfile {
  t: number
  s: number
  tilt: Vec3
}
interface GuideStation {
  t: number
  s: number
  frame: Frame
  width: number
}

const CONTACT = 1e-5
const FOLLOW = 0.008
const END_EPSILON = 1e-7
const MAX_STATIONS = 384

function originalProfile({ source: { node, matrix }, closed }: SweepCurve): OriginalProfile {
  if (node.kind === 'curve') {
    const points = node.points.map(({ u, v }) =>
      transformPoint(matrix, pointFromCurvePlane(node.plane, [u, v], node.planeOffset)),
    )
    return { points, weights: points.map(() => 1) }
  }
  if (node.kind !== 'nurbsCurve') throw new Error('Select a construction or NURBS section curve.')
  const points = node.controlPoints.map(([x, y, z]) => transformPoint(matrix, [x, y, z]))
  if (node.degree === 1) {
    if (closed) points.pop()
    return { points, weights: points.map(() => 1) }
  }
  return { points, weights: node.controlPoints.map((p) => p[3]), nurbs: node }
}

/** A guide touches a section at exactly one point on its boundary. */
function contact(rail: SweepCurve, section: SweepCurve, path: RailPath, label: string): number {
  const { oc } = runtime()
  const point = scoped((own) => {
    const check = own(new oc.BRepExtrema_DistShapeShape())
    check.LoadS1(rail.wire.wrapped)
    check.LoadS2(section.wire.wrapped)
    if (!check.Perform() || check.Value() > CONTACT || check.NbSolution() === 0)
      throw new Error(
        `Section “${section.source.node.name ?? section.source.node.id}” must touch the ${label} rail.`,
      )
    const points = Array.from({ length: check.NbSolution() }, (_, i): Vec3 => {
      const p = own(check.PointOnShape1(i + 1))
      return [p.X(), p.Y(), p.Z()]
    })
    if (points.some((p) => distance(p, points[0]!) > CONTACT))
      throw new Error(`Each section must touch the ${label} rail at only one point.`)
    return points[0]!
  })
  return railParameter(path, point)
}

function guideFrame(p: Vec3, q: Vec3, normal: Vec3): Frame {
  const across = sub(q, p)
  if (length(across) <= CONTACT) throw new Error('The two rails cross or touch.')
  const x = normalize(across)
  const y = cross(normal, x)
  if (length(y) < 0.1) throw new Error('The rails do not define a stable section plane.')
  const vertical = normalize(y)
  return { origin: p, x, y: vertical, z: cross(x, vertical) }
}

function profileStation(
  profile: OriginalProfile,
  primary: Pick<RailPath, 'at'>,
  secondary: Pick<RailPath, 'at'>,
  t: number,
  s: number,
): ProfileStation {
  const p = primary.at(t)
  const q = secondary.at(s)
  const tangent = railTangent(primary, t)
  const x = normalize(sub(q, p))
  // All poles of a planar rational spline lie in its plane. A straight open section uses
  // the rail tangent to resolve the one remaining orientation angle.
  const normals = profile.points.map((point) => cross(x, sub(point, p)))
  const plane = normals.reduce((a, b) => (length(a) >= length(b) ? a : b))
  const sign = dot(plane, tangent) < 0 ? -1 : 1
  const frame = guideFrame(p, q, length(plane) > CONTACT ? normalize(scale(plane, sign)) : tangent)
  if (dot(frame.z, tangent) <= 0.05)
    throw new Error('A section plane is nearly parallel to the first rail.')
  const width = distance(p, q)
  const points = profile.points.map((point): Vec3 => {
    const [x, y, z] = toFrame(frame, point)
    if (Math.abs(z) > CONTACT) throw new Error('Two-rail sweep needs planar sections.')
    return [x / width, y, 0]
  })
  return { ...profile, points, t, s, tilt: sub(frame.z, tangent) }
}

function alignProfile(
  first: OriginalProfile,
  next: ProfileStation,
  closed: boolean,
): ProfileStation {
  if (first.points.length !== next.points.length || first.nurbs?.degree !== next.nurbs?.degree)
    throw new Error('Two-rail sections need matching segment counts or matching NURBS structures.')
  if (first.nurbs && next.nurbs) {
    const normalizedKnots = ({ knots }: NodeOf<'nurbsCurve'>) =>
      knots.map((k) => (k - knots[0]!) / (knots.at(-1)! - knots[0]!))
    const expected = normalizedKnots(first.nurbs)
    if (normalizedKnots(next.nurbs).some((k, i) => Math.abs(k - expected[i]!) > 1e-9))
      throw new Error('Two-rail NURBS sections need matching knot spacing.')
    return next
  }
  const count = next.points.length
  let best = next.points
  let score = Infinity
  for (const direction of [1, -1]) {
    const starts = closed
      ? Array.from({ length: count }, (_, i) => i)
      : [direction === 1 ? 0 : count - 1]
    for (const start of starts) {
      const points = next.points.map(
        (_, i) => next.points[(start + direction * i + count) % count]!,
      )
      const error = points.reduce(
        (sum, point, i) => sum + distance(point, first.points[i]!) ** 2,
        0,
      )
      if (error < score) {
        score = error
        best = points
      }
    }
  }
  return { ...next, points: best }
}

function makeSection(
  station: GuideStation,
  a: ProfileStation,
  b: ProfileStation,
  closed: boolean,
  track: BuildContext['track'],
): Wire {
  const fraction = a === b ? 0 : Math.min(1, Math.max(0, (station.t - a.t) / (b.t - a.t)))
  const points = a.points.map((point, i) => {
    const [x, y] = lerp3(point, b.points[i]!, fraction)
    return fromFrame(station.frame, [x * station.width, y, 0])
  })
  if (a.nurbs) {
    const controlPoints = points.map(
      (p, i): NurbsControlPoint => [...p, lerp(a.weights[i]!, b.weights[i]!, fraction)],
    )
    return curveWire({ node: { ...a.nurbs, controlPoints }, matrix: IDENTITY }, track).wire
  }
  const edges = points
    .slice(0, closed ? points.length : -1)
    .map((p, i) => track(makeLine([...p], [...points[(i + 1) % points.length]!])))
  return track(assembleWire(edges))
}

function verifyFollowing(shape: Shape3D, inputs: Array<{ path: RailPath; label: string }>): void {
  const mesh = tessellateShape(shape, { chord: 0.0015, angle: 0.12 })
  const bvh = new TriangleBvh(mesh)
  const hit: ClosestHit = { x: 0, y: 0, z: 0, d2: Infinity, triangle: -1 }
  for (const { path, label } of inputs) {
    for (const [i, { t, point }] of path.samples.entries()) {
      const next = path.samples[i + 1]
      const middle = next && path.at((t + next.t) / 2)
      if (!bvh.closest(...point, hit, FOLLOW) || (middle && !bvh.closest(...middle, hit, FOLLOW)))
        throw new Error(
          `The sweep could not follow ${label} within 0.01 mm. Check the rail bends and section alignment.`,
        )
    }
  }
}

/** Start each loop at its first contact. Match the travel direction even if the guide seams differ. */
const wrap = (t: number) => t - Math.floor(t)
function closedSweep(
  primary: RailPath,
  secondary: RailPath,
  contacts: { t: number; s: number }[],
  sections: SweepCurve[],
  capped: boolean,
  track: BuildContext['track'],
): Shape3D {
  const first = contacts[0]!
  const direction =
    dot(railTangent(primary, first.t), railTangent(secondary, first.s)) >= 0 ? 1 : -1
  const loop = (path: RailPath, start: number, sign: number): Pick<RailPath, 'at'> => ({
    at: (t) => path.at(wrap(start + sign * t)),
  })
  const p = loop(primary, first.t, 1)
  const q = loop(secondary, first.s, direction)
  const profiles = sections.map((section, i) => {
    const hit = contacts[i]!
    return profileStation(
      originalProfile(section),
      p,
      q,
      wrap(hit.t - first.t),
      wrap(direction * (hit.s - first.s)),
    )
  })
  const closed = sections[0]!.closed
  const anchors = profiles.map((profile, i) =>
    i ? alignProfile(profiles[0]!, profile, closed) : profile,
  )
  anchors.push({ ...anchors[0]!, t: 1, s: 1 })
  const { oc } = runtime()
  return scoped((own) => {
    const sewing = own(new oc.BRepBuilderAPI_Sewing(1e-5, true, true, true, false))
    // Separate lofts share their end wires. Sewing closes the circumference without interior caps.
    for (let i = 0; i + 1 < anchors.length; i++) {
      const a = anchors[i]!
      const b = anchors[i + 1]!
      if (b.t - a.t < END_EPSILON || b.s - a.s < END_EPSILON)
        throw new Error('Select the sections in order around both closed guides.')
      const spans = Math.ceil((b.t - a.t) * 4)
      const steps = 8
      let boundary: Wire | undefined
      for (let span = 0; span < spans; span++) {
        const loft = own(new oc.BRepOffsetAPI_ThruSections(false, false, 1e-6))
        loft.SetMutableInput(false)
        loft.CheckCompatibility(false)
        for (let j = 0; j <= steps; j++) {
          if (j === 0 && boundary) {
            loft.AddWire(boundary.wrapped)
            continue
          }
          const fraction = (span + j / steps) / spans
          const t = lerp(a.t, b.t, fraction)
          const s = lerp(a.s, b.s, fraction)
          const origin = p.at(t)
          const side = q.at(s)
          const normal = normalize(add(railTangent(p, t), lerp3(a.tilt, b.tilt, fraction)))
          const station = {
            t,
            s,
            frame: guideFrame(origin, side, normal),
            width: distance(origin, side),
          }
          boundary = makeSection(station, a, b, closed, track)
          loft.AddWire(boundary.wrapped)
        }
        loft.Build()
        if (!loft.IsDone()) throw new Error('The sections could not follow the closed guides.')
        sewing.Add(own(loft.Shape()))
      }
    }
    sewing.Perform()
    const shell = wrapShape<Shape3D>(sewing.SewedShape())
    if (!(shell instanceof Shell)) {
      shell.delete()
      throw new Error('The closed sweep did not join into one shell.')
    }
    if (!capped) return shell
    own(shell)
    if (!oc.BRep_Tool.IsClosed(shell.wrapped)) throw new Error('The shank has an open seam.')
    const solid = makeSolid([shell])
    if (shapeVolume(solid) > 0) return solid
    own(solid)
    return wrapShape<Shape3D>(solid.wrapped.Reversed())
  })
}

/** Section planes follow guide 1 and meet guide 2; the span between guides scales each profile. */
export function twoRailSweep(
  rails: readonly [SweepCurve, SweepCurve],
  sections: SweepCurve[],
  capped: boolean,
  track: BuildContext['track'],
): Shape3D {
  if (rails[0].closed !== rails[1].closed)
    throw new Error('Choose two open guides or two closed guides for a ring.')
  let primary = railPath(rails[0].source)
  let secondary = railPath(rails[1].source)
  const contacts = sections.map((section) => ({
    t: contact(rails[0], section, primary, 'first'),
    s: contact(rails[1], section, secondary, 'second'),
  }))
  if (rails[0].closed) {
    const shape = closedSweep(primary, secondary, contacts, sections, capped, track)
    return checkedSweep(shape, primary, secondary, sections)
  }
  if (contacts[0]!.t > contacts.at(-1)!.t) {
    primary = reverseRail(primary)
    for (const p of contacts) p.t = 1 - p.t
  }
  const first = contacts[0]!
  const last = contacts.at(-1)!
  const sideCost = (reversed: boolean) =>
    distance(primary.at(0), secondary.at(reversed ? 1 : 0)) +
    distance(primary.at(1), secondary.at(reversed ? 0 : 1))
  if (contacts.length === 1 ? sideCost(true) < sideCost(false) : first.s > last.s) {
    secondary = reverseRail(secondary)
    for (const p of contacts) p.s = 1 - p.s
  }
  for (const [i, p] of contacts.entries()) {
    const previous = contacts[i - 1]
    if (
      (previous && (p.t - previous.t <= END_EPSILON || p.s - previous.s <= END_EPSILON)) ||
      p.t <= END_EPSILON !== p.s <= END_EPSILON ||
      p.t >= 1 - END_EPSILON !== p.s >= 1 - END_EPSILON
    )
      throw new Error('Place sections in the same order on both rails and match their ends.')
  }
  const profiles = sections.map((section, i) => {
    const { t, s } = contacts[i]!
    return profileStation(originalProfile(section), primary, secondary, t, s)
  })
  const closed = sections[0]!.closed
  const aligned = profiles.map((profile, i) =>
    i ? alignProfile(profiles[0]!, profile, closed) : profile,
  )
  const end = (t: number, profile: ProfileStation): ProfileStation => {
    const tangent = railTangent(primary, t)
    const frame = guideFrame(primary.at(t), secondary.at(t), tangent)
    return { ...profile, t, s: t, tilt: sub(frame.z, tangent) }
  }
  const anchors = [
    ...(first.t > END_EPSILON ? [end(0, aligned[0]!)] : []),
    ...aligned,
    ...(last.t < 1 - END_EPSILON ? [end(1, aligned.at(-1)!)] : []),
  ]
  const { oc } = runtime()
  const shape = scoped((own) => {
    const builder = own(new oc.BRepOffsetAPI_ThruSections(capped, false, 1e-5))
    builder.CheckCompatibility(false)
    builder.SetMutableInput(false)
    let count = 0
    let previous = -1
    for (let i = 0; i + 1 < anchors.length; i++) {
      const a = anchors[i]!
      const b = anchors[i + 1]!
      const addSection = (station: GuideStation) => {
        if (++count > MAX_STATIONS)
          throw new Error('The rails need too many sections to follow within 0.01 mm.')
        if (station.s <= previous)
          throw new Error('The second rail doubles back through the moving sections.')
        previous = station.s
        builder.AddWire(makeSection(station, a, b, closed, track).wrapped)
      }
      const at = (t: number, contact?: number): GuideStation => {
        const p = primary.at(t)
        const normal = normalize(
          add(railTangent(primary, t), lerp3(a.tilt, b.tilt, (t - a.t) / (b.t - a.t))),
        )
        const { t: s, point: q } =
          contact === undefined
            ? crossRail(secondary, p, normal, a.s, b.s)
            : { t: contact, point: secondary.at(contact) }
        return { t, s, frame: guideFrame(p, q, normal), width: distance(p, q) }
      }
      function append(start: GuideStation, finish: GuideStation, depth: number) {
        const mid = at((start.t + finish.t) / 2)
        const point = (g: GuideStation) => addScaled(g.frame.origin, g.frame.x, g.width)
        if (distance(point(mid), lerp3(point(start), point(finish), 0.5)) > 0.002 && depth < 12) {
          append(start, mid, depth + 1)
          append(mid, finish, depth + 1)
        } else addSection(finish)
      }
      let start = at(a.t, a.s)
      if (i === 0) addSection(start)
      for (const { t } of primary.samples) {
        if (t - a.t <= END_EPSILON || b.t - t <= END_EPSILON) continue
        const finish = at(t)
        append(start, finish, 0)
        start = finish
      }
      append(start, at(b.t, b.s), 0)
    }
    builder.Build()
    if (!builder.IsDone()) throw new Error('The matched sections could not form a sweep surface.')
    return wrapShape<Shape3D>(builder.Shape())
  })
  return checkedSweep(shape, primary, secondary, sections)
}

function checkedSweep(
  shape: Shape3D,
  primary: RailPath,
  secondary: RailPath,
  sections: SweepCurve[],
): Shape3D {
  try {
    verifyFollowing(shape, [
      { path: primary, label: 'the first rail' },
      { path: secondary, label: 'the second rail' },
      ...sections.map((section) => ({
        path: railPath(section.source),
        label: `section “${section.source.node.name ?? section.source.node.id}”`,
      })),
    ])
  } catch (error) {
    shape.delete()
    throw error
  }
  return shape
}
