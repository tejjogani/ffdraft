/**
 * The outliner's tree: each node nested under the first node it references (a stone under its
 * band, a setting under its stone, pavé under the body it covers). Containers — groups,
 * patterns, combines — stay at the top level, since their references are their contents.
 */
import type { Diagnostic } from '@pave/kernel'
import { type Design, type NodeKind, nodeRefs } from '@pave/schema'

export interface TreeRow {
  id: string
  depth: number
  hasChildren: boolean
  expanded: boolean
  parent: string | null
}

const CONTAINERS: ReadonlySet<NodeKind> = new Set(['group', 'pattern', 'boolean'])

export function parentOf(design: Design, id: string): string | null {
  const node = design.nodes[id]
  if (!node || CONTAINERS.has(node.kind)) return null
  return nodeRefs(node).find((r) => r !== id && design.nodes[r]) ?? null
}

/** Visible rows in display order, honouring collapsed nodes. */
export function treeRows(design: Design, collapsed: ReadonlySet<string>): TreeRow[] {
  const children = new Map<string | null, string[]>()
  for (const id of design.order) {
    const p = parentOf(design, id)
    children.set(p, [...(children.get(p) ?? []), id])
  }
  const rows: TreeRow[] = []
  const visit = (id: string, depth: number, parent: string | null) => {
    const kids = children.get(id) ?? []
    const expanded = kids.length > 0 && !collapsed.has(id)
    rows.push({ id, depth, hasChildren: kids.length > 0, expanded, parent })
    if (expanded) for (const k of kids) visit(k, depth + 1, id)
  }
  for (const id of children.get(null) ?? []) visit(id, 0, null)
  return rows
}

/** The most severe diagnostic level per node. */
export function diagnosticLevels(diagnostics: readonly Diagnostic[]): Map<string, Diagnostic['level']> {
  const rank = { info: 0, warning: 1, error: 2 }
  const out = new Map<string, Diagnostic['level']>()
  for (const d of diagnostics) {
    if (!d.nodeId) continue
    const prev = out.get(d.nodeId)
    if (!prev || rank[d.level] > rank[prev]) out.set(d.nodeId, d.level)
  }
  return out
}
