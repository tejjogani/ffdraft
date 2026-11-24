/**
 * What the whole-piece checks say about stones and nodes: names a designer recognises, and
 * which nodes already carry a finding that explains (and so silences) a later one.
 */
import { nodeRefs } from '@pave/schema'
import type { Scene } from '../core'
import type { StoneInstance } from '../types'

/**
 * A stone as the designer sees it: its feature's name, and its ordinal when the feature places
 * more than one (“Pavé”, stone 12). The instance id (`pave:11`) stays in `Diagnostic.related`.
 */
export function stoneName(scene: Scene, instance: StoneInstance): string {
  const node = scene.nodes.get(instance.nodeId)?.node
  const label = `“${node?.name ?? instance.nodeId}”`
  const many = scene.stones.some(
    (s) => s.instance.nodeId === instance.nodeId && s.instance !== instance,
  )
  const index = Number(instance.id.slice(instance.id.lastIndexOf(':') + 1))
  return many && Number.isFinite(index) ? `${label}, stone ${index + 1}` : label
}

/**
 * Nodes whose own build reported `code`, with the nodes they reference: a flush setting with
 * nothing to sink into (`setting.noHost`) explains why its gem is unheld; a pavé too large to
 * cut (`pave.tooLarge`) explains why its stones sit in uncut metal.
 */
export function explainedBy(scene: Scene, code: string): Set<string> {
  const ids = new Set<string>()
  for (const result of scene.nodes.values())
    if (result.diagnostics.some((d) => d.code === code)) {
      ids.add(result.id)
      for (const ref of nodeRefs(result.node)) ids.add(ref)
    }
  return ids
}
