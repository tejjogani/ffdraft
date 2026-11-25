/**
 * The dock's rules without a browser: what a conversation shows from stored and live messages,
 * which change a chip's Undo reverts, the composer's send key, the live CAD cache patch, the job
 * states on a piece, and markdown that never renders raw HTML.
 */
import { initialRunView, reduceRun } from '@pave/agent/studio'
import {
  type AiJob,
  emptyDesign,
  type Message,
  type Piece,
  type Run,
  type StoredChange,
} from '@pave/schema'
import { inline, parseBlocks } from '@pave/ui'
import { describe, expect, it } from 'vitest'
import { patchPiece } from '../../lib/piece-cache'
import { elapsed, jobState, latestJob, planProgress } from './jobs/status'
import { isSendKey } from './keys'
import {
  changeOfCall,
  commandOf,
  conversationItems,
  ownBlocks,
  runHasLiveChanges,
  splitQuiet,
  tokenCount,
} from './model'

let seq = 0
const msg = (
  role: Message['role'],
  content: Record<string, unknown>[],
  runId = 'run_1',
): Message => ({
  id: `msg_${++seq}`,
  threadId: 'th_1',
  seq,
  role,
  content,
  runId,
  createdAt: '2026-11-24T10:00:00.000Z',
})

const run = (over: Partial<Run> = {}): Run => ({
  id: 'run_1',
  threadId: 'th_1',
  pieceId: 'p_1',
  userId: 'u_1',
  model: 'claude-opus-5-5',
  tier: 'standard',
  origin: 'studio',
  status: 'running',
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  costUsd: 0,
  startedAt: '2026-11-24T10:00:00.000Z',
  endedAt: null,
  error: null,
  errorCode: null,
  job: null,
  stage: null,
  ...over,
})

