/**
 * The founder's journeys, recorded with Claude in the loop (apps/studio/e2e/harness.ts against the
 * fake Claude API in agent mode), replayed through the real loop, the real SDK and the strict fake
 * API. The designer's side is played through the API as the studio sends it; Claude's side comes
 * from the recordings in fixtures/recordings, with the ids of this run swapped in.
 *
 * Each journey must replay with: no request the fake refuses, the same request shape at every turn
 * as when it was recorded, and the same result as the recorded journey (read back the same way by
 * the driver): the design, its changes, the directions, the takes, each run's status, steps, job
 * plan and cost. The journeys build on each other (one piece goes from a brief to directions, CAD,
 * edits and renders), so they run in order on one server.
 *
 * The render engine here is a stand-in that finishes each take at once (the recording used real
 * Blender); a capture no studio window can draw is drawn on the server. Both change some tool
 * result text (timings, the capture's source), which shows as drift and is checked against a list
 * of what may differ.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { JOB_RECIPES, VARIANTS_PROMPT } from '@pave/agent/studio'
import {
  Recorder,
  type Recording,
  type ReplayReport,
  type ReplaySource,
  replaySource,
  type SourceRequest,
} from '@pave/agent/testing/fake-api'
import type { RenderJob, Run } from '@pave/schema'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { putAsset } from '../assets/assets'
import type { JobHandle, RenderJobPatch, ServiceContext } from '../services'
import { BOOT_TIMEOUT, type Client, client } from '../test/harness'
import { type AssistantServer, assistantServer, settled } from './testing'

const DIR = join(import.meta.dirname, 'fixtures', 'recordings')
const load = <T>(name: string): T => JSON.parse(readFileSync(join(DIR, name), 'utf8')) as T

/**
 * PAVE_REFRESH_RECORDINGS=1 rewrites the recordings' request side from this run, keeping every
 * recorded reply (Claude's side) as it was, only with this run's ids. Use it when the harness's
 * own side changes on purpose (a job's plan, a tool's result, the stages), then read the diff of
 * the recordings and outcomes, and run the replay again without it: it must pass unchanged.
 */
const REFRESH = process.env.PAVE_REFRESH_RECORDINGS === '1'
let recorder: Recorder | null = null

/** Plays the current journey's recording; the journeys run one after another. */
let current: ReplaySource | null = null
const source = {
  next: async (req: SourceRequest) => {
    if (!current) throw new Error('no recording is being replayed')
    const betas = (req.headers['anthropic-beta'] ?? '')
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean)
    try {
      const reply = await current.next(req)
      recorder?.add(req.n, req.body, betas, reply)
      return reply
    } catch (err) {
      // A call the recorded client abandoned is abandoned in the refreshed recording too.
      recorder?.add(req.n, req.body, betas, null)
      throw err
    }
  },
}

/** A render engine that finishes every take at once, with a small picture (and frames for a video). */
class InstantQueue {
  readonly service = {
    capabilities: { blender: true },
    submit: async (
      job: RenderJob,
      _piece: unknown,
      handle: JobHandle<RenderJobPatch>,
      sctx: ServiceContext,
    ) => {
      setTimeout(() => void this.#finish(job, handle, sctx), 30)
    },
    cancel: async () => {},
  }

  async #finish(job: RenderJob, handle: JobHandle<RenderJobPatch>, sctx: ServiceContext) {
    const png = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 245, g: 238, b: 220 } },
    })
      .png()
      .toBuffer()
    const asset = await sctx.putAsset({ bytes: png, name: `${job.id}.png`, kind: 'render' })
    // A draft pass that measured and changed nothing, as the real queue reports for a clean take.
    const critique = { passes: [{ adjustments: [], issues: [], draftAssetId: null }] }
    await handle.update({
      status: 'done',
      progress: 1,
      assetIds: [asset.id],
      seconds: 1,
      device: 'CPU',
      critique,
    })
  }
}

let s: AssistantServer
let api: Client
let n = 0
const cm = () => `replay${++n}`
const state: { piece?: string; photoPiece?: string } = {}

