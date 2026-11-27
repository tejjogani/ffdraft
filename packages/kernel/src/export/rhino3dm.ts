/**
 * Rhino .3dm through rhino3dm (OpenNURBS compiled to WASM), loaded only when this format is
 * asked for. Unchanged Rhino solids keep their imported BReps. The remaining bodies are
 * written as meshes, with a layer per alloy and one for stones, in millimetres.
 */
import { METALS, type NodeOf } from '@pave/schema'
import { defineExporter, type Scene } from '../core'
import type { ChainData } from '../features/chain'
import { fromFrame } from '../geometry/vec'
import { inheritedMaterial } from '../import/rhino-context'
import { CURVE_SOURCE_ID_KEY } from '../import/rhino-curve'
import { freeRhino as free, loadRhino3dm } from '../runtime/rhino'
import type { ExportOptions } from '../types'
import { type MeshObject, objectColor, sceneObjects } from './meshes'
import { rhinoContextWriter } from './rhino-context'
import { writeRhinoNurbsCurve } from './rhino-curve'
import { nativeSolidWriter } from './rhino-native'

const rgba = (hex: string) => ({
  r: Number.parseInt(hex.slice(1, 3), 16),
  g: Number.parseInt(hex.slice(3, 5), 16),
  b: Number.parseInt(hex.slice(5, 7), 16),
  a: 255,
})

/** User strings a Rhino user (or a script) reads off an object. */
function userStrings(o: MeshObject): Record<string, string> {
  if (o.kind === 'metal')
    return {
      nodeIds: o.nodeIds.join(','),
      alloy: o.material,
      alloyName: METALS[o.material].label,
      finish: o.finish,
      plating: o.plating,
      volumeMm3: o.volumeMm3.toFixed(2),
    }
  const s = o.stone
  return {
    nodeId: s.nodeId,
    stoneId: s.id,
    stone: s.stone,
    cut: s.cut,
    carat: s.carat.toFixed(3),
    lengthMm: s.dims.length.toFixed(2),
    widthMm: s.dims.width.toFixed(2),
    depthMm: s.dims.depth.toFixed(2),
    setting: s.setting,
    role: s.role,
  }
}

/** A singleton imported source carries its own modeling identity even if geometry uses a mesh. */
function importedObject(scene: Scene, o: MeshObject) {
  if (o.kind !== 'metal' || o.part.sources.length !== 1) return null
  const node = scene.nodes.get(o.part.sources[0]!.nodeId)?.node
  if (node?.kind !== 'meshBody' || node.source.type !== 'asset' || !node.keepSourcePlacement)
    return null
  const { rhinoLayer, rhinoObjectId, rhinoInstancePath, rhinoContext } = node.source
  return {
    name: node.name?.trim() || o.name,
    path: rhinoLayer?.split('::').filter(Boolean),
    context: rhinoContext,
    hasNativeSource: Boolean(node.source.nativeAssetId),
    strings: {
      ...(rhinoObjectId && { rhinoObjectId }),
      ...(rhinoInstancePath?.length && { rhinoInstancePath: JSON.stringify(rhinoInstancePath) }),
    },
  }
}

/** Girdle outline: an ellipse of the stone's length × width in its girdle plane (round: exact). */
function girdle(stone: MeshObject & { kind: 'stone' }): number[][] {
  const m = stone.stone.matrix
  const frame = {
    origin: [m[12]!, m[13]!, m[14]!] as const,
    x: [m[0]!, m[1]!, m[2]!].map(
      (v) => v / Math.hypot(m[0]!, m[1]!, m[2]!),
    ) as unknown as readonly [number, number, number],
    y: [m[4]!, m[5]!, m[6]!].map(
      (v) => v / Math.hypot(m[4]!, m[5]!, m[6]!),
    ) as unknown as readonly [number, number, number],
    z: [0, 0, 0] as const,
  }
  const { length, width } = stone.stone.dims
  const n = 48
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (2 * Math.PI * i) / n
    return [...fromFrame(frame, [(width / 2) * Math.cos(a), (length / 2) * Math.sin(a), 0])]
  })
}

