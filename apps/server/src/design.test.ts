import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ServerEvent } from './events'
import { type Client, client, type TestServer, testServer } from './test/harness'

let server: TestServer
let api: Client

beforeAll(async () => {
  server = await testServer()
  api = client(server)
})
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
