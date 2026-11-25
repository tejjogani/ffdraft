/**
 * A model of the prompt cache, so the usage the fake reports behaves like the real thing: a
 * prefix written at a breakpoint is read back by a later request whose bytes match up to there.
 * It is what lets tests see a cache read on the second turn, and a miss when a harness changes
 * something before the breakpoint (skill: shared/prompt-caching.md § The one invariant, § API
 * reference (512-token minimum), § 20-block lookback window; live: build-with-claude/vision
 * (an image costs ⌈w/28⌉ × ⌈h/28⌉ visual tokens)).
 *
 * Token counts are estimates (a quarter of the JSON bytes, images by their patches): exact enough
 * to see reads, writes and cost move, not the real tokenizer.
 */
// biome-ignore-all lint/suspicious/useIterableCallbackReturn: push returns nothing worth keeping; the callbacks are statements
import { createHash } from 'node:crypto'
import { breakpointsOf, imageSize } from './rules'
import { MIN_CACHEABLE_TOKENS } from './spec'

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

interface Segment {
  path: string
  tokens: number
  /** Cumulative hash of the prefix up to and including this segment. */
  hash: string
  /** Lookback position: a run of tool_use (or tool_result) blocks shares one. */
  position: number
}

function tokensOf(block: unknown): number {
  // An image saved without its bytes (recordings keep its size): the same patches as the original.
  if (
    isObj(block) &&
    block.type === 'image' &&
    isObj(block.source) &&
    typeof block.source.width === 'number' &&
    typeof block.source.height === 'number'
  )
    return Math.min(4784, Math.ceil(block.source.width / 28) * Math.ceil(block.source.height / 28))
  if (
    isObj(block) &&
    block.type === 'image' &&
    isObj(block.source) &&
    typeof block.source.data === 'string'
  ) {
    const size = imageSize(
      Buffer.from(block.source.data, 'base64'),
      String(block.source.media_type),
    )
    if (size) return Math.min(4784, Math.ceil(size.w / 28) * Math.ceil(size.h / 28))
  }
  if (isObj(block) && block.type === 'tool_result' && Array.isArray(block.content)) {
    const { content, ...rest } = block
    return (
      Math.ceil(JSON.stringify(rest).length / 4) +
      content.reduce<number>((n, b) => n + tokensOf(b), 0)
    )
  }
  return Math.ceil(JSON.stringify(block).length / 4)
}

export function segmentsOf(body: Json): Segment[] {
  const out: Segment[] = []
  const h = createHash('sha256')
  let position = -1
  let lastKind = ''
  const push = (path: string, block: unknown, kind: string) => {
    h.update(path.replace(/\.\d+$/, ''))
    h.update(JSON.stringify(block))
    const runKind = kind === 'tool_use' || kind === 'tool_result' ? kind : ''
    if (!(runKind && runKind === lastKind)) position++
    lastKind = runKind
    out.push({ path, tokens: tokensOf(block), hash: h.copy().digest('hex'), position })
  }
  ;(Array.isArray(body.tools) ? body.tools : []).forEach((t, i) => push(`tools.${i}`, t, 'tool'))
  if (typeof body.system === 'string') push('system.0', body.system, 'system')
  else
    (Array.isArray(body.system) ? body.system : []).forEach((b, i) =>
      push(`system.${i}`, b, 'system'),
    )
  ;(Array.isArray(body.messages) ? body.messages : []).forEach((m, i) => {
    if (!isObj(m)) return
    const content = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content
    if (!Array.isArray(content)) return
    content.forEach((b, j) =>
      push(
        `messages.${i}.content.${j}`,
        { role: m.role, ...(b as Json) },
        isObj(b) ? String(b.type) : '',
      ),
    )
  })
  return out
}

export interface CacheUsage {
  input_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  /** All prompt tokens, for the context-window check. */
  total: number
}

/** The cache of one fake server: prefix hashes written, per model. */
export class PromptCache {
  readonly #entries = new Map<string, Set<string>>()

  /** Usage for a request, writing the prefixes at its breakpoints. */
  use(model: string, body: Json): CacheUsage {
    const segs = segmentsOf(body)
    const cumulative: number[] = []
    segs.reduce((n, s, i) => (cumulative[i] = n + s.tokens), 0)
    const total = cumulative.at(-1) ?? 0
    const index = new Map(segs.map((s, i) => [s.path, i]))
    const marks = breakpointsOf(body, Array.isArray(body.tools) ? body.tools : [])
      .map((b) => index.get(b.path))
      .filter((i): i is number => i !== undefined)
    if (isObj(body.cache_control) && segs.length) marks.push(segs.length - 1)
    marks.sort((a, b) => a - b)
    const store = this.#entries.get(model) ?? new Set<string>()
    this.#entries.set(model, store)

    // Reads: the furthest earlier entry within each breakpoint's 20-position lookback.
    let read = -1
    for (const m of marks) {
      const floor = segs[m]!.position - 19
      for (let i = m; i >= 0 && segs[i]!.position >= floor; i--)
        if (store.has(segs[i]!.hash)) {
          read = Math.max(read, i)
          break
        }
    }
    const readTokens = read >= 0 ? cumulative[read]! : 0
    const last = marks.at(-1) ?? -1
    let written = readTokens
    for (const m of marks)
      if (m > read && cumulative[m]! >= MIN_CACHEABLE_TOKENS) {
        store.add(segs[m]!.hash)
        written = cumulative[m]!
      }
    const cached = Math.max(readTokens, written)
    return {
      input_tokens: total - (last >= 0 ? Math.max(cached, readTokens) : 0),
      cache_read_input_tokens: readTokens,
      cache_creation_input_tokens: written - readTokens,
      total,
    }
  }
}
