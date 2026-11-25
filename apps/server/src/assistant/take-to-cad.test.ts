/**
 * From the design board to CAD, on the real loop and the real kernel with a scripted model
 * standing in for Claude:
 *
 * - Take to CAD: the CAD job reads the board's picture, asks the five spec questions with the
 *   picture's answers as defaults, estimates weight, carats and cost before building, builds from
 *   the picture, and the picture then lies in the matching CAD view, scaled to the build;
 * - the run's spend counts against the CAD stage of that project;
 * - Open as CAD, per format: STL, OBJ, GLB, 3MF and PLY become a sculpted body the kernel
 *   evaluates; STEP is refused with a sentence saying it is planned;
 * - pieces.estimate prices a spec before anything is built;
 * - variants of the CAD (directions) still work as the optional side path, from the current CAD.
 */
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { specQuestions } from '@pave/agent'
import type { PhotoRead, PieceSpecInput, Run } from '@pave/schema'
import { PieceSpecSchema } from '@pave/schema'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BOOT_TIMEOUT, type Client, client } from '../test/harness'
import { type AssistantServer, assistantServer, text, tool } from './testing'

const KEY = 'sk-ant-test-0000000000000000000000000000-TAKE'
const SLOW = 240_000

let s: AssistantServer
let api: Client
let n = 0
const cm = () => `tc${++n}`

beforeAll(async () => {
  s = await assistantServer({ env: { ANTHROPIC_API_KEY: KEY }, engines: true })
  api = client(s.server)
}, BOOT_TIMEOUT)
afterAll(() => s.server.dispose())

async function until(runId: string, status: Run['status'], tries = 12000): Promise<Run> {
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
        if (b.type === 'tool_result' && b.tool_use_id === toolUseId) {
          const content = b.content as { type: string; text?: string }[]
          return {
            isError: b.is_error === true,
            text: content
              .filter((c) => c.type === 'text')
              .map((c) => c.text!)
              .join('\n'),
          }
        }
  throw new Error(`no result for ${toolUseId}`)
}

async function upload(name: string, bytes: Uint8Array | Buffer, type: string) {
  const form = new FormData()
  form.set('file', new File([bytes], name, { type }))
  const res = await api.request('/api/assets', { method: 'POST', body: form })
  expect(res.status, await res.clone().text()).toBe(201)
  return (await res.json()) as { id: string }
}

