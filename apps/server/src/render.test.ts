/** Saved shots, takes (browser and Blender), brand model approval and on-model images. */
import type { ServerEvent } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { putAsset } from './assets/assets'
import type { Ctx } from './context'
import { serviceContext } from './service-context'
import type { JobHandle, ModelShotPatch, Services } from './services'
import {
  authPost,
  BOOT_TIMEOUT,
  type Client,
  client,
  signUp,
  type TestServer,
  testServer,
} from './test/harness'
import { traces } from './traces'

const card = {
  description: 'Warm, editorial',
  ageRange: '25-34' as const,
  skinTone: 'deep',
  hair: 'short curls',
  build: 'slim',
  styling: 'minimal black',
  ringSizeUs: 6,
  wristMm: 155,
  neckMm: null,
}

describe('saved shots and takes', () => {
  let server: TestServer
  let api: Client
  let ctx: Ctx
  beforeAll(async () => {
    server = await testServer()
    api = client(server)
    ctx = await server.runtime.context(server.runtime.local!)
  }, BOOT_TIMEOUT)
  afterAll(() => server.dispose())

  it('keeps shots per piece and house shots, adjusted by re-validated merge patches', async () => {
    const piece = await api.call('pieces.create', { templateId: 'halo' })
    const events: ServerEvent[] = []
    const off = server.runtime.events.subscribe(ctx.orgId, (e) => events.push(e))
    const hero = await api.call('scenes.create', { pieceId: piece.id, title: 'Hero', scene: {} })
    const macro = await api.call('scenes.create', {
      pieceId: piece.id,
      title: 'Macro',
      scene: { camera: { preset: 'macro', focalLength: 100 } },
    })
    const house = await api.call('scenes.create', {
      pieceId: null,
      title: 'Catalog',
      scene: { look: 'catalog-white' },
    })
    expect([hero.position, macro.position]).toEqual([1, 2])
    expect((await api.call('scenes.list', { pieceId: piece.id })).map((s) => s.id)).toEqual([
      hero.id,
      macro.id,
    ])
    expect((await api.call('scenes.list', { pieceId: null })).map((s) => s.id)).toEqual([house.id])

    const adjusted = await api.call('scenes.update', {
      id: hero.id,
      title: 'Hero, rose',
      patch: { camera: { focalLength: 105 }, overrides: { '*': { material: 'au18k-rose' } } },
    })
    expect(adjusted.scene.camera).toMatchObject({ preset: 'hero', focalLength: 105 })
    expect(adjusted.scene.overrides).toEqual({ '*': { material: 'au18k-rose' } })
    expect(adjusted.title).toBe('Hero, rose')
    const invalid = await api.fail('scenes.update', {
      id: hero.id,
      patch: { camera: { focalLength: 9000 } },
    })
    expect(invalid.status).toBe(400)
    // A misspelt key is refused, not silently dropped while the call "succeeds".
    const misspelt = await api.fail('scenes.update', {
      id: hero.id,
      patch: { bogus: 1, camera: { focalLenght: 105 } },
    })
    expect([misspelt.status, misspelt.error.paths]).toEqual([400, ['bogus', 'camera.focalLenght']])

    await api.call('scenes.delete', { id: macro.id })
    off()
    expect(events.filter((e) => e.type === 'scene.updated')).toHaveLength(5)
    expect((await api.fail('scenes.list', { pieceId: 'pc_nope' })).status).toBe(404)
  })

  it.each(['source', 'clay'] as const)(
    'saves %s on the selected default shot even when initialization is retried concurrently',
    async (importedBodyLook) => {
      const piece = await api.call('pieces.create', { kind: 'pendant' })
      const input = {
        pieceId: piece.id,
        edit: {
          key: 'hero',
          patch: { look: 'catalog-white', includeUnassignedRhino: true, importedBodyLook },
        },
      }
      const initialize = () => api.call('scenes.ensureDefaults', input)
      const [first, concurrent, retry] = await Promise.all([
        initialize(),
        initialize(),
        initialize(),
      ])
      expect(concurrent.shots).toEqual(first.shots)
      expect(retry.shots).toEqual(first.shots)
      expect(first.shots.map(({ title, position }) => [title, position])).toEqual([
        ['Hero', 1],
        ['Front', 2],
        ['Profile', 3],
        ['Macro', 4],
      ])
      const [hero, ...rest] = first.shots
      expect(hero?.scene).toMatchObject(input.edit.patch)
      expect(rest.some(({ scene }) => scene.includeUnassignedRhino)).toBe(false)
      const history = await api.call('scenes.history', { id: hero!.id })
      expect(history).toHaveLength(1)
      expect(history[0]?.before.includeUnassignedRhino).toBeUndefined()
      expect(history[0]?.after).toMatchObject({ includeUnassignedRhino: true, importedBodyLook })
      expect((await api.call('pieces.get', { id: piece.id })).version).toBe(piece.version)
    },
  )

  it('saves White gloss without changing the locked shot camera or design version', async () => {
    const piece = await api.call('pieces.create', { templateId: 'halo' })
    const shot = await api.call('scenes.create', {
      pieceId: piece.id,
      title: 'Studio floor',
      scene: { camera: { preset: 'hero', locked: true } },
    })
    const updated = await api.call('scenes.update', {
      id: shot.id,
      patch: { ground: 'white-gloss' },
    })
    const [saved] = await api.call('scenes.list', { pieceId: piece.id })
    expect(saved?.scene.ground).toBe('white-gloss')
    expect(updated.scene).toEqual({ ...shot.scene, ground: 'white-gloss' })
    expect((await api.call('pieces.get', { id: piece.id })).version).toBe(piece.version)
  })

  it('round trips independent light levels through saved shots and rejects unavailable panels', async () => {
    const piece = await api.call('pieces.create', { templateId: 'halo' })
    const shot = await api.call('scenes.create', {
      pieceId: piece.id,
      title: 'Catalog ring',
      scene: {
        look: 'catalog-white',
        camera: { preset: 'hero', locked: true },
        panelIntensities: { 'catalog-white': { left: 0.6 } },
      },
    })
    const copy = await api.call('scenes.create', {
      pieceId: piece.id,
      title: 'Catalog comparison',
      scene: shot.scene,
    })
    const adjusted = await api.call('scenes.update', {
      id: copy.id,
      patch: { panelIntensities: { 'catalog-white': { right: 0 }, 'studio-soft': { top: 1.5 } } },
    })
    expect(adjusted.scene.panelIntensities).toEqual({
      'catalog-white': { left: 0.6, right: 0 },
      'studio-soft': { top: 1.5 },
    })
    expect(adjusted.scene.camera).toEqual(shot.scene.camera)
    for (const invalid of [{ right: 2.1 }, { right: -0.1 }, { 'lens-flag': 2 }, { rim: 1 }]) {
      expect(
        (
          await api.fail('scenes.update', {
            id: copy.id,
            patch: { panelIntensities: { 'catalog-white': invalid } },
          })
        ).status,
      ).toBe(400)
    }
    const reset = await api.call('scenes.update', {
      id: copy.id,
      patch: { panelIntensities: { 'catalog-white': null } },
    })
    expect(reset.scene.panelIntensities).toEqual({ 'studio-soft': { top: 1.5 } })
    const restored = await api.call('scenes.revert', { id: copy.id })
    expect(restored.scene.scene).toEqual(adjusted.scene)
    expect(await api.call('scenes.list', { pieceId: piece.id })).toEqual([shot, restored.scene])
    expect((await api.call('pieces.get', { id: piece.id })).version).toBe(piece.version)
  })

  it('returns the imported preview settings with camera suggestions, including without a kernel', async () => {
    const { id: pieceId } = await api.call('pieces.create', { kind: 'ring' })
    const query = { pieceId, includeUnassignedRhino: true }
    const source = await api.call('scenes.suggest', { ...query, importedBodyLook: 'source' })
    const clay = await api.call('scenes.suggest', { ...query, importedBodyLook: 'clay' })
    const legacy = await api.call('scenes.suggest', query)
    const off = await api.call('scenes.suggest', { pieceId, importedBodyLook: 'source' })
    expect(source.sceneOptions).toEqual({
      includeUnassignedRhino: true,
      importedBodyLook: 'source',
    })
    expect(clay.sceneOptions).toEqual({ includeUnassignedRhino: true, importedBodyLook: 'clay' })
    expect(legacy).toEqual(clay)
    expect(off.sceneOptions).toBeUndefined()
    expect(source.shots).toEqual(clay.shots)
    const saved = await api.call('scenes.create', {
      pieceId,
      title: 'Imported hero',
      scene: { camera: source.shots[0]!.camera, ...source.sceneOptions },
    })
    expect(saved.scene).toMatchObject({ includeUnassignedRhino: true, importedBodyLook: 'source' })
    expect((await api.fail('scenes.suggest', { ...query, importedBodyLook: 'gloss' })).status).toBe(
      400,
    )
  })

  it('leaves an empty set untouched on an invalid first edit and preserves a customized partial set', async () => {
    const piece = await api.call('pieces.create', { kind: 'ring' })
    const invalid = await api.fail('scenes.ensureDefaults', {
      pieceId: piece.id,
      edit: { key: 'hero', patch: { camera: { focalLength: 9000 } } },
    })
    expect(invalid.status).toBe(400)
    expect(await api.call('scenes.list', { pieceId: piece.id })).toEqual([])
    const handFramed = await api.call('scenes.create', {
      pieceId: piece.id,
      title: 'Hero',
      position: 1,
      scene: { look: 'black-acrylic' },
    })
    const first = await api.call('scenes.ensureDefaults', {
      pieceId: piece.id,
      edit: { key: 'hero', patch: { includeUnassignedRhino: true } },
    })
    expect(first.shots).toEqual([handFramed])
    expect(first.editedId).toBeNull()
    expect(await api.call('scenes.history', { id: handFramed.id })).toEqual([])
  })

  it('queues browser takes from shots, completes them once, and flags them stale', async () => {
    const piece = await api.call('pieces.create', { templateId: 'halo' })
    const shot = await api.call('scenes.create', {
      pieceId: piece.id,
      title: 'Front',
      scene: { camera: { preset: 'front' } },
    })
    const job = await api.call('renders.create', {
      pieceId: piece.id,
      sceneId: shot.id,
      groupId: 'grp_1',
      variantLabel: 'Platinum',
    })
    expect(job).toMatchObject({
      engine: 'browser',
      status: 'queued',
      title: 'Front',
      sceneId: shot.id,
      groupId: 'grp_1',
      variantLabel: 'Platinum',
      purpose: 'take',
      // Exact by default: a take renders the scene as asked.
      autoTune: false,
      stale: false,
      starred: false,
      critique: null,
    })
    expect(job.scene.camera.preset).toBe('front')
    expect(job.requestedScene).toEqual(job.scene)
    expect(
      (await api.fail('renders.create', { pieceId: piece.id, engine: 'blender', scene: {} }))
        .status,
    ).toBe(501)

    const image = await putAsset(ctx, {
      bytes: new TextEncoder().encode('x'),
      name: 'take.png',
      mime: 'image/png',
    })
    const done = await api.call('renders.complete', {
      id: job.id,
      assetIds: [image.id],
      seconds: 4.2,
      device: 'WebGL',
    })
    expect(done).toMatchObject({
      status: 'done',
      progress: 1,
      assetIds: [image.id],
      seconds: 4.2,
      device: 'WebGL',
    })
    expect(done.finishedAt).not.toBeNull()
    expect((await api.fail('renders.complete', { id: job.id, error: 'late' })).status).toBe(409)
    expect((await api.fail('renders.complete', { id: job.id, assetIds: ['as_nope'] })).status).toBe(
      404,
    )

    const starred = await api.call('renders.update', { id: job.id, starred: true, title: 'Keeper' })
    expect(starred).toMatchObject({ starred: true, title: 'Keeper' })
    expect((await api.fail('renders.update', { id: job.id })).status).toBe(400)

    await api.call('design.apply', {
      pieceId: piece.id,
      label: 'Kind',
      ops: [{ t: 'setKind', kind: 'ring' }],
    })
    expect((await api.call('renders.get', { id: job.id })).stale).toBe(true)

    const retry = await api.call('renders.create', {
      pieceId: piece.id,
      scene: { look: 'black-acrylic' },
      retryOf: job.id,
      note: 'warmer key',
      autoTune: false,
      purpose: 'reference',
    })
    expect(retry).toMatchObject({
      retryOf: job.id,
      note: 'warmer key',
      autoTune: false,
      purpose: 'reference',
    })
    expect((await api.call('renders.list', { pieceId: piece.id })).map((r) => r.id)).toEqual([
      job.id,
    ])
    expect(
      (await api.call('renders.list', { pieceId: piece.id, purpose: 'reference' })).map(
        (r) => r.id,
      ),
    ).toEqual([retry.id])
    expect(await api.call('renders.list', { pieceId: piece.id, before: job.createdAt })).toEqual([])

    expect((await api.fail('renders.delete', { id: retry.id })).status).toBe(409)
    await api.call('renders.cancel', { id: retry.id })
    expect(
      (await api.fail('renders.complete', { id: retry.id, assetIds: [image.id] })).status,
    ).toBe(409)
    await api.call('renders.delete', { id: retry.id })
    expect((await api.fail('renders.get', { id: retry.id })).status).toBe(404)
    const otherPiece = await api.call('pieces.create', {})
    expect(
      (await api.fail('renders.create', { pieceId: otherPiece.id, sceneId: shot.id })).status,
    ).toBe(400)
  })

  it('reports the engine and configures it only through a configured service', async () => {
    expect(await api.call('renders.engine', {})).toMatchObject({
      available: false,
      reason: expect.any(String),
    })
    expect(
      (await api.fail('renders.configureEngine', { blenderPath: '/opt/blender' })).status,
    ).toBe(501)
    const configure = vi.fn<Services['renderEngine']['configure']>(async (path) => ({
      available: true,
      version: '5.3.0',
      device: 'CPU',
      path,
      reason: null,
    }))
    server.runtime.services.register('renderEngine', {
      status: async () => ({
        available: false,
        version: null,
        device: null,
        path: null,
        reason: 'Not found',
      }),
      configure,
    })
    expect((await api.call('renders.engine', {})).reason).toBe('Not found')
    expect(
      await api.call('renders.configureEngine', { blenderPath: '/opt/blender' }),
    ).toMatchObject({
      available: true,
      path: '/opt/blender',
    })
  })

  it('queues only the explicitly requested saved design version', async () => {
    const submit = vi.fn<Services['renderQueue']['submit']>(async () => {})
    server.runtime.services.register('renderQueue', {
      capabilities: { blender: true },
      submit,
      cancel: async () => {},
    })
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    const changed = await api.call('design.apply', {
      pieceId: piece.id,
      label: 'Another window added a body',
      ops: [{ t: 'add', node: { id: 'newbody', kind: 'primitive', shape: 'sphere' } }],
    })
    const input = { pieceId: piece.id, scene: {}, engine: 'blender' as const }
    const plan = await api.call('plan.get', {})
    expect(
      await api.fail('renders.create', { ...input, baseVersion: piece.version }),
    ).toMatchObject({
      status: 409,
    })
    expect(await api.call('plan.get', {})).toEqual(plan)
    expect(await api.call('renders.list', { pieceId: piece.id })).toEqual([])
    expect(submit).not.toHaveBeenCalled()

    const job = await api.call('renders.create', { ...input, baseVersion: changed.version })
    expect(job.sourceVersion).toBe(changed.version)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0]![1].version).toBe(changed.version)
    await api.call('renders.cancel', { id: job.id })
  })

  it('hands Blender takes to the queue, whose late updates cannot reopen a settled job', async () => {
    const submit = vi.fn<Services['renderQueue']['submit']>(async () => {})
    server.runtime.services.register('renderQueue', {
      capabilities: { blender: true },
      submit,
      cancel: async () => {},
    })
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    const job = await api.call('renders.create', { pieceId: piece.id, scene: {} })
    expect(job.engine).toBe('blender')
    const handle = submit.mock.calls.at(-1)![2]
    await handle.update({ status: 'running', progress: 0.3, cacheKey: 'abc' })
    await api.call('renders.cancel', { id: job.id })
    await handle.update({ status: 'done', progress: 1, assetIds: ['as_1'] })
    expect(await api.call('renders.get', { id: job.id })).toMatchObject({
      status: 'canceled',
      assetIds: [],
    })
    expect((await api.fail('renders.complete', { id: job.id, error: 'x' })).status).toBe(409)

    // A queue that will not take the job fails it, rather than leaving it queued for ever.
    server.runtime.services.register('renderQueue', {
      capabilities: { blender: true },
      submit: async () => {
        throw new Error('blender crashed')
      },
      cancel: async () => {},
    })
    expect((await api.fail('renders.create', { pieceId: piece.id, scene: {} })).status).toBe(500)
    const [failed] = await api.call('renders.list', { pieceId: piece.id })
    expect(failed).toMatchObject({ engine: 'blender', status: 'failed' })
  })

  it('gives a piece with an automatic cover its first finished still as the cover', async () => {
    const submit = vi.fn<Services['renderQueue']['submit']>(async () => {})
    server.runtime.services.register('renderQueue', {
      capabilities: { blender: true },
      submit,
      cancel: async () => {},
    })
    const still = await putAsset(ctx, {
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      name: 'hero.png',
      mime: 'image/png',
      kind: 'image',
    })
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    expect(piece).toMatchObject({ coverAssetId: null, coverAuto: true })
    await api.call('renders.create', { pieceId: piece.id, scene: {} })
    await submit.mock.calls.at(-1)![2].update({
      status: 'done',
      progress: 1,
      assetIds: [still.id],
      seconds: 30,
    })
    expect((await api.call('pieces.get', { id: piece.id })).coverAssetId).toBe(still.id)

    // A cover someone chose stays.
    const chosen = await api.call('pieces.create', { templateId: 'solitaire' })
    await api.call('pieces.update', { id: chosen.id, coverAssetId: still.id })
    const other = await putAsset(ctx, {
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]),
      name: 'top.png',
      mime: 'image/png',
      kind: 'image',
    })
    await api.call('renders.create', { pieceId: chosen.id, scene: {} })
    await submit.mock.calls.at(-1)![2].update({
      status: 'done',
      progress: 1,
      assetIds: [other.id],
      seconds: 30,
    })
    expect((await api.call('pieces.get', { id: chosen.id })).coverAssetId).toBe(still.id)
  })

  it('hands work left unfinished by a restart back to its services, as whoever queued it', async () => {
    server.runtime.services.register('renderQueue', {
      capabilities: { blender: true },
      submit: async () => {},
      cancel: async () => {},
    })
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    const job = await api.call('renders.create', { pieceId: piece.id, scene: {} })
    const running = await traces.startRun(ctx, { model: 'm' })
    const waiting = await traces.startRun(ctx, { model: 'm' })
    await traces.finishRun(ctx, waiting.id, { status: 'awaiting-approval' })
    const live = await server.runtime.unfinished()
    // Oldest first, so queues fill again in the order the work was asked for.
    expect(live.map((u) => u.createdAt.getTime())).toEqual(
      live.map((u) => u.createdAt.getTime()).toSorted((a, b) => a - b),
    )
    expect(live.map((u) => [u.kind, u.id])).toEqual(
      expect.arrayContaining([
        ['render', job.id],
        ['run', running.id],
        ['run', waiting.id],
      ]),
    )

    const resume = vi.fn<NonNullable<Services['renderQueue']['resume']>>(async () => {})
    server.runtime.services.register('renderQueue', {
      capabilities: { blender: true },
      submit: async () => {},
      resume,
      cancel: async () => {},
    })
    await server.runtime.recover()
    const [resumed, subject, handle, sctx] = resume.mock.calls.find(([j]) => j.id === job.id)!
    expect([resumed.status, subject.id, sctx.userId, sctx.actor]).toEqual([
      'queued',
      piece.id,
      server.runtime.local!.userId,
      { type: 'user', id: server.runtime.local!.userId },
    ])
    await handle.update({ status: 'done', progress: 1, assetIds: [], cacheKey: 'sha256:k1' })
    expect((await sctx.cachedRender('sha256:k1'))?.id).toBe(job.id)
    expect(await sctx.cachedRender('sha256:other')).toBeNull()

    // Without an assistant runtime, a run cut off mid-step fails; one awaiting approval waits.
    const runs = await api.call('traces.runs', {})
    expect(runs.find((r) => r.id === running.id)).toMatchObject({
      status: 'failed',
      errorCode: 'interrupted',
    })
    expect(runs.find((r) => r.id === waiting.id)?.status).toBe('awaiting-approval')

    // A job whose service cannot resume it is failed, not left live.
    const stuck = await api.call('renders.create', { pieceId: piece.id, scene: {} })
    server.runtime.services.register('renderQueue', {
      capabilities: { blender: true },
      submit: async () => {},
      cancel: async () => {},
    })
    await server.runtime.recover()
    expect(await api.call('renders.get', { id: stuck.id })).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('Interrupted'),
    })
  })

  // Every other kind of work is failed when its service cannot take it up again; a run was not.
  it('fails a run its assistant could not take up again, and keeps one that awaits approval', async () => {
    const running = await traces.startRun(ctx, { model: 'm' })
    const waiting = await traces.startRun(ctx, { model: 'm' })
    await traces.finishRun(ctx, waiting.id, { status: 'awaiting-approval' })
    const refuse = async () => {
      throw new Error('not used')
    }
    const resume = vi.fn<NonNullable<Services['assistant']['resume']>>(async () => {
      throw new Error('the model key is gone')
    })
    server.runtime.services.register('assistant', {
      send: refuse,
      decide: refuse,
      cancel: refuse,
      respond: refuse,
      pause: refuse,
      resumeJob: refuse,
      accept: refuse,
      resume,
    })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await server.runtime.recover()
    } finally {
      logged.mockRestore()
    }
    expect(resume.mock.calls.map(([run]) => run.id)).toEqual(
      expect.arrayContaining([running.id, waiting.id]),
    )
    const runs = await api.call('traces.runs', {})
    expect(runs.find((r) => r.id === running.id)).toMatchObject({
      status: 'failed',
      errorCode: 'interrupted',
    })
    expect(runs.find((r) => r.id === waiting.id)?.status).toBe('awaiting-approval')
  })
})

