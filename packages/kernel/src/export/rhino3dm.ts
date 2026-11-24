/**
 * Rhino .3dm through rhino3dm (OpenNURBS compiled to WASM), loaded only when this format is
 * asked for. A .3dm written from JavaScript can hold meshes, curves, layers and metadata but
 * not a general B-rep (docs/research/01-cad.md §5), so this is the editable reference
 * companion: a layer per alloy and one for stones, named meshes with user strings, the chain
 * centre lines and stone girdles as curves, millimetre units. STEP is the exact B-rep route.
 */
import { METALS } from '@pave/schema'
import type { RhinoModule } from 'rhino3dm'
import { defineExporter, type Scene } from '../core'
import type { ChainData } from '../features/chain'
import { fromFrame } from '../geometry/vec'
import { isNode, readPackageFile } from '../runtime/host'
import { type MeshObject, metalNotes, objectColor, sceneObjects } from './meshes'

let loading: Promise<RhinoModule> | null = null

/**
 * rhino3dm, loaded on first use from its ES-module build (the CommonJS entry names Node's `ws`
 * package, which breaks browser bundles). Node reads the binary from the installed package, as
 * the core does for its WASM; in a browser the bundler serves it and Vite's `?url` import gives
 * its address — so 3DM export needs no setup from the host, in a Worker or anywhere else.
 */
function loadRhino(): Promise<RhinoModule> {
  loading ??= (async () => {
    const { default: factory } = await import('rhino3dm/rhino3dm.module.js')
    if (isNode()) return factory({ wasmBinary: await readPackageFile('rhino3dm/rhino3dm.wasm') })
    const { default: url } = await import('rhino3dm/rhino3dm.wasm?url')
    return factory({ locateFile: () => url })
  })().catch((error) => {
    loading = null
    throw error
  })
  return loading
}

/** rhino3dm's typings omit Embind's `delete()`, which every wrapped object has. */
const free = (o: object) => (o as { delete?: () => void }).delete?.()

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

async function write3dm(scene: Scene, objects: readonly MeshObject[]): Promise<Uint8Array> {
  const rhino = await loadRhino()
  const doc = new rhino.File3dm()
  try {
    doc.settings().modelUnitSystem = rhino.UnitSystem.Millimeters
    const layers = new Map<string, number>()
    /** A layer by path (`['Metal', '18k Yellow Gold']`), created with its parents on first use. */
    const layerFor = (path: readonly string[], color: string): number => {
      const key = path.join('::')
      let index = layers.get(key)
      if (index === undefined) {
        const layer = new rhino.Layer()
        layer.name = path[path.length - 1]!
        layer.color = rgba(color)
        if (path.length > 1)
          layer.parentLayerId = doc.layers().get(layerFor(path.slice(0, -1), color)).id
        index = doc.layers().add(layer)
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
    for (const o of objects) {
      const mesh = new rhino.Mesh()
      const p = o.positions
      for (let i = 0; i < p.length; i += 3) mesh.vertices().add(p[i]!, p[i + 1]!, p[i + 2]!)
      for (let t = 0; t < o.indices.length; t += 3)
        mesh.faces().addTriFace(o.indices[t]!, o.indices[t + 1]!, o.indices[t + 2]!)
      mesh.normals().computeNormals()
      mesh.compact()
      const layer =
        o.kind === 'metal'
          ? layerFor(['Metal', METALS[o.material].label], objectColor(o))
          : layerFor(['Stones'], '#9fd3ff')
      const attrs = attributes(o.name, layer, userStrings(o))
      doc.objects().addMesh(mesh, attrs)
      free(attrs)
      free(mesh)
      if (o.kind === 'stone') {
        const curve = attributes(`${o.name} girdle`, layerFor(['Curves', 'Girdles'], '#5a8fb8'), {
          stoneId: o.stone.id,
        })
        doc.objects().addPolyline(girdle(o), curve)
        free(curve)
      }
    }
    for (const result of scene.nodes.values())
      if (result.status === 'ok' && result.node.kind === 'chain') {
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
        doc.objects().addPolyline(points, attrs)
        free(attrs)
      }
    doc.strings().set('generator', 'Pave')
    return doc.toByteArray()
  } finally {
    free(doc)
  }
}

export const rhino3dm = defineExporter({
  format: '3dm',
  detail: 'production',
  async run(scene, options) {
    const objects = sceneObjects(scene, {
      stones: options.stones ?? true,
      ...(options.only && { only: options.only }),
    })
    return {
      bytes: await write3dm(scene, objects),
      mime: 'application/x-3dm',
      extension: '3dm',
      notes: [
        '3DM carries meshes and curves only — JavaScript cannot write general Rhino B-reps. For exact NURBS solids use the STEP export.',
        'Millimetres. Layers: one per alloy under Metal, Stones, and Curves (chain centre lines, stone girdles).',
        'Each object carries user strings: node ids, alloy, finish and plating for metal; stone, cut, carat and size for stones.',
        ...metalNotes(scene, objects),
        'OpenNURBS stamps each file with fresh object ids and the time it was written (rhino3dm cannot set them), so two exports of the same design differ byte for byte; the geometry is identical.',
      ],
    }
  },
})

/** Exposed for the round-trip test, which reads files back with the same module. */
export const loadRhino3dm = loadRhino
