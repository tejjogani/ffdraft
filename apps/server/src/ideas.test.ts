/**
 * The Design stage as an image-based design board, and projects and folders with their costs:
 *
 * - the board's sources: uploads (photos, scanned sketch sheets), sketches made in the app, pasted
 *   links (view-only), notes, and 3D models kept as inspiration;
 * - the piece's design board is made once, however many windows open it at once;
 * - Take to CAD pins a board picture beside CAD; view-only pictures and models are refused;
 * - folders nest one level and never deeper; deleting a folder lifts its sub-folders up;
 * - every cost is attributed to its project and stage: Claude runs (by job or by the tab the
 *   message came from), image generations, Blender renders and Rhino/STEP exports; folders add
 *   up their own projects and their sub-folders'.
 */

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Ctx } from './context'
import { claim, settle } from './plans'
import { BOOT_TIMEOUT, type Client, client, type TestServer, testServer } from './test/harness'
import { recordUsage } from './usage'

let server: TestServer
let api: Client
let ctx: Ctx

beforeAll(async () => {
  server = await testServer({ config: { plan: 'pro' } })
  api = client(server)
  ctx = await server.runtime.context(server.runtime.local!)
}, BOOT_TIMEOUT)
afterAll(() => server?.dispose())

async function upload(name: string, bytes: Uint8Array | Buffer, type: string) {
  const form = new FormData()
  form.set('file', new File([bytes], name, { type }))
  const res = await api.request('/api/assets', { method: 'POST', body: form })
  expect(res.status, await res.clone().text()).toBe(201)
  return (await res.json()) as { id: string; kind: string }
}

const png = (color: string) =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: color } })
    .png()
    .toBuffer()

/** An ASCII STL of a tetrahedron: enough for a file the board keeps as a model. */
const STL = `solid t
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid t
`

