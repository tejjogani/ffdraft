/** Boards and references: trusted saving, rights, canvas, lineage, similarity and capture. */
import type { SearchResult, ServerEvent } from '@pave/schema'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { putAsset } from './assets/assets'
import { insertReferences } from './handlers/ideate'
import { createImageGen } from './imagegen'
import type { Services } from './services'
import { BOOT_TIMEOUT, type Client, client, type TestServer, testServer } from './test/harness'

const png = (color = '#c9a13b') =>
  sharp({ create: { width: 40, height: 30, channels: 3, background: color } })
    .png()
    .toBuffer()

const met: SearchResult = {
  key: 'met:1',
  provider: 'met',
  title: 'Gold earrings',
  thumbUrl: 'https://images.example/t.jpg',
  imageUrl: 'https://images.example/i.jpg',
  pageUrl: 'https://museum.example/1',
  credit: 'The Met',
  license: 'CC0',
  rights: 'open',
  mayStore: true,
  width: 800,
  height: 600,
}

let server: TestServer
let api: Client
const resolve = vi.fn<Services['search']['resolve']>(async (r) =>
  r.key === met.key
    ? met
    : r.key === 'aic:2'
      ? { ...met, key: 'aic:2', provider: 'aic', rights: 'viewOnly', mayStore: false }
      : null,
)
const capture = vi.fn<Services['capture']['capture']>(async (url) => ({
  file: { bytes: await png('#204060'), name: 'capture.png', mime: 'image/png' },
  sourceUrl: url,
}))
beforeAll(async () => {
  server = await testServer({
    services: (runtime) => ({
      search: {
        search: async () => ({ results: [met], providers: ['met'], unavailable: [] }),
        resolve,
      },
      capture: { capture },
      // The fake provider, so a request reaches the rights check (Claude is not needed before it).
      ...createImageGen(runtime, { env: { PAVE_IMAGE_GEN: 'fake' } }).services,
    }),
  })
  api = client(server)
}, BOOT_TIMEOUT)
afterAll(() => server.dispose())

