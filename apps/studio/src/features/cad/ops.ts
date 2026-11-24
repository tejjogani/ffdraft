/**
 * The one place the Design tab turns intentions into ops. Panels, menus, shortcuts and
 * importers call these and hand the result to the session; none of them builds an op inline.
 */
import {
  type Design,
  defaultNode,
  type MissingField,
  type Node,
  type NodeInput,
  type NodeKind,
  nodeRefs,
  type Op,
  variantPatch,
} from '@pave/schema'

/** `{ a: { b: value } }` for path `['a', 'b']`. */
function nest(path: readonly string[], value: unknown): Record<string, unknown> {
  return path.reduceRight<unknown>((v, k) => ({ [k]: v }), value) as Record<string, unknown>
}

/** Writes one field (a nested path such as `placement.angle`). */
export const setField = (id: string, path: readonly string[], value: unknown): Op => ({
  t: 'update',
  id,
  patch: nest(path, value),
})

/** Switches a choice of variants (a stone's placement, a body's source), or says what is missing. */
export function switchVariant(
  design: Design,
  node: Node,
  path: readonly string[],
  next: string,
): { ops: Op[]; missing: MissingField[] } {
  // Nested variants do not occur in the schema today; the top-level key is the variant field.
  const { patch, missing } = variantPatch(node, path[0]!, next, { design })
  return { ops: patch ? [{ t: 'update', id: node.id, patch }] : [], missing }
}

export const rename = (id: string, name: string): Op =>
  setField(id, ['name'], name.trim() ? name.trim().slice(0, 80) : null)

/** "Exclude from piece": the node stops contributing geometry, weight and exports. */
export const setIncluded = (id: string, included: boolean): Op =>
  setField(id, ['visible'], included)

export const move = (id: string, index: number): Op => ({ t: 'move', id, index })

/** Nodes that reference `id`, directly or through others, in outliner order. */
export function dependentsOf(design: Design, id: string): string[] {
  const out = new Set<string>()
  for (let grew = true; grew; ) {
    grew = false
    for (const n of Object.values(design.nodes))
      if (!out.has(n.id) && nodeRefs(n).some((r) => r === id || out.has(r))) {
        out.add(n.id)
        grew = true
      }
  }
  return design.order.filter((x) => out.has(x))
}

/** Removes nodes and everything that depends on them. */
export const remove = (ids: readonly string[]): Op[] =>
  ids.map((id) => ({ t: 'remove', id, cascade: true }))

/** A new node of `kind` attached to `target` when it fits, or what it still needs. */
export function addNode(
  design: Design,
  kind: NodeKind,
  opts: { target?: string; values?: Record<string, unknown> } = {},
): { ops: Op[]; id: string | null; missing: MissingField[] } {
  const { node, missing } = defaultNode(kind, design, opts)
  if (!node) return { ops: [], id: null, missing }
  return { ops: [{ t: 'add', node }], id: node.id, missing }
}

/** Adds a ready-made node (an import). Changes the piece type when the design was empty. */
export function addPrepared(design: Design, node: NodeInput, kind?: Design['kind']): Op[] {
  const ops: Op[] = []
  if (kind && design.order.length === 0 && design.kind !== kind) ops.push({ t: 'setKind', kind })
  ops.push({ t: 'add', node })
  return ops
}

export const setPieceKind = (kind: Design['kind']): Op => ({ t: 'setKind', kind })