describe('the design board', () => {
  it('is made once per piece, even when two windows open it at once', async () => {
    const piece = await api.call('pieces.create', { title: 'Trophy pendant', kind: 'pendant' })
    const [a, b] = await Promise.all([
      api.call('boards.forPiece', { pieceId: piece.id }),
      api.call('boards.forPiece', { pieceId: piece.id }),
    ])
    expect(a.id).toBe(b.id)
    expect(a.pieceId).toBe(piece.id)
    expect(a.title).toBe('Trophy pendant · Design')
    // It is the piece's board, listed among the moodboards and on the piece.
    expect((await api.call('boards.list', { pieceId: piece.id })).map((x) => x.id)).toEqual([a.id])
    expect((await api.call('pieces.get', { id: piece.id })).boardIds).toEqual([a.id])
    // Unlinked, the next open makes a fresh one; the old board lives on in Ideas.
    await api.call('boards.update', { id: a.id, pieceId: null })
    const fresh = await api.call('boards.forPiece', { pieceId: piece.id })
    expect(fresh.id).not.toBe(a.id)
    expect((await api.call('boards.get', { id: a.id })).board.pieceId).toBeNull()
  })

  it('keeps the design board absent when the first reference cannot be saved', async () => {
    const piece = await api.call('pieces.create', { title: 'Rejected reference' })
    const failed = await api.fail('references.saveForPiece', {
      pieceId: piece.id,
      items: [{ note: 'First idea' }, { assetId: 'not-an-asset' }],
    })
    expect(failed.status).toBe(404)
    expect(await api.call('boards.list', { pieceId: piece.id })).toEqual([])
  })

  it('shares a replacement board between two first saves after unlinking', async () => {
    const piece = await api.call('pieces.create', { title: 'Fresh start' })
    const old = await api.call('boards.forPiece', { pieceId: piece.id })
    await api.call('boards.update', { id: old.id, pieceId: null })
    const [first, second] = await Promise.all(
      ['Low bezel', 'Gold band'].map((note) =>
        api.call('references.saveForPiece', { pieceId: piece.id, items: [{ note }] }),
      ),
    )
    expect(first?.[0]?.boardId).toBe(second?.[0]?.boardId)
    const boards = await api.call('boards.list', { pieceId: piece.id })
    expect(boards).toHaveLength(1)
    expect(boards[0]!.referenceCount).toBe(2)
    expect((await api.call('boards.get', { id: old.id })).references).toEqual([])
  })

  it('copies a reusable moodboard in order, independently and without duplicates', async () => {
    const source = await api.call('boards.create', { title: 'Art Deco' })
    const a = await api.call('pieces.create', { title: 'A' })
    const b = await api.call('pieces.create', { title: 'B' })
    const photo = await upload('moodboard.png', await png('#c9a13b'), 'image/png')
    const originals = await api.call('references.save', {
      boardId: source.id,
      items: [
        { assetId: photo.id, title: 'Owned sketch', note: 'Use a stepped shoulder' },
        { note: 'Keep a thin band' },
        { url: 'https://www.pinterest.com/pin/123/', title: 'Engraving' },
      ],
    })
    const input = { pieceId: a.id, sourceBoardId: source.id }
    const [first, retry] = await Promise.all([
      api.call('boards.importMoodboard', input),
      api.call('boards.importMoodboard', input),
    ])
    const other = await api.call('boards.importMoodboard', {
      pieceId: b.id,
      sourceBoardId: source.id,
    })
    expect(first.board.id).toBe(retry.board.id)
    expect(first.added + retry.added).toBe(3)
    const copied = (await api.call('boards.get', { id: first.board.id })).references
    const otherCopies = (await api.call('boards.get', { id: other.board.id })).references
    expect(copied.map((r) => r.importedFrom?.sourceReferenceId)).toEqual(originals.map((r) => r.id))
    expect(copied[0]).toMatchObject({
      assetId: photo.id,
      note: 'Use a stepped shoulder',
      rights: 'own',
    })
    expect(copied[1]).toMatchObject({ note: 'Keep a thin band', type: 'note' })
    expect(copied[2]).toMatchObject({ source: originals[2]!.source, rights: 'viewOnly' })
    expect(otherCopies[0]!.id).not.toBe(copied[0]!.id)
    await api.call('references.update', { id: copied[1]!.id, note: 'Only in A' })
    expect((await api.call('boards.get', { id: other.board.id })).references[1]!.note).toBe(
      'Keep a thin band',
    )
    expect((await api.call('boards.get', { id: source.id })).references).toEqual(originals)
    expect((await api.call('boards.list', { scope: 'library' })).map((r) => r.id)).not.toContain(
      first.board.id,
    )

    const invalid = await api.fail('boards.importMoodboard', {
      sourceBoardId: source.id,
      pieceId: b.id,
      targetBoardId: first.board.id,
    })
    expect(invalid.status).toBe(404)
    expect(
      (await api.fail('boards.importMoodboard', { sourceBoardId: first.board.id, pieceId: b.id }))
        .status,
    ).toBe(404)
    const pins = await api.call('references.pin', {
      pieceId: a.id,
      items: [{ url: 'https://example.com/project-private' }],
    })
    expect(
      (await api.fail('boards.importMoodboard', { sourceBoardId: pins[0]!.boardId, pieceId: b.id }))
        .status,
    ).toBe(404)
  })

  it('takes every source: an upload, a sketch, a scanned sheet, a link, a note and a 3D model', async () => {
    const piece = await api.call('pieces.create', { title: 'Sources', kind: 'pendant' })
    const board = await api.call('boards.forPiece', { pieceId: piece.id })
    const photo = await upload('trophy.png', await png('#c9a13b'), 'image/png')
    const sketch = await upload('sketch.png', await png('#ffffff'), 'image/png')
    const sheet = await upload(
      'sheet.jpg',
      await sharp(await png('#eeeeee'))
        .jpeg()
        .toBuffer(),
      'image/jpeg',
    )
    const model = await upload('crown.stl', new TextEncoder().encode(STL), 'model/stl')
    expect(model.kind).toBe('mesh')
    const refs = await api.call('references.save', {
      boardId: board.id,
      items: [
        { assetId: photo.id, title: 'The trophy' },
        { assetId: sketch.id, title: 'My sketch', rights: 'own' },
        { assetId: sheet.id, title: 'Sketch sheet' },
        { url: 'https://www.pinterest.com/pin/123/', title: 'A pendant I like' },
        { note: 'Trophy on a pendant, about 25 mm, iced base' },
        { assetId: model.id, title: 'Crown model' },
      ],
    })
    expect(refs.map((r) => [r.type, r.rights])).toEqual([
      ['image', 'own'],
      ['image', 'own'],
      ['image', 'own'],
      // A pasted Pinterest or Google link is inspiration: never sent to AI.
      ['link', 'viewOnly'],
      ['note', 'own'],
      ['model', 'own'],
    ])
    expect(refs[3]!.source).toMatchObject({
      provider: 'web',
      url: 'https://www.pinterest.com/pin/123/',
    })
    expect(refs[0]!.source).toMatchObject({ provider: 'upload' })
  })

  it('Take to CAD pins a picture beside CAD with its provenance; refuses view-only pictures and models', async () => {
    const piece = await api.call('pieces.create', { title: 'Take', kind: 'pendant' })
    const board = await api.call('boards.forPiece', { pieceId: piece.id })
    const photo = await upload('pendant.png', await png('#b08d57'), 'image/png')
    const model = await upload('m.stl', new TextEncoder().encode(STL), 'model/stl')
    const [pic, link, mesh] = await api.call('references.save', {
      boardId: board.id,
      items: [
        { assetId: photo.id, title: 'Pendant I like' },
        { url: 'https://www.google.com/imgres?x=1', title: 'Google result' },
        { assetId: model.id },
      ],
    })
    const taken = await api.call('pieces.takeToCad', { pieceId: piece.id, referenceId: pic!.id })
    expect(taken.assetId).toBe(photo.id)
    expect(taken.pin).toMatchObject({ title: 'Pendant I like', rights: 'own', assetId: photo.id })
    const pins = await api.call('references.pins', { pieceId: piece.id })
    expect(pins.references.map((r) => r.id)).toEqual([taken.pin.id])
    // Twice is still one pin.
    await api.call('pieces.takeToCad', { pieceId: piece.id, referenceId: pic!.id })
    expect((await api.call('references.pins', { pieceId: piece.id })).references).toHaveLength(1)

    // A link has no picture to build from; a captured one would stay view-only (next test).
    const viewOnly = await api.fail('pieces.takeToCad', {
      pieceId: piece.id,
      referenceId: link!.id,
    })
    expect(viewOnly.status).toBe(400)
    const asModel = await api.fail('pieces.takeToCad', { pieceId: piece.id, referenceId: mesh!.id })
    expect(asModel.status).toBe(400)
    expect(asModel.error.message).toMatch(/open it as CAD/)
  })

  it('a captured view-only picture stays out of CAD jobs', async () => {
    const piece = await api.call('pieces.create', { title: 'Captured', kind: 'ring' })
    const board = await api.call('boards.forPiece', { pieceId: piece.id })
    const photo = await upload('p.png', await png('#999999'), 'image/png')
    const [ref] = await api.call('references.save', {
      boardId: board.id,
      items: [{ assetId: photo.id, rights: 'viewOnly' }],
    })
    const res = await api.fail('pieces.takeToCad', { pieceId: piece.id, referenceId: ref!.id })
    expect(res.status).toBe(409)
    expect(res.error.message).toMatch(/view-only/)
  })
})

