/**
 * The plan's allowances as the assistant and MCP meet them: the context tells the model what is
 * left, a Render job's plan still asks the person before the last free render, a call past the
 * limit comes back to the model as a plain tool error it can explain, and an MCP client calling
 * the same tool is refused the same way. Engines are fakes; nothing here needs Blender.
 */
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { parseToolCall, toolDefs } from '@pave/agent'
import type { Allowance, CommandName, RenderJob, Run, RunEvent } from '@pave/schema'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Ctx } from '../context'
import { AppError } from '../errors'
import { planStatus } from '../plans'
import type { JobHandle, RenderJobPatch } from '../services'
import { BOOT_TIMEOUT, type Client, client } from '../test/harness'
import { type AssistantServer, assistantServer, text, tool } from './testing'

const KEY = 'sk-ant-test-0000000000000000000000000000-KEYZ'

let s: AssistantServer
let api: Client
let ctx: Ctx
let n = 0
const cm = () => `cm${++n}`
const events: RunEvent[] = []
const takes = new Map<string, JobHandle<RenderJobPatch>>()

beforeAll(async () => {
  s = await assistantServer({ env: { ANTHROPIC_API_KEY: KEY } })
  api = client(s.server)
  ctx = await s.server.runtime.context(s.server.runtime.local!)
  s.server.runtime.services.register('renderQueue', {
    capabilities: { blender: true },
    submit: async (job: RenderJob, _piece: unknown, handle: JobHandle<RenderJobPatch>) => {
      takes.set(job.id, handle)
    },
    cancel: async () => {},
  })
  s.server.runtime.services.register('geometry', {
    evaluate: async () => {
      throw new Error('not used here')
    },
    export: async (_design, { format }) => ({
      file: { bytes: new Uint8Array([1]), name: `p.${format}`, mime: 'model/x' },
      notes: [],
    }),
    renderInput: async () => {
      throw new Error('not used here')
    },
  })
  const emit = s.parts.driver.emit.bind(s.parts.driver)
  s.parts.driver.emit = (runId, body) => {
    const e = emit(runId, body)
    events.push(e)
    return e
  }
}, BOOT_TIMEOUT)
afterAll(() => s.server.dispose())
beforeEach(() => ctx.repo.planClaims.delete(sql`true`))

/** Uses `count` of an allowance this month, as earlier work would have. */
async function use(allowance: Allowance, count: number) {
  const { period } = await planStatus(ctx)
  await ctx.repo.planClaims.insertMany(
    Array.from({ length: count }, (_, i) => ({
      id: `clm_${allowance}_${i}_${cm()}`,
      idempotencyKey: `earlier:${allowance}:${i}:${cm()}`,
      allowance,
      period,
      slot: i + 1,
      state: 'used' as const,
      subject: allowance,
      userId: ctx.user.id,
      actor: ctx.actor,
    })),
  )
}

const send = (textIn: string, extra: Record<string, unknown> = {}) =>
  api.call('threads.send', {
    text: textIn,
    clientId: 'w1',
    clientMessageId: cm(),
    ...extra,
  } as never)

async function until(runId: string, status: Run['status']): Promise<Run> {
  for (let i = 0; i < 1000; i++) {
    const { run } = await api.call('traces.run', { id: runId })
    if (run.status === status && !s.parts.driver.isLive(runId)) return run
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`run ${runId} never reached ${status}`)
}

function result(params: BetaMessageStreamParams, toolUseId: string) {
  for (const m of params.messages)
    if (Array.isArray(m.content))
      for (const b of m.content as unknown as Record<string, unknown>[])
        if (b.type === 'tool_result' && b.tool_use_id === toolUseId)
          return {
            isError: b.is_error === true,
            text: (b.content as { type: string; text?: string }[])
              .map((c) => c.text ?? '')
              .join('\n'),
          }
  throw new Error(`no result for ${toolUseId}`)
}

const awaiting = (runId: string) =>
  events.filter(
    (e): e is Extract<RunEvent, { type: 'tool.awaiting' }> =>
      e.runId === runId && e.type === 'tool.awaiting',
  )

const shot = (pieceId: string, title: string) => ({
  pieceId,
  title,
  scene: { look: 'catalog-white', output: { width: 512, height: 512, quality: 'preview' } },
})

