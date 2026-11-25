/**
 * Plan allowances: each counted action is counted once (finished Blender takes; Rhino and STEP
 * exports; production packages with those files), work that fails or is canceled gives its unit
 * back, mesh exports and browser takes never count, two tabs cannot both take the last free
 * one, the count starts again each calendar month (UTC), and PAVE_PLAN or the organisation's
 * plan lifts the limits up to the fair-use ceiling. Engines are fakes the tests settle by hand.
 */
import { ANIMATION_RENDER_COST, planLimitMessage } from '@pave/schema'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { configFromEnv, planWarning } from './config'
import type { Ctx } from './context'
import { claim } from './plans'
import type {
  JobHandle,
  ProductionPackagePatch,
  ProductionRequest,
  RenderJobPatch,
  Services,
} from './services'
import {
  BOOT_TIMEOUT,
  type Client,
  client,
  signUp,
  type TestServer,
  testServer,
} from './test/harness'

type Takes = Map<string, JobHandle<RenderJobPatch>>
type Packages = Map<
  string,
  { handle: JobHandle<ProductionPackagePatch>; request: ProductionRequest }
>

/** Fake engines: renders and packages wait until a test settles them; exports can be made to fail. */
function engines() {
  const takes: Takes = new Map()
  const packages: Packages = new Map()
  const exports = { fail: false, calls: 0 }
  const services: Partial<Services> = {
    renderQueue: {
      capabilities: { blender: true },
      submit: async (job, _piece, handle) => {
        takes.set(job.id, handle)
      },
      cancel: async () => {},
    },
    geometry: {
      evaluate: async () => {
        throw new Error('not used here')
      },
      export: async (_design, { format }) => {
        exports.calls++
        if (exports.fail) throw new Error('the exporter crashed')
        return {
          file: { bytes: new Uint8Array([1, 2, 3]), name: `p.${format}`, mime: 'model/x' },
          notes: [],
        }
      },
      renderInput: async () => {
        throw new Error('not used here')
      },
    },
    production: {
      submit: async (pkg, request, handle) => {
        packages.set(pkg.id, { handle, request })
      },
    },
  }
  return { takes, packages, exports, services }
}

const scene = { look: 'catalog-white' as const }

async function used(api: Client) {
  const plan = await api.call('plan.get', {})
  const of = (a: 'render' | 'export') => plan.allowances.find((x) => x.allowance === a)!.used
  return { render: of('render'), export: of('export') }
}

