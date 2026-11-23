/**
 * Whether the fused production bodies can be sent to a caster at all: closed, within the
 * bureau's polygon and file-size limits, and inside its largest flask.
 */
import type { Scene } from '../core'
import { unionBounds } from '../solid/meshing'
import type { Diagnostic } from '../types'
import type { DfmProfile } from './profile'

const STL_HEADER_BYTES = 84
const STL_TRIANGLE_BYTES = 50

export function limitChecks(scene: Scene, profile: DfmProfile): Diagnostic[] {
  if (scene.detail !== 'production' || scene.parts.length === 0) return []
  const out: Diagnostic[] = []
  let triangles = 0
  for (const { part, fused } of scene.parts) {
    if (!fused) continue
    const status = fused.manifold(scene.quality).status()
    if (status !== 'NoError')
      out.push({
        level: 'error',
        code: 'mesh.open',
        nodeId: part.nodeId,
        message: `“${part.name}” is not a closed solid (${status}).`,
      })
    triangles += fused.triangles(scene.quality).indices.length / 3
  }
  if (triangles > profile.maxTriangles)
    out.push({
      level: 'warning',
      code: 'mesh.dense',
      message: `The casting mesh has ${triangles.toLocaleString('en')} triangles; some bureaus accept at most ${profile.maxTriangles.toLocaleString('en')}.`,
      value: triangles,
      limit: profile.maxTriangles,
    })
  const megabytes = (STL_HEADER_BYTES + STL_TRIANGLE_BYTES * triangles) / 1e6
  if (megabytes > profile.maxStlMegabytes)
    out.push({
      level: 'warning',
      code: 'stl.large',
      message: `The STL will be ${megabytes.toFixed(0)} MB; some casters accept at most ${profile.maxStlMegabytes} MB.`,
      value: megabytes,
      limit: profile.maxStlMegabytes,
    })
  const box = unionBounds(scene.parts.map((p) => p.part.bounds))
  const size = [0, 1, 2].map((k) => box.max[k]! - box.min[k]!).sort((a, b) => a - b)
  if (size.some((v, k) => v > profile.envelope[k]!))
    out.push({
      level: 'info',
      code: 'piece.large',
      message: `At ${size.map((v) => v.toFixed(0)).join(' × ')} mm the piece is larger than some casters' flasks (${profile.envelope.join(' × ')} mm).`,
    })
  return out
}
