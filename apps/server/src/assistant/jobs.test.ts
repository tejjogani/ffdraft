/**
 * AI jobs on the real loop: a job started from a stage moves its plan with its tool calls and
 * waits for review; a person's edit pauses it; Resume and a redone step carry it on in new runs
 * of the same conversation; a chat message about it carries it on too.
 */
import { ScriptAbortError } from '@pave/agent'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BOOT_TIMEOUT, type Client, client } from '../test/harness'
import { type AssistantServer, assistantServer, settled, text, tool } from './testing'

const KEY = 'sk-ant-test-0000000000000000000000000000-JOBS'

let s: AssistantServer
let api: Client
let n = 0
const cm = () => `job${++n}`
const states = (job: { plan: { state: string }[] } | null) => job?.plan.map((p) => p.state)

beforeAll(async () => {
  s = await assistantServer({ env: { ANTHROPIC_API_KEY: KEY } })
  api = client(s.server)
}, BOOT_TIMEOUT)
afterAll(() => s.server.dispose())

async function halo() {
  return api.call('pieces.create', { templateId: 'halo' } as never)
}

const rename = (pieceId: string, name: string) =>
  tool('design_apply', {
    pieceId,
    label: `Name the centre ${name}`,
    ops: [{ t: 'update', id: 'center', patch: { name } }],
  })

/** A turn that waits until the run is stopped, as a long model call would. */
const untilStopped =
  (before?: () => Promise<unknown>) =>
  async ({ signal }: { signal: AbortSignal | undefined }) => {
    await before?.()
    await new Promise<void>((resolve) => {
      if (signal?.aborted) resolve()
      signal?.addEventListener('abort', () => resolve(), { once: true })
    })
    throw new ScriptAbortError()
  }