describe('a Free plan', () => {
  let server: TestServer
  let api: Client
  let ctx: Ctx
  let fake: ReturnType<typeof engines>
  let pieceId: string

  beforeAll(async () => {
    fake = engines()
    server = await testServer({ services: fake.services })
    api = client(server)
    ctx = await server.runtime.context(server.runtime.local!)
    pieceId = (await api.call('pieces.create', { templateId: 'solitaire' })).id
  }, BOOT_TIMEOUT)
  afterAll(() => server.dispose())
  // Each test starts with the month unused.
  beforeEach(async () => {
    await ctx.repo.planClaims.delete(sql`true`)
    fake.exports.fail = false
  })
  afterEach(() => vi.useRealTimers())

  it('says what the plan is, what is used and when it resets', async () => {
    const plan = await api.call('plan.get', {})
    expect(plan).toMatchObject({ plan: 'free', label: 'Free', source: 'default' })
    expect(plan.allowances).toEqual([
      expect.objectContaining({ allowance: 'render', used: 0, limit: 5, left: 5 }),
      expect.objectContaining({ allowance: 'export', used: 0, limit: 5, left: 5 }),
    ])
    const now = new Date()
    expect(plan.period).toBe(now.toISOString().slice(0, 7))
    expect(new Date(plan.resetsAt).getUTCDate()).toBe(1)
    expect(new Date(plan.resetsAt).getTime()).toBeGreaterThan(now.getTime())
  })

  it('counts finished Blender takes and gives back failed, canceled and cached ones', async () => {
    const take = () => api.call('renders.create', { pieceId, scene })
    const [done, failed, canceled, cached] = [
      await take(),
      await take(),
      await take(),
      await take(),
    ]
    // Held while they render: running work counts, so nobody can queue past the limit.
    expect(await used(api)).toEqual({ render: 4, export: 0 })
    await fake.takes
      .get(done.id)!
      .update({ status: 'done', progress: 1, assetIds: [], seconds: 12 })
    await fake.takes.get(failed.id)!.update({ status: 'failed', error: 'blender crashed' })
    await api.call('renders.cancel', { id: canceled.id })
    // Served from the render cache: no Blender time, not counted.
    await fake.takes
      .get(cached.id)!
      .update({ status: 'done', progress: 1, assetIds: [], seconds: 0 })
    expect(await used(api)).toEqual({ render: 1, export: 0 })
    // A late update after it settled cannot count it again or give it back.
    await fake.takes.get(done.id)!.update({ status: 'failed', error: 'late' })
    expect(await used(api)).toEqual({ render: 1, export: 0 })

    // Browser takes are previews: never counted, even past the limit.
    for (let i = 0; i < 4; i++) await take()
    expect(await used(api)).toEqual({ render: 5, export: 0 })
    const browser = await api.call('renders.create', { pieceId, scene, engine: 'browser' })
    expect(browser.engine).toBe('browser')

    const before = (await api.call('renders.list', { pieceId })).length
    const refused = await api.fail('renders.create', { pieceId, scene })
    expect(refused.status).toBe(402)
    expect(refused.error).toMatchObject({
      code: 'plan_limit',
      plan: 'free',
      allowance: 'render',
      limit: 5,
      used: 5,
      fairUse: false,
    })
    expect(refused.error.message).toMatch(
      /^You have used your 5 free renders this month\. Pro has unlimited renders\./,
    )
    // Refused before the work started: no take was queued.
    expect((await api.call('renders.list', { pieceId })).length).toBe(before)
  })

  it('counts a Blender animation as ANIMATION_RENDER_COST renders, all or none', async () => {
    expect(ANIMATION_RENDER_COST).toBe(2)
    const motion = { ...scene, animation: { type: 'turntable' as const, seconds: 1, fps: 24 } }
    const turntable = await api.call('renders.create', { pieceId, scene: motion })
    expect(await used(api)).toEqual({ render: 2, export: 0 })
    await fake.takes
      .get(turntable.id)!
      .update({ status: 'done', progress: 1, assetIds: [], seconds: 30 })
    expect(await used(api)).toEqual({ render: 2, export: 0 })

    // A failed animation gives both back.
    const failed = await api.call('renders.create', { pieceId, scene: motion })
    expect(await used(api)).toEqual({ render: 4, export: 0 })
    await fake.takes.get(failed.id)!.update({ status: 'failed', error: 'blender crashed' })
    expect(await used(api)).toEqual({ render: 2, export: 0 })

    // With one free render left, an animation is refused whole (nothing is held) and a still fits.
    await api.call('renders.create', { pieceId, scene })
    await api.call('renders.create', { pieceId, scene })
    expect(await used(api)).toEqual({ render: 4, export: 0 })
    const refused = await api.fail('renders.create', { pieceId, scene: motion })
    expect(refused.status).toBe(402)
    expect(await used(api)).toEqual({ render: 4, export: 0 })
    await api.call('renders.create', { pieceId, scene })
    expect(await used(api)).toEqual({ render: 5, export: 0 })
  })

  it('gives back the render of a take its queue would not accept', async () => {
    server.runtime.services.register('renderQueue', {
      capabilities: { blender: true },
      submit: async () => {
        throw new Error('blender crashed')
      },
      cancel: async () => {},
    })
    try {
      expect((await api.fail('renders.create', { pieceId, scene })).status).toBe(500)
      expect(await used(api)).toEqual({ render: 0, export: 0 })
    } finally {
      server.runtime.services.register('renderQueue', fake.services.renderQueue!)
    }
  })

  it('keeps a take resumed after a restart counted, and gives back one nobody can resume', async () => {
    const resumed = await api.call('renders.create', { pieceId, scene })
    const stuck = await api.call('renders.create', { pieceId, scene: { look: 'black-acrylic' } })
    const handles = new Map<string, JobHandle<RenderJobPatch>>()
    server.runtime.services.register('renderQueue', {
      capabilities: { blender: true },
      submit: async () => {},
      // Resumes the first take only; the second is failed as interrupted.
      resume: async (job, _piece, handle) => {
        if (job.id !== resumed.id) throw new Error('the queue lost it')
        handles.set(job.id, handle)
      },
      cancel: async () => {},
    })
    try {
      await server.runtime.recover()
      expect((await api.call('renders.get', { id: stuck.id })).status).toBe('failed')
      expect(await used(api)).toEqual({ render: 1, export: 0 })
      await handles
        .get(resumed.id)!
        .update({ status: 'done', progress: 1, assetIds: [], seconds: 9 })
      expect(await used(api)).toEqual({ render: 1, export: 0 })
      const states = (await ctx.repo.planClaims.many()).map((r) => r.state).toSorted()
      expect(states).toEqual(['released', 'used'])
    } finally {
      server.runtime.services.register('renderQueue', fake.services.renderQueue!)
    }
  })

  it('counts Rhino and STEP exports, never mesh formats, and gives back a failed export', async () => {
    for (const format of ['stl', '3mf', 'obj', 'glb'] as const)
      await api.call('design.export', { pieceId, format })
    expect(await used(api)).toEqual({ render: 0, export: 0 })
    await api.call('design.export', { pieceId, format: 'step' })
    await api.call('design.export', { pieceId, format: '3dm' })
    expect(await used(api)).toEqual({ render: 0, export: 2 })

    fake.exports.fail = true
    expect((await api.fail('design.export', { pieceId, format: 'step' })).status).toBe(500)
    expect(await used(api)).toEqual({ render: 0, export: 2 })
  })

  it('never lets a client give an export back: only a failed server export returns its slot', async () => {
    // The studio exports Rhino and STEP through design.export now; a claim made from outside
    // could otherwise be given back after the file was saved in the browser, for free exports.
    for (let i = 0; i < 3; i++) {
      const c = await api.call('plan.claim', { pieceId, format: 'step', key: `loop-key-${i}` })
      const refused = await api.fail('plan.settle', { claimId: c.claimId!, delivered: false })
      expect(refused.status).toBe(409)
    }
    expect(await used(api)).toEqual({ render: 0, export: 3 })
  })

  it('lets a client claim an export first, settle it, or hand it to the server', async () => {
    const stl = await api.call('plan.claim', { pieceId, format: 'stl', key: 'tab1-try1' })
    expect(stl).toMatchObject({ claimId: null, counted: false })

    const a = await api.call('plan.claim', { pieceId, format: 'step', key: 'tab1-try2' })
    expect(a.counted).toBe(true)
    expect(a.plan.allowances[1]).toMatchObject({ used: 1, left: 4 })
    // The same key is the same claim: a retried request is counted once.
    const again = await api.call('plan.claim', { pieceId, format: 'step', key: 'tab1-try2' })
    expect(again.claimId).toBe(a.claimId)
    expect(await used(api)).toEqual({ render: 0, export: 1 })
    // Settled as delivered, once.
    await api.call('plan.settle', { claimId: a.claimId!, delivered: true })
    expect(await used(api)).toEqual({ render: 0, export: 1 })
    expect((await api.fail('plan.settle', { claimId: a.claimId!, delivered: true })).status).toBe(
      409,
    )
    // The same key again is still that one claim, counted once.
    const settledAgain = await api.call('plan.claim', { pieceId, format: 'step', key: 'tab1-try2' })
    expect(settledAgain.claimId).toBe(a.claimId)
    expect(await used(api)).toEqual({ render: 0, export: 1 })

    // The browser's exporter failed and the server exported instead, under the same claim.
    const b = await api.call('plan.claim', { pieceId, format: '3dm', key: 'tab1-try3' })
    await api.call('design.export', { pieceId, format: '3dm', claimId: b.claimId! })
    expect(await used(api)).toEqual({ render: 0, export: 2 })
    const row = (await ctx.repo.planClaims.many()).find((r) => r.id === b.claimId)
    expect(row).toMatchObject({ state: 'used', subject: '3dm' })
    // A claim settled already, or for another format, is not reused.
    expect(
      (await api.fail('design.export', { pieceId, format: '3dm', claimId: b.claimId! })).status,
    ).toBe(409)
    const c = await api.call('plan.claim', { pieceId, format: 'step', key: 'tab1-try4' })
    expect(
      (await api.fail('design.export', { pieceId, format: '3dm', claimId: c.claimId! })).status,
    ).toBe(409)
  })

  it('counts a client export claim nobody settled, after half an hour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = new Date()
    vi.setSystemTime(start)
    // The tab claimed, then closed before the file was saved: nothing settles it.
    const abandoned = await api.call('plan.claim', { pieceId, format: 'step', key: 'closed-tab' })
    const working = await api.call('plan.claim', { pieceId, format: 'step', key: 'slow-save' })
    expect(await used(api)).toEqual({ render: 0, export: 2 })

    vi.setSystemTime(new Date(start.getTime() + 20 * 60_000))
    expect(await used(api)).toEqual({ render: 0, export: 2 })
    await api.call('plan.settle', { claimId: working.claimId!, delivered: true })

    vi.setSystemTime(new Date(start.getTime() + 31 * 60_000))
    // The server never learns whether a client's file was saved: an abandoned claim counts.
    expect(await used(api)).toEqual({ render: 0, export: 2 })
    expect(
      (await api.fail('plan.settle', { claimId: abandoned.claimId!, delivered: true })).status,
    ).toBe(409)
  })

  it('counts a production package with Rhino and STEP once, and not one with STL only', async () => {
    const withCad = await api.call('production.create', { pieceId })
    expect(fake.packages.get(withCad.id)!.request.cadFiles).toBe(true)
    expect(await used(api)).toEqual({ render: 0, export: 1 })
    await fake.packages.get(withCad.id)!.handle.update({
      status: 'done',
      assetId: null,
      manifest: { files: [{ path: 'cad/SOL-01_band.stl' }, { path: 'cad/SOL-01.3dm' }] },
    })
    expect(await used(api)).toEqual({ render: 0, export: 1 })

    const stlOnly = await api.call('production.create', { pieceId, cadFiles: false })
    expect(fake.packages.get(stlOnly.id)!.request.cadFiles).toBe(false)
    expect(await used(api)).toEqual({ render: 0, export: 1 })

    // The kernel could not write Rhino or STEP after all: the package is not counted.
    const noCad = await api.call('production.create', { pieceId })
    await fake.packages.get(noCad.id)!.handle.update({
      status: 'done',
      manifest: { files: [{ path: 'cad/SOL-01_band.stl' }] },
    })
    const failed = await api.call('production.create', { pieceId })
    await fake.packages.get(failed.id)!.handle.update({ status: 'failed' })
    expect(await used(api)).toEqual({ render: 0, export: 1 })
  })

  it('lets only one of two tabs take the last free export', async () => {
    for (let i = 0; i < 4; i++) await api.call('design.export', { pieceId, format: 'step' })
    const outcomes = await Promise.allSettled([
      api.call('design.export', { pieceId, format: 'step' }),
      api.call('design.export', { pieceId, format: '3dm' }),
      api.call('plan.claim', { pieceId, format: 'step', key: 'tab2-race' }),
    ])
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1)
    expect(await used(api)).toEqual({ render: 0, export: 5 })
  })

  it('leaves the last free one to the database when two claims both saw it free', async () => {
    for (let i = 0; i < 4; i++) await api.call('design.export', { pieceId, format: 'step' })
    // Hold both claims after they read the taken slots until both have read them: each sees
    // slot 5 free, so only the unique index can stop the second one.
    let reads = 0
    let open!: () => void
    const bothRead = new Promise<void>((r) => {
      open = r
    })
    const table = ctx.repo.planClaims
    const racing = (): Ctx => {
      const select = ((fields, cond) => {
        const query = table.select(fields, cond)
        return (async () => {
          const rows = await query
          if (++reads === 2) open()
          if (reads <= 2) await bothRead
          return rows
        })()
      }) as typeof table.select
      // The table keeps its connection in a private field, so every other method stays bound to it.
      const planClaims = new Proxy(table, {
        get: (target, prop) => {
          if (prop === 'select') return select
          const value = Reflect.get(target, prop, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
      const repo = Object.create(ctx.repo) as Ctx['repo']
      Object.defineProperty(repo, 'planClaims', { value: planClaims })
      return { ...ctx, repo }
    }
    const req = (key: string) => ({ allowance: 'export' as const, key, subject: 'step', pieceId })
    const outcomes = await Promise.allSettled([
      claim(racing(), req('race:a')),
      claim(racing(), req('race:b')),
    ])
    expect(reads).toBeGreaterThanOrEqual(3)
    expect(outcomes.map((o) => o.status).toSorted()).toEqual(['fulfilled', 'rejected'])
    const lost = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult
    expect(lost.reason).toMatchObject({ code: 'plan_limit' })
    expect(await used(api)).toEqual({ render: 0, export: 5 })
  })

  it('gives each of many claims at once its own slot, up to the limit', async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 9 }, (_, i) =>
        api.call('plan.claim', { pieceId, format: 'step', key: `burst-key-${i}` }),
      ),
    )
    const won = outcomes.filter((o) => o.status === 'fulfilled')
    expect(won).toHaveLength(5)
    const lost = outcomes.filter((o) => o.status === 'rejected') as PromiseRejectedResult[]
    expect(
      lost.every((o) => (o.reason as { error: { code: string } }).error.code === 'plan_limit'),
    ).toBe(true)
    const slots = (await ctx.repo.planClaims.many()).map((r) => r.slot).toSorted()
    expect(slots).toEqual([1, 2, 3, 4, 5])
  })

  it('starts counting again each calendar month (UTC)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-30T23:59:00Z'))
    for (let i = 0; i < 5; i++) await api.call('design.export', { pieceId, format: 'step' })
    const refused = await api.fail('design.export', { pieceId, format: 'step' })
    expect(refused.error).toMatchObject({
      code: 'plan_limit',
      resetsAt: '2026-12-01T00:00:00.000Z',
    })
    expect(refused.error.message).toContain('The count resets on 1 December.')

    vi.setSystemTime(new Date('2026-12-01T00:00:30Z'))
    const plan = await api.call('plan.get', {})
    expect(plan).toMatchObject({ period: '2026-12', resetsAt: '2027-01-01T00:00:00.000Z' })
    expect(plan.allowances[1]).toMatchObject({ used: 0, left: 5 })
    await api.call('design.export', { pieceId, format: 'step' })
    expect(await used(api)).toEqual({ render: 0, export: 1 })
  })

  it('follows the organisation’s plan', async () => {
    await ctx.repo.settings.insertIfAbsent({})
    await ctx.repo.settings.update(sql`true`, { plan: 'pro' })
    try {
      expect(await api.call('plan.get', {})).toMatchObject({ plan: 'pro', source: 'org' })
      for (let i = 0; i < 6; i++) await api.call('design.export', { pieceId, format: 'step' })
      expect(await used(api)).toEqual({ render: 0, export: 6 })
    } finally {
      await ctx.repo.settings.update(sql`true`, { plan: null })
    }
  })
})

