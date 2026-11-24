/**
 * STEP (AP242) through OpenCascade: the exact B-rep hand-off to Rhino, MatrixGold and 3Design
 * (docs/research/01-cad.md §5). Every exact metal body is a named solid coloured by its alloy;
 * seats and engravings are cut into it where the exact boolean succeeds. Mesh bodies (imports,
 * sculpts) have no exact form and are left out — the notes say which. Stones, when asked for,
 * are planar-faced solids built from the same facets the viewport shows.
 */
import { GEM_MATERIALS, METALS } from '@pave/schema'
import {
  assembleWire,
  cast,
  exportSTEP,
  makeFace,
  makeLine,
  makePolygon,
  makeSolid,
  revolution,
  type Shape3D,
} from 'replicad'
import {
  type Body,
  defineExporter,
  type Mat4,
  type NodeResult,
  runtime,
  type Scene,
  subtract,
} from '../core'
import { gemUnit } from '../gems/index'
import { boundsOverlap, weld } from '../solid/meshing'
import { scoped, transformShape } from '../solid/occt'
import type { Bounds, MeshData, StoneInstance } from '../types'
import { linearHex } from './color'

interface NamedShape {
  shape: Shape3D
  name: string
  color: string
}

const labelOf = (result: NodeResult | undefined, fallback: string) =>
  result?.node.name ?? result?.node.id ?? fallback

/** Cutters aimed at a node (or at whatever they touch) that overlap its body. */
function cuttersFor(scene: Scene, nodeId: string, body: Body) {
  const box = body.solid.bounds()
  return [...scene.nodes.values()]
    .filter((r) => r.status === 'ok' && r.node.visible)
    .flatMap((r) => r.cuts)
    .filter(
      (c) =>
        (c.targets === 'all' || c.targets.includes(nodeId)) && boundsOverlap(c.solid.bounds(), box),
    )
}

/** Most cutters in one exact pass; beyond this OpenCascade's compound cut slows sharply. */
const PASS = 12

/**
 * Cutters in passes OpenCascade can take: each pass at most {@link PASS} cutters whose boxes do
 * not overlap (a compound of overlapping cutters cuts nothing), filled greedily in a fixed order
 * so the result is the same on every export.
 */
function passes<T extends { solid: { bounds(): Bounds } }>(tools: readonly T[]): T[][] {
  const out: { tools: T[]; boxes: Bounds[] }[] = []
  for (const tool of tools) {
    const box = tool.solid.bounds()
    let pass = out.find((p) => p.tools.length < PASS && !p.boxes.some((b) => boundsOverlap(b, box)))
    if (!pass) {
      pass = { tools: [], boxes: [] }
      out.push(pass)
    }
    pass.tools.push(tool)
    pass.boxes.push(box)
  }
  return out.map((p) => p.tools)
}

/**
 * Exact cutting passes allowed in one export. A pass of up to a dozen seats takes seconds; a
 * pavé field of hundreds would hold the export for many minutes, so beyond this the remaining
 * bodies go out uncut and the note names them. A count, not a clock, so two exports of the same
 * design cut exactly the same bodies.
 */
const MAX_PASSES = 16

