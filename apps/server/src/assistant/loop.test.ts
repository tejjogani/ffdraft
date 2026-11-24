/**
 * The run loop end to end, on a real in-memory server with a scripted model: the designer's
 * journeys (a brief to a built and edited piece, approvals, stopping), the ways a run ends, the
 * ledger, and the request staying append-only.
 */
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { ScriptAbortError } from '@pave/agent'
import { type RunEvent, TEMPLATES } from '@pave/schema'
import { and, eq } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as t from '../db/schema'
import { BOOT_TIMEOUT, type Client, client } from '../test/harness'
import { createAssistant } from './index'
import {
  type AssistantServer,
  assistantServer,
  settled,
  type TestModel,
  text,
  tool,
} from './testing'

const KEY = 'sk-ant-test-0000000000000000000000000000-KEYZ'
const halo = TEMPLATES.find((x) => x.id === 'halo')!.spec

let s: AssistantServer
let api: Client
let model: TestModel
let n = 0
const cm = () => `cm${++n}`

beforeAll(async () => {
  s = await assistantServer({ env: { ANTHROPIC_API_KEY: KEY } })
  api = client(s.server)
  model = s.model
}, BOOT_TIMEOUT)
afterAll(() => s.server.dispose())

async function send(textIn: string, extra: Record<string, unknown> = {}) {
  return api.call('threads.send', {
    text: textIn,
    clientId: 'w1',
    clientMessageId: cm(),
    ...extra,
  } as never)
}

async function finish(runId: string) {
  await settled(s.parts, runId)
  return api.call('traces.run', { id: runId })
}

async function ctx() {
  return s.server.runtime.context(s.server.runtime.local!)
}

/** Messages of a thread with the role and block types, for compact assertions. */
async function shape(threadId: string) {
  const { messages } = await api.call('threads.get', { id: threadId })
  return messages.map((m) => `${m.role}:${m.content.map((b) => b.type).join(',')}`)
}

function resultText(params: BetaMessageStreamParams, toolUseId: string): string {
  for (const m of params.messages)
    if (Array.isArray(m.content))
      for (const b of m.content as unknown as Record<string, unknown>[])
        if (b.type === 'tool_result' && b.tool_use_id === toolUseId)
          return (b.content as { type: string; text?: string }[])
            .map((c) => c.text ?? `[${c.type}]`)
            .join('\n')
  throw new Error(`no result for ${toolUseId}`)
}

/**
 * The rules the API holds a conversation to: it starts with the designer; a system message is
 * last or followed by an assistant turn; every tool call is answered in the next message.
 */
function expectValid(params: BetaMessageStreamParams) {
  const ms = params.messages as unknown as { role: string; content: Record<string, unknown>[] }[]
  expect(ms[0]!.role).toBe('user')
  ms.forEach((m, i) => {
    const next = ms[i + 1]
    if (m.role === 'system' && next) expect(next.role).toBe('assistant')
    if (m.role === 'assistant') {
      const calls = m.content.filter((b) => b.type === 'tool_use').map((b) => b.id)
      if (calls.length && next) {
        expect(next.role).toBe('user')
        const answered = next.content
          .filter((b) => b.type === 'tool_result')
          .map((b) => b.tool_use_id)
        expect(answered).toEqual(calls)
      }
    }
  })
}

/** Every request after the first extends the one before it: same prefix, byte for byte. */
function expectAppendOnly(requests: BetaMessageStreamParams[]) {
  for (const r of requests) expectValid(r)
  for (let i = 1; i < requests.length; i++) {
    const a = requests[i - 1]!
    const b = requests[i]!
    const frozen = (r: BetaMessageStreamParams) =>
      JSON.stringify({
        tools: r.tools,
        system: r.system,
        thinking: r.thinking,
        tool_choice: r.tool_choice,
      })
    expect(frozen(b)).toBe(frozen(a))
    expect(b.messages.length).toBeGreaterThan(a.messages.length)
    expect(JSON.stringify(b.messages.slice(0, a.messages.length))).toBe(JSON.stringify(a.messages))
  }
}