async function write3dm(
  scene: Scene,
  objects: readonly MeshObject[],
  curves: readonly NodeOf<'nurbsCurve'>[],
  options: ExportOptions,
) {
  const rhino = await loadRhino3dm()
  const doc = new rhino.File3dm()
  // The document's tables, fetched once and freed with it. Each call to `doc.objects()` (or
  // `layers()`, `settings()`, `strings()`) makes a WASM-side object that keeps the whole model
  // alive: left unfreed, every export's meshes stayed in the heap for good.
  const held: object[] = []
  const hold = <T extends object>(o: T): T => {
    held.push(o)
    return o
  }
  const objectTable = hold(doc.objects())
  const native = nativeSolidWriter(rhino, doc, objectTable, scene, options)
  const context = rhinoContextWriter(rhino, doc)
  try {
    const settings = hold(doc.settings())
    const layerTable = hold(doc.layers())
    settings.modelUnitSystem = rhino.UnitSystem.Millimeters
    const layers = new Map<string, number>()
    /** A layer by path (`['Metal', '18k Yellow Gold']`), created with its parents on first use. */
    const layerFor = (path: readonly string[], color: string): number => {
      const key = path.join('::')
      let index = layers.get(key)
      if (index === undefined) {
        const layer = new rhino.Layer()
        layer.name = path[path.length - 1]!
        layer.color = rgba(color)
        if (path.length > 1) {
          const parent = layerTable.get(layerFor(path.slice(0, -1), color))
          layer.parentLayerId = parent.id
          free(parent)
        }
        index = layerTable.add(layer)
        free(layer)
        layers.set(key, index)
      }
      return index
    }
    const attributes = (name: string, layer: number, strings: Record<string, string>) => {
      const a = new rhino.ObjectAttributes()
      a.name = name
      a.layerIndex = layer
      for (const [k, v] of Object.entries(strings)) a.setUserString(k, v)
      return a
    }
    let meshBodies = 0
    const evaluatedImports: string[] = []
    for (const o of objects) {
      options.signal?.throwIfAborted()
      const imported = importedObject(scene, o)
      const layer =
        o.kind === 'metal'
          ? layerFor(
              imported?.path?.length ? imported.path : ['Metal', METALS[o.material].label],
              objectColor(o),
            )
          : layerFor(['Stones'], '#9fd3ff')
      const attrs = attributes(imported?.name ?? o.name, layer, {
        ...userStrings(o),
        ...imported?.strings,
      })
      const source = imported?.context
      if (source) context.write(attrs, source)
      const affineContext =
        source &&
        (() => {
          const path = source.placements[0]?.layer?.split('::').filter(Boolean)
          return {
            placementLayerIndex: path?.length ? layerFor(path, objectColor(o)) : layer,
            placementMaterialIndex: context.materialIndex(inheritedMaterial(source.placements)),
            memberMaterialIndex: context.materialIndex(source.material),
            memberMaterialFromParent: source.materialFromParent,
          }
        })
      if (o.kind === 'metal' && (await native.write(o.part, attrs, affineContext))) {
        free(attrs)
        continue
      }
      const mesh = new rhino.Mesh()
      const p = o.positions
      // One list object for the whole loop, freed after it: `mesh.vertices()` hands out a new
      // WASM-side object on every call, and one per vertex and per face was never freed.
      const vertices = mesh.vertices()
      for (let i = 0; i < p.length; i += 3) vertices.add(p[i]!, p[i + 1]!, p[i + 2]!)
      free(vertices)
      const faces = mesh.faces()
      for (let t = 0; t < o.indices.length; t += 3)
        faces.addTriFace(o.indices[t]!, o.indices[t + 1]!, o.indices[t + 2]!)
      free(faces)
      const normals = mesh.normals()
      normals.computeNormals()
      free(normals)
      mesh.compact()
      const meshId = objectTable.addMesh(mesh, attrs)
      free(attrs)
      free(mesh)
      if (meshId === '00000000-0000-0000-0000-000000000000')
        throw new Error(`Rhino could not write mesh “${imported?.name ?? o.name}”.`)
      if (o.kind === 'metal') {
        meshBodies++
        if (imported?.hasNativeSource && !o.part.preservesNativeSurface)
          evaluatedImports.push(
            `“${imported.name}” uses the evaluated mesh because the current body could not retain its original native surface.`,
          )
      }
      if (o.kind === 'stone') {
        const curve = attributes(`${o.name} girdle`, layerFor(['Curves', 'Girdles'], '#5a8fb8'), {
          stoneId: o.stone.id,
        })
        objectTable.addPolyline(girdle(o), curve)
        free(curve)
      }
    }
    for (const curve of curves) {
      options.signal?.throwIfAborted()
      const path = curve.rhinoLayer?.split('::').filter(Boolean)
      const attrs = attributes(
        curve.name || curve.id,
        layerFor(path?.length ? path : ['Curves'], '#5a8fb8'),
        {
          nodeId: curve.id,
          ...(curve.sourceObjectId && { [CURVE_SOURCE_ID_KEY]: curve.sourceObjectId }),
        },
      )
      try {
        if (curve.rhinoContext) context.write(attrs, curve.rhinoContext)
        writeRhinoNurbsCurve(rhino, objectTable, curve, attrs)
      } finally {
        free(attrs)
      }
    }
    const only = options.only && new Set(options.only)
    for (const result of scene.nodes.values())
      if (
        result.status === 'ok' &&
        result.node.visible &&
        result.node.kind === 'chain' &&
        (!only || only.has(result.id))
      ) {
        const data = result.data as ChainData
        const points = data.path.map((p) => [...p])
        if (data.closed) points.push(points[0]!)
        const attrs = attributes(
          `${result.node.name ?? result.id} centre line`,
          layerFor(['Curves', 'Chains'], '#b08a3c'),
          {
            nodeId: result.id,
            links: String(data.links),
            lengthMm: data.length.toFixed(1),
          },
        )
        objectTable.addPolyline(points, attrs)
        free(attrs)
      }
    hold(doc.strings()).set('generator', 'Pave')
    return {
      bytes: doc.toByteArray(),
      meshBodies,
      retained: native.count,
      nativeNotes: [...native.notes(), ...evaluatedImports],
    }
  } finally {
    native.dispose()
    context.dispose()
    for (const table of held) free(table)
    free(doc)
  }
}

