/**
 * The one place the Design tab turns intentions into ops. Panels, menus, shortcuts and
 * importers call these and hand the result to the session; none of them builds an op inline.
 */
import {
  type Design,
  defaultNode,
  describeNode,
  type MissingField,
  type Node,
  type NodeInput,
  type NodeKind,
  nodeRefs,
  type Op,
  type RingSize,
  ringInnerDiameter,
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

/**
 * Removes nodes and everything that depends on them. An id that is not in the design (a stale
 * selection) is skipped, and so is a node that another listed node's removal already takes with
 * it: removing it a second time would refuse the whole change.
 */
export function remove(design: Design, ids: readonly string[]): Op[] {
  const present = [...new Set(ids)].filter((id) => Object.hasOwn(design.nodes, id))
  const taken = new Set(present.flatMap((id) => dependentsOf(design, id)))
  return present.filter((id) => !taken.has(id)).map((id) => ({ t: 'remove', id, cascade: true }))
}

type Fields = Record<string, unknown>
const METAL_KEYS = ['material', 'finish', 'plating'] as const
/** Clear metal kept on each side of a centre stone's head by a stone row (mm). */
const HEAD_CLEARANCE_MM = 0.75
/** A chain's link and wire as a share of the bail opening it hangs through. */
const LINK_PER_OPENING = 0.34
const WIRE_PER_LINK = 0.33

const round = (v: number, step: number) => Math.round(v / step) * step

/**
 * Defaults a new feature takes from what it joins, where the schema's own defaults cannot
 * know the piece: the metal of the piece (a platinum ring gets a platinum halo), a stone row
 * that leaves room for the centre stone's head, a chain thin enough for its bail.
 */
export function contextValues(design: Design, kind: NodeKind, target?: string): Fields {
  const keys = new Set(describeNode(kind).fields.map((f) => f.key))
  const nodes = design.order.map((id) => design.nodes[id] as unknown as Fields & { id: string })
  const at = target ? (design.nodes[target] as unknown as Fields | undefined) : undefined
  const out: Fields = {}
  if (keys.has('material')) {
    const source = at && 'material' in at ? at : nodes.find((n) => 'material' in n)
    if (source) for (const k of METAL_KEYS) if (keys.has(k) && k in source) out[k] = source[k]
  }
  if (kind === 'gemRow' && at && 'size' in at) {
    // The widest gem set on the band's top: leave its half-width plus clearance free on each
    // side, as an angle around the finger.
    const radius = ringInnerDiameter(at.size as RingSize) / 2 + Number(at.thicknessTop ?? 1.7)
    const half = nodes
      .filter((n) => n.kind === 'gem' && (n.placement as Fields | undefined)?.shank === target)
      .reduce((w, g) => Math.max(w, (Number(g.width) * Math.max(1, Number(g.lw ?? 1))) / 2), 0)
    if (half > 0)
      out.skipCenter = Math.min(
        180,
        Math.ceil((2 * Math.atan2(half + HEAD_CLEARANCE_MM, radius) * 180) / Math.PI),
      )
  }
  if (kind === 'chain' && at?.kind === 'bail') {
    const link = round(Number(at.opening) * LINK_PER_OPENING, 0.1)
    out.linkWidth = Math.max(0.8, link)
    out.wire = Math.max(0.3, round(link * WIRE_PER_LINK, 0.02))
  }
  return out
}

/** A new node of `kind` attached to `target` when it fits, or what it still needs. */
export function addNode(
  design: Design,
  kind: NodeKind,
  opts: { target?: string; values?: Fields } = {},
): { ops: Op[]; id: string | null; missing: MissingField[] } {
  const values = { ...contextValues(design, kind, opts.target), ...opts.values }
  const { node, missing } = defaultNode(kind, design, { ...opts, values })
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