describe('saving references', () => {
  it('trusts the provider, not the client, and stores pixels only where allowed', async () => {
    const board = await api.call('boards.create', { title: 'Deco' })
    const piece = await api.call('pieces.create', {})
    const events: ServerEvent[] = []
    const off = server.runtime.events.subscribe(server.runtime.local!.orgId, (e) => events.push(e))
    const [open, spoofed, url, swatch, fromPiece] = await api.call('references.save', {
      boardId: board.id,
      items: [
        { result: { ...met, title: 'tampered', rights: 'viewOnly' } },
        { result: { ...met, key: 'aic:2', provider: 'aic', rights: 'open', mayStore: true } },
        { url: 'https://pinterest.example/pin/1', rights: 'open' },
        { swatch: { hex: '#e6c068' } },
        { note: 'Our cover', pieceId: piece.id },
      ],
    })
    off()
    // What the client echoed is ignored: title and rights come from the provider; pixels are stored.
    expect(open).toMatchObject({ type: 'image', rights: 'open', title: 'Gold earrings', width: 40 })
    expect(open!.assetId).not.toBeNull()
    expect(open!.source?.capturedAt).not.toBeNull()
    expect(capture).toHaveBeenCalledWith(met.imageUrl, expect.anything())
    expect(spoofed).toMatchObject({ rights: 'viewOnly', assetId: null })
    expect(url).toMatchObject({ type: 'link', rights: 'viewOnly' })
    expect(swatch).toMatchObject({ type: 'swatch', palette: ['#E6C068'], title: '#E6C068' })
    expect(fromPiece).toMatchObject({ type: 'note', pieceId: piece.id, canvas: null })
    expect(events).toContainEqual({ type: 'board.updated', boardId: board.id })

    const [lowered] = await api.call('references.save', {
      boardId: board.id,
      items: [{ result: met, rights: 'viewOnly' }],
    })
    expect(lowered).toMatchObject({
      rights: 'viewOnly',
      source: { provider: 'met', license: 'CC0' },
    })
    const gone = await api.fail('references.save', {
      boardId: board.id,
      items: [{ result: { ...met, key: 'met:404' } }],
    })
    expect(gone.status).toBe(400)
    expect(
      (
        await api.fail('references.save', {
          boardId: board.id,
          items: [{ note: 'x', pieceId: 'pc_nope' }],
        })
      ).status,
    ).toBe(404)
  })

  it('lifts view-only only with a person’s attestation, and moves and arranges references', async () => {
    const board = await api.call('boards.create', { title: 'A' })
    const other = await api.call('boards.create', { title: 'B' })
    const [link, note] = await api.call('references.save', {
      boardId: board.id,
      items: [{ url: 'https://example.com/a' }, { note: 'n' }],
    })
    expect((await api.fail('references.update', { id: link!.id, rights: 'licensed' })).status).toBe(
      400,
    )
    const agent = await server.runtime.context({
      ...server.runtime.local!,
      actor: { type: 'agent', runId: 'run_1' },
    })
    await expect(
      server.runtime.invoke(
        'references.update',
        { id: link!.id, rights: 'licensed', attestation: true },
        agent,
      ),
    ).rejects.toMatchObject({ status: 403 })
    const lifted = await api.call('references.update', {
      id: link!.id,
      rights: 'licensed',
      attestation: true,
    })
    expect(lifted.rights).toBe('licensed')

    const canvas = { x: 10, y: 20, w: 200, z: 1 }
    const arranged = await api.call('references.arrange', {
      boardId: board.id,
      items: [
        { id: note!.id, position: 0.5, canvas },
        { id: link!.id, canvas: null },
      ],
    })
    expect(arranged.map((r) => r.id)).toEqual([note!.id, link!.id])
    expect(arranged[0]).toMatchObject({ position: 0.5, canvas })
    expect(
      (
        await api.fail('references.arrange', {
          boardId: other.id,
          items: [{ id: note!.id, position: 1 }],
        })
      ).status,
    ).toBe(404)

    const moved = await api.call('references.update', { id: note!.id, boardId: other.id })
    expect(moved).toMatchObject({ boardId: other.id, position: 1 })
    expect((await api.call('boards.get', { id: board.id })).references.map((r) => r.id)).toEqual([
      link!.id,
    ])
  })

  it('captures the image behind a link without changing its rights', async () => {
    const board = await api.call('boards.create', { title: 'C' })
    const [link] = await api.call('references.save', {
      boardId: board.id,
      items: [{ url: 'https://shop.example/ring' }],
    })
    const captured = await api.call('references.capture', { id: link!.id })
    expect(captured).toMatchObject({ type: 'link', rights: 'viewOnly', width: 40, height: 30 })
    expect(captured.assetId).not.toBeNull()
    expect(captured.source?.capturedAt).not.toBeNull()
    const [note] = await api.call('references.save', { boardId: board.id, items: [{ note: 'n' }] })
    expect((await api.fail('references.capture', { id: note!.id })).status).toBe(409)

    // Saving the captured pixels again, as anyone, keeps them view-only (no laundering to `own`).
    const agent = await server.runtime.context({
      ...server.runtime.local!,
      actor: { type: 'agent', runId: 'run_l' },
    })
    const save = (item: object) =>
      server.runtime.invoke('references.save', { boardId: board.id, items: [item] }, agent)
    const [again] = await save({ assetId: captured.assetId!, rights: 'own' })
    expect(again).toMatchObject({
      rights: 'viewOnly',
      source: { provider: 'web', url: 'https://shop.example/ring' },
    })
    await api.call('references.remove', { ids: [link!.id, again!.id] })
    const [orphan] = await save({ assetId: captured.assetId! })
    expect(orphan).toMatchObject({ rights: 'viewOnly', source: { provider: 'web' } })
    const refused = await api.fail('references.brief', {
      boardId: board.id,
      request: 'a ring like this',
      referenceIds: [orphan!.id],
    })
    expect(refused.status).toBe(400)
    expect(refused.error.message).toContain('view-only')
    expect((await api.fail('references.update', { id: orphan!.id })).status).toBe(400)
  })
})

