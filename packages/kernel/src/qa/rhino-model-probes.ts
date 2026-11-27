import { deepStrictEqual, ok } from 'node:assert/strict'
import {
  applyOps,
  type Design,
  designFrom,
  type MeshVertexEdits,
  type NodeInputOf,
  type NodeOf,
  pointOnNurbs,
  withNurbsPoint,
} from '@pave/schema'
import type {
  File3dm,
  File3dmLayerTable,
  GeometryBase,
  ObjectAttributes,
  RhinoModule,
} from 'rhino3dm'
import type { NodeResult } from '../core'
import { transformPoint } from '../geometry/vec'
import type { RhinoCurveObject, RhinoMeshObject, RhinoNativePart } from '../import/rhino'
import type { LocalKernel } from '../kernel'
import { readEditableMesh } from '../mesh/edit'
import { archive, handles, nativeShape, readCurve, sourceCurve } from './rhino-archive'

type CurveNode = NodeOf<'nurbsCurve'>
type Point = [number, number, number]
type CurveData = ReturnType<typeof readCurve>

export function near(
  actual: readonly number[],
  expected: readonly number[],
  label: string,
  epsilon = 2e-9,
) {
  ok(
    actual.length === expected.length &&
      actual.every((value, i) => {
        const target = expected[i]!
        return (
          Number.isFinite(value) &&
          Math.abs(value - target) <= epsilon * Math.max(1, Math.abs(target))
        )
      }),
    label,
  )
}

function checkCurve(actual: CurveData, expected: CurveNode) {
  const { degree, knots, controlPoints } = expected
  const domain = [knots[degree - 1]!, knots[controlPoints.length - 1]!] as const
  ok(actual.degree === degree, 'Curve degree changed.')
  near(actual.domain, domain, 'Curve domain changed.')
  near(actual.knots, knots, 'Curve knots changed.')
  ok(actual.points.length === controlPoints.length, 'Curve control-point count changed.')
  for (const [i, point] of controlPoints.entries())
    near(actual.points[i]!, point, 'Curve point or rational weight changed.')
  for (const [i, t] of [0, 0.25, 0.5, 0.75, 1].entries())
    near(
      actual.samples[i]!,
      pointOnNurbs(expected, domain[0] + (domain[1] - domain[0]) * t),
      'Curve evaluation changed.',
    )
}

export function importedCurve(part: RhinoCurveObject, id: string): NodeInputOf<'nurbsCurve'> {
  return {
    id,
    kind: 'nurbsCurve',
    degree: part.degree,
    knots: part.knots,
    controlPoints: part.controlPoints,
    rhinoLayer: part.layer ?? undefined,
    sourceObjectId: part.sourceObjectId,
  }
}

export function checkExportedCurve(
  rhino: RhinoModule,
  geometry: GeometryBase,
  props: ObjectAttributes,
  layers: File3dmLayerTable,
  node: CurveNode,
) {
  return handles((hold) => {
    ok(
      geometry instanceof rhino.NurbsCurve && geometry.isValid,
      'Expected an exact native NURBS curve.',
    )
    ok(
      props.getUserString('paveSourceObjectId') === (node.sourceObjectId ?? ''),
      'Curve provenance changed.',
    )
    ok(
      hold(layers.findIndex(props.layerIndex))?.fullPath === (node.rhinoLayer || 'Curves'),
      'Curve export layer changed.',
    )
    const actual = readCurve(geometry)
    checkCurve(actual, node)
    return actual
  })
}

async function curveReadback(rhino: RhinoModule, kernel: LocalKernel, design: Design) {
  const output = await kernel.export(design, '3dm', { stones: false })
  return archive(rhino, output.bytes, (doc, hold) => {
    ok(
      hold(doc.settings()).modelUnitSystem === rhino.UnitSystem.Millimeters,
      'Export must use millimetres.',
    )
    const objects = hold(doc.objects())
    const layers = hold(doc.layers())
    ok(objects.count === design.order.length, 'Curve export count differs from the selection.')
    const seen = new Set<string>()
    const samples = new Map<string, CurveData>()
    for (let i = 0; i < objects.count; i++) {
      handles((take) => {
        const object = take(objects.get(i))
        const geometry = take(object.geometry())
        const props = take(object.attributes())
        const id = props.getUserString('nodeId')
        const node = design.nodes[id]
        ok(node?.kind === 'nurbsCurve' && !seen.has(id), 'Missing, unexpected or duplicate curve.')
        seen.add(id)
        samples.set(id, checkExportedCurve(rhino, geometry, props, layers, node))
      })
    }
    return samples
  })
}