describe('a brief becomes a built, edited piece', () => {
  it('creates, specs, waits for approval, builds, edits, fixes a bad edit, and ends', async () => {
    const start = model.requests.length
    model.push(
      { content: [text('I will start a piece.'), tool('pieces_create', { title: 'Trophy ring' })] },
      ({ pieceId }) => ({
        content: [
          { type: 'thinking', thinking: 'A halo suits it.' },
          tool('pieces_setSpec', { id: pieceId, spec: halo }),
        ],
      }),
      ({ pieceId }) => ({ content: [tool('pieces_buildFromSpec', { id: pieceId })] }),
      ({ pieceId }) => ({
        content: [
          tool('design_apply', {
            pieceId,
            label: 'Name the centre stone',
            ops: [{ t: 'update', id: 'center', patch: { name: 'Centre' } }],
          }),
        ],
      }),
      ({ pieceId }) => ({
        content: [
          tool('design_apply', {
            pieceId,
            label: 'Remove a missing node',
            ops: [{ t: 'remove', id: 'no-such-node' }],
          }),
        ],
      }),
      ({ pieceId }) => ({
        content: [
          tool('design_apply', {
            pieceId,
            label: 'Rename the centre',
            ops: [{ t: 'update', id: 'center', patch: { name: 'Centre stone' } }],
          }),
        ],
      }),
      { content: [text('Built and named. Anything else?')] },
    )
    const { thread, run } = await send('A halo ring for a trophy', { tier: 'standard' })
    expect(run).toMatchObject({ status: 'running', tier: 'standard', model: 'claude-opus-5-5' })
    await settled(s.parts, run.id)

    // Paused at the build: the card waits for a person.
    let detail = await api.call('traces.run', { id: run.id })
    expect(detail.run.status).toBe('awaiting-approval')
    const waiting = detail.steps.find((x) => x.status === 'awaiting-approval')!
    expect(waiting).toMatchObject({ name: 'pieces.buildFromSpec', approval: { decision: null } })
    const pieceId = detail.run.pieceId!
    expect(pieceId).toBeTruthy()
    expect((await api.call('threads.get', { id: thread.id })).thread.context.pieceId).toBe(pieceId)

    // The spec's result carried the canon's numbers.
    const specCall = model.requests[start + 2]!
    const specStep = detail.steps.find((x) => x.name === 'pieces.setSpec')!
    expect(resultText(specCall, specStep.toolCallId!)).toMatch(/canon|Canon|mm/)

    await api.call('runs.decide', {
      runId: run.id,
      toolCallId: waiting.toolCallId!,
      decision: 'approve',
    })
    detail = await finish(run.id)
    expect(detail.run).toMatchObject({ status: 'done', error: null })
    expect(model.queue).toHaveLength(0)

    const byName = (name: string) => detail.steps.filter((x) => x.name === name)
    expect(byName('pieces.buildFromSpec')[0]).toMatchObject({
      status: 'done',
      approval: { decision: 'approve' },
    })
    const applies = byName('design.apply')
    expect(applies.map((a) => a.isError)).toEqual([false, true, false])
    expect(applies[0]!.changeIds).toEqual([`chg_${run.id}_${applies[0]!.toolCallId}`])

    // Every change is the run's, attributed to its tool call.
    const history = await api.call('design.history', { pieceId })
    expect(history.map((c) => c.label)).toEqual([
      'Rename the centre',
      'Name the centre stone',
      'Build from spec',
    ])
    for (const c of history) expect(c.actor).toMatchObject({ type: 'agent', runId: run.id })

    // The failed edit came back as an error the model could read, and it fixed it.
    const fixCall = model.requests[start + 5]!
    expect(resultText(fixCall, applies[1]!.toolCallId!)).toMatch(/no-such-node/)

    expect(await shape(thread.id)).toEqual([
      'user:text',
      'system:text',
      'assistant:text,tool_use',
      'user:tool_result',
      'assistant:thinking,tool_use',
      'user:tool_result',
      'assistant:tool_use',
      'user:tool_result',
      'assistant:tool_use',
      'user:tool_result',
      'assistant:tool_use',
      'user:tool_result',
      'assistant:tool_use',
      'user:tool_result',
      'assistant:text',
    ])
    expectAppendOnly(model.requests.slice(start))

    // The whole run reverts as one change.
    const undo = await api.call('design.revert', { pieceId, runId: run.id })
    expect(undo.change.reverts).toHaveLength(3)
  })
})

