/**
 * A spec no recipe can build (archetype `custom`, the photo read's answer for a trophy) must say
 * so at every step instead of reporting success on an empty design: the estimate, the build, the
 * evaluation. Changing a piece's kind through its spec changes the piece's kind.
 */
import { type EvaluationSummary, PieceSpecSchema } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BOOT_TIMEOUT, type Client, client, type TestServer, testServer } from './test/harness'

/** What the kernel answers for a design: nothing at all when it has no nodes. */
const summaryOf = (nodes: number): EvaluationSummary => ({
  metalMassG: nodes ? 4 : 0,
  metals: nodes ? [{ material: 'au18k-yellow', volumeMm3: 250, massG: 4 }] : [],
  stoneCount: 0,
  caratTotal: 0,
  lots: [],
  boundsMm: nodes ? { x: 20, y: 25, z: 3 } : { x: 0, y: 0, z: 0 },
  diagnostics: [],
})

let server: TestServer
let api: Client
beforeAll(async () => {
  server = await testServer({
    services: {
      geometry: {
        evaluate: async (design) => summaryOf(Object.keys(design.nodes).length),
        export: async () => {
          throw new Error('not used here')
        },
        renderInput: async () => {
          throw new Error('not used here')
        },
      },
    },
  })
  api = client(server)
}, BOOT_TIMEOUT)
afterAll(() => server.dispose())

const trophy = PieceSpecSchema.parse({
  kind: 'pendant',
  archetype: 'custom',
  title: 'From a photo: custom pendant',
  summary: 'A sculpted trophy cup on a stepped base.',
  metal: { alloy: 'au18k-yellow' },
  stones: [],
})

describe('a spec no recipe can build', () => {
  it('the estimate says nothing could be built, with no cost', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire', title: 'Trophy' })
    const estimate = await api.call('pieces.estimate', { id: piece.id, spec: trophy })
    expect(estimate.notes[0]).toMatch(/Nothing can be built/)
    expect(estimate.costUsd).toBeNull()
  })

  it('the build fails with a plain reason, and the design is left as it was', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire', title: 'Trophy 2' })
    await api.call('pieces.setSpec', { id: piece.id, spec: trophy })
    const refused = await api.fail('pieces.buildFromSpec', { id: piece.id })
    expect(refused.status).toBe(409)
    expect(refused.error.message).toMatch(/Nothing can be built/)
    const after = await api.call('pieces.get', { id: piece.id })
    expect(Object.keys(after.design.nodes).length).toBeGreaterThan(0)
  })

  it('evaluating an empty design warns instead of reporting all zeros as fine', async () => {
    const piece = await api.call('pieces.create', { title: 'Empty', kind: 'pendant' })
    const summary = await api.call('design.evaluate', { pieceId: piece.id, detail: 'draft' })
    expect(summary.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ level: 'warning', code: 'empty_design' })]),
    )
  })

  it('setting a spec of another kind changes the piece’s kind', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire', title: 'Becomes' })
    expect(piece.kind).toBe('ring')
    await api.call('pieces.setSpec', {
      id: piece.id,
      spec: { ...trophy, archetype: 'medallion' },
    })
    expect((await api.call('pieces.get', { id: piece.id })).kind).toBe('pendant')
  })
})
