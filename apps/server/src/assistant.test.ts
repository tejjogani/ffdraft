/** The assistant's contract: commands routed to the runtime, the trace store, targeted events. */
import type { ServerEvent } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { type Ctx, invoke } from './context'
import { EventBus } from './events'
import { serviceContext } from './service-context'
import type { Services } from './services'
import {
  BOOT_TIMEOUT,
  type Client,
  client,
  joinOrg,
  signUp,
  type TestServer,
  testServer,
} from './test/harness'
import { traces } from './traces'

describe('EventBus', () => {
  it('delivers org events to everyone and targeted ones to a user, preferring their window', () => {
    const bus = new EventBus()
    const seen: string[] = []
    const on = (who: string) => (e: ServerEvent) => seen.push(`${who}:${e.type}`)
    bus.subscribe('o', on('server'))
    bus.subscribe('o', on('u1/a'), { userId: 'u1', clientId: 'a' })
    bus.subscribe('o', on('u1/b'), { userId: 'u1', clientId: 'b' })
    bus.subscribe('o', on('u2'), { userId: 'u2' })
    bus.subscribe('other', on('elsewhere'), { userId: 'u1' })
    const event: ServerEvent = { type: 'piece.updated', pieceId: 'p' }

    expect(bus.publish('o', event)).toBe(4)
    seen.length = 0
    expect(bus.publish('o', event, { userId: 'u1', clientId: 'b' })).toBe(1)
    expect(bus.publish('o', event, { userId: 'u1', clientId: 'gone' })).toBe(2)
    expect(bus.publish('o', event, { userId: 'u3' })).toBe(0)
    expect(seen).toEqual(['u1/b:piece.updated', 'u1/a:piece.updated', 'u1/b:piece.updated'])
    expect(bus.isConnected('o', { userId: 'u2' })).toBe(true)
    expect(bus.isConnected('o', { userId: 'u3' })).toBe(false)
  })
})