beforeAll(async () => {
  s = await assistantServer({
    engines: true,
    config: { plan: 'pro' },
    env: {
      ANTHROPIC_API_KEY: 'sk-ant-api03-fake-harness-key-0000',
      PAVE_ASSISTANT_MODEL_STANDARD: undefined,
    },
    source,
    // Concept images: the fake provider stands in for the live OpenAI images of journey h.
    images: { env: { PAVE_IMAGE_GEN: 'fake' } },
  })
  api = client(s.server)
  s.server.runtime.services.register('renderQueue', new InstantQueue().service as never)
}, BOOT_TIMEOUT)
afterAll(() => s.server.dispose())

type Send = { run: Run; thread: { id: string } }
async function send(text: string, extra: Record<string, unknown> = {}): Promise<Send> {
  return (await api.call('threads.send', {
    text,
    attachments: [],
    context: { ...(state.piece ? { pieceId: state.piece } : {}), selection: [] },
    clientId: 'replay',
    clientMessageId: cm(),
    ...extra,
  } as never)) as Send
}

const runs = async () => (await api.call('traces.runs', { limit: 50 } as never)) as Run[]
const LIVE = ['running', 'awaiting-approval', 'waiting']

/** Waits until `done()`, answering each quick question with its defaults (the studio's Go). */
async function play(what: string, done: () => Promise<boolean>, ms = 240_000) {
  const end = Date.now() + ms
  const answered = new Set<string>()
  while (Date.now() < end) {
    if (await done()) return
    for (const r of await runs()) {
      if (r.status !== 'awaiting-approval' || s.parts.driver.isLive(r.id)) continue
      const detail = await api.call('traces.run', { id: r.id })
      for (const step of detail.steps.filter((x) => x.status === 'awaiting-approval')) {
        const key = `${r.id}:${step.toolCallId}`
        if (answered.has(key)) continue
        answered.add(key)
        const input = step.input as { questions?: { id: string; defaults: string[] }[] } | null
        await api.call('runs.decide', {
          runId: r.id,
          toolCallId: step.toolCallId!,
          decision: 'approve',
          ...(input?.questions
            ? { answers: Object.fromEntries(input.questions.map((q) => [q.id, q.defaults])) }
            : {}),
        } as never)
      }
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`timed out waiting for ${what}`)
}
const stopped = async () => {
  const [r] = await runs()
  return !!r && !LIVE.includes(r.status) && !s.parts.driver.isLive(r.id)
}

/** What a journey left behind, read back the way the recording driver read it. */
async function outcome(pieceIds: string[], before: string[]) {
  const pieces = []
  for (const id of pieceIds) {
    const p = await api.call('pieces.get', { id })
    const history = (await api.call('design.history', { pieceId: id } as never)) as unknown
    const takes = (await api.call('renders.list', {
      pieceId: id,
      limit: 100,
    } as never)) as RenderJob[]
    const changes = (
      Array.isArray(history) ? history : ((history as { changes?: unknown[] }).changes ?? [])
    ) as {
      actor?: { type: string }
      label?: string
      ops?: unknown[]
    }[]
    pieces.push({
      title: p.title,
      kind: p.kind,
      stage: p.stage,
      version: p.version,
      spec: p.spec,
      design: p.design,
      directions: (p.directions ?? []).map((d) => ({
        letter: d.letter,
        name: d.name,
        origin: d.origin,
      })),
      changes: changes.map((c) => ({ actor: c.actor?.type, label: c.label, ops: c.ops?.length })),
      takes: takes.map((t) => ({
        title: t.title,
        status: t.status,
        engine: t.engine,
        animation: (t.scene as { animation?: { type: string } }).animation?.type ?? null,
        metal: (t.scene as { metal?: unknown }).metal ?? null,
      })),
    })
  }
  const mine = (await runs()).filter((r) => !before.includes(r.id)).reverse()
  const out = []
  for (const r of mine) {
    const d = await api.call('traces.run', { id: r.id })
    out.push({
      status: d.run.status,
      model: d.run.model,
      tier: d.run.tier,
      costUsd: d.run.costUsd,
      tokens: d.run.tokens,
      job: d.run.job
        ? {
            stage: d.run.job.stage,
            review: d.run.job.review,
            pausedBy: d.run.job.pausedBy,
            plan: d.run.job.plan.map((x) => `${x.id}:${x.state}`),
          }
        : null,
      steps: d.steps.map((x) => `${x.kind}:${x.name}:${x.status}${x.isError ? ':error' : ''}`),
    })
  }
  return { pieces, runs: out }
}

/**
 * Text that may differ between the recording and a replay: timings, dates, the machine and the
 * capture's source (a studio window when recorded, the server here), the fit's search (it stops on
 * a time budget), and take facts (real Blender then, the stand-in now).
 */
const VOLATILE_WORDS = new Set(
  (
    'studio server CPU GPU blender browser seconds stopped budget evaluations overlap reason source ' +
    'No Pav window could do viewport capture These pictures were drawn on the instead plain shaded clay ' +
    'metal grey stones pale blue materials or labels open screen in this can run Auto tune measured draft ' +
    'and changed nothing Numeric checks take framing exposure noise issues warning clipped of piece is ' +
    'blown out machine time s Draft outlines agree floor Numbers marked assumed not visible photo keep ' +
    'recipe value weak fitted to from status key params camera azimuth elevation ops quality good poor version n id no'
  ).split(' '),
)
const VOLATILE = [
  /^-?\d+$/, // numbers and their parts (seconds, scores, measured fit values)
  /^\d+Z$/, // the end of a timestamp
  /^\d{4}-\d{2}-\d{2}T\d+$/,
  /^(canon-)?[0-9a-f]{12,}$/, // content hashes (the canon slice, scene hashes)
  /^[A-Za-z0-9_-]{40,}$/, // thinking signatures: they bind to the request prefix, so they move with it
]
const volatile = (t: string) =>
  t
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => VOLATILE_WORDS.has(w) || VOLATILE.some((re) => re.test(w)))
/**
 * The piece's facts before its first build: the studio window writes zeros when it opens the
 * piece; a piece made through the API alone has none yet.
 */
