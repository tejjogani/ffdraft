/**
 * A .pave file with the real kernel: the display mesh inside is a real GLB, written without
 * claiming an export, the exact STEP (a counted export) is left out, and the reopened piece
 * evaluates to the same facts as the one it was saved from.
 */
import { unzipSync } from 'fflate'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { assetBytes, engineServer } from '../test/engines'
import { BOOT_TIMEOUT, type Client, client, type TestServer } from '../test/harness'

let server: TestServer
let api: Client
beforeAll(async () => {
  server = await engineServer()
  api = client(server)
}, BOOT_TIMEOUT)
afterAll(() => server.dispose())

it('carries real GLB geometry, no STEP, and reopens to the same facts, never counted', async () => {
  const piece = await api.call('pieces.create', { templateId: 'solitaire', title: 'Real' })
  const { asset, notes } = await api.call('pieces.saveFile', { id: piece.id })
  expect(notes).toEqual([])
  const bytes = await assetBytes(api, asset)
  const entries = unzipSync(bytes)
  // The exact STEP is a counted export, so the free file never carries it.
  expect(entries['geometry/exact.step']).toBeUndefined()
  const glb = entries['geometry/display.glb']!
  expect(new TextDecoder().decode(glb.subarray(0, 4))).toBe('glTF')

  const form = new FormData()
  form.set('file', new File([bytes as Uint8Array<ArrayBuffer>], 'Real.pave'))
  const uploaded = (await (
    await api.request('/api/assets', { method: 'POST', body: form })
  ).json()) as { id: string }
  const { piece: opened } = await api.call('pieces.openFile', { assetId: uploaded.id })
  const [a, b] = await Promise.all([
    api.call('design.evaluate', { pieceId: piece.id, detail: 'draft' }),
    api.call('design.evaluate', { pieceId: opened.id, detail: 'draft' }),
  ])
  expect(a.metalMassG).toBeGreaterThan(0)
  expect(a.stoneCount).toBeGreaterThan(0)
  expect(b).toEqual(a)
  const plan = await api.call('plan.get', {})
  expect(plan.allowances.find((x) => x.allowance === 'export')!.used).toBe(0)
}, 240_000)
