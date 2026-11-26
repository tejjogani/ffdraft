import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { engineServer } from './test/engines'
import { BOOT_TIMEOUT, type Client, client, type TestServer, testServer } from './test/harness'

let server: TestServer
let api: Client

beforeAll(async () => {
  server = await testServer()
  api = client(server)
}, BOOT_TIMEOUT)
afterAll(() => server.dispose())

describe('design.replaceStone', () => {
  it('previews without writing, applies the same ops as one change, and reverts exactly', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    const before = await api.call('pieces.get', { id: piece.id })
    const input = {
      pieceId: piece.id,
      target: { nodeId: 'center' },
      change: { cut: 'oval' as const },
    }

    const preview = await api.call('design.replaceStone', { ...input, dryRun: true })
    expect(preview.applied).toBe(false)
    expect(preview.version).toBe(before.version)
    expect(preview.ops).toEqual([
      { t: 'update', id: 'center', patch: { cut: 'oval', width: 5.74 } },
    ])
    expect(preview.notes[0]).toMatch(/^Kept 1\.00 ct/)
    // No geometry engine in this server: no facts to compare.
    expect(preview.before).toBeNull()
    expect((await api.call('pieces.get', { id: piece.id })).version).toBe(before.version)

    const applied = await api.call('design.replaceStone', input)
    expect(applied.applied).toBe(true)
    expect(applied.ops).toEqual(preview.ops)
    expect(applied.change).toMatchObject({
      seq: before.version + 1,
      label: 'Replace “Centre stone”: 1.00 ct oval',
      actor: { type: 'user' },
    })
    const history = await api.call('design.history', { pieceId: piece.id })
    expect(history).toHaveLength(1)

    // Applying the same change again finds nothing to do and writes nothing.
    const again = await api.call('design.replaceStone', input)
    expect(again).toMatchObject({ applied: false, ops: [] })
    expect(await api.call('design.history', { pieceId: piece.id })).toHaveLength(1)

    await api.call('design.revert', { pieceId: piece.id, seq: applied.version })
    expect((await api.call('pieces.get', { id: piece.id })).design).toEqual(before.design)
  })

  it('gives a retried apply (same change id) the change it made, writing nothing new', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    const input = {
      pieceId: piece.id,
      target: { nodeId: 'center' },
      change: { cut: 'oval' as const },
      changeId: 'chg_retry_1',
    }
    const first = await api.call('design.replaceStone', input)
    expect(first.applied).toBe(true)
    // The response was lost and the call is sent again: the design already holds the change.
    const retry = await api.call('design.replaceStone', input)
    expect(retry).toMatchObject({
      applied: true,
      version: first.version,
      ops: first.ops,
      label: first.label,
    })
    expect(retry.change).toEqual(first.change)
    expect(await api.call('design.history', { pieceId: piece.id })).toHaveLength(1)
  })

  it('answers a bad target with 400', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    const bad = await api.fail('design.replaceStone', {
      pieceId: piece.id,
      target: { nodeId: 'band' },
      change: { cut: 'oval' },
    })
    expect(bad.status).toBe(400)
    expect(bad.error.message).toMatch(/carries no stones/)
  })

  it('rejects a stale fit even when another change applied the same candidate', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    const input = {
      pieceId: piece.id,
      target: { nodeId: 'center' },
      change: {
        fit: {
          provider: 'diaex',
          sku: 'STALE',
          measured: { length: 6.51, width: 6.46, depth: 4.3 },
        },
      },
      baseVersion: piece.version,
    }
    const first = await api.call('design.replaceStone', { ...input, changeId: 'fit-original' })
    const stale = await api.fail('design.replaceStone', { ...input, changeId: 'fit-stale' })
    expect(stale).toMatchObject({
      status: 409,
      error: { code: 'conflict', currentVersion: first.version },
    })
    const retry = await api.call('design.replaceStone', { ...input, changeId: 'fit-original' })
    expect(retry.change).toEqual(first.change)
    expect(await api.call('design.history', { pieceId: piece.id })).toHaveLength(1)
  })

  it('records only one change when identical fits reach the transaction together', async () => {
    const piece = await api.call('pieces.create', { templateId: 'solitaire' })
    const input = {
      pieceId: piece.id,
      target: { nodeId: 'center' },
      change: {
        fit: {
          provider: 'diaex',
          sku: 'RACE',
          measured: { length: 6.51, width: 6.46, depth: 4.3 },
        },
      },
    }
    const answers = await Promise.all([
      api.call('design.replaceStone', input),
      api.call('design.replaceStone', input),
    ])
    expect(answers.filter((answer) => answer.applied)).toHaveLength(1)
    expect(answers.map((answer) => answer.version)).toEqual([piece.version + 1, piece.version + 1])
    expect(await api.call('design.history', { pieceId: piece.id })).toHaveLength(1)
  })

  it('does not apply a cut change or source link when a measured fit targets a field', async () => {
    const piece = await api.call('pieces.create', { templateId: 'halo' })
    const bad = await api.fail('design.replaceStone', {
      pieceId: piece.id,
      target: { nodeId: 'halo' },
      change: {
        cut: 'oval',
        fit: { provider: 'diaex', sku: 'FIELD', measured: { length: 6.6, width: 6.4, depth: 4 } },
      },
    })
    expect(bad.status).toBe(400)
    expect((await api.call('pieces.get', { id: piece.id })).design).toEqual(piece.design)
    expect(await api.call('design.history', { pieceId: piece.id })).toEqual([])
  })
})

