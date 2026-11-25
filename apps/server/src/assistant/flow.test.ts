/**
 * One flow, by hand or with the AI (step 11), on the real loop and the real kernel with a
 * scripted model standing in for Claude:
 *
 * - every job asks before acting, and the person's answers join the job's plan under the step
 *   that asked;
 * - "update the design to this new reference" is a CAD job against the newly pinned picture:
 *   it reads the picture, edits the existing design, and the whole run is undone in one step;
 * - shot references: the Render job copies a reference shot into its camera placement, and the
 *   framing capture carries the reference beside it (for the person, and for the model to
 *   compare); a view-only reference never leaves.
 */
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { PhotoRead, Run, RunEvent } from '@pave/schema'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BOOT_TIMEOUT, type Client, client } from '../test/harness'
import { type AssistantServer, assistantServer, text, tool } from './testing'

const KEY = 'sk-ant-test-0000000000000000000000000000-FLOW'
const SLOW = 180_000

let s: AssistantServer
let api: Client
let n = 0
const cm = () => `fl${++n}`
const events: RunEvent[] = []

beforeAll(async () => {
  s = await assistantServer({ env: { ANTHROPIC_API_KEY: KEY }, engines: true })
  api = client(s.server)
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
    `run ${runId} never reached ${status}: ${run.status} ${run.error ?? ''} ${JSON.stringify(steps.map((x) => [x.name, x.status, x.isError, x.output]))}`,
  )
}

/** A tool result in a request: its text blocks, and how many images it carries. */
function result(params: BetaMessageStreamParams, toolUseId: string) {
  for (const m of params.messages)
    if (Array.isArray(m.content))
      for (const b of m.content as unknown as Record<string, unknown>[])
        if (b.type === 'tool_result' && b.tool_use_id === toolUseId) {
          const content = b.content as { type: string; text?: string }[]
          return {
            isError: b.is_error === true,
            texts: content.filter((c) => c.type === 'text').map((c) => c.text!),
            images: content.filter((c) => c.type === 'image').length,
          }
        }
  throw new Error(`no result for ${toolUseId}`)
}

/** Image blocks in the latest user turn that is not only tool results (the person's message). */
function messageImages(params: BetaMessageStreamParams): number {
  const user = params.messages.findLast(
    (m) =>
      m.role === 'user' &&
      Array.isArray(m.content) &&
      (m.content as { type: string }[]).some((b) => b.type !== 'tool_result'),
  )
  return ((user?.content ?? []) as { type: string }[]).filter((b) => b.type === 'image').length
}

async function upload(name: string, rgb: { r: number; g: number; b: number }) {
  const png = await sharp({ create: { width: 96, height: 96, channels: 3, background: rgb } })
    .png()
    .toBuffer()
  const form = new FormData()
  form.set('file', new File([png], name, { type: 'image/png' }))
  const res = await api.request('/api/assets', { method: 'POST', body: form })
  return (await res.json()) as { id: string }
}

/** The read Claude would give of the new reference: the same solitaire, now with six claws. */
const READ: PhotoRead = {
  observations: 'A round brilliant in six claws on a plain court band.',
  kind: { value: 'ring', visible: 'yes' },
  view: 'threeQuarter',
  archetype: { value: 'solitaire', visible: 'yes' },
  stones: [
    {
      role: 'center',
      cut: 'round',
      arrangement: 'single',
      setting: 'prong',
      prongs: 6,
      countVisible: 1,
      widthToCentre: 1,
      visible: 'yes',
    },
  ],
  band: {
    profile: 'court',
    shoulder: 'plain',
    widthToStone: 0.3,
    taperTopToBottom: 1,
    visible: 'yes',
  },
  body: null,
  metal: { colour: 'white', finish: 'polished', visible: 'yes' },
  notVisible: ['the inside of the band'],
  unsure: [],
  plainBackground: true,
}

