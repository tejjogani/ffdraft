/**
 * Variants of the CAD (the optional side path in the CAD stage, which used to be the Design
 * stage) and the CAD job, on the real loop and the real kernel: "Try variants" turns a brief into
 * three built variants, a mix of two, a pick and a chat edit on the chosen one; then the CAD job
 * finds a seeded manufacturability warning, is paused by a person's edit, resumed, fixes the
 * warning and is accepted. Variants made by hand (templates) are covered too.
 */
import { VARIANTS_PROMPT } from '@pave/agent/studio'
import { ScriptAbortError } from '@pave/agent'
import type { PieceSpecInput } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BOOT_TIMEOUT, type Client, client } from '../test/harness'
import { type AssistantServer, assistantServer, settled, text, tool } from './testing'

const KEY = 'sk-ant-test-0000000000000000000000000000-DSGN'
const SLOW = 180_000

let s: AssistantServer
let api: Client
let n = 0
const cm = () => `ds${++n}`
const states = (job: { plan: { state: string }[] } | null) => job?.plan.map((p) => p.state)

beforeAll(async () => {
  s = await assistantServer({ env: { ANTHROPIC_API_KEY: KEY }, engines: true })
  api = client(s.server)
}, BOOT_TIMEOUT)
afterAll(() => s.server.dispose())

const ring = (over: Partial<PieceSpecInput>): PieceSpecInput => ({
  kind: 'ring',
  archetype: 'solitaire',
  title: 'Direction',
  summary: 'A ring.',
  style: ['classic'],
  metal: { alloy: 'au18k-yellow' },
  ring: { size: { system: 'us', value: 6 } },
  stones: [{ role: 'center', cut: 'round', carat: 1, setting: 'prong', prongs: 4 }],
  ...over,
})

/** Three directions that differ in one big decision each: how the centre stone is presented. */
const THREE = [
  {
    name: 'Low bezel',
    idea: 'A 1 ct round in a low bezel on a fine band, for hands that work.',
    tradeOff: 'Shows less of the stone; the most durable of the three.',
    spec: ring({
      title: 'Low bezel',
      summary: 'A 1 ct round in a low bezel.',
      style: ['minimal'],
      stones: [{ role: 'center', cut: 'round', carat: 1, setting: 'bezel' }],
    }),
  },
  {
    name: 'Cushion halo',
    idea: 'A 1 ct cushion framed by a pavé halo on a substantial band.',
    tradeOff: 'Looks a carat bigger for less; more small stones to keep tight.',
    spec: ring({
      title: 'Cushion halo',
      archetype: 'halo',
      metal: { alloy: 'au18k-white', plating: 'rhodium' },
      ring: { size: { system: 'us', value: 6 }, bandWidthMm: 2.6 },
      stones: [
        { role: 'center', cut: 'cushion', carat: 1 },
        { role: 'halo', widthMm: 1.3 },
      ],
    }),
  },
  {
    name: 'Three-stone',
    idea: 'A 0.7 ct oval between two pears, past, present and future.',
    tradeOff: 'A smaller centre for the budget; the widest head to catch.',
    spec: ring({
      title: 'Three-stone',
      archetype: 'threeStone',
      stones: [
        { role: 'center', cut: 'oval', carat: 0.7 },
        { role: 'side', cut: 'pear', carat: 0.25 },
      ],
    }),
  },
]

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

const directionOf = async (pieceId: string, letter: string) => {
  const piece = await api.call('pieces.get', { id: pieceId })
  const d = piece.directions.find((x) => x.letter === letter)
  if (!d) throw new Error(`no direction ${letter}`)
  return d
}

/** The text of every tool result the model was sent in the last request. */
const lastResults = () => {
  const req = s.model.requests.at(-1)!
  const last = req.messages.at(-1)!
  return JSON.stringify(last.content)
}