describe('brand models and on-model images', () => {
  let server: TestServer
  let api: Client
  let ctx: Ctx
  const submitShot = vi.fn<Services['onModel']['submitShot']>(async () => {})
  const exportShot = vi.fn<Services['onModel']['exportShot']>(async () => ({
    bytes: new TextEncoder().encode('labelled'),
    name: 'shot.png',
    mime: 'image/png',
  }))

  beforeAll(async () => {
    server = await testServer({
      services: {
        onModel: {
          capabilities: { onModel: ['fake'] },
          portraits: async (_m, views) => ({
            recipe: { provider: 'fake', model: 'img-1', seed: 3 },
            portraits: views.map((view) => ({
              view,
              file: {
                bytes: new TextEncoder().encode(view),
                name: `${view}.png`,
                mime: 'image/png',
              },
            })),
          }),
          estimate: async (req) => ({
            provider: 'fake',
            model: 'img-1',
            usd: 0.1 * req.count,
            seconds: 40,
          }),
          estimatePortraits: async (_m, views) => ({
            provider: 'fake',
            model: 'img-1',
            usd: 0.05 * views.length,
            seconds: 20,
          }),
          submitShot,
          cancelShot: async () => {},
          exportShot,
        },
      },
    })
    api = client(server)
    ctx = await server.runtime.context(server.runtime.local!)
  }, BOOT_TIMEOUT)
  afterAll(() => server.dispose())

  it('approves a model as a person, freezing it and bumping its version', async () => {
    const model = await api.call('models.create', { name: 'Noor', card, attestedSynthetic: true })
    expect(model).toMatchObject({
      version: 0,
      approvedBy: null,
      recipe: null,
      card: { monkTone: null, eyes: '' },
    })
    expect(
      await api.call('models.estimatePortraits', { id: model.id, views: ['face', 'hands'] }),
    ).toEqual({ provider: 'fake', model: 'img-1', usd: 0.1, seconds: 20 })
    const portraits = await api.call('models.generatePortraits', { id: model.id, views: ['face'] })
    expect(portraits.recipe).toEqual({ provider: 'fake', model: 'img-1', seed: 3 })

    const agent = await server.runtime.context({
      ...server.runtime.local!,
      actor: { type: 'agent', runId: 'r' },
    })
    await expect(
      server.runtime.invoke('models.update', { id: model.id, status: 'approved' }, agent),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      server.runtime.invoke('models.create', { name: 'X', card, attestedSynthetic: true }, agent),
    ).rejects.toMatchObject({ status: 403 })

    const approved = await api.call('models.update', { id: model.id, status: 'approved' })
    expect(approved).toMatchObject({
      status: 'approved',
      version: 1,
      approvedBy: server.runtime.local!.userId,
    })
    expect(approved.approvedAt).not.toBeNull()
    expect(
      (await api.fail('models.update', { id: model.id, card: { hair: 'braids' } })).status,
    ).toBe(409)
    const reopened = await api.call('models.update', {
      id: model.id,
      status: 'draft',
      card: { monkTone: 7 },
    })
    expect(reopened).toMatchObject({
      status: 'draft',
      version: 1,
      approvedBy: null,
      card: { monkTone: 7 },
    })
    expect((await api.call('models.update', { id: model.id, status: 'approved' })).version).toBe(2)
  })

  it('changes only the card fields a partial edit gives', async () => {
    const full = {
      ...card,
      monkTone: 7,
      undertone: 'warm' as const,
      eyes: 'brown',
      marks: 'freckles',
      handLengthMm: 180,
    }
    const model = await api.call('models.create', {
      name: 'Ada',
      card: full,
      attestedSynthetic: true,
    })
    const edited = await api.call('models.update', { id: model.id, card: { hair: 'braids' } })
    expect(edited.card).toEqual({ ...full, hair: 'braids' })
  })

  it('makes on-model images from an approved model, and exports only checked ones', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    const draft = await api.call('models.create', { name: 'Draft', card, attestedSynthetic: true })
    expect(
      (await api.fail('shots.create', { modelId: draft.id, pieceId: piece.id, placement: 'hand' }))
        .status,
    ).toBe(409)
    const model = await api.call('models.update', { id: draft.id, status: 'approved' })

    expect(
      await api.call('shots.estimate', {
        modelId: model.id,
        pieceId: piece.id,
        placement: 'hand',
        count: 2,
      }),
    ).toMatchObject({ usd: 0.2 })
    const shots = await api.call('shots.create', {
      modelId: model.id,
      pieceId: piece.id,
      placement: 'hand',
      count: 2,
      aspect: '1:1',
    })
    expect(shots).toHaveLength(2)
    expect(shots[0]).toMatchObject({
      status: 'queued',
      aspect: '1:1',
      sourceVersion: 0,
      modelVersion: 1,
      stale: false,
      attempts: 0,
      stage: null,
      actor: { type: 'user' },
    })
    expect(submitShot).toHaveBeenCalledTimes(2)

    const handle = submitShot.mock.calls[0]![2] as JobHandle<ModelShotPatch>
    const image = await putAsset(ctx, {
      bytes: new TextEncoder().encode('o'),
      name: 'o.png',
      mime: 'image/png',
    })
    await handle.update({ status: 'running', stage: 'verify', attempts: 1 })
    expect(await api.call('shots.get', { id: shots[0]!.id })).toMatchObject({
      stage: 'verify',
      attempts: 1,
    })
    expect((await api.fail('shots.export', { id: shots[0]!.id })).status).toBe(409)
    await handle.update({
      status: 'done',
      assetId: image.id,
      check: {
        passed: true,
        notes: 'ok',
        findings: [{ code: 'stones.hero', ok: true, expected: '1', seen: '1' }],
      },
    })
    const original = await api.call('shots.export', { id: shots[0]!.id, label: false })
    expect(original.id).toBe(image.id)
    const labelled = await api.call('shots.export', { id: shots[0]!.id })
    expect(labelled.id).not.toBe(image.id)
    expect(exportShot).toHaveBeenCalledOnce()

    await api.call('models.update', { id: model.id, status: 'draft' })
    await api.call('models.update', { id: model.id, status: 'approved' })
    expect((await api.call('shots.get', { id: shots[0]!.id })).stale).toBe(true)

    const canceled = await api.call('shots.cancel', { id: shots[1]!.id })
    expect(canceled.status).toBe('canceled')
    await (submitShot.mock.calls[1]![2] as JobHandle<ModelShotPatch>).update({ status: 'done' })
    expect((await api.call('shots.get', { id: shots[1]!.id })).status).toBe('canceled')
    await api.call('shots.delete', { id: shots[1]!.id })
    expect((await api.call('shots.list', { pieceId: piece.id })).map((s) => s.id)).toEqual([
      shots[0]!.id,
    ])

    // If the pipeline refuses a shot, it and the shots not yet handed over fail; none stay queued.
    submitShot.mockRejectedValueOnce(new Error('provider down'))
    const refused = await api.fail('shots.create', {
      modelId: model.id,
      pieceId: piece.id,
      placement: 'hand',
      count: 2,
    })
    expect(refused.status).toBe(500)
    const after = await api.call('shots.list', { pieceId: piece.id })
    expect(after.filter((s) => s.id !== shots[0]!.id).map((s) => s.status)).toEqual([
      'failed',
      'failed',
    ])
  })

  // Deleting a piece deletes its job rows; the engines must be told, or Blender keeps rendering
  // and a paid provider keeps working for a piece that is gone, and whoever waits on a job
  // (`jobSettled`) waits for ever.
  it('stops and settles a piece’s live jobs when the piece is deleted', async () => {
    const cancelRender = vi.fn<Services['renderQueue']['cancel']>(async () => {})
    const cancelMesh = vi.fn<Services['mesh3d']['cancel']>(async () => {})
    const cancelShot = vi.fn<Services['onModel']['cancelShot']>(async () => {})
    const { services } = server.runtime
    services.register('renderQueue', {
      capabilities: { blender: true },
      submit: async () => {},
      cancel: cancelRender,
    })
    services.register('mesh3d', {
      estimate: async () => ({ provider: 'fake', model: 'm3d-1', usd: 0, seconds: 1 }),
      submit: async () => {},
      cancel: cancelMesh,
    })
    services.register('onModel', { ...services.get('onModel'), cancelShot })

    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    const draft = await api.call('models.create', { name: 'Ines', card, attestedSynthetic: true })
    const model = await api.call('models.update', { id: draft.id, status: 'approved' })
    const photo = await putAsset(ctx, {
      bytes: new TextEncoder().encode('photo'),
      name: 'photo.png',
      kind: 'image',
    })
    const blender = await api.call('renders.create', { pieceId: piece.id, scene: {} })
    const browser = await api.call('renders.create', {
      pieceId: piece.id,
      scene: {},
      engine: 'browser',
    })
    const mesh = await api.call('mesh3d.create', { pieceId: piece.id, imageAssetIds: [photo.id] })
    const [shot] = await api.call('shots.create', {
      modelId: model.id,
      pieceId: piece.id,
      placement: 'hand',
    })
    const finished = await api.call('renders.create', { pieceId: piece.id, scene: {} })
    await api.call('renders.cancel', { id: finished.id })
    cancelRender.mockClear()

    const settled: string[] = []
    const off = server.runtime.events.subscribe(ctx.orgId, (e) => {
      if (e.type === 'job.updated') settled.push(`${e.kind} ${e.id} ${e.status}`)
    })
    const waiting = serviceContext(ctx).jobSettled('render', blender.id)
    await api.call('pieces.delete', { id: piece.id })
    off()

    expect(cancelRender.mock.calls.map(([id]) => id)).toEqual([blender.id])
    expect(cancelMesh.mock.calls.map(([id]) => id)).toEqual([mesh.id])
    expect(cancelShot.mock.calls.map(([id]) => id)).toEqual([shot!.id])
    expect(settled.toSorted()).toEqual(
      [
        `render ${blender.id} canceled`,
        `render ${browser.id} canceled`,
        `mesh3d ${mesh.id} canceled`,
        `shot ${shot!.id} canceled`,
      ].toSorted(),
    )
    expect(await waiting).toBe('canceled')
    expect((await api.fail('renders.get', { id: blender.id })).status).toBe(404)
  })
})