/** The body's B-rep with its seats cut, or uncut when an exact boolean cannot be trusted. */
function cutBody(
  scene: Scene,
  nodeId: string,
  body: Body,
  budget: { passes: number },
): { shape: Shape3D; cut: boolean } {
  const tools = cuttersFor(scene, nodeId, body)
  const own = body.solid.brep()!
  if (tools.length === 0) return { shape: own.clone(), cut: true }
  let current = body.solid
  try {
    const planned = passes(tools)
    // All of a body's passes or none: a half-cut body would be the worst of both.
    if (planned.length > budget.passes) return { shape: own.clone(), cut: false }
    budget.passes -= planned.length
    for (const pass of planned) {
      const next = subtract(
        current,
        pass.map((t) => t.solid),
      )
      if (current !== body.solid) current.dispose()
      current = next
      // One pass falling back to a mesh means the exact body cannot carry its seats.
      if (!current.exact) return { shape: own.clone(), cut: false }
    }
    return { shape: current.brep()!.clone(), cut: true }
  } finally {
    if (current !== body.solid) current.dispose()
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
  const point = (i: number): [number, number, number] => [
    p[i * 3]! * s[0],
    p[i * 3 + 1]! * s[1],
    p[i * 3 + 2]! * s[2],
  ]
  const faces = []
  for (let t = 0; t < indices.length; t += 3)
    faces.push(makePolygon([point(indices[t]!), point(indices[t + 1]!), point(indices[t + 2]!)]))
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

/** Stones written as a turned envelope rather than facets: small stones set in numbers. */
const ENVELOPED = new Set<StoneInstance['role']>(['melee', 'accent'])

/**
 * A round stone's envelope, turned: culet, girdle, table — five faces instead of some 230
 * facets, so a pavé of hundreds of stones is kilobytes, not a hundred megabytes, of STEP. The
 * girdle and table are where they are on the faceted stone; a CAD user places and counts with
 * it, the facets are in the 3DM and the reference STL.
 */
function envelope(stone: StoneInstance, scales: readonly [number, number, number]): Shape3D {
  const unit = gemUnit(stone.cut, 1)
  const r = scales[0] / 2
  const k = scales[2]
  const girdle = 0.015 * scales[0]
  const table = 0.28 * scales[0]
  const points: [number, number][] = [
    [0, unit.bottom * k],
    [r, -girdle],
    [r, girdle],
    [table, unit.top * k],
    [0, unit.top * k],
  ]
  const edges = points.map((p, i) => {
    const q = points[(i + 1) % points.length]!
    return makeLine([p[0], 0, p[1]], [q[0], 0, q[1]])
  })
  const wire = assembleWire(edges)
  const face = makeFace(wire)
  try {
    return revolution(face, [0, 0, 0], [0, 0, 1], 360)
  } finally {
    face.delete()
    wire.delete()
    for (const e of edges) e.delete()
  }
}

function stoneShapes(scene: Scene, stones: readonly StoneInstance[]): NamedShape[] {
  const units = new Map<string, Shape3D>()
  try {
    return stones.map((stone) => {
      const scales = axisScales(stone.matrix)
      const key = `${stone.meshKey}|${scales.map((v) => v.toFixed(4)).join(',')}`
      const enveloped = ENVELOPED.has(stone.role) && stone.cut === 'round'
      let unit = units.get(`${key}|${enveloped}`)
      if (!unit) {
        unit = enveloped
          ? envelope(stone, scales)
          : polyhedron(scene.evaluation.gemMeshes[stone.meshKey]!, scales)
        units.set(`${key}|${enveloped}`, unit)
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

/**
 * The header's FILE_NAME carries the time of writing; a fixed value makes two exports of the
 * same design byte-identical, as the production package promises.
 */
function withoutTimestamp(bytes: Uint8Array): Uint8Array {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096))
  const match = /FILE_NAME\s*\(\s*'[^']*'\s*,\s*'([^']*)'/.exec(head)
  if (!match) return bytes
  const at = match.index + match[0].length - match[1]!.length - 1
  const fixed = '2000-01-01T00:00:00'.padEnd(match[1]!.length, ' ').slice(0, match[1]!.length)
  const out = bytes.slice()
  for (let i = 0; i < fixed.length; i++) out[at + i] = fixed.charCodeAt(i)
  return out
}

export const step = defineExporter({
  format: 'step',
  detail: 'production',
  async run(scene, options) {
    const only = options.only && new Set(options.only)
    const shapes: NamedShape[] = []
    const omitted = new Set<string>()
    let uncut = 0
    const uncutNodes = new Set<string>()
    const budget = { passes: MAX_PASSES }
    const exact: { nodeId: string; body: Body }[] = []
    for (const part of scene.parts)
      for (const { nodeId, body } of part.sources) {
        if (only && !only.has(nodeId)) continue
        if (body.solid.exact) exact.push({ nodeId, body })
        else omitted.add(labelOf(scene.nodes.get(nodeId), nodeId))
      }
    // The cutting budget goes to the largest bodies first (a band before its beads); the file
    // keeps the parts' order.
    const cuts = new Map<Body, { shape: Shape3D; cut: boolean }>()
    for (const { nodeId, body } of [...exact].sort(
      (a, b) => b.body.solid.volume() - a.body.solid.volume(),
    ))
      cuts.set(body, cutBody(scene, nodeId, body, budget))
    for (const { nodeId, body } of exact) {
      const result = scene.nodes.get(nodeId)
      const { shape, cut } = cuts.get(body)!
      if (!cut) {
        uncut++
        uncutNodes.add(labelOf(result, nodeId))
      }
      shapes.push({
        shape,
        name: `${labelOf(result, nodeId)} — ${METALS[body.material].label}`,
        color: METALS[body.material].swatch,
      })
    }
    const metal = shapes.length
    const stones = options.stones ?? false
    if (stones)
      shapes.push(
        ...stoneShapes(
          scene,
          scene.evaluation.stones.filter((s) => !only || only.has(s.nodeId)),
        ),
      )
    const uncutNames = [...uncutNodes]
    try {
      // Stones alone are no hand-off: a STEP without metal would only mislead.
      if (metal === 0) throw new Error('Nothing in this design has an exact B-rep to write to STEP')
      // OpenCascade stores colours as linear RGB and writes them gamma-encoded, so a swatch
      // handed over as it is comes out pale; names are numbered where they repeat.
      const seen = new Map<string, number>()
      const written = shapes.map((s) => {
        const n = (seen.get(s.name) ?? 0) + 1
        seen.set(s.name, n)
        return { ...s, name: n > 1 ? `${s.name} ${n}` : s.name, color: linearHex(s.color) }
      })
      const blob = exportSTEP(written, { unit: 'MM' })
      const notes = [
        'STEP AP242, millimetres: exact B-rep solids, one per metal body, named and coloured by alloy.',
      ]
      if (omitted.size > 0)
        notes.push(
          `Mesh bodies have no exact form and are omitted: ${[...omitted].join(', ')}. Use STL, 3MF or 3DM for them.`,
        )
      if (uncut > 0)
        notes.push(
          `${uncut} bod${uncut === 1 ? 'y is' : 'ies are'} exported without seats cut (the exact cut failed, or the design has more seats than one export cuts exactly: ${uncutNames.join(', ')}); the STL has them cut.`,
        )
      notes.push(
        stones
          ? 'Stones are reference solids: centre and side stones faceted, melee and accent stones as turned envelopes (girdle and table in place).'
          : 'Stones are not included.',
      )
      return {
        bytes: withoutTimestamp(new Uint8Array(await blob.arrayBuffer())),
        mime: 'model/step',
        extension: 'step',
        notes,
      }
    } finally {
      for (const s of shapes) s.shape.delete()
    }
  },
})
