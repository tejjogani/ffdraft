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

it('copies a complete outer and inner face border with one guarded, undoable CAD change', async () => {
  const ref = await createRhinoSleeve(server, api, 2)
  const before = await api.call('pieces.get', { id: ref.pieceId })
  const page = await api.call('design.rhinoFaceBorders', { ...ref, limit: 2 })
  expect(page).toMatchObject({
    faceCount: 4,
    faces: [],
    reason: null,
    version: before.version,
  })
  expect(page.curves).toBeUndefined()
  expect((await api.fail('design.rhinoFaceBorders', { ...ref, limit: 31 })).status).toBe(400)

  const face = await api.call('design.rhinoFaceBorders', { ...ref, faceIndex: 3 })
  expect(face.nativeAssetId).toBe(page.nativeAssetId)
  expect(face.faces).toHaveLength(1)
  expect(face.curves?.map(({ kind }) => kind)).toEqual(['outer', 'inner'])
  for (const [x, y, z] of face.faces[0]!.loops[0]!.preview) {
    expect(y).toBeCloseTo(1, 9)
    expect(Math.hypot(x - 4, z - 6)).toBeCloseTo(6, 9)
  }
  const edit = {
    pieceId: ref.pieceId,
    baseVersion: face.version,
    label: 'Duplicate Rhino face border',
    ops: face.curves!.map(({ kind, ...curve }) => ({
      t: 'add' as const,
      node: { id: `border-${kind}`, kind: 'nurbsCurve' as const, ...curve },
    })),
  }
  expect((await api.fail('design.apply', { ...edit, baseVersion: face.version - 1 })).status).toBe(
    409,
  )
  const changed = await api.call('design.apply', edit)
  expect(changed.version).toBe(before.version + 1)
  const after = await api.call('pieces.get', { id: ref.pieceId })
  expect(after.design.nodes.sleeve).toEqual(before.design.nodes.sleeve)
  expect(after.design.nodes['border-outer']).not.toHaveProperty('sourceObjectId')
  expect(after.design.nodes['border-inner']).not.toHaveProperty('sourceObjectId')
  const { asset } = await api.call('design.export', { pieceId: ref.pieceId, format: '3dm' })
  const model = await readRhino3dm(await assetBytes(api, asset), { includeCurves: true })
  expect(model.objects).toHaveLength(1)
  expect(model.curves).toHaveLength(2)
  for (const [{ kind, ...curve }, copied] of face.curves!.map(
    (curve, i) => [curve, model.curves[i]!] as const,
  )) {
    expect(copied, kind).toMatchObject(curve)
  }

  await api.call('design.revert', { pieceId: ref.pieceId, seq: changed.version })
  expect((await api.call('pieces.get', { id: ref.pieceId })).design).toEqual(before.design)
})