describe('every job asks first, and the answers join its plan', () => {
  it(
    'the CAD job asks what the spec leaves open; Go with one change settles it, shown under the step',
    async () => {
      const pieceId = (await api.call('pieces.create', { templateId: 'solitaire' })).id
      s.model.push(
        {
          content: [
            tool(
              'chat_ask',
              {
                intro: 'A four-claw solitaire; the spec leaves the size and the metal open.',
                questions: [
                  {
                    id: 'size',
                    question: 'Ring size?',
                    options: [
                      { id: 'us6', label: 'US 6' },
                      { id: 'us7', label: 'US 7' },
                    ],
                    defaults: ['us6'],
                  },
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
              'toolu_ask',
            ),
          ],
          stop_reason: 'tool_use',
        },
        ({ params }) => {
          expect(result(params, 'toolu_ask').texts.join(' ')).toContain('Metal? Platinum')
          return { content: [text('Doing it: US 6 in platinum.')], stop_reason: 'end_turn' }
        },
      )
      const { run } = await api.call('threads.send', {
        text: 'Make the CAD',
        clientId: 'w1',
        clientMessageId: cm(),
        context: { pieceId },
        job: { stage: 'cad' },
      } as never)
      const waiting = await until(run.id, 'awaiting-approval')
      expect(waiting.job?.plan[0]).toMatchObject({ id: 'brief', state: 'running' })
      expect(waiting.job?.answers ?? []).toEqual([])
      await api.call('runs.decide', {
        runId: run.id,
        toolCallId: 'toolu_ask',
        decision: 'approve',
        answers: { metal: ['pt'] },
      })
      const done = await until(run.id, 'done')
      expect(done.job?.answers).toEqual([
        { stepId: 'brief', id: 'size', question: 'Ring size?', answer: 'US 6', default: true },
        { stepId: 'brief', id: 'metal', question: 'Metal?', answer: 'Platinum', default: false },
      ])
      // Every window learns it from the live stream too.
      const updated = events.filter(
        (e): e is Extract<RunEvent, { type: 'job.updated' }> =>
          e.runId === run.id && e.type === 'job.updated',
      )
      expect(updated.some((e) => e.job.answers?.length === 2)).toBe(true)
      // A resumed job is told what is settled, so it does not ask again.
      s.model.push(({ params }) => {
        const said = JSON.stringify(params.messages.at(-2)?.content ?? params.messages)
        expect(said).toContain('Already answered (do not ask again)')
        return { content: [text('Nothing left to ask.')], stop_reason: 'end_turn' }
      })
      const resumed = await api.call('runs.resume', {
        runId: run.id,
        redoStepId: 'build',
        clientId: 'w1',
        clientMessageId: cm(),
      })
      const again = await until(resumed.run.id, 'done')
      expect(again.job?.answers).toHaveLength(2)
    },
    SLOW,
  )
})

describe('update the design to a new reference', () => {
  it(
    'runs as a CAD job against the newly pinned picture, and Undo all takes it back',
    async () => {
      const pieceId = (await api.call('pieces.create', { templateId: 'solitaire' })).id
      const before = await api.call('pieces.get', { id: pieceId })
      const claws = (before.design.nodes.head as { prongCount: number }).prongCount
      expect(claws).toBe(4)
      const ref = await upload('new-reference.png', { r: 236, g: 234, b: 228 })
      const [pin] = await api.call('references.pin', {
        pieceId,
        items: [{ assetId: ref.id, title: 'Six-claw reference' }],
      })
      expect(pin!.assetId).toBe(ref.id)

      s.model.push(
        ({ params }) => {
          // The new reference arrives as a picture with the job's message.
          expect(messageImages(params)).toBeGreaterThanOrEqual(1)
          return {
            content: [tool('references_read', { assetIds: [ref.id] }, 'toolu_read')],
            stop_reason: 'tool_use',
          }
        },
        // The read itself: a separate structured call on the run's own client.
        { content: [text(JSON.stringify(READ))] },
        ({ params, pieceId: p }) => {
          const read = result(params, 'toolu_read')
          expect(read.isError, read.texts.join(' ')).toBe(false)
          // The existing design is edited, not rebuilt: the archetype has not changed.
          return {
            content: [
              tool(
                'design_apply',
                {
                  pieceId: p,
                  ops: [{ t: 'update', id: 'head', patch: { prongCount: 6 } }],
                  label: 'Six claws, as in the new reference',
                },
                'toolu_apply',
              ),
            ],
            stop_reason: 'tool_use',
          }
        },
        {
          content: [text('Updated to the new reference: six claws; the rest already matched.')],
          stop_reason: 'end_turn',
        },
      )
      const { run } = await api.call('threads.send', {
        text: 'Update the design to this new reference image',
        attachments: [ref.id],
        clientId: 'w1',
        clientMessageId: cm(),
        context: { pieceId },
        job: { stage: 'cad', goal: 'Update the design to the new reference image.' },
      } as never)
      const done = await until(run.id, 'done')
      expect(done.job).toMatchObject({ stage: 'cad', review: 'pending' })
      const after = await api.call('pieces.get', { id: pieceId })
      expect((after.design.nodes.head as { prongCount: number }).prongCount).toBe(6)
      // The person can inspect it: the change is in the history under this run.
      const history = await api.call('design.history', { pieceId, limit: 20 })
      expect(
        history.some(
          (c) => c.actor.type === 'agent' && c.actor.runId === run.id && c.label.includes('Six'),
        ),
      ).toBe(true)
      // And undo the whole job in one step.
      await api.call('design.revert', { pieceId, runId: run.id })
      const undone = await api.call('pieces.get', { id: pieceId })
      expect((undone.design.nodes.head as { prongCount: number }).prongCount).toBe(claws)
    },
    SLOW,
  )
})

describe('shot references for renders', () => {
  it(
    'copies the reference into the camera placement and shows it beside the framing capture',
    async () => {
      const pieceId = (await api.call('pieces.create', { templateId: 'solitaire' })).id
      const ref = await upload('profile-reference.png', { r: 250, g: 250, b: 250 })
      await api.call('references.pin', {
        pieceId,
        items: [{ assetId: ref.id, title: 'Eye-level profile on white' }],
      })
      let profileCamera: Record<string, unknown> | null = null
      let shotId = ''
      s.model.push(
        ({ params, pieceId: p }) => {
          expect(messageImages(params)).toBeGreaterThanOrEqual(1)
          return {
            content: [tool('scenes_suggest', { pieceId: p, aspect: '1:1' }, 'toolu_sg')],
            stop_reason: 'tool_use',
          }
        },
        ({ params, pieceId: p }) => {
          // Read as an eye-level profile on white: the suggestion's profile camera, as given.
          const suggested = JSON.parse(result(params, 'toolu_sg').texts[0]!) as {
            shots: { key: string; camera: Record<string, unknown> }[]
          }
          profileCamera = suggested.shots.find((x) => x.key === 'profile')!.camera
          return {
            content: [
              tool(
                'scenes_create',
                {
                  pieceId: p,
                  title: 'Profile, as the reference',
                  scene: {
                    look: 'catalog-white',
                    camera: profileCamera,
                    output: { width: 2000, height: 2000, quality: 'preview' },
                  },
                },
                'toolu_create',
              ),
            ],
            stop_reason: 'tool_use',
          }
        },
        ({ params }) => {
          const created = result(params, 'toolu_create')
          expect(created.isError, created.texts.join(' ')).toBe(false)
          shotId = (JSON.parse(created.texts[0]!) as { id: string }).id
          return {
            content: [
              tool(
                'scenes_capture',
                { ids: [shotId], references: [{ id: shotId, assetId: ref.id }] },
                'toolu_cap',
              ),
            ],
            stop_reason: 'tool_use',
          }
        },
        ({ params }) => {
          const cap = result(params, 'toolu_cap')
          expect(cap.isError, cap.texts.join(' ')).toBe(false)
          // The reference, then the capture through the shot's own camera.
          expect(cap.images).toBe(2)
          expect(cap.texts).toContain('Shot reference for “Profile, as the reference”')
          return {
            content: [text('Profile copied from your reference: eye level, centred, on white.')],
            stop_reason: 'end_turn',
          }
        },
      )
      const { run } = await api.call('threads.send', {
        text: 'Shoot it like this reference',
        attachments: [ref.id],
        clientId: 'w1',
        clientMessageId: cm(),
        context: { pieceId },
        job: { stage: 'render' },
      } as never)
      await until(run.id, 'done')
      // The camera the model read from the reference is the shot's camera.
      const shots = await api.call('scenes.list', { pieceId })
      const shot = shots.find((x) => x.id === shotId)!
      expect(shot.scene.camera).toMatchObject(profileCamera!)
      // The capture names its reference, for the studio's side-by-side card.
      const detail = await api.call('traces.run', { id: run.id })
      const capture = detail.steps.find((x) => x.name === 'scenes.capture')!
      const value = (capture.output as { value: { shots: { referenceAssetId: string | null }[] } })
        .value
      expect(value.shots[0]!.referenceAssetId).toBe(ref.id)
    },
    SLOW,
  )

  it(
    'refuses a view-only reference and a reference for a shot not being captured',
    async () => {
      const pieceId = (await api.call('pieces.create', { templateId: 'solitaire' })).id
      const shot = await api.call('scenes.create', {
        pieceId,
        title: 'Hero',
        scene: { look: 'catalog-white', camera: { preset: 'hero' } },
      } as never)
      const secret = await upload('magazine-scan.png', { r: 20, g: 20, b: 20 })
      await api.call('references.pin', {
        pieceId,
        items: [{ assetId: secret.id, title: 'Magazine scan', rights: 'viewOnly' }],
      })
      await expect(
        api.call('scenes.capture', {
          ids: [shot.id],
          references: [{ id: shot.id, assetId: secret.id }],
        }),
      ).rejects.toMatchObject({ error: { code: 'forbidden' } })
      const own = await upload('own.png', { r: 200, g: 200, b: 200 })
      await expect(
        api.call('scenes.capture', {
          ids: [shot.id],
          references: [{ id: 'scn_elsewhere', assetId: own.id }],
        }),
      ).rejects.toMatchObject({ error: { code: 'bad_request' } })
    },
    SLOW,
  )
})
