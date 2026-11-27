import { readEditableMesh } from '@pave/kernel/mesh-edit'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { assetUrl } from '../../../lib/assets'
import type { PreviewPart, PreviewReply } from './preview-model'

const port = globalThis as unknown as DedicatedWorkerGlobalScope

async function load(part: PreviewPart) {
  const reply = await fetch(assetUrl(part.assetId), { credentials: 'same-origin' })
  if (!reply.ok) throw new Error(`A retained body could not be read (${reply.status}).`)
  const { positions, indices } = readEditableMesh(
    new Uint8Array(await reply.arrayBuffer()),
    part.edits,
  )
  const placed = Float64Array.from(positions)
  if (part.transform) {
    const { position, rotation, scale } = part.transform
    const [x, y, z] = rotation.map((angle) => (angle * Math.PI) / 180) as [number, number, number]
    const matrix = new Matrix4().compose(
      new Vector3(...position),
      new Quaternion().setFromEuler(new Euler(x, y, z, 'XYZ')),
      new Vector3(scale, scale, scale),
    )
    const point = new Vector3()
    for (let at = 0; at < placed.length; at += 3)
      point.fromArray(placed, at).applyMatrix4(matrix).toArray(placed, at)
  }
  return { nodeId: part.nodeId, positions: placed, indices }
}

port.onmessage = ({ data }: MessageEvent<PreviewPart[]>) => {
  void Promise.all(data.map(load)).then(
    (meshes) =>
      port.postMessage(
        { meshes } satisfies PreviewReply,
        meshes.flatMap((mesh) => [mesh.positions.buffer, mesh.indices.buffer]) as ArrayBuffer[],
      ),
    (error: unknown) =>
      port.postMessage({
        error: error instanceof Error ? error.message : String(error),
      } satisfies PreviewReply),
  )
}
