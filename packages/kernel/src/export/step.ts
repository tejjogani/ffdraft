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
  createAssembly,
  downcast,
  type Face,
  makeFace,
  makeLine,
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
  type Solid,
} from '../core'
import { createBreather } from '../evaluate/yield'
import { gemUnit } from '../gems/index'
import { isRuntimeFault, runtimeGeneration } from '../runtime/index'
import { boundsOverlap, weld } from '../solid/meshing'
import { compoundOf, scoped, shapeVolume, transformShape, wrapShape } from '../solid/occt'
import type { Bounds, MeshData, StoneInstance } from '../types'
import { linearHex } from './color'

interface NamedShape {
  shape: Shape3D
  name: string
  color: string
}

const labelOf = (result: NodeResult | undefined, fallback: string) =>
  result?.node.name ?? result?.node.id ?? fallback

/**
 * Cutters aimed at a node (or at whatever they touch) that overlap its body. Metal added after
 * the cuts (beads, claw tips: `afterCuts`) is not cut, exactly as in the cast part.
 */
function cuttersFor(scene: Scene, nodeId: string, body: Body): Solid[] {
  const late = scene.nodes.get(nodeId)?.additions.some((a) => a.afterCuts && a.solid === body.solid)
  if (late) return []
  const box = body.solid.bounds()
  return [...scene.nodes.values()]
    .filter((r) => r.status === 'ok' && r.node.visible)
    .flatMap((r) => r.cuts)
    .filter(
      (c) =>
        (c.targets === 'all' || c.targets.includes(nodeId)) && boundsOverlap(c.solid.bounds(), box),
    )
    .map((c) => c.solid)
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
 * Exact cutters allowed in one export. One seat cut into a swept (B-spline) band takes 1–1.5 s
 * in OpenCascade, holes about half that, and a band with dozens of seats took 90 s, holding the
 * production worker and every request queued behind it. Beyond this the remaining bodies go
 * out uncut and the note names them; the STL always has every seat. A count, not a clock, so
 * two exports of the same design cut exactly the same bodies.
 */
const MAX_EXACT_CUTTERS = 8

/**
 * One exact cutting pass, or null when OpenCascade's result cannot be trusted (it can return
 * garbage without an error). Only the exact boolean: a mesh fallback would be wasted work here,
 * since a body that cannot be cut exactly goes out uncut. Same-domain faces are not merged
 * after each pass: on a band that already carries dozens of seats that clean-up took most of
 * the time, and the solid is just as valid without it.
 */
function exactCut(target: Shape3D, tools: readonly Shape3D[]): Shape3D | null {
  const before = shapeVolume(target)
  let result: Shape3D | null = null
  try {
    const tool = tools.length === 1 ? tools[0]! : compoundOf(tools)
    try {
      result = target.cut(tool, { simplify: false })
    } finally {
      if (tool !== tools[0]) tool.delete()
    }
    const volume = shapeVolume(result)
    const slack = 1e-6 * Math.max(1, before)
    if (Number.isFinite(volume) && volume > slack && volume <= before + slack) return result
  } catch {
    // An exception is as untrustworthy as an implausible volume.
  }
  result?.delete()
  return null
}

interface CachedCut {
  shape: Shape3D
  cut: boolean
  /** The cutters it was cut with, and how many of the export's cutter budget it took. */
  tools: readonly Solid[]
  spent: number
}

/** The cut bodies of the last export, and the runtime they live in (see `runtimeGeneration`). */
let lastCuts = new Map<Solid, CachedCut>()
let generation = runtimeGeneration()

/** The body's B-rep with its seats cut, or uncut when an exact boolean cannot be trusted. */
async function cutBody(
  tools: readonly Solid[],
  body: Body,
  budget: { cutters: number },
  breathe: () => Promise<void>,
): Promise<{ shape: Shape3D; cut: boolean }> {
  const own = body.solid.brep()!
  if (tools.length === 0) return { shape: own.clone(), cut: true }
  // All of a body's cutters or none: a half-cut body would be the worst of both.
  if (tools.length > budget.cutters) return { shape: own.clone(), cut: false }
  budget.cutters -= tools.length
  const planned = passes(tools.map((solid) => ({ solid })))
  let current = own
  try {
    for (const pass of planned) {
      // A pass takes seconds on a heavily seated band: let an abort (or the next request) in.
      await breathe()
      const next = exactCut(
        current,
        pass.map((t) => t.solid.brep()!),
      )
      // One pass failing means the exact body cannot carry its seats.
      if (!next) return { shape: own.clone(), cut: false }
      if (current !== own) current.delete()
      current = next
    }
    const done = current
    current = own
    return { shape: done, cut: true }
  } finally {
    if (current !== own) current.delete()
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
  // Edges and wires are freed here, as in `envelope`: replicad's `makePolygon` leaves three
  // edges and a wire per facet to the garbage collector, which has no idea how much WASM
  // memory they hold, so every export of a faceted stone grew the heap by megabytes.
  const faces: Face[] = []
  for (let t = 0; t < indices.length; t += 3) {
    const corners = [point(indices[t]!), point(indices[t + 1]!), point(indices[t + 2]!)]
    const edges = corners.map((p, i) => makeLine(p, corners[(i + 1) % 3]!))
    const wire = assembleWire(edges)
    faces.push(makeFace(wire))
    wire.delete()
    for (const e of edges) e.delete()
  }
  const { oc } = runtime()
  try {
    return scoped((own) => {
      // What replicad's `makeSolid` does, with the sewing tool (which holds every facet and
      // its own maps) freed now rather than whenever the garbage collector next runs.
      const sewing = own(new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false))
      for (const f of faces) sewing.Add(f.wrapped)
      sewing.Perform()
      const shell = own(downcast(own(sewing.SewedShape())))
      const solid = own(own(new oc.ShapeFix_Solid()).SolidFromShell(shell))
      const unify = own(new oc.ShapeUpgrade_UnifySameDomain(solid, true, true, false))
      unify.Build()
      return wrapShape<Shape3D>(unify.Shape())
    })
  } finally {
    for (const f of faces) f.delete()
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
 * Writes named, coloured shapes as STEP in millimetres: replicad's `exportSTEP`, call for call,
 * except that the document, the session and the writer are freed before returning. replicad
 * leaves them to the garbage collector, which cannot see the WASM memory they hold (megabytes
 * per faceted stone), so the heap of a long-lived kernel grew with every export.
 */
function writeStep(shapes: readonly NamedShape[]): Uint8Array {
  const { oc } = runtime()
  const doc = createAssembly([...shapes])
  try {
    return scoped((own) => {
      own(new oc.STEPCAFControl_Writer())
      oc.Interface_Static.SetCVal('xstep.cascade.unit', 'MM')
      oc.Interface_Static.SetCVal('write.step.unit', 'MM')
      const session = own(new oc.XSControl_WorkSession())
      const writer = own(new oc.STEPCAFControl_Writer(session, false))
      writer.SetColorMode(true)
      writer.SetLayerMode(true)
      writer.SetNameMode(true)
      oc.Interface_Static.SetIVal('write.surfacecurve.mode', 1)
      oc.Interface_Static.SetIVal('write.precision.mode', 0)
      oc.Interface_Static.SetIVal('write.step.assembly', 2)
      oc.Interface_Static.SetIVal('write.step.schema', 5)
      const progress = own(new oc.Message_ProgressRange())
      if (!writer.Perform(doc.wrapped, 'export.step', progress))
        throw new Error('OpenCascade could not write the STEP file')
      const file = oc.FS.readFile('/export.step') as Uint8Array
      oc.FS.unlink('/export.step')
      return file
    })
  } finally {
    doc.delete()
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
    const budget = { cutters: MAX_EXACT_CUTTERS }
    const exact: { nodeId: string; body: Body }[] = []
    for (const part of scene.parts)
      for (const { nodeId, body } of part.sources) {
        if (only && !only.has(nodeId)) continue
        if (body.solid.exact) exact.push({ nodeId, body })
        else omitted.add(labelOf(scene.nodes.get(nodeId), nodeId))
      }
    // The cutting budget goes to the largest bodies first (a band before its beads); the file
    // keeps the parts' order. Cuts made for the previous export are reused where the body and
    // its cutters are the same solids: the stones/no-stones variants and repeat exports of a
    // design cost one cut, not one each.
    const breathe = createBreather(options.signal)
    const previous: Map<Solid, CachedCut> =
      generation === runtimeGeneration() ? lastCuts : new Map()
    const cuts = new Map<Solid, CachedCut>()
    let faulted = false
    try {
      for (const { nodeId, body } of [...exact].sort(
        (a, b) => b.body.solid.volume() - a.body.solid.volume(),
      )) {
        await breathe()
        const tools = cuttersFor(scene, nodeId, body)
        const known = previous.get(body.solid)
        if (
          known &&
          known.spent <= budget.cutters &&
          known.tools.length === tools.length &&
          known.tools.every((t, i) => t === tools[i])
        ) {
          budget.cutters -= known.spent
          previous.delete(body.solid)
          cuts.set(body.solid, known)
          continue
        }
        const before = budget.cutters
        const made = await cutBody(tools, body, budget, breathe)
        cuts.set(body.solid, { ...made, tools, spent: before - budget.cutters })
      }
    } catch (error) {
      faulted = isRuntimeFault(error)
      throw error
    } finally {
      // Whatever the previous export cut and this one did not reuse is freed; what this one
      // cut (even if it was aborted halfway) is kept for the next. After a fault the heap is
      // gone: nothing is freed, and the next export starts afresh (see `generation`).
      if (!faulted) for (const stale of previous.values()) stale.shape.delete()
      lastCuts = cuts
      generation = runtimeGeneration()
    }
    for (const { nodeId, body } of exact) {
      const result = scene.nodes.get(nodeId)
      const { shape: cachedShape, cut } = cuts.get(body.solid)!
      // The file gets its own handle; the cached shape stays for the next export.
      const shape = cachedShape.clone()
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
      const file = writeStep(written)
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
        bytes: withoutTimestamp(file),
        mime: 'model/step',
        extension: 'step',
        notes,
      }
    } finally {
      for (const s of shapes) s.shape.delete()
    }
  },
})