describe('assistant commands', () => {
  let server: TestServer
  let api: Client
  beforeAll(async () => {
    server = await testServer()
    api = client(server)
  }, BOOT_TIMEOUT)
  afterAll(() => server.dispose())

  it('answer 501 until the runtime is registered', async () => {
    const calls = [
      await api.fail('threads.send', { text: 'Hi', clientId: 'w1', clientMessageId: 'm1' }),
      await api.fail('client.respond', { requestId: 'q', output: {} }),
    ]
    expect(calls.map((c) => c.status)).toEqual([501, 501])
    expect((await api.call('session.get', {})).capabilities.assistant).toBe(false)
  })

  it('check every id before handing the message to the runtime', async () => {
    const send = vi.fn<Services['assistant']['send']>(async (input, sctx) => {
      const ctx = await server.runtime.context({ userId: sctx.userId, orgId: sctx.orgId })
      const thread = await traces.createThread(ctx, {
        title: input.text,
        pieceId: input.context.pieceId,
      })
      const run = await traces.startRun(ctx, { model: 'm', threadId: thread.id })
      return { thread, run }
    })
    const respond = vi.fn<Services['assistant']['respond']>(async () => {})
    server.runtime.services.register('assistant', {
      capabilities: { assistant: true },
      send,
      decide: async () => {
        throw new Error('unused')
      },
      cancel: async (runId, sctx) => {
        const ctx = await server.runtime.context({ userId: sctx.userId, orgId: sctx.orgId })
        return traces.finishRun(ctx, runId, { status: 'canceled' })
      },
      respond,
    })
    expect((await api.call('session.get', {})).capabilities.assistant).toBe(true)

    const piece = await api.call('pieces.create', {})
    const { thread, run } = await api.call('threads.send', {
      text: 'Make it heavier',
      context: { pieceId: piece.id, selection: ['band'] },
      clientId: 'w1',
      clientMessageId: 'm1',
    })
    expect(send.mock.calls[0]![0]).toMatchObject({
      text: 'Make it heavier',
      attachments: [],
      referenceIds: [],
      context: { pieceId: piece.id, selection: ['band'] },
    })
    expect(thread.context).toEqual({ pieceId: piece.id, boardId: null, sceneId: null })
    const bad = [
      await api.fail('threads.send', {
        text: 'x',
        clientId: 'w',
        clientMessageId: 'a',
        attachments: ['as_x'],
      }),
      await api.fail('threads.send', {
        text: 'x',
        clientId: 'w',
        clientMessageId: 'b',
        referenceIds: ['ref_x'],
      }),
      await api.fail('threads.send', {
        text: 'x',
        clientId: 'w',
        clientMessageId: 'c',
        context: { sceneId: 's' },
      }),
      await api.fail('threads.send', {
        text: 'x',
        clientId: 'w',
        clientMessageId: 'd',
        threadId: 'th_x',
      }),
    ]
    expect(bad.map((b) => b.status)).toEqual([404, 404, 404, 404])
    expect(send).toHaveBeenCalledOnce()

    expect((await api.call('threads.get', { id: thread.id })).run?.id).toBe(run.id)
    expect((await api.call('runs.cancel', { runId: run.id })).status).toBe('canceled')
    await api.call('client.respond', { requestId: 'q1', error: 'No viewport' })
    expect(respond).toHaveBeenCalledWith(
      { requestId: 'q1', error: 'No viewport' },
      expect.anything(),
    )

    const agent = await server.runtime.context({
      ...server.runtime.local!,
      actor: { type: 'agent', runId: run.id },
    })
    await expect(
      server.runtime.invoke(
        'runs.decide',
        { runId: run.id, toolCallId: 't', decision: 'approve' },
        agent,
      ),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('the trace store', () => {
  let server: TestServer
  let api: Client
  beforeAll(async () => {
    server = await testServer()
    api = client(server)
  }, BOOT_TIMEOUT)
  afterAll(() => server.dispose())

  it('numbers messages, stores a retried send once, and tracks tool steps through approval', async () => {
    const ctx = await server.runtime.context(server.runtime.local!)
    const thread = await traces.createThread(ctx, { title: 'T', promptHash: 'sha256:abc' })
    const run = await traces.startRun(ctx, { model: 'm', threadId: thread.id, origin: 'mcp' })
    expect(run).toMatchObject({ origin: 'mcp', errorCode: null })

    const first = await traces.addMessage(ctx, {
      threadId: thread.id,
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
      clientMessageId: 'cm1',
    })
    const again = await traces.addMessage(ctx, {
      threadId: thread.id,
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
      clientMessageId: 'cm1',
    })
    expect(again.id).toBe(first.id)
    await Promise.all(
      ['a', 'b', 'c'].map((text) =>
        traces.addMessage(ctx, {
          threadId: thread.id,
          runId: run.id,
          role: 'system',
          content: [{ type: 'text', text }],
        }),
      ),
    )
    const { messages } = await api.call('threads.get', { id: thread.id })
    expect(messages.map((m) => m.seq)).toEqual([1, 2, 3, 4])
    expect(messages[1]!.role).toBe('system')

    const step = await traces.beginStep(ctx, run.id, {
      index: 1,
      kind: 'tool',
      name: 'pieces.buildFromSpec',
      toolCallId: 'toolu_1',
      input: { id: 'p' },
      awaitingApproval: true,
    })
    expect(step).toMatchObject({ status: 'awaiting-approval', approval: { decision: null } })
    const resumed = await traces.beginStep(ctx, run.id, {
      index: 1,
      kind: 'tool',
      name: 'pieces.buildFromSpec',
      toolCallId: 'toolu_1',
      input: { id: 'p' },
    })
    expect(resumed.id).toBe(step.id)
    await expect(
      traces.beginStep(ctx, run.id, {
        index: 1,
        kind: 'tool',
        name: 'x',
        toolCallId: 'toolu_2',
        input: {},
      }),
    ).rejects.toMatchObject({ status: 409 })

    const decided = await traces.decideStep(ctx, run.id, 'toolu_1', {
      decision: 'approve',
      note: 'go',
    })
    expect(decided).toMatchObject({
      status: 'running',
      approval: { decision: 'approve', note: 'go' },
    })
    await expect(
      traces.decideStep(ctx, run.id, 'toolu_1', { decision: 'deny' }),
    ).rejects.toMatchObject({
      status: 409,
    })
    const done = await traces.completeStep(ctx, run.id, 'toolu_1', {
      output: { version: 1 },
      ms: 12.4,
      changeIds: ['chg_1'],
    })
    expect(done).toMatchObject({
      status: 'done',
      ms: 12,
      changeIds: ['chg_1'],
      toolCallId: 'toolu_1',
    })
    await traces.addStep(ctx, run.id, {
      index: 0,
      kind: 'model',
      name: 'claude',
      input: {},
      output: {},
      ms: 900,
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, costUsd: 0.01 },
      stopReason: 'tool_use',
    })

    const usage = { tokens: { input: 100, output: 20, cacheRead: 5, cacheWrite: 1 }, costUsd: 0.25 }
    await Promise.all([traces.addUsage(ctx, run.id, usage), traces.addUsage(ctx, run.id, usage)])
    await traces.finishRun(ctx, run.id, {
      status: 'failed',
      error: 'Budget reached',
      errorCode: 'budget_exceeded',
    })
    await api.call('traces.feedback', { runId: run.id, rating: 'down', note: 'Too heavy' })

    const detail = await api.call('traces.run', { id: run.id })
    expect(detail.run).toMatchObject({
      tokens: { input: 200, output: 40, cacheRead: 10, cacheWrite: 2 },
      costUsd: 0.5,
      errorCode: 'budget_exceeded',
    })
    expect(detail.steps.map((s) => [s.index, s.kind, s.status])).toEqual([
      [0, 'model', 'done'],
      [1, 'tool', 'done'],
    ])
    expect(detail.steps[0]).toMatchObject({ stopReason: 'tool_use', usage: { costUsd: 0.01 } })
    expect(detail.feedback).toEqual([
      expect.objectContaining({
        source: 'explicit',
        kind: 'down',
        detail: 'Too heavy',
        changeId: null,
      }),
    ])
  })

  it('keeps a run’s status machine: resumed after approval, sticky once ended', async () => {
    const ctx = await server.runtime.context(server.runtime.local!)
    const run = await traces.startRun(ctx, { model: 'm' })
    await traces.beginStep(ctx, run.id, {
      index: 0,
      kind: 'tool',
      name: 'pieces.delete',
      toolCallId: 'toolu_a',
      input: {},
      awaitingApproval: true,
    })
    expect((await traces.finishRun(ctx, run.id, { status: 'awaiting-approval' })).status).toBe(
      'awaiting-approval',
    )
    // An undecided call cannot be completed.
    await expect(
      traces.completeStep(ctx, run.id, 'toolu_a', { output: {}, ms: 1 }),
    ).rejects.toMatchObject({ status: 409 })
    await traces.decideStep(ctx, run.id, 'toolu_a', { decision: 'approve' })
    expect((await api.call('traces.run', { id: run.id })).run.status).toBe('running')
    await traces.completeStep(ctx, run.id, 'toolu_a', { output: { ok: true }, ms: 3 })

    // A cancel racing the loop's own finish: the first terminal status stays.
    expect((await traces.finishRun(ctx, run.id, { status: 'canceled' })).status).toBe('canceled')
    const late = await traces.finishRun(ctx, run.id, { status: 'done' })
    expect([late.status, (await traces.resumeRun(ctx, run.id)).status]).toEqual([
      'canceled',
      'canceled',
    ])
  })

  it('runs nested commands as the actor of a derived context', async () => {
    const user = await server.runtime.context(server.runtime.local!)
    const agent: Ctx = { ...user, actor: { type: 'agent', runId: 'run_n', toolCallId: 'tc_n' } }
    const piece = await invoke(user, 'pieces.create', {
      kind: 'pendant',
      origin: { kind: 'image', sourceAssetIds: [], referenceIds: [] },
    })
    const { change } = await serviceContext(agent).invoke('design.apply', {
      pieceId: piece.id,
      label: 'Ring',
      ops: [{ t: 'setKind', kind: 'ring' }],
    })
    expect(change.actor).toEqual({ type: 'agent', runId: 'run_n', toolCallId: 'tc_n' })
    const job = await invoke(agent, 'renders.create', { pieceId: piece.id, scene: {} })
    expect(job.actor.type).toBe('agent')
    // A derived agent context is refused what only a person may do, however it is reached.
    await expect(
      serviceContext(agent).invoke('pieces.attest', { id: piece.id, rights: 'own' }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('lets services run commands as the caller and wait for jobs to settle', async () => {
    const ctx = await server.runtime.context(server.runtime.local!)
    const sctx = serviceContext(ctx)
    const piece = await sctx.invoke('pieces.create', { templateId: 'halo' })
    const job = await sctx.invoke('renders.create', {
      pieceId: piece.id,
      scene: {},
      purpose: 'reference',
    })
    const settled = sctx.jobSettled('render', job.id)
    await api.call('renders.complete', { id: job.id, error: 'no GPU' })
    expect(await settled).toBe('failed')
    expect(await sctx.jobSettled('render', job.id)).toBe('failed')

    const other = await sctx.invoke('renders.create', { pieceId: piece.id, scene: {} })
    const abort = new AbortController()
    const waiting = sctx.jobSettled('render', other.id, abort.signal)
    abort.abort(new Error('gave up'))
    await expect(waiting).rejects.toThrow('gave up')
    await expect(sctx.jobSettled('mesh3d', 'm3d_nope')).rejects.toMatchObject({ status: 404 })
    const audit = await ctx.repo.audit.many()
    expect(audit.some((a) => a.action === 'renders.create' && a.targetId === piece.id)).toBe(true)
  })
})

describe('privacy and presence', () => {
  let server: TestServer
  let ada: Client
  let ben: Client
  beforeAll(async () => {
    server = await testServer({ auth: 'accounts' })
    ada = await signUp(server, 'Ada', 'ada@example.com')
    ben = await signUp(server, 'Ben', 'ben@example.com')
  }, BOOT_TIMEOUT)
  afterAll(() => server.dispose())

  it('keeps conversations, runs and their traces to the person having them, within an org', async () => {
    const adaSession = await ada.call('session.get', {})
    const orgId = await joinOrg(server, ada, ben, 'ben@example.com', 'designer')
    const vic = await signUp(server, 'Vic', 'vic@example.com')
    await joinOrg(server, ada, vic, 'vic@example.com', 'admin')
    const benSession = await ben.call('session.get', {})
    expect(benSession.activeOrgId).toBe(orgId)

    const actx = await server.runtime.context({ userId: adaSession.user.id, orgId })
    const thread = await traces.createThread(actx, { title: 'Ada’s' })
    const run = await traces.startRun(actx, { model: 'm', threadId: thread.id })
    await traces.addStep(actx, run.id, {
      index: 0,
      kind: 'model',
      name: 'claude',
      input: { messages: [{ role: 'user', content: 'my secret brief' }] },
      output: { text: 'secret answer' },
      ms: 5,
    })
    expect((await ada.call('threads.list', {})).map((t) => t.id)).toEqual([thread.id])
    expect(await ben.call('threads.list', {})).toEqual([])
    expect((await ben.fail('threads.get', { id: thread.id })).status).toBe(404)
    expect((await ben.fail('threads.delete', { id: thread.id })).status).toBe(404)
    expect((await ben.fail('runs.cancel', { runId: run.id })).status).toBe(404)
    // The trace is the conversation: the same privacy, except for admins and owners.
    expect(await ben.call('traces.runs', {})).toEqual([])
    expect((await ben.fail('traces.run', { id: run.id })).status).toBe(404)
    expect((await ben.fail('traces.feedback', { runId: run.id, rating: 'up' })).status).toBe(404)
    expect((await vic.call('traces.runs', {})).map((r) => r.id)).toEqual([run.id])
    expect((await vic.call('traces.run', { id: run.id })).steps).toHaveLength(1)

    // Message ids come from each person's studio: the same id from two people is two messages.
    const bctx = await server.runtime.context({ userId: benSession.user.id, orgId })
    const bens = await traces.createThread(bctx, { title: 'Ben’s' })
    const content = (text: string) => [{ type: 'text' as const, text }]
    const a = await traces.addMessage(actx, {
      threadId: thread.id,
      role: 'user',
      content: content('my secret brief'),
      clientMessageId: 'm1',
    })
    const b = await traces.addMessage(bctx, {
      threadId: bens.id,
      role: 'user',
      content: content('hello'),
      clientMessageId: 'm1',
    })
    expect(b.id).not.toBe(a.id)
    expect(b).toMatchObject({ threadId: bens.id, content: content('hello') })
  })

  it('registers a studio window for targeted events on /api/events?client=', async () => {
    const { user, activeOrgId } = await ada.call('session.get', {})
    expect((await ada.request('/api/events?client=bad id!')).status).toBe(400)
    const abort = new AbortController()
    const res = await ada.request('/api/events?client=win-1', { signal: abort.signal })
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
    let text = ''
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) text += (await reader.read()).value ?? ''
    }
    await readUntil('event: ready')
    expect(
      server.runtime.events.isConnected(activeOrgId, { userId: user.id, clientId: 'win-1' }),
    ).toBe(true)
    const delivered = server.runtime.events.publish(
      activeOrgId,
      { type: 'client.request', requestId: 'q1', runId: null, tool: 'ui.context', input: {} },
      { userId: user.id, clientId: 'win-1' },
    )
    expect(delivered).toBe(1)
    await readUntil('event: client.request')
    abort.abort()
    await reader.cancel().catch(() => {})
  })
})
