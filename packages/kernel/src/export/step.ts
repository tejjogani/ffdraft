/**
 * STEP (AP242) through OpenCascade: the exact B-rep hand-off to Rhino, MatrixGold and 3Design
 * (docs/research/01-cad.md §5). Every exact metal body is a named solid coloured by its alloy;
 * seats and engravings are cut into it where the exact boolean succeeds. Mesh bodies (imports,
 * sculpts) have no exact form and are left out — the notes say which. Stones, when asked for,
 * are planar-faced solids built from the same facets the viewport shows.
 */
import { GEM_MATERIALS, METALS } from '@pave/schema'
import { type Shape3D, cast, exportSTEP, makePolygon, makeSolid } from 'replicad'
import { type Body, type Mat4, type NodeResult, type Scene, defineExporter, runtime, subtract } from '../core'
import { boundsOverlap } from '../solid/meshing'
import { scoped, transformShape } from '../solid/occt'
import { weld } from '../solid/meshing'
import type { MeshData, StoneInstance } from '../types'

interface NamedShape {
  shape: Shape3D
  name: string
  color: string
}

const labelOf = (result: NodeResult | undefined, fallback: string) => result?.node.name ?? result?.node.id ?? fallback

/** Cutters aimed at a node (or at whatever they touch) that overlap its body. */
function cuttersFor(scene: Scene, nodeId: string, body: Body) {
  const box = body.solid.bounds()
  return [...scene.nodes.values()]
    .filter((r) => r.status === 'ok' && r.node.visible)
    .flatMap((r) => r.cuts)
    .filter((c) => (c.targets === 'all' || c.targets.includes(nodeId)) && boundsOverlap(c.solid.bounds(), box))
}

/** The body's B-rep with its seats cut, or uncut when the exact boolean cannot be trusted. */
function cutBody(scene: Scene, nodeId: string, body: Body): { shape: Shape3D; cut: boolean } {
  const tools = cuttersFor(scene, nodeId, body)
  const own = body.solid.brep()!
  if (tools.length === 0) return { shape: own.clone(), cut: true }
  const result = subtract(body.solid, tools.map((t) => t.solid))
  try {
    return result.exact ? { shape: result.brep()!.clone(), cut: true } : { shape: own.clone(), cut: false }
  } finally {
    result.dispose()
  }
}

/** Column lengths of a frame matrix with per-axis scale (a stone's girdle, length, depth). */
const axisScales = (m: readonly number[]): [number, number, number] => [
  Math.hypot(m[0]!, m[1]!, m[2]!),
  Math.hypot(m[4]!, m[5]!, m[6]!),
  Math.hypot(m[8]!, m[9]!, m[10]!),
]

/** A closed planar-faced solid from a welded triangle mesh; coplanar facets are merged. */
function polyhedron(mesh: MeshData, s: readonly [number, number, number]): Shape3D {
  const { positions: p, indices } = weld(mesh.positions, mesh.indices)
  const point = (i: number): [number, number, number] => [p[i * 3]! * s[0], p[i * 3 + 1]! * s[1], p[i * 3 + 2]! * s[2]]
  const faces = []
  for (let t = 0; t < indices.length; t += 3) faces.push(makePolygon([point(indices[t]!), point(indices[t + 1]!), point(indices[t + 2]!)]))
  const solid = makeSolid(faces)
  for (const f of faces) f.delete()
  const { oc } = runtime()
  try {
    return scoped((own) => {
      const unify = own(new oc.ShapeUpgrade_UnifySameDomain(solid.wrapped, true, true, false))
      unify.Build()
      return cast(unify.Shape()) as Shape3D
    })
  } finally {
    solid.delete()
  }
}

function stoneShapes(scene: Scene, stones: readonly StoneInstance[]): NamedShape[] {
  const units = new Map<string, Shape3D>()
  try {
    return stones.map((stone) => {
      const scales = axisScales(stone.matrix)
      const key = `${stone.meshKey}|${scales.map((v) => v.toFixed(4)).join(',')}`
      let unit = units.get(key)
      if (!unit) {
        unit = polyhedron(scene.evaluation.gemMeshes[stone.meshKey]!, scales)
        units.set(key, unit)
      }
      const m = stone.matrix
      const rigid: Mat4 = [
        m[0]! / scales[0], m[1]! / scales[0], m[2]! / scales[0], 0,
        m[4]! / scales[1], m[5]! / scales[1], m[6]! / scales[1], 0,
        m[8]! / scales[2], m[9]! / scales[2], m[10]! / scales[2], 0,
        m[12]!, m[13]!, m[14]!, 1,
      ] // biome-ignore format: matrix layout
      return {
        shape: transformShape(unit, rigid),
        name: `${GEM_MATERIALS[stone.stone].label} ${stone.cut} ${stone.carat.toFixed(3)} ct (${stone.id})`,
        color: GEM_MATERIALS[stone.stone].color,
      }
    })
  } finally {
    for (const unit of units.values()) unit.delete()
  }
}

export const step = defineExporter({
  format: 'step',
  detail: 'production',
  async run(scene, options) {
    const only = options.only && new Set(options.only)
    const shapes: NamedShape[] = []
    const omitted = new Set<string>()
    let uncut = 0
    for (const part of scene.parts)
      for (const { nodeId, body } of part.sources) {
        if (only && !only.has(nodeId)) continue
        const result = scene.nodes.get(nodeId)
        if (!body.solid.exact) {
          omitted.add(labelOf(result, nodeId))
          continue
        }
        const { shape, cut } = cutBody(scene, nodeId, body)
        if (!cut) uncut++
        shapes.push({ shape, name: `${labelOf(result, nodeId)} — ${METALS[body.material].label}`, color: METALS[body.material].swatch })
      }
    const stones = options.stones ?? false
    if (stones) shapes.push(...stoneShapes(scene, scene.evaluation.stones.filter((s) => !only || only.has(s.nodeId))))
    try {
      if (shapes.length === 0) throw new Error('Nothing in this design has an exact B-rep to write to STEP')
      const blob = exportSTEP(shapes, { unit: 'MM' })
      const notes = [
        'STEP AP242, millimetres: exact B-rep solids, one per metal body, named and coloured by alloy.',
      ]
      if (omitted.size > 0)
        notes.push(
          `Mesh bodies have no exact form and are omitted: ${[...omitted].join(', ')}. Use STL, 3MF or 3DM for them.`,
        )
      if (uncut > 0) notes.push(`${uncut} bod${uncut === 1 ? 'y is' : 'ies are'} exported without seats cut (the exact cut failed); the STL has them cut.`)
      notes.push(stones ? 'Stones are planar-faced reference solids.' : 'Stones are not included.')
      return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'model/step', extension: 'step', notes }
    } finally {
      for (const s of shapes) s.shape.delete()
    }
  },
})
