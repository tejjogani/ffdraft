/**
 * The design document and the only way it changes: ops.
 *
 * Every edit — a slider drag, an undo, an agent tool call — is a list of ops applied by
 * `applyOps`, which also returns the exact inverse. Recording `{ ops, inverse, actor }` gives
 * undo/redo, a replayable history and a per-edit trace of who (person or agent run) did what.
 */
import { z } from 'zod'
import { type Node, type NodeInput, NodeSchema, isBodyKind, nodeRefs } from './nodes'

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

function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isObject(patch)) return patch
  const out: Record<string, unknown> = isObject(target) ? { ...target } : {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k]
    else out[k] = mergePatch(out[k], v)
  }
  return out
}

/** The patch that undoes `patch` when applied to the result of merging it into `prev`. */
function invertPatch(prev: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const p = isObject(prev) ? prev : {}
  for (const [k, v] of Object.entries(patch)) {
    const before = p[k]
    out[k] = isObject(v) && isObject(before) ? invertPatch(before, v) : (before ?? null)
  }
  return out
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
  const nodes = { ...design.nodes }
  let order = [...design.order]
  let kind = design.kind
  const inverse: Op[] = []

  const removeOne = (id: string) => {
    const node = nodes[id]!
    inverse.unshift({ t: 'add', node, index: order.indexOf(id) })
    delete nodes[id]
    order = order.filter((x) => x !== id)
  }

  for (const op of ops) {
    switch (op.t) {
      case 'add': {
        const node = parseNode(op.node, op)
        if (nodes[node.id]) throw new OpError(`Node "${node.id}" already exists`, op)
        nodes[node.id] = node
        order.splice(Math.min(op.index ?? order.length, order.length), 0, node.id)
        inverse.unshift({ t: 'remove', id: node.id })
        break
      }
      case 'update': {
        const prev = nodes[op.id]
        if (!prev) throw new OpError(`No node "${op.id}"`, op)
        if ('id' in op.patch || 'kind' in op.patch)
          throw new OpError('id and kind cannot be changed; add a new node instead', op)
        nodes[op.id] = parseNode(mergePatch(prev, op.patch), op)
        inverse.unshift({ t: 'update', id: op.id, patch: invertPatch(prev, op.patch) })
        break
      }
      case 'remove': {
        if (!nodes[op.id]) throw new OpError(`No node "${op.id}"`, op)
        const visit = (id: string) => {
          const deps = dependents({ ...design, nodes, order }, id)
          if (deps.length && !op.cascade)
            throw new OpError(
              `"${id}" is used by ${deps.map((d) => `"${d}"`).join(', ')}; remove those first or pass cascade`,
              op,
            )
          for (const d of deps) if (nodes[d]) visit(d)
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

  const next: Design = { schemaVersion: 1, kind, nodes, order }
  const issues = validateDesign(next).filter((i) => i.level === 'error')
  if (issues.length) throw new OpError(issues.map((i) => i.message).join('; '), ops[0]!)
  return { design: next, inverse }
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
        issues.push({ level: 'error', nodeId: id, message: `"${id}" references missing node "${r}"` })
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
