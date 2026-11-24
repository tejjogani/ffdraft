/** "Make it jewelry": piece origins, attestation and its gates, freeform analysis, image to 3D. */
import type { CommandOutput, ServerEvent } from '@pave/schema'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { putAsset } from './assets/assets'
import type { Ctx } from './context'
import type { Services } from './services'
import { BOOT_TIMEOUT, type Client, client, type TestServer, testServer } from './test/harness'
import { recordUsage } from './usage'

const png = () =>
  sharp({ create: { width: 32, height: 32, channels: 3, background: '#c9a13b' } })
    .png()
    .toBuffer()

const analysis: CommandOutput<'freeform.analyze'> = {
  maskAssetId: 'as_mask',
  cutoutAssetId: 'as_cut',
  outline: { d: 'M0 0L1 0L1 1Z', aspect: 1 },
  heightMapAssetId: 'as_height',
  depthSource: 'basic',
  colorLayers: [],
  suggestedMode: 'relief',
  reason: 'Soft shading reads best as a relief.',
  lints: [],
  flags: [{ code: 'face', message: 'A face is shown' }],
}

describe('with no engines', () => {
  let server: TestServer
  let api: Client
  beforeAll(async () => {
    server = await testServer()
    api = client(server)
  }, BOOT_TIMEOUT)
  afterAll(() => server.dispose())

  it('answers 501 for analysis and image to 3D, and leaves no job behind', async () => {
    const ctx = await server.runtime.context(server.runtime.local!)
    const image = await putAsset(ctx, { bytes: await png(), name: 'logo.png' })
    const piece = await api.call('pieces.create', { kind: 'pendant' })
    const calls = [
      await api.fail('freeform.analyze', { assetId: image.id }),
      await api.fail('mesh3d.estimate', { imageAssetIds: [image.id] }),
      await api.fail('mesh3d.create', { pieceId: piece.id, imageAssetIds: [image.id] }),
    ]
    expect(calls.map((c) => [c.status, c.error.code])).toEqual(
      calls.map(() => [501, 'not_configured']),
    )
    expect(await api.call('mesh3d.list', { pieceId: piece.id })).toEqual([])
    expect((await api.fail('freeform.analyze', { assetId: 'as_nope' })).status).toBe(404)
  })
})