export async function probeCurves(
  rhino: RhinoModule,
  kernel: LocalKernel,
  original: Uint8Array,
  imported: readonly RhinoCurveObject[],
  directCurves: ReadonlyMap<string, string | null>,
  scale: number | undefined,
) {
  if (!imported.length) return { roundTripped: 0, sourceCompared: 0, editedAndUndone: false }
  const inputs = imported.map((part, i) => importedCurve(part, `curve-${i}`))
  const design = designFrom('other', inputs)
  const baseline = await curveReadback(rhino, kernel, design)
  let sourceCompared = 0
  if (scale !== undefined) {
    archive(rhino, original, (doc) => {
      for (const [id, before] of baseline) {
        const node = design.nodes[id] as CurveNode
        const sourceId = directCurves.get(node.sourceObjectId ?? '')
        if (!sourceId) continue
        const source = sourceCurve(rhino, doc, sourceId, scale)
        checkCurve(source, node)
        // The independent archive reader should also see the same placed geometry.
        for (const [i, point] of source.samples.entries())
          near(before.samples[i]!, point, 'Source and round-trip curve samples differ.')
        sourceCompared++
      }
    })
  }

  const selected = inputs.find((curve) => curve.controlPoints.some((p) => p[3] !== 1)) ?? inputs[0]!
  const neighbor = inputs.find(({ id }) => id !== selected.id)
  const scope = designFrom('other', neighbor ? [selected, neighbor] : [selected])
  const strongestWeight = Math.max(...selected.controlPoints.map((point) => point[3]))
  const index = selected.controlPoints.findIndex((point) => point[3] === strongestWeight)
  const [x, y, z, w] = selected.controlPoints[index]!
  const controlPoints = withNurbsPoint(selected, index, [x + (x > 0 ? -0.25 : 0.25), y, z, w])
  const edited = applyOps(scope, [{ t: 'update', id: selected.id, patch: { controlPoints } }])
  const after = await curveReadback(rhino, kernel, edited.design)
  const before = baseline.get(selected.id)!
  ok(
    before.samples.some((p, i) =>
      p.some((value, axis) => Math.abs(value - after.get(selected.id)!.samples[i]![axis]!) > 1e-10),
    ),
    'Curve control-point edit did not change the evaluated curve.',
  )
  if (neighbor)
    deepStrictEqual(
      after.get(neighbor.id),
      baseline.get(neighbor.id),
      'An untouched curve changed.',
    )
  const undo = await curveReadback(rhino, kernel, applyOps(edited.design, edited.inverse).design)
  for (const [id, restored] of undo)
    deepStrictEqual(restored, baseline.get(id), 'Curve undo did not restore the original shape.')
  return { roundTripped: inputs.length, sourceCompared, editedAndUndone: true }
}

export function hasSolidPreview(part: RhinoMeshObject) {
  return (
    part.bytes.length >= 84 + 4 * 50 && part.bounds.max.every((max, i) => max > part.bounds.min[i]!)
  )
}

function moveVertex(part: RhinoMeshObject) {
  const original = readEditableMesh(part.bytes)
  const { positions, indices } = original
  const spans = part.bounds.max.map((hi, i) => hi - part.bounds.min[i]!)
  for (const axis of [0, 1, 2]) {
    for (const direction of [1, -1]) {
      let index = axis
      for (let i = axis + 3; i < positions.length; i += 3)
        if (direction * positions[i]! > direction * positions[index]!) index = i
      const vertex = (index - axis) / 3
      const point = Array.from(positions.subarray(vertex * 3, vertex * 3 + 3)) as Point
      point[axis] = Math.fround(point[axis]! + direction * spans[axis]! * 0.01)
      if (point[axis] === positions[index]) continue
      const edit: MeshVertexEdits = { [vertex]: point }
      let changed: ReturnType<typeof readEditableMesh>
      try {
        changed = readEditableMesh(part.bytes, edit)
      } catch {
        // A boundary vertex can be unsuitable (coincident points or a nearly flat triangle).
        continue
      }
      const expected = positions.slice()
      expected.set(point, vertex * 3)
      ok(
        changed.indices.every((value, i) => value === indices[i]) &&
          changed.indices.length === indices.length &&
          changed.positions.length === expected.length &&
          changed.positions.every((value, i) => value === expected[i]),
        'Mesh edit changed vertices or triangle indices outside the selection.',
      )
      return { edit, point, axis, direction }
    }
  }
  return null
}

function disjoint(a: RhinoMeshObject, b: RhinoMeshObject) {
  return a.bounds.max.some(
    (hi, i) => hi + 0.1 < b.bounds.min[i]! || b.bounds.max[i]! + 0.1 < a.bounds.min[i]!,
  )
}

