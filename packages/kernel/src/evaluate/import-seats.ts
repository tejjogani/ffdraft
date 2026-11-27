import type { Design } from '@pave/schema'
import type { Body, Cut, NodeResult } from '../core'

export function settingsByGem(results: Iterable<NodeResult>): Map<string, string[]> {
  const settings = new Map<string, string[]>()
  for (const { status, node, bodies } of results)
    if (status === 'ok' && node.visible && node.kind === 'setting' && bodies.length)
      settings.set(node.gem, [...(settings.get(node.gem) ?? []), node.id])
  return settings
}

export function isCopiedSeat(owner: NodeResult): boolean {
  return owner.node.kind === 'group' || owner.node.kind === 'pattern'
}

/** Copies may carry more metal than the original setting or host. Check each body's origin. */
export function importSeatMatches(
  owner: NodeResult,
  hostId: string,
  body: Body,
  targets: readonly string[],
): boolean {
  if (isCopiedSeat(owner)) return owner.id === hostId && !!body.from && targets.includes(body.from)
  return targets.includes(hostId) || (!!body.from && targets.includes(body.from))
}

export function cutTargets(
  cut: Cut,
  design: Design,
  settings: ReadonlyMap<string, readonly string[]>,
): Cut['targets'] {
  if (!cut.importSeatGem) return cut.targets
  const gem = design.nodes[cut.importSeatGem]
  if (gem?.kind !== 'gem') return []
  const head = settings.get(gem.id) ?? []
  if (gem.placement.type === 'surface') return [...head, gem.placement.host]
  if (gem.placement.type === 'ringTop') return [...head, gem.placement.shank]
  return head
}