describe('design.replaceStone with the geometry engine', () => {
  let engines: TestServer
  beforeAll(async () => {
    engines = await engineServer()
  }, BOOT_TIMEOUT)
  afterAll(() => engines.dispose())

  it('reports the weight, carat and stone-count deltas and what the change clears', async () => {
    const api2 = client(engines)
    const piece = await api2.call('pieces.create', { templateId: 'solitaire' })
    const r = await api2.call('design.replaceStone', {
      pieceId: piece.id,
      target: { nodeId: 'center' },
      change: { cut: 'round', carat: 2 },
      dryRun: true,
    })
    expect(r.before?.caratTotal).toBeCloseTo(1, 1)
    expect(r.after?.caratTotal).toBeCloseTo(2, 1)
    expect(r.delta?.caratTotal).toBeCloseTo(1, 1)
    expect(r.delta?.stoneCount).toBe(0)
    expect(r.notes).toContain('Claws 4 → 6')
  }, 120_000)

  it('swaps measured candidates on one project when both projects have a center node', async () => {
    const app = client(engines)
    const first = await app.call('pieces.create', {
      title: 'First project',
      templateId: 'solitaire',
    })
    const second = await app.call('pieces.create', {
      title: 'Second project',
      templateId: 'solitaire',
    })
    const target = { nodeId: 'center' }
    const a = {
      provider: 'diaex',
      sku: 'A',
      measured: { length: 7.34, width: 7.29, depth: 4.3 },
      url: 'https://supplier.example/A',
      priceUsd: 5200,
      certificate: 'A-CERT',
    }
    const b = { provider: 'diaex', sku: 'B', measured: { length: 7.57, width: 7.52, depth: 4.59 } }
    const other = {
      provider: 'diaex',
      sku: 'OTHER',
      measured: { length: 6.55, width: 6.5, depth: 4.1 },
    }
    await app.call('design.replaceStone', { pieceId: second.id, target, change: { fit: other } })
    const otherBefore = await app.call('pieces.get', { id: second.id })
    const appliedA = await app.call('design.replaceStone', {
      pieceId: first.id,
      target,
      change: { fit: a },
    })
    const beforeSwap = await app.call('pieces.get', { id: first.id })
    const changeId = 'swap-7-52-mm'
    const swap = { pieceId: first.id, target, change: { fit: b }, changeId }
    const preview = await app.call('design.replaceStone', { ...swap, dryRun: true })
    expect(preview.applied).toBe(false)
    expect(preview.version).toBe(appliedA.version)
    expect(preview.before?.lots).toMatchObject([{ width: 7.29, length: 7.34, count: 1 }])
    expect(preview.after?.lots).toMatchObject([{ width: 7.52, length: 7.57, count: 1 }])
    expect(preview.notes).toContain('Claws 4 → 6')
    expect(preview.delta?.metalMassG).not.toBe(0)
    expect((await app.call('pieces.get', { id: first.id })).design).toEqual(beforeSwap.design)

    const applied = await app.call('design.replaceStone', { ...swap, baseVersion: preview.version })
    expect(applied.applied).toBe(true)
    expect(applied.ops).toEqual(preview.ops)
    const centre = (await app.call('pieces.get', { id: first.id })).design.nodes.center
    expect(centre).toMatchObject({ sourcing: b })
    expect(centre).not.toHaveProperty('sourcing.certificate')
    expect(centre).not.toHaveProperty('sourcing.url')
    expect(centre).not.toHaveProperty('sourcing.priceUsd')
    const duplicate = await app.fail('design.replaceStone', {
      pieceId: second.id,
      target,
      change: { fit: other },
      changeId,
    })
    expect(duplicate.status).toBe(409)
    expect((await app.call('pieces.get', { id: second.id })).design).toEqual(otherBefore.design)
    expect(await app.call('design.history', { pieceId: second.id })).toHaveLength(1)

    await app.call('design.revert', { pieceId: first.id, seq: applied.version })
    expect((await app.call('pieces.get', { id: first.id })).design).toEqual(beforeSwap.design)
  }, 120_000)
})