describe('conversation items', () => {
  it('shows turns, hides context, groups calls, and marks their state from results', () => {
    seq = 0
    const stored = [
      msg('user', [
        { type: 'image', source: { type: 'base64', data: '' } },
        { type: 'text', text: 'A halo ring' },
      ]),
      msg('system', [{ type: 'text', text: 'Context: piece p_1' }]),
      msg('assistant', [
        { type: 'thinking', thinking: 'Plan it.', signature: 's' },
        { type: 'text', text: 'Let me look.' },
        { type: 'tool_use', id: 't1', name: 'pieces_get', input: { id: 'p_1' } },
        {
          type: 'tool_use',
          id: 't2',
          name: 'design_apply',
          input: { pieceId: 'p_1', label: 'Thinner band', ops: [] },
        },
      ]),
      msg('user', [
        { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: '{}' }] },
        {
          type: 'tool_result',
          tool_use_id: 't2',
          is_error: true,
          content: [{ type: 'text', text: 'conflict: the band changed' }],
        },
      ]),
      msg('assistant', [
        { type: 'text', text: '(No answer to that message: the designer stopped it)' },
      ]),
    ]
    const items = conversationItems(stored, null)
    expect(items.map((i) => i.kind)).toEqual(['user', 'thinking', 'text', 'calls', 'note'])
    expect(items[0]).toMatchObject({ kind: 'user', text: 'A halo ring', photos: 1 })
    const calls = items[3]!.kind === 'calls' ? items[3]!.calls : []
    expect(calls.map((c) => [c.name, c.status])).toEqual([
      ['pieces.get', 'done'],
      ['design.apply', 'error'],
    ])
    expect(calls[1]!.errorText).toBe('conflict: the band changed')
    expect(calls[1]!.label).toBe('Thinner band')
    const { quiet, loud } = splitQuiet(calls)
    expect(quiet.map((c) => c.name)).toEqual(['pieces.get'])
    expect(loud.map((c) => c.name)).toEqual(['design.apply'])
    expect(items[4]).toMatchObject({ kind: 'note', text: 'the designer stopped it' })
  })

  it('folds in the live run: stored messages once, streaming text last, approvals waiting', () => {
    seq = 10
    const stored = [msg('user', [{ type: 'text', text: 'Build it' }])]
    let view = initialRunView('run_1')
    const assistantTurn = msg('assistant', [
      { type: 'tool_use', id: 't9', name: 'pieces_buildFromSpec', input: { id: 'p_1' } },
    ])
    for (const e of [
      { type: 'run.started', runId: 'run_1', seq: 1, run: run() },
      { type: 'message.completed', runId: 'run_1', seq: 2, message: assistantTurn },
      {
        type: 'tool.awaiting',
        runId: 'run_1',
        seq: 3,
        toolCallId: 't9',
        name: 'pieces.buildFromSpec',
        input: { id: 'p_1' },
        summary: 'Build the CAD from the saved spec.',
        estimate: null,
      },
      { type: 'text.delta', runId: 'run_1', seq: 4, index: 0, text: 'Waiting for ' },
      { type: 'text.delta', runId: 'run_1', seq: 5, index: 0, text: 'you.' },
      // A duplicate from a reconnect changes nothing.
      { type: 'text.delta', runId: 'run_1', seq: 5, index: 0, text: 'you.' },
    ] as const)
      view = reduceRun(view, e as never)
    const items = conversationItems([...stored, assistantTurn], view)
    expect(items.map((i) => i.kind)).toEqual(['user', 'calls', 'text'])
    const call = items[1]!.kind === 'calls' ? items[1]!.calls[0]! : null
    expect(call).toMatchObject({
      status: 'awaiting',
      summary: 'Build the CAD from the saved spec.',
    })
    expect(items[2]).toMatchObject({ kind: 'text', text: 'Waiting for you.', live: true })
  })

  it('names tools from API names and counts tokens', () => {
    expect(commandOf('design_apply')).toBe('design.apply')
    expect(commandOf('viewport_capture')).toBe('viewport.capture')
    expect(tokenCount(950)).toBe('950')
    expect(tokenCount(12_400)).toBe('12k')
    expect(tokenCount(1_500)).toBe('1.5k')
  })
})

describe('Undo', () => {
  const change = (over: Partial<StoredChange>): StoredChange => ({
    id: 'c',
    seq: 1,
    pieceId: 'p_1',
    ops: [],
    inverse: [],
    label: 'x',
    at: '2026-11-24T10:00:00.000Z',
    actor: { type: 'agent', runId: 'run_1', toolCallId: 't1' },
    ...over,
  })

  it('reverts the call’s newest change that is not undone yet', () => {
    const a = change({ id: 'c1', seq: 1 })
    const b = change({
      id: 'c2',
      seq: 2,
      actor: { type: 'agent', runId: 'run_1', toolCallId: 't2' },
    })
    expect(changeOfCall([a, b], 'run_1', 't1')?.id).toBe('c1')
    const undo = change({ id: 'c3', seq: 3, actor: { type: 'user', id: 'u' }, reverts: ['c1'] })
    expect(changeOfCall([a, b, undo], 'run_1', 't1')).toBeNull()
    expect(changeOfCall([a], 'run_2', 't1')).toBeNull()
    expect(runHasLiveChanges([a, b, undo], 'run_1')).toBe(true)
    const undoB = change({ id: 'c4', seq: 4, actor: { type: 'user', id: 'u' }, reverts: ['c2'] })
    expect(runHasLiveChanges([a, b, undo, undoB], 'run_1')).toBe(false)
  })
})