describe('making jewelry from a picture', () => {
  let server: TestServer
  let api: Client
  let ctx: Ctx
  const analyze = vi.fn<Services['freeform']['analyze']>(async () => analysis)
  const submit = vi.fn<Services['mesh3d']['submit']>(async () => {})
  const cancel = vi.fn<Services['mesh3d']['cancel']>(async () => {})

  beforeAll(async () => {
    server = await testServer({
      services: {
        freeform: { analyze },
        mesh3d: {
          capabilities: { mesh3d: ['fixture'] },
          estimate: async (req) => ({
            provider: 'fixture',
            model: 'fx-1',
            usd: req.quality === 'ultra' ? 1 : 0.2,
            seconds: 60,
          }),
          submit,
          cancel,
        },
        geometry: {
          evaluate: async () => {
            throw new Error('unused')
          },
          export: async () => ({
            file: { bytes: new Uint8Array([1]), name: 'p.stl', mime: 'model/stl' },
            notes: [],
          }),
          renderInput: async () => {
            throw new Error('unused')
          },
        },
        production: { submit: async () => {} },
      },
    })
    api = client(server)
    ctx = await server.runtime.context(server.runtime.local!)
  }, BOOT_TIMEOUT)
  afterAll(() => server.dispose())

  it('analyses a picture, handing the engine the bytes and no optional helpers', async () => {
    const image = await putAsset(ctx, { bytes: await png(), name: 'trophy.png' })
    const result = await api.call('freeform.analyze', { assetId: image.id, heightMm: 38 })
    expect(result).toEqual(analysis)
    const [input, source, helpers] = analyze.mock.calls.at(-1)!
    expect(input).toEqual({ assetId: image.id, heightMm: 38 })
    expect(source.mime).toBe('image/png')
    expect(helpers).toEqual({ vision: null, depth: null })

    const doc = await putAsset(ctx, { bytes: new TextEncoder().encode('# hi'), name: 'notes.md' })
    expect((await api.fail('freeform.analyze', { assetId: doc.id })).status).toBe(400)

    const vision = { describe: async () => ({ tags: [], flags: [] }) }
    server.runtime.services.register('vision', vision)
    await api.call('freeform.analyze', { assetId: image.id })
    expect(analyze.mock.calls.at(-1)![2]).toEqual({ vision, depth: null })
    expect((await api.call('session.get', {})).capabilities).toMatchObject({
      vision: true,
      depth: false,
      mesh3d: ['fixture'],
    })
  })

  it('records an origin, gates export, packaging and 3D on a person’s attestation', async () => {
    const image = await putAsset(ctx, { bytes: await png(), name: 'face.png' })
    const piece = await api.call('pieces.create', {
      kind: 'pendant',
      origin: { kind: 'image', sourceAssetIds: [image.id], flags: analysis.flags },
    })
    expect(piece.origin).toEqual({
      kind: 'image',
      sourceAssetIds: [image.id],
      referenceIds: [],
      flags: analysis.flags,
      attestation: null,
    })

    const gated = [
      await api.fail('design.export', { pieceId: piece.id, format: 'stl' }),
      await api.fail('production.create', { pieceId: piece.id }),
      await api.fail('mesh3d.create', { pieceId: piece.id, imageAssetIds: [image.id] }),
    ]
    expect(gated.map((g) => [g.status, g.error.reason])).toEqual(
      gated.map(() => [409, 'attestation_required']),
    )
    expect(await api.call('mesh3d.list', { pieceId: piece.id })).toEqual([])

    // A face needs the person's consent; an agent can never attest.
    expect((await api.fail('pieces.attest', { id: piece.id, rights: 'own' })).status).toBe(400)
    const agent = await server.runtime.context({
      ...server.runtime.local!,
      actor: { type: 'agent', runId: 'run_x' },
    })
    await expect(
      server.runtime.invoke(
        'pieces.attest',
        { id: piece.id, rights: 'own', likenessConsent: true },
        agent,
      ),
    ).rejects.toMatchObject({ status: 403 })

    const attested = await api.call('pieces.attest', {
      id: piece.id,
      rights: 'permission',
      likenessConsent: true,
    })
    expect(attested.origin?.attestation).toMatchObject({
      rights: 'permission',
      likenessConsent: true,
      by: server.runtime.local!.userId,
    })
    await api.call('design.export', { pieceId: piece.id, format: 'stl' })
    await api.call('production.create', { pieceId: piece.id })

    // Same sources keep the attestation; new sources need a new one.
    await api.call('pieces.update', {
      id: piece.id,
      origin: { kind: 'image', sourceAssetIds: [image.id], flags: [] },
    })
    expect((await api.call('pieces.get', { id: piece.id })).origin?.attestation).not.toBeNull()
    const other = await putAsset(ctx, { bytes: await png(), name: 'other.png', mime: 'image/png' })
    await api.call('pieces.update', {
      id: piece.id,
      origin: { kind: 'image', sourceAssetIds: [other.id] },
    })
    expect((await api.call('pieces.get', { id: piece.id })).origin?.attestation).toBeNull()

    const typed = await api.call('pieces.create', { kind: 'pendant', origin: { kind: 'text' } })
    await api.call('design.export', { pieceId: typed.id, format: 'stl' })
    expect(
      (
        await api.fail('pieces.attest', {
          id: (await api.call('pieces.create', {})).id,
          rights: 'own',
        })
      ).status,
    ).toBe(409)
    expect(
      (await api.fail('pieces.create', { origin: { kind: 'image', sourceAssetIds: ['as_nope'] } }))
        .status,
    ).toBe(404)
  })

  it('runs an image-to-3D job: estimate, budget, progress events, sticky terminal state, cancel', async () => {
    const photo = await putAsset(ctx, { bytes: await png(), name: 'cup.png' })
    const piece = await api.call('pieces.create', { kind: 'pendant' })
    expect(await api.call('mesh3d.estimate', { imageAssetIds: [photo.id] })).toEqual({
      provider: 'fixture',
      model: 'fx-1',
      usd: 0.2,
      seconds: 60,
    })
    const events: ServerEvent[] = []
    const off = server.runtime.events.subscribe(ctx.orgId, (e) => events.push(e))

    const job = await api.call('mesh3d.create', { pieceId: piece.id, imageAssetIds: [photo.id] })
    expect(job).toMatchObject({
      status: 'queued',
      provider: 'fixture',
      model: 'fx-1',
      quality: 'standard',
      inputAssetIds: [photo.id],
      costUsd: null,
      actor: { type: 'user' },
    })
    const [submitted, images, handle] = submit.mock.calls.at(-1)!
    expect(submitted).toEqual(job)
    expect(images.map((i) => i.mime)).toEqual(['image/png'])

    await handle.update({ status: 'running', progress: 0.5, providerJobId: 'fal_1' })
    await handle.update({ status: 'done', progress: 1, meshAssetId: photo.id, costUsd: 0.18 })
    await handle.update({ status: 'failed', error: 'late' })
    off()
    expect(await api.call('mesh3d.get', { id: job.id })).toMatchObject({
      status: 'done',
      costUsd: 0.18,
      meshAssetId: photo.id,
      error: null,
    })
    expect(
      events
        .filter((e) => e.type === 'job.updated')
        .map((e) => e.type === 'job.updated' && [e.kind, e.status, e.progress]),
    ).toEqual([
      ['mesh3d', 'queued', 0],
      ['mesh3d', 'running', 0.5],
      ['mesh3d', 'done', 1],
    ])
    expect((await api.fail('mesh3d.cancel', { id: job.id })).status).toBe(409)

    const second = await api.call('mesh3d.create', { pieceId: piece.id, imageAssetIds: [photo.id] })
    await submit.mock.calls.at(-1)![2].update({ status: 'running', providerJobId: 'fal_2' })
    const canceled = await api.call('mesh3d.cancel', { id: second.id })
    expect(canceled.status).toBe('canceled')
    // The provider's own job id comes back, so the engine can stop the job at the provider.
    expect(cancel).toHaveBeenCalledWith(second.id, expect.anything(), { providerJobId: 'fal_2' })
    expect((await api.call('mesh3d.list', { pieceId: piece.id })).map((j) => j.id)).toEqual([
      second.id,
      job.id,
    ])

    const doc = await putAsset(ctx, { bytes: new TextEncoder().encode('x'), name: 'a.txt' })
    expect(
      (await api.fail('mesh3d.create', { pieceId: piece.id, imageAssetIds: [doc.id] })).status,
    ).toBe(400)
  })

  it('fails a job its engine would not take, and cancels one its engine cannot stop', async () => {
    const photo = await putAsset(ctx, { bytes: await png(), name: 'c.png' })
    const piece = await api.call('pieces.create', { kind: 'pendant' })
    submit.mockRejectedValueOnce(new Error('invalid API key'))
    const refused = await api.fail('mesh3d.create', {
      pieceId: piece.id,
      imageAssetIds: [photo.id],
    })
    expect(refused.status).toBe(500)
    const [failed] = await api.call('mesh3d.list', { pieceId: piece.id })
    expect(failed).toMatchObject({
      status: 'failed',
      error: 'The engine could not take this job; try again later.',
    })

    const job = await api.call('mesh3d.create', { pieceId: piece.id, imageAssetIds: [photo.id] })
    cancel.mockRejectedValueOnce(new Error('provider down'))
    expect((await api.call('mesh3d.cancel', { id: job.id })).status).toBe('canceled')
  })

  it('lets an agent add to an origin, but only a person clear or shrink it', async () => {
    const image = await putAsset(ctx, { bytes: await png(), name: 'logo.png' })
    const more = await putAsset(ctx, { bytes: await png(), name: 'more.png', mime: 'image/png' })
    const flags = [{ code: 'logo' as const, message: 'A brand mark' }]
    const piece = await api.call('pieces.create', {
      kind: 'pendant',
      origin: { kind: 'logo', sourceAssetIds: [image.id], flags },
    })
    const agent = await server.runtime.context({
      ...server.runtime.local!,
      actor: { type: 'agent', runId: 'run_o' },
    })
    const update = (origin: unknown) =>
      server.runtime.execute('pieces.update', { id: piece.id, origin }, agent)
    for (const origin of [
      null,
      { kind: 'logo' },
      { kind: 'logo', sourceAssetIds: [more.id], flags },
      { kind: 'logo', sourceAssetIds: [image.id] },
    ])
      await expect(update(origin), JSON.stringify(origin)).rejects.toMatchObject({ status: 403 })
    const gate = await api.fail('design.export', { pieceId: piece.id, format: 'stl' })
    expect(gate.error.reason).toBe('attestation_required')

    // Adding is allowed, and clears an attestation a person had given.
    await api.call('pieces.attest', { id: piece.id, rights: 'own' })
    await update({ kind: 'logo', sourceAssetIds: [image.id, more.id], flags })
    const after = await api.call('pieces.get', { id: piece.id })
    expect(after.origin).toMatchObject({ sourceAssetIds: [image.id, more.id], attestation: null })
    // A person may clear it.
    await api.call('pieces.update', { id: piece.id, origin: null })
    await api.call('design.export', { pieceId: piece.id, format: 'stl' })
  })

  it('refuses a paid job that would pass the monthly budget', async () => {
    const photo = await putAsset(ctx, { bytes: await png(), name: 'b.png' })
    const piece = await api.call('pieces.create', { kind: 'pendant' })
    await api.call('org.settings.update', { monthlyBudgetUsd: 1.5 })
    await recordUsage(ctx, {
      meter: 'image',
      provider: 'x',
      quantity: 1,
      unit: 'images',
      costUsd: 0.75,
    })
    await api.call('mesh3d.create', { pieceId: piece.id, imageAssetIds: [photo.id] })
    const err = await api.fail('mesh3d.create', {
      pieceId: piece.id,
      imageAssetIds: [photo.id],
      quality: 'ultra',
    })
    expect(err.status).toBe(402)
    expect(err.error).toMatchObject({ code: 'budget_exceeded', budgetUsd: 1.5, spentUsd: 0.75 })
    await api.call('org.settings.update', { monthlyBudgetUsd: null })
  })
})
