import type { EvaluationSummary } from '@pave/schema'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Services } from './services'
import { BOOT_TIMEOUT, type Client, client, type TestServer, testServer } from './test/harness'

const summary: EvaluationSummary = {
  metalMassG: 4.2,
  metals: [
    { material: 'pt950', volumeMm3: 150, massG: 3.2 },
    { material: 'au18k-yellow', volumeMm3: 60, massG: 1 },
  ],
  stoneCount: 1,
  caratTotal: 1,
  lots: [],
  boundsMm: { x: 20, y: 22, z: 8 },
  diagnostics: [],
}

describe('engines that are not configured', () => {
  let server: TestServer
  let api: Client
  beforeAll(async () => {
    server = await testServer()
    api = client(server)
  }, BOOT_TIMEOUT)
  afterAll(() => server.dispose())

  it('answer 501 with a clear message and leave no rows behind', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    const board = await api.call('boards.create', { title: 'b' })
    const model = await api.call('models.create', {
      name: 'M',
      attestedSynthetic: true,
      card: {
        description: '',
        ageRange: '25-34',
        skinTone: '',
        hair: '',
        build: '',
        styling: '',
        ringSizeUs: null,
        wristMm: null,
        neckMm: null,
      },
    })
    const calls = [
      await api.fail('design.evaluate', { pieceId: piece.id }),
      await api.fail('design.export', { pieceId: piece.id, format: 'stl' }),
      await api.fail('references.search', { query: 'art deco ring' }),
      await api.fail('references.brief', { boardId: board.id, request: 'an art deco ring' }),
      await api.fail('models.generatePortraits', { id: model.id, views: ['face'] }),
      await api.fail('shots.create', { modelId: model.id, pieceId: piece.id, placement: 'hand' }),
      await api.fail('production.create', { pieceId: piece.id }),
    ]
    expect(calls.map((c) => c.status)).toEqual(calls.map(() => 501))
    expect(calls.map((c) => c.error.code)).toEqual(calls.map(() => 'not_configured'))
    expect(calls[0]!.error).toMatchObject({
      service: 'geometry',
      message: expect.stringContaining('geometry kernel'),
    })
    expect(await api.call('shots.list', {})).toEqual([])
    expect(await api.call('production.list', { pieceId: piece.id })).toEqual([])
    expect((await api.call('pieces.get', { id: piece.id })).facts).toBeNull()
  })
})

describe('registered engines', () => {
  let server: TestServer
  let api: Client
  const evaluate = vi.fn<Services['geometry']['evaluate']>(async () => summary)
  const submitRender = vi.fn<Services['renderQueue']['submit']>(async () => {})

  beforeAll(async () => {
    const tiny = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#fff' } })
      .png()
      .toBuffer()
    server = await testServer({
      services: {
        geometry: {
          capabilities: { mesh3d: ['kernel'] },
          evaluate,
          export: async (_design, opts) => ({
            file: {
              bytes: new TextEncoder().encode('solid x\nendsolid x\n'),
              name: `piece.${opts.format}`,
              mime: 'model/stl',
            },
            notes: ['Stones excluded'],
          }),
          renderInput: async () => {
            throw new Error('not used')
          },
        },
        imageGen: {
          capabilities: { imageGeneration: ['fake'] },
          // Session reports what this organisation can use, not the static capability list.
          available: () => ['fake'],
          resolve: async () => {
            throw new Error('not used')
          },
          price: async () => {
            throw new Error('not used')
          },
        },
        production: {
          submit: async (pkg, request, handle) => {
            expect(request.piece.id).toBe(pkg.pieceId)
            await handle.update({ status: 'done', manifest: { quantity: request.quantity } })
          },
        },
      },
    })
    server.runtime.services.register('renderQueue', {
      capabilities: { blender: true },
      submit: submitRender,
      cancel: async () => {},
    })
    api = client(server)
  }, BOOT_TIMEOUT)
  afterAll(() => server.dispose())

  it('report their capabilities', async () => {
    const { capabilities } = await api.call('session.get', {})
    expect(capabilities).toMatchObject({
      mesh3d: ['kernel'],
      imageGeneration: ['fake'],
      blender: true,
      imageSearch: [],
    })
  })

  it('evaluate designs and cache facts on the piece', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    await vi.waitFor(async () =>
      expect((await api.call('pieces.get', { id: piece.id })).facts).not.toBeNull(),
    )
    const result = await api.call('design.evaluate', { pieceId: piece.id, detail: 'production' })
    expect(result).toEqual(summary)
    expect(evaluate).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'ring' }),
      { detail: 'production', pieceId: piece.id },
      expect.anything(),
    )
    expect((await api.call('pieces.get', { id: piece.id })).facts).toEqual({
      metalMassG: 4.2,
      caratTotal: 1,
      stoneCount: 1,
      metal: 'pt950',
    })
  })

  it('export CAD as an asset', async () => {
    const piece = await api.call('pieces.create', { templateId: 'wedding-band' })
    const { asset, notes } = await api.call('design.export', { pieceId: piece.id, format: 'stl' })
    expect(asset).toMatchObject({ kind: 'mesh', name: 'piece.stl', mime: 'model/stl' })
    expect(notes).toEqual(['Stones excluded'])
    expect((await api.request(asset.url)).status).toBe(200)
  })

  // Image generation (brief, provider, check, metering) is covered in imagegen/imagegen.test.ts.

  it('hand queued renders to the render queue, which reports back through its handle', async () => {
    const piece = await api.call('pieces.create', { templateId: 'halo' })
    const job = await api.call('renders.create', { pieceId: piece.id, scene: {} })
    const [submitted, submittedPiece, handle] = submitRender.mock.calls.at(-1)!
    expect(submitted.id).toBe(job.id)
    expect(submittedPiece.design.order).toContain('center')
    await handle.update({ status: 'running', progress: 0.5 })
    expect(await api.call('renders.get', { id: job.id })).toMatchObject({
      status: 'running',
      progress: 0.5,
      finishedAt: null,
    })
    await handle.update({ status: 'done', progress: 1, assetIds: ['as_1'] })
    const done = await api.call('renders.get', { id: job.id })
    expect(done).toMatchObject({ status: 'done', assetIds: ['as_1'] })
    expect(done.finishedAt).not.toBeNull()
  })

  it('number production packages by revision', async () => {
    const piece = await api.call('pieces.create', { templateId: 'cuban' })
    const first = await api.call('production.create', { pieceId: piece.id, quantity: 3 })
    const second = await api.call('production.create', { pieceId: piece.id })
    expect([first.revision, second.revision]).toEqual([1, 2])
    const list = await api.call('production.list', { pieceId: piece.id })
    expect(list.map((p) => p.revision)).toEqual([2, 1])
    expect(list[1]).toMatchObject({ status: 'done', manifest: { quantity: 3 } })
  })
})
