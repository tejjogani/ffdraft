/**
 * The outliner's tree: each node nested under the first node it references (a stone under its
 * band, a setting under its stone, pavé under the body it covers). Containers — groups,
 * patterns, combines — stay at the top level, since their references are their contents.
 */
import type { Diagnostic, Evaluation } from '@pave/kernel'
import { type Design, type NodeKind, nodeRefs } from '@pave/schema'

type TreeItem =
  | { kind: 'feature'; id: string }
  | { kind: 'construction'; id: string; count: number }
  | { kind: 'stones'; id: string; count: number }
  | { kind: 'stone'; id: string; nodeId: string; number: number }

export type TreeRow = TreeItem & {
  key: string
  depth: number
  hasChildren: boolean
  expanded: boolean
  parent: string | null
  position: number
  siblings: number
}

const CONTAINERS: ReadonlySet<NodeKind> = new Set(['group', 'pattern', 'boolean'])
const constructionKey = 'construction'
const stonesRowKey = (id: string) => `stones:${id}`
export const featureRowKey = (id: string) => `feature:${id}`
export const stoneRowKey = (id: string) => `stone:${id}`

export function parentOf(design: Design, id: string): string | null {
  const node = design.nodes[id]
  if (!node || CONTAINERS.has(node.kind)) return null
  return nodeRefs(node).find((r) => r !== id && design.nodes[r]) ?? null
}

export function featureTree(design: Design, stones: readonly Evaluation['stones'][number][]) {
  const constructionIds = design.order.filter((id) => {
    const kind = design.nodes[id]?.kind
    return kind === 'curve' || kind === 'nurbsCurve'
  })
  const construction = new Set(constructionIds)
  const stonesByNode = new Map<string, string[]>()
  for (const { id, nodeId } of stones) {
    if (!design.nodes[nodeId]) continue
    const instances = stonesByNode.get(nodeId)
    if (instances) instances.push(id)
    else stonesByNode.set(nodeId, [id])
  }

  const children = new Map<string | null, TreeItem[]>()
  const parents = new Map<string, string | null>()
  for (const id of design.order) {
    const key = featureRowKey(id)
    const source = parentOf(design, id)
    // Bodies driven by a construction curve stay visible when the curve disclosure closes.
    const parent = construction.has(id)
      ? constructionKey
      : source && !construction.has(source)
        ? featureRowKey(source)
        : null
    parents.set(key, parent)
    const siblings = children.get(parent)
    const item: TreeItem = { kind: 'feature', id }
    if (siblings) siblings.push(item)
    else children.set(parent, [item])
  }
  const roots = children.get(null) ?? []
  if (constructionIds.length) {
    roots.push({ kind: 'construction', id: constructionKey, count: constructionIds.length })
    parents.set(constructionKey, null)
  }
  for (const [id, instances] of stonesByNode) {
    if (instances.length === 1 && design.nodes[id]?.kind === 'gem') continue
    const parent = featureRowKey(id)
    const disclosure: TreeItem = { kind: 'stones', id, count: instances.length }
    children.set(parent, [disclosure, ...(children.get(parent) ?? [])])
    parents.set(stonesRowKey(id), parent)
  }

  return {
    constructionIds,
    defaultsOpen: (key: string) => key.startsWith('feature:'),
    /** The display keys to expand when a feature or one of its instances is selected. */
    ancestors(nodeId: string, stoneId?: string): string[] | undefined {
      const key = featureRowKey(nodeId)
      if (!parents.has(key)) return
      const path: string[] = []
      if (stoneId) {
        const instances = stonesByNode.get(nodeId)
        const disclosure = stonesRowKey(nodeId)
        if (!parents.has(disclosure) || !instances?.includes(stoneId)) return
        path.push(disclosure, key)
      }
      for (let parent = parents.get(key); parent; parent = parents.get(parent)) path.push(parent)
      return path.reverse()
    },
    /** Ordinary features start open. The two disclosure row kinds start folded. */
    rows(flipped: ReadonlySet<string>): TreeRow[] {
      const rows: TreeRow[] = []
      const visit = (items: TreeItem[], depth: number, parent: string | null) => {
        items.forEach((item, index) => {
          const key = itemKey(item)
          const kids = children.get(key) ?? []
          const hasChildren = item.kind === 'stones' || kids.length > 0
          const expanded = hasChildren && flipped.has(key) !== (item.kind === 'feature')
          rows.push({
            ...item,
            key,
            depth,
            parent,
            hasChildren,
            expanded,
            position: index + 1,
            siblings: items.length,
          })
          if (!expanded) return
          if (item.kind === 'stones') {
            const instances = stonesByNode.get(item.id)!
            visit(
              instances.map((id, i) => ({ kind: 'stone', id, nodeId: item.id, number: i + 1 })),
              depth + 1,
              key,
            )
          } else visit(kids, depth + 1, key)
        })
      }
      visit(roots, 0, null)
      return rows
    },
  }
}

function itemKey(item: TreeItem): string {
  switch (item.kind) {
    case 'feature':
      return featureRowKey(item.id)
    case 'stone':
      return stoneRowKey(item.id)
    case 'stones':
      return stonesRowKey(item.id)
    case 'construction':
      return constructionKey
  }
}

/** The most severe diagnostic level per node. */
export function diagnosticLevels(
  diagnostics: readonly Diagnostic[],
): Map<string, Diagnostic['level']> {
  const rank = { info: 0, warning: 1, error: 2 }
  const out = new Map<string, Diagnostic['level']>()
  for (const d of diagnostics) {
    if (!d.nodeId) continue
    const prev = out.get(d.nodeId)
    if (!prev || rank[d.level] > rank[prev]) out.set(d.nodeId, d.level)
  }
  return out
}
