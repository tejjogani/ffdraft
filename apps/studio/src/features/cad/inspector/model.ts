/**
 * What the inspector shows for a node, derived entirely from the schema (`describeNode`,
 * `visibleFields`): sections from each field's `group`, nested rows for the active variant of a
 * choice (a stone's placement) and for grouped objects (the transform). No node kind has code
 * of its own here or in the components that render this model.
 */

import { describeNode, type FieldInfo, type Node, type NodeKind, visibleFields } from '@pave/schema'
import { isProfileNode } from '../profiles/profile'

export interface InspectorRow {
  field: FieldInfo
  /** Path from the node to the value, e.g. `['placement', 'angle']`. */
  path: string[]
  value: unknown
  /** The active variant's fields, or a grouped object's fields. */
  children: InspectorRow[]
}

export interface InspectorSection {
  /** Stable key (the group name, or `general`). */
  id: string
  /** Null for the first, untitled section. */
  title: string | null
  rows: InspectorRow[]
}

export interface InspectorModel {
  kind: NodeKind
  title: string
  description?: string
  sections: InspectorSection[]
  /** How many fields "Fine-tune" would reveal (0 hides the toggle). */
  advanced: number
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function rowsFor(
  fields: readonly FieldInfo[],
  value: Record<string, unknown>,
  path: readonly string[],
  advanced: boolean,
): InspectorRow[] {
  return visibleFields(fields, value, { advanced }).map((field) => {
    const v = value[field.key] ?? field.default
    const at = [...path, field.key]
    let children: InspectorRow[] = []
    if (field.variants && isObject(v)) {
      const active = field.variants.find((x) => x.value === v.type)
      if (active) children = rowsFor(active.fields, v, at, advanced)
    } else if (field.fields) children = rowsFor(field.fields, isObject(v) ? v : {}, at, advanced)
    return { field, path: at, value: v, children }
  })
}

const countRows = (rows: readonly InspectorRow[]): number =>
  rows.reduce((n, r) => n + 1 + countRows(r.children), 0)

export function inspectorModel(node: Node, opts: { advanced?: boolean } = {}): InspectorModel {
  const d = describeNode(node.kind)
  const value = node as unknown as Record<string, unknown>
  const fields = isProfileNode(node)
    ? d.fields.filter(
        (f) => !['source', 'height', 'bevel', 'bevelSize', 'border', 'join'].includes(f.key),
      )
    : d.fields
  const rows = rowsFor(fields, value, [], !!opts.advanced)
  const sections: InspectorSection[] = []
  const section = (group: string | undefined) => {
    const id = group ?? 'general'
    let s = sections.find((x) => x.id === id)
    if (!s) {
      s = { id, title: group ?? null, rows: [] }
      // The untitled section leads; named groups follow in declaration order.
      if (group) sections.push(s)
      else sections.unshift(s)
    }
    return s
  }
  for (const row of rows) section(row.field.meta.group).rows.push(row)
  const advanced = opts.advanced
    ? countRows(rows) - countRows(rowsFor(fields, value, [], false))
    : countRows(rowsFor(fields, value, [], true)) - countRows(rows)
  // Fine-tuning adds to the form without pushing the essentials down: sections made only of
  // advanced fields (the transform) follow the ones a feature is usually set up with.
  const onlyAdvanced = (s: InspectorSection) => s.rows.every((r) => r.field.meta.advanced)
  const filled = sections.filter((s) => s.rows.length > 0)
  return {
    kind: node.kind,
    title: d.title,
    ...(d.description ? { description: d.description } : {}),
    sections: [...filled.filter((s) => !onlyAdvanced(s)), ...filled.filter(onlyAdvanced)],
    advanced,
  }
}
