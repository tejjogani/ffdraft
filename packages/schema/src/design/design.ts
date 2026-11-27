/**
 * The design document and the only way it changes: ops.
 *
 * Every edit — a slider drag, an undo, an agent tool call — is a list of ops applied by
 * `applyOps`, which also returns the exact inverse. Recording `{ ops, inverse, actor }` gives
 * undo/redo, a replayable history and a per-edit trace of who (person or agent run) did what.
 */
import { z } from 'zod'
import { revolveProfileError } from './curve'
import { DESIGN_VERSION, migrateDesign, prongLayout } from './mount'
import { isBodyKind, type Node, type NodeInput, NodeSchema, nodeRefs } from './nodes'

export const PIECE_KINDS = [
  'ring',
  'pendant',
  'earrings',
  'bracelet',
  'necklace',
  'chain',
  'brooch',
  'other',
] as const
export type PieceKind = (typeof PIECE_KINDS)[number]

export const DesignSchema = z.object({
  /**
   * 2: follow fields (absent = follow the stone, see design/mount.ts). A version 1 document is
   * migrated on the way in (`migrateDesign`), keeping what its stored values meant.
   */
  schemaVersion: z.union([z.literal(1), z.literal(2)]).default(2),
  kind: z.enum(PIECE_KINDS).default('ring'),
  nodes: z.record(z.string(), NodeSchema).default({}),
  /** Outliner order. Every node id appears exactly once. */
  order: z.array(z.string()).default([]),
})
export type Design = z.infer<typeof DesignSchema>

export const emptyDesign = (kind: PieceKind = 'ring'): Design => ({
  schemaVersion: DESIGN_VERSION,
  kind,
  nodes: {},
  order: [],
})

// ── Ops ──────────────────────────────────────────────────────────────────────────────────────

const Patch = z.record(z.string(), z.unknown())

export const OpSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('add'),
    node: z.record(z.string(), z.unknown()),
    index: z.number().int().nonnegative().optional(),
  }),
  z.object({ t: z.literal('update'), id: z.string(), patch: Patch }),
  z.object({ t: z.literal('remove'), id: z.string(), cascade: z.boolean().optional() }),
  z.object({ t: z.literal('move'), id: z.string(), index: z.number().int().nonnegative() }),
  z.object({ t: z.literal('setKind'), kind: z.enum(PIECE_KINDS) }),
])

export type Op =
  | { t: 'add'; node: NodeInput; index?: number }
  /** JSON merge patch (RFC 7396): objects merge, arrays and scalars replace, null deletes. */
  | { t: 'update'; id: string; patch: Record<string, unknown> }
  | { t: 'remove'; id: string; cascade?: boolean }
  | { t: 'move'; id: string; index: number }
  | { t: 'setKind'; kind: PieceKind }

/** Largest undoable edit accepted by the design API. */
export const MAX_DESIGN_CHANGE_OPS = 500

export const ActorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user'), id: z.string() }),
  z.object({
    type: z.literal('agent'),
    runId: z.string(),
    toolCallId: z.string().optional(),
    model: z.string().optional(),
  }),
  z.object({ type: z.literal('system') }),
])
export type Actor = z.infer<typeof ActorSchema>

/** One atomic, attributed, invertible edit. The unit of history and of trace capture. */
export const ChangeSchema = z.object({
  id: z.string(),
  ops: z.array(OpSchema),
  inverse: z.array(OpSchema),
  actor: ActorSchema,
  label: z.string().max(200),
  at: z.string(),
})
export type Change = Omit<z.infer<typeof ChangeSchema>, 'ops' | 'inverse'> & {
  ops: Op[]
  inverse: Op[]
}

export class OpError extends Error {
  constructor(
    message: string,
    readonly op: Op,
  ) {
    super(message)
    this.name = 'OpError'
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Applies a JSON merge patch (RFC 7396): objects merge, arrays and scalars replace, null deletes. */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isObject(patch)) return patch
  const out: Record<string, unknown> = isObject(target) ? { ...target } : {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k]
    else out[k] = mergePatch(out[k], v)
  }
  return out
}

/** JSON object key order can change in storage. Array order is part of the value. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a))
    return Array.isArray(b) && a.length === b.length && a.every((value, i) => sameJson(value, b[i]))
  if (!isObject(a) || !isObject(b)) return false
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
  )
}

/**
 * The merge patch that turns `from` into `to`. Undo is computed from the stored node before and
 * after the update, not from the patch: parsing can drop or fill fields the patch never named
 * (switching a variant drops the old variant's fields), and only the stored values restore them.
 */
