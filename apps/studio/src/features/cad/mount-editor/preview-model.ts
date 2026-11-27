import type { MountCage, NodeOf } from '@pave/schema'
import type { XYZ } from '../mesh-edit/model'
import type { CageBounds } from './handles'

export interface PreviewMesh {
  nodeId: string
  positions: Float64Array
  indices: Uint32Array
}

export interface PreviewPart {
  nodeId: string
  assetId: string
  transform?: NodeOf<'meshBody'>['transform']
  edits?: NonNullable<NodeOf<'meshBody'>['meshEdits']>['vertices']
}

export type PreviewReply = { meshes: PreviewMesh[] } | { error: string }
export type PreviewCages = ReadonlyMap<string, MountCage | null | undefined>
export type PreviewGirdle = {
  frame: NonNullable<NodeOf<'gem'>['transform']>
  width: number
  length: number
}
export type PreviewBox = CageBounds & { min: XYZ; max: XYZ }
