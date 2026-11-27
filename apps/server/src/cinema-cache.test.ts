import { emptyDesign } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { subjectOf } from './cinema'
import type { Ctx } from './context'
import { type GeometryService, type RenderSubject, ServiceRegistry } from './services'
import { BOOT_TIMEOUT, type Client, client, type TestServer, testServer } from './test/harness'

type Measure = NonNullable<GeometryService['subject']>

const measured = (width: number): RenderSubject => ({
  bounds: { min: [0, 0, 0], max: [width, 2, 1] },
  stones: [],
  parts: [],
})

const geometry = (subject: Measure): GeometryService => ({
  ...new ServiceRegistry().get('geometry'),
  subject,
  evaluate: async () => ({
    boundsMm: { x: 0, y: 0, z: 0 },
    metalMassG: 0,
    metals: [],
    stoneCount: 0,
    caratTotal: 0,
    lots: [],
    diagnostics: [],
  }),
})

const importMeasurement = vi.fn<Measure>(async (design) => {
  const result = measured(2)
  if (design.nodes.source?.visible)
    result.parts = [
      {
        id: 'source',
        nodeId: 'source',
        bounds: result.bounds,
        material: 'pt950',
        finish: 'polished',
        plating: 'none',
        importRole: 'unassigned',
      },
    ]
  return result
})

let server: TestServer
let api: Client
let ctx: Ctx
beforeAll(async () => {
  server = await testServer({ services: { geometry: geometry(importMeasurement) } })
  api = client(server)
  ctx = await server.runtime.context(server.runtime.local!)
}, BOOT_TIMEOUT)
afterAll(() => server.dispose())

