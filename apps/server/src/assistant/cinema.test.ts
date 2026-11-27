/**
 * The AI cinematographer on the real loop and the real kernel (the render queue is a fake the
 * tests settle): the job looks at the piece (scenes.suggest), asks its quick questions and waits
 * for Go (chat.ask; the person's picks, or the defaults, come back as the answer), places each
 * camera, checks the framing through the shots' own cameras (scenes.capture) and is refused a
 * take of a shot that cuts the piece off. Then a person acts on what it made, and every action
 * lands as feedback on the run: starred, kept (swapped in, set as cover), reframed, restyled,
 * rerendered, deleted.
 */
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { Feedback, RenderJob, Run, RunEvent } from '@pave/schema'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readAsset } from '../assets/assets'
import type { JobHandle, RenderJobPatch, ServiceContext } from '../services'
import { BOOT_TIMEOUT, type Client, client } from '../test/harness'
import { type AssistantServer, assistantServer, text, tool } from './testing'

const KEY = 'sk-ant-test-0000000000000000000000000000-CINE'
const SLOW = 180_000

class FakeQueue {
  readonly takes = new Map<
    string,
    { job: RenderJob; handle: JobHandle<RenderJobPatch>; sctx: ServiceContext }
  >()
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
    cancel: async () => {},
  }

  async finish(id: string) {
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
      seconds: 40,
      device: 'CPU',
    })
  }
}

let s: AssistantServer
let api: Client
let queue: FakeQueue
let n = 0
const cm = () => `ci${++n}`
const events: RunEvent[] = []

