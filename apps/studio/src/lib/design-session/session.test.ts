import {
  applyOps,
  buildDesign,
  type Design,
  type Op,
  OpError,
  type StoredChange,
  TEMPLATES,
} from '@pave/schema'
import { describe, expect, it } from 'vitest'
import * as core from './core'
import { createDesignSession, type SessionTransport } from './session'

const solitaire = () => buildDesign(TEMPLATES.find((t) => t.id === 'solitaire')!.spec)
const bandId = (d: Design) => d.order.find((id) => d.nodes[id]!.kind === 'ringShank')!
const width = (d: Design) => (d.nodes[bandId(d)] as { widthTop: number }).widthTop
const setWidth = (d: Design, v: number): Op[] => [
  { t: 'update', id: bandId(d), patch: { widthTop: v } },
]

class ConflictError extends Error {}
class OfflineError extends Error {}

/** A server that commits with the real `applyOps`, dedupes change ids and can lag or fail. */
class FakeServer {
  log: StoredChange[] = []
  design: Design
  failNext: ('offline' | 'conflict' | 'invalid')[] = []
  /** Changes committed by others, delivered to the session only when `flush` is called. */
  constructor(design: Design) {
    this.design = design
  }
  get version() {
    return this.log.length
  }
  commit(
    ops: Op[],
    opts: { id?: string; label?: string; actor?: StoredChange['actor']; reverts?: string[] } = {},
  ) {
    const existing = this.log.find((c) => c.id === opts.id)
    if (existing) return existing
    const { design, inverse } = applyOps(this.design, ops)
    this.design = design
    const change: StoredChange = {
      id: opts.id ?? `srv_${this.log.length + 1}`,
      pieceId: 'p1',
      seq: this.log.length + 1,
      ops,
      inverse,
      actor: opts.actor ?? { type: 'user', id: 'u_other' },
      label: opts.label ?? 'edit',
      at: new Date().toISOString(),
      ...(opts.reverts ? { reverts: opts.reverts } : {}),
    }
    this.log.push(change)
    return change
  }
  transport(): SessionTransport {
    return {
      apply: async (req) => {
        await Promise.resolve()
        const fail = this.failNext.shift()
        if (fail === 'offline') throw new OfflineError('offline')
        if (fail === 'conflict') throw new ConflictError('conflict')
        try {
          const change = this.commit(req.ops, { id: req.changeId, label: req.label, actor: { type: 'user', id: 'u_me' }, reverts: req.reverts })
          return { version: change.seq, change }
        } catch (e) {
          if (e instanceof OpError) throw new Error(`invalid: ${e.message}`)
          throw e
        }
      },
      history: async (_id, limit) => this.log.toReversed().slice(0, limit),
      snapshot: async () => ({ design: this.design, version: this.version }),
    }
  }
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
}

function sessionOn(server: FakeServer) {
  return createDesignSession('p1', { design: server.design, version: server.version }, {
    transport: server.transport(),
    classify: (e) =>
      e instanceof OfflineError ? 'retry' : e instanceof ConflictError ? 'conflict' : 'reject',
    describe: (e) => (e as Error).message,
    backoff: () => 5,
    gapWait: 10,
  })
}