describe('variants in the CAD stage, then the CAD job', () => {
  let pieceId = ''
  let threadId = ''

  it(
    'proposes three built directions from a brief, then mixes, picks and edits by chat',
    async () => {
      const piece = await api.call('pieces.create', {
        title: 'Anniversary ring',
        brief: 'A ring for our tenth anniversary. About a carat. She works with her hands.',
      } as never)
      pieceId = piece.id
      expect(piece.directions).toEqual([])

      // 1. Try variants: read the brief, build three variants, ask the designer to choose.
      s.model.push(
        { content: [tool('pieces_get', { id: piece.id })] },
        { content: [tool('pieces_proposeDirections', { pieceId: piece.id, directions: THREE })] },
        { content: [text('Three directions: A protects, B looks biggest, C tells a story.')] },
      )
      const first = await api.call('threads.send', {
        text: VARIANTS_PROMPT,
        context: { pieceId: piece.id, stage: 'cad' },
        clientId: 'w1',
        clientMessageId: cm(),
      })
      threadId = first.thread.id
      await settled(s.parts, first.run.id, SLOW)
      const run1 = (await api.call('traces.run', { id: first.run.id })).run
      expect(run1.status).toBe('done')
      // Variants are a side path: a message, not a job, its spend counted against CAD.
      expect(run1.job).toBeNull()
      expect(run1.stage).toBe('cad')

      const proposed = await api.call('pieces.get', { id: piece.id })
      expect(proposed.directions.map((d) => [d.letter, d.name, d.origin])).toEqual([
        ['A', 'Low bezel', 'assistant'],
        ['B', 'Cushion halo', 'assistant'],
        ['C', 'Three-stone', 'assistant'],
      ])
      for (const d of proposed.directions) {
        // Built and evaluated by the kernel, priced, drawn, and tied to the call that made it.
        expect(d.facts?.metalMassG).toBeGreaterThan(1)
        expect(d.facts?.caratTotal).toBeGreaterThan(0.5)
        expect(d.facts?.costUsd).toBeGreaterThan(100)
        expect(d.facts?.errors).toBe(0)
        expect(d.previewAssetIds).toHaveLength(1)
        expect(d.runId).toBe(first.run.id)
        expect(d.toolCallId).toMatch(/^toolu_/)
      }
      // The halo direction has the most stones; the three-stone has three.
      const [a, b, c] = proposed.directions
      expect(b!.facts!.stoneCount).toBeGreaterThan(10)
      expect(c!.facts!.stoneCount).toBe(3)
      expect(a!.facts!.stoneCount).toBe(1)
      // The piece's own design is untouched until one is chosen.
      expect(proposed.version).toBe(piece.version)
      expect(proposed.chosenDirectionId).toBeNull()
      // The model got each direction's numbers back.
      const resultsSent = JSON.stringify(s.model.requests.at(-1)!.messages.at(-1)!.content)
      expect(resultsSent).toContain('letter\\":\\"C')
      expect(resultsSent).toContain('costUsd')

      // 2. A mix by chat: the head of A on the band of B. The context lists the directions.
      s.model.push(
        ({ params }) => {
          const context = JSON.stringify(params.messages.at(-1))
          expect(context).toContain(`A \\"Low bezel\\" (id ${a!.id})`)
          return {
            content: [
              tool('pieces_proposeDirections', {
                pieceId: piece.id,
                directions: [
                  {
                    name: 'Bezel on a heavier band',
                    tradeOff: 'Heavier in gold; the bezel stays the most protective.',
                    mix: { base: a!.id, take: [{ from: b!.id, parts: ['band', 'metal'] }] },
                  },
                ],
              }),
            ],
          }
        },
        { content: [text('D: the low bezel of A on the 2.6 mm white band of B.')] },
      )
      const mixRun = await api.call('threads.send', {
        threadId,
        text: 'Put the head of A on the band of B',
        context: { pieceId: piece.id },
        clientId: 'w1',
        clientMessageId: cm(),
      })
      expect(mixRun.run.job).toBeNull()
      await settled(s.parts, mixRun.run.id, SLOW)
      const d = await directionOf(piece.id, 'D')
      expect(d).toMatchObject({ origin: 'mix', basis: 'band and metal of B, the rest of A' })
      expect(d.spec.archetype).toBe('solitaire')
      expect(d.spec.stones).toEqual(a!.spec.stones)
      expect(d.spec.ring?.bandWidthMm).toBe(2.6)
      expect(d.spec.metal.alloy).toBe('au18k-white')
      expect(d.facts!.metalMassG).toBeGreaterThan(a!.facts!.metalMassG)

      // 3. The pick: D becomes the piece's design, as one change, and the piece moves to CAD.
      s.model.push(
        { content: [tool('pieces_chooseDirection', { pieceId: piece.id, directionId: d.id })] },
        { content: [text('D is now the design; on to CAD.')] },
      )
      const pick = await api.call('threads.send', {
        threadId,
        text: 'Go with D',
        context: { pieceId: piece.id },
        clientId: 'w1',
        clientMessageId: cm(),
      })
      await settled(s.parts, pick.run.id, SLOW)
      const picked = (await api.call('traces.run', { id: pick.run.id })).run
      expect(picked.status).toBe('done')
      const chosen = await api.call('pieces.get', { id: piece.id })
      expect(chosen.chosenDirectionId).toBe(d.id)
      expect(chosen.stage).toBe('design')
      expect(chosen.spec?.title).toBe('Bezel on a heavier band')
      expect(Object.keys(chosen.design.nodes).sort()).toEqual(['band', 'center', 'head'])
      expect(chosen.design.nodes.head).toMatchObject({ style: 'bezel' })
      const history = await api.call('design.history', { pieceId: piece.id })
      expect(history[0]).toMatchObject({ label: 'Chose direction D: Bezel on a heavier band' })
      expect(history[0]!.actor).toMatchObject({ type: 'agent', runId: pick.run.id })
      // The others stay as alternatives.
      expect(chosen.directions.map((x) => x.letter)).toEqual(['A', 'B', 'C', 'D'])

      // 4. A chat edit on the chosen one changes the piece, not the stored direction.
      s.model.push(
        {
          content: [
            tool('design_apply', {
              pieceId: piece.id,
              label: 'Widen band to 3 mm',
              ops: [{ t: 'update', id: 'band', patch: { widthTop: 3 } }],
            }),
          ],
        },
        { content: [text('Widened the band to 3 mm.')] },
      )
      const edit = await api.call('threads.send', {
        threadId,
        text: 'Make the band 3 mm wide',
        context: { pieceId: piece.id },
        clientId: 'w1',
        clientMessageId: cm(),
      })
      await settled(s.parts, edit.run.id, SLOW)
      const edited = await api.call('pieces.get', { id: piece.id })
      expect(edited.design.nodes.band).toMatchObject({ widthTop: 3 })
      expect(edited.version).toBe(chosen.version + 1)
      // The edit result carried the evaluation and the canon's findings.
      expect(lastResults()).toContain('Evaluation: metal')
    },
    SLOW,
  )

  it(
    'turns the chosen direction into production CAD: a seeded warning, a pause, resume, accept',
    async () => {
      // Seed a manufacturability warning: claws too thin for the stone ("thinner wears through").
      await api.call('design.apply', {
        pieceId,
        label: 'Thin claws',
        ops: [{ t: 'update', id: 'head', patch: { style: 'prong', prongDiameter: 0.6 } }],
      })

      let checked = ''
      s.model.push(
        { content: [tool('design_evaluate', { pieceId, detail: 'production' })] },
        untilStopped(async () => {
          checked = lastResults()
          // A person edits another feature while the job runs: the job pauses for them.
          await api.call('design.apply', {
            pieceId,
            label: 'Thicker band',
            ops: [{ t: 'update', id: 'band', patch: { thicknessTop: 2.1 } }],
          })
        }),
      )
      const { run } = await api.call('threads.send', {
        threadId,
        text: 'Make it ready for the caster',
        job: { stage: 'cad' },
        context: { pieceId },
        clientId: 'w1',
        clientMessageId: cm(),
      })
      await settled(s.parts, run.id, SLOW)
      await s.parts.jobWatch.idle()
      // The check found the seeded warning and offered the canon's fix.
      expect(checked).toContain('style.ring.head.prongWire [head]')
      expect(checked).toContain('fix: Set prongDiameter to')
      expect(checked).toMatch(/Rough cost to make: about \$\d+/)
      const paused = (await api.call('traces.run', { id: run.id })).run
      expect(paused.status).toBe('paused')
      expect(paused.job?.pausedBy).toBe('edit')
      expect(states(paused.job)).toEqual(['done', 'skipped', 'skipped', 'pending', 'pending'])

      // Resume: the job re-reads the piece, fixes the warning, checks again and reports.
      let after = ''
      s.model.push(
        { content: [tool('pieces_get', { id: pieceId })] },
        {
          content: [
            tool('design_apply', {
              pieceId,
              label: 'Claws to 0.9 mm for the 1 ct round',
              ops: [{ t: 'update', id: 'head', patch: { prongDiameter: 0.9 } }],
            }),
          ],
        },
        { content: [tool('design_evaluate', { pieceId, detail: 'production' })] },
        ({ params }) => {
          after = JSON.stringify(params.messages.at(-1)!.content)
          return {
            content: [
              text('Claws to 0.9 mm. Left as asked: the 3 mm band. Your band thickness is kept.'),
            ],
          }
        },
      )
      const resumed = await api.call('runs.resume', {
        runId: run.id,
        clientId: 'w1',
        clientMessageId: cm(),
      })
      expect(resumed.run.job).toMatchObject({ stage: 'cad', continues: run.id })
      await settled(s.parts, resumed.run.id, SLOW)
      expect(after).not.toContain('prongWire')
      expect(after).toContain('\\"diagnostics\\":[]')
      // What is left is explained, not hidden: the 3 mm band was asked for.
      expect(after).toContain('style.ring.solitaire.bandWidth')
      const done = (await api.call('traces.run', { id: resumed.run.id })).run
      expect(done.status).toBe('done')
      expect(done.job?.review).toBe('pending')

      const finished = await api.call('pieces.get', { id: pieceId })
      expect(finished.design.nodes.head).toMatchObject({ prongDiameter: 0.9 })
      // The person's edit made while it ran is kept.
      expect(finished.design.nodes.band).toMatchObject({ thicknessTop: 2.1 })

      const accepted = await api.call('runs.accept', { runId: resumed.run.id })
      expect(accepted.job?.review).toBe('accepted')
    },
    SLOW,
  )
})