describe('approvals', () => {
  it('a denial reaches the model with the note, and nothing is built', async () => {
    const piece = await api.call('pieces.create', { title: 'Deny me', spec: halo })
    const before = piece.version
    model.push(
      { content: [tool('pieces_buildFromSpec', { id: piece.id })] },
      { content: [text('Understood, I will not build it.')] },
    )
    const { run } = await send('Build it', { context: { pieceId: piece.id, selection: [] } })
    await settled(s.parts, run.id)
    const waiting = (await api.call('traces.run', { id: run.id })).steps.find(
      (x) => x.status === 'awaiting-approval',
    )!
    await api.call('runs.decide', {
      runId: run.id,
      toolCallId: waiting.toolCallId!,
      decision: 'deny',
      note: 'Not yet, change the band first',
    })
    const detail = await finish(run.id)
    expect(detail.run.status).toBe('done')
    expect(detail.steps.find((x) => x.toolCallId === waiting.toolCallId)!.status).toBe('denied')
    const last = model.requests.at(-1)!
    expect(resultText(last, waiting.toolCallId!)).toMatch(
      /declined.*Not yet, change the band first/s,
    )
    expect((await api.call('pieces.get', { id: piece.id })).version).toBe(before)
  })

  it('a run waiting for approval resumes from a fresh driver (a restart), and a running one fails as interrupted', async () => {
    const piece = await api.call('pieces.create', { title: 'Resume me', spec: halo })
    model.push(
      { content: [tool('pieces_buildFromSpec', { id: piece.id })] },
      { content: [text('Built after the restart.')] },
    )
    const { run } = await send('Build it', { context: { pieceId: piece.id, selection: [] } })
    await settled(s.parts, run.id)
    const waiting = (await api.call('traces.run', { id: run.id })).steps.find(
      (x) => x.status === 'awaiting-approval',
    )!

    // A new assistant on the same database stands in for the restarted server.
    const fresh = createAssistant(s.server.runtime, {
      env: { ANTHROPIC_API_KEY: KEY },
      model: model.factory,
    })
    s.server.runtime.services.register('assistantSetup', fresh.services.assistantSetup)
    await fresh.services.assistantSetup.ready!()
    await api.call('runs.decide', {
      runId: run.id,
      toolCallId: waiting.toolCallId!,
      decision: 'approve',
    })
    await settled(fresh, run.id)
    const detail = await api.call('traces.run', { id: run.id })
    expect(detail.run.status).toBe('done')
    expect((await api.call('pieces.get', { id: piece.id })).version).toBe(piece.version + 1)

    // A run left `running` by a crash, with a tool call unanswered, is failed and closed at boot.
    const c = await ctx()
    const thread = (await api.call('threads.get', { id: detail.run.threadId! })).thread
    const stuck = await s.server.runtime.invoke('threads.list', {}, c)
    expect(stuck.length).toBeGreaterThan(0)
    const crashed = await import('../traces').then(async (tr) => {
      const r = await tr.startRun(c, {
        model: 'claude-opus-5-5',
        tier: 'standard',
        threadId: thread.id,
      })
      await tr.addMessage(c, {
        threadId: thread.id,
        runId: r.id,
        role: 'user',
        content: [{ type: 'text', text: 'go' }],
      })
      await tr.addMessage(c, {
        threadId: thread.id,
        runId: r.id,
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_crash', name: 'pieces_list', input: {} }],
      })
      return r
    })
    const assistant = s.server.runtime.services.get('assistant')
    await assistant.resume!(crashed, {
      orgId: c.orgId,
      userId: c.user.id,
    } as never)
    const after = await api.call('traces.run', { id: crashed.id })
    expect(after.run).toMatchObject({ status: 'failed', errorCode: 'interrupted' })
    expect((await shape(thread.id)).at(-1)).toBe('user:tool_result')
    s.server.runtime.services.register('assistantSetup', s.parts.services.assistantSetup)
    await s.parts.services.assistantSetup.ready!()
    await fresh.services.assistantSetup.dispose!()
  })
})

