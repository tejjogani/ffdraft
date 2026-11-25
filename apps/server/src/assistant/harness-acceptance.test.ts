/**
 * The harness never sends a request the Claude API would refuse, on any tier's model and for each
 * kind of run, checked against the strict fake API (@pave/agent/testing/fake-api) through the
 * real SDK. Every assistant test file goes through the fake too (see ./testing); this file adds
 * what they do not: each of the four models in one place, a thread that switches tiers between
 * messages (thinking blocks written by one model replayed to another), a Design job that asks a
 * quick question first, and a failed tool call followed by a new message.
 *
 * The whole suite runs on another model with PAVE_TEST_MODEL (scripts/test-tiers.sh).
 */
import { ASSISTANT_MODELS, type AssistantModelId } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BOOT_TIMEOUT, type Client, client } from '../test/harness'
import { type AssistantServer, assistantServer, settled, text, tool } from './testing'

let s: AssistantServer
let api: Client
let n = 0
const cm = () => `acc${++n}`

/** Each tier at one of the four models; Light is Haiku so all four are reachable in one thread. */
const TIERS = {
  power: 'claude-fable-5-2',
  standard: 'claude-opus-5-5',
  light: 'claude-haiku-5-5',
} as const

beforeAll(async () => {
  // This file picks each model itself, so a whole-suite tier run (PAVE_TEST_MODEL) must not
  // override the Standard tier here.
  s = await assistantServer({
    env: { ANTHROPIC_API_KEY: 'sk-ant-test-acceptance', PAVE_ASSISTANT_MODEL_STANDARD: undefined },
  })
  api = client(s.server)
  await api.call('org.settings.update', { assistantModels: TIERS } as never)
}, BOOT_TIMEOUT)
afterAll(() => s.server.dispose())

const think = (t: string) => ({ type: 'thinking' as const, thinking: t })

async function send(textIn: string, extra: Record<string, unknown> = {}) {
  const out = (await api.call('threads.send', {
    text: textIn,
    clientId: 'w1',
    clientMessageId: cm(),
    ...extra,
  } as never)) as { run: { id: string; status: string; model: string }; thread: { id: string } }
  return out
}

async function until(runId: string, status: string) {
  for (let i = 0; i < 1500; i++) {
    const { run } = await api.call('traces.run', { id: runId })
    if (run.status === status && !s.parts.driver.isLive(runId)) return run
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`run ${runId} never reached ${status}`)
}

