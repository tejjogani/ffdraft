/**
 * What a conversation shows, worked out from the stored messages (provider-native blocks) and
 * the live tail of a run. Pure, so the rules are tested without a browser:
 *
 *  - the person's turns (with how many photos they carried), the assistant's text and its
 *    summarised thinking, in order; context messages (role `system`) are never shown;
 *  - tool calls between two pieces of text form one group of chips, with each call's state
 *    taken from the live run when it is streaming, else from its stored result;
 *  - while the model writes, its unfinished blocks come last.
 */
import { describeCall, isPinLabel, type RunView, TOOL_CHIPS } from '@pave/agent/studio'
import type { Message, Run, StoredChange } from '@pave/schema'

/** `waiting`: the call started a take; its result comes when the take is finished. */
export type CallStatus = 'running' | 'awaiting' | 'waiting' | 'done' | 'error'

export interface CallItem {
  toolCallId: string
  runId: string | null
  /** The command, e.g. `design.apply`. */
  name: string
  input: unknown
  status: CallStatus
  /** For a call waiting on a person: what will happen, and its cost when known. */
  summary?: string
  estimate?: { usd: number; seconds: number | null; machine?: boolean } | null
  /** Images the call produced (viewport captures), from the live run. */
  assetIds: string[]
  /** What went wrong, from the tool's result. */
  errorText?: string
  /** Quiet calls (reads and looks) collapse into one line. */
  quiet: boolean
  /** Past tense when done, present while running. */
  label: string
}

export type Item =
  | { kind: 'user'; key: string; runId: string | null; text: string; photos: number }
  | { kind: 'text'; key: string; runId: string | null; text: string; live?: boolean }
  | { kind: 'thinking'; key: string; runId: string | null; text: string; live?: boolean }
  | { kind: 'calls'; key: string; runId: string | null; calls: CallItem[] }
  /** The server's note that a message got no answer (the run was stopped or failed). */
  | { kind: 'note'; key: string; runId: string | null; text: string }

type Block = Record<string, unknown>

/** API tool names are commands with dots as underscores; no command contains an underscore. */
export const commandOf = (apiName: string): string => apiName.replaceAll('_', '.')

/** The chip text for a call, tolerating a tool this studio does not know (a newer server). */
export function callLabel(
  name: string,
  input: unknown,
  state: 'running' | 'done',
): {
  text: string
  quiet: boolean
} {
  if (!(name in TOOL_CHIPS)) return { text: name, quiet: false }
  try {
    return describeCall(name as keyof typeof TOOL_CHIPS, input as never, state)
  } catch {
    // An input the chip words cannot read (cut short): say what the tool does instead.
    return describeCall(name as keyof typeof TOOL_CHIPS, null, 'running')
  }
}

function resultText(b: Block): string {
  const c = b.content
  if (typeof c === 'string') return c
  if (Array.isArray(c))
    return c
      .map((x) => (x as Block).text)
      .filter((x): x is string => typeof x === 'string')
      .join('\n')
  return ''
}

const NOTE = /^\(No answer to that message: (.*)\)$/s

/** Stored messages plus those the live run has stored since they were fetched, in thread order. */
export function mergeMessages(stored: readonly Message[], live: RunView | null): Message[] {
  if (!live?.messages.length) return [...stored]
  const ids = new Set(stored.map((m) => m.id))
  return [...stored, ...live.messages.filter((m) => !ids.has(m.id))].sort((a, b) => a.seq - b.seq)
}

/**
 * What the designer typed and attached: pinned pictures the server added for the model (each a
 * label block, then its image) are not theirs to see in the conversation.
 */
export function ownBlocks(blocks: readonly Block[]): Block[] {
  const out: Block[] = []
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!
    if (b.type === 'text' && isPinLabel(String(b.text))) {
      if (blocks[i + 1]?.type === 'image') i++
      continue
    }
    out.push(b)
  }
  return out
}

