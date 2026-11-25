/**
 * The assistant renders: a take is queued and the run waits for it with no model call open; the
 * finished take comes back as an image the model looks at; a re-render is one approval; variants
 * share a group; a Render job renders its plan's takes without asking and re-renders a shot at
 * most twice; stopping the run stops its takes; a take that went stale says so. The render
 * queue is a fake that settles takes when a test says, so nothing here needs Blender.
 */
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { RenderJob, Run, RunEvent } from '@pave/schema'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { JobHandle, RenderJobPatch, ServiceContext } from '../services'
import { BOOT_TIMEOUT, type Client, client } from '../test/harness'
import { type AssistantServer, assistantServer, settled, text, tool } from './testing'

const KEY = 'sk-ant-test-0000000000000000000000000000-KEYZ'

/** A render queue that keeps every take until the test finishes or fails it. */
class FakeQueue {
  readonly takes = new Map<
    string,
    { job: RenderJob; handle: JobHandle<RenderJobPatch>; sctx: ServiceContext }
  >()
  readonly canceled: string[] = []
  readonly service = {
    capabilities: { blender: true },
    submit: async (
      job: RenderJob,
      _piece: unknown,
      handle: JobHandle<RenderJobPatch>,
      sctx: ServiceContext,
    ) => {
      this.takes.set(job.id, { job, handle, sctx })
    },
    cancel: async (id: string) => {
      this.canceled.push(id)
    },
  }

  async finish(id: string, critique: RenderJob['critique'] = null) {
    const take = this.takes.get(id)!
    const png = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 240, g: 240, b: 236 } },
    })
      .png()
      .toBuffer()
    const asset = await take.sctx.putAsset({ bytes: png, name: 'take.png', kind: 'render' })
    await take.handle.update({
      status: 'done',
      progress: 1,
      assetIds: [asset.id],
      seconds: 42,
      device: 'CPU',
      critique,
    })
  }
}

let s: AssistantServer
let api: Client
let queue: FakeQueue
let n = 0
const cm = () => `cm${++n}`
const events: RunEvent[] = []

beforeAll(async () => {
  // Pro: these tests queue more takes than a Free month allows; plans.test.ts covers the limit.
  s = await assistantServer({ env: { ANTHROPIC_API_KEY: KEY }, config: { plan: 'pro' } })
  api = client(s.server)
  queue = new FakeQueue()
  s.server.runtime.services.register('renderQueue', queue.service)
  const emit = s.parts.driver.emit.bind(s.parts.driver)
  s.parts.driver.emit = (runId, body) => {
    const e = emit(runId, body)
    events.push(e)
    return e
  }
}, BOOT_TIMEOUT)
afterAll(() => s.server.dispose())

const send = (textIn: string, extra: Record<string, unknown> = {}) =>
  api.call('threads.send', {
    text: textIn,
    clientId: 'w1',
    clientMessageId: cm(),
    ...extra,
  } as never)

/** Waits until the run is in `status` and no session of it is live. */
async function until(runId: string, status: Run['status']): Promise<Run> {
  for (let i = 0; i < 1000; i++) {
    const { run } = await api.call('traces.run', { id: runId })
    if (run.status === status && !s.parts.driver.isLive(runId)) return run
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`run ${runId} never reached ${status}`)
}

const takesOf = async (pieceId: string) =>
  (await api.call('renders.list', { pieceId })).toSorted((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  )

function result(params: BetaMessageStreamParams, toolUseId: string) {
  for (const m of params.messages)
    if (Array.isArray(m.content))
      for (const b of m.content as unknown as Record<string, unknown>[])
        if (b.type === 'tool_result' && b.tool_use_id === toolUseId)
          return {
            isError: b.is_error === true,
            text: (b.content as { type: string; text?: string }[])
              .map((c) => c.text ?? `[${c.type}]`)
              .join('\n'),
            images: (b.content as { type: string }[]).filter((c) => c.type === 'image').length,
          }
  throw new Error(`no result for ${toolUseId}`)
}

const shot = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  scene: { look: 'catalog-white', output: { width: 512, height: 512, quality: 'preview' } },
  ...extra,
})