describe('the harness against the strict fake API', () => {
  it.each(ASSISTANT_MODELS)(
    'builds a piece on %s with parallel calls and an approval',
    async (model) => {
      // Light can point at any of the four models; it is the tier under test here.
      await api.call('org.settings.update', { assistantModels: { light: model } } as never)
      const tier = 'light' as const
      const piece = await api.call('pieces.create', {
        templateId: 'solitaire',
        title: `On ${model}`,
      } as never)
      s.model.push(
        {
          content: [
            think('Read the piece and its numbers together, then rebuild after the approval.'),
            text('Looking at it.'),
            tool('pieces_get', { id: piece.id }, `t_${model}_get`),
            tool('design_evaluate', { pieceId: piece.id }, `t_${model}_eval`),
          ],
        },
        { content: [tool('pieces_buildFromSpec', { id: piece.id }, `t_${model}_build`)] },
        { content: [think('Declined. Say so.'), text('Left it as it is.')] },
      )
      const { run } = await send('Rebuild it from the spec', {
        tier,
        context: { pieceId: piece.id },
      })
      expect(run.model).toBe(model)
      await until(run.id, 'awaiting-approval')
      await api.call('runs.decide', {
        runId: run.id,
        toolCallId: `t_${model}_build`,
        decision: 'deny',
        note: 'Not now',
      } as never)
      const done = await until(run.id, 'done')
      expect(done.status).toBe('done')
      expect(s.model.problems()).toEqual([])
      await api.call('org.settings.update', { assistantModels: TIERS } as never)
    },
    60_000,
  )

  it('switches tiers between messages of one thread: every model reads what it can', async () => {
    const order = ['power', 'standard', 'light', 'standard', 'power'] as const
    let threadId: string | undefined
    for (const [i, tier] of order.entries()) {
      s.model.push(
        { content: [think(`turn ${i} on ${tier}`), text('Looking.'), tool('pieces_list', {})] },
        { content: [think(`answer ${i}`), text(`Answer ${i} on ${tier}.`)] },
      )
      const { run, thread } = await send(`Message ${i}`, {
        tier,
        ...(threadId ? { threadId } : {}),
      })
      threadId = thread.id
      await settled(s.parts, run.id)
      const detail = await api.call('traces.run', { id: run.id })
      expect(detail.run.status, JSON.stringify(detail.run)).toBe('done')
      expect(detail.run.model).toBe(TIERS[tier])
    }
    expect(s.model.problems()).toEqual([])
    // The fake dropped thinking blocks the next model could not read, and said so; nothing was
    // refused for a broken binding (the history stayed append-only across five models' turns).
    const dropped = (s.model.api?.exchanges ?? []).flatMap((e) => e.dropped ?? [])
    expect(dropped.length).toBeGreaterThan(0)
    expect(new Set(dropped.map((d) => d.reason))).toEqual(new Set(['model_binding_mismatch']))
  }, 60_000)

  it('asks a quick question first in a Design job, on every model', async () => {
    for (const tier of ['power', 'standard', 'light'] as const) {
      const piece = await api.call('pieces.create', {
        title: `Brief on ${tier}`,
        brief: 'A cocktail ring, about 3 ct.',
      } as never)
      s.model.push(
        {
          content: [
            tool(
              'chat_ask',
              {
                intro: 'Two things the brief leaves open.',
                questions: [
                  {
                    id: 'metal',
                    question: 'Metal?',
                    options: [
                      { id: 'yg', label: '18k yellow' },
                      { id: 'pt', label: 'Platinum' },
                    ],
                    defaults: ['yg'],
                  },
                ],
              },
              `ask_${tier}`,
            ),
          ],
        },
        { content: [text('Noted: 18k yellow. Directions next time.')] },
      )
      const { run } = await send('Propose directions', {
        tier,
        context: { pieceId: piece.id },
        job: { stage: 'design' },
      })
      await until(run.id, 'awaiting-approval')
      await api.call('runs.decide', {
        runId: run.id,
        toolCallId: `ask_${tier}`,
        decision: 'approve',
        answers: {},
      } as never)
      await until(run.id, 'done')
    }
    expect(s.model.problems()).toEqual([])
  }, 90_000)

  it('keeps the conversation valid after a failed call and a run cut short', async () => {
    s.model.push(
      { content: [tool('design_apply', {})] },
      { content: [text('That call was wrong; nothing changed.')] },
      { content: [text('Half'), tool('pieces_list', {})], failAfterContent: true },
      { content: [text('Half again'), tool('pieces_list', {})], failAfterContent: true },
      { content: [text('And again'), tool('pieces_list', {})], failAfterContent: true },
      { content: [text('Fresh start.')] },
    )
    const first = await send('Try something')
    await settled(s.parts, first.run.id)
    const second = await send('Again', { threadId: first.thread.id })
    await settled(s.parts, second.run.id)
    const third = await send('Once more', { threadId: first.thread.id })
    await settled(s.parts, third.run.id)
    expect((await api.call('traces.run', { id: third.run.id })).run.status).toBe('done')
    expect(s.model.problems()).toEqual([])
  }, 60_000)

  it('reached every model the settings allow', () => {
    const seen = new Set((s.model.api?.exchanges ?? []).map((e) => e.model))
    expect(ASSISTANT_MODELS.filter((m: AssistantModelId) => !seen.has(m))).toEqual([])
  })
})
