/**
 * Recordings: a conversation with the fake saved as a replay fixture, and the tools to replay it
 * against a fresh run whose ids are all different.
 *
 * A recording keeps, for each request, only the messages that are new since that conversation's
 * previous request (image bytes become their hash and size), plus hashes of the frozen prefix, and
 * the reply exactly as it was served (usage included, so a replay costs the same). Replaying walks
 * the live request against the recorded one: ids the server generated (`pc_…`, `chg_…`, node ids)
 * are paired up by position, and the recorded reply is rewritten with the live ids before it is
 * served. Anything else that differs is reported as drift.
 */
import { createHash } from 'node:crypto'
import type { FakeReply } from './reply'
import { imageSize } from './rules'

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex').slice(0, 16)

export interface RecordedRequest {
  model: string
  structured: boolean
  betas: string[]
  /** Hashes of the frozen prefix: the same on every turn of a well-behaved harness. */
  toolsHash: string
  systemHash: string
  /** Which conversation (index of its first exchange in this recording). */
  conversation: number
  /** Messages reused from the conversation's previous request, then the new ones. */
  prefix: number
  tail: unknown[]
  messageCount: number
}

export interface RecordedExchange {
  n: number
  request: RecordedRequest
  reply: FakeReply
  /**
   * The client went away before any reply: a run stopped, or an AI job paused because a person
   * edited the piece mid-call. A replay holds this request open until the client aborts it.
   */
  aborted?: true
}

export interface Recording {
  version: 1
  journey: string
  description: string
  recordedAt: string
  exchanges: RecordedExchange[]
}

/** Image bytes replaced by their hash and size: recordings stay small and diffable. */
export function stripImages(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripImages)
  if (!isObj(value)) return value
  if (
    value.type === 'image' &&
    isObj(value.source) &&
    value.source.type === 'base64' &&
    typeof value.source.data === 'string' &&
    // Already stripped (a request saved by the agent source): keep it as it is.
    !value.source.data.startsWith('sha256:')
  ) {
    const buf = Buffer.from(value.source.data, 'base64')
    const size = imageSize(buf, String(value.source.media_type))
    return {
      ...value,
      source: {
        type: 'base64',
        media_type: value.source.media_type,
        data: `sha256:${sha(buf)}`,
        bytes: buf.length,
        ...(size ? { width: size.w, height: size.h } : {}),
      },
    }
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripImages(v)]))
}

/** Tracks conversations across requests so each exchange records only what is new. */
export class Recorder {
  readonly exchanges: RecordedExchange[] = []
  /** Per conversation: the first exchange index and the messages of its latest request. */
  readonly #conversations: { first: string; index: number; messages: string[] }[] = []