describe('stopping a run', () => {
  it('while the model is answering: nothing half-written is kept', async () => {
    model.push(
      ({ signal }) =>
        new Promise((_, reject) =>
          signal?.addEventListener('abort', () => reject(new ScriptAbortError())),
        ),
    )
    const { run, thread } = await send('Think for a long time')
    await new Promise((r) => setTimeout(r, 50))
    const canceled = await api.call('runs.cancel', { runId: run.id })
    expect(canceled.status).toBe('canceled')
    expect(await shape(thread.id)).toEqual(['user:text', 'system:text'])
  })

  it('while a client tool runs: the call is closed as not run', async () => {
    const c = await ctx()
    const piece = await api.call('pieces.create', { title: 'Look at me' })
    // A window that is open but never answers.
    const off = c.events.subscribe(c.orgId, () => {}, { userId: c.user.id, clientId: 'w1' })
    model.push({
      content: [tool('viewport_capture', { pieceId: piece.id, views: ['front'] })],
    })
    const { run, thread } = await send('Look at it', {
      context: { pieceId: piece.id, selection: [] },
    })
    await new Promise((r) => setTimeout(r, 100))
    const canceled = await api.call('runs.cancel', { runId: run.id })
    off()
    expect(canceled.status).toBe('canceled')
    const detail = await api.call('traces.run', { id: run.id })
    expect(detail.steps.find((x) => x.name === 'viewport.capture')!.status).toBe('canceled')
    const { messages } = await api.call('threads.get', { id: thread.id })
    expect(JSON.stringify(messages.at(-1)!.content)).toMatch(/Not run/)
  })

  it('while waiting for approval: the waiting call is closed and the run ends', async () => {
    const piece = await api.call('pieces.create', { title: 'Cancel me', spec: halo })
    model.push({ content: [tool('pieces_buildFromSpec', { id: piece.id })] })
    const { run, thread } = await send('Build', { context: { pieceId: piece.id, selection: [] } })
    await settled(s.parts, run.id)
    expect((await api.call('traces.run', { id: run.id })).run.status).toBe('awaiting-approval')
    const canceled = await api.call('runs.cancel', { runId: run.id })
    expect(canceled.status).toBe('canceled')
    expect((await shape(thread.id)).at(-1)).toBe('user:tool_result')
    const step = (await api.call('traces.run', { id: run.id })).steps.find(
      (x) => x.name === 'pieces.buildFromSpec',
    )!
    expect(step.status).toBe('canceled')
  })

  it('a new message declines the approval still waiting in the thread', async () => {
    const piece = await api.call('pieces.create', { title: 'Supersede', spec: halo })
    model.push({ content: [tool('pieces_buildFromSpec', { id: piece.id })] })
    const first = await send('Build', { context: { pieceId: piece.id, selection: [] } })
    await settled(s.parts, first.run.id)
    model.push({ content: [text('OK, not building.')] })
    const second = await send('Actually wait', { threadId: first.thread.id })
    await settled(s.parts, second.run.id)
    expect((await api.call('traces.run', { id: first.run.id })).run.status).toBe('canceled')
    expect((await api.call('traces.run', { id: second.run.id })).run.status).toBe('done')
    expect(await shape(first.thread.id)).toEqual([
      'user:text',
      'system:text',
      'assistant:tool_use',
      'user:tool_result',
      'user:text',
      'system:text',
      'assistant:text',
    ])
    // The second run's request extends the first's conversation without touching it.
    expectAppendOnly(model.requests.slice(-2))
  })
})