describe('AI jobs', () => {
  it('starts from a stage with its plan, moves with its tools, and waits for review', async () => {
    const piece = await halo()
    s.model.push(
      { content: [tool('pieces_get', { id: piece.id })] },
      { content: [rename(piece.id, 'Centre')] },
      { content: [text('The CAD is built and checked.')] },
    )
    const { thread, run } = await api.call('threads.send', {
      text: 'Make the CAD',
      job: { stage: 'cad' },
      context: { pieceId: piece.id },
      clientId: 'w1',
      clientMessageId: cm(),
    })
    expect(run.job).toMatchObject({ stage: 'cad', review: null, continues: null })
    expect(states(run.job)).toEqual(['running', 'pending', 'pending', 'pending', 'pending'])
    await settled(s.parts, run.id)

    const done = (await api.call('traces.run', { id: run.id })).run
    expect(done.status).toBe('done')
    expect(states(done.job)).toEqual(['done', 'skipped', 'done', 'skipped', 'skipped'])
    expect(done.job?.review).toBe('pending')

    // The person's turn reads as the job's goal and plan, followed by their own words.
    const { messages } = await api.call('threads.get', { id: thread.id })
    const first = messages[0]!.content.find((b) => b.type === 'text') as { text: string }
    expect(first.text).toMatch(/^CAD job: Turn the brief and spec/)
    expect(first.text).toContain('3. Build the CAD')
    expect(first.text).toMatch(/Make the CAD$/)

    // A change asked for by chat while it waits for review carries the job on.
    s.model.push({ content: [rename(piece.id, 'Big centre')] }, { content: [text('Renamed.')] })
    const chat = await api.call('threads.send', {
      threadId: thread.id,
      text: 'Call the centre stone "Big centre"',
      context: { pieceId: piece.id },
      clientId: 'w1',
      clientMessageId: cm(),
    })
    expect(chat.run.job).toMatchObject({ stage: 'cad', continues: run.id, review: null })
    await settled(s.parts, chat.run.id)
    const changed = (await api.call('traces.run', { id: chat.run.id })).run
    expect(changed.job?.review).toBe('pending')

    const accepted = await api.call('runs.accept', { runId: chat.run.id })
    expect(accepted.job?.review).toBe('accepted')
    await expect(api.call('runs.accept', { runId: chat.run.id })).rejects.toMatchObject({
      error: { code: 'conflict' },
    })

    // Once accepted, the next message is plain chat.
    s.model.push({ content: [text('Hello.')] })
    const plain = await api.call('threads.send', {
      threadId: thread.id,
      text: 'Thanks',
      clientId: 'w1',
      clientMessageId: cm(),
    })
    expect(plain.run.job).toBeNull()
    await settled(s.parts, plain.run.id)
  })

  it('pauses when a person edits the piece, and Resume replans from there', async () => {
    const piece = await halo()
    s.model.push(
      { content: [rename(piece.id, 'First')] },
      untilStopped(() =>
        api.call('design.apply', {
          pieceId: piece.id,
          label: 'Thinner band',
          ops: [{ t: 'update', id: 'center', patch: { name: 'Mine' } }],
        }),
      ),
    )
    const { thread, run } = await api.call('threads.send', {
      text: 'Make the CAD',
      job: { stage: 'cad', goal: 'Build the halo ring' },
      context: { pieceId: piece.id },
      clientId: 'w1',
      clientMessageId: cm(),
    })
    await settled(s.parts, run.id)
    await s.parts.jobWatch.idle()

    const paused = (await api.call('traces.run', { id: run.id })).run
    expect(paused.status).toBe('paused')
    expect(paused.job).toMatchObject({
      pausedBy: 'edit',
      review: null,
      goal: 'Build the halo ring',
    })
    // The build had started; it goes back to be done again.
    expect(states(paused.job)).toEqual(['done', 'skipped', 'pending', 'pending', 'pending'])

    s.model.push({ content: [text('Picked up from your edit; the band is yours.')] })
    const resumed = await api.call('runs.resume', {
      runId: run.id,
      clientId: 'w1',
      clientMessageId: cm(),
    })
    expect(resumed.thread.id).toBe(thread.id)
    expect(resumed.run.job).toMatchObject({ continues: run.id, pausedBy: null })
    expect(states(resumed.run.job)).toEqual(['done', 'skipped', 'running', 'pending', 'pending'])
    await settled(s.parts, resumed.run.id)
    const { messages } = await api.call('threads.get', { id: thread.id })
    const asked = messages.filter((m) => m.role === 'user' && m.runId === resumed.run.id)[0]!
    expect(JSON.stringify(asked.content)).toContain('Resume the CAD job: Build the halo ring')
  })

  it('pauses on request or take-over, and redoes a step with what follows', async () => {
    const piece = await halo()
    let release: () => void = () => {}
    const started = new Promise<void>((r) => {
      release = r
    })
    s.model.push(untilStopped(async () => release()))
    const { run } = await api.call('threads.send', {
      text: 'Make the CAD',
      job: { stage: 'cad' },
      context: { pieceId: piece.id },
      clientId: 'w1',
      clientMessageId: cm(),
    })
    await started
    const paused = await api.call('runs.pause', { runId: run.id, takeover: true })
    expect(paused.status).toBe('paused')
    expect(paused.job?.pausedBy).toBe('takeover')
    expect(s.parts.driver.isLive(run.id)).toBe(false)

    await expect(
      api.call('runs.resume', {
        runId: run.id,
        redoStepId: 'nope',
        clientId: 'w1',
        clientMessageId: cm(),
      }),
    ).rejects.toMatchObject({ error: { code: 'conflict' } })

    s.model.push({ content: [text('Built again.')] })
    const redo = await api.call('runs.resume', {
      runId: run.id,
      redoStepId: 'build',
      clientId: 'w1',
      clientMessageId: cm(),
    })
    expect(states(redo.run.job)).toEqual(['running', 'pending', 'pending', 'pending', 'pending'])
    await settled(s.parts, redo.run.id)
    const detail = await api.call('traces.run', { id: redo.run.id })
    expect(detail.run.job?.review).toBe('pending')
  })

  it('cannot pause or resume a run that is not a job', async () => {
    s.model.push({ content: [text('Hi.')] })
    const { run } = await api.call('threads.send', {
      text: 'Hello',
      clientId: 'w1',
      clientMessageId: cm(),
    })
    await settled(s.parts, run.id)
    await expect(api.call('runs.pause', { runId: run.id })).rejects.toMatchObject({
      error: { code: 'conflict' },
    })
    await expect(
      api.call('runs.resume', { runId: run.id, clientId: 'w1', clientMessageId: cm() }),
    ).rejects.toMatchObject({ error: { code: 'conflict' } })
  })
})