describe('a Render job on the Free plan', () => {
  it('knows what is left, asks before the last free render, and explains the limit', async () => {
    await use('render', 3)
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    s.model.push(
      {
        content: [
          tool('renders_create', shot(piece.id, 'Hero'), 'toolu_a1'),
          tool('renders_create', shot(piece.id, 'Top'), 'toolu_a2'),
        ],
        stop_reason: 'tool_use',
      },
      {
        content: [tool('renders_create', shot(piece.id, 'Macro'), 'toolu_a3')],
        stop_reason: 'tool_use',
      },
      {
        content: [text('That used this month’s free renders; the Macro can be a browser preview.')],
        stop_reason: 'end_turn',
      },
    )
    const before = s.model.requests.length
    const { run } = await send('Render the set', {
      context: { pieceId: piece.id },
      job: { stage: 'render' },
    })
    await until(run.id, 'awaiting-approval')
    // The model was told what is left, in the context message after the person's message.
    expect(JSON.stringify(s.model.requests[before]!.messages)).toContain(
      'Free plan: Blender renders 2 of 5 left this month; Rhino and STEP exports 5 of 5 left this month',
    )
    // The job approves its own takes, but not the last free one: only the second call asks.
    const asked = awaiting(run.id)
    expect(asked.map((e) => e.toolCallId)).toEqual(['toolu_a2'])
    expect(asked[0]!.summary).toContain(
      'It uses your last free render this month (Pro has unlimited).',
    )
    const queued = await api.call('renders.list', { pieceId: piece.id })
    expect(queued.map((t) => t.title)).toEqual(['Hero'])

    await api.call('runs.decide', { runId: run.id, toolCallId: 'toolu_a2', decision: 'approve' })
    await until(run.id, 'waiting')
    for (const handle of takes.values())
      await handle.update({ status: 'done', progress: 1, assetIds: [], seconds: 30 })
    takes.clear()
    await until(run.id, 'done')

    // The third take was past the limit: refused before it started, told to the model plainly.
    const refused = result(s.model.requests.at(-1)!, 'toolu_a3')
    expect(refused.isError).toBe(true)
    expect(refused.text).toContain(
      'You have used your 5 free renders this month. Pro has unlimited renders.',
    )
    expect((await api.call('renders.list', { pieceId: piece.id })).length).toBe(2)
    const steps = (await api.call('traces.run', { id: run.id })).steps
    expect(steps.find((x) => x.toolCallId === 'toolu_a3')?.output).toMatchObject({
      value: { error: { code: 'plan_limit', allowance: 'render' } },
    })
  })
})

describe('exports by the assistant and over MCP', () => {
  it('asks before the last free Rhino export and refuses MCP past the limit', async () => {
    await use('export', 4)
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    s.model.push(
      {
        content: [
          tool('design_export', { pieceId: piece.id, format: 'stl' }, 'toolu_e1'),
          tool('design_export', { pieceId: piece.id, format: '3dm' }, 'toolu_e2'),
        ],
        stop_reason: 'tool_use',
      },
      { content: [text('Both files are ready.')], stop_reason: 'end_turn' },
    )
    const { run } = await send('Export it for the caster and for Rhino', {
      context: { pieceId: piece.id },
    })
    await until(run.id, 'awaiting-approval')
    // The STL is never counted and ran at once; the last free Rhino export waits for a yes.
    const asked = awaiting(run.id)
    expect(asked.map((e) => e.toolCallId)).toEqual(['toolu_e2'])
    expect(asked[0]!.summary).toContain('your last free Rhino or STEP export this month')
    await api.call('runs.decide', { runId: run.id, toolCallId: 'toolu_e2', decision: 'approve' })
    await until(run.id, 'done')
    const plan = await api.call('plan.get', {})
    expect(plan.allowances[1]).toMatchObject({ used: 5, left: 0 })

    // An MCP client calls the same tool the same way: by its API name, validated, then run as
    // the person through the command pipeline. Past the limit it gets the same typed refusal.
    const def = toolDefs().find((d) => d.name === 'design_export')!
    expect(def.description).toContain('never counted')
    const parsed = parseToolCall('design_export', { pieceId: piece.id, format: 'step' })
    if (!parsed.ok) throw new Error('the call should parse')
    const refused = await s.server.runtime
      .execute(parsed.command as CommandName, parsed.input, ctx)
      .then(
        () => null,
        (err: unknown) => err,
      )
    expect(refused).toBeInstanceOf(AppError)
    expect(refused).toMatchObject({ code: 'plan_limit', status: 402 })
    expect((refused as AppError).message).toContain('free Rhino or STEP exports this month')
    // Mesh formats still work for MCP at the limit.
    const stl = parseToolCall('design_export', { pieceId: piece.id, format: 'stl' })
    if (!stl.ok) throw new Error('the call should parse')
    await s.server.runtime.execute(stl.command as CommandName, stl.input, ctx)
  })
})