describe('people and the assistant on one piece', () => {
  it('an edit by a person to the same feature wins; one elsewhere is only noted', async () => {
    const piece = await api.call('pieces.create', { title: 'Shared', spec: halo })
    await api.call('pieces.buildFromSpec', { id: piece.id })
    const nodes = (await api.call('pieces.get', { id: piece.id })).design.order
    const other = nodes.find((id) => id !== 'center')!
    model.push(
      async () => {
        // The designer renames the centre while the model is thinking.
        await api.call('design.apply', {
          pieceId: piece.id,
          label: 'Designer renames the centre',
          ops: [{ t: 'update', id: 'center', patch: { name: 'Mine' } }],
        })
        return {
          content: [
            tool('design_apply', {
              pieceId: piece.id,
              label: 'Assistant renames the centre',
              ops: [{ t: 'update', id: 'center', patch: { name: 'Theirs' } }],
            }),
          ],
        }
      },
      async () => {
        await api.call('design.apply', {
          pieceId: piece.id,
          label: 'Designer renames another part',
          ops: [{ t: 'update', id: other, patch: { name: 'Other' } }],
        })
        return {
          content: [
            tool('design_apply', {
              pieceId: piece.id,
              label: 'Assistant renames the centre again',
              ops: [{ t: 'update', id: 'center', patch: { name: 'Theirs' } }],
            }),
          ],
        }
      },
      { content: [text('Done.')] },
    )
    const { run } = await send('Rename the centre', {
      context: { pieceId: piece.id, selection: ['center'] },
    })
    const detail = await finish(run.id)
    const applies = detail.steps.filter((x) => x.name === 'design.apply')
    expect(applies.map((a) => a.isError)).toEqual([true, false])
    const reqs = model.requests.slice(-2)
    expect(resultText(reqs[0]!, applies[0]!.toolCallId!)).toMatch(
      /designer changed center.*Their edit wins/s,
    )
    expect(resultText(reqs[1]!, applies[1]!.toolCallId!)).toMatch(/also edited the piece/)
    expect((await api.call('pieces.get', { id: piece.id })).design.nodes.center).toMatchObject({
      name: 'Theirs',
    })
  })

  it('a person correcting the assistant’s edit soon after is recorded as feedback', async () => {
    const piece = await api.call('pieces.create', { title: 'Feedback', spec: halo })
    await api.call('pieces.buildFromSpec', { id: piece.id })
    model.push(
      {
        content: [
          tool('design_apply', {
            pieceId: piece.id,
            label: 'Name it',
            ops: [{ t: 'update', id: 'center', patch: { name: 'By AI' } }],
          }),
        ],
      },
      { content: [text('Named.')] },
    )
    const { run } = await send('Name the centre', { context: { pieceId: piece.id, selection: [] } })
    await finish(run.id)
    await api.call('design.apply', {
      pieceId: piece.id,
      label: 'My name',
      ops: [{ t: 'update', id: 'center', patch: { name: 'By me' } }],
    })
    await s.parts.feedback.idle()
    const { feedback } = await api.call('traces.run', { id: run.id })
    expect(feedback).toEqual([
      expect.objectContaining({
        source: 'implicit',
        kind: 'corrected',
        detail: expect.stringMatching(/center\.name/),
      }),
    ])
  })
})

