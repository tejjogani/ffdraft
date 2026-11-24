/**
 * The run reducer: folds a run's events into what a conversation shows while it is live. The
 * studio's stream hook and the tests share it. Events carry a per-run `seq`; anything at or
 * below the last applied `seq` is a duplicate from a reconnect and is ignored, so replaying a
 * stream from any point gives the same state.
 */
import type { AiJob, Message, Run, RunEvent, Tokens } from '@pave/schema'

/** `waiting`: the call started a job (a render take) and its result comes when that settles. */
export type ToolCallStatus = 'running' | 'awaiting' | 'waiting' | 'done' | 'error'

export interface ToolCallView {
  toolCallId: string
  name: string
  input: unknown
  status: ToolCallStatus
  /** For a call awaiting approval: what will happen, and what it costs when known. */
  summary?: string
  estimate?: { usd: number; seconds: number | null; machine?: boolean } | null
  changeIds: string[]
  assetIds: string[]
  /** For a waiting call: the job it waits for. */
  job?: { kind: string; id: string }
}

export interface LiveBlock {
  kind: 'text' | 'thinking'
  index: number
  text: string
}

export interface RunView {
  runId: string
  /** The last applied event. */
  seq: number
  run: Run | null
  /** Messages stored during this run, in order. */
  messages: Message[]
  /** What the model is writing now, before its message is stored. */
  live: LiveBlock[]
  tools: Record<string, ToolCallView>
  /** Tool call ids in the order they started. */
  toolOrder: string[]
  tokens: Tokens
  costUsd: number
  /** An AI job's latest record (its plan as it moves), when the run is one. */
  job: AiJob | null
  finished: boolean
}

export function initialRunView(runId: string): RunView {
  return {
    runId,
    seq: 0,
    run: null,
    messages: [],
    live: [],
    tools: {},
    toolOrder: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    costUsd: 0,
    job: null,
    finished: false,
  }
}

function appendLive(live: LiveBlock[], kind: LiveBlock['kind'], index: number, text: string) {
  const at = live.findIndex((b) => b.index === index && b.kind === kind)
  if (at === -1) return [...live, { kind, index, text }].sort((a, b) => a.index - b.index)
  const next = live.slice()
  next[at] = { ...live[at]!, text: live[at]!.text + text }
  return next
}

function patchTool(s: RunView, id: string, patch: Partial<ToolCallView>): RunView {
  const prev = s.tools[id]
  if (!prev) return s
  return { ...s, tools: { ...s.tools, [id]: { ...prev, ...patch } } }
}

function startTool(s: RunView, toolCallId: string, name: string, input: unknown): RunView {
  return {
    ...s,
    tools: {
      ...s.tools,
      [toolCallId]: { toolCallId, name, input, status: 'running', changeIds: [], assetIds: [] },
    },
    toolOrder: s.toolOrder.includes(toolCallId) ? s.toolOrder : [...s.toolOrder, toolCallId],
  }
}

/** Applies one event. Pure: returns a new view, or the same one for a duplicate or foreign event. */
export function reduceRun(s: RunView, e: RunEvent): RunView {
  if (e.runId !== s.runId || e.seq <= s.seq) return s
  const next: RunView = { ...s, seq: e.seq }
  switch (e.type) {
    case 'run.started':
      return { ...next, run: e.run, job: e.run.job }
    case 'text.delta':
      return { ...next, live: appendLive(s.live, 'text', e.index, e.text) }
    case 'thinking.delta':
      return { ...next, live: appendLive(s.live, 'thinking', e.index, e.text) }
    case 'message.completed':
      // A stored assistant message replaces what was streaming for it.
      return {
        ...next,
        messages: [...s.messages.filter((m) => m.id !== e.message.id), e.message],
        live: e.message.role === 'assistant' ? [] : s.live,
      }
    case 'tool.started':
      return startTool(next, e.toolCallId, e.name, e.input)
    case 'tool.awaiting': {
      // A stream resumed after a restart can start at the approval, without `tool.started`.
      const known = s.tools[e.toolCallId] ? next : startTool(next, e.toolCallId, e.name, e.input)
      return patchTool(known, e.toolCallId, {
        status: 'awaiting',
        summary: e.summary,
        estimate: e.estimate,
      })
    }
    case 'tool.waiting':
      return patchTool(next, e.toolCallId, { status: 'waiting', job: e.job })
    case 'tool.finished':
      return patchTool(next, e.toolCallId, {
        status: e.isError ? 'error' : 'done',
        changeIds: e.changeIds,
        assetIds: e.assetIds,
      })
    case 'usage':
      return { ...next, tokens: e.tokens, costUsd: e.costUsd }
    case 'job.updated':
      return { ...next, run: next.run ? { ...next.run, job: e.job } : next.run, job: e.job }
    case 'run.finished':
      return { ...next, run: e.run, job: e.run.job, live: [], finished: true }
  }
}

/** Folds a whole stream. */
export const replayRun = (runId: string, events: readonly RunEvent[]): RunView =>
  events.reduce(reduceRun, initialRunView(runId))
