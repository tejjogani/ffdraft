import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { putAsset } from './assets/assets'
import type { ServerEvent } from './events'
import { BOOT_TIMEOUT, type Client, client, type TestServer, testServer } from './test/harness'
import { traces } from './traces'

let server: TestServer
let api: Client

beforeAll(async () => {
  server = await testServer()
  api = client(server)
}, BOOT_TIMEOUT)
afterAll(() => server.dispose())

const gem = (id: string, x: number) => ({
  t: 'add' as const,
  node: {
    id,
    kind: 'gem',
    cut: 'round',
    width: 1.5,
    transform: { position: [x, 0, 0], rotation: [0, 0, 0], scale: 1 },
  },
})

describe('design document', () => {
  it('applies, lists history, and reverts', async () => {
    const piece = await api.call('pieces.create', { templateId: 'wedding-band' })
    const events: ServerEvent[] = []
    const unsubscribe = server.runtime.events.subscribe(server.runtime.local!.orgId, (e) =>
      events.push(e),
    )

    const first = await api.call('design.apply', {
      pieceId: piece.id,
      baseVersion: 0,
      label: 'Wider band',
      ops: [{ t: 'update', id: 'band', patch: { widthTop: 5, widthBottom: 5 } }],
    })
    expect(first.version).toBe(1)
    expect(first.change).toMatchObject({
      seq: 1,
      pieceId: piece.id,
      label: 'Wider band',
      actor: { type: 'user' },
    })
    expect(first.change.inverse).toEqual([
      { t: 'update', id: 'band', patch: { widthTop: 4, widthBottom: 4 } },
    ])

    const second = await api.call('design.apply', {
      pieceId: piece.id,
      label: 'Add stone',
      ops: [gem('g1', 0)],
    })
    expect(second.version).toBe(2)

    const after = await api.call('pieces.get', { id: piece.id })
    expect(after.version).toBe(2)
    expect(after.design.order).toContain('g1')
    expect(after.design.nodes.band).toMatchObject({ widthTop: 5 })

    const history = await api.call('design.history', { pieceId: piece.id })
    expect(history.map((c) => c.seq)).toEqual([2, 1])
    expect(
      (await api.call('design.history', { pieceId: piece.id, before: 2 })).map((c) => c.seq),
    ).toEqual([1])

    const reverted = await api.call('design.revert', { pieceId: piece.id, seq: 1 })
    expect(reverted.version).toBe(3)
    expect(reverted.change.label).toBe('Revert: Wider band')
    const final = await api.call('pieces.get', { id: piece.id })
    expect(final.design.nodes.band).toMatchObject({ widthTop: 4, widthBottom: 4 })
    expect(final.design.order).toContain('g1')

    unsubscribe()
    const changed = events.filter((e) => e.type === 'design.changed')
    expect(changed.map((e) => e.type === 'design.changed' && e.version)).toEqual([1, 2, 3])
  })

  it('rejects a stale baseVersion with 409 and the current version', async () => {
    const piece = await api.call('pieces.create', { templateId: 'wedding-band' })
    await api.call('design.apply', { pieceId: piece.id, label: 'One', ops: [gem('a', 0)] })
    const err = await api.fail('design.apply', {
      pieceId: piece.id,
      baseVersion: 0,
      label: 'Stale',
      ops: [gem('b', 1)],
    })
    expect(err.status).toBe(409)
    expect(err.error).toMatchObject({ code: 'conflict', currentVersion: 1 })
    expect((await api.call('pieces.get', { id: piece.id })).version).toBe(1)
  })

  it('is idempotent on changeId', async () => {
    const piece = await api.call('pieces.create', { templateId: 'wedding-band' })
    const input = {
      pieceId: piece.id,
      label: 'Once',
      ops: [gem('c', 0)],
      changeId: 'client-change-1',
    }
    const a = await api.call('design.apply', input)
    const b = await api.call('design.apply', input)
    expect(b).toEqual(a)
    expect(a.change.id).toBe('client-change-1')
    expect((await api.call('design.history', { pieceId: piece.id })).length).toBe(1)

    const other = await api.call('pieces.create', { templateId: 'wedding-band' })
    expect((await api.fail('design.apply', { ...input, pieceId: other.id })).status).toBe(409)
  })

  it('fails atomically on an invalid op', async () => {
    const piece = await api.call('pieces.create', { templateId: 'wedding-band' })
    const err = await api.fail('design.apply', {
      pieceId: piece.id,
      label: 'Half valid',
      ops: [gem('ok', 0), { t: 'update', id: 'missing', patch: { width: 2 } }],
    })
    expect(err.status).toBe(400)
    expect(err.error.message).toContain('No node "missing"')
    const after = await api.call('pieces.get', { id: piece.id })
    expect(after.version).toBe(0)
    expect(after.design.order).not.toContain('ok')
    expect(await api.call('design.history', { pieceId: piece.id })).toEqual([])

    const shape = await api.fail('design.apply', { pieceId: piece.id, label: 'x', ops: [] })
    expect(shape.status).toBe(400)
    expect(shape.error.issues).toBeInstanceOf(Array)
  })

  it('reports a revert that no longer applies as a conflict', async () => {
    const piece = await api.call('pieces.create', { templateId: 'wedding-band' })
    await api.call('design.apply', { pieceId: piece.id, label: 'Add', ops: [gem('d', 0)] })
    await api.call('design.apply', {
      pieceId: piece.id,
      label: 'Remove',
      ops: [{ t: 'remove', id: 'd' }],
    })
    expect((await api.fail('design.revert', { pieceId: piece.id, seq: 1 })).status).toBe(409)
    expect((await api.fail('design.revert', { pieceId: piece.id, seq: 99 })).status).toBe(404)
  })

  it('serialises concurrent edits into consecutive versions', async () => {
    const piece = await api.call('pieces.create', { templateId: 'wedding-band' })
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        api.call('design.apply', { pieceId: piece.id, label: `g${i}`, ops: [gem(`g${i}`, i)] }),
      ),
    )
    expect(results.map((r) => r.version).sort()).toEqual([1, 2, 3, 4])
    expect((await api.call('pieces.get', { id: piece.id })).design.order).toEqual(
      expect.arrayContaining(['g0', 'g1', 'g2', 'g3']),
    )
  })

  it('writes an audit row per mutation, attributed to the actor', async () => {
    const piece = await api.call('pieces.create', { templateId: 'wedding-band' })
    await api.call('pieces.update', { id: piece.id, title: 'Audited' })
    const ctx = await server.runtime.context(server.runtime.local!)
    const rows = await ctx.repo.audit.many()
    const mine = rows.filter((r) => r.targetId === piece.id).map((r) => r.action)
    expect(mine).toEqual(expect.arrayContaining(['pieces.create', 'pieces.update']))
    expect(rows.every((r) => r.actor.type === 'user')).toBe(true)
  })
})