describe('how a run can end', () => {
  it('a tool call cut off at max_tokens is never run; it is asked again once', async () => {
    const piece = await api.call('pieces.create', { title: 'Cut' })
    model.push(
      {
        content: [tool('pieces_update', { id: piece.id, title: 'Half' })],
        stop_reason: 'max_tokens',
      },
      { content: [text('Shorter this time.')] },
    )
    const { run } = await send('Rename it')
    const detail = await finish(run.id)
    expect(detail.run.status).toBe('done')
    expect(detail.steps.map((x) => x.kind)).toEqual(['model', 'model'])
    expect((await api.call('pieces.get', { id: piece.id })).title).toBe('Cut')

    model.push(
      {
        content: [tool('pieces_update', { id: piece.id, title: 'Half' })],
        stop_reason: 'max_tokens',
      },
      {
        content: [tool('pieces_update', { id: piece.id, title: 'Half' })],
        stop_reason: 'max_tokens',
      },
    )
    const twice = await finish((await send('Rename it again')).run.id)
    expect(twice.run).toMatchObject({ status: 'failed', errorCode: 'internal' })
  })

  it('a refusal ends the run without running or storing the turn', async () => {
    model.push({
      content: [text('I can’t'), tool('pieces_create', { title: 'Nope' })],
      stop_reason: 'refusal',
    })
    const { run, thread } = await send('Something declined')
    const detail = await finish(run.id)
    expect(detail.run).toMatchObject({ status: 'failed', errorCode: 'refusal' })
    expect(await shape(thread.id)).toEqual(['user:text', 'system:text'])

    // The next message in the thread still makes a valid conversation.
    model.push({ content: [text('Happy to help with that instead.')] })
    const next = await send('Something else', { threadId: thread.id })
    await finish(next.run.id)
    expect(await shape(thread.id)).toEqual([
      'user:text',
      'system:text',
      'assistant:text',
      'user:text',
      'system:text',
      'assistant:text',
    ])
    expectValid(model.requests.at(-1)!)
    expect(JSON.stringify(model.requests.at(-1)!.messages[2])).toMatch(
      /No answer to that message: Claude declined/,
    )
  })

  it('stops before a model call once the monthly budget is used up', async () => {
    await api.call('org.settings.update', { monthlyBudgetUsd: 0 })
    const before = model.requests.length
    const { run } = await send('Spend money')
    const detail = await finish(run.id)
    await api.call('org.settings.update', { monthlyBudgetUsd: null })
    expect(detail.run).toMatchObject({ status: 'failed', errorCode: 'budget_exceeded' })
    expect(model.requests.length).toBe(before)
  })

  it('pauses at the per-run cap of $3 and says how to go on', async () => {
    model.push({
      content: [tool('pieces_list', {})],
      // 800K uncached input tokens on Opus 5.5 is $3.20.
      usage: { input_tokens: 800_000, output_tokens: 10 },
    })
    const { run } = await send('Expensive')
    const detail = await finish(run.id)
    expect(detail.run).toMatchObject({ status: 'failed', errorCode: 'run_cap' })
    expect(detail.run.error).toMatch(/Paused at \$3\.\d\d.*Continue/)
  })

  it('maps a typed API error to the run’s error code', async () => {
    const { AuthenticationError } = await import('@anthropic-ai/sdk')
    model.push({
      content: [],
      error: new AuthenticationError(
        401,
        { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
        'invalid x-api-key',
        new Headers(),
      ),
    })
    const detail = await finish((await send('Hello')).run.id)
    expect(detail.run).toMatchObject({ status: 'failed', errorCode: 'provider_auth' })
    expect(detail.run.error).toMatch(/did not accept the API key/)
  })
})

describe('sending', () => {
  it('a retried send (same clientMessageId) stores the message once and returns the same run', async () => {
    model.push({ content: [text('Hi.')] })
    const input = { text: 'Hello once', clientId: 'w1', clientMessageId: cm() }
    const [a, b] = await Promise.all([
      api.call('threads.send', input),
      api.call('threads.send', input),
    ])
    const c = await api.call('threads.send', input)
    expect(new Set([a.run.id, b.run.id, c.run.id]).size).toBe(1)
    await settled(s.parts, a.run.id)
    expect(await shape(a.thread.id)).toEqual(['user:text', 'system:text', 'assistant:text'])
  })

  it('photos reach the model as image blocks, resized to a 1568 px long edge', async () => {
    const big = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 180, b: 40 } },
    })
      .jpeg()
      .toBuffer()
    const form = new FormData()
    form.set('file', new File([big], 'ring.jpg', { type: 'image/jpeg' }))
    const photo = (await (
      await api.request('/api/assets', { method: 'POST', body: form })
    ).json()) as { id: string }
    const note = new FormData()
    note.set(
      'file',
      new File([new TextEncoder().encode('hello')], 'note.txt', { type: 'text/plain' }),
    )
    const txt = (await (
      await api.request('/api/assets', { method: 'POST', body: note })
    ).json()) as { id: string }

    model.push({ content: [text('A yellow ring.')] })
    const { run, thread } = await send('Make this', { attachments: [photo.id, txt.id] })
    await settled(s.parts, run.id)
    const req = model.requests.at(-1)!
    const user = req.messages.at(-2)!
    const blocks = user.content as unknown as Record<string, unknown>[]
    expect(blocks.map((b) => b.type)).toEqual(['image', 'text'])
    const data = blocks[0]!.source as { data: string; media_type: string }
    expect(data.media_type).toBe('image/jpeg')
    const meta = await sharp(Buffer.from(data.data, 'base64')).metadata()
    expect([meta.width, meta.height]).toEqual([1568, 1045])
    const context = JSON.stringify(req.messages.at(-1)!.content)
    expect(context).toMatch(new RegExp(photo.id))
    expect(context).toMatch(/Not shown to you.*note\.txt/)
    // The studio's copy leaves the inline bytes out.
    const { messages } = await api.call('threads.get', { id: thread.id })
    expect((messages[0]!.content[0]!.source as { data: string }).data).toBe('')
  })
})

