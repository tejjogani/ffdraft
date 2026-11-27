import { readStlModel } from '@pave/kernel/mesh-import'
import { MAX_RHINO_FILE_BYTES, readRhino3dm } from '@pave/kernel/rhino-import'
import type { Bounds } from '@pave/kernel/types'
import {
  isModelFile,
  isStlFile,
  type ModelPart,
  type ModelPreview,
  type ModelRequest,
  type ModelResponse,
  STL_UNITS,
} from './model'

const MAX_STL_FILE_BYTES = 200 * 1024 * 1024

// meshBody needs enough faces to form a volume. The kernel can repair open seams when it builds.
const canFormSolid = (bounds: Bounds, triangles: number) =>
  triangles >= 4 && bounds.max.every((max, axis) => max > bounds.min[axis]!)

async function previewModel({ file, stlUnit }: ModelRequest): Promise<ModelPreview> {
  if (!isModelFile(file.name)) throw new Error('Choose a Rhino .3dm file or an STL mesh.')
  const stl = isStlFile(file.name)
  const limit = stl ? MAX_STL_FILE_BYTES : MAX_RHINO_FILE_BYTES
  if (file.size > limit) throw new Error(`Choose a file under ${limit / (1024 * 1024)} MB.`)
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (stl) {
    const unit = STL_UNITS[stlUnit]
    const mesh = readStlModel(bytes, unit.scale)
    if (!canFormSolid(mesh.bounds, mesh.triangles))
      throw new Error('The STL needs enough faces and depth to form a solid mesh.')
    return {
      units: unit.label.toLowerCase(),
      parts: [
        {
          bounds: mesh.bounds,
          bytes: mesh.bytes,
          name: file.name.replace(/\.stl$/i, '') || 'Mesh',
          layer: null,
        },
      ],
      skipped: [],
    }
  }

  const rhino = await readRhino3dm(bytes)
  const parts: ModelPart[] = []
  const skipped = [...rhino.skipped]
  for (const part of rhino.objects) {
    const triangles = (part.bytes.byteLength - 84) / 50
    if (canFormSolid(part.bounds, triangles)) parts.push(part)
    else
      skipped.push({
        name: part.name,
        layer: part.layer,
        reason: 'The mesh needs enough faces and depth to form a solid.',
      })
  }
  return {
    units: rhino.units,
    parts,
    skipped,
  }
}

const port = globalThis as unknown as DedicatedWorkerGlobalScope
port.onmessage = async ({ data }: MessageEvent<ModelRequest>) => {
  try {
    const preview = await previewModel(data)
    const response: ModelResponse = { preview }
    port.postMessage(
      response,
      preview.parts.map((part) => part.bytes.buffer),
    )
  } catch (err) {
    const response: ModelResponse = { error: err instanceof Error ? err.message : String(err) }
    port.postMessage(response)
  }
}