export function diffPatch(
  from: Record<string, unknown>,
  to: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(from)) if (!Object.hasOwn(to, k)) out[k] = null
  for (const [k, v] of Object.entries(to)) {
    const before = from[k]
    if (sameJson(before, v)) continue
    if (isObject(before) && isObject(v)) {
      const inner = diffPatch(before, v)
      if (Object.keys(inner).length > 0) out[k] = inner
    } else out[k] = v
  }
  return out
}

/** An op as OpSchema reads it: callers that skip the wire schema (studio, scripts) get the same checks. */
function parseOp(raw: unknown): Op {
  const r = OpSchema.safeParse(raw)
  if (!r.success) throw new OpError(`Invalid op: ${z.prettifyError(r.error)}`, raw as Op)
  return r.data as Op
}

function parseNode(raw: unknown, op: Op): Node {
  const r = NodeSchema.safeParse(raw)
  if (!r.success) throw new OpError(z.prettifyError(r.error), op)
  return r.data
}

function dependents(design: Design, id: string): string[] {
  return design.order.filter((other) => {
    const n = design.nodes[other]
    return n !== undefined && nodeRefs(n).includes(id)
  })
}

/**
 * Applies ops in order and returns the new design plus the ops that undo them.
 * Pure: the input is not mutated. Throws {@link OpError}; nothing is applied on failure.
 */
export function applyOps(input: Design, ops: readonly Op[]): { design: Design; inverse: Op[] } {
  // An old document is read with the meaning its values had before it is edited, so an edit
  // never changes what the untouched parts of a version 1 piece look like.
  const design = migrateDesign(input)
  // Own-property lookups only: ids such as "constructor" or "__proto__" are ordinary ids.
  const nodes: Record<string, Node> = Object.assign(Object.create(null), design.nodes)
  const has = (id: string) => Object.hasOwn(nodes, id)
  let order = [...design.order]
  let kind = design.kind
  const inverse: Op[] = []
  const newNodes = new Set<string>()
  const prongsSet = new Map<string, Set<string>>()

  const removeOne = (id: string) => {
    const node = nodes[id]!
    inverse.unshift({ t: 'add', node, index: order.indexOf(id) })
    delete nodes[id]
    order = order.filter((x) => x !== id)
  }

  for (const raw of ops) {
    const op = parseOp(raw)
    switch (op.t) {
      case 'add': {
        const node = parseNode(op.node, op)
        if (node.id === '') throw new OpError('A node id cannot be empty', op)
        // A JSON object cannot keep this key through a save and load (the record parser drops
        // it), so the node would vanish from a saved design while the outliner still lists it.
        if (node.id === '__proto__') throw new OpError('"__proto__" cannot be a node id', op)
        if (has(node.id)) throw new OpError(`Node "${node.id}" already exists`, op)
        nodes[node.id] = node
        newNodes.add(node.id)
        order.splice(Math.min(op.index ?? order.length, order.length), 0, node.id)
        inverse.unshift({ t: 'remove', id: node.id })
        break
      }
      case 'update': {
        const prev = has(op.id) ? nodes[op.id] : undefined
        if (!prev) throw new OpError(`No node "${op.id}"`, op)
        if ('id' in op.patch || 'kind' in op.patch)
          throw new OpError('id and kind cannot be changed; add a new node instead', op)
        const updated = parseNode(mergePatch(prev, op.patch), op)
        if (updated.kind === 'setting' && isObject(op.patch.prongTipOffsetsMm)) {
          const set = prongsSet.get(op.id) ?? new Set()
          for (const number of Object.keys(op.patch.prongTipOffsetsMm)) set.add(number)
          prongsSet.set(op.id, set)
        }
        nodes[op.id] = updated
        inverse.unshift({ t: 'update', id: op.id, patch: diffPatch(updated, prev) })
        break
      }
      case 'remove': {
        if (!has(op.id)) throw new OpError(`No node "${op.id}"`, op)
        const visit = (id: string) => {
          const deps = dependents({ ...design, nodes, order }, id)
          if (deps.length && !op.cascade)
            throw new OpError(
              `"${id}" is used by ${deps.map((d) => `"${d}"`).join(', ')}; remove those first or pass cascade`,
              op,
            )
          for (const d of deps) if (has(d)) visit(d)
          removeOne(id)
        }
        visit(op.id)
        break
      }
      case 'move': {
        const from = order.indexOf(op.id)
        if (from < 0) throw new OpError(`No node "${op.id}"`, op)
        order.splice(from, 1)
        order.splice(Math.min(op.index, order.length), 0, op.id)
        inverse.unshift({ t: 'move', id: op.id, index: from })
        break
      }
      case 'setKind': {
        inverse.unshift({ t: 'setKind', kind })
        kind = op.kind
        break
      }
    }
  }

  // Prong numbers identify positions in one layout. A change that also specifies new offsets
  // applies those numbers to its final layout. Undo restores the fields from the old layout.
  for (const id of order) {
    const old = design.nodes[id]
    const head = nodes[id]
    if (
      newNodes.has(id) ||
      old?.kind !== 'setting' ||
      !old.prongTipOffsetsMm ||
      head?.kind !== 'setting' ||
      !head.prongTipOffsetsMm ||
      sameJson(prongLayout(old, design.nodes[old.gem]), prongLayout(head, nodes[head.gem]))
    )
      continue
    const kept = Object.entries(head.prongTipOffsetsMm).filter(([n]) => prongsSet.get(id)?.has(n))
    if (kept.length === Object.keys(head.prongTipOffsetsMm).length) continue
    const { prongTipOffsetsMm: _removed, ...rest } = head
    nodes[id] = kept.length ? { ...rest, prongTipOffsetsMm: Object.fromEntries(kept) } : rest
    const update = inverse.findLast(
      (op): op is Extract<Op, { t: 'update' }> => op.t === 'update' && op.id === id,
    )
    if (update) {
      const patch = update.patch.prongTipOffsetsMm
      update.patch.prongTipOffsetsMm = {
        ...(isObject(patch) ? patch : {}),
        ...old.prongTipOffsetsMm,
      }
    } else inverse.push({ t: 'update', id, patch: { prongTipOffsetsMm: old.prongTipOffsetsMm } })
  }

  // Nodes are kept in outliner order, so undoing a remove gives back the same document, key
  // order included (revision ids and manifests hash its JSON).
  const listed = new Set(order)
  const next: Design = {
    schemaVersion: DESIGN_VERSION,
    kind,
    nodes: Object.fromEntries([
      ...order.filter(has).map((id) => [id, nodes[id]!] as const),
      ...Object.keys(nodes)
        .filter((id) => !listed.has(id))
        .map((id) => [id, nodes[id]!] as const),
    ]),
    order,
  }
  const issues = validateDesign(next).filter((i) => i.level === 'error')
  if (issues.length) throw new OpError(issues.map((i) => i.message).join('; '), ops[0]!)
  return { design: next, inverse }
}

