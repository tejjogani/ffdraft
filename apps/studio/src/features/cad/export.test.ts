/**
 * Exports end to end with the kernel, the server, the save dialog and the toasts replaced: what
 * is saved, under which name, and what the designer is told when the browser's exporter or the
 * server fails.
 */
import type { Design, Piece } from '@pave/schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() =>
  Object.assign(
    vi.fn((_: { title: string; description?: string; type?: string }) => 'toast_1'),
    { error: vi.fn(), dismiss: vi.fn() },
  ),
)
vi.mock('@pave/ui', () => ({ toast }))
vi.mock('../../lib/kernel/client', () => ({ exportDesign: vi.fn() }))
vi.mock('../../lib/save-file', async (original) => ({
  ...(await original<typeof import('../../lib/save-file')>()),
  saveFile: vi.fn(async () => true),
}))
vi.mock('../../lib/rpc', async (original) => ({
  ...(await original<typeof import('../../lib/rpc')>()),
  rpc: { call: vi.fn() },
}))

import { exportDesign } from '../../lib/kernel/client'
import { rpc } from '../../lib/rpc'
import { saveFile } from '../../lib/save-file'
import { exportFormats, runExport } from './export'

const design = { schemaVersion: 2, kind: 'ring', nodes: {}, order: [] } as unknown as Design
const piece = (over: Partial<Piece> = {}) =>
  ({ id: 'p1', title: 'Aurore: v2', origin: null, ...over }) as Piece
const context = { problems: 0, review: vi.fn() }
const local = (over: object = {}) => ({
  bytes: new Uint8Array([1, 2, 3]),
  mime: 'model/stl',
  extension: '.stl',
  notes: ['Units are millimetres'],
  ...over,
})
const saved = () => vi.mocked(saveFile).mock.calls.map(([blob, name]) => ({ blob, name }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(saveFile).mockResolvedValue(true)
})
afterEach(() => vi.unstubAllGlobals())

describe('exportFormats', () => {
  it('lists what this kernel build writes, in menu order', () => {
    expect(exportFormats(['obj', 'stl', 'dxf', 'step'])).toEqual(['stl', 'step', 'obj'])
    expect(exportFormats([])).toEqual([])
  })
})

describe('runExport', () => {
  it('saves what the in-browser exporter wrote under a name every OS accepts', async () => {
    vi.mocked(exportDesign).mockResolvedValue(local() as never)
    await runExport(piece(), design, 'stl', context)
    expect(saved()).toHaveLength(1)
    expect(saved()[0]!.name).toBe('Aurore v2.stl')
    expect(saved()[0]!.blob.size).toBe(3)
    expect(toast.dismiss).toHaveBeenCalledWith('toast_1')
    expect(toast.mock.calls.at(-1)![0]).toMatchObject({
      title: 'Exported STL',
      description: 'Units are millimetres',
    })
    expect(rpc.call).not.toHaveBeenCalled()
  })

  it('says how many problems remain when something to be cast is exported anyway', async () => {
    vi.mocked(exportDesign).mockResolvedValue(local() as never)
    await runExport(piece(), design, 'stl', { ...context, problems: 2 })
    expect(toast.mock.calls.at(-1)![0]).toMatchObject({
      description: '2 problems to fix before casting.',
    })
  })

  it('says nothing more when the save dialog is cancelled', async () => {
    vi.mocked(exportDesign).mockResolvedValue(local() as never)
    vi.mocked(saveFile).mockResolvedValue(false)
    await runExport(piece(), design, 'stl', context)
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('asks for the attestation before exporting a piece made from someone’s artwork', async () => {
    const origin = { attestation: null, sourceAssetIds: ['a1'], referenceIds: [] }
    await runExport(piece({ origin } as never), design, 'stl', context)
    expect(exportDesign).not.toHaveBeenCalled()
    expect(saveFile).not.toHaveBeenCalled()
  })

  it('falls back to the server’s export when the browser’s fails', async () => {
    vi.mocked(exportDesign).mockRejectedValue(new Error('The geometry engine stopped'))
    vi.mocked(rpc.call).mockResolvedValue({
      asset: { id: 'as_9' },
      notes: ['From the server'],
    } as never)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array(5))),
    )
    await runExport(piece(), design, 'step', context)
    expect(rpc.call).toHaveBeenCalledWith('design.export', { pieceId: 'p1', format: 'step' })
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('/api/assets/as_9')
    expect(saved()[0]).toMatchObject({ name: 'Aurore v2.step' })
    expect(saved()[0]!.blob.size).toBe(5)
  })

  it('never saves the server’s error page as the exported file', async () => {
    vi.mocked(exportDesign).mockRejectedValue(new Error('The geometry engine stopped'))
    vi.mocked(rpc.call).mockResolvedValue({ asset: { id: 'as_9' }, notes: [] } as never)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{"error":{"code":"not_found","message":"Asset as_9"}}', { status: 404 }),
      ),
    )
    await runExport(piece(), design, 'stl', context)
    expect(saveFile).not.toHaveBeenCalled()
    expect(toast.dismiss).toHaveBeenCalledWith('toast_1')
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error.mock.calls[0]![0]).toBe('Couldn’t export STL')
  })

  it('reports the browser exporter’s own error when the server cannot export either', async () => {
    vi.mocked(exportDesign).mockRejectedValue(new Error('The geometry engine stopped'))
    vi.mocked(rpc.call).mockRejectedValue(new Error('No geometry engine on the server'))
    await runExport(piece(), design, 'stl', context)
    expect(saveFile).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Couldn’t export STL', 'The geometry engine stopped')
  })

  it('names an untitled piece', async () => {
    vi.mocked(exportDesign).mockResolvedValue(local({ extension: 'glb' }) as never)
    await runExport(piece({ title: '' }), design, 'glb', context)
    expect(saved()[0]!.name).toBe('Untitled piece.glb')
  })
})
