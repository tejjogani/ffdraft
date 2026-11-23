import { TEMPLATES } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Client, client, type TestServer, testServer } from './test/harness'
import { traces } from './traces'
import { recordUsage } from './usage'

let server: TestServer
let api: Client

beforeAll(async () => {
  server = await testServer()
  api = client(server)
})
afterAll(() => server.dispose())

describe('session & organisation', () => {
  it('returns the local user, their org and capabilities', async () => {
    const s = await api.call('session.get', {})
    expect(s.user.email).toBe('local@pave.invalid')
    expect(s.orgs).toHaveLength(1)
    expect(s.orgs[0]).toMatchObject({ id: s.activeOrgId, role: 'owner' })
    expect(s.capabilities).toEqual({
      assistant: false,
      imageSearch: [],
      imageGeneration: [],
      mesh3d: [],
      blender: false,
      sourcing: [],
    })
  })

  it('lists members, invites and reads/updates settings', async () => {
    const members = await api.call('org.members', {})
    expect(members).toHaveLength(1)
    expect(members[0]!.role).toBe('owner')

    await api.call('org.invite', { email: 'Ada@Example.com' })
    const dup = await api.fail('org.invite', { email: members[0]!.user.email })
    expect(dup.status).toBe(409)

    expect(await api.call('org.settings.get', {})).toEqual({
      traceRetentionDays: 90,
      allowEvalUse: false,
      assistantModel: 'claude-opus-5-5',
      monthlyBudgetUsd: null,
    })
    await api.call('org.settings.update', { allowEvalUse: true, monthlyBudgetUsd: 250 })
    expect(await api.call('org.settings.get', {})).toMatchObject({
      allowEvalUse: true,
      monthlyBudgetUsd: 250,
      traceRetentionDays: 90,
    })
  })

  it('refuses to demote the last owner', async () => {
    const [me] = await api.call('org.members', {})
    const err = await api.fail('org.setRole', { userId: me!.user.id, role: 'admin' })
    expect(err.status).toBe(409)
  })
})

describe('collections & pieces', () => {
  it('runs the collection lifecycle with piece counts', async () => {
    const col = await api.call('collections.create', { name: 'Spring', icon: '🌸' })
    expect(col).toMatchObject({ name: 'Spring', pieceCount: 0 })
    await api.call('pieces.create', { templateId: 'solitaire', collectionId: col.id })
    const renamed = await api.call('collections.update', { id: col.id, name: 'Spring 27' })
    expect(renamed).toMatchObject({ name: 'Spring 27', pieceCount: 1 })
    expect((await api.call('collections.list', {})).map((c) => c.name)).toContain('Spring 27')

    await api.call('collections.delete', { id: col.id })
    expect(await api.call('collections.list', {})).not.toContainEqual(
      expect.objectContaining({ id: col.id }),
    )
    const unfiled = await api.call('pieces.list', { collectionId: null })
    expect(unfiled.some((p) => p.title === 'Classic solitaire')).toBe(true)
  })

  it('creates pieces from every template, a spec, or nothing', async () => {
    for (const template of TEMPLATES) {
      const p = await api.call('pieces.create', { templateId: template.id })
      expect(p.stage).toBe('design')
      expect(p.design.order.length).toBeGreaterThan(0)
      expect(p.spec?.archetype).toBe(template.spec.archetype)
      expect(p.version).toBe(0)
      expect(p.facts).toBeNull()
    }
    const fromSpec = await api.call('pieces.create', {
      spec: {
        kind: 'ring',
        archetype: 'band',
        title: 'Spec band',
        summary: 'A plain band.',
        ring: { size: { system: 'us', value: 7 } },
      },
    })
    expect(fromSpec).toMatchObject({ title: 'Spec band', stage: 'design', kind: 'ring' })

    const blank = await api.call('pieces.create', { kind: 'pendant', brief: '# Idea' })
    expect(blank).toMatchObject({
      title: 'Untitled piece',
      stage: 'idea',
      kind: 'pendant',
      brief: '# Idea',
      spec: null,
    })
    expect(blank.design.order).toEqual([])

    expect((await api.fail('pieces.create', { templateId: 'nope' })).status).toBe(400)
  })

  it('lists, filters, gets, updates, specs, builds, duplicates and deletes', async () => {
    const piece = await api.call('pieces.create', { title: 'Moonlit 100%_halo', kind: 'ring' })
    expect((await api.call('pieces.list', { q: '100%_' })).map((p) => p.id)).toEqual([piece.id])
    expect((await api.call('pieces.list', { q: '100x' })).length).toBe(0)
    expect((await api.call('pieces.list', { stage: 'idea' })).map((p) => p.id)).toContain(piece.id)

    const got = await api.call('pieces.get', { id: piece.id })
    expect(got.boardIds).toEqual([])

    const updated = await api.call('pieces.update', {
      id: piece.id,
      title: 'Moonlit',
      brief: 'Soft and bright',
    })
    expect(updated.title).toBe('Moonlit')

    const noSpec = await api.fail('pieces.buildFromSpec', { id: piece.id })
    expect(noSpec.status).toBe(409)

    const spec = TEMPLATES.find((x) => x.id === 'halo')!.spec
    const withSpec = await api.call('pieces.setSpec', {
      id: piece.id,
      spec: { ...spec, title: 'Moonlit' },
    })
    expect(withSpec.stage).toBe('spec')

    const built = await api.call('pieces.buildFromSpec', { id: piece.id })
    expect(built.version).toBe(1)
    expect(built.design.order).toContain('center')
    const history = await api.call('design.history', { pieceId: piece.id })
    expect(history[0]).toMatchObject({ seq: 1, label: 'Build from spec' })
    expect((await api.call('pieces.get', { id: piece.id })).stage).toBe('design')

    const rebuilt = await api.call('pieces.buildFromSpec', { id: piece.id })
    expect(rebuilt.version).toBe(2)

    const copy = await api.call('pieces.duplicate', { id: piece.id })
    expect(copy).toMatchObject({ title: 'Moonlit (copy)', version: 0, design: rebuilt.design })

    await api.call('pieces.delete', { id: copy.id })
    expect((await api.fail('pieces.get', { id: copy.id })).status).toBe(404)
  })
})