describe('the ledger', () => {
  it('records one row per model call, keyed by run and step, priced by the model that answered', async () => {
    model.push(
      { content: [tool('pieces_list', {})], usage: { input_tokens: 1000, output_tokens: 100 } },
      {
        content: [text('Done')],
        model: 'claude-sonnet-5-5',
        usage: { input_tokens: 1000, output_tokens: 100 },
      },
    )
    const { run } = await send('List my pieces')
    const detail = await finish(run.id)
    const c = await ctx()
    const rows = await c.repo.usage.many({ where: eq(t.usageEvent.runId, run.id) })
    const models = detail.steps.filter((x) => x.kind === 'model')
    expect(rows.map((r) => r.idempotencyKey).sort()).toEqual(
      models.map((m) => `${run.id}:${m.index}:llm`).sort(),
    )
    const cost = (r: (typeof rows)[number]) => r.costMicros / 1e6
    // Opus 5.5: 1000 × $4 + 100 × $20 per million; Sonnet 5.5: 1000 × $2 + 100 × $10.
    expect(rows.map((r) => [r.model, cost(r)]).sort()).toEqual(
      [
        ['claude-opus-5-5', 0.006],
        ['claude-sonnet-5-5', 0.003],
      ].sort(),
    )
    expect(detail.run.costUsd).toBeCloseTo(0.009, 6)
  })
})

describe('the run event stream', () => {
  it('streams a live run’s events in order, and answers 204 once nothing is live', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    model.push(async () => {
      await gate
      return { content: [text('Streaming answer here.')] }
    })
    const { run } = await send('Stream it')
    const res = await api.request(`/api/runs/${run.id}/events`)
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
    release()
    const body = await res.text()
    const events = body
      .split('\n\n')
      .filter((chunk) => chunk.includes('data: {'))
      .map(
        (chunk) =>
          JSON.parse(
            chunk
              .split('\n')
              .find((l) => l.startsWith('data: '))!
              .slice(6),
          ) as RunEvent,
      )
    expect(events[0]!.type).toBe('run.started')
    expect(events.at(-1)!.type).toBe('run.finished')
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1))
    expect(
      events
        .filter((e) => e.type === 'text.delta')
        .map((e) => (e as { text: string }).text)
        .join(''),
    ).toBe('Streaming answer here.')
    await settled(s.parts, run.id)
    // Caught up after the end, then nothing.
    const replay = await api.request(`/api/runs/${run.id}/events?after=${events.length}`)
    expect(replay.status).toBe(200)
    expect(await replay.text()).not.toMatch(/data: \{/)
    expect((await api.request('/api/runs/run_missing/events')).status).toBe(404)
  })
})

describe('tool steps are idempotent', () => {
  it('a step for a tool call is recorded once', async () => {
    const c = await ctx()
    const rows = await c.repo.steps.many({
      where: and(eq(t.agentStep.kind, 'tool')),
    })
    const keys = rows.map((r) => `${r.runId}:${r.toolCallId}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('the request prefix (property)', () => {
  /** A small seeded generator, so a failure can be replayed. */
  function rng(seed: number) {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let x = Math.imul(a ^ (a >>> 15), 1 | a)
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296
    }
  }

  it('stays append-only and byte-identical across random turns, messages and runs of a thread', async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = rng(seed)
      const start = model.requests.length
      let threadId: string | undefined
      const messages = 2 + Math.floor(r() * 2)
      for (let m = 0; m < messages; m++) {
        const turns = Math.floor(r() * 4)
        for (let i = 0; i < turns; i++) {
          const pick = r()
          model.push({
            content:
              pick < 0.4
                ? [tool('pieces_list', {})]
                : pick < 0.6
                  ? // Invalid input: answered with an error, nothing runs.
                    [tool('pieces_get', {})]
                  : pick < 0.8
                    ? [
                        { type: 'thinking', thinking: `step ${seed}.${m}.${i}` },
                        tool('collections_list', {}),
                      ]
                    : [text('Looking.'), tool('pieces_list', {}), tool('collections_list', {})],
          })
        }
        model.push({ content: [text(`Answer ${seed}.${m}`)] })
        const { run, thread } = await send(`Message ${seed}.${m}`, threadId ? { threadId } : {})
        threadId = thread.id
        const detail = await finish(run.id)
        expect(detail.run.status).toBe('done')
      }
      const requests = model.requests.slice(start)
      expect(requests.length).toBeGreaterThanOrEqual(messages)
      expectAppendOnly(requests)
    }
  })
})
