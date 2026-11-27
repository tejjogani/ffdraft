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

const bandId = (d: Design) => d.order.find((id) => d.nodes[id]!.kind === 'ringShank')!
/** The solitaire template with the band at known values. */
const solitaire = () => {
  const d = buildDesign(TEMPLATES.find((t) => t.id === 'solitaire')!.spec)
  return applyOps(d, [
    { t: 'update', id: bandId(d), patch: { widthTop: 2.2, thicknessTop: 1.8, profile: 'court' } },
  ]).design
}
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
  /**
   * `lost`: the change is committed but the response never arrives. `garbled`: it is committed
   * and answered, but the answer is not the JSON the client expects (a proxy's error page).
   */
  failNext: ('offline' | 'conflict' | 'invalid' | 'lost' | 'garbled')[] = []
  failHistory = 0
  applyCalls = 0
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
        this.applyCalls++
        await Promise.resolve()
        const fail = this.failNext.shift()
        if (fail === 'offline') throw new OfflineError('offline')
        if (fail === 'conflict') throw new ConflictError('conflict')
        if (
          !this.log.some((change) => change.id === req.changeId) &&
          req.baseVersion !== undefined &&
          req.baseVersion !== this.version
        )
          throw new ConflictError('conflict')
        try {
          const change = this.commit(req.ops, {
            id: req.changeId,
            label: req.label,
            actor: { type: 'user', id: 'u_me' },
            reverts: req.reverts,
          })
          if (fail === 'lost') throw new OfflineError('response lost')
          if (fail === 'garbled') return null as never
          return { version: change.seq, change }
        } catch (e) {
          if (e instanceof OpError) throw new Error(`invalid: ${e.message}`)
          throw e
        }
      },
      history: async (_id, limit) => {
        if (this.failHistory > 0) {
          this.failHistory--
          throw new OfflineError('offline')
        }
        return this.log.toReversed().slice(0, limit)
      },
      snapshot: async () => ({ design: this.design, version: this.version }),
    }
  }
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
}

describe('server-created Studio changes', () => {
  it.each(['event first', 'response first'] as const)(
    'makes a server-created edit undoable once when the %s arrives',
    async (order) => {
      const server = new FakeServer(solitaire())
      const session = sessionOn(server)
      try {
        const change = server.commit(setWidth(server.design, 3), {
          id: 'chg_face',
          actor: { type: 'user', id: 'u_me' },
        })
        if (order === 'event first') session.receive(change)
        session.adoptChange('chg_face', change)
        session.receive(change)
        session.adoptChange('chg_face', change)
        expect(width(session.get().view)).toBe(3)
        session.undo()
        await session.idle()
        expect(width(server.design)).toBe(2.2)
        expect(core.canUndo(session.get())).toBe(false)
        session.adoptChange('chg_face', change)
        expect(core.canUndo(session.get())).toBe(false)
        session.redo()
        await session.idle()
        expect(width(server.design)).toBe(3)
        expect(server.log.map((c) => c.reverts)).toEqual([
          undefined,
          ['chg_face'],
          [server.log[1]!.id],
        ])
      } finally {
        session.dispose()
      }
    },
  )

  it('does not adopt an agent change or a response for a different piece or command', () => {
    const server = new FakeServer(solitaire())
    const session = sessionOn(server)
    try {
      const change = server.commit(setWidth(server.design, 3), { id: 'chg_face' })
      session.adoptChange('chg_other', change)
      session.adoptChange(change.id, { ...change, pieceId: 'p2' })
      session.adoptChange(change.id, { ...change, actor: { type: 'agent', runId: 'r1' } })
      expect(width(session.get().view)).toBe(2.2)
      expect(core.canUndo(session.get())).toBe(false)
    } finally {
      session.dispose()
    }
  })

  it('undoes a newer local edit first when a server-created edit gets a late response', async () => {
    const server = new FakeServer(solitaire())
    const session = sessionOn(server)
    try {
      const change = server.commit(setWidth(server.design, 3), { id: 'chg_face' })
      session.receive(change)
      session.commit(setWidth(session.get().view, 4))
      await session.idle()
      session.adoptChange(change.id, change)
      session.undo()
      await session.idle()
      expect(width(server.design)).toBe(3)
      session.undo()
      await session.idle()
      expect(width(server.design)).toBe(2.2)
    } finally {
      session.dispose()
    }
  })

  it('guards native asset Undo against a concurrent source replacement', async () => {
    const design = applyOps(solitaire(), [
      {
        t: 'add',
        node: {
          id: 'sleeve',
          kind: 'meshBody',
          keepSourcePlacement: true,
          source: {
            type: 'asset',
            assetId: 'a_mesh',
            nativeMeshAssetId: 'a_mesh',
            nativeAssetId: 'a_solid',
          },
        },
      },
    ]).design
    const server = new FakeServer(design)
    const session = sessionOn(server)
    const replace = (asset: string): Op[] => [
      {
        t: 'update',
        id: 'sleeve',
        patch: {
          source: {
            type: 'asset',
            assetId: `${asset}_mesh`,
            nativeMeshAssetId: `${asset}_mesh`,
            nativeAssetId: `${asset}_solid`,
          },
        },
      },
    ]
    try {
      const change = server.commit(replace('b'), { id: 'chg_face' })
      session.adoptChange(change.id, change)
      await session.resync()
      // Other window commits after the snapshot used to decide what Undo may change.
      server.commit(replace('c'))
      session.undo()
      await session.idle()
      expect(server.design.nodes.sleeve).toHaveProperty('source.nativeAssetId', 'c_solid')
      expect(server.log).toHaveLength(2)
    } finally {
      session.dispose()
    }
  })
})

