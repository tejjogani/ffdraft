/**
 * The design document and the only way it changes: ops.
 *
 * Every edit — a slider drag, an undo, an agent tool call — is a list of ops applied by
 * `applyOps`, which also returns the exact inverse. Recording `{ ops, inverse, actor }` gives
 * undo/redo, a replayable history and a per-edit trace of who (person or agent run) did what.
 */
import { z } from 'zod'
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
  schemaVersion: z.literal(1).default(1),
  kind: z.enum(PIECE_KINDS).default('ring'),
  nodes: z.record(z.string(), NodeSchema).default({}),
  /** Outliner order. Every node id appears exactly once. */
  order: z.array(z.string()).default([]),
})
export type Design = z.infer<typeof DesignSchema>

export const emptyDesign = (kind: PieceKind = 'ring'): Design => ({
  schemaVersion: 1,
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

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

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
      // Parsing can reorder an object's keys without changing a value; that is not a change.
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
export function applyOps(design: Design, ops: readonly Op[]): { design: Design; inverse: Op[] } {
  // Own-property lookups only: ids such as "constructor" or "__proto__" are ordinary ids.
  const nodes: Record<string, Node> = Object.assign(Object.create(null), design.nodes)
  const has = (id: string) => Object.hasOwn(nodes, id)
  let order = [...design.order]
  let kind = design.kind
  const inverse: Op[] = []

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
        if (has(node.id)) throw new OpError(`Node "${node.id}" already exists`, op)
        nodes[node.id] = node
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

  const next: Design = { schemaVersion: 1, kind, nodes: { ...nodes }, order }
  const issues = validateDesign(next).filter((i) => i.level === 'error')
  if (issues.length) throw new OpError(issues.map((i) => i.message).join('; '), ops[0]!)
  return { design: next, inverse }
}

// ── Versions ─────────────────────────────────────────────────────────────────────────────────

/** The design document version this build writes (`Design.schemaVersion`). */
export const DESIGN_VERSION = 1

/**
 * One step per older version, keyed by the version it starts from, each bringing a document up
 * by one. Version 0 is a document written before `schemaVersion` existed; its nodes already had
 * today's shape. Fields a node gained since are not a version: parsing fills in their defaults.
 */
const DESIGN_MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> =
  {
    0: (doc) => ({ ...doc, schemaVersion: 1 }),
  }

/** A design document this build cannot read: not a design, or made by a newer Pavé. */
export class DesignVersionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DesignVersionError'
  }
}

/**
 * Brings a design document from any earlier version up to {@link DESIGN_VERSION} and validates
 * it, for documents that come from outside the database (a .pave file). A document from a newer
 * version is refused rather than guessed at, since its meaning may have changed.
 */
export function migrateDesign(raw: unknown): Design {
  if (!isObject(raw)) throw new DesignVersionError('The design document is not an object')
  let doc = raw
  let version = doc.schemaVersion === undefined ? 0 : doc.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0)
    throw new DesignVersionError(`The design document has an unreadable version (${version})`)
  if (version > DESIGN_VERSION)
    throw new DesignVersionError(
      `This design was made by a newer version of Pavé (design version ${version}; this one reads up to ${DESIGN_VERSION}). Update Pavé to open it.`,
    )
  for (; version < DESIGN_VERSION; version++) doc = DESIGN_MIGRATIONS[version]!(doc)
  const parsed = DesignSchema.safeParse(doc)
  if (!parsed.success)
    throw new DesignVersionError(
      `The design document is not valid: ${z.prettifyError(parsed.error)}`,
    )
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
  return parsed.data
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
  for (const id of design.order) {
    const n = design.nodes[id]
    if (!n) {
      issues.push({ level: 'error', nodeId: id, message: `Order lists missing node "${id}"` })
      continue
    }
    for (const r of nodeRefs(n)) {
      const target = design.nodes[r]
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
    }
  }
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
    const n = design.nodes[id]
    if (n) for (const r of nodeRefs(n)) if (design.nodes[r] && !visit(r)) return false
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