// ── Documents from outside ───────────────────────────────────────────────────────────────────

/**
 * Steps for documents older than any {@link DesignSchema} parses, keyed by the version each
 * starts from. Version 0 is a document written before `schemaVersion` existed; its nodes already
 * had version 1's shape. From version 1 on the document parses, and `migrateDesign`
 * (design/mount.ts) brings it to {@link DESIGN_VERSION} with the meaning its values had. Fields
 * a node gained since are not a version: parsing fills in their defaults.
 */
const RAW_MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {
  0: (doc) => ({ ...doc, schemaVersion: 1 }),
}
const FIRST_PARSED_VERSION = 1

/** A design document this build cannot read: not a design, or made by a newer Pavé. */
export class DesignVersionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DesignVersionError'
  }
}

/**
 * Reads a design document that comes from outside the database (a .pave file): brings it from
 * any earlier version up to {@link DESIGN_VERSION} and validates it. A document from a newer
 * version is refused rather than guessed at, since its meaning may have changed.
 */
export function parseDesignDocument(raw: unknown): Design {
  if (!isObject(raw)) throw new DesignVersionError('The design document is not an object')
  let doc = raw
  let version = doc.schemaVersion === undefined ? 0 : doc.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0)
    throw new DesignVersionError(`The design document has an unreadable version (${version})`)
  if (version > DESIGN_VERSION)
    throw new DesignVersionError(
      `This design was made by a newer version of Pavé (design version ${version}; this one reads up to ${DESIGN_VERSION}). Update Pavé to open it.`,
    )
  for (; version < FIRST_PARSED_VERSION; version++) doc = RAW_MIGRATIONS[version]!(doc)
  const parsed = DesignSchema.safeParse(doc)
  if (!parsed.success)
    throw new DesignVersionError(
      `The design document is not valid: ${z.prettifyError(parsed.error)}`,
    )
  // Checked before the version step: it resolves follow rules, which needs a sound document.
  const errors = validateDesign(parsed.data).filter((i) => i.level === 'error')
  // applyOps keeps these by construction; a document from outside must show it keeps them too.
  const { nodes, order } = parsed.data
  if (new Set(order).size !== order.length || order.length !== Object.keys(nodes).length)
    errors.push({ level: 'error', message: 'The outliner order must list every node exactly once' })
  for (const [key, node] of Object.entries(nodes))
    if (node.id !== key)
      errors.push({ level: 'error', message: `Node "${key}" is stored under another id` })
  if (errors.length)
    throw new DesignVersionError(
      `The design document is not valid: ${errors.map((e) => e.message).join('; ')}`,
    )
  return migrateDesign(parsed.data)
}

