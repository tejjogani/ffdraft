import type { Node, NodeOf } from '@pave/schema'
import type { SerializedBVH } from 'three-mesh-bvh'

export type XYZ = [number, number, number]
export type VertexPositions = Record<string, XYZ>
export type MeshComponent =
  | { kind: 'Vertex'; ids: [number] }
  | { kind: 'Edge'; ids: [number, number] }
  | { kind: 'Face'; ids: [number, number, number]; face: number }
export type ComponentKind = MeshComponent['kind']

export type ImportedMesh = NodeOf<'meshBody'> & {
  source: Extract<NodeOf<'meshBody'>['source'], { type: 'asset' }>
}

export function isImportedMesh(node: Node | undefined): node is ImportedMesh {
  return (
    node?.kind === 'meshBody' && node.source.type === 'asset' && node.keepSourcePlacement === true
  )
}

export interface MeshRequest {
  bytes: ArrayBuffer
  edits?: VertexPositions
}

export interface ViewportMesh {
  positions: Float32Array
  /** Centered and scaled for picking and drawing in Float32 without changing source coordinates. */
  displayPositions: Float32Array<ArrayBuffer>
  origin: XYZ
  scale: number
  size: XYZ
  tree: SerializedBVH
}
export type MeshReply = { mesh: ViewportMesh } | { error: string }

export function vertexAt(positions: ViewportMesh['positions'], id: number): XYZ {
  const at = 3 * id
  return [positions[at]!, positions[at + 1]!, positions[at + 2]!]
}