const piece = { id: 'pc_measure', version: 1, design: emptyDesign('bracelet') }
const including = { includeUnassignedRhino: true } as const
const circle = { ...including, pose: 'circular-band' } as const
const clientWith = (subject: Measure) => ({
  ...ctx,
  services: new ServiceRegistry({ geometry: geometry(subject) }),
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}

describe('shot geometry measurements', () => {
  it('reuses a successful measurement across requests for the same saved piece and mode', async () => {
    const measure = vi.fn<Measure>().mockResolvedValue(measured(4))
    const local = clientWith(measure)
    expect(await subjectOf(local, piece, undefined, including)).toEqual(measured(4))
    expect(
      await subjectOf(local, { ...piece, design: structuredClone(piece.design) }, undefined, {
        ...including,
        pose: 'as-designed',
      }),
    ).toEqual(measured(4))
    expect(measure).toHaveBeenCalledTimes(1)
  })

  it('keeps version, piece, tenant, engine and effective pose and import visibility separate', async () => {
    const measure = vi.fn<Measure>()
    const local = clientWith(measure)
    const scenarios = [
      [local, piece, including],
      [local, { ...piece, version: 2 }, including],
      [local, { ...piece, id: 'pc_other' }, including],
      [{ ...local, orgId: 'org_other' }, piece, including],
      [clientWith(measure), piece, including],
      [local, piece, circle],
      [local, piece, { includeUnassignedRhino: false, pose: 'circular-band' } as const],
    ] as const
    for (let i = 0; i < scenarios.length; i++) {
      measure.mockResolvedValueOnce(measured(i))
      const [caller, saved, mode] = scenarios[i]!
      expect(await subjectOf(caller, saved, undefined, mode)).toEqual(measured(i))
    }
    expect(await subjectOf(local, piece, undefined, including)).toEqual(measured(0))
    expect(measure).toHaveBeenCalledTimes(scenarios.length)
  })

  it('shares a pending measurement without canceling another request', async () => {
    const pending = deferred<RenderSubject>()
    const started = deferred<AbortSignal | undefined>()
    const measure = vi.fn<Measure>((_design, _ctx, call) => {
      started.resolve(call?.signal)
      return pending.promise
    })
    const local = clientWith(measure)
    const caller = new AbortController()
    const first = subjectOf(local, piece, caller.signal)
    const second = subjectOf(local, piece)
    const firstResult = expect(first).rejects.toThrow('request canceled')
    const shared = await started.promise
    caller.abort(new Error('request canceled'))
    pending.resolve(measured(6))
    await firstResult
    expect(await second).toEqual(measured(6))
    expect(shared?.aborted).toBe(false)
    expect(measure).toHaveBeenCalledTimes(1)
  })

  it('abandons a measurement when its last request cancels and never caches the late result', async () => {
    const abandoned = deferred<RenderSubject>()
    const started = deferred<AbortSignal | undefined>()
    const measure = vi
      .fn<Measure>()
      .mockImplementationOnce((_design, _ctx, call) => {
        started.resolve(call?.signal)
        return abandoned.promise
      })
      .mockResolvedValueOnce(measured(8))
    const local = clientWith(measure)
    const caller = new AbortController()
    const first = subjectOf(local, piece, caller.signal)
    const canceled = expect(first).rejects.toThrow('no listeners')
    const engineSignal = await started.promise
    caller.abort(new Error('no listeners'))
    abandoned.resolve(measured(77))
    await canceled
    expect(engineSignal?.aborted).toBe(true)
    expect(await subjectOf(local, piece)).toEqual(measured(8))
    expect(await subjectOf(local, piece)).toEqual(measured(8))
    expect(measure).toHaveBeenCalledTimes(2)
  })

  it('allows a retry after an engine failure', async () => {
    const measure = vi
      .fn<Measure>()
      .mockRejectedValueOnce(new Error('worker exited'))
      .mockResolvedValueOnce(measured(8))
    const local = clientWith(measure)
    await expect(subjectOf(local, piece)).rejects.toThrow('worker exited')
    expect(await subjectOf(local, piece)).toEqual(measured(8))
    expect(await subjectOf(local, piece)).toEqual(measured(8))
    expect(measure).toHaveBeenCalledTimes(2)
  })

  it('evicts old measurements while retaining recently read versions', async () => {
    const measure = vi.fn<Measure>().mockResolvedValue(measured(8))
    const local = clientWith(measure)
    for (let version = 1; version <= 32; version++) await subjectOf(local, { ...piece, version })
    await subjectOf(local, piece)
    await subjectOf(local, { ...piece, version: 33 })
    await subjectOf(local, piece)
    expect(measure).toHaveBeenCalledTimes(33)
    await subjectOf(local, { ...piece, version: 2 })
    expect(measure).toHaveBeenCalledTimes(34)
  })
})

describe('imported shot RPCs', () => {
  it('skips measuring fully specified shots and Blender estimates, and refreshes legacy defaults only when CAD changes', async () => {
    importMeasurement.mockClear()
    const fresh = await api.call('pieces.create', { kind: 'bracelet' })
    await api.call('design.apply', {
      pieceId: fresh.id,
      label: 'Import fixture',
      ops: [
        {
          t: 'add',
          node: {
            id: 'source',
            kind: 'meshBody',
            importRole: 'unassigned',
            keepSourcePlacement: true,
            source: { type: 'asset', assetId: 'as_fixture', rhinoLayer: 'Jewelry' },
          },
        },
      ],
    })
    const explicit = await api.call('scenes.create', {
      pieceId: fresh.id,
      title: 'Explicit clay',
      scene: { ...including, importedBodyLook: 'clay' },
    })
    const [opened] = await api.call('scenes.list', { pieceId: fresh.id })
    expect(opened?.scene).toEqual(explicit.scene)
    await api.call('renders.estimate', {
      pieceId: fresh.id,
      engine: 'blender',
      takes: [{ sceneId: explicit.id }, { scene: {} }],
    })
    expect(importMeasurement).not.toHaveBeenCalled()

    const legacy = await api.call('scenes.create', {
      pieceId: fresh.id,
      title: 'Legacy',
      scene: {},
    })
    expect(legacy.scene).toMatchObject({ ...including, importedBodyLook: 'source' })
    const repeated = await api.call('scenes.list', { pieceId: fresh.id })
    expect(repeated.find(({ id }) => id === legacy.id)).toEqual(legacy)
    const queued = await api.call('renders.create', {
      pieceId: fresh.id,
      sceneId: legacy.id,
      engine: 'browser',
    })
    expect(queued.requestedScene).toEqual(legacy.scene)
    expect(importMeasurement).toHaveBeenCalledTimes(1)

    await api.call('design.apply', {
      pieceId: fresh.id,
      label: 'Hide source body',
      ops: [{ t: 'update', id: 'source', patch: { visible: false } }],
    })
    const after = await api.call('scenes.list', { pieceId: fresh.id })
    expect(after.find(({ id }) => id === legacy.id)?.scene.includeUnassignedRhino).toBeUndefined()
    expect(after.find(({ id }) => id === explicit.id)?.scene.importedBodyLook).toBe('clay')
    expect(importMeasurement).toHaveBeenCalledTimes(2)
  })
})