const UNBUILT_FACTS = 'metal caratTotal 0 metalMassG 0 stoneCount 0'
const explained = (d: { recorded: string; live: string; after: string }) =>
  (volatile(d.recorded) && volatile(d.live)) ||
  (d.recorded === UNBUILT_FACTS && d.live === 'null') ||
  // The context names the person's own edits "by the designer" (it said "you", which, addressed
  // to the model, read as the model); the recordings predate the change.
  (d.recorded === 'you' && d.live === 'by the designer' && /^n- v\d+ /.test(d.after)) ||
  // The piece's facts the studio window keeps up to date as it evaluates; none is open here.
  /\bfacts\b/.test(d.after) ||
  // The cover is drawn in the background after a build and lands when it is done: a read of the
  // piece sees it or not depending on how fast this machine drew it.
  (/\bcoverAssetId$/.test(d.after) &&
    [d.recorded, d.live].every((v) => /^(null|as_[\w-]+)$/.test(v))) ||
  // A capture a studio window drew when recorded is drawn on the server here, and says so.
  /needs an|open Pav|No Pav|could do viewport|drawn on the/.test(
    `${d.after} ${d.recorded} ${d.live}`,
  )

function expectFaithful(report: ReplayReport, name: string) {
  expect(report.structural, `${name}: request shapes differ from the recording`).toEqual([])
  expect(report.mismatches, `${name}: model or structured flag differs`).toEqual([])
  const unexplained = report.drift.filter((d) => !explained(d))
  if (unexplained.length || report.structural.length)
    console.error(
      `${name} drift:`,
      JSON.stringify(
        { structural: report.structural, unexplained: unexplained.slice(0, 25) },
        null,
        1,
      ),
    )
  expect(unexplained, `${name}: tool results differ beyond timings and capture sources`).toEqual([])
  expect(s.model.problems(), `${name}: the fake API refused a request`).toEqual([])
}

/** The recorded outcome, minus what the stand-ins change (take engines' facts are not in it). */
const recordedOutcome = (name: string) =>
  load<{ pieces: unknown[]; runs: unknown[] }>(`${name}.outcome.json`)

