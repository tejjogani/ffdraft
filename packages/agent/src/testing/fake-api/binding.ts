/**
 * Preserved thinking, as the fake enforces it. A thinking block the fake returns carries a
 * signature that binds it to the model that wrote it and to the exact request prefix it was
 * written after (tools, system and every earlier message). When the block comes back:
 *  - a changed block (text or signature) is always a 400;
 *  - a model that cannot read the writer's blocks drops it (reported with the binding beta);
 *  - a changed prefix is a 400, or a drop under `prefix_mismatch_behavior: "drop_block"`.
 * The fake plays the strictest account: the check is enforced as for accounts created on or after
 * 2026-08-31 and for every account on Fable 5.2 (skill: shared/model-migration.md § Migrating to
 * Claude Opus 5.5, breaking change 3; § Migrating to Claude Fable 5.2, breaking change 1).
 */
import { createHash, createHmac } from 'node:crypto'
import { canRead } from './spec'

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

const SECRET = 'pave-fake-api-thinking'
const sha = (s: string) => createHash('sha256').update(s).digest('base64url')

/**
 * The hash of everything before message `index`: tools, system, then the messages. JSON
 * re-serialisation keeps key order and values, so any edit a harness makes shows up here.
 */
export function prefixHash(body: Json, index: number): string {
  const messages = Array.isArray(body.messages) ? body.messages.slice(0, index) : []
  return sha(JSON.stringify([body.tools ?? null, body.system ?? null, messages]))
}

export function signThinking(model: string, prefix: string, thinking: string): string {
  const head = Buffer.from(JSON.stringify({ m: model, p: prefix })).toString('base64url')
  const mac = createHmac('sha256', SECRET)
    .update(`${head}.${sha(thinking)}`)
    .digest('base64url')
  return `fk1.${head}.${mac}`
}

function readSignature(sig: unknown, thinking: string): { m: string; p: string } | null {
  if (typeof sig !== 'string') return null
  const [tag, head, mac] = sig.split('.')
  if (tag !== 'fk1' || !head || !mac) return null
  const expect = createHmac('sha256', SECRET)
    .update(`${head}.${sha(thinking)}`)
    .digest('base64url')
  if (expect !== mac) return null
  try {
    const v = JSON.parse(Buffer.from(head, 'base64url').toString()) as { m: string; p: string }
    return typeof v.m === 'string' && typeof v.p === 'string' ? v : null
  } catch {
    return null
  }
}

export interface Transformation {
  type: 'thinking_dropped'
  path: string
  reason: 'model_binding_mismatch' | 'prefix_binding_mismatch'
}

export interface BindingResult {
  /** A 400 to answer with, if any block fails the check. */
  error: string | null
  /** What was dropped. */
  dropped: Transformation[]
}

export function checkBinding(body: Json, model: string): BindingResult {
  const thinking = isObj(body.thinking) ? body.thinking : {}
  const bb = isObj(thinking.block_binding) ? thinking.block_binding : {}
  const drop = bb.prefix_mismatch_behavior === 'drop_block'
  const dropped: Transformation[] = []
  const messages = Array.isArray(body.messages) ? (body.messages as unknown[]) : []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (!isObj(m) || m.role !== 'assistant' || !Array.isArray(m.content)) continue
    let prefix: string | null = null
    for (let j = 0; j < m.content.length; j++) {
      const b = m.content[j]
      if (!isObj(b) || b.type !== 'thinking') continue
      const path = `messages.${i}.content.${j}`
      const sig = readSignature(b.signature, typeof b.thinking === 'string' ? b.thinking : '')
      if (!sig) return { error: `${path}: Invalid \`signature\` in \`thinking\` block.`, dropped }
      if (!canRead(model, sig.m)) {
        dropped.push({ type: 'thinking_dropped', path, reason: 'model_binding_mismatch' })
        continue
      }
      prefix ??= prefixHash(body, i)
      if (prefix !== sig.p) {
        if (!drop)
          return {
            error: `${path}: Invalid \`signature\` in \`thinking\` block. The block is bound to a different conversation. Remove the block, or set \`thinking.block_binding.prefix_mismatch_behavior\` to "drop_block".`,
            dropped,
          }
        dropped.push({ type: 'thinking_dropped', path, reason: 'prefix_binding_mismatch' })
      }
    }
  }
  return { error: null, dropped }
}