describe('Start CAD, linked or not', () => {
  it('a new project from a board is linked when asked, and can be unlinked and linked again', async () => {
    const board = await api.call('boards.create', { title: 'Client ideas' })
    // Linked: the board becomes the new project's design board.
    const linked = await api.call('pieces.create', {
      title: 'From the board',
      templateId: 'solitaire',
    })
    await api.call('boards.update', { id: board.id, pieceId: linked.id })
    expect((await api.call('boards.forPiece', { pieceId: linked.id })).id).toBe(board.id)
    // Unlinked: the project starts without one.
    const blank = await api.call('pieces.create', { title: 'Blank CAD', kind: 'ring' })
    expect((await api.call('pieces.get', { id: blank.id })).boardIds).toEqual([])
    await api.call('boards.update', { id: board.id, pieceId: null })
    expect((await api.call('pieces.get', { id: linked.id })).boardIds).toEqual([])
    await api.call('boards.update', { id: board.id, pieceId: blank.id })
    expect((await api.call('pieces.get', { id: blank.id })).boardIds).toEqual([board.id])
  })
})

describe('folders', () => {
  it('nest one level, never deeper, and never inside themselves', async () => {
    const client = await api.call('collections.create', { name: 'Client: Rowe' })
    const bridal = await api.call('collections.create', { name: 'Bridal', parentId: client.id })
    expect(bridal.parentId).toBe(client.id)
    const deeper = await api.fail('collections.create', { name: 'Too deep', parentId: bridal.id })
    expect(deeper.status).toBe(400)
    // A folder that holds folders stays at the top.
    const other = await api.call('collections.create', { name: 'Other' })
    expect(
      (await api.fail('collections.update', { id: client.id, parentId: other.id })).status,
    ).toBe(400)
    expect(
      (await api.fail('collections.update', { id: other.id, parentId: other.id })).status,
    ).toBe(400)
    // Deleting the parent lifts the sub-folder to the top level.
    await api.call('collections.delete', { id: client.id })
    const list = await api.call('collections.list', {})
    expect(list.find((c) => c.id === bridal.id)?.parentId).toBeNull()
  })
})