async function replay(name: string, journey: () => Promise<string[]>) {
  const rec = load<Recording>(`${name}.json`)
  current = replaySource(rec)
  recorder = REFRESH ? new Recorder() : null
  const before = (await runs()).map((r) => r.id)
  const pieceIds = await journey()
  for (const r of await runs())
    if (s.parts.driver.isLive(r.id)) await settled(s.parts, r.id, 60_000)
  expect(current.remaining, `${name}: recorded turns left unplayed`).toBe(0)
  if (REFRESH && recorder) {
    const got = await outcome(pieceIds, before)
    writeFileSync(
      join(DIR, `${name}.json`),
      `${JSON.stringify({ ...recorder.recording(rec.journey, rec.description), recordedAt: rec.recordedAt }, null, 1)}\n`,
    )
    writeFileSync(
      join(DIR, `${name}.outcome.json`),
      `${JSON.stringify({ journey: name, ...got }, null, 2)}\n`,
    )
    expect(s.model.problems(), `${name}: the fake API refused a request`).toEqual([])
    return { got, report: current.report }
  }
  expectFaithful(current.report, name)
  const got = await outcome(pieceIds, before)
  const want = recordedOutcome(name)
  expect(got.runs).toEqual(want.runs)
  expect(got.pieces).toEqual(want.pieces)
  return { got, report: current.report }
}

