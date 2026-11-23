/**
 * What the mesh exporters (STL, OBJ, 3MF, 3DM) write: one welded, watertight triangle set per
 * production part, and optionally one per stone, with the names and facts a recipient needs.
 */
import { GEM_MATERIALS, METALS } from '@pave/schema'
import type { IndexedTriangles, MetalSpec, Scene, ScenePart } from '../core'
import { mergeTriangles } from '../features/chain/instances'
import { weld } from '../solid/meshing'
import type { MeshData, StoneInstance } from '../types'

export interface MetalObject extends IndexedTriangles, MetalSpec {
  kind: 'metal'
  name: string
  /** The design nodes whose metal makes up this part. */
  nodeIds: string[]
  volumeMm3: number
}

export interface StoneObject extends IndexedTriangles {
  kind: 'stone'
  name: string
  stone: StoneInstance
}

export type MeshObject = MetalObject | StoneObject

export interface MeshSelection {
  /** Include stones as reference geometry. */
  stones: boolean
  /** Only parts made from (and stones placed by) these nodes. */
  only?: readonly string[]
}

/** Gives each name a ` 2`, ` 3`… suffix where it repeats, so objects stay addressable. */
function uniqueNames<T extends { name: string }>(objects: T[]): T[] {
  const seen = new Map<string, number>()
  for (const o of objects) {
    const n = (seen.get(o.name) ?? 0) + 1
    seen.set(o.name, n)
    if (n > 1) o.name = `${o.name} ${n}`
  }
  return objects
}

const partTriangles = (scene: Scene, part: ScenePart): IndexedTriangles =>
  part.fused?.triangles(scene.quality) ??
  mergeTriangles(part.sources.map((s) => s.body.solid.triangles(scene.quality)))

/** A unit gem mesh placed by a stone's matrix (non-uniform: girdle, length and depth scales). */
function placedGem(mesh: MeshData, m: readonly number[]): IndexedTriangles {
  const welded = weld(mesh.positions, mesh.indices)
  const p = welded.positions
  const out = new Float32Array(p.length)
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i]!
    const y = p[i + 1]!
    const z = p[i + 2]!
    out[i] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!
    out[i + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!
    out[i + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!
  }
  return { positions: out, indices: welded.indices }
}

export function sceneObjects(scene: Scene, selection: MeshSelection): MeshObject[] {
  const only = selection.only && new Set(selection.only)
  const metal: MetalObject[] = scene.parts
    .filter((p) => !only || p.sources.some((s) => only.has(s.nodeId)))
    .map((p) => ({
      kind: 'metal',
      name: p.part.name,
      material: p.part.material,
      finish: p.part.finish,
      plating: p.part.plating,
      nodeIds: [...new Set(p.sources.map((s) => s.nodeId))],
      volumeMm3: p.part.volumeMm3,
      ...partTriangles(scene, p),
    }))
  const stones: StoneObject[] = selection.stones
    ? scene.stones
        .filter((s) => !only || only.has(s.instance.nodeId))
        .map(({ instance }) => ({
          kind: 'stone',
          name: `${GEM_MATERIALS[instance.stone].label} ${instance.id}`,
          stone: instance,
          ...placedGem(scene.evaluation.gemMeshes[instance.meshKey]!, instance.matrix),
        }))
    : []
  return [...uniqueNames(metal), ...stones]
}

/** sRGB hex colour for an object: the alloy's swatch, or the stone's body colour. */
export const objectColor = (o: MeshObject): string =>
  o.kind === 'metal' ? METALS[o.material].swatch : GEM_MATERIALS[o.stone.stone].color

export const MM_NOTE = 'Units are millimetres.'