describe('design session core', () => {
  it('coalesces a scrub into one labelled change', () => {
    const d = solitaire()
    let s = core.createSession('p1', d, 0)
    for (const v of [2.3, 2.45, 2.5, 2.6]) s = core.preview(s, 'band.widthTop', setWidth(d, v))
    expect(width(s.view)).toBe(2.6)
    expect(s.pending).toHaveLength(0)
    s = core.commitGesture(s)
    expect(s.pending).toHaveLength(1)
    expect(s.pending[0]!.label).toBe('Width at top 2.2 → 2.6 mm')
    expect(s.pending[0]!.ops).toEqual(setWidth(d, 2.6))
  })

  it('records nothing for a scrub that returns to where it started', () => {
    const d = solitaire()
    let s = core.preview(core.createSession('p1', d, 0), 'k', setWidth(d, 3))
    s = core.commitGesture(core.preview(s, 'k', setWidth(d, 2.2)))
    expect(s.pending).toHaveLength(0)
    expect(s.undo).toHaveLength(0)
  })

  it('commits the previous gesture when another field starts scrubbing', () => {
    const d = solitaire()
    let s = core.preview(core.createSession('p1', d, 0), 'a', setWidth(d, 3))
    s = core.preview(s, 'b', [{ t: 'update', id: bandId(d), patch: { thicknessTop: 2 } }])
    expect(s.pending.map((p) => p.label)).toEqual(['Width at top 2.2 → 3 mm'])
  })

  it('applies acks and events in seq order, whichever arrives first', () => {
    const server = new FakeServer(solitaire())
    let s = core.createSession('p1', server.design, 0)
    const a = server.commit(setWidth(server.design, 3))
    const b = server.commit(setWidth(server.design, 4))
    s = core.receive(s, b)
    expect(s.version).toBe(0)
    expect(core.hasGap(s)).toBe(true)
    s = core.receive(s, a)
    s = core.receive(s, a)
    expect(s.version).toBe(2)
    expect(width(s.confirmed)).toBe(4)
    expect(core.hasGap(s)).toBe(false)
  })

  it('re-applies local edits on top of a remote change', () => {
    const server = new FakeServer(solitaire())
    const band = bandId(server.design)
    let s = core.createSession('p1', server.design, 0)
    s = core.commit(s, [{ t: 'update', id: band, patch: { thicknessTop: 2.5 } }])
    s = core.preview(s, 'w', setWidth(s.settled, 3.3))
    s = core.receive(s, server.commit([{ t: 'update', id: band, patch: { profile: 'flat' } }], { actor: { type: 'agent', runId: 'run_1' } }))
    const node = s.view.nodes[band] as Record<string, unknown>
    expect(node).toMatchObject({ profile: 'flat', thicknessTop: 2.5, widthTop: 3.3 })
    expect(s.runs[0]).toMatchObject({ runId: 'run_1', prior: { [band]: { profile: 'court' } } })
  })

  it('drops a local edit whose node a remote change removed, with a notice', () => {
    const server = new FakeServer(solitaire())
    const gem = server.design.order.find((id) => server.design.nodes[id]!.kind === 'gem')!
    let s = core.createSession('p1', server.design, 0)
    s = core.commit(s, [{ t: 'update', id: gem, patch: { width: 7 } }])
    s = core.receive(s, server.commit([{ t: 'remove', id: gem, cascade: true }]))
    expect(s.pending).toHaveLength(0)
    expect(s.notices[0]).toMatchObject({ type: 'dropped' })
    expect(s.undo).toHaveLength(0)
  })

  it('undo keeps values someone else changed since', () => {
    const server = new FakeServer(solitaire())
    const band = bandId(server.design)
    let s = core.createSession('p1', server.design, 0)
    s = core.commit(s, [{ t: 'update', id: band, patch: { widthTop: 3, thicknessTop: 2.4 } }])
    const mine = server.commit(s.pending[0]!.ops, { id: s.pending[0]!.id })
    s = core.receive(s, mine)
    // The assistant then changes the width again.
    s = core.receive(s, server.commit(setWidth(s.confirmed, 3.6), { actor: { type: 'agent', runId: 'r' } }))
    s = core.undo(s)
    expect(s.pending[0]!.reverts).toEqual([mine.id])
    expect(s.pending[0]!.ops).toEqual([{ t: 'update', id: band, patch: { thicknessTop: 1.8 } }])
    expect(s.view.nodes[band]).toMatchObject({ widthTop: 3.6, thicknessTop: 1.8 })
  })

  it('redo re-applies an undone change, and a new edit clears redo', () => {
    const d = solitaire()
    let s = core.commit(core.createSession('p1', d, 0), setWidth(d, 3))
    s = core.undo(s)
    expect(width(s.view)).toBe(2.2)
    expect(core.canRedo(s)).toBe(true)
    s = core.redo(s)
    expect(width(s.view)).toBe(3)
    expect(s.pending.map((p) => p.label)).toEqual([
      'Width at top 2.2 → 3 mm',
      'Undo Width at top 2.2 → 3 mm',
      'Redo Width at top 2.2 → 3 mm',
    ])
    s = core.commit(s, setWidth(s.view, 4))
    expect(core.canRedo(s)).toBe(false)
  })

  it('undo of an added node removes it, unless it is already gone', () => {
    const d = solitaire()
    const node = { id: 'prim_1', kind: 'primitive' as const }
    let s = core.commit(core.createSession('p1', d, 0), [{ t: 'add', node }])
    s = core.undo(s)
    expect(s.view.nodes.prim_1).toBeUndefined()
    expect(core.guardedInverse({ ops: [{ t: 'add', node }], inverse: [{ t: 'remove', id: 'prim_1' }] }, d)).toEqual([])
  })
})