describe('PAVE_PLAN=pro on a local install', () => {
  let server: TestServer
  let api: Client
  let ctx: Ctx
  let pieceId: string

  beforeAll(async () => {
    server = await testServer({ services: engines().services, config: { plan: 'pro' } })
    api = client(server)
    ctx = await server.runtime.context(server.runtime.local!)
    pieceId = (await api.call('pieces.create', { templateId: 'solitaire' })).id
  }, BOOT_TIMEOUT)
  afterAll(() => server.dispose())

  it('lifts the limits, up to the fair-use ceiling', async () => {
    const plan = await api.call('plan.get', {})
    expect(plan).toMatchObject({ plan: 'pro', source: 'env' })
    expect(plan.allowances[0]).toMatchObject({ limit: null, ceiling: 1000 })
    for (let i = 0; i < 7; i++) await api.call('renders.create', { pieceId, scene })
    expect(await used(api)).toEqual({ render: 7, export: 0 })

    // Fill the month to the ceiling directly; the next take is refused as fair use.
    const period = plan.period
    await ctx.repo.planClaims.insertMany(
      Array.from({ length: 993 }, (_, i) => ({
        id: `clm_fill_${i}`,
        idempotencyKey: `fill:${i}`,
        allowance: 'render' as const,
        period,
        slot: i + 8,
        state: 'used' as const,
        subject: 'render',
        userId: ctx.user.id,
        actor: ctx.actor,
      })),
    )
    const refused = await api.fail('renders.create', { pieceId, scene })
    expect(refused.status).toBe(402)
    expect(refused.error).toMatchObject({ code: 'plan_limit', fairUse: true, limit: 1000 })
    expect(refused.error.message).toMatch(
      /^This month’s fair-use ceiling of 1000 renders is reached\./,
    )
  })
})