describe('a render in a conversation', () => {
  it('asks once, waits for the take with no model call open, then shows the model the image', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    const before = s.model.requests.length
    s.model.push(
      ({ pieceId }) => ({
        content: [tool('renders_create', { pieceId, ...shot('Hero') }, 'toolu_r1')],
        stop_reason: 'tool_use',
      }),
      {
        content: [text('The hero take reads well: crisp claws, clean white.')],
        stop_reason: 'end_turn',
      },
    )
    const { run } = await send('Render it on white', { context: { pieceId: piece.id } })
    await until(run.id, 'awaiting-approval')
    // The approval shows this computer's time, not money.
    const asked = events.find((e) => e.runId === run.id && e.type === 'tool.awaiting') as Extract<
      RunEvent,
      { type: 'tool.awaiting' }
    >
    expect(asked.summary).toContain('nothing is paid')
    expect(asked.estimate).toMatchObject({ usd: 0, machine: true })
    expect(asked.estimate!.seconds).toBeGreaterThan(0)

    await api.call('runs.decide', { runId: run.id, toolCallId: 'toolu_r1', decision: 'approve' })
    await until(run.id, 'waiting')
    const [take] = await takesOf(piece.id)
    expect(take).toMatchObject({ engine: 'blender', status: 'queued', title: 'Hero' })
    expect(take!.actor).toMatchObject({ type: 'agent', runId: run.id, toolCallId: 'toolu_r1' })
    expect(s.parts.waits.of(run.id)).toEqual([take!.id])
    expect(events.some((e) => e.runId === run.id && e.type === 'tool.waiting')).toBe(true)
    // Waiting costs nothing: one model call so far, and none open.
    expect(s.model.requests.length - before).toBe(1)
    const steps = (await api.call('traces.run', { id: run.id })).steps
    expect(steps.find((x) => x.toolCallId === 'toolu_r1')?.status).toBe('waiting')

    await queue.finish(take!.id)
    await until(run.id, 'done')
    const next = s.model.requests.at(-1)!
    const r = result(next, 'toolu_r1')
    expect(r).toMatchObject({ isError: false, images: 1 })
    expect(r.text).toContain('Studio white')
    expect(r.text).toContain('42 s of machine time')
    const after = (await api.call('traces.run', { id: run.id })).steps
    expect(after.find((x) => x.toolCallId === 'toolu_r1')?.status).toBe('done')
  })

  it('renders variants as one group, approved together, and answers when both are in', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    const variant = (label: string, material: string, id: string) =>
      tool(
        'renders_create',
        {
          pieceId: piece.id,
          title: 'Hero',
          groupId: 'metals-1',
          variantLabel: label,
          scene: {
            look: 'catalog-white',
            overrides: { '*': { material } },
            output: { width: 512, height: 512, quality: 'preview' },
          },
        },
        id,
      )
    s.model.push(
      {
        content: [
          variant('18k rose gold', 'au18k-rose', 'toolu_v1'),
          variant('Platinum', 'pt950', 'toolu_v2'),
        ],
        stop_reason: 'tool_use',
      },
      { content: [text('Both metals are in.')], stop_reason: 'end_turn' },
    )
    const { run } = await send('Render it in rose gold and platinum', {
      context: { pieceId: piece.id },
    })
    await until(run.id, 'awaiting-approval')
    for (const id of ['toolu_v1', 'toolu_v2'])
      await api.call('runs.decide', { runId: run.id, toolCallId: id, decision: 'approve' })
    await until(run.id, 'waiting')
    const takes = await takesOf(piece.id)
    expect(takes.map((x) => [x.groupId, x.variantLabel, x.scene.overrides['*']?.material])).toEqual(
      [
        ['metals-1', '18k rose gold', 'au18k-rose'],
        ['metals-1', 'Platinum', 'pt950'],
      ],
    )
    const calls = s.model.requests.length
    await queue.finish(takes[0]!.id)
    // One take in: still waiting for the other, and no model call.
    await until(run.id, 'waiting')
    expect(s.model.requests.length).toBe(calls)
    await queue.finish(takes[1]!.id)
    await until(run.id, 'done')
    const last = s.model.requests.at(-1)!
    expect(result(last, 'toolu_v1').images).toBe(1)
    expect(result(last, 'toolu_v2').images).toBe(1)
  })

  it('stops the takes when the designer stops the run', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    s.model.push({
      content: [tool('renders_create', { pieceId: piece.id, ...shot('Hero') }, 'toolu_c1')],
      stop_reason: 'tool_use',
    })
    const { run, thread } = await send('Render it', { context: { pieceId: piece.id } })
    await until(run.id, 'awaiting-approval')
    await api.call('runs.decide', { runId: run.id, toolCallId: 'toolu_c1', decision: 'approve' })
    await until(run.id, 'waiting')
    const [take] = await takesOf(piece.id)
    await api.call('runs.cancel', { runId: run.id })
    expect((await api.call('renders.get', { id: take!.id })).status).toBe('canceled')
    expect(queue.canceled).toContain(take!.id)
    expect((await api.call('traces.run', { id: run.id })).run.status).toBe('canceled')
    // The call is answered, so the conversation stays valid for the next message.
    const { messages } = await api.call('threads.get', { id: thread.id })
    const closing = messages.at(-1)!.content as Record<string, unknown>[]
    expect(closing).toMatchObject([{ type: 'tool_result', tool_use_id: 'toolu_c1' }])
  })

  it('tells the model when the designer canceled a take, and when the design moved on', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    s.model.push(
      {
        content: [
          tool('renders_create', { pieceId: piece.id, ...shot('Hero') }, 'toolu_s1'),
          tool('renders_create', { pieceId: piece.id, ...shot('Top') }, 'toolu_s2'),
        ],
        stop_reason: 'tool_use',
      },
      { content: [text('Noted.')], stop_reason: 'end_turn' },
    )
    const { run } = await send('Hero and top please', { context: { pieceId: piece.id } })
    await until(run.id, 'awaiting-approval')
    for (const id of ['toolu_s1', 'toolu_s2'])
      await api.call('runs.decide', { runId: run.id, toolCallId: id, decision: 'approve' })
    await until(run.id, 'waiting')
    const [hero, top] = await takesOf(piece.id)
    // The designer edits the piece while the takes render, and cancels one by hand.
    const full = await api.call('pieces.get', { id: piece.id })
    const first = full.design.order[0]!
    await api.call('design.apply', {
      pieceId: piece.id,
      label: 'Rename',
      ops: [{ t: 'update', id: first, patch: { name: 'Mine' } }],
    })
    await api.call('renders.cancel', { id: top!.id })
    await queue.finish(hero!.id)
    await until(run.id, 'done')
    const last = s.model.requests.at(-1)!
    expect(result(last, 'toolu_s1').text).toContain('stale')
    expect(result(last, 'toolu_s2')).toMatchObject({ isError: true })
    expect(result(last, 'toolu_s2').text).toContain('canceled by the designer')
  })
})

