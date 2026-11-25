/**
 * The gate's pure rules: what a run may still spend, which tool calls run on their own, when a
 * repeated call means the model is stuck, and whether a person's edits overlap the model's.
 * The server applies them (apps/server/src/assistant/gate.ts) with what it reads from the database.
 */
import {
  type ClientToolName,
  type CommandDef,
  type CommandName,
  clientTools,
  minimumRole,
  type Role,
  roleAllows,
} from '@pave/schema'
import type { ToolDef } from './tools'

function roleFor(def: ToolDef): Role {
  if (!def.client) return minimumRole(def.command as CommandName)
  const c: CommandDef = clientTools[def.command as ClientToolName]
  return c.role ?? (c.kind === 'query' ? 'viewer' : 'designer')
}

/** Model calls one run may make before it pauses and asks the designer to continue. */
export const MAX_TURNS = 40
/** Spend one run may reach before it pauses the same way. */
export const RUN_CAP_USD = 3
/** The same call with the same input, failing this many times, is refused as a loop. */
export const REPEAT_LIMIT = 3

export type CapReason = { kind: 'turns'; turns: number } | { kind: 'cost'; costUsd: number }

/** Why the run must pause before its next model call, or null to go on. */
export function runCap(run: { turns: number; costUsd: number }): CapReason | null {
  if (run.turns >= MAX_TURNS) return { kind: 'turns', turns: run.turns }
  if (run.costUsd >= RUN_CAP_USD) return { kind: 'cost', costUsd: run.costUsd }
  return null
}

export function capMessage(cap: CapReason): string {
  return cap.kind === 'turns'
    ? `Paused after ${cap.turns} steps. Send “Continue” to let the assistant go on.`
    : `Paused at $${cap.costUsd.toFixed(2)} spent on this request. Send “Continue” to let the assistant go on.`
}

/** How a validated call is handled before it runs. */
export type Admission =
  | { kind: 'run' }
  /** A person must approve it first. */
  | { kind: 'approve' }
  /** Refused; the message goes back to the model as an error result. */
  | { kind: 'refuse'; message: string }

/**
 * Rights and approval. The agent has exactly the role of the person it works for: a call that
 * person could not make is refused here (and would be by the command pipeline too).
 */
export function admit(def: ToolDef, role: Role): Admission {
  const need = roleFor(def)
  if (!roleAllows(role, need))
    return {
      kind: 'refuse',
      message: `${def.name} needs the ${need} role, and the designer you work for is ${role}. Tell them it needs someone with more rights.`,
    }
  return def.confirm ? { kind: 'approve' } : { kind: 'run' }
}

/** Deterministic JSON (sorted keys), so the same input always compares equal. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`
  return JSON.stringify(v ?? null)
}

/**
 * The loop breaker: refuses a call that already failed {@link REPEAT_LIMIT} times in this run
 * with exactly the same input. Earlier calls are the run's tool steps.
 */
export function repeatedFailure(
  call: { name: string; input: unknown },
  earlier: readonly { name: string; input: unknown; isError: boolean }[],
): string | null {
  const key = canonicalJson(call.input)
  const fails = earlier.filter(
    (s) => s.name === call.name && s.isError && canonicalJson(s.input) === key,
  ).length
  if (fails < REPEAT_LIMIT) return null
  return `This exact ${call.name} call has failed ${fails} times in this request. Do not repeat it: change the input, try another way, or tell the designer what is blocking you.`
}

interface OpLike {
  t: string
  id?: string
  node?: Record<string, unknown>
}

/** The node ids a list of design ops reads or writes (a `setKind` touches the whole piece). */
export function opNodeIds(ops: readonly OpLike[]): Set<string> {
  const ids = new Set<string>()
  for (const op of ops) {
    if (op.t === 'add' && typeof op.node?.id === 'string') {
      ids.add(op.node.id)
      if (typeof op.node.parent === 'string') ids.add(op.node.parent)
    } else if (op.t === 'setKind') ids.add('*')
    else if (typeof op.id === 'string') ids.add(op.id)
  }
  return ids
}

export interface PersonChange {
  seq: number
  label: string
  ops: readonly OpLike[]
}

export type Overlap =
  | { kind: 'clear'; notes: string | null }
  | { kind: 'conflict'; message: string; nodeIds: string[] }

/**
 * The human-edit overlap check before the model's `design.apply`: people's changes to the piece
 * since the model last saw it. Touching the same features is a conflict (the person wins: the
 * model is told to look again); other edits are only noted, and the model's ops apply on top.
 */
export function checkOverlap(agentOps: readonly OpLike[], since: readonly PersonChange[]): Overlap {
  if (since.length === 0) return { kind: 'clear', notes: null }
  const mine = opNodeIds(agentOps)
  const hit = new Set<string>()
  for (const c of since)
    for (const id of opNodeIds(c.ops))
      if (mine.has(id) || id === '*' || mine.has('*')) hit.add(id === '*' ? 'the piece kind' : id)
  const list = since.map((c) => `v${c.seq} “${c.label}”`).join(', ')
  if (hit.size)
    return {
      kind: 'conflict',
      nodeIds: [...hit],
      message: `Not applied: the designer changed ${[...hit].join(', ')} since you last looked (${list}). Their edit wins. Read the piece again (pieces.get) and re-plan on top of it.`,
    }
  return {
    kind: 'clear',
    notes: `Note: the designer also edited the piece since you last looked (${list}), on other features; your change applied on top of theirs.`,
  }
}
