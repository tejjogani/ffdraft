/** The small pure pieces: run reducer, feedback, result shaping, chips and the scripted model. */
import type { Message, Run, RunEvent, StoredChange } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { describeCall, TOOL_CHIPS } from './describe'
import { initialRunView, reduceRun, replayRun } from './events'
import { detectFeedback } from './feedback'
import { advanceJob, newJob } from './jobs'
import { ScriptAbortError, scriptedModel } from './model'
import { evaluationNote, MAX_RESULT_CHARS, shapeResult } from './shape'
import { AGENT_TOOLS } from './tools'

const run = (status: Run['status']): Run => ({
  id: 'run_1',
  threadId: 'th_1',
  pieceId: null,
  userId: 'u_1',
  model: 'claude-opus-5-5',
  tier: 'standard',
  origin: 'studio',
  status,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  costUsd: 0,
  startedAt: '2026-11-24T10:00:00.000Z',
  endedAt: null,
  error: null,
  errorCode: null,
  job: null,
})

const message = (id: string, role: Message['role']): Message => ({
  id,
  threadId: 'th_1',
  seq: 1,
  role,
  content: [{ type: 'text', text: 'Hello' }],
  runId: 'run_1',
  createdAt: '2026-11-24T10:00:01.000Z',
})

describe('reduceRun', () => {
  it('follows an AI job’s plan as it moves', () => {
    const job = newJob('cad')
    const started = reduceRun(initialRunView('run_1'), {
      type: 'run.started',
      runId: 'run_1',
      seq: 1,
      run: { ...run('running'), job },
    })
    expect(started.job).toEqual(job)
    const moved = advanceJob(job, 'design.apply')!
    const s = reduceRun(started, { type: 'job.updated', runId: 'run_1', seq: 2, job: moved })
    expect(s.job?.plan[2]?.state).toBe('running')
    expect(s.run?.job).toEqual(moved)
  })

  const events: RunEvent[] = [
    { type: 'run.started', runId: 'run_1', seq: 1, run: run('running') },
    { type: 'thinking.delta', runId: 'run_1', seq: 2, index: 0, text: 'Plan' },
    { type: 'text.delta', runId: 'run_1', seq: 3, index: 1, text: 'Hel' },
    { type: 'text.delta', runId: 'run_1', seq: 4, index: 1, text: 'lo' },
    { type: 'message.completed', runId: 'run_1', seq: 5, message: message('m_1', 'assistant') },
    {
      type: 'tool.started',
      runId: 'run_1',
      seq: 6,
      toolCallId: 'toolu_1',
      name: 'design.apply',
      input: {},
    },
    {
      type: 'tool.finished',
      runId: 'run_1',
      seq: 7,
      toolCallId: 'toolu_1',
      name: 'design.apply',
      isError: false,
      changeIds: ['chg_toolu_1'],
      assetIds: [],
    },
    {
      type: 'usage',
      runId: 'run_1',
      seq: 8,
      tokens: { input: 10, output: 5, cacheRead: 100, cacheWrite: 0 },
      costUsd: 0.01,
    },
    { type: 'run.finished', runId: 'run_1', seq: 9, run: run('done') },
  ]

  it('streams text, then replaces it with the stored message', () => {
    const mid = replayRun('run_1', events.slice(0, 4))
    expect(mid.live).toEqual([
      { kind: 'thinking', index: 0, text: 'Plan' },
      { kind: 'text', index: 1, text: 'Hello' },
    ])
    const end = replayRun('run_1', events)
    expect(end.live).toEqual([])
    expect(end.messages.map((m) => m.id)).toEqual(['m_1'])
    expect(end.tools.toolu_1).toMatchObject({ status: 'done', changeIds: ['chg_toolu_1'] })
    expect(end).toMatchObject({ finished: true, costUsd: 0.01, seq: 9 })
  })

  it('ignores duplicates and other runs, so a resumed stream gives the same state', () => {
    const doubled = [...events.slice(0, 6), ...events.slice(2, 9)]
    expect(replayRun('run_1', doubled)).toEqual(replayRun('run_1', events))
    const s = initialRunView('run_1')
    expect(reduceRun(s, { ...events[2]!, runId: 'run_2' } as RunEvent)).toBe(s)
  })

  it('shows an approval that arrives without its start (stream resumed after a restart)', () => {
    const s = reduceRun(initialRunView('run_1'), {
      type: 'tool.awaiting',
      runId: 'run_1',
      seq: 12,
      toolCallId: 'toolu_2',
      name: 'pieces.buildFromSpec',
      input: { id: 'pc_1' },
      summary: 'Build the design from the spec.',
      estimate: null,
    })
    expect(s.tools.toolu_2).toMatchObject({
      status: 'awaiting',
      summary: 'Build the design from the spec.',
    })
    expect(s.toolOrder).toEqual(['toolu_2'])
  })
})