describe('accounts mode', () => {
  let server: TestServer
  beforeAll(async () => {
    server = await testServer({ auth: 'accounts', services: engines().services })
  }, BOOT_TIMEOUT)
  afterAll(() => server.dispose())

  it('keeps each organisation’s plan and counts apart', async () => {
    const ada = await signUp(server, 'Ada', 'ada@example.com')
    const bo = await signUp(server, 'Bo', 'bo@example.com')
    const [adaSession, boSession] = await Promise.all([
      ada.call('session.get', {}),
      bo.call('session.get', {}),
    ])
    const adaCtx = await server.runtime.context({
      userId: adaSession.user.id,
      orgId: adaSession.activeOrgId,
    })
    await adaCtx.repo.settings.insertIfAbsent({})
    await adaCtx.repo.settings.update(sql`true`, { plan: 'pro' })

    const adaPiece = (await ada.call('pieces.create', { templateId: 'solitaire' })).id
    const boPiece = (await bo.call('pieces.create', { templateId: 'solitaire' })).id
    for (let i = 0; i < 6; i++)
      await ada.call('design.export', { pieceId: adaPiece, format: 'step' })
    await bo.call('design.export', { pieceId: boPiece, format: 'step' })

    expect(await ada.call('plan.get', {})).toMatchObject({
      plan: 'pro',
      source: 'org',
      localInstall: false,
    })
    expect(await used(ada)).toEqual({ render: 0, export: 6 })
    expect(await bo.call('plan.get', {})).toMatchObject({ plan: 'free', source: 'default' })
    expect(await used(bo)).toEqual({ render: 0, export: 1 })
    // A claim is the claimer's own: nobody else can settle it, even by its id.
    const claim = await bo.call('plan.claim', { pieceId: boPiece, format: 'step', key: 'bo-try-1' })
    expect(
      (await ada.fail('plan.settle', { claimId: claim.claimId!, delivered: false })).status,
    ).toBe(404)
    expect(boSession.activeOrgId).not.toBe(adaSession.activeOrgId)
  })
})