export function conversationItems(stored: readonly Message[], live: RunView | null): Item[] {
  const messages = mergeMessages(stored, live)
  const results = new Map<string, { isError: boolean; text: string }>()
  for (const m of messages)
    if (m.role === 'user')
      for (const b of m.content as Block[])
        if (b.type === 'tool_result')
          results.set(String(b.tool_use_id), { isError: b.is_error === true, text: resultText(b) })

  const items: Item[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    const blocks = m.content as Block[]
    if (m.role === 'user') {
      const typed = ownBlocks(blocks)
      const text = typed
        .filter((b) => b.type === 'text')
        .map((b) => String(b.text))
        .join('\n\n')
      if (!text) continue
      const photos = typed.filter((b) => b.type === 'image').length
      items.push({ kind: 'user', key: m.id, runId: m.runId, text, photos })
      continue
    }
    let group: CallItem[] | null = null
    blocks.forEach((b, i) => {
      const key = `${m.id}:${i}`
      if (b.type === 'tool_use') {
        const id = String(b.id)
        const name = commandOf(String(b.name))
        const live$ = live?.tools[id]
        const stored$ = results.get(id)
        const status: CallStatus = live$
          ? live$.status
          : stored$
            ? stored$.isError
              ? 'error'
              : 'done'
            : 'running'
        const { text, quiet } = callLabel(
          name,
          b.input,
          status === 'running' || status === 'waiting' ? 'running' : 'done',
        )
        const call: CallItem = {
          toolCallId: id,
          runId: m.runId,
          name,
          input: b.input,
          status,
          summary: live$?.summary,
          estimate: live$?.estimate,
          assetIds: live$?.assetIds ?? [],
          errorText: stored$?.isError ? stored$.text : undefined,
          quiet,
          label: text,
        }
        if (!group) {
          group = []
          items.push({ kind: 'calls', key, runId: m.runId, calls: group })
        }
        group.push(call)
        return
      }
      group = null
      if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
        const note = NOTE.exec(b.text.trim())
        items.push(
          note
            ? { kind: 'note', key, runId: m.runId, text: note[1]! }
            : { kind: 'text', key, runId: m.runId, text: b.text },
        )
      } else if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim())
        items.push({ kind: 'thinking', key, runId: m.runId, text: b.thinking })
    })
  }

  for (const block of live?.live ?? [])
    if (block.text.trim())
      items.push({
        kind: block.kind,
        key: `live:${live!.runId}:${block.kind}:${block.index}`,
        runId: live!.runId,
        text: block.text,
        live: true,
      })
  return items
}

/** Calls of a group that read or look collapse; edits each keep a chip. */
export function splitQuiet(calls: readonly CallItem[]): { quiet: CallItem[]; loud: CallItem[] } {
  return {
    quiet: calls.filter((c) => c.quiet && c.status !== 'awaiting'),
    loud: calls.filter((c) => !c.quiet || c.status === 'awaiting'),
  }
}

/**
 * The change a call made to the piece, for its Undo: the newest change attributed to the call
 * that no later change has undone. Null when it changed nothing or it is undone already.
 */
export function changeOfCall(
  history: readonly StoredChange[] | undefined,
  runId: string | null,
  toolCallId: string,
): StoredChange | null {
  if (!history || !runId) return null
  const undone = new Set(history.flatMap((c) => c.reverts ?? []))
  const mine = history.filter(
    (c) => c.actor.type === 'agent' && c.actor.runId === runId && c.actor.toolCallId === toolCallId,
  )
  const latest = mine.sort((a, b) => b.seq - a.seq)[0]
  return latest && !undone.has(latest.id) ? latest : null
}

/** Whether a run still has changes on the piece that Undo all would revert. */
export function runHasLiveChanges(history: readonly StoredChange[] | undefined, runId: string) {
  if (!history) return false
  const undone = new Set(history.flatMap((c) => c.reverts ?? []))
  return history.some(
    (c) => c.actor.type === 'agent' && c.actor.runId === runId && !undone.has(c.id),
  )
}

/** "12.4k" style token counts. */
export function tokenCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/**
 * The run as shown: the stream knows it while it runs, the stored record once it has stopped
 * (suspended, or ended). Once the stored record says it stopped it wins, also over a finished
 * stream: changes after the end (a person accepting a job's review) reach only the stored one.
 * Until then the stream is newer than a record fetched while the run still ran.
 */
export function newerRun(stored: Run | null, streamed: Run | null): Run | null {
  if (!stored || !streamed || streamed.id !== stored.id) return stored
  return stored.status !== 'running' ? stored : streamed
}