describe('generation and lineage', () => {
  // Generating itself (brief, provider, check) is covered in imagegen/imagegen.test.ts; here the
  // generated items are written as the pipeline writes them, to test lineage on its own.
  it('snapshots parents with roles, and walks lineage after a parent is deleted', async () => {
    const board = await api.call('boards.create', { title: 'Gen' })
    const ctx = await server.runtime.context(server.runtime.local!)
    const asset = await putAsset(ctx, { bytes: await png(), name: 'mine.png' })
    const [parent] = await api.call('references.save', {
      boardId: board.id,
      items: [{ assetId: asset.id, title: 'Silhouette' }],
    })
    const generated = async (parentId: string, role: 'subject' | null) => {
      const p = (await api.call('boards.get', { id: board.id })).references.find(
        (r) => r.id === parentId,
      )!
      const [r] = await insertReferences(ctx, board.id, [
        {
          type: 'generated',
          assetId: asset.id,
          title: 'A pendant',
          rights: 'own',
          generation: {
            prompt: 'a pendant',
            model: 'fake-image-1',
            seed: 42,
            parentIds: [parentId],
            inputs: [
              {
                id: p.id,
                role,
                title: p.title,
                provider: p.source?.provider ?? null,
                url: null,
                credit: null,
                license: null,
                rights: p.rights,
              },
            ],
            runId: null,
          },
        },
      ])
      return r!
    }
    const child = await generated(parent!.id, 'subject')
    expect(child.generation).toMatchObject({
      seed: 42,
      parentIds: [parent!.id],
      inputs: [
        { id: parent!.id, role: 'subject', title: 'Silhouette', provider: 'upload', rights: 'own' },
      ],
    })
    const grandchild = await generated(child.id, null)
    const piece = await api.call('pieces.create', {
      kind: 'pendant',
      origin: { kind: 'references', referenceIds: [grandchild.id] },
    })

    const fromParent = await api.call('references.lineage', { id: parent!.id })
    expect(fromParent.ancestors).toEqual([])
    expect(fromParent.descendants.map((d) => d.id)).toEqual([child.id, grandchild.id])
    expect(fromParent.pieces.map((p) => p.id)).toEqual([piece.id])

    await api.call('references.remove', { ids: [parent!.id] })
    const fromGrandchild = await api.call('references.lineage', { id: grandchild.id })
    expect(fromGrandchild.ancestors).toEqual([
      expect.objectContaining({
        id: child.id,
        depth: 1,
        reference: expect.objectContaining({ id: child.id }),
      }),
      expect.objectContaining({
        id: parent!.id,
        depth: 2,
        reference: null,
        credit: expect.objectContaining({ title: 'Silhouette', role: 'subject' }),
      }),
    ])
    expect(fromGrandchild.pieces.map((p) => p.id)).toEqual([piece.id])
  })
})

describe('similar references', () => {
  it('matches tags, palette and words without a key, and ranks by embeddings with one', async () => {
    const board = await api.call('boards.create', { title: 'Sim' })
    const [a, b, c] = await api.call('references.save', {
      boardId: board.id,
      items: [
        { note: 'art deco emerald ring', title: 'Deco ring' },
        { note: 'deco geometry', title: 'Fan motif' },
        { note: 'plain band', title: 'Minimal' },
      ],
    })
    await api.call('references.update', { id: a!.id, tags: ['deco'] })
    await api.call('references.update', { id: b!.id, tags: ['deco'] })
    const similar = await api.call('references.similar', { id: a!.id, boardId: board.id })
    expect(similar.map((r) => r.id)).toEqual([b!.id])
    expect(
      (await api.call('references.similar', { text: 'minimal plain', boardId: board.id })).map(
        (r) => r.id,
      ),
    ).toEqual([c!.id])

    const embed = vi.fn<Services['embedding']['embed']>(async (inputs) =>
      inputs.map((i) => ('text' in i && i.text.includes('band') ? [1, 0] : [0, 1])),
    )
    server.runtime.services.register('embedding', { embed })
    const ranked = await api.call('references.similar', {
      text: 'a band',
      boardId: board.id,
      limit: 1,
    })
    expect(ranked.map((r) => r.id)).toEqual([c!.id])
    expect(embed.mock.calls[0]![0]).toHaveLength(4)
    expect((await api.call('session.get', {})).capabilities.embedding).toBe(true)
  })
})