describe('PAVE_PLAN', () => {
  it('applies on a local install only, and a mistyped one is ignored with a warning', () => {
    const local = configFromEnv({ NODE_ENV: 'test', PAVE_PLAN: 'Pro' })
    expect(local.plan).toBe('pro')
    expect(planWarning(local, { PAVE_PLAN: 'Pro' })).toBeNull()

    const typo = configFromEnv({ NODE_ENV: 'test', PAVE_PLAN: 'premium' })
    expect(typo.plan).toBeNull()
    expect(planWarning(typo, { PAVE_PLAN: 'premium' })).toContain('is not a plan')

    const accounts = configFromEnv({ NODE_ENV: 'test', PAVE_AUTH: 'accounts', PAVE_PLAN: 'pro' })
    expect(accounts.plan).toBeNull()
    expect(planWarning(accounts, { PAVE_PLAN: 'pro' })).toContain('ignored in accounts mode')
  })

  it('words the limit the same for one, many and fair use', () => {
    const base = { plan: 'free' as const, used: 1, resetsAt: '2026-12-01T00:00:00.000Z' }
    expect(planLimitMessage({ ...base, allowance: 'export', limit: 1, fairUse: false })).toBe(
      'You have used your 1 free Rhino or STEP export this month. Pro has unlimited Rhino or STEP exports. The count resets on 1 December.',
    )
    expect(planLimitMessage({ ...base, allowance: 'render', limit: 5, fairUse: false })).toBe(
      'You have used your 5 free renders this month. Pro has unlimited renders. The count resets on 1 December.',
    )
  })
})
