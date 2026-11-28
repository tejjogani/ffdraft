import { afterAll, beforeAll, expect, it } from 'vitest'
import { serviceContext } from './service-context'
import { engineServer } from './test/engines'
import { BOOT_TIMEOUT, type Client, client, type TestServer } from './test/harness'

let server: TestServer
let api: Client
beforeAll(async () => {
  server = await engineServer()
  api = client(server)
}, BOOT_TIMEOUT)
afterAll(() => server.dispose())

it('queries and moves one saved array placement through the guarded authoring and render APIs', async () => {
  const piece = await api.call('pieces.create', { templateId: 'wedding-band' })
  const pieceId = piece.id
  const row = await api.call('design.apply', {
    pieceId,
    label: 'Build a small stone row',
    ops: [
      {
        t: 'add',
        node: {
          id: 'melee',
          kind: 'gemRow',
          host: 'band',
          stoneWidth: 1,
          coverage: 35,
          skipCenter: 0,
        },
      },
    ],
  })
  const query = { pieceId, nodeId: 'melee' }
  const page = await api.call('design.stoneInstances', { ...query, offset: 1, limit: 1 })
  expect(page.version).toBe(row.version)
  expect(page.stoneCount).toBeGreaterThan(1)
  expect(page.stones).toHaveLength(1)
  const stone = page.stones[0]!
  expect(stone).toMatchObject({ id: 'melee:1', number: 2, offsetMm: [0, 0, 0] })
  expect(stone.placementId).toMatch(/^s[0-9a-z]{1,11}$/)

  const edit = {
    pieceId,
    baseVersion: page.version,
    label: 'Displace stone 2',
    ops: [
      {
        t: 'update' as const,
        id: 'melee',
        patch: { stoneOffsetsMm: { [stone.placementId!]: [0.125, -0.1, 0.05] } },
      },
    ],
  }
  expect((await api.fail('design.apply', { ...edit, baseVersion: page.version - 1 })).status).toBe(
    409,
  )
  const saved = await api.call('design.apply', edit)
  const moved = (await api.call('design.stoneInstances', { ...query, offset: 1, limit: 1 }))
    .stones[0]!
  expect(moved.placementId).toBe(stone.placementId)
  expect(moved.offsetMm).toEqual([0.125, -0.1, 0.05])
  for (const [i, mm] of [0.125, -0.1, 0.05].entries())
    expect(moved.girdleMm[i]! - stone.girdleMm[i]!).toBeCloseTo(mm, 8)

  const latest = await api.call('pieces.get', { id: pieceId })
  const ctx = await server.runtime.context(server.runtime.local!)
  const render = await ctx.services
    .get('geometry')
    .renderInput(latest.design, serviceContext(ctx), { pieceId })
  expect(render.subject.stones.find(({ id }) => id === stone.id)?.matrix.slice(12, 15)).toEqual(
    moved.girdleMm,
  )

  const undone = await api.call('design.revert', { pieceId, seq: saved.version })
  expect(
    (await api.call('design.stoneInstances', { ...query, offset: 1, limit: 1 })).stones[0],
  ).toEqual(stone)
  await api.call('design.revert', { pieceId, seq: undone.version })
  expect(
    (await api.call('design.stoneInstances', { ...query, offset: 1, limit: 1 })).stones[0],
  ).toEqual(moved)
})