describe('ideate', () => {
  it('runs boards and references end to end', async () => {
    const piece = await api.call('pieces.create', { templateId: 'studs' })
    const board = await api.call('boards.create', { title: 'Studs', pieceId: piece.id })
    expect(board).toMatchObject({
      title: 'Studs',
      pieceId: piece.id,
      referenceCount: 0,
      coverAssetIds: [],
    })
    expect((await api.call('pieces.get', { id: piece.id })).boardIds).toEqual([board.id])

    const refs = await api.call('references.save', {
      boardId: board.id,
      items: [
        { note: 'Basket heads, four claws', title: 'Setting' },
        { url: 'https://example.com/inspo' },
        {
          result: {
            key: 'met:1',
            provider: 'met',
            title: 'Gold earrings',
            thumbUrl: 'https://images.example/t.jpg',
            imageUrl: 'https://images.example/i.jpg',
            pageUrl: 'https://museum.example/1',
            credit: 'The Met',
            license: 'CC0',
            rights: 'open',
            width: 800,
            height: 600,
          },
        },
      ],
    })
    expect(refs.map((r) => r.type)).toEqual(['note', 'link', 'image'])
    expect(refs[1]!.rights).toBe('viewOnly')
    expect(refs[2]).toMatchObject({ rights: 'open', source: { provider: 'met', license: 'CC0' } })
    expect(refs.map((r) => r.position)).toEqual([1, 2, 3])

    const edited = await api.call('references.update', {
      id: refs[0]!.id,
      tags: ['claws'],
      note: 'Four claws',
    })
    expect(edited).toMatchObject({ tags: ['claws'], note: 'Four claws' })

    await api.call('references.remove', { ids: [refs[1]!.id] })
    const full = await api.call('boards.get', { id: board.id })
    expect(full.board.referenceCount).toBe(2)
    expect(full.references.map((r) => r.id)).toEqual([refs[0]!.id, refs[2]!.id])

    const renamed = await api.call('boards.update', {
      id: board.id,
      title: 'Stud ideas',
      icon: '✨',
      pieceId: null,
    })
    expect(renamed).toMatchObject({ title: 'Stud ideas', icon: '✨', pieceId: null })
    expect((await api.call('boards.list', {})).map((b) => b.id)).toContain(board.id)

    expect((await api.fail('references.save', { boardId: board.id, items: [{}] })).status).toBe(400)

    await api.call('boards.delete', { id: board.id })
    expect((await api.fail('boards.get', { id: board.id })).status).toBe(404)
  })
})

describe('renders, models, shots, production', () => {
  it('queues and cancels a render', async () => {
    const piece = await api.call('pieces.create', { templateId: 'halo' })
    const job = await api.call('renders.create', {
      pieceId: piece.id,
      scene: { look: 'black-acrylic' },
    })
    expect(job).toMatchObject({
      status: 'queued',
      engine: 'blender',
      sourceVersion: 0,
      title: piece.title,
    })
    expect(job.scene.camera.focalLength).toBe(90)
    expect(job.actor.type).toBe('user')
    expect((await api.call('renders.get', { id: job.id })).id).toBe(job.id)
    expect((await api.call('renders.list', { pieceId: piece.id })).map((j) => j.id)).toEqual([
      job.id,
    ])

    const canceled = await api.call('renders.cancel', { id: job.id })
    expect(canceled.status).toBe('canceled')
    expect(canceled.finishedAt).not.toBeNull()
    expect((await api.fail('renders.cancel', { id: job.id })).status).toBe(409)
  })

  it('manages brand models', async () => {
    const card = {
      description: 'Warm, editorial',
      ageRange: '30s',
      skinTone: 'deep',
      hair: 'short curls',
      build: 'slim',
      styling: 'minimal black',
      ringSizeUs: 6,
      wristMm: 155,
      neckMm: null,
    }
    const model = await api.call('models.create', { name: 'Noor', card, attestedSynthetic: true })
    expect(model).toMatchObject({ status: 'draft', portraits: [], attestedSynthetic: true })
    const approved = await api.call('models.update', {
      id: model.id,
      status: 'approved',
      card: { hair: 'braids' },
    })
    expect(approved.card).toMatchObject({ hair: 'braids', skinTone: 'deep' })
    expect((await api.call('models.list', {})).map((m) => m.id)).toContain(model.id)
    expect(await api.call('shots.list', { modelId: model.id })).toEqual([])
    await api.call('models.delete', { id: model.id })
    expect(await api.call('models.list', {})).not.toContainEqual(
      expect.objectContaining({ id: model.id }),
    )
  })

  it('lists production packages', async () => {
    const piece = await api.call('pieces.create', { templateId: 'cuban' })
    expect(await api.call('production.list', { pieceId: piece.id })).toEqual([])
  })
})

