import sharp from 'sharp'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { putAsset } from './assets/assets'
import { engineServer } from './test/engines'
import { BOOT_TIMEOUT, client, type TestServer } from './test/harness'

let server: TestServer
beforeAll(async () => {
  server = await engineServer()
}, BOOT_TIMEOUT)
afterAll(() => server.dispose())

it('the selected silhouette changes the solid at the same height, depth and alloy', async () => {
  const api = client(server)
  const ctx = await server.runtime.context(server.runtime.local!)
  const piece = await api.call('pieces.create', { kind: 'pendant' })
  const other = await api.call('pieces.create', { kind: 'pendant' })
  const board = await api.call('boards.forPiece', { pieceId: piece.id })
  const masses: number[] = []
  for (const shape of [
    'M10 10H90V90H10Z',
    'M50 10L90 90H10Z',
    'M10 10H90V90H10Z M30 30V70H70V30Z',
  ]) {
    const raw = Buffer.from(
      `<svg width="100" height="100"><rect width="100" height="100" fill="white"/><path fill="black" d="${shape}"/></svg>`,
    )
    const asset = await putAsset(ctx, {
      bytes: await sharp(raw).png().toBuffer(),
      name: 'logo.png',
    })
    const [ref] = await api.call('references.save', {
      boardId: board.id,
      items: [{ assetId: asset.id, rights: 'own' }],
    })
    const input = { pieceId: piece.id, referenceId: ref!.id }
    const outline = await api.call('match.traceOutline', input)
    expect((await api.fail('match.traceOutline', { ...input, pieceId: other.id })).status).toBe(404)
    const out = await api.call('design.apply', {
      pieceId: piece.id,
      baseVersion: outline.version,
      label: 'Trace logo',
      ops: [
        {
          t: 'add',
          node: {
            id: 'logo',
            kind: 'vectorBody',
            height: 20,
            thickness: 2,
            bevel: 'flat',
            material: 'pt950',
            source: { type: 'svg', d: outline.path },
          },
        },
      ],
    })
    const facts = await api.call('design.evaluate', { pieceId: piece.id })
    masses.push(facts.metalMassG)
    await api.call('design.revert', { pieceId: piece.id, seq: out.version })
    await api.call('references.update', { id: ref!.id, rights: 'viewOnly' })
    expect((await api.fail('match.traceOutline', input)).status).toBe(403)
  }
  expect(masses[0]).toBeGreaterThan(0)
  expect(masses[1]! / masses[0]!).toBeCloseTo(0.5, 1)
  expect(masses[2]! / masses[0]!).toBeCloseTo(0.75, 1)
}, 120_000)