// ── Integrity ────────────────────────────────────────────────────────────────────────────────

export interface DesignIssue {
  level: 'error' | 'warning'
  nodeId?: string
  message: string
}

/** Referential integrity and cycle checks. Geometry-level checks belong to the kernel. */
export function validateDesign(design: Design): DesignIssue[] {
  const issues: DesignIssue[] = []
  // Own properties only: an id such as "constructor" must not find Object.prototype's.
  const nodeOf = (id: string) => (Object.hasOwn(design.nodes, id) ? design.nodes[id] : undefined)
  const seen = new Set<string>()
  for (const id of design.order) {
    if (seen.has(id)) {
      issues.push({ level: 'error', nodeId: id, message: `Order lists "${id}" more than once` })
      continue
    }
    seen.add(id)
    const n = nodeOf(id)
    if (!n) {
      issues.push({ level: 'error', nodeId: id, message: `Order lists missing node "${id}"` })
      continue
    }
    for (const r of nodeRefs(n)) {
      const target = nodeOf(r)
      if (!target)
        issues.push({
          level: 'error',
          nodeId: id,
          message: `"${id}" references missing node "${r}"`,
        })
      else if (
        (n.kind === 'pave' || n.kind === 'engraving' || n.kind === 'boolean') &&
        !isBodyKind(target.kind)
      )
        issues.push({
          level: 'error',
          nodeId: id,
          message: `"${id}" needs a solid body but "${r}" is a ${target.kind}`,
        })
      else if ((n.kind === 'pipe' || n.kind === 'revolve') && target.kind !== 'curve')
        issues.push({
          level: 'error',
          nodeId: id,
          message: `"${id}" needs a construction curve but "${r}" is a ${target.kind}.`,
        })
      else if (n.kind === 'revolve' && target.kind === 'curve') {
        const message = revolveProfileError(target, n.axis, n.axisOffset)
        if (message) issues.push({ level: 'error', nodeId: id, message })
      }
    }
    if (n.kind === 'setting' && n.prongTipOffsetsMm && Object.keys(n.prongTipOffsetsMm).length) {
      const layout = prongLayout(n, nodeOf(n.gem))
      const invalid = Object.keys(n.prongTipOffsetsMm).find(
        (key) => Number(key) > (layout?.count ?? 0),
      )
      if (invalid)
        issues.push({
          level: 'error',
          nodeId: id,
          message: layout
            ? `Prong ${invalid} does not exist on "${id}" (this head has ${layout.count} prongs).`
            : `"${id}" needs a prong or basket setting and a held stone to use individual prong offsets.`,
        })
    }
  }
  const listed = new Set(design.order)
  for (const id of Object.keys(design.nodes))
    if (id === '__proto__')
      // Parsing or copying the map by assignment drops such a node without a trace.
      issues.push({ level: 'error', nodeId: id, message: '"__proto__" cannot be a node id' })
    else if (!listed.has(id))
      issues.push({
        level: 'warning',
        nodeId: id,
        message: `Node "${id}" is missing from the order`,
      })
  if (evaluationOrder(design) === null)
    issues.push({ level: 'error', message: 'Nodes reference each other in a cycle' })
  return issues
}

/** Node ids sorted so that every node comes after the nodes it references; null on a cycle. */
export function evaluationOrder(design: Design): string[] | null {
  const out: string[] = []
  const state = new Map<string, 1 | 2>()
  const visit = (id: string): boolean => {
    const s = state.get(id)
    if (s === 2) return true
    if (s === 1) return false
    state.set(id, 1)
    const n = Object.hasOwn(design.nodes, id) ? design.nodes[id] : undefined
    if (n)
      for (const r of nodeRefs(n)) if (Object.hasOwn(design.nodes, r) && !visit(r)) return false
    state.set(id, 2)
    out.push(id)
    return true
  }
  for (const id of design.order) if (!visit(id)) return null
  return out
}

let counter = 0
/** Short, readable, collision-safe ids: `gem_k3f9x2`. */
export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 7)
  return `${prefix}_${rand}${(counter++ % 36).toString(36)}`
}

/** Builds a design from node inputs (defaults applied, order = array order). */
export function designFrom(kind: PieceKind, nodes: readonly NodeInput[]): Design {
  return applyOps(
    emptyDesign(kind),
    nodes.map((node) => ({ t: 'add', node }) as const),
  ).design
}