describe('the recorded journeys replay through the real loop', () => {
  it('a. variants of the CAD from a brief: proposed, mixed and one picked', async () => {
    await replay('a-directions', async () => {
      const piece = await api.call('pieces.create', {
        title: 'Tenth anniversary ring',
        brief:
          'A ring for our tenth anniversary. About a carat, size 6. She works with her hands, so nothing that catches. Budget around $4,000.',
      } as never)
      state.piece = piece.id
      // "Try variants" in the CAD stage: a message, not a job (variants are a side path).
      const first = await send(VARIANTS_PROMPT, {
        context: { pieceId: piece.id, selection: [], stage: 'cad' },
      })
      await play('three variants', stopped)
      await send('Put the head of A on the band of B', { threadId: first.thread.id })
      await play('the mix', stopped)
      await send('Go with D', { threadId: first.thread.id })
      await play('the pick', stopped)
      return [piece.id]
    })
  }, 600_000)

  it('b. the CAD job, paused by a hand edit, resumed and accepted', async () => {
    await replay('b-cad-job', async () => {
      const id = state.piece!
      const start = (await api.call('pieces.get', { id })).version
      const goal = JOB_RECIPES.cad.goal
      const { run } = await send(goal, { job: { stage: 'cad', goal } })
      // As when recorded: the designer edits while the job waits on its next model call.
      await play(
        'the job’s next model call after its first change',
        async () =>
          (await api.call('pieces.get', { id })).version > start && current!.report.served >= 4,
      )
      await api.call('design.apply', {
        pieceId: id,
        label: 'My band, by hand',
        ops: [{ t: 'update', id: 'band', patch: { widthTop: 2.6 } }],
      } as never)
      await play(
        'the job to pause',
        async () => (await api.call('traces.run', { id: run.id })).run.status === 'paused',
      )
      const resumed = (await api.call('runs.resume', {
        runId: run.id,
        clientId: 'replay',
        clientMessageId: cm(),
      } as never)) as Send
      await play('the resumed job', async () => {
        const r = (await api.call('traces.run', { id: resumed.run.id })).run
        return !LIVE.includes(r.status) && r.job?.review === 'pending'
      })
      await api.call('runs.accept', { runId: resumed.run.id } as never)
      return [id]
    })
  }, 600_000)

  it('c. a chat edit, then a question about the selected stone', async () => {
    await replay('c-chat-edit', async () => {
      const first = await send('Make the band 2.2 mm wide, keep everything else.')
      await play('the edit', stopped)
      await send('Is this stone safe for someone who works with her hands? How is it held?', {
        threadId: first.thread.id,
        context: { pieceId: state.piece, selection: ['center'] },
      })
      await play('the answer', stopped)
      return [state.piece!]
    })
  }, 600_000)

  it('d. a photo becomes a parametric design', async () => {
    const { got } = await replay('d-photo', async () => {
      const form = new FormData()
      form.set(
        'file',
        new File([readFileSync(join(DIR, 'ring-photo.jpg'))], 'ring-photo.jpg', {
          type: 'image/jpeg',
        }),
      )
      const photo = (await (
        await api.request('/api/assets', { method: 'POST', body: form })
      ).json()) as { id: string }
      await api.call('threads.send', {
        text: 'Make this ring in Pavé',
        attachments: [photo.id],
        context: { selection: [] },
        clientId: 'replay',
        clientMessageId: cm(),
      } as never)
      await play('the photo read and build', stopped, 400_000)
      const [r] = await runs()
      state.photoPiece = (await api.call('traces.run', { id: r!.id })).run.pieceId!
      return [state.photoPiece]
    })
    expect((got.pieces[0] as { title: string }).title).toBe('Six-claw solitaire')
  }, 600_000)

  it('e. the render job: questions, cameras checked, takes, a retake and a rose-gold variant', async () => {
    await replay('e-render', async () => {
      const goal = `${JOB_RECIPES.render.goal} Render at draft quality.`
      const first = await send(goal, { job: { stage: 'render', goal } })
      await play('the render job', stopped)
      await send('Re-render the hero in 18k rose gold.', { threadId: first.thread.id })
      await play('the rose-gold take', stopped)
      return [state.piece!]
    })
  }, 600_000)

  it('g. one thread on every tier, Light pointed at Haiku', async () => {
    await replay('g-tiers', async () => {
      await api.call('org.settings.update', {
        assistantModels: { light: 'claude-haiku-5-5' },
      } as never)
      let threadId: string | undefined
      for (const [tier, text] of [
        ['power', 'Make the band 2.4 mm wide.'],
        ['standard', 'Now 2.3 mm.'],
        ['light', 'And back to 2.2 mm, please.'],
      ] as const) {
        const out = await send(text, { tier, ...(threadId ? { threadId } : {}) })
        threadId = out.thread.id
        await play(`the ${tier} run`, stopped)
      }
      return [state.piece!]
    })
  }, 600_000)

  it('h. concept images: a brief from two board pictures, four checked images, a refusal', async () => {
    const want = load<{
      brief: Record<string, unknown>
      generate: { kept: number; refused: unknown[]; claudeUsd: number; decisions: string[] }
      refusal: Record<string, unknown>
    }>('h-imagegen.images.json')
    let got: Record<string, unknown> = {}
    await replay('h-imagegen', async () => {
      const piece = await api.call('pieces.create', { kind: 'pendant', title: 'Trophy pendant' })
      const board = await api.call('boards.forPiece', { pieceId: piece.id })
      const ctx = await s.server.runtime.context(s.server.runtime.local!)
      const picture = async (name: string, color: string) =>
        putAsset(ctx, {
          bytes: await sharp({ create: { width: 96, height: 96, channels: 3, background: color } })
            .png()
            .toBuffer(),
          name,
        })
      const [a, b] = await api.call('references.save', {
        boardId: board.id,
        items: [
          { assetId: (await picture('trophy.png', '#c9a13b')).id, title: 'The trophy' },
          { assetId: (await picture('pendant.png', '#b8902a')).id, title: 'A pendant I like' },
        ],
      })
      const brief = await api.call('references.brief', {
        boardId: board.id,
        request: 'This trophy as a pendant, in the style of this pendant.',
        referenceIds: [a!.id, b!.id],
        roles: [
          { id: a!.id, role: 'subject' },
          { id: b!.id, role: 'style' },
        ],
      })
      const gen = await api.call('references.generate', { briefId: brief.id, count: 4 })
      const refusal = await api.call('references.brief', {
        boardId: board.id,
        request:
          'A pendant with a portrait of Taylor Swift engraved in the centre, like the pendant on the board.',
        referenceIds: [b!.id],
        roles: [{ id: b!.id, role: 'style' }],
      })
      got = {
        brief: {
          verdict: brief.verdict,
          category: brief.category,
          prompt: brief.prompt,
          understanding: brief.understanding,
          piece: brief.piece,
          claudeUsd: brief.claudeUsd,
        },
        generate: {
          kept: gen.references.length,
          refused: gen.refused,
          claudeUsd: gen.cost.claudeUsd,
          decisions: gen.brief.decisions.map((d) => `${d.stage}:${d.index}:${d.verdict}`),
        },
        refusal: {
          verdict: refusal.verdict,
          category: refusal.category,
          reason: refusal.reason,
          prompt: refusal.prompt,
          claudeUsd: refusal.claudeUsd,
        },
      }
      return [piece.id]
    })
    expect(got.brief).toEqual(want.brief)
    expect(got.generate).toEqual(want.generate)
    expect(got.refusal).toEqual(want.refusal)
  }, 600_000)
})