describe('directions by hand', () => {
  it(
    'adds from templates and mixes, keeps letters, and refuses what makes no sense',
    async () => {
      const piece = await api.call('pieces.create', { title: 'By hand' } as never)
      const added = await api.call('pieces.proposeDirections', {
        pieceId: piece.id,
        directions: [{ templateId: 'solitaire' }, { templateId: 'halo' }],
      })
      expect(added.directions.map((d) => [d.letter, d.name, d.origin])).toEqual([
        ['A', 'Classic solitaire', 'template'],
        ['B', 'Cushion halo', 'template'],
      ])
      expect(added.directions[0]!.runId).toBeNull()

      // A mix named by letters.
      const mix = await api.call('pieces.proposeDirections', {
        pieceId: piece.id,
        directions: [{ mix: { base: 'A', take: [{ from: 'b', parts: ['head'] }] } }],
      })
      expect(mix.directions[0]).toMatchObject({
        letter: 'C',
        origin: 'mix',
        name: 'A with B',
        basis: 'head of B, the rest of A',
      })
      expect(mix.directions[0]!.spec.archetype).toBe('halo')
      expect(mix.directions[0]!.spec.metal.alloy).toBe('pt950')

      // Exactly one source per direction, and a mix only across the same kind of piece.
      await expect(
        api.call('pieces.proposeDirections', {
          pieceId: piece.id,
          directions: [{ templateId: 'solitaire', mix: { base: 'A', take: [] } }] as never,
        }),
      ).rejects.toMatchObject({ error: { code: 'bad_request' } })
      const pendant = await api.call('pieces.proposeDirections', {
        pieceId: piece.id,
        directions: [{ templateId: TEMPLATE_PENDANT }],
      })
      await expect(
        api.call('pieces.proposeDirections', {
          pieceId: piece.id,
          directions: [
            { mix: { base: 'A', take: [{ from: pendant.directions[0]!.id, parts: ['head'] }] } },
          ],
        }),
      ).rejects.toMatchObject({ error: { code: 'bad_request' } })
      await expect(
        api.call('pieces.chooseDirection', { pieceId: piece.id, directionId: 'Z' }),
      ).rejects.toMatchObject({ error: { code: 'not_found' } })

      // The chosen one cannot be removed; another can, and its letter is not reused.
      await api.call('pieces.chooseDirection', { pieceId: piece.id, directionId: 'A' })
      await expect(
        api.call('pieces.removeDirection', { pieceId: piece.id, directionId: 'A' }),
      ).rejects.toMatchObject({ error: { code: 'conflict' } })
      await api.call('pieces.removeDirection', { pieceId: piece.id, directionId: 'D' })
      const next = await api.call('pieces.proposeDirections', {
        pieceId: piece.id,
        directions: [{ templateId: 'solitaire' }],
      })
      expect(next.directions[0]!.letter).toBe('E')
      const after = await api.call('pieces.get', { id: piece.id })
      expect(after.directions.map((d) => d.letter)).toEqual(['A', 'B', 'C', 'E'])
      expect(after.chosenDirectionId).toBe(after.directions[0]!.id)
    },
    SLOW,
  )
})

const TEMPLATE_PENDANT = 'pendant-solitaire'