describe('costs per project and stage, and folder totals', () => {
  it('attributes Claude, image generations, renders and exports to the project and stage', async () => {
    const top = await api.call('collections.create', { name: 'Client: Okafor' })
    const sub = await api.call('collections.create', { name: 'Anniversary', parentId: top.id })
    const a = await api.call('pieces.create', { title: 'A', kind: 'ring', collectionId: sub.id })
    const b = await api.call('pieces.create', { title: 'B', kind: 'ring', collectionId: top.id })
    const board = await api.call('boards.forPiece', { pieceId: a.id })
    await api.call('references.save', {
      boardId: board.id,
      items: [{ note: 'one' }, { note: 'two' }],
    })

    const use = (
      pieceId: string,
      meter: 'llm' | 'image',
      usd: number,
      stage?: 'design' | 'cad' | 'render' | null,
    ) =>
      recordUsage(ctx, {
        meter,
        provider: meter === 'llm' ? 'anthropic' : 'acme',
        quantity: 1,
        unit: meter === 'llm' ? 'tokens' : 'image',
        costUsd: usd,
        pieceId,
        ...(stage !== undefined ? { stage } : {}),
      })
    await use(a.id, 'llm', 0.12, 'design')
    await use(a.id, 'image', 0.08) // an image generation is Design work by default
    await use(a.id, 'llm', 0.5, 'cad')
    await use(a.id, 'llm', 0.2, 'render')
    await use(a.id, 'llm', 0.03, null) // a chat about it from Home: no stage
    await use(b.id, 'llm', 1, 'cad')
    // Two Blender takes (one an animation, counted twice) and a STEP export; one given back.
    for (const key of ['render:t1', 'render:t2', 'render:t2#2'])
      await claim(ctx, { allowance: 'render', key, subject: 'render', pieceId: a.id })
    await claim(ctx, { allowance: 'export', key: 'export:x1', subject: 'step', pieceId: a.id })
    await claim(ctx, { allowance: 'render', key: 'render:t3', subject: 'render', pieceId: a.id })
    await settle(ctx, 'render:t3', 'released')

    const { projects, folders } = await api.call('projects.summary', { collectionId: top.id })
    const pa = projects.find((p) => p.pieceId === a.id)!
    expect(pa.design).toMatchObject({ aiUsd: 0.12, imageUsd: 0.08, items: 2 })
    expect(pa.cad).toMatchObject({ aiUsd: 0.5, exportsUsed: 1 })
    expect(pa.render).toMatchObject({ aiUsd: 0.2, rendersUsed: 3 })
    expect(pa.otherUsd).toBe(0.03)
    expect(pa.totalUsd).toBeCloseTo(0.93, 6)
    // The folder's projects include its sub-folder's.
    expect(projects.map((p) => p.pieceId).sort()).toEqual([a.id, b.id].sort())
    const ft = folders.find((f) => f.collectionId === top.id)!
    expect(ft).toMatchObject({ pieceCount: 2, rendersUsed: 3, exportsUsed: 1 })
    expect(ft.totalUsd).toBeCloseTo(1.93, 6)
    const fs = folders.find((f) => f.collectionId === sub.id)!
    expect(fs).toMatchObject({ pieceCount: 1, rendersUsed: 3, exportsUsed: 1 })
    expect(fs.totalUsd).toBeCloseTo(0.93, 6)
    // By id, too.
    const one = await api.call('projects.summary', { pieceIds: [b.id] })
    expect(one.projects).toHaveLength(1)
    expect(one.projects[0]!.cad.aiUsd).toBe(1)
  })
})