describe('undo', () => {
  it('reverts everything a run changed on a piece as one change, recording implicit feedback', async () => {
    const piece = await api.call('pieces.create', { templateId: 'wedding-band' })
    const ctx = await server.runtime.context(server.runtime.local!)
    const run = await traces.startRun(ctx, { model: 'm', pieceId: piece.id })
    const agent = await server.runtime.context({
      ...server.runtime.local!,
      actor: { type: 'agent', runId: run.id, toolCallId: 't1' },
    })
    await server.runtime.invoke(
      'design.apply',
      { pieceId: piece.id, label: 'Add a', ops: [gem('a', 0)] },
      agent,
    )
    await api.call('design.apply', { pieceId: piece.id, label: 'Mine', ops: [gem('mine', 3)] })
    await server.runtime.invoke(
      'design.apply',
      {
        pieceId: piece.id,
        label: 'Wider',
        ops: [{ t: 'update', id: 'band', patch: { widthTop: 5 } }],
      },
      agent,
    )

    const undone = await api.call('design.revert', { pieceId: piece.id, runId: run.id })
    expect(undone.version).toBe(4)
    expect(undone.change.label).toBe('Undo assistant edits: Add a; Wider')
    const history = await api.call('design.history', { pieceId: piece.id })
    expect(undone.change.reverts).toEqual([history[1]!.id, history[3]!.id])
    const after = await api.call('pieces.get', { id: piece.id })
    expect(after.design.order).toContain('mine')
    expect(after.design.order).not.toContain('a')
    expect(after.design.nodes.band).toMatchObject({ widthTop: 4 })

    const { feedback } = await api.call('traces.run', { id: run.id })
    expect(feedback).toHaveLength(2)
    expect(feedback.map((f) => [f.source, f.kind, f.changeId])).toEqual(
      expect.arrayContaining([
        ['implicit', 'undone', history[1]!.id],
        ['implicit', 'undone', history[3]!.id],
      ]),
    )
    expect((await api.fail('design.revert', { pieceId: piece.id, runId: 'run_nope' })).status).toBe(
      404,
    )
    expect((await api.fail('design.revert', { pieceId: piece.id })).status).toBe(400)
    expect(
      (await api.fail('design.revert', { pieceId: piece.id, seq: 1, runId: run.id })).status,
    ).toBe(400)
  })

  it('undoes a run once, and never over a later edit to the same features', async () => {
    const piece = await api.call('pieces.create', { templateId: 'wedding-band' })
    const ctx = await server.runtime.context(server.runtime.local!)
    const run = await traces.startRun(ctx, { model: 'm', pieceId: piece.id })
    const agent = await server.runtime.context({
      ...server.runtime.local!,
      actor: { type: 'agent', runId: run.id, toolCallId: 't1' },
    })
    const widen = (widthTop: number) =>
      server.runtime.invoke(
        'design.apply',
        { pieceId: piece.id, label: `Width ${widthTop}`, ops: [{ t: 'update', id: 'band', patch: { widthTop } }] },
        agent,
      )
    await widen(5)
    await widen(6)
    await api.call('design.revert', { pieceId: piece.id, runId: run.id })
    expect((await api.call('pieces.get', { id: piece.id })).design.nodes.band).toMatchObject({
      widthTop: 4,
    })
    // A second "Undo all" (double click, retry) finds nothing left to undo.
    const again = await api.fail('design.revert', { pieceId: piece.id, runId: run.id })
    expect([again.status, again.error.reason]).toEqual([409, 'already_undone'])
    expect((await api.call('traces.run', { id: run.id })).feedback).toHaveLength(2)

    // The run edits again, then a person corrects the same field: the person wins.
    await widen(7)
    await api.call('design.apply', {
      pieceId: piece.id,
      label: 'Mine',
      ops: [{ t: 'update', id: 'band', patch: { widthTop: 3 } }],
    })
    const clash = await api.fail('design.revert', { pieceId: piece.id, runId: run.id })
    expect([clash.status, clash.error.reason, clash.error.nodeIds]).toEqual([
      409,
      'edited_since',
      ['band'],
    ])
    const { design, version } = await api.call('pieces.get', { id: piece.id })
    expect(design.nodes.band).toMatchObject({ widthTop: 3 })

    // Once the person's edit is undone, the run's can be too; then undo is redo-able by seq.
    await api.call('design.revert', { pieceId: piece.id, seq: version })
    const last = await api.call('design.revert', { pieceId: piece.id, runId: run.id })
    expect(last.change.label).toBe('Undo assistant edits: Width 7')
    expect((await api.call('pieces.get', { id: piece.id })).design.nodes.band).toMatchObject({
      widthTop: 4,
    })
    await api.call('design.revert', { pieceId: piece.id, seq: last.version })
    expect((await api.call('pieces.get', { id: piece.id })).design.nodes.band).toMatchObject({
      widthTop: 7,
    })
    await api.call('design.revert', { pieceId: piece.id, runId: run.id })
  })

  it('records feedback only when a person undoes an assistant’s edit', async () => {
    const piece = await api.call('pieces.create', { templateId: 'wedding-band' })
    const ctx = await server.runtime.context(server.runtime.local!)
    const run = await traces.startRun(ctx, { model: 'm', pieceId: piece.id })
    const agent = await server.runtime.context({
      ...server.runtime.local!,
      actor: { type: 'agent', runId: run.id, toolCallId: 't1' },
    })
    const { version } = await server.runtime.invoke(
      'design.apply',
      { pieceId: piece.id, label: 'Add a', ops: [gem('a', 0)] },
      agent,
    )
    // The assistant backing out its own edit is not feedback on it.
    await server.runtime.invoke('design.revert', { pieceId: piece.id, seq: version }, agent)
    expect((await api.call('traces.run', { id: run.id })).feedback).toEqual([])
    // Its own undo is not one of its edits, and the edit is already undone.
    const none = await api.fail('design.revert', { pieceId: piece.id, runId: run.id })
    expect(none.error.reason).toBe('already_undone')
  })

  it('marks a guarded undo sent through design.apply, and checks what it reverts', async () => {
    const piece = await api.call('pieces.create', { templateId: 'wedding-band' })
    const first = await api.call('design.apply', {
      pieceId: piece.id,
      label: 'Add',
      ops: [gem('u', 0)],
    })
    expect(first.change).not.toHaveProperty('reverts')
    const undo = await api.call('design.apply', {
      pieceId: piece.id,
      label: 'Undo add',
      ops: first.change.inverse,
      reverts: [first.change.id],
    })
    expect(undo.change.reverts).toEqual([first.change.id])
    expect((await api.call('design.history', { pieceId: piece.id }))[0]!.reverts).toEqual([
      first.change.id,
    ])
    const other = await api.call('pieces.create', { templateId: 'wedding-band' })
    const err = await api.fail('design.apply', {
      pieceId: other.id,
      label: 'x',
      ops: [gem('v', 0)],
      reverts: [first.change.id],
    })
    expect(err.status).toBe(400)
    expect((await api.call('pieces.get', { id: other.id })).version).toBe(0)
  })
})

describe('cover', () => {
  it('captures automatically until someone picks a cover', async () => {
    const piece = await api.call('pieces.create', { templateId: 'wedding-band' })
    expect(piece.coverAuto).toBe(true)
    const ctx = await server.runtime.context(server.runtime.local!)
    const asset = await putAsset(ctx, {
      bytes: new TextEncoder().encode('x'),
      name: 'c.png',
      mime: 'image/png',
    })
    const auto = await api.call('pieces.update', {
      id: piece.id,
      coverAssetId: asset.id,
      coverAuto: true,
    })
    expect(auto).toMatchObject({ coverAssetId: asset.id, coverAuto: true })
    const picked = await api.call('pieces.update', { id: piece.id, coverAssetId: asset.id })
    expect(picked.coverAuto).toBe(false)
    expect((await api.call('pieces.update', { id: piece.id, title: 'T' })).coverAuto).toBe(false)
    expect((await api.call('pieces.duplicate', { id: piece.id })).coverAuto).toBe(false)
  })
})