describe('the Render job', () => {
  it('renders without asking, re-renders a shot at most twice, and hands the set over', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    const ids: string[] = []
    const take = (retryOf?: string, note?: string) => ({
      pieceId: piece.id,
      ...shot('Hero'),
      ...(retryOf ? { retryOf, note } : {}),
    })
    const latest = async () => (await takesOf(piece.id)).at(-1)!.id
    s.model.push(
      { content: [tool('renders_create', take(), 'toolu_j1')], stop_reason: 'tool_use' },
      async () => ({
        content: [tool('renders_create', take(await latest(), 'warmer key'), 'toolu_j2')],
        stop_reason: 'tool_use',
      }),
      async () => ({
        content: [tool('renders_create', take(await latest(), 'lower angle'), 'toolu_j3')],
        stop_reason: 'tool_use',
      }),
      async () => ({
        content: [tool('renders_create', take(await latest(), 'again'), 'toolu_j4')],
        stop_reason: 'tool_use',
      }),
      {
        content: [text('The hero is as good as I can get it; over to you.')],
        stop_reason: 'end_turn',
      },
    )
    const { run } = await send('Render it', {
      context: { pieceId: piece.id },
      job: { stage: 'render' },
    })
    for (let i = 0; i < 3; i++) {
      // No approval in a job: straight to waiting.
      await until(run.id, 'waiting')
      const id = await latest()
      ids.push(id)
      await queue.finish(id)
    }
    const done = await until(run.id, 'done')
    expect(events.some((e) => e.runId === run.id && e.type === 'tool.awaiting')).toBe(false)
    const takes = await takesOf(piece.id)
    expect(takes.map((x) => [x.retryOf, x.note])).toEqual([
      [null, null],
      [ids[0], 'warmer key'],
      [ids[1], 'lower angle'],
    ])
    const refused = result(s.model.requests.at(-1)!, 'toolu_j4')
    expect(refused.isError).toBe(true)
    expect(refused.text).toContain('re-rendered 2 times')
    expect(done.job).toMatchObject({ stage: 'render', review: 'pending' })
    expect(done.job!.plan.map((p) => p.state)).toEqual(['done', 'done', 'pending'])
  })
})

describe('after a restart', () => {
  it('wakes a run whose take finished while the server was down', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    s.model.push(
      {
        content: [tool('renders_create', { pieceId: piece.id, ...shot('Hero') }, 'toolu_b1')],
        stop_reason: 'tool_use',
      },
      { content: [text('Here it is.')], stop_reason: 'end_turn' },
    )
    const { run } = await send('Render it', { context: { pieceId: piece.id } })
    await until(run.id, 'awaiting-approval')
    await api.call('runs.decide', { runId: run.id, toolCallId: 'toolu_b1', decision: 'approve' })
    await until(run.id, 'waiting')
    const [take] = await takesOf(piece.id)
    // The wake-up is lost (as in a restart): the take settles with nobody listening.
    s.parts.waits.dispose()
    await queue.finish(take!.id)
    expect((await api.call('traces.run', { id: run.id })).run.status).toBe('waiting')
    await s.server.runtime.recover()
    await until(run.id, 'done')
    await settled(s.parts, run.id)
    expect(result(s.model.requests.at(-1)!, 'toolu_b1').images).toBe(1)
  })
})
