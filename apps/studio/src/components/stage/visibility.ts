export interface ViewerPick {
  nodeId: string
  stoneId?: string
  partId?: string
}

export interface ViewVisibilityState {
  /** Entire features to hide, including their stones. */
  hidden: readonly string[]
  hiddenStones?: readonly string[]
  hiddenParts?: readonly string[]
  /** Targets to show exclusively. An empty list shows all targets outside the hidden lists. */
  isolated?: readonly ViewerPick[]
}

export function createViewVisibility(state: ViewVisibilityState): (target: ViewerPick) => boolean {
  const hiddenNodes = new Set(state.hidden)
  const hiddenStones = new Set(state.hiddenStones)
  const hiddenParts = new Set(state.hiddenParts)
  const isolatedNodes = new Set<string>()
  const isolatedStones = new Map<string, string>()
  const isolatedParts = new Map<string, string>()
  for (const { nodeId, stoneId, partId } of state.isolated ?? []) {
    if (stoneId !== undefined) isolatedStones.set(stoneId, nodeId)
    else if (partId !== undefined) isolatedParts.set(partId, nodeId)
    else isolatedNodes.add(nodeId)
  }
  const isIsolated = !!state.isolated?.length
  return ({ nodeId, stoneId, partId }) => {
    if (hiddenNodes.has(nodeId)) return false
    if (stoneId !== undefined && hiddenStones.has(stoneId)) return false
    if (partId !== undefined && hiddenParts.has(partId)) return false
    return (
      !isIsolated ||
      isolatedNodes.has(nodeId) ||
      (stoneId !== undefined && isolatedStones.get(stoneId) === nodeId) ||
      (partId !== undefined && isolatedParts.get(partId) === nodeId)
    )
  }
}

export function isViewTargetVisible(state: ViewVisibilityState, target: ViewerPick): boolean {
  return createViewVisibility(state)(target)
}
