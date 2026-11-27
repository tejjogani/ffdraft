import { readEditableMesh } from '@pave/kernel/mesh-edit'
import { Box3, BufferAttribute, BufferGeometry, Vector3 } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { MeshReply, MeshRequest } from './model'

const port = globalThis as unknown as DedicatedWorkerGlobalScope
port.onmessage = ({ data }: MessageEvent<MeshRequest>) => {
  try {
    const { positions, indices } = readEditableMesh(new Uint8Array(data.bytes), data.edits)
    const bounds = new Box3().setFromBufferAttribute(new BufferAttribute(positions, 3))
    const origin = bounds.getCenter(new Vector3()).toArray()
    const size = bounds.getSize(new Vector3()).toArray()
    const scale = Math.max(...size)
    if (!(scale > 0) || !Number.isFinite(scale)) throw new Error('The mesh has no visible extent.')
    const displayPositions = new Float32Array(positions.length)
    for (let i = 0; i < positions.length; i++)
      displayPositions[i] = (positions[i]! - origin[i % 3]!) / scale
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(displayPositions, 3))
    geometry.setIndex(new BufferAttribute(indices, 1))
    // Keep the imported triangle and vertex IDs stable instead of sorting source indices.
    const tree = MeshBVH.serialize(new MeshBVH(geometry, { indirect: true }), {
      cloneBuffers: false,
    })
    const message: MeshReply = { mesh: { positions, displayPositions, origin, scale, size, tree } }
    port.postMessage(message, [
      positions.buffer,
      displayPositions.buffer,
      indices.buffer,
      ...tree.roots,
      ...(tree.indirectBuffer ? [tree.indirectBuffer.buffer] : []),
    ])
  } catch (error) {
    port.postMessage({
      error: error instanceof Error ? error.message : String(error),
    } satisfies MeshReply)
  }
}
