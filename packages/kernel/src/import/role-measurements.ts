import { culetDepth, type GemCutId, type MeshVertexEdits } from '@pave/schema'
import { Box3, Euler, MathUtils, Matrix4, Vector3 } from 'three'
import { readEditableMesh } from '../mesh/edit'

type XYZ = [number, number, number]
const localZ = new Vector3(0, 0, 1)
const directions = Array.from(
  { length: 16 },
  (_, i) => [Math.cos((i * Math.PI) / 8), Math.sin((i * Math.PI) / 8)] as const,
)

/** The largest coplanar facet suggests the table. A reviewer can replace all three angles. */
function tableNormal(points: Vector3[], indices: Uint32Array): Vector3 {
  const center = new Vector3()
  for (const p of points) center.add(p)
  center.divideScalar(points.length)
  const planes = new Map<string, { normal: Vector3; area: number }>()
  const u = new Vector3(),
    v = new Vector3()
  for (let i = 0; i < indices.length; i += 3) {
    const a = points[indices[i]!]!,
      b = points[indices[i + 1]!]!,
      c = points[indices[i + 2]!]!
    const normal = u.subVectors(b, a).cross(v.subVectors(c, a))
    const area = normal.length()
    if (!area) continue
    normal.divideScalar(area)
    if (normal.dot(v.subVectors(a, center)) < 0) normal.negate()
    const key = [normal.x, normal.y, normal.z, normal.dot(v)]
      .map((x) => Math.round(x * 1000))
      .join(',')
    const plane = planes.get(key)
    if (plane) plane.area += area
    else planes.set(key, { area, normal: normal.clone() })
  }
  let largest = 0,
    z = localZ
  for (const p of planes.values())
    if (p.area > largest) {
      largest = p.area
      z = p.normal
    }
  return z
}

/** Fit the plan rectangle to the outline, irrespective of its spin about the table normal. */
function longAxis(points: Vector3[], normal: Vector3): Vector3 {
  const x = new Vector3(Math.abs(normal.x) < 0.9 ? 1 : 0, Math.abs(normal.x) < 0.9 ? 0 : 1, 0)
  x.addScaledVector(normal, -normal.dot(x)).normalize()
  const y = new Vector3().crossVectors(normal, x)
  const projected = points
    .map((p) => [p.dot(x), p.dot(y)] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const chain = (ordered: typeof projected) => {
    const out: typeof projected = []
    for (const p of ordered) {
      while (out.length >= 2) {
        const a = out[out.length - 2]!,
          b = out[out.length - 1]!
        if ((b[0] - a[0]) * (p[1] - a[1]) > (b[1] - a[1]) * (p[0] - a[0])) break
        out.pop()
      }
      out.push(p)
    }
    out.pop()
    return out
  }
  const hull = chain(projected).concat(chain(projected.reverse()))
  let area = Infinity,
    angle = 0
  const stride = Math.max(1, Math.ceil(hull.length / 256))
  for (let i = 0; i < hull.length; i += stride) {
    const a = hull[i]!,
      b = hull[(i + 1) % hull.length]!
    const t = Math.atan2(b[1] - a[1], b[0] - a[0]),
      c = Math.cos(t),
      s = Math.sin(t)
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const [px, py] of hull) {
      const u = px * c + py * s,
        v = py * c - px * s
      minX = Math.min(minX, u)
      maxX = Math.max(maxX, u)
      minY = Math.min(minY, v)
      maxY = Math.max(maxY, v)
    }
    const w = maxX - minX,
      h = maxY - minY
    if (w * h < area) {
      area = w * h
      angle = t + (h > w ? Math.PI / 2 : 0)
    }
  }
  return x.multiplyScalar(Math.cos(angle)).addScaledVector(y, Math.sin(angle)).normalize()
}

export function measureRhinoRoleBody(
  bytes: Uint8Array,
  cut: GemCutId,
  options: { rotation?: XYZ; edits?: MeshVertexEdits } = {},
) {
  const { rotation, edits } = options
  const { positions, indices } = readEditableMesh(bytes, edits)
  const points: Vector3[] = []
  for (let i = 0; i < positions.length; i += 3) points.push(new Vector3().fromArray(positions, i))
  if (points.length < 4) return
  let orientation = new Euler()
  if (rotation) orientation.set(...(rotation.map(MathUtils.degToRad) as XYZ))
  else {
    const z = tableNormal(points, indices),
      y = longAxis(points, z)
    const x = new Vector3().crossVectors(y, z).normalize()
    orientation = new Euler().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z))
  }
  const frame = new Matrix4().makeRotationFromEuler(orientation)
  const inverse = frame.clone().transpose()
  for (const point of points) point.applyMatrix4(inverse)
  const bounds = new Box3().setFromPoints(points)
  const size = bounds.getSize(new Vector3())
  if (Math.min(size.x, size.y, size.z) < 1e-6 || !Number.isFinite(size.length())) return
  // Sample the widest perimeter in the confirmed frame. Include both rails of a thick girdle.
  const levels = directions
    .map(([x, y]) => {
      let limit = -Infinity
      for (const p of points) limit = Math.max(limit, x * p.x + y * p.y)
      let low = Infinity,
        high = -Infinity
      const tolerance = Math.min(size.x, size.y) * 1e-5
      for (const p of points)
        if (limit - (x * p.x + y * p.y) <= tolerance) {
          low = Math.min(low, p.z)
          high = Math.max(high, p.z)
        }
      return (low + high) / 2
    })
    .sort((a, b) => a - b)
  const dims = { width: Math.min(size.x, size.y), length: Math.max(size.x, size.y), depth: size.z }
  const center = bounds.getCenter(new Vector3())
  center.z =
    levels[12]! - levels[3]! < size.z * 0.15
      ? (levels[7]! + levels[8]!) / 2
      : bounds.min.z + culetDepth(cut, dims)
  return {
    ...dims,
    girdle: center.applyMatrix4(frame).toArray() as XYZ,
    rotation:
      rotation ?? ([orientation.x, orientation.y, orientation.z].map(MathUtils.radToDeg) as XYZ),
  }
}