describe('threads, traces & usage', () => {
  it('reads what the assistant runtime wrote and records feedback', async () => {
    const ctx = await server.runtime.context(server.runtime.local!)
    const piece = await api.call('pieces.create', { templateId: 'signet' })
    const thread = await traces.createThread(ctx, { title: 'Make it heavier', pieceId: piece.id })
    const run = await traces.startRun(ctx, {
      model: 'claude-opus-5-5',
      threadId: thread.id,
      pieceId: piece.id,
      baseSeq: 0,
    })
    await traces.addMessage(ctx, {
      threadId: thread.id,
      role: 'user',
      content: [{ type: 'text', text: 'Heavier please' }],
    })

    const agentCtx = await server.runtime.context({
      ...server.runtime.local!,
      actor: { type: 'agent', runId: run.id, toolCallId: 'toolu_1', model: 'claude-opus-5-5' },
    })
    const { change } = await server.runtime.invoke(
      'design.apply',
      {
        pieceId: piece.id,
        label: 'Thicker band',
        ops: [{ t: 'update', id: 'band', patch: { thicknessTop: 2.6 } }],
      },
      agentCtx,
    )
    expect(change.actor).toEqual({
      type: 'agent',
      runId: run.id,
      toolCallId: 'toolu_1',
      model: 'claude-opus-5-5',
    })

    const step = await traces.addStep(ctx, run.id, {
      index: 0,
      kind: 'tool',
      name: 'design.apply',
      toolCallId: 'toolu_1',
      input: {},
      output: { version: 1 },
      ms: 42,
      changeIds: [change.id],
    })
    await traces.addMessage(ctx, {
      threadId: thread.id,
      runId: run.id,
      role: 'assistant',
      content: [{ type: 'text', text: 'Done' }],
    })
    await traces.finishRun(ctx, run.id, {
      status: 'done',
      tokens: { input: 1200, output: 300, cacheRead: 0, cacheWrite: 800 },
      costUsd: 0.0425,
    })

    const threads = await api.call('threads.list', { pieceId: piece.id })
    expect(threads.map((t) => t.id)).toEqual([thread.id])
    const full = await api.call('threads.get', { id: thread.id })
    expect(full.messages.map((m) => m.role)).toEqual(['user', 'assistant'])

    const runs = await api.call('traces.runs', { pieceId: piece.id })
    expect(runs[0]).toMatchObject({
      id: run.id,
      status: 'done',
      costUsd: 0.0425,
      tokens: { input: 1200, cacheWrite: 800 },
    })
    const detail = await api.call('traces.run', { id: run.id })
    expect(detail.steps).toEqual([expect.objectContaining({ id: step.id, changeIds: [change.id] })])

    await api.call('traces.feedback', {
      runId: run.id,
      stepId: step.id,
      rating: 'up',
      note: 'Exactly right',
    })
    expect(
      (await api.fail('traces.feedback', { runId: run.id, stepId: 'stp_nope', rating: 'down' }))
        .status,
    ).toBe(404)

    await api.call('threads.delete', { id: thread.id })
    expect((await api.fail('threads.get', { id: thread.id })).status).toBe(404)
  })

  it('summarises usage by meter and day', async () => {
    const ctx = await server.runtime.context(server.runtime.local!)
    await recordUsage(ctx, {
      meter: 'llm',
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      quantity: 1000,
      unit: 'tokens',
      costUsd: 0.25,
    })
    await recordUsage(ctx, {
      meter: 'llm',
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      quantity: 500,
      unit: 'tokens',
      costUsd: 0.125,
    })
    await recordUsage(ctx, {
      meter: 'image',
      provider: 'acme',
      quantity: 2,
      unit: 'images',
      costUsd: 0.08,
    })
    const summary = await api.call('usage.summary', {})
    expect(summary.totalUsd).toBeCloseTo(0.455)
    expect(summary.byMeter).toEqual([
      { meter: 'image', unit: 'images', quantity: 2, costUsd: 0.08 },
      { meter: 'llm', unit: 'tokens', quantity: 1500, costUsd: 0.375 },
    ])
    expect(summary.byDay).toEqual([{ day: new Date().toISOString().slice(0, 10), costUsd: 0.455 }])
    expect(summary.recent).toHaveLength(3)
  })
})
