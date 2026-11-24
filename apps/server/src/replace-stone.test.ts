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
})
