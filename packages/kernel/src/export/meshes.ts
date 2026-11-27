/**
 * What the mesh exporters (STL, OBJ, 3MF, 3DM) write: one welded, watertight triangle set per
 * production part, and optionally one per stone, with the names and facts a recipient needs.
 */
import { GEM_MATERIALS, METALS } from '@pave/schema'
import type { IndexedTriangles, MetalSpec, Scene, ScenePart } from '../core'
import { mergeTriangles } from '../features/chain/instances'
import { edgeTopology, triangleComponents } from '../mesh/topology'
import { weld } from '../solid/meshing'
import type { MeshData, StoneInstance } from '../types'

export interface MetalObject extends IndexedTriangles, MetalSpec {
  kind: 'metal'
  name: string
  /** The design nodes whose metal makes up this part. */
  nodeIds: string[]
  volumeMm3: number
  part: ScenePart
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

/**
 * A name as a file can carry it: control characters (a pasted tab, line break or worse) become
 * a space. XML 1.0 cannot hold most of them at all, so one in a part's name made the whole 3MF
 * model unreadable, and OpenNURBS drops such a name altogether.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are the point
const cleanName = (name: string): string => name.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()

/**
 * Gives each name a ` 2`, ` 3`… suffix where it repeats, so objects stay addressable. A number
 * another object already carries is skipped: "Block", "Block" beside a part the designer named
 * "Block 2" become "Block", "Block 3", not two parts called "Block 2".
 */
function uniqueNames<T extends { name: string }>(objects: T[]): T[] {
  const taken = new Set(objects.map((o) => o.name))
  const seen = new Map<string, number>()
  for (const o of objects) {
    const base = o.name
    let n = (seen.get(base) ?? 0) + 1
    if (n > 1) {
      while (taken.has(`${base} ${n}`)) n++
      o.name = `${base} ${n}`
      taken.add(o.name)
    }
    seen.set(base, n)
  }
  return objects
}

/** Why nothing can be written for a selection that holds no metal (and no stones, if asked for). */
export const nothingToExport = (selection: MeshSelection): string =>
  selection.only
    ? `Nothing to export: no metal${selection.stones ? ' or stones' : ''} comes from ${selection.only.join(', ')}.`
    : `Nothing to export: the piece has no metal${selection.stones ? ' or stones' : ''}.`

/**
 * A part's triangles as they will be written: welded at float32, which drops triangles whose
 * corners collapse onto one another. Chain links carry a few such slivers; harmless in the
 * kernel's welded meshes, but every STL reader would count each as non-manifold edges.
 */
function partTriangles(scene: Scene, part: ScenePart): IndexedTriangles {
  const tris =
    part.fused?.triangles(scene.quality) ??
    mergeTriangles(part.sources.map((s) => s.body.solid.triangles(scene.quality)))
  return weld(tris.positions, tris.indices)
}

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

/** Every mesh export: one object per part, and per stone when asked; never an empty file. */
export function sceneObjects(scene: Scene, selection: MeshSelection): MeshObject[] {
  const only = selection.only && new Set(selection.only)
  const metal: MetalObject[] = scene.parts
    .filter((p) => !only || p.sources.some((s) => only.has(s.nodeId)))
    .map((p) => ({
      kind: 'metal',
      name: cleanName(p.part.name) || 'Part',
      material: p.part.material,
      finish: p.part.finish,
      plating: p.part.plating,
      nodeIds: [...new Set(p.sources.map((s) => s.nodeId))],
      volumeMm3: p.part.volumeMm3,
      part: p,
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
  const objects = [...uniqueNames(metal), ...stones]
  if (objects.length === 0) throw new Error(nothingToExport(selection))
  return objects
}

const shellsOf = (tris: IndexedTriangles) =>
  triangleComponents(tris.indices.length / 3, edgeTopology(tris).twin).count

/** What the metal in an export amounts to, counted from the triangles actually written. */
export function metalNotes(scene: Scene, objects: readonly MeshObject[]): string[] {
  const metal = objects.filter((o) => o.kind === 'metal')
  const shells = metal.reduce((n, o) => n + shellsOf(o), 0)
  const notes = [
    `${metal.length} metal part${metal.length === 1 ? '' : 's'} in ${shells} watertight shell${shells === 1 ? '' : 's'}, seats and engravings cut; nominal size — the caster applies shrinkage.`,
  ]
  const chains = new Set(
    [...scene.nodes.values()].filter((r) => r.node.kind === 'chain').map((r) => r.id),
  )
  if (metal.some((o) => o.nodeIds.some((id) => chains.has(id))))
    notes.push(
      'Chain links are separate shells, one per link; fine chain is normally bought rather than cast.',
    )
  return notes
}

/** sRGB hex colour for an object: the alloy's swatch, or the stone's body colour. */
export const objectColor = (o: MeshObject): string =>
  o.kind === 'metal' ? METALS[o.material].swatch : GEM_MATERIALS[o.stone.stone].color

export const MM_NOTE = 'Units are millimetres.'
