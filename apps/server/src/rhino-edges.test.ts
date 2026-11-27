import { readRhino3dm } from '@pave/kernel/rhino-import'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { assetBytes, engineServer } from './test/engines'
import { BOOT_TIMEOUT, type Client, client, type TestServer } from './test/harness'
import { createRhinoSleeve } from './test/rhino-sleeve'

let server: TestServer
let api: Client
beforeAll(async () => {
  server = await engineServer()
  api = client(server)
}, BOOT_TIMEOUT)
afterAll(() => server.dispose())

it('duplicates a project-space Rhino edge as one independent exact curve with history', async () => {
  const ref = await createRhinoSleeve(server, api, 2)
  const before = await api.call('pieces.get', { id: ref.pieceId })
  const page = await api.call('design.rhinoEdges', { ...ref, offset: 1, limit: 2 })
  expect(page).toMatchObject({
    version: before.version,
    edgeCount: 6,
    edges: [{ edgeIndex: 1 }, { edgeIndex: 2 }],
    reason: null,
  })
  expect(page.curve).toBeUndefined()
  expect((await api.fail('design.rhinoEdges', { ...ref, limit: 101 })).status).toBe(400)
  expect((await api.fail('design.rhinoEdges', { ...ref, edgeIndex: 6 })).status).toBe(400)

  const exact = await api.call('design.rhinoEdges', { ...ref, edgeIndex: 0 })
  expect(exact.nativeAssetId).toBe(page.nativeAssetId)
  expect(exact.edges).toHaveLength(1)
  expect(exact.edges[0]?.preview[0]).toEqual([10, 5, 6])
  expect(exact.edges[0]?.preview.at(-1)).toEqual([10, 5, 6])
  expect(exact.curve?.degree).toBe(2)
  expect(exact.curve?.controlPoints[0]).toEqual([10, 5, 6, 1])

  const edit = {
    pieceId: ref.pieceId,
    baseVersion: exact.version,
    label: 'Duplicate Rhino edge',
    ops: [
      {
        t: 'add' as const,
        node: { id: 'sleeve-rim', kind: 'nurbsCurve' as const, ...exact.curve! },
      },
    ],
  }
  expect((await api.fail('design.apply', { ...edit, baseVersion: exact.version - 1 })).status).toBe(
    409,
  )
  const change = await api.call('design.apply', edit)
  const changed = await api.call('pieces.get', { id: ref.pieceId })
  expect(changed.design.nodes.sleeve).toEqual(before.design.nodes.sleeve)
  expect(changed.design.nodes['sleeve-rim']).toMatchObject(exact.curve!)
  expect(changed.design.nodes['sleeve-rim']).not.toHaveProperty('sourceObjectId')

  const { asset } = await api.call('design.export', { pieceId: ref.pieceId, format: '3dm' })
  const model = await readRhino3dm(await assetBytes(api, asset), { includeCurves: true })
  expect(model.objects).toHaveLength(1)
  expect(model.objects[0]?.native).toBeDefined()
  expect(model.curves).toHaveLength(1)
  expect(model.curves[0]).toMatchObject(exact.curve!)

  const undo = await api.call('design.revert', { pieceId: ref.pieceId, seq: change.version })
  expect((await api.call('pieces.get', { id: ref.pieceId })).design).toEqual(before.design)
  await api.call('design.revert', { pieceId: ref.pieceId, seq: undo.version })
  expect((await api.call('pieces.get', { id: ref.pieceId })).design).toEqual(changed.design)
})

it('reports unsupported selections and mesh-shaping edits without changing project history', async () => {
  const primitive = await api.call('pieces.create', { templateId: 'wedding-band' })
  const unsupported = await api.call('design.rhinoEdges', { pieceId: primitive.id, nodeId: 'band' })
  expect(unsupported).toMatchObject({ nativeAssetId: null, edgeCount: 0, edges: [] })
  expect(unsupported.reason).toBeTruthy()

  const ref = await createRhinoSleeve(server, api)
  const edit = await api.call('design.apply', {
    pieceId: ref.pieceId,
    label: 'Smooth imported mesh',
    ops: [{ t: 'update', id: 'sleeve', patch: { smooth: 1 } }],
  })
  const result = await api.call('design.rhinoEdges', { ...ref, edgeIndex: 0 })
  expect(result).toMatchObject({ version: edit.version, edgeCount: 0, edges: [] })
  expect(result.reason).toMatch(/mesh shaping/i)
  expect(result.curve).toBeUndefined()
  expect((await api.call('pieces.get', { id: ref.pieceId })).version).toBe(edit.version)
})
