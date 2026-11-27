import type { MountCage } from '@pave/schema'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { putAsset } from './assets/assets'
import { BOOT_TIMEOUT, type Client, client, type TestServer, testServer } from './test/harness'
import { createRhinoSleeve } from './test/rhino-sleeve'

let server: TestServer, api: Client, asset: string
beforeAll(async () => {
  server = await testServer()
  api = client(server)
  const ctx = await server.runtime.context(server.runtime.local!)
  const obj = 'v 0 0 0\nv 2 0 0\nv 0 3 0\nv 0 0 4\nf 1 3 2\nf 1 2 4\nf 2 3 4\nf 3 1 4\n'
  asset = (
    await putAsset(ctx, {
      name: 'Workshop claw.obj',
      kind: 'mesh',
      mime: 'model/obj',
      bytes: new TextEncoder().encode(obj),
    })
  ).id
}, BOOT_TIMEOUT)
afterAll(() => server.dispose())
const member = (id: string, x: number) => ({
  id,
  kind: 'meshBody',
  keepSourcePlacement: true,
  source: { type: 'asset', assetId: asset, rhinoLayer: 'Crown' },
  transform: { position: [x, 0, 0] },
})
async function example() {
  const { id } = await api.call('pieces.create', { title: 'Handmade setting', kind: 'ring' })
  await api.call('design.apply', {
    pieceId: id,
    label: 'Workshop parts',
    ops: [member('left', -4), member('right', 2), member('other', 8)].map((node) => ({
      t: 'add',
      node,
    })),
  })
  return id
}
it('measures original placed parts and commits only selected mount members once with full undo', async () => {
  const pieceId = await example(),
    nodeIds = ['left', 'right']
  const ref = { pieceId, nodeIds }
  const original = await api.call('pieces.get', { id: pieceId })
  const view = await api.call('design.inspectMount', ref)
  expect(view.bounds).toEqual({ min: [-4, 0, 0], max: [4, 3, 4] })
  expect(view.parts.map((p) => p.nodeId)).toEqual(nodeIds)
  const offsets = Array.from(
    { length: 8 },
    (_, i) => [i > 3 ? 1 : 0, 0, 0] as [number, number, number],
  ) as MountCage['offsets']
  const edit = {
    ...ref,
    baseVersion: view.version,
    changeId: 'workshop-1',
    material: 'pt950' as const,
    cage: { ...view.bounds, offsets, mode: 'byPart' as const },
  }
  expect((await api.fail('design.editMount', { ...edit, material: undefined })).status).toBe(400)
  const change = await api.call('design.editMount', edit)
  expect(await api.call('design.editMount', edit)).toEqual(change)
  expect((await api.fail('design.editMount', { ...edit, changeId: 'separate' })).status).toBe(409)
  const after = await api.call('pieces.get', { id: pieceId })
  expect(after.design.nodes.left).toMatchObject({
    importRole: 'metal',
    material: 'pt950',
    mountCage: edit.cage,
  })
  expect(after.design.nodes.other).toEqual(original.design.nodes.other)
  expect((await api.call('design.inspectMount', ref)).bounds).toEqual(view.bounds)
  await api.call('design.revert', { pieceId, seq: change.version })
  expect((await api.call('pieces.get', { id: pieceId })).design).toEqual(original.design)
})
it('rejects a folded cage, partial coverage and foreign parts without committing any changes', async () => {
  const pieceId = await example(),
    before = await api.call('pieces.get', { id: pieceId })
  const ref = {
    pieceId,
    nodeIds: ['left', 'right'],
    baseVersion: before.version,
    material: 'pt950' as const,
  }
  const flat = Array.from(
    { length: 8 },
    (_, i) => [0, 0, i > 3 ? -10 : 0] as [number, number, number],
  )
  const cage = {
    min: [-4, 0, 0] as [number, number, number],
    max: [4, 3, 4] as [number, number, number],
    offsets: flat,
  }
  expect((await api.fail('design.editMount', { ...ref, cage })).status).toBe(400)
  expect(
    (
      await api.fail('design.editMount', {
        ...ref,
        cage: { ...cage, min: [0, 0, 0], offsets: flat.map(() => [0, 0, 0]) },
      })
    ).status,
  ).toBe(400)
  expect(
    (await api.fail('design.editMount', { ...ref, nodeIds: ['left', 'not-here'] })).status,
  ).toBe(400)
  const partial = { ...cage, min: [0, 0, 0], offsets: flat.map(() => [0, 0, 0]) }
  expect(
    (
      await api.fail('design.apply', {
        pieceId,
        label: 'Partial cage through the general tool',
        ops: [{ t: 'update', id: 'left', patch: { importRole: 'metal', mountCage: partial } }],
      })
    ).status,
  ).toBe(400)
  expect((await api.call('pieces.get', { id: pieceId })).version).toBe(before.version)
})

it('reads native edges in the edited position and never offers an obsolete end face after a cage edit', async () => {
  const ref = await createRhinoSleeve(server, api)
  const before = await api.call('design.rhinoEdges', { ...ref, edgeIndex: 0 })
  const m = await api.call('design.inspectMount', { pieceId: ref.pieceId, nodeIds: [ref.nodeId] })
  const cage = {
    ...m.bounds,
    offsets: Array.from(
      { length: 8 },
      () => [1, 2, -1] as [number, number, number],
    ) as MountCage['offsets'],
    mode: 'byPart' as const,
  }
  await api.call('design.editMount', {
    pieceId: ref.pieceId,
    nodeIds: [ref.nodeId],
    baseVersion: m.version,
    material: 'pt950',
    cage,
  })
  const after = await api.call('design.rhinoEdges', { ...ref, edgeIndex: 0 })
  expect(after.reason).toBeNull()
  const original = before.curve!.controlPoints[0]!,
    next = after.curve!.controlPoints[0]!
  for (const k of [0, 1, 2] as const) expect(next[k]).toBeCloseTo(original[k] + [1, 2, -1][k]!, 6)
  const caps = await api.call('design.rhinoCapFaces', ref)
  expect(caps.faces).toHaveLength(0)
  expect(caps.reason).toMatch(/mount/i)
})