describe('across people and organisations', () => {
  let server: TestServer
  let ada: Client
  let ben: Client
  let dee: Client
  beforeAll(async () => {
    server = await testServer({ auth: 'accounts' })
    ada = await signUp(server, 'Ada', 'ada@example.com')
    ben = await signUp(server, 'Ben', 'ben@example.com')
    dee = await signUp(server, 'Dee', 'dee@example.com')
    const orgId = (await ada.call('session.get', {})).activeOrgId
    await ada.call('org.invite', { email: 'dee@example.com', role: 'designer' })
    const owner = (await ada.call('org.members', {}))[0]!
    const actx = await server.runtime.context({ userId: owner.user.id, orgId })
    const invitation = (await actx.repo.invitations.many()).find(
      (i) => i.email === 'dee@example.com',
    )!
    await authPost(dee, '/organization/accept-invitation', { invitationId: invitation.id })
    await authPost(dee, '/organization/set-active', { organizationId: orgId })
  }, BOOT_TIMEOUT)
  afterAll(() => server.dispose())

  it('lets only the person who queued a browser take deliver it, and hides it from other orgs', async () => {
    const piece = await ada.call('pieces.create', { templateId: 'halo' })
    const job = await ada.call('renders.create', { pieceId: piece.id, scene: {} })
    expect((await dee.fail('renders.complete', { id: job.id, error: 'x' })).status).toBe(403)
    expect((await ben.fail('renders.complete', { id: job.id, error: 'x' })).status).toBe(404)
    const shot = await ada.call('scenes.create', { pieceId: piece.id, title: 'Hero', scene: {} })
    expect((await ben.fail('scenes.update', { id: shot.id, title: 'x' })).status).toBe(404)
    expect((await ben.fail('renders.create', { pieceId: piece.id, sceneId: shot.id })).status).toBe(
      404,
    )
    expect(await ben.call('scenes.list', { pieceId: null })).toEqual([])
    await ada.call('renders.complete', { id: job.id, error: 'WebGL context lost' })
  })

  it('refuses engine configuration outside a local install, and to non-owners', async () => {
    expect((await ada.fail('renders.configureEngine', { blenderPath: null })).status).toBe(403)
    expect((await dee.fail('renders.configureEngine', { blenderPath: null })).status).toBe(403)
  })
})