export const rhino3dm = defineExporter({
  format: '3dm',
  detail: 'production',
  separateImportedBodies: true,
  async run(scene, options) {
    const only = options.only && new Set(options.only)
    const curves: NodeOf<'nurbsCurve'>[] = []
    for (const { node, status } of scene.nodes.values()) {
      if (
        status === 'ok' &&
        node.visible &&
        node.kind === 'nurbsCurve' &&
        (!only || only.has(node.id))
      )
        curves.push(node)
    }
    const objects = sceneObjects(scene, {
      stones: options.stones ?? true,
      ...(options.only && { only: options.only }),
      allowEmpty: curves.length > 0,
    })
    const { bytes, meshBodies, retained, nativeNotes } = await write3dm(
      scene,
      objects,
      curves,
      options,
    )
    return {
      bytes,
      mime: 'application/x-3dm',
      extension: '3dm',
      notes: [
        `${retained} native Rhino solid${retained === 1 ? '' : 's'} retained, ${meshBodies} evaluated mesh ${meshBodies === 1 ? 'body' : 'bodies'}, ${curves.length} editable NURBS curve${curves.length === 1 ? '' : 's'}.`,
        ...nativeNotes,
        'Evaluated bodies export as meshes. STEP carries exact Pavé geometry where available.',
        'Curve layers keep their Rhino paths. New curves, chain centre lines and stone girdles appear under Curves.',
        'Each object carries user strings: node ids, alloy, finish and plating for metal; stone, cut, carat and size for stones.',
      ],
    }
  },
})

export { loadRhino3dm } from '../runtime/rhino'
