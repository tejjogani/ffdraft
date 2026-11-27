import { ok } from 'node:assert/strict'
import { designFrom } from '@pave/schema'
import type { RhinoModule } from 'rhino3dm'
import type { RhinoCurveObject, RhinoMeshObject, RhinoNativePart } from '../import/rhino'
import { createKernel, type LocalKernel } from '../kernel'
import type { AssetResolver, Bounds } from '../types'
import { archive, handles, nativeShape } from './rhino-archive'
import {
  checkExportedCurve,
  checkNativeProvenance,
  checkNativeShape,
  hasUnchangedNativeMesh,
  importedCurve,
  measuredMeshAssets,
  near,
  readNativeSource,
} from './rhino-model-probes'

type ImportDesign = ReturnType<typeof designFrom>

async function expectedBodies(
  rhino: RhinoModule,
  design: ImportDesign,
  assets: AssetResolver,
  input: ReadonlyMap<string, RhinoMeshObject>,
) {
  // Qualify unchanged render caches from individual draft builds, before production
  // assembly or export can join bodies. The same mesh repair is used at both detail levels.
  const draft = createKernel()
  try {
    const { nodes } = await draft.scene(design, { detail: 'draft', assets })
    const expected = new Map<string, { bounds: Bounds; native?: RhinoNativePart }>()
    const nativeSources = new Map<string, ReturnType<typeof readNativeSource>>()
    let meshOnlyInputs = 0
    let repairedNativeInputs = 0
    for (const [id, source] of input) {
      const result = nodes.get(id)
      ok(
        result?.status === 'ok' && result.bodies.length === 1,
        'An imported body could not build a usable display solid.',
      )
      const native = hasUnchangedNativeMesh(result) ? source.native : undefined
      if (!source.native) meshOnlyInputs++
      else if (!native) repairedNativeInputs++
      if (native && !nativeSources.has(native.objectId))
        nativeSources.set(native.objectId, readNativeSource(rhino, native))
      expected.set(id, { bounds: result.bodies[0]!.solid.bounds(), native })
    }
    return { expected, nativeSources, meshOnlyInputs, repairedNativeInputs }
  } finally {
    draft.dispose()
  }
}

export async function probeFullExport(
  rhino: RhinoModule,
  kernel: LocalKernel,
  parts: readonly RhinoMeshObject[],
  curves: readonly RhinoCurveObject[],
) {
  const { makeNode, assets } = measuredMeshAssets()
  const bodies = parts.map((part, index) => makeNode(part, `body-${index}`))
  const rails = curves.map((part, index) => importedCurve(part, `curve-${index}`))
  const design = designFrom('other', [...bodies, ...rails])
  const input = new Map(bodies.map(({ id }, index) => [id, parts[index]!]))
  const { expected, nativeSources, meshOnlyInputs, repairedNativeInputs } = await expectedBodies(
    rhino,
    design,
    assets,
    input,
  )
  // One unfiltered export ensures the production route sees all overlapping nodes at once.
  const output = await kernel.export(design, '3dm', { assets })
  return archive(rhino, output.bytes, (doc, hold) => {
    ok(
      hold(doc.settings()).modelUnitSystem === rhino.UnitSystem.Millimeters,
      'Export must use millimetres.',
    )
    const objects = hold(doc.objects())
    const layers = hold(doc.layers())
    const seen = new Set<string>()
    let nativeBReps = 0
    let nativeInstances = 0
    let placedNativeBodies = 0
    let meshBodies = 0
    let curveCount = 0
    for (let i = 0; i < objects.count; i++) {
      handles((take) => {
        const object = take(objects.get(i))
        const attrs = take(object.attributes())
        if (attrs.isInstanceDefinitionObject) return

        const bodyId = attrs.getUserString('nodeIds')
        const curveId = attrs.getUserString('nodeId')
        ok(!bodyId.includes(','), 'Full export fused multiple imported bodies into one object.')
        ok(!!bodyId !== !!curveId, 'Expected one source node on each exported object.')
        const id = bodyId || curveId
        ok(
          design.nodes[id] && !seen.has(id),
          'Full export contains an unexpected or duplicate node.',
        )
        seen.add(id)

        const geometry = take(object.geometry())
        if (curveId) {
          const node = design.nodes[id]
          ok(node?.kind === 'nurbsCurve', 'Unexpected curve node in the full export.')
          checkExportedCurve(rhino, geometry, attrs, layers, node)
          curveCount++
          return
        }

        const body = expected.get(id)
        ok(body, 'Unexpected body node in the full export.')
        const source = input.get(id)!
        if (source.native) checkNativeProvenance(attrs, source.native)
        if (source.layer) {
          ok(
            take(layers.findIndex(attrs.layerIndex))?.fullPath === source.layer,
            'Imported body layer changed during full export.',
          )
        }
        if (body.native) {
          const native = nativeShape(rhino, doc, geometry, false)
          checkNativeShape(native, nativeSources.get(body.native.objectId)!, body.native.transform)
          if (native.type === 'instance') nativeInstances++
          else nativeBReps++
          if (body.native.instancePath.length) placedNativeBodies++
          return
        }

        ok(
          geometry instanceof rhino.Mesh && geometry.isValid && geometry.isClosed,
          'Expected a valid closed mesh for a body without an eligible native solid.',
        )
        const box = take(geometry.getBoundingBox(true))
        near(box.min, body.bounds.min, 'Mesh lower bounds changed during export.', 2e-7)
        near(box.max, body.bounds.max, 'Mesh upper bounds changed during export.', 2e-7)
        meshBodies++
      })
    }
    ok(
      seen.size === design.order.length,
      `Full export is missing ${design.order.length - seen.size} supported source nodes.`,
    )
    return {
      supportedBodies: parts.length,
      supportedCurves: curves.length,
      expectedNativeBodies: parts.length - meshOnlyInputs - repairedNativeInputs,
      meshOnlyInputs,
      repairedNativeInputs,
      nativeBReps,
      nativeInstances,
      placedNativeBodies,
      meshBodies,
      curves: curveCount,
      sourceParity: true,
    }
  })
}