describe('detectFeedback', () => {
  const change = (
    id: string,
    seq: number,
    actor: StoredChange['actor'],
    ops: StoredChange['ops'],
    reverts?: string[],
  ): StoredChange => ({
    id,
    seq,
    pieceId: 'pc_1',
    actor,
    ops,
    inverse: [],
    label: id,
    at: '2026-11-24T10:00:00.000Z',
    ...(reverts ? { reverts } : {}),
  })
  const agent = change('chg_a', 1, { type: 'agent', runId: 'run_1' }, [
    { t: 'update', id: 'band', patch: { widthTop: 2.4 } },
    { t: 'add', node: { id: 'row', kind: 'gemRow', host: 'band' } },
  ])
  const person = { type: 'user' as const, id: 'u_1' }

  it('finds corrections and removals by people, once each', () => {
    const later = [
      change('chg_b', 2, person, [
        { t: 'update', id: 'band', patch: { widthTop: 2.1, profile: 'flat' } },
      ]),
      change('chg_c', 3, person, [{ t: 'update', id: 'band', patch: { widthTop: 2.0 } }]),
      change('chg_d', 4, person, [{ t: 'remove', id: 'row' }]),
    ]
    expect(detectFeedback(agent, later).map((f) => [f.kind, f.byChangeId])).toEqual([
      ['corrected', 'chg_b'],
      ['removed', 'chg_d'],
    ])
  })

  it('ignores other agents, exact undos and changes outside the window', () => {
    const later = [
      change('chg_b', 2, { type: 'agent', runId: 'run_2' }, [{ t: 'remove', id: 'row' }]),
      change('chg_c', 3, person, [{ t: 'remove', id: 'row' }], ['chg_a']),
      ...Array.from({ length: 10 }, (_, i) =>
        change(`chg_x${i}`, 4 + i, person, [{ t: 'update', id: 'other', patch: { a: 1 } }]),
      ),
      change('chg_late', 20, person, [{ t: 'update', id: 'band', patch: { widthTop: 3 } }]),
    ]
    expect(detectFeedback(agent, later)).toEqual([])
    expect(detectFeedback({ ...agent, actor: person }, later)).toEqual([])
  })
})

describe('shapeResult', () => {
  it('drops stored inverses, attaches images and notes, and cuts runaway output', () => {
    const r = shapeResult({
      toolUseId: 'toolu_1',
      output: { version: 8, change: { id: 'chg_1', ops: [], inverse: [{ t: 'remove', id: 'x' }] } },
      images: [{ label: 'front, clay', mediaType: 'image/png', data: 'iVBORw0KGgo=' }],
      notes: [
        evaluationNote({
          metalMassG: 3.214,
          caratTotal: 1.02,
          stoneCount: 1,
          boundsMm: { x: 20.1, y: 6.5, z: 24.33 },
          diagnostics: [
            {
              level: 'warning',
              code: 'culet.low',
              message: 'Culet near the finger',
              nodeId: 'center',
            },
          ],
        }),
      ],
    })
    const content = r.content as { type: string; text?: string }[]
    expect(content[0]!.text).toBe('{"version":8,"change":{"id":"chg_1","ops":[]}}')
    expect(content.map((c) => c.type)).toEqual(['text', 'text', 'image', 'text'])
    expect(content[3]!.text).toContain('metal 3.21 g; 1 stones, 1.02 ct')
    expect(content[3]!.text).toContain('warning culet.low [center]')
    const big = shapeResult({ toolUseId: 't', output: 'x'.repeat(MAX_RESULT_CHARS * 2) })
    const text = (big.content as { text: string }[])[0]!.text
    expect(text.length).toBeLessThan(MAX_RESULT_CHARS + 200)
    expect(text).toMatch(/cut: \d+ more characters/)
  })
})

