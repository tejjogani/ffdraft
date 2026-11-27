import type { InstancedMesh } from 'three'
import type { ViewerPick } from './visibility'

/** Keeps rendered instances and raycast indices in sync as the view reveals or hides stones. */
export class StoneBatch {
  private readonly originalMatrices: Float32Array
  private visibleTargets: readonly ViewerPick[]

  constructor(
    readonly mesh: InstancedMesh,
    private readonly allTargets: readonly ViewerPick[],
  ) {
    this.originalMatrices = (mesh.instanceMatrix.array as Float32Array).slice()
    this.visibleTargets = allTargets
  }

  get targets(): readonly ViewerPick[] {
    return this.visibleTargets
  }

  setVisibility(visible: (target: ViewerPick) => boolean): void {
    const matrices = this.mesh.instanceMatrix.array as Float32Array
    const targets: ViewerPick[] = []
    for (const [index, target] of this.allTargets.entries()) {
      if (!visible(target)) continue
      const offset = index * 16
      matrices.set(this.originalMatrices.subarray(offset, offset + 16), targets.length * 16)
      targets.push(target)
    }
    this.visibleTargets = targets
    // The original bounding sphere still contains every instance that can be displayed.
    this.mesh.count = targets.length
    this.mesh.visible = targets.length > 0
    this.mesh.instanceMatrix.needsUpdate = true
  }
}
