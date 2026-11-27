import { type BufferAttribute, type Camera, DoubleSide, Raycaster, Vector2, Vector3 } from 'three'
import type { MeshBVH } from 'three-mesh-bvh'
import type { ComponentKind, MeshComponent } from './model'

const SNAP_PX = 12
// Float32 scene units. The longest dimension of the entire mesh is one unit.
const DEPTH_EPSILON = 0.000002

/** Only the first surface under the pointer supplies candidates. Check each snap point from
 * its own screen position, since the corner of a visible triangle may itself be occluded. */
export function pickMeshComponent(
  bvh: MeshBVH,
  camera: Camera,
  kind: ComponentKind,
  x: number,
  y: number,
  width: number,
  height: number,
): MeshComponent | null {
  const raycaster = new Raycaster()
  const rayAt = (sx: number, sy: number) => {
    raycaster.setFromCamera(new Vector2((2 * sx) / width - 1, 1 - (2 * sy) / height), camera)
    return raycaster.ray
  }
  const first = bvh.raycastFirst(rayAt(x, y), DoubleSide)
  if (!first?.face || first.faceIndex == null) return null
  if (Math.abs(first.point.clone().project(camera).z) > 1) return null

  const { a, b, c } = first.face
  if (kind === 'Face') return { kind, ids: [a, b, c], face: first.faceIndex }

  const attribute = bvh.geometry.getAttribute('position') as BufferAttribute
  const project = (id: number) => {
    const ndc = new Vector3().fromBufferAttribute(attribute, id).project(camera)
    return new Vector3(((ndc.x + 1) * width) / 2, ((1 - ndc.y) * height) / 2, ndc.z)
  }
  const ids = [a, b, c]
  const points = ids.map(project)
  const mouse = new Vector2(x, y)
  const visible = (point: Vector3) => {
    if (Math.abs(point.z) > 1 || point.x < 0 || point.x > width || point.y < 0 || point.y > height)
      return false
    const ray = rayAt(point.x, point.y)
    const world = new Vector3(
      (2 * point.x) / width - 1,
      1 - (2 * point.y) / height,
      point.z,
    ).unproject(camera)
    const nearer = world.sub(ray.origin).dot(ray.direction) - DEPTH_EPSILON
    return !bvh.raycastFirst(ray, DoubleSide, 0, nearer)
  }

  let best: MeshComponent | null = null
  let bestDistance = SNAP_PX
  for (let i = 0; i < ids.length; i++) {
    const p = points[i]!
    const next = (i + 1) % ids.length
    const q = points[next]!
    let sample = p
    if (kind === 'Edge') {
      if (Math.abs(p.z) > 1 || Math.abs(q.z) > 1) continue
      const edge = new Vector2(q.x - p.x, q.y - p.y)
      const length = edge.lengthSq()
      if (length < 1) continue
      const t = new Vector2(x - p.x, y - p.y).dot(edge) / length
      sample = p.clone().lerp(q, Math.min(1, Math.max(0, t)))
    }
    const distance = mouse.distanceTo(new Vector2(sample.x, sample.y))
    if (distance >= bestDistance || !visible(sample)) continue
    bestDistance = distance
    if (kind === 'Vertex') best = { kind, ids: [ids[i]!] }
    else {
      const from = ids[i]!
      const to = ids[next]!
      best = { kind, ids: [Math.min(from, to), Math.max(from, to)] }
    }
  }
  return best
}