describe('chips', () => {
  it('has words for every tool, past tense from the input where it says more', () => {
    expect(Object.keys(TOOL_CHIPS).sort()).toEqual([...AGENT_TOOLS].sort())
    expect(describeCall('design.apply', null, 'running')).toEqual({
      text: 'Editing the design',
      quiet: false,
    })
    expect(
      describeCall(
        'design.apply',
        { pieceId: 'pc_1', label: 'Widened the band to 2.4 mm', ops: [{ t: 'remove', id: 'x' }] },
        'done',
      ).text,
    ).toBe('Widened the band to 2.4 mm')
    expect(describeCall('pieces.get', { id: 'pc_1' }, 'done')).toEqual({
      text: 'Read the piece',
      quiet: true,
    })
    expect(
      describeCall(
        'viewport.capture',
        { pieceId: 'pc_1', views: ['front', 'side'], mode: 'clay', size: 768 },
        'done',
      ).text,
    ).toBe('Looked from front, side')
  })
})

describe('scriptedModel', () => {
  it('plays turns with SDK-shaped events and records each request', async () => {
    const model = scriptedModel([
      {
        content: [
          { type: 'text', text: 'Hi' },
          { type: 'tool_use', name: 'pieces_get', input: { id: 'p' } },
        ],
      },
      { content: [{ type: 'text', text: 'Done' }] },
    ])
    const s1 = model.stream(
      { model: 'claude-opus-5-5', max_tokens: 10, messages: [{ role: 'user', content: 'a' }] },
      {},
    )
    const types: string[] = []
    for await (const e of s1) types.push(e.type)
    const m1 = await s1.finalMessage()
    expect(types[0]).toBe('message_start')
    expect(types.at(-1)).toBe('message_stop')
    expect(m1.stop_reason).toBe('tool_use')
    // finalMessage alone drains the stream.
    const m2 = await model
      .stream(
        { model: 'claude-opus-5-5', max_tokens: 10, messages: [{ role: 'user', content: 'b' }] },
        {},
      )
      .finalMessage()
    expect(m2.stop_reason).toBe('end_turn')
    expect(model.requests.map((r) => r.messages[0]!.content)).toEqual(['a', 'b'])
    expect(model.remaining).toBe(0)
    await expect(
      model.stream({ model: 'm', max_tokens: 1, messages: [] }, {}).finalMessage(),
    ).rejects.toThrow(/no turn left/)
  })

  it('fails like the real stream: thrown errors, a drop mid-answer, an abort', async () => {
    const boom = new Error('boom')
    const model = scriptedModel([
      { content: [], error: boom },
      { content: [{ type: 'text', text: 'partial' }], failAfterContent: new Error('dropped') },
      { content: [{ type: 'text', text: 'never' }] },
    ])
    const p = { model: 'claude-opus-5-5', max_tokens: 10, messages: [] }
    await expect(model.stream(p, {}).finalMessage()).rejects.toBe(boom)
    const s = model.stream(p, {})
    const seen: string[] = []
    await expect(
      (async () => {
        for await (const e of s) seen.push(e.type)
      })(),
    ).rejects.toThrow('dropped')
    expect(seen).toContain('content_block_delta')
    await expect(s.finalMessage()).rejects.toThrow('dropped')
    const c = new AbortController()
    c.abort()
    await expect(model.stream(p, { signal: c.signal }).finalMessage()).rejects.toBeInstanceOf(
      ScriptAbortError,
    )
  })
})