function sessionOn(
  server: FakeServer,
  initial: { design: Design; version: number } = {
    design: server.design,
    version: server.version,
  },
  backoff = 5,
) {
  return createDesignSession('p1', initial, {
    transport: server.transport(),
    classify: (e) =>
      e instanceof OfflineError ? 'retry' : e instanceof ConflictError ? 'conflict' : 'reject',
    describe: (e) => (e as Error).message,
    backoff: () => backoff,
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

  it('keeps the same view when a control repeats its last preview', () => {
    const d = solitaire()
    const s = core.preview(core.createSession('p1', d, 0), 'k', setWidth(d, 3))
    expect(core.preview(s, 'k', setWidth(d, 3))).toBe(s)
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
    s = core.receive(
      s,
      server.commit([{ t: 'update', id: band, patch: { profile: 'flat' } }], {
        actor: { type: 'agent', runId: 'run_1' },
      }),
    )
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
    s = core.receive(
      s,
      server.commit(setWidth(s.confirmed, 3.6), { actor: { type: 'agent', runId: 'r' } }),
    )
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

  it('restores a point edit after stored JSON reorders the point keys', () => {
    const id = 'curve_history'
    const original = [
      { id: 'a', u: 0, v: 0 },
      { id: 'b', u: 8, v: 0 },
    ]
    const design = applyOps(solitaire(), [
      { t: 'add', node: { id, kind: 'curve', plane: 'front', points: original } },
    ]).design
    const restored: Op = {
      t: 'update',
      id,
      patch: {
        points: [
          { u: 0, v: 0, id: 'a' },
          { u: 8, v: 0, id: 'b' },
        ],
      },
    }
    const edit: Op = {
      t: 'update',
      id,
      patch: {
        points: [
          { u: 0, v: 0, id: 'a' },
          { u: 8, v: 4, id: 'b' },
        ],
      },
    }
    expect(core.guardedInverse({ ops: [restored], inverse: [edit] }, design)).toEqual([edit])
  })

  it('names undo and redo after the original edit however often they flip', () => {
    const d = solitaire()
    let s = core.commit(core.createSession('p1', d, 0), setWidth(d, 3))
    s = core.redo(core.undo(s))
    s = core.redo(core.undo(s))
    expect(s.pending.map((p) => p.label)).toEqual([
      'Width at top 2.2 → 3 mm',
      'Undo Width at top 2.2 → 3 mm',
      'Redo Width at top 2.2 → 3 mm',
      'Undo Width at top 2.2 → 3 mm',
      'Redo Width at top 2.2 → 3 mm',
    ])
  })

  it('says “nothing to redo” (not undo) when a redo finds nothing left to change', () => {
    const d = solitaire()
    let s = core.commit(core.createSession('p1', d, 0), setWidth(d, 3))
    s = core.undo(s)
    const undone = s.redo.at(-1)!
    // The width goes back to 3 another way before the redo (a new edit, which would normally
    // clear redo; keep it to reach the guard).
    s = { ...core.commit(s, setWidth(s.view, 3)), redo: [undone] }
    s = core.redo(s)
    expect(s.notices.at(-1)).toMatchObject({ type: 'nothing-to-redo' })
  })

  it('offers no redo for an undo that was dropped before it was sent', () => {
    const server = new FakeServer(solitaire())
    const gem = server.design.order.find((id) => server.design.nodes[id]!.kind === 'gem')!
    let s = core.createSession('p1', server.design, 0)
    s = core.commit(s, [{ t: 'update', id: gem, patch: { width: 7 } }])
    s = core.receive(s, server.commit(s.pending[0]!.ops, { id: s.pending[0]!.id }))
    s = core.undo(s)
    expect(core.canRedo(s)).toBe(true)
    // Someone deletes the stone before the undo is sent: the undo no longer applies.
    s = core.receive(s, server.commit([{ t: 'remove', id: gem, cascade: true }]))
    expect(s.pending).toHaveLength(0)
    expect(s.notices.at(-1)).toMatchObject({ type: 'dropped' })
    // Redo would find nothing to re-apply; offering it is a button that does nothing.
    expect(core.canRedo(s)).toBe(false)
  })

  it('undo of an added node removes it, unless it is already gone', () => {
    const d = solitaire()
    const node = { id: 'prim_1', kind: 'primitive' as const }
    let s = core.commit(core.createSession('p1', d, 0), [{ t: 'add', node }])
    s = core.undo(s)
    expect(s.view.nodes.prim_1).toBeUndefined()
    expect(
      core.guardedInverse(
        { ops: [{ t: 'add', node }], inverse: [{ t: 'remove', id: 'prim_1' }] },
        d,
      ),
    ).toEqual([])
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
    const remote = server.commit([{ t: 'update', id: band, patch: { profile: 'dShape' } }], {
      actor: { type: 'agent', runId: 'r1' },
    })
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

  it('keeps saving after an answer it cannot read, instead of stalling the outbox', async () => {
    const server = new FakeServer(solitaire())
    const session = sessionOn(server)
    server.failNext = ['garbled']
    session.commit(setWidth(session.get().view, 3))
    session.commit(setWidth(session.get().view, 3.4))
    const settled = await Promise.race([
      session.idle().then(() => 'saved'),
      new Promise((r) => setTimeout(() => r('stalled'), 300)),
    ])
    expect(settled).toBe('saved')
    // The first change was committed once (the retry under the same id is replayed).
    expect(server.log.map((c) => c.seq)).toEqual([1, 2])
    expect(width(server.design)).toBe(3.4)
    expect(session.get().confirmed).toEqual(server.design)
    expect(session.get().save).toEqual({ status: 'saved' })
  })

  it('drops a change the server refuses', async () => {
    const server = new FakeServer(solitaire())
    const session = sessionOn(server)
    session.commit(setWidth(session.get().view, 3))
    // Someone deletes the band before our change lands.
    server.design = applyOps(server.design, [
      { t: 'remove', id: bandId(server.design), cascade: true },
    ]).design
    await session.idle()
    expect(session.takeNotices()[0]).toMatchObject({ type: 'dropped' })
  })

  it('converges when opened from a stale cached copy, without waiting for an event', async () => {
    const server = new FakeServer(solitaire())
    const stale = { design: server.design, version: 0 }
    server.commit(setWidth(server.design, 4), { actor: { type: 'agent', runId: 'r' } })
    const session = sessionOn(server, stale)
    await flush()
    expect(session.get().version).toBe(1)
    expect(width(session.get().view)).toBe(4)
  })

  it('acknowledges a change committed before a snapshot rebase instead of resending it forever', async () => {
    const server = new FakeServer(solitaire())
    const session = sessionOn(server)
    await flush()
    // Our change is committed but its response is lost; the retry waits for the backoff.
    server.failNext = ['lost']
    session.commit(setWidth(session.get().view, 3))
    await flush()
    // Meanwhile more than a history page of changes lands elsewhere, the last setting 5.
    for (let i = 0; i < 205; i++)
      server.commit([
        { t: 'update', id: bandId(server.design), patch: { thicknessTop: 1.5 + (i % 5) / 10 } },
      ])
    server.commit(setWidth(server.design, 5))
    await session.resync()
    await session.idle()
    expect(session.get().pending).toHaveLength(0)
    expect(session.get().version).toBe(server.version)
    expect(width(session.get().view)).toBe(5)
    expect(server.applyCalls).toBeLessThan(5)
  })

  it('waits for the backoff before each retry (one request per attempt)', async () => {
    const server = new FakeServer(solitaire())
    const session = sessionOn(server, undefined, 20)
    await flush()
    server.failNext = Array(50).fill('offline')
    session.commit(setWidth(session.get().view, 3))
    await new Promise((r) => setTimeout(r, 50))
    // At 0, 20 and 40 ms; never an immediate resend on top of the timer.
    expect(server.applyCalls).toBeLessThanOrEqual(3)
    session.dispose()
  })

  it('keeps filling a gap when fetching history fails', async () => {
    const server = new FakeServer(solitaire())
    const session = sessionOn(server)
    await flush()
    server.commit(setWidth(server.design, 3))
    const second = server.commit(setWidth(server.design, 3.5))
    server.failHistory = 1
    session.receive(second)
    await new Promise((r) => setTimeout(r, 60))
    expect(session.get().version).toBe(2)
    expect(session.get().inbox).toEqual({})
  })

  it('counts a live gesture as unsaved', () => {
    const server = new FakeServer(solitaire())
    const session = sessionOn(server)
    session.preview('k', setWidth(session.get().view, 3))
    expect(session.get().save).toEqual({ status: 'unsaved' })
    session.commitGesture()
    expect(session.get().save).toEqual({ status: 'saving', count: 1 })
  })

  it('converges under random interleavings of local edits, remote edits, lost events and failures', async () => {
    let seed = 7
    const rand = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
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
          const change = server.commit([{ t: 'update', id: band, patch: { [field]: value } }], {
            actor: { type: 'agent', runId: `run_${round}` },
          })
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

it('rejects a strict edit when a concurrent write reaches the server first', async () => {
  const design = solitaire()
  const server = new FakeServer(design)
  const session = sessionOn(server)
  await session.resync()
  // The live event for this change has not arrived in the designer's window yet.
  server.commit(setWidth(design, 3))
  session.commit(setWidth(design, 4), { baseVersion: 0 })
  await session.idle()
  expect(width(server.design)).toBe(3)
  expect(server.applyCalls).toBe(1)
  expect(session.takeNotices()).toContainEqual(
    expect.objectContaining({
      type: 'dropped',
      reason: expect.stringContaining('Reopen'),
    }),
  )
  session.dispose()
})

it('undoes the first mesh edit without erasing vertices added by a collaborator', async () => {
  const design = applyOps(solitaire(), [
    {
      t: 'add',
      node: {
        id: 'mesh',
        kind: 'meshBody',
        keepSourcePlacement: true,
        source: { type: 'asset', assetId: 'source' },
      },
    },
  ]).design
  const server = new FakeServer(design)
  const session = sessionOn(server)
  const move = (id: number, xyz: number[]): Op[] => [
    {
      t: 'update',
      id: 'mesh',
      patch: { meshEdits: { assetId: 'source', vertices: { [id]: xyz } } },
    },
  ]

  session.commit(move(12, [1, 2, 3]))
  await session.idle()
  session.receive(server.commit(move(27, [4, 5, 6])))
  session.undo()
  await session.idle()
  expect(server.design.nodes.mesh).toMatchObject({
    meshEdits: { assetId: 'source', vertices: { '27': [4, 5, 6] } },
  })
  expect(server.design.nodes.mesh).not.toHaveProperty('meshEdits.vertices.12')
  session.dispose()
})