describe('design session sync', () => {
  it('sends one change at a time and converges with the server', async () => {
    const server = new FakeServer(solitaire())
    const session = sessionOn(server)
    for (const v of [2.4, 2.8, 3.2]) session.commit(setWidth(session.get().view, v))
    expect(session.get().save).toEqual({ status: 'saving', count: 3 })
    await session.idle()
    expect(server.log.map((c) => c.label)).toEqual([
      'Width at top 2.2 → 2.4 mm',
      'Width at top 2.4 → 2.8 mm',
      'Width at top 2.8 → 3.2 mm',
    ])
    expect(session.get().confirmed).toEqual(server.design)
    expect(session.get().save.status).toBe('saved')
  })

  it('keeps edits while offline and retries them under the same id', async () => {
    const server = new FakeServer(solitaire())
    const session = sessionOn(server)
    server.failNext = ['offline', 'offline']
    session.commit(setWidth(session.get().view, 3))
    await flush()
    expect(['offline', 'saved']).toContain(session.get().save.status)
    await session.idle()
    expect(server.log).toHaveLength(1)
    expect(width(server.design)).toBe(3)
  })

  it('applies a remote change that arrives during local edits', async () => {
    const server = new FakeServer(solitaire())
    const session = sessionOn(server)
    const band = bandId(server.design)
    session.preview('w', setWidth(session.get().view, 2.9))
    const remote = server.commit([{ t: 'update', id: band, patch: { profile: 'dShape' } }], { actor: { type: 'agent', runId: 'r1' } })
    session.receive(remote)
    expect(session.get().view.nodes[band]).toMatchObject({ profile: 'dShape', widthTop: 2.9 })
    session.commitGesture()
    await session.idle()
    expect(server.design.nodes[band]).toMatchObject({ profile: 'dShape', widthTop: 2.9 })
    expect(session.get().confirmed).toEqual(server.design)
  })

  it('fills a gap from history when an event was missed', async () => {
    const server = new FakeServer(solitaire())
    const session = sessionOn(server)
    server.commit(setWidth(server.design, 3))
    const second = server.commit(setWidth(server.design, 3.5))
    session.receive(second)
    expect(session.get().version).toBe(0)
    await new Promise((r) => setTimeout(r, 40))
    expect(session.get().version).toBe(2)
    expect(session.get().confirmed).toEqual(server.design)
  })

  it('recovers from a conflict by catching up and retrying once', async () => {
    const server = new FakeServer(solitaire())
    const session = sessionOn(server)
    const band = bandId(server.design)
    server.commit([{ t: 'update', id: band, patch: { profile: 'flat' } }])
    server.failNext = ['conflict']
    session.commit(setWidth(session.get().view, 3))
    await session.idle()
    expect(session.get().version).toBe(2)
    expect(server.design.nodes[band]).toMatchObject({ profile: 'flat', widthTop: 3 })
    expect(session.get().confirmed).toEqual(server.design)
  })

  it('gives up after a second conflict and says so', async () => {
    const server = new FakeServer(solitaire())
    const session = sessionOn(server)
    server.failNext = ['conflict', 'conflict']
    session.commit(setWidth(session.get().view, 3))
    await session.idle()
    expect(server.log).toHaveLength(0)
    expect(session.takeNotices()).toMatchObject([{ type: 'dropped', reason: 'conflict' }])
    expect(width(session.get().view)).toBe(2.2)
  })

  it('drops a change the server refuses', async () => {
    const server = new FakeServer(solitaire())
    const session = sessionOn(server)
    session.commit(setWidth(session.get().view, 3))
    // Someone deletes the band before our change lands.
    server.design = applyOps(server.design, [{ t: 'remove', id: bandId(server.design), cascade: true }]).design
    await session.idle()
    expect(session.takeNotices()[0]).toMatchObject({ type: 'dropped' })
  })

  it('converges under random interleavings of local edits, remote edits, lost events and failures', async () => {
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let round = 0; round < 12; round++) {
      const server = new FakeServer(solitaire())
      const session = sessionOn(server)
      const band = bandId(server.design)
      const fields = ['widthTop', 'widthBottom', 'thicknessTop', 'thicknessBottom'] as const
      for (let step = 0; step < 25; step++) {
        const field = fields[Math.floor(rand() * fields.length)]!
        const value = Math.round((1.2 + rand() * 3) * 100) / 100
        const r = rand()
        if (r < 0.4) session.commit([{ t: 'update', id: band, patch: { [field]: value } }])
        else if (r < 0.7) {
          const change = server.commit([{ t: 'update', id: band, patch: { [field]: value } }], { actor: { type: 'agent', runId: `run_${round}` } })
          // Events are sometimes lost; history fills the gap.
          if (rand() < 0.8) session.receive(change)
        } else if (r < 0.8) session.undo()
        else if (r < 0.85) server.failNext.push(rand() < 0.5 ? 'offline' : 'conflict')
        if (rand() < 0.3) await flush()
      }
      await session.idle()
      await session.resync()
      await session.idle()
      expect(session.get().confirmed).toEqual(server.design)
      expect(session.get().view).toEqual(server.design)
      expect(session.get().version).toBe(server.version)
      // Retries never commit a change twice.
      const ids = server.log.map((c) => c.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})