/** A plain picture with a dark ring-sized blob in the middle: a cut-out the matte can trust. */
async function boardPicture() {
  const w = 400
  const h = 300
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#f4f4f2"/><circle cx="200" cy="150" r="80" fill="none" stroke="#7a5a20" stroke-width="22"/><circle cx="200" cy="62" r="20" fill="#9ab"/></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

const READ: PhotoRead = {
  observations: 'A round brilliant solitaire in four claws on a plain band, seen from the front.',
  kind: { value: 'ring', visible: 'yes' },
  view: 'front',
  archetype: { value: 'solitaire', visible: 'yes' },
  stones: [
    {
      role: 'center',
      cut: 'round',
      arrangement: 'single',
      setting: 'prong',
      prongs: 4,
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
  metal: { colour: 'yellow', finish: 'polished', visible: 'yes' },
  notVisible: ['the inside of the band'],
  unsure: [],
  plainBackground: true,
}

describe('Take to CAD', () => {
  it(
    'asks the specs with the picture’s defaults, estimates, builds, and lays the picture in its view',
    async () => {
      const piece = await api.call('pieces.create', { title: 'From the board', kind: 'ring' })
      const board = await api.call('boards.forPiece', { pieceId: piece.id })
      const asset = await upload('pendant-i-like.png', await boardPicture(), 'image/png')
      const [ref] = await api.call('references.save', {
        boardId: board.id,
        items: [{ assetId: asset.id, title: 'A ring I like' }],
      })
      const { pin } = await api.call('pieces.takeToCad', {
        pieceId: piece.id,
        referenceId: ref!.id,
      })
      expect(pin.plane).toBeNull()

      let questions: unknown = null
      let spec: PieceSpecInput | null = null
      s.model.push(
        {
          content: [tool('references_read', { assetIds: [asset.id] }, 'toolu_read')],
          stop_reason: 'tool_use',
        },
        { content: [text(JSON.stringify(READ))] },
        ({ params }) => {
          const read = result(params, 'toolu_read')
          expect(read.isError, read.text).toBe(false)
          const out = JSON.parse(read.text) as { questions: unknown; specDraft: PieceSpecInput }
          questions = out.questions
          spec = out.specDraft
          return {
            content: [
              tool(
                'chat_ask',
                { intro: 'A round solitaire in four claws, seen from the front.', questions },
                'toolu_ask',
              ),
            ],
            stop_reason: 'tool_use',
          }
        },
        ({ params, pieceId: p }) => {
          const answers = result(params, 'toolu_ask')
          expect(answers.isError, answers.text).toBe(false)
          // The person changed the size to US 7 and kept the rest.
          expect(answers.text).toMatch(/US 7/)
          const answered = PieceSpecSchema.parse({
            ...spec!,
            ring: { ...spec!.ring!, size: { system: 'us', value: 7 } },
          })
          return {
            content: [
              tool('pieces_setSpec', { id: p, spec: answered }, 'toolu_spec'),
              tool('pieces_estimate', { id: p, spec: answered }, 'toolu_est'),
            ],
            stop_reason: 'tool_use',
          }
        },
        ({ params, pieceId: p }) => {
          const est = result(params, 'toolu_est')
          if (est.isError) console.error('estimate failed:', est.text)
          expect(est.isError, est.text).toBe(false)
          const e = JSON.parse(est.text) as {
            metalMassG: number
            caratTotal: number
            costUsd: number | null
          }
          expect(e.metalMassG).toBeGreaterThan(0.5)
          expect(e.caratTotal).toBeGreaterThan(0.5)
          expect(e.costUsd).toBeGreaterThan(0)
          return {
            content: [tool('pieces_buildFromSpec', { id: p }, 'toolu_build')],
            stop_reason: 'tool_use',
          }
        },
        ({ params }) => {
          const built = result(params, 'toolu_build')
          expect(built.isError, built.text).toBe(false)
          expect(built.text).toMatch(/lies in the front view as an image plane, scaled/)
          return { content: [text('Built from your picture.')], stop_reason: 'end_turn' }
        },
      )
      const goal = 'Build the CAD from this picture.'
      const { run } = await api.call('threads.send', {
        text: goal,
        attachments: [asset.id],
        context: { pieceId: piece.id, selection: [], stage: 'design' },
        job: { stage: 'cad', goal },
        clientId: 'test',
        clientMessageId: cm(),
      })
      // The questions wait like an approval; the person changes the size and presses Go.
      await until(run.id, 'awaiting-approval')
      const { steps } = await api.call('traces.run', { id: run.id })
      const ask = steps.find((x) => x.name === 'chat.ask' && x.status === 'awaiting-approval')!
      const asked = (ask.input as { questions: { id: string }[] }).questions
      expect(asked.map((q) => q.id)).toEqual(['kind', 'size', 'centre-stone', 'metal', 'budget'])
      await api.call('runs.decide', {
        runId: run.id,
        toolCallId: ask.toolCallId!,
        decision: 'approve',
        answers: { size: ['us-7'] },
      })
      // Then the build waits for its go-ahead on the spec card (with the estimate beside it).
      await until(run.id, 'awaiting-approval')
      const build = (await api.call('traces.run', { id: run.id })).steps.find(
        (x) => x.name === 'pieces.buildFromSpec' && x.status === 'awaiting-approval',
      )!
      const estimate = await api.call('pieces.estimate', { id: piece.id })
      expect(estimate.metalMassG).toBeGreaterThan(0.5)
      await api.call('runs.decide', {
        runId: run.id,
        toolCallId: build.toolCallId!,
        decision: 'approve',
      })
      const done = await until(run.id, 'done')

      // The questions are the read's: their defaults are what the picture showed.
      expect(questions).toEqual(specQuestions(PieceSpecSchema.parse(spec!)))
      const after = await api.call('pieces.get', { id: piece.id })
      expect(after.spec?.ring?.size).toEqual({ system: 'us', value: 7 })
      expect(Object.keys(after.design.nodes).length).toBeGreaterThan(2)
      // The picture lies in the front view, centred on the ring and scaled to it.
      const placed = (await api.call('references.pins', { pieceId: piece.id })).references[0]!
      expect(placed.plane?.view).toBe('front')
      expect(placed.plane!.width).toBeGreaterThan(15)
      expect(placed.plane!.width).toBeLessThan(80)

      // Spend: the job's stage (CAD) wins over the tab the message was sent from (Design).
      expect(done.stage).toBe('cad')
      const { projects } = await api.call('projects.summary', { pieceIds: [piece.id] })
      expect(projects[0]!.cad.aiUsd).toBeGreaterThan(0)
      expect(projects[0]!.design.aiUsd).toBe(0)
    },
    SLOW,
  )

  it(
    'a chat about a project counts against the stage tab it was sent from',
    async () => {
      const piece = await api.call('pieces.create', { title: 'Chat', kind: 'ring' })
      s.model.push({ content: [text('A short answer.')], stop_reason: 'end_turn' })
      const { run } = await api.call('threads.send', {
        text: 'What metal suits this?',
        attachments: [],
        context: { pieceId: piece.id, selection: [], stage: 'render' },
        clientId: 'test',
        clientMessageId: cm(),
      })
      const done = await until(run.id, 'done')
      expect(done.stage).toBe('render')
      const usage = await api.call('usage.summary', { days: 1 })
      expect(usage.recent.find((u) => u.runId === run.id)).toMatchObject({
        stage: 'render',
        pieceId: piece.id,
      })
    },
    SLOW,
  )
})

/** An ASCII PLY of a closed tetrahedron, 10 mm on a side. */
const PLY = `ply
format ascii 1.0
element vertex 4
property float x
property float y
property float z
element face 4
property list uchar int vertex_indices
end_header
0 0 0
10 0 0
0 10 0
0 0 10
3 0 2 1
3 0 1 3
3 0 3 2
3 1 2 3
`

describe('Open as CAD', () => {
  it(
    'opens STL, OBJ, GLB, 3MF and PLY as a sculpted body the kernel evaluates; STEP is planned',
    async () => {
      const spec = PieceSpecSchema.parse({
        kind: 'ring',
        archetype: 'band',
        title: 'Plain band',
        summary: 'A plain court band.',
        ring: { size: { system: 'us', value: 6 }, bandWidthMm: 3 },
      })
      const source = await api.call('pieces.create', { title: 'Band', spec })
      const files: { id: string; format: string }[] = []
      for (const format of ['stl', 'obj', 'glb', '3mf'] as const) {
        const { asset } = await api.call('design.export', {
          pieceId: source.id,
          format,
          stones: false,
        })
        files.push({ id: asset.id, format })
      }
      files.push({
        id: (await upload('tetra.ply', new TextEncoder().encode(PLY), 'model/ply')).id,
        format: 'ply',
      })

      for (const file of files) {
        const { piece, nodeId } = await api.call('pieces.openAsCad', { assetId: file.id })
        expect(piece.design.nodes[nodeId], file.format).toMatchObject({ kind: 'meshBody' })
        const facts = await api.call('design.evaluate', { pieceId: piece.id })
        expect(facts.metalMassG, `${file.format} evaluates to metal`).toBeGreaterThan(0.01)
        const history = await api.call('design.history', { pieceId: piece.id })
        expect(JSON.stringify(history)).toMatch(/Opened .* as CAD/)
      }
      // Into an existing piece: one change that adds the body, undoable.
      const target = await api.call('pieces.create', { templateId: 'solitaire' })
      const before = Object.keys(target.design.nodes).length
      const opened = await api.call('pieces.openAsCad', {
        assetId: files[0]!.id,
        pieceId: target.id,
      })
      expect(opened.piece.id).toBe(target.id)
      expect(Object.keys(opened.piece.design.nodes)).toHaveLength(before + 1)

      const step = await upload(
        'part.step',
        new TextEncoder().encode('ISO-10303-21;'),
        'model/step',
      )
      const refused = await api.fail('pieces.openAsCad', { assetId: step.id })
      expect(refused.status).toBe(400)
      expect(refused.error.message).toMatch(
        /STEP files cannot be opened as CAD yet; that is planned/,
      )
    },
    SLOW,
  )
})

describe('variants of the CAD (the optional side path)', () => {
  it(
    'proposes variants of the current CAD and choosing one replaces it as one undoable change',
    async () => {
      const piece = await api.call('pieces.create', { templateId: 'solitaire' })
      const { directions } = await api.call('pieces.proposeDirections', {
        pieceId: piece.id,
        directions: [
          { templateId: 'halo', name: 'With a halo', tradeOff: 'More sparkle, more upkeep' },
        ],
      })
      expect(directions[0]!.facts?.metalMassG).toBeGreaterThan(0)
      const chosen = await api.call('pieces.chooseDirection', {
        pieceId: piece.id,
        directionId: directions[0]!.letter,
      })
      const history = await api.call('design.history', { pieceId: piece.id })
      expect(chosen.version).toBeGreaterThan(piece.version)
      expect(JSON.stringify(history)).toMatch(/With a halo/)
    },
    SLOW,
  )
})
