import { readRhino3dm } from '@pave/kernel/rhino-import'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { putAsset } from './assets/assets'
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

describe('native end face commands', () => {
  it('reports when a selected feature has no retained Rhino solid, and keeps the project unchanged', async () => {
    const { id, version } = await api.call('pieces.create', { templateId: 'wedding-band' })
    expect(await api.call('design.rhinoCapFaces', { pieceId: id, nodeId: 'band' })).toMatchObject({
      version,
      faces: [],
      nativeAssetId: null,
    })
    const failed = await api.fail('design.offsetRhinoCap', {
      pieceId: id,
      nodeId: 'band',
      nativeAssetId: 'wrong',
      faceIndex: 0,
      offsetMm: 0.25,
      baseVersion: version,
      changeId: 'invalid-cap',
    })
    expect(failed.status).toBe(400)
    expect((await api.call('pieces.get', { id })).version).toBe(version)
    expect(
      (await api.fail('design.rhinoCapFaces', { pieceId: id, nodeId: 'missing' })).status,
    ).toBe(404)
  })
})

it('edits a scaled, rotated sleeve, rejects stale and collapsed moves, and reopens the exact solid and undo on another installation', async () => {
  const ref = await createRhinoSleeve(server, api, 2)
  const original = await api.call('design.rhinoCapFaces', ref)
  const cap = original.faces.find((f) => f.normal[1] < -0.999)!
  expect(cap.spanMm).toBeCloseTo(4)
  expect(cap.innerLoops).toBe(1)
  const input = {
    ...ref,
    faceIndex: cap.faceIndex,
    baseVersion: original.version,
    nativeAssetId: original.nativeAssetId!,
    offsetMm: 0.25,
    changeId: 'sleeve-thicker',
  }
  expect(
    (await api.fail('design.offsetRhinoCap', { ...input, nativeAssetId: 'different' })).status,
  ).toBe(409)
  expect((await api.fail('design.offsetRhinoCap', { ...input, offsetMm: -4 })).status).toBe(400)
  expect((await api.fail('design.offsetRhinoCap', { ...input, faceIndex: 100 })).status).toBe(400)
  expect((await api.fail('design.offsetRhinoCap', { ...input, offsetMm: 0 })).status).toBe(400)
  const change = await api.call('design.offsetRhinoCap', input)
  expect(change.version).toBe(2)
  expect(await api.call('design.offsetRhinoCap', input)).toEqual(change)
  expect((await api.fail('design.offsetRhinoCap', { ...input, changeId: 'another' })).status).toBe(
    409,
  )
  const current = await api.call('design.rhinoCapFaces', ref)
  const next = current.faces.find((f) => f.faceIndex === cap.faceIndex)!
  expect(next.spanMm).toBeCloseTo(4.25, 7)
  expect(next.center[1]).toBeCloseTo(cap.center[1] - 0.25, 7)
  const far = current.faces.find((f) => f.faceIndex === cap.oppositeFaceIndex)!
  const fixed = original.faces.find((f) => f.faceIndex === cap.oppositeFaceIndex)!
  for (const axis of [0, 1, 2]) expect(far.center[axis]).toBeCloseTo(fixed.center[axis]!, 7)
  expect(current.nativeAssetId).not.toBe(original.nativeAssetId)
  const exported = async (target: Client, pieceId: string) => {
    const { asset } = await target.call('design.export', { pieceId, format: '3dm' })
    const model = await readRhino3dm(await assetBytes(target, asset))
    expect(model.objects).toHaveLength(1)
    expect(model.objects[0]!.native).toBeDefined()
    return model.objects[0]!.bounds
  }
  const changedBounds = await exported(api, ref.pieceId)
  expect(changedBounds.max[1] - changedBounds.min[1]).toBeCloseTo(4.25, 5)
  const saved = await api.call('pieces.saveFile', { id: ref.pieceId })
  const receiver = await engineServer()
  try {
    const other = client(receiver),
      ctx = await receiver.runtime.context(receiver.runtime.local!)
    const file = await putAsset(ctx, {
      bytes: await assetBytes(api, saved.asset),
      kind: 'archive',
      name: 'Sleeve.pave',
      mime: 'application/octet-stream',
    })
    const { piece } = await other.call('pieces.openFile', { assetId: file.id })
    expect(await exported(other, piece.id)).toEqual(changedBounds)
    await other.call('design.revert', { pieceId: piece.id, seq: change.version })
    const restored = await exported(other, piece.id)
    expect(restored.max[1] - restored.min[1]).toBeCloseTo(4, 5)
    const reopened = await other.call('design.rhinoCapFaces', {
      pieceId: piece.id,
      nodeId: ref.nodeId,
    })
    expect(reopened.faces.find((f) => f.faceIndex === cap.faceIndex)?.innerLoops).toBe(1)
  } finally {
    await receiver.dispose()
  }
}, 120_000)