export function checkNativeProvenance(
  attrs: ObjectAttributes,
  source: Pick<RhinoNativePart, 'objectId' | 'instancePath'>,
) {
  ok(attrs.getUserString('rhinoObjectId') === source.objectId, 'Native source identity changed.')
  ok(
    attrs.getUserString('rhinoInstancePath') ===
      (source.instancePath.length ? JSON.stringify(source.instancePath) : ''),
    'Native block provenance changed.',
  )
}

export function readNativeSource(rhino: RhinoModule, source: RhinoNativePart) {
  return archive(rhino, source.bytes, (doc, hold) => {
    const table = hold(doc.objects())
    ok(
      table.count === 1 && hold(doc.settings()).modelUnitSystem === rhino.UnitSystem.Millimeters,
      'Invalid native source archive.',
    )
    const geometry = hold(hold(table.get(0)).geometry())
    ok(geometry instanceof rhino.Brep, 'Expected a native source BRep.')
    return nativeShape(rhino, doc, geometry, false)
  })
}

export function checkNativeShape(
  reopened: ReturnType<typeof nativeShape>,
  reference: ReturnType<typeof nativeShape>,
  placement: RhinoNativePart['transform'],
) {
  deepStrictEqual(
    reopened.topology,
    reference.topology,
    'Native trim topology changed during export.',
  )
  if (reopened.type === 'instance') {
    ok(placement, 'An instance was added to an unplaced native solid.')
    near(reopened.placement!, placement, 'Native instance placement changed.')
  }
  for (const [i, point] of reference.samples.entries()) {
    const expected = placement ? transformPoint(placement, point) : point
    const sample = reopened.samples[i]!
    const actual = reopened.placement ? transformPoint(reopened.placement, sample) : sample
    near(actual, expected, 'Native edge samples lost their shape or placement.')
  }
}

export const hasUnchangedNativeMesh = (node: NodeResult | undefined): boolean =>
  node?.status === 'ok' &&
  (node.data as { nativeMeshUnmodified?: boolean } | undefined)?.nativeMeshUnmodified === true

function readBodyExport(rhino: RhinoModule, doc: File3dm, design: Design) {
  return handles((hold) => {
    ok(
      hold(doc.settings()).modelUnitSystem === rhino.UnitSystem.Millimeters,
      'Export must use millimetres.',
    )
    const objects = hold(doc.objects())
    const read = new Map<
      string,
      ReturnType<typeof nativeShape> | { type: 'mesh'; shape: string; min: number[]; max: number[] }
    >()
    for (let i = 0; i < objects.count; i++) {
      handles((take) => {
        const object = take(objects.get(i))
        const attrs = take(object.attributes())
        if (attrs.isInstanceDefinitionObject) return
        const geometry = take(object.geometry())
        const id = attrs.getUserString('nodeIds')
        const node = design.nodes[id]
        ok(
          node?.kind === 'meshBody' && node.source.type === 'asset' && !read.has(id),
          'Missing, unexpected, or merged body in the control selection.',
        )
        if (geometry instanceof rhino.Mesh) {
          ok(geometry.isClosed && geometry.isValid, 'Expected a valid closed mesh.')
          const box = take(geometry.getBoundingBox(true))
          read.set(id, {
            type: 'mesh',
            shape: JSON.stringify(geometry.encode()),
            min: box.min,
            max: box.max,
          })
          return
        }
        ok(node.source.rhinoObjectId, 'Missing native source provenance.')
        checkNativeProvenance(attrs, {
          objectId: node.source.rhinoObjectId,
          instancePath: node.source.rhinoInstancePath ?? [],
        })
        read.set(id, nativeShape(rhino, doc, geometry))
      })
    }
    ok(read.size === design.order.length, 'An expected body was missing from the export.')
    return read
  })
}

export function measuredMeshAssets() {
  const data = new Map<string, Uint8Array>()
  const idForSidecar = new Map<string, string>()
  const makeNode = (source: RhinoMeshObject, id: string): NodeInputOf<'meshBody'> => {
    data.set(id, source.bytes)
    const native = source.native
    let nativeAssetId: string | undefined
    if (native) {
      nativeAssetId = idForSidecar.get(native.objectId) ?? `${id}-source`
      idForSidecar.set(native.objectId, nativeAssetId)
      data.set(nativeAssetId, native.bytes)
    }
    return {
      id,
      kind: 'meshBody',
      source: {
        type: 'asset',
        assetId: id,
        rhinoLayer: source.layer ?? undefined,
        ...(native && {
          nativeAssetId,
          nativeMeshAssetId: id,
          nativeTransform: native.transform && [...native.transform],
          rhinoObjectId: native.objectId,
          rhinoInstancePath: [...native.instancePath],
        }),
      },
      keepSourcePlacement: true,
    }
  }
  const assets = async (id: string) => {
    const bytes = data.get(id)
    ok(bytes, 'A local in-memory asset is missing.')
    return bytes
  }
  return { makeNode, assets }
}

