export interface ViewerPick {
  nodeId: string
  stoneId?: string
  partId?: string
}

export interface ViewTarget extends ViewerPick {
  /** The evaluated part that owns an independently selectable shell. */
  parentPartId?: string
}

export interface ViewVisibilityState {
  /** Entire features to hide, including their stones. */
  hidden: readonly string[]
  hiddenStones?: readonly string[]
  hiddenParts?: readonly string[]
  /** Targets to show exclusively. An empty list shows all targets outside the hidden lists. */
  isolated?: readonly ViewerPick[]
}

export function createViewVisibility(state: ViewVisibilityState): (target: ViewTarget) => boolean {
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
  return ({ nodeId, stoneId, partId, parentPartId }) => {
    if (hiddenNodes.has(nodeId)) return false
    if (stoneId !== undefined && hiddenStones.has(stoneId)) return false
    if (partId !== undefined && hiddenParts.has(partId)) return false
    if (parentPartId !== undefined && hiddenParts.has(parentPartId)) return false
    return (
      !isIsolated ||
      isolatedNodes.has(nodeId) ||
      (stoneId !== undefined && isolatedStones.get(stoneId) === nodeId) ||
      (partId !== undefined && isolatedParts.get(partId) === nodeId) ||
      (parentPartId !== undefined && isolatedParts.get(parentPartId) === nodeId)
    )
  }
}

export function isViewTargetVisible(state: ViewVisibilityState, target: ViewTarget): boolean {
  return createViewVisibility(state)(target)
}

/** A picked shell's parent evaluated part and zero-based ordinal in that part. */
export function metalShellOf(
  id: string | null | undefined,
): { partId: string; index: number } | null {
  if (!id) return null
  const match = /^(.*)#shell:(\d+)$/.exec(id)
  const index = Number(match?.[2])
  return match?.[1] && Number.isSafeInteger(index) ? { partId: match[1], index } : null
}