beforeAll(async () => {
  s = await assistantServer({
    env: { ANTHROPIC_API_KEY: KEY },
    engines: true,
    config: { plan: 'pro' },
  })
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

async function until(runId: string, status: Run['status'], tries = 6000): Promise<Run> {
  for (let i = 0; i < tries; i++) {
    const { run } = await api.call('traces.run', { id: runId })
    if (run.status === status && !s.parts.driver.isLive(runId)) return run
    await new Promise((r) => setTimeout(r, 10))
  }
  const { run, steps } = await api.call('traces.run', { id: runId })
  throw new Error(
    `run ${runId} never reached ${status}: ${run.status} ${run.error ?? ''} ${JSON.stringify(steps.map((x) => [x.name, x.status, x.isError]))}`,
  )
}

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

type Suggested = {
  features: string[]
  shots: { key: string; camera: Record<string, unknown>; framing: string }[]
  questions: { id: string; defaults: string[] }[]
}

describe('the Render job looks, asks, places and checks', () => {
  let pieceId: string
  let _runId: string
  let suggested: Suggested
  const shots: string[] = []

  it(
    'looks at the piece and plans its shots, cameras placed and framed for the shape',
    async () => {
      pieceId = (await api.call('pieces.create', { templateId: 'solitaire' })).id
      const out = (await api.call('scenes.suggest', { pieceId, aspect: '4:5' })) as Suggested
      expect(out.features[0]).toMatch(/^Centre stone: round brilliant/)
      expect(out.features.join(' ')).toMatch(/gallery/)
      expect(out.shots.map((x) => x.key)).toEqual(['hero', 'profile', 'top', 'macro', 'low'])
      for (const shot of out.shots) {
        expect(shot.camera.preset).toBe('custom')
        expect(shot.framing).toMatch(/· good/)
      }
      expect(out.shots.find((x) => x.key === 'macro')!.framing).toMatch(/centre stone/)
      expect(out.questions.map((q) => q.id)).toEqual(['purpose', 'aspects', 'motion'])
    },
    SLOW,
  )

  it(
    'asks at most three quick questions and waits; Go with one change answers them',
    async () => {
      s.model.push(
        ({ pieceId: p }) => ({
          content: [tool('scenes_suggest', { pieceId: p, aspect: '1:1' }, 'toolu_sg')],
          stop_reason: 'tool_use',
        }),
        ({ params }) => {
          suggested = JSON.parse(result(params, 'toolu_sg').text.split('\n')[0]!) as Suggested
          return {
            content: [
              tool(
                'chat_ask',
                { intro: 'A four-claw solitaire, about 1 ct.', questions: suggested.questions },
                'toolu_ask',
              ),
            ],
            stop_reason: 'tool_use',
          }
        },
        ({ params }) => {
          const answer = result(params, 'toolu_ask')
          expect(answer.isError).toBe(false)
          expect(answer.text).toContain(
            'The designer answered: What are the images for? Social posts',
          )
          // Untouched questions keep their defaults, and say so.
          expect(answer.text).toContain('Which shapes? 1:1 (your default)')
          return { content: [text('Doing it.')], stop_reason: 'end_turn' }
        },
      )
      const { run } = await api.call('threads.send', {
        text: 'Render it',
        clientId: 'w1',
        clientMessageId: cm(),
        context: { pieceId },
        job: { stage: 'render' },
      } as never)
      _runId = run.id
      const waiting = await until(run.id, 'awaiting-approval')
      // The plan shows the job looking and asking.
      expect(waiting.job?.plan[0]).toMatchObject({ id: 'look', state: 'running' })
      const asked = events.find((e) => e.runId === run.id && e.type === 'tool.awaiting') as Extract<
        RunEvent,
        { type: 'tool.awaiting' }
      >
      expect(asked.name).toBe('chat.ask')
      expect(asked.summary).toBe('A four-claw solitaire, about 1 ct.')
      await api.call('runs.decide', {
        runId: run.id,
        toolCallId: 'toolu_ask',
        decision: 'approve',
        answers: { purpose: ['social'], motion: ['turntable', 'not-an-option'] },
      })
      await until(run.id, 'done')
    },
    SLOW,
  )

  it(
    'takes a typed message instead of Go as the answer',
    async () => {
      s.model.push(
        {
          content: [
            tool(
              'chat_ask',
              { intro: 'A solitaire.', questions: suggested.questions.slice(0, 1) },
              'toolu_ask2',
            ),
          ],
          stop_reason: 'tool_use',
        },
        ({ params }) => {
          const r = result(params, 'toolu_ask2')
          expect(r.isError).toBe(false)
          expect(r.text).toMatch(
            /did not pick from these options. If they wrote a message, it is their answer/,
          )
          return { content: [text('Stills on black, then.')], stop_reason: 'end_turn' }
        },
      )
      const first = await api.call('threads.send', {
        text: 'Shoot it',
        clientId: 'w1',
        clientMessageId: cm(),
        context: { pieceId },
      } as never)
      await until(first.run.id, 'awaiting-approval')
      const second = await api.call('threads.send', {
        threadId: first.thread.id,
        text: 'Just stills on black acrylic',
        clientId: 'w1',
        clientMessageId: cm(),
        context: { pieceId },
      } as never)
      await until(second.run.id, 'done')
    },
    SLOW,
  )

  it(
    'refuses more than three questions, and a default that is not an option',
    async () => {
      const q = suggested.questions[0]!
      s.model.push(
        {
          content: [
            tool('chat_ask', { intro: 'Hi', questions: [q, q, q, q] }, 'toolu_4q'),
            tool(
              'chat_ask',
              { intro: 'Hi', questions: [{ ...q, defaults: ['nope'] }] },
              'toolu_bad',
            ),
          ],
          stop_reason: 'tool_use',
        },
        ({ params }) => {
          expect(result(params, 'toolu_4q').isError).toBe(true)
          expect(result(params, 'toolu_bad').text).toMatch(/default must be one of the options/)
          return { content: [text('ok')], stop_reason: 'end_turn' }
        },
      )
      const { run } = await api.call('threads.send', {
        text: 'Ask me',
        clientId: 'w1',
        clientMessageId: cm(),
        context: { pieceId },
      } as never)
      await until(run.id, 'done')
    },
    SLOW,
  )

  it(
    'checks the framing through each camera, and is refused a take of a cut-off shot',
    async () => {
      const hero = suggested.shots.find((x) => x.key === 'hero')!.camera
      const output = { width: 640, height: 640, quality: 'preview' }
      for (const [title, camera] of [
        ['Hero', hero],
        // The model's mistake: a custom camera from the front, far too close.
        [
          'Profile',
          { preset: 'custom', position: [0, -40, 6], target: [0, 0, 6], focalLength: 100 },
        ],
      ] as const) {
        const created = await api.call('scenes.create', {
          pieceId,
          title,
          scene: { look: 'catalog-white', camera, output },
        } as never)
        shots.push(created.id)
      }
      s.model.push(
        {
          content: [tool('scenes_capture', { ids: shots }, 'toolu_cap')],
          stop_reason: 'tool_use',
        },
        ({ params }) => {
          const r = result(params, 'toolu_cap')
          expect(r.images).toBe(2)
          expect(r.text).toMatch(/Shot “Hero” \(scn_[^)]+\), \d+% · good, framing ok/)
          expect(r.text).toMatch(/Shot “Profile”.*framing problem: The piece is cut off at the/)
          return {
            content: [
              tool('renders_create', { pieceId, sceneId: shots[1] }, 'toolu_bad'),
              tool('renders_create', { pieceId, sceneId: shots[0] }, 'toolu_ok'),
            ],
            stop_reason: 'tool_use',
          }
        },
        ({ params }) => {
          const refused = result(params, 'toolu_bad')
          expect(refused.isError).toBe(true)
          expect(refused.text).toMatch(/^Not rendered: in “Profile” The piece is cut off/)
          expect(refused.text).toContain('scenes.capture')
          expect(result(params, 'toolu_ok').images).toBe(1)
          return { content: [text('Hero is in; fixing the profile.')], stop_reason: 'end_turn' }
        },
      )
      const { run } = await api.call('threads.send', {
        text: 'Check and render',
        clientId: 'w1',
        clientMessageId: cm(),
        context: { pieceId },
        job: { stage: 'render' },
      } as never)
      await until(run.id, 'waiting')
      const takes = await api.call('renders.list', { pieceId })
      // Only the good shot was rendered.
      expect(takes.map((x) => x.sceneId)).toEqual([shots[0]])
      await queue.finish(takes[0]!.id)
      await until(run.id, 'done')
      const capture = await api.call('scenes.capture', { ids: shots, size: 256 })
      expect(capture.shots.map((x) => [x.title, x.ok, x.subject])).toEqual([
        ['Hero', true, 'piece'],
        ['Profile', false, 'piece'],
      ])
      // The pictures are the shots' own shape (square here) and drawn on the server.
      const ctx = await s.server.runtime.context(s.server.runtime.local!)
      const { bytes } = await readAsset(ctx, capture.shots[0]!.assetId!)
      expect(await sharp(bytes).metadata()).toMatchObject({ width: 256, height: 256 })
    },
    SLOW,
  )

  it(
    'lets a person render any shot they like, cut off or not',
    async () => {
      const take = await api.call('renders.create', { pieceId, sceneId: shots[1]! })
      expect(take.status).toBe('queued')
      await queue.finish(take.id)
    },
    SLOW,
  )
})

it(
  'uses each saved jewelry pose when the assistant lists and captures the same CAD piece',
  async () => {
    const { id: pieceId } = await api.call('pieces.create', { kind: 'bracelet' })
    await api.call('design.apply', {
      pieceId,
      label: 'Lay out separate links in a row',
      ops: Array.from({ length: 8 }, (_, i) => ({
        t: 'add',
        node: {
          id: `link${i}`,
          kind: 'primitive',
          shape: 'box',
          size: [3, 2, 2],
          transform: { position: [5 * i, 0, 0] },
        },
      })),
    })
    const piece = await api.call('pieces.get', { id: pieceId })
    const asDesigned = await api.call('scenes.suggest', { pieceId })
    expect(asDesigned.circularBandDiameterMm).toBeCloseTo(38 / Math.PI)
    const suggestion = await api.call('scenes.suggest', { pieceId, pose: 'circular-band' })
    expect(suggestion.sceneOptions).toMatchObject({ pose: 'circular-band' })
    expect(suggestion.shots[0]?.camera).not.toEqual(asDesigned.shots[0]?.camera)
    const create = (title: string, pose: 'as-designed' | 'circular-band') =>
      api.call('scenes.create', { pieceId, title, scene: { pose, camera: { preset: 'top' } } })
    const straight = await create('Straight links', 'as-designed')
    const circular = await create('Curved links', 'circular-band')
    let assetIds: string[] = []
    s.model.push(
      {
        content: [
          tool('scenes_suggest', { pieceId, pose: 'circular-band' }, 'toolu_pose_suggest'),
          tool('scenes_list', { pieceId }, 'toolu_pose_list'),
        ],
        stop_reason: 'tool_use',
      },
      ({ params }) => {
        const suggestion = result(params, 'toolu_pose_suggest')
        expect(suggestion.isError).toBe(false)
        const options = JSON.parse(suggestion.text.split('\n')[0]!)
        expect(options.sceneOptions).toMatchObject({
          pose: 'circular-band',
        })
        expect(options.circularBandDiameterMm).toBeCloseTo(38 / Math.PI)
        const listed = result(params, 'toolu_pose_list')
        const lines = listed.text.split('\n')
        const straightCamera = lines.find((line) => line.startsWith('- "Straight links"'))
        const circularCamera = lines.find((line) => line.startsWith('- "Curved links"'))
        expect(straightCamera).toBeDefined()
        expect(circularCamera).toBeDefined()
        expect(straightCamera?.split('): ')[1]).not.toEqual(circularCamera?.split('): ')[1])
        return {
          content: [
            tool(
              'scenes_capture',
              { ids: [straight.id, circular.id], size: 192 },
              'toolu_pose_capture',
            ),
          ],
          stop_reason: 'tool_use',
        }
      },
      ({ params }) => {
        const captured = result(params, 'toolu_pose_capture')
        expect(captured.isError).toBe(false)
        expect(captured.images).toBe(2)
        const measured = JSON.parse(captured.text.split('\n')[0]!) as {
          version: number
          shots: { id: string; assetId: string }[]
        }
        expect(measured.version).toBe(piece.version)
        expect(measured.shots.map(({ id }) => id)).toEqual([straight.id, circular.id])
        assetIds = measured.shots.map(({ assetId }) => assetId)
        return { content: [text('Both compositions are ready.')], stop_reason: 'end_turn' }
      },
    )
    const { run } = await api.call('threads.send', {
      text: 'Check both shots through their saved cameras.',
      clientId: 'w1',
      clientMessageId: cm(),
      context: { pieceId },
    })
    await until(run.id, 'done')
    const ctx = await s.server.runtime.context(s.server.runtime.local!)
    const [straightImage, circularImage] = await Promise.all(
      assetIds.map((id) => readAsset(ctx, id)),
    )
    expect(straightImage?.bytes).toBeDefined()
    expect(circularImage?.bytes).toBeDefined()
    expect(straightImage?.bytes).not.toEqual(circularImage?.bytes)
    expect(await api.call('pieces.get', { id: pieceId })).toMatchObject({
      design: piece.design,
      version: piece.version,
    })
  },
  SLOW,
)

it(
  'tells the assistant to use the as-designed pose when circular band does not fit',
  async () => {
    const { id: pieceId } = await api.call('pieces.create', { templateId: 'solitaire' })
    const refused = await api.fail('scenes.suggest', { pieceId, pose: 'circular-band' })
    expect(refused.status).toBe(400)
    expect(refused.error.message).toContain('as-designed')
  },
  SLOW,
)

describe('what a person does after the assistant is recorded on its run', () => {
  it(
    'stars, keeps, swaps, reframes, restyles, re-renders and deletes',
    async () => {
      const pieceId = (await api.call('pieces.create', { templateId: 'solitaire' })).id
      const output = { width: 512, height: 512, quality: 'preview' }
      s.model.push(
        {
          content: [
            tool(
              'scenes_create',
              {
                pieceId,
                title: 'Hero',
                scene: {
                  look: 'catalog-white',
                  camera: { preset: 'hero', focalLength: 90 },
                  output,
                },
              },
              'toolu_s1',
            ),
          ],
          stop_reason: 'tool_use',
        },
        ({ params }) => {
          const id = /"id":"(scn_[^"]+)"/.exec(result(params, 'toolu_s1').text)![1]!
          return {
            content: [
              tool('renders_create', { pieceId, sceneId: id, title: 'Hero' }, 'toolu_r1'),
              tool('renders_create', { pieceId, sceneId: id, title: 'Hero 2' }, 'toolu_r2'),
            ],
            stop_reason: 'tool_use',
          }
        },
        { content: [text('Two takes of the hero.')], stop_reason: 'end_turn' },
      )
      const { run } = await api.call('threads.send', {
        text: 'Render a hero',
        clientId: 'w1',
        clientMessageId: cm(),
        context: { pieceId },
        job: { stage: 'render' },
      } as never)
      await until(run.id, 'waiting')
      const [a, b] = (await api.call('renders.list', { pieceId })).toSorted((x, y) =>
        x.title.localeCompare(y.title),
      )
      await queue.finish(a!.id)
      await queue.finish(b!.id)
      await until(run.id, 'done')
      const [shot] = await api.call('scenes.list', { pieceId })
      expect(shot!.title).toBe('Hero')

      // The person's actions.
      await api.call('renders.update', { id: a!.id, starred: true })
      await api.call('renders.update', { id: a!.id, starred: false })
      await api.call('scenes.update', { id: shot!.id, takeId: b!.id })
      const take = await api.call('renders.get', { id: a!.id })
      await api.call('pieces.update', { id: pieceId, coverAssetId: take.assetIds[0]! })
      await api.call('scenes.update', {
        id: shot!.id,
        patch: { camera: { focalLength: 105 }, sparkle: 0.8 },
      })
      // A lock says nothing about the framing.
      await api.call('scenes.update', { id: shot!.id, patch: { camera: { locked: true } } })
      const again = await api.call('renders.create', {
        pieceId,
        sceneId: shot!.id,
        retryOf: b!.id,
        note: 'warmer',
      })
      await queue.finish(again.id)
      await api.call('renders.delete', { id: b!.id })
      // A person's own take, starred, is nobody's feedback.
      await api.call('renders.update', { id: again.id, starred: true })

      const { feedback, steps } = await api.call('traces.run', { id: run.id })
      const stepOf = (callId: string) => steps.find((x) => x.toolCallId === callId)!.id
      const got = (feedback as Feedback[]).map((f) => [f.kind, f.target, f.stepId])
      expect(got).toEqual(
        expect.arrayContaining([
          ['starred', `render:${a!.id}`, stepOf('toolu_r1')],
          ['unstarred', `render:${a!.id}`, stepOf('toolu_r1')],
          ['kept', `render:${b!.id}`, stepOf('toolu_r2')],
          ['kept', `render:${a!.id}`, stepOf('toolu_r1')],
          ['reframed', `scene:${shot!.id}`, stepOf('toolu_s1')],
          ['restyled', `scene:${shot!.id}`, stepOf('toolu_s1')],
          ['rerendered', `render:${b!.id}`, stepOf('toolu_r2')],
          ['deleted', `render:${b!.id}`, stepOf('toolu_r2')],
        ]),
      )
      expect(got).toHaveLength(8)
      expect((feedback as Feedback[]).every((f) => f.source === 'implicit')).toBe(true)
      expect((feedback as Feedback[]).find((f) => f.kind === 'kept')!.detail).toMatch(
        /which the assistant rendered/,
      )
    },
    SLOW,
  )
})