describe('the composer’s Enter', () => {
  it('sends on Enter, never with Shift or while an input method composes', () => {
    expect(isSendKey({ key: 'Enter', shiftKey: false })).toBe(true)
    expect(isSendKey({ key: 'Enter', shiftKey: true })).toBe(false)
    expect(isSendKey({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false)
    expect(isSendKey({ key: 'Enter', shiftKey: false, keyCode: 229 })).toBe(false)
    expect(isSendKey({ key: 'a', shiftKey: false })).toBe(false)
  })
})

describe('the live CAD cache patch', () => {
  const piece = { id: 'p_1', version: 3, design: emptyDesign('ring') } as unknown as Piece
  const event = (version: number, ops: unknown[]) => ({
    type: 'design.changed' as const,
    pieceId: 'p_1',
    version,
    change: {
      id: 'c',
      seq: version,
      pieceId: 'p_1',
      ops,
      inverse: [],
      label: 'x',
      at: '',
      actor: { type: 'system' as const },
    } as never,
  })

  it('applies exactly the next version, refetches on a gap or a bad op', () => {
    const next = patchPiece(piece, event(4, [{ t: 'setKind', kind: 'pendant' }]))
    expect(next).not.toBe('refetch')
    expect(next).toMatchObject({ version: 4, design: { kind: 'pendant' } })
    expect(patchPiece(piece, event(3, []))).toBe('unchanged')
    expect(patchPiece(piece, event(6, []))).toBe('refetch')
    expect(patchPiece(piece, event(4, [{ t: 'remove', id: 'nope' }]))).toBe('refetch')
  })
})

describe('jobs on the piece', () => {
  const job = (over: Partial<AiJob> = {}): AiJob => ({
    stage: 'cad',
    goal: 'Build it',
    plan: [
      { id: 'a', label: 'Read', state: 'done' },
      { id: 'b', label: 'Build', state: 'running' },
      { id: 'c', label: 'Check', state: 'pending' },
    ],
    continues: null,
    review: null,
    pausedBy: null,
    ...over,
  })

  it('reads the state from the run and the review', () => {
    expect(jobState(run({ job: job() }))).toBe('running')
    expect(jobState(run({ status: 'awaiting-approval', job: job() }))).toBe('waiting')
    expect(jobState(run({ status: 'paused', job: job({ pausedBy: 'edit' }) }))).toBe('paused')
    expect(jobState(run({ status: 'done', job: job({ review: 'pending' }) }))).toBe('review')
    expect(jobState(run({ status: 'done', job: job({ review: 'accepted' }) }))).toBe('accepted')
    expect(jobState(run({ status: 'canceled', job: job() }))).toBe('stopped')
  })

  it('says where the plan stands and finds the newest job of a stage', () => {
    expect(planProgress(job())).toMatchObject({ finished: 1, total: 3, current: { id: 'b' } })
    const runs = [run({ id: 'r3' }), run({ id: 'r2', job: job() }), run({ id: 'r1', job: job() })]
    expect(latestJob(runs, 'cad')?.id).toBe('r2')
    expect(latestJob(runs, 'render')).toBeNull()
    expect(elapsed(65_000)).toBe('1:05')
    expect(elapsed(3_725_000)).toBe('1:02:05')
  })
})

describe('markdown', () => {
  it('parses blocks and keeps HTML as text', () => {
    const blocks = parseBlocks('# Title\n\nA **bold** line\n\n- one\n- two\n\n```\ncode\n```')
    expect(blocks.map((b) => b.t)).toEqual(['h', 'p', 'ul', 'code'])
    const nodes = inline('<img src=x onerror=alert(1)> and [x](javascript:alert(1))')
    // Text stays text; a javascript: link is not a link.
    expect(nodes[0]).toBe('<img src=x onerror=alert(1)> and ')
    expect(nodes[1]).toBe('x')
  })
})

describe('pinned pictures in a designer’s message', () => {
  it('are hidden from the conversation with their labels', () => {
    const blocks = [
      { type: 'text', text: '[Pinned reference 1: “Posy ring” (ref_1)]' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } },
      { type: 'text', text: 'Make it like this' },
    ]
    expect(ownBlocks(blocks).map((b) => b.type)).toEqual(['image', 'text'])
  })
})