  /** Finds the conversation a request continues: the one whose first message matches. */
  locate(messages: unknown[]): { index: number; prefix: number; isNew: boolean } {
    const json = messages.map((m) => JSON.stringify(stripImages(m)))
    const first = json[0] ?? ''
    let conv = this.#conversations.find((c) => c.first === first)
    let isNew = false
    if (!conv) {
      conv = { first, index: this.exchanges.length, messages: [] }
      this.#conversations.push(conv)
      isNew = true
    }
    let prefix = 0
    while (
      prefix < conv.messages.length &&
      prefix < json.length &&
      conv.messages[prefix] === json[prefix]
    )
      prefix++
    return { index: this.#conversations.indexOf(conv), prefix, isNew }
  }

  add(n: number, body: Json, betas: string[], reply: FakeReply | null): RecordedExchange {
    const messages = Array.isArray(body.messages) ? body.messages : []
    const { index, prefix } = this.locate(messages)
    const conv = this.#conversations[index]!
    conv.messages = messages.map((m) => JSON.stringify(stripImages(m)))
    const e: RecordedExchange = {
      n,
      request: {
        model: String(body.model),
        structured: isObj(body.output_config) && body.output_config.format !== undefined,
        betas,
        toolsHash: sha(JSON.stringify(body.tools ?? null)),
        systemHash: sha(JSON.stringify(body.system ?? null)),
        conversation: conv.index,
        prefix,
        tail: messages.slice(prefix).map(stripImages),
        messageCount: messages.length,
      },
      reply: reply ?? { content: [] },
      ...(reply ? {} : { aborted: true as const }),
    }
    this.exchanges.push(e)
    return e
  }

  recording(journey: string, description: string): Recording {
    return {
      version: 1,
      journey,
      description,
      recordedAt: new Date().toISOString(),
      exchanges: this.exchanges,
    }
  }
}

/** The full (image-stripped) messages of each recorded request, rebuilt from the tails. */
export function recordedMessages(rec: Recording): unknown[][] {
  const latest = new Map<number, unknown[]>()
  return rec.exchanges.map((e) => {
    const before = latest.get(e.request.conversation) ?? []
    const full = [...before.slice(0, e.request.prefix), ...e.request.tail]
    latest.set(e.request.conversation, full)
    return full
  })
}

// ── Id alignment ─────────────────────────────────────────────────────────────────────────────

const TOKEN = /[A-Za-z0-9_-]+/g
/** A server- or kernel-generated id: `pc_V1StGXR8Z5jdHi6B`, `gem_k3f9x2`, `chg_run_…_toolu_…`. */
const ID_LIKE = /^[a-z]{2,8}_[A-Za-z0-9_-]{5,}$/

const tokens = (s: string) => s.match(TOKEN) ?? []
const norm = (t: string) => (ID_LIKE.test(t) ? '<id>' : t)

export interface Alignment {
  /** Recorded id → live id. */
  ids: Map<string, string>
  /** Non-id tokens that differ (recorded → live), with the few tokens before them. */
  drift: { at: string; recorded: string; live: string; after: string }[]
  /** The two requests do not have the same shape (message count, roles, block types). */
  structural: string[]
}

const shape = (messages: unknown[]) =>
  messages.map((m) =>
    isObj(m)
      ? `${String(m.role)}:${Array.isArray(m.content) ? (m.content as Json[]).map((b) => (isObj(b) ? String(b.type) : '?')).join(',') : 'text'}`
      : '?',
  )

/** Pairs the ids of a recorded request with the live one, block by block. */
export function align(
  recorded: unknown[],
  live: unknown[],
  into: Map<string, string> = new Map(),
): Alignment {
  const out: Alignment = { ids: into, drift: [], structural: [] }
  const a = shape(recorded)
  const b = shape(live)
  if (a.length !== b.length)
    out.structural.push(`message count ${a.length} recorded, ${b.length} live`)
  for (let i = 0; i < Math.min(a.length, b.length); i++)
    if (a[i] !== b[i]) out.structural.push(`messages.${i}: ${a[i]} recorded, ${b[i]} live`)
  const n = Math.min(recorded.length, live.length)
  for (let i = 0; i < n; i++) {
    const ra = tokens(JSON.stringify(stripImages(recorded[i])))
    const la = tokens(JSON.stringify(stripImages(live[i])))
    let x = 0
    let y = 0
    while (x < ra.length && y < la.length) {
      const r = ra[x]!
      const l = la[y]!
      if (norm(r) === norm(l)) {
        if (r !== l) {
          const known = out.ids.get(r)
          if (known === undefined) out.ids.set(r, l)
          else if (known !== l)
            out.drift.push({
              at: `messages.${i}`,
              recorded: r,
              live: `${l} (already paired with ${known})`,
              after: ra.slice(Math.max(0, x - 6), x).join(' '),
            })
        }
        x++
        y++
        continue
      }
      // Resynchronise: the nearest point where both sides agree again.
      let found = false
      for (let k = 1; k <= 40 && !found; k++)
        for (let j = 0; j <= k && !found; j++) {
          const xi = x + j
          const yi = y + (k - j)
          if (
            xi < ra.length &&
            yi < la.length &&
            norm(ra[xi]!) === norm(la[yi]!) &&
            ra[xi]!.length > 2
          ) {
            out.drift.push({
              at: `messages.${i}`,
              recorded: ra.slice(x, xi).join(' '),
              live: la.slice(y, yi).join(' '),
              after: ra.slice(Math.max(0, x - 6), x).join(' '),
            })
            x = xi
            y = yi
            found = true
          }
        }
      if (!found) {
        out.drift.push({
          at: `messages.${i}`,
          recorded: ra.slice(x, x + 8).join(' '),
          live: la.slice(y, y + 8).join(' '),
          after: ra.slice(Math.max(0, x - 6), x).join(' '),
        })
        break
      }
    }
  }
  return out
}

/** The recorded reply with every paired id replaced by its live counterpart. */
export function remap(reply: FakeReply, ids: ReadonlyMap<string, string>): FakeReply {
  if (!ids.size) return reply
  const keys = [...ids.keys()].sort((p, q) => q.length - p.length)
  let json = JSON.stringify(reply)
  for (const k of keys) json = json.split(k).join(ids.get(k)!)
  return JSON.parse(json) as FakeReply
}

// ── A readable view of a request, for Claude answering in the loop ───────────────────────────

const clip = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, max)}… [${s.length - max} more chars]` : s

function blockLine(b: unknown, max: number): string {
  if (!isObj(b)) return String(b)
  switch (b.type) {
    case 'text':
      return clip(String(b.text), max)
    case 'thinking':
      return `(thinking) ${clip(String(b.thinking), 300)}`
    case 'tool_use':
      return `TOOL_USE ${String(b.name)} id=${String(b.id)} ${clip(JSON.stringify(b.input), max)}`
    case 'tool_result': {
      const parts = Array.isArray(b.content)
        ? (b.content as unknown[]).map((x) => blockLine(x, max)).join('\n    ')
        : clip(String(b.content ?? ''), max)
      return `TOOL_RESULT ${String(b.tool_use_id)}${b.is_error ? ' (ERROR)' : ''}:\n    ${parts}`
    }
    case 'image': {
      const src = isObj(b.source) ? b.source : {}
      return `[image ${String(src.media_type)} ${src.width ?? '?'}x${src.height ?? '?'} ${String(src.data).slice(0, 23)}]`
    }
    default:
      return `[${String(b.type)}]`
  }
}

/** The messages from `from` on, one line per block. */
export function describeMessages(messages: unknown[], from: number, max = 2500): string {
  const out: string[] = []
  messages.slice(from).forEach((m, k) => {
    if (!isObj(m)) return
    const content =
      typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content as unknown[])
    out.push(`[${from + k}] ${String(m.role).toUpperCase()}`)
    for (const b of content ?? []) out.push(`  ${blockLine(stripImages(b), max)}`)
  })
  return out.join('\n')
}