export async function probeBodies(
  rhino: RhinoModule,
  kernel: LocalKernel,
  parts: readonly RhinoMeshObject[],
) {
  if (!parts.length) return { status: 'not run: no solid preview' }
  // Prefer a placed native part from a repeated definition, then lower triangle counts.
  const repeats = new Map<string, number>()
  for (const part of parts)
    if (part.native) {
      const id = part.native.objectId
      repeats.set(id, (repeats.get(id) ?? 0) + 1)
    }
  const rank = (part: RhinoMeshObject) =>
    part.native ? (repeats.get(part.native.objectId)! > 1 ? 0 : 1) : 2
  const sorted = [...parts].sort((a, b) => rank(a) - rank(b) || a.bytes.length - b.bytes.length)
  let selection:
    | { part: RhinoMeshObject; change: NonNullable<ReturnType<typeof moveVertex>> }
    | undefined
  for (const part of sorted) {
    const change = moveVertex(part)
    if (!change) continue
    selection = { part, change }
    break
  }
  ok(selection, 'No measurable, valid edit found on the imported source meshes.')
  const { part, change } = selection
  // Leave enough space for the outward test edit. A singleton still proves the selected
  // part can transition through native and mesh export without assembly interference.
  const { axis, direction, point } = change
  const envelope = {
    ...part,
    bounds: {
      min: [...part.bounds.min] as Point,
      max: [...part.bounds.max] as Point,
    },
  }
  envelope.bounds[direction > 0 ? 'max' : 'min'][axis] = point[axis]!
  const sibling = sorted.find((other) => other !== part && disjoint(envelope, other))

  const { makeNode, assets } = measuredMeshAssets()
  const chosen = makeNode(part, 'selected')
  const design = designFrom('other', sibling ? [chosen, makeNode(sibling, 'untouched')] : [chosen])
  const draft = await kernel.scene(design, { detail: 'draft', assets })
  const selectedNative = hasUnchangedNativeMesh(draft.nodes.get(chosen.id))
  const untouchedNative = hasUnchangedNativeMesh(draft.nodes.get('untouched'))
  const output = async (scope: Design) =>
    archive(rhino, (await kernel.export(scope, '3dm', { assets, stones: false })).bytes, (doc) =>
      readBodyExport(rhino, doc, scope),
    )
  const baseline = await output(design)
  const before = baseline.get(chosen.id)!
  const checkNative = (source: RhinoMeshObject, selected: typeof before, eligible: boolean) => {
    if (!source.native || !eligible) {
      ok(
        selected.type === 'mesh',
        'A source without an eligible native solid did not export as a mesh.',
      )
      return
    }
    ok(selected.type !== 'mesh', 'The controlled native source exported as a mesh before any edit.')
    checkNativeShape(selected, readNativeSource(rhino, source.native), source.native.transform)
  }
  checkNative(part, before, selectedNative)
  if (sibling) checkNative(sibling, baseline.get('untouched')!, untouchedNative)
  const update = applyOps(design, [
    {
      t: 'update',
      id: chosen.id,
      patch: { meshEdits: { assetId: chosen.id, vertices: change.edit } },
    },
  ])
  const edited = await output(update.design)
  const after = edited.get(chosen.id)!
  ok(after.type === 'mesh', 'A body with a vertex shape edit did not export as a mesh.')
  near(
    [after[direction > 0 ? 'max' : 'min'][axis]!],
    [point[axis]!],
    'Exported mesh missed the edited vertex.',
    2e-7,
  )
  deepStrictEqual(edited.get('untouched'), baseline.get('untouched'), 'An untouched body changed.')
  const undone = await output(applyOps(update.design, update.inverse).design)
  deepStrictEqual(undone, baseline, 'Body undo did not restore the original selected geometry.')
  return {
    baseline: before.type,
    edited: after.type,
    undone: undone.get(chosen.id)!.type,
    untouched: baseline.get('untouched')?.type ?? 'not run: no disjoint part',
    repeatedNativeSource: !!part.native && (repeats.get(part.native.objectId) ?? 0) > 1,
  }
}
