import type {
  Board,
  CommandParsedInput,
  GenerationInput,
  Reference,
  SearchResult,
} from '@pave/schema'
import { and, asc, count, desc, eq, inArray, isNull, max, ne, or, type SQL, sql } from 'drizzle-orm'
import { getAssetRow, putAsset } from '../assets/assets'
import { actorRunId, type Ctx, publish } from '../context'
import * as t from '../db/schema'
import { badRequest, conflict, forbidden, NotConfiguredError, notFound } from '../errors'
import { designBoardFor } from '../ideas'
import { createId } from '../ids'
import { attestBrief, boardBriefs, estimate, generate, writeBrief } from '../imagegen/pipeline'
import { ensure, ensureAll, getBoard, getPiece, getReference } from '../lookups'
import { ensurePinBoard, pinBoardOf } from '../references/pins'
import { serviceContext } from '../service-context'
import { assertBudget } from '../usage'
import { toPieceSummary } from './pieces'
import type { HandlerGroup } from './types'

type BoardRow = typeof t.board.$inferSelect
type ReferenceRow = typeof t.reference.$inferSelect
type AssetRow = typeof t.asset.$inferSelect
export type NewReference = Omit<
  typeof t.reference.$inferInsert,
  'orgId' | 'id' | 'boardId' | 'position'
>

const COVER_COUNT = 4
/** How far lineage walks, and how many related items it returns, so a deep graph stays cheap. */
const LINEAGE_DEPTH = 8
const LINEAGE_MAX = 200
/** References considered by `references.similar`. */
const SIMILAR_POOL = 500

export const toReference = (r: ReferenceRow): Reference => ({
  id: r.id,
  boardId: r.boardId,
  type: r.type,
  assetId: r.assetId,
  thumbUrl: r.thumbUrl,
  title: r.title,
  note: r.note,
  // Rows written before these fields existed lack them.
  source: r.source
    ? {
        ...r.source,
        licenseUrl: r.source.licenseUrl ?? null,
        capturedAt: r.source.capturedAt ?? null,
      }
    : null,
  ...(r.importedFrom ? { importedFrom: r.importedFrom } : {}),
  rights: r.rights,
  tags: r.tags,
  palette: r.palette,
  generation: r.generation
    ? { ...r.generation, seed: r.generation.seed ?? null, inputs: r.generation.inputs ?? [] }
    : null,
  pieceId: r.pieceId,
  canvas: r.canvas ?? null,
  plane: r.plane ?? null,
  width: r.width,
  height: r.height,
  position: r.position,
  createdAt: r.createdAt.toISOString(),
})

/** Boards with their reference counts and the first few image asset ids as a cover. */
async function toBoards(ctx: Ctx, rows: BoardRow[]): Promise<Board[]> {
  if (rows.length === 0) return []
  const ids = rows.map((b) => b.id)
  const [counts, imageRefs] = await Promise.all([
    ctx.repo.references
      .select({ boardId: t.reference.boardId, n: count() }, inArray(t.reference.boardId, ids))
      .groupBy(t.reference.boardId),
    ctx.repo.references.many({
      where: and(
        inArray(t.reference.boardId, ids),
        inArray(t.reference.type, ['image', 'generated']),
      ),
      orderBy: asc(t.reference.position),
    }),
  ])
  const countOf = new Map(counts.map((c) => [c.boardId, c.n]))
  return rows.map((b) => ({
    id: b.id,
    title: b.title,
    icon: b.icon,
    description: b.description,
    pieceId: b.pieceId,
    pinsFor: b.pinsFor,
    coverAssetIds: imageRefs
      .filter((r) => r.boardId === b.id && r.assetId)
      .slice(0, COVER_COUNT)
      .map((r) => r.assetId!),
    referenceCount: countOf.get(b.id) ?? 0,
    imageProvider: b.imageProvider ?? null,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  }))
}

const toBoard = async (ctx: Ctx, row: BoardRow) => (await toBoards(ctx, [row]))[0]!

/** Marks boards as changed: bumps `updatedAt` and tells open clients. */
async function touchBoards(ctx: Ctx, boardIds: Iterable<string>, notify = true) {
  for (const boardId of new Set(boardIds)) {
    await ctx.repo.boards.update(eq(t.board.id, boardId), { updatedAt: new Date() })
    if (notify) publish(ctx, { type: 'board.updated', boardId })
  }
}

async function nextPosition(ctx: Ctx, boardId: string): Promise<number> {
  const [last] = await ctx.repo.references.select(
    { position: max(t.reference.position) },
    eq(t.reference.boardId, boardId),
  )
  return (last?.position ?? 0) + 1
}

/** Appends references to a board, after its current last item. */
export async function insertReferences(
  ctx: Ctx,
  boardId: string,
  items: NewReference[],
  notify = true,
): Promise<Reference[]> {
  const start = await nextPosition(ctx, boardId)
  const rows = await ctx.repo.references.insertMany(
    items.map((item, i) => ({ ...item, id: createId('ref'), boardId, position: start + i })),
  )
  await touchBoards(ctx, [boardId], notify)
  return rows.map(toReference)
}

type SaveItem = CommandParsedInput<'references.save'>['items'][number]
type Source = NonNullable<Reference['source']>

const source = (s: Pick<Source, 'provider' | 'url'> & Partial<Source>): Source => ({
  credit: null,
  license: null,
  licenseUrl: null,
  capturedAt: null,
  ...s,
})

/**
 * The trusted version of a search result: re-read from its provider (rights, URLs and `mayStore`
 * come from there). Without search providers it cannot be verified, so it is kept as a link.
 */
async function trustedResult(ctx: Ctx, r: SearchResult): Promise<SearchResult> {
  const search = ctx.services.optional('search')
  if (!search) return { ...r, rights: 'viewOnly', mayStore: false }
  let trusted: SearchResult | null
  try {
    trusted = await search.resolve({ provider: r.provider, key: r.key }, serviceContext(ctx))
  } catch {
    // The provider is down or slow: nothing is saved on trust, so the person tries again later.
    throw conflict(`Couldn’t check “${r.title}” with ${r.provider} just now; try again`)
  }
  if (!trusted) throw badRequest(`“${r.title}” is no longer available from ${r.provider}`)
  return trusted
}

/** Stores the pixels at `url` when a capture service is available; otherwise null. */
async function capturePixels(ctx: Ctx, url: string) {
  const capture = ctx.services.optional('capture')
  if (!capture) return null
  const { file, sourceUrl } = await capture.capture(url, serviceContext(ctx))
  return putAsset(ctx, { ...file, kind: 'image', capturedFrom: sourceUrl })
}

/**
 * A reference to pixels the server fetched from the web keeps the rights they were fetched
 * under, whoever saves it: those of the references showing the asset (the most restrictive),
 * or view-only once none is left. So a captured view-only page cannot come back as `own`.
 */
async function capturedAsset(
  ctx: Ctx,
  asset: AssetRow,
  item: SaveItem,
  text: { title: string; note: string; pieceId: string | null },
): Promise<NewReference> {
  const showing = await ctx.repo.references.many({ where: eq(t.reference.assetId, asset.id) })
  const from =
    showing.find((r) => r.rights === 'viewOnly') ??
    showing.find((r) => r.rights !== 'own') ??
    showing[0]
  const rights = item.rights === 'viewOnly' || !from ? 'viewOnly' : from.rights
  return {
    ...text,
    title: item.title ?? from?.title ?? asset.name,
    type: 'image',
    assetId: asset.id,
    thumbUrl: from?.thumbUrl ?? null,
    source:
      from?.source ??
      source({
        provider: 'web',
        url: asset.capturedFrom,
        capturedAt: asset.createdAt.toISOString(),
      }),
    rights,
    width: asset.width,
    height: asset.height,
  }
}

async function referenceFromItem(ctx: Ctx, item: SaveItem): Promise<NewReference> {
  await ensure(getPiece, ctx, item.pieceId)
  const text = { title: item.title ?? '', note: item.note ?? '', pieceId: item.pieceId ?? null }
  if (item.result) {
    const r = await trustedResult(ctx, item.result)
    const asset = r.mayStore ? await capturePixels(ctx, r.imageUrl) : null
    return {
      ...text,
      title: item.title ?? r.title,
      type: 'image',
      thumbUrl: r.thumbUrl,
      assetId: asset?.id ?? null,
      source: source({
        provider: r.provider,
        url: r.pageUrl ?? r.imageUrl,
        credit: r.credit,
        license: r.license,
        licenseUrl: r.licenseUrl ?? null,
        capturedAt: asset ? asset.createdAt : null,
      }),
      // A client may lower rights to view-only, never raise them.
      rights: item.rights === 'viewOnly' ? 'viewOnly' : r.rights,
      width: asset?.width ?? r.width,
      height: asset?.height ?? r.height,
    }
  }
  if (item.assetId) {
    const asset = await getAssetRow(ctx, item.assetId)
    if (asset.capturedFrom !== null) return capturedAsset(ctx, asset, item, text)
    return {
      ...text,
      title: item.title ?? asset.name,
      // A 3D file is kept as a model the board shows in a small viewer; other files as links.
      type:
        asset.kind === 'image' || asset.kind === 'render'
          ? 'image'
          : asset.kind === 'mesh'
            ? 'model'
            : 'link',
      assetId: asset.id,
      source: source({ provider: 'upload', url: null, capturedAt: asset.createdAt.toISOString() }),
      rights: item.rights ?? 'own',
      width: asset.width,
      height: asset.height,
    }
  }
  if (item.url) {
    // A pasted page is inspiration until someone attests otherwise (references.update).
    return {
      ...text,
      type: 'link',
      source: source({ provider: 'web', url: item.url }),
      rights: 'viewOnly',
    }
  }
  if (item.swatch) {
    const hex = item.swatch.hex.toUpperCase()
    return { ...text, title: item.title ?? hex, type: 'swatch', palette: [hex], rights: 'own' }
  }
  if (item.note) return { ...text, type: 'note', rights: item.rights ?? 'own' }
  throw badRequest('Each item needs a search result, a URL, an asset id, a swatch or a note')
}

type PinItem = CommandParsedInput<'references.pin'>['items'][number]

/** A reference from one of the org's boards, copied onto the pin board with its provenance. */
async function copiedReference(ctx: Ctx, item: PinItem): Promise<NewReference> {
  const from = await getReference(ctx, item.referenceId!)
  return {
    type: from.type,
    assetId: from.assetId,
    thumbUrl: from.thumbUrl,
    title: item.title ?? from.title,
    note: item.note ?? from.note,
    source: from.source,
    // A copy may be lowered to view-only, never raised.
    rights: item.rights === 'viewOnly' ? 'viewOnly' : from.rights,
    tags: from.tags,
    palette: from.palette,
    generation: from.generation,
    pieceId: from.pieceId,
    width: from.width,
    height: from.height,
  }
}

/**
 * The pin already on the board for the same thing, so pinning twice (or a retry) adds nothing:
 * the same provider item, the same stored picture, or the same web address.
 */
function samePin(
  existing: ReferenceRow[],
  key: { provider?: string; url?: string | null; assetId?: string | null },
): ReferenceRow | undefined {
  return existing.find((r) =>
    key.assetId
      ? r.assetId === key.assetId
      : !!key.url && r.source?.url === key.url && r.source?.provider === key.provider,
  )
}

/** What identifies a pin item before anything is fetched or copied. */
async function pinKey(ctx: Ctx, item: PinItem) {
  if (item.result)
    return { provider: item.result.provider, url: item.result.pageUrl ?? item.result.imageUrl }
  if (item.url) return { provider: 'web', url: item.url }
  if (item.assetId) return { assetId: item.assetId }
  const from = await getReference(ctx, item.referenceId!)
  return from.assetId
    ? { assetId: from.assetId }
    : { provider: from.source?.provider, url: from.source?.url ?? null }
}

const containsId = (column: SQL, ids: readonly string[]) =>
  or(...ids.map((id) => sql`${column} @> ${JSON.stringify([id])}::jsonb`))!

const words = (s: string) => new Set(s.toLowerCase().match(/\p{L}{3,}/gu) ?? [])

const rgb = (hex: string) => {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const
}
const near = (a: string, b: string) => {
  const [x, y] = [rgb(a), rgb(b)]
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 48
}

/** Keyless similarity: shared tags count most, then close palette colours and shared words. */
function overlap(query: { text: string; tags: string[]; palette: string[] }, r: Reference): number {
  const tags = new Set(r.tags.map((x) => x.toLowerCase()))
  const own = words(`${r.title} ${r.note} ${r.tags.join(' ')}`)
  let score = 0
  for (const tag of query.tags) if (tags.has(tag.toLowerCase())) score += 3
  for (const c of query.palette) if (r.palette.some((p) => near(c, p))) score += 1
  for (const w of words(query.text)) if (own.has(w)) score += 1
  return score
}

const describeForEmbedding = (r: Reference) =>
  [r.title, r.note, r.tags.join(', '), r.palette.join(' ')].filter(Boolean).join('\n')

const cosine = (a: number[], b: number[]) => {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! ** 2
    nb += b[i]! ** 2
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

export const ideate: HandlerGroup<'boards' | 'references'> = {
  'boards.list': async (ctx, input) => {
    // A piece's pin board belongs to its reference panel, not among the moodboards.
    const rows = await ctx.repo.boards.many({
      where: and(
        isNull(t.board.pinsFor),
        input.scope === 'library' ? isNull(t.board.pieceId) : undefined,
        input.pieceId ? eq(t.board.pieceId, input.pieceId) : undefined,
      ),
      orderBy: desc(t.board.updatedAt),
    })
    return toBoards(ctx, rows)
  },

  'boards.get': async (ctx, { id }) => {
    const board = await getBoard(ctx, id)
    const refs = await ctx.repo.references.many({
      where: eq(t.reference.boardId, id),
      orderBy: asc(t.reference.position),
    })
    return { board: await toBoard(ctx, board), references: refs.map(toReference) }
  },

  'boards.forPiece': async (ctx, { pieceId }) => toBoard(ctx, await designBoardFor(ctx, pieceId)),

  'boards.create': async (ctx, input) => {
    await ensure(getPiece, ctx, input.pieceId)
    const row = await ctx.repo.boards.insert({
      id: createId('brd'),
      title: input.title,
      description: input.description ?? '',
      pieceId: input.pieceId ?? null,
    })
    publish(ctx, { type: 'board.updated', boardId: row.id })
    return toBoard(ctx, row)
  },

  'boards.update': async (ctx, { id, ...patch }) => {
    await getBoard(ctx, id)
    await ensure(getPiece, ctx, patch.pieceId)
    const [row] = await ctx.repo.boards.update(eq(t.board.id, id), {
      ...patch,
      updatedAt: new Date(),
    })
    publish(ctx, { type: 'board.updated', boardId: id })
    return toBoard(ctx, row!)
  },

  'boards.importMoodboard': async (ctx, { sourceBoardId, pieceId, targetBoardId }) => {
    const { board, added } = await ctx.repo.transaction(async (repo) => {
      const tx = { ...ctx, repo }
      // Serialize imports and first saves for this project, even when it has no board yet.
      const [piece] = await repo.pieces
        .select({ id: t.piece.id }, eq(t.piece.id, pieceId))
        .for('update')
      if (!piece) throw notFound('Project', pieceId)
      const [source] = await repo.boards
        .select(
          { id: t.board.id },
          and(eq(t.board.id, sourceBoardId), isNull(t.board.pieceId), isNull(t.board.pinsFor)),
        )
        .for('share')
      if (!source) throw notFound('Moodboard', sourceBoardId)
      const selected = targetBoardId ? await getBoard(tx, targetBoardId) : null
      if (selected && (selected.pieceId !== pieceId || selected.pinsFor))
        throw notFound('Project design board', selected.id)
      const items = await repo.references.many({
        where: eq(t.reference.boardId, source.id),
        orderBy: [asc(t.reference.position), asc(t.reference.id)],
      })
      if (!items.length) throw badRequest('This moodboard has no references to import.')

      const target = selected ?? (await designBoardFor(tx, pieceId, false))
      const existing = await repo.references.select(
        { importedFrom: t.reference.importedFrom },
        eq(t.reference.boardId, target.id),
      )
      const copied = new Set(
        existing
          .filter((r) => r.importedFrom?.sourceBoardId === source.id)
          .map((r) => r.importedFrom!.sourceReferenceId),
      )
      const remaining = items.filter((r) => !copied.has(r.id))
      if (remaining.length) {
        await insertReferences(
          tx,
          target.id,
          remaining.map((r) => ({
            type: r.type,
            assetId: r.assetId,
            thumbUrl: r.thumbUrl,
            title: r.title,
            note: r.note,
            source: r.source,
            importedFrom: { sourceBoardId: source.id, sourceReferenceId: r.id },
            rights: r.rights,
            tags: r.tags,
            palette: r.palette,
            generation: r.generation,
            pieceId: r.pieceId,
            width: r.width,
            height: r.height,
          })),
          false,
        )
      }
      return { board: await toBoard(tx, await getBoard(tx, target.id)), added: remaining.length }
    })
    if (added) publish(ctx, { type: 'board.updated', boardId: board.id })
    return { board, added }
  },

  'boards.delete': async (ctx, { id }) => {
    await getBoard(ctx, id)
    await ctx.repo.boards.delete(eq(t.board.id, id))
    publish(ctx, { type: 'board.updated', boardId: id })
    return { ok: true }
  },

  'references.search': async (ctx, input) =>
    ctx.services.get('search').search(input, serviceContext(ctx)),

  'references.save': async (ctx, input) => {
    await getBoard(ctx, input.boardId)
    const items = await Promise.all(input.items.map((item) => referenceFromItem(ctx, item)))
    return insertReferences(ctx, input.boardId, items)
  },

  'references.saveForPiece': async (ctx, input) => {
    await getPiece(ctx, input.pieceId)
    const items = await Promise.all(input.items.map((item) => referenceFromItem(ctx, item)))
    const saved = await ctx.repo.transaction(async (repo) => {
      // First saves must agree even if a previously unlinked board holds the default board id.
      await repo.pieces.select({ id: t.piece.id }, eq(t.piece.id, input.pieceId)).for('update')
      const tx = { ...ctx, repo }
      const board = await designBoardFor(tx, input.pieceId, false)
      return insertReferences(tx, board.id, items, false)
    })
    publish(ctx, { type: 'board.updated', boardId: saved[0]!.boardId })
    return saved
  },

  'references.pins': async (ctx, { pieceId }) => {
    await getPiece(ctx, pieceId)
    const board = await pinBoardOf(ctx, pieceId)
    if (!board) return { boardId: null, references: [] }
    const rows = await ctx.repo.references.many({
      where: eq(t.reference.boardId, board.id),
      orderBy: asc(t.reference.position),
    })
    return { boardId: board.id, references: rows.map(toReference) }
  },

  'references.pin': async (ctx, { pieceId, items }) => {
    const piece = await getPiece(ctx, pieceId)
    const board = await ensurePinBoard(ctx, piece)
    const existing = await ctx.repo.references.many({ where: eq(t.reference.boardId, board.id) })
    // Each new item is checked (a search result re-read from its provider) before anything is
    // written, so a refused item leaves the board as it was.
    const order = await Promise.all(
      items.map(async (item) => {
        const same = samePin(existing, await pinKey(ctx, item))
        if (same) return same
        return item.referenceId
          ? copiedReference(ctx, item)
          : referenceFromItem(ctx, {
              ...(item.result ? { result: item.result } : {}),
              ...(item.url ? { url: item.url } : {}),
              ...(item.assetId ? { assetId: item.assetId } : {}),
              ...(item.title !== undefined ? { title: item.title } : {}),
              ...(item.note !== undefined ? { note: item.note } : {}),
              ...(item.rights ? { rights: item.rights } : {}),
            })
      }),
    )
    const isRow = (o: ReferenceRow | NewReference): o is ReferenceRow => 'id' in o
    const fresh = order.filter((o): o is NewReference => !isRow(o))
    const inserted = fresh.length ? await insertReferences(ctx, board.id, fresh) : []
    return order.map((o) => (isRow(o) ? toReference(o) : inserted[fresh.indexOf(o)]!))
  },

  'references.place': async (ctx, { id, plane }) => {
    const ref = await getReference(ctx, id)
    if (plane) {
      const board = await getBoard(ctx, ref.boardId)
      if (!board.pinsFor) throw conflict('Pin the picture to the piece before laying it in a view')
      if (!ref.assetId)
        throw conflict('Only a picture can be laid in a view; capture the link’s image first')
    }
    const [row] = await ctx.repo.references.update(eq(t.reference.id, id), { plane })
    await touchBoards(ctx, [ref.boardId])
    return toReference(row!)
  },

  'references.update': async (ctx, { id, attestation, ...patch }) => {
    const ref = await getReference(ctx, id)
    if (ref.rights === 'viewOnly' && patch.rights && patch.rights !== 'viewOnly') {
      if (ctx.actor.type !== 'user')
        throw forbidden('Only a person can lift the view-only restriction on a reference')
      if (!attestation)
        throw badRequest('Confirm you may use this item beyond inspiration (attestation: true)')
    }
    const moving = patch.boardId !== undefined && patch.boardId !== ref.boardId
    if (moving) await getBoard(ctx, patch.boardId!)
    const [row] = await ctx.repo.references.update(eq(t.reference.id, id), {
      ...patch,
      ...(moving && patch.position === undefined
        ? { position: await nextPosition(ctx, patch.boardId!) }
        : {}),
    })
    await touchBoards(ctx, [ref.boardId, row!.boardId])
    return toReference(row!)
  },

  'references.arrange': async (ctx, { boardId, items }) => {
    await getBoard(ctx, boardId)
    const ids = items.map((i) => i.id)
    await ensureAll(
      ids,
      (ids) =>
        ctx.repo.references.many({
          where: and(eq(t.reference.boardId, boardId), inArray(t.reference.id, ids)),
        }),
      'Reference on this board',
    )
    await ctx.repo.transaction(async (tx) => {
      for (const { id, ...set } of items)
        if (set.position !== undefined || set.canvas !== undefined)
          await tx.references.update(eq(t.reference.id, id), set)
    })
    await touchBoards(ctx, [boardId])
    const rows = await ctx.repo.references.many({
      where: inArray(t.reference.id, ids),
      orderBy: asc(t.reference.position),
    })
    return rows.map(toReference)
  },

  // Inside an assistant run the loop reads on the run's own client; this is everyone else's way.
  'references.read': async (ctx, input) => {
    const assistant = ctx.services.require('assistant')
    if (!assistant.readPhotos)
      throw new NotConfiguredError('assistant', 'This server cannot read photos.')
    return assistant.readPhotos(input, serviceContext(ctx))
  },

  'references.capture': async (ctx, { id }) => {
    const ref = await getReference(ctx, id)
    const url = ref.source?.url
    if (!url) throw conflict('This reference has no web address to capture an image from')
    const capture = ctx.services.require('capture')
    const { file, sourceUrl } = await capture.capture(url, serviceContext(ctx))
    const asset = await putAsset(ctx, { ...file, kind: 'image', capturedFrom: sourceUrl })
    // The pixels are stored for display; the rights are unchanged (a page stays view-only).
    const [row] = await ctx.repo.references.update(eq(t.reference.id, id), {
      assetId: asset.id,
      width: asset.width,
      height: asset.height,
      source: source({ ...ref.source!, capturedAt: asset.createdAt }),
    })
    await touchBoards(ctx, [ref.boardId])
    return toReference(row!)
  },

  'references.lineage': async (ctx, { id }) => {
    const root = toReference(await getReference(ctx, id))

    const ancestors: {
      id: string
      reference: Reference | null
      credit: GenerationInput | null
      depth: number
    }[] = []
    const seen = new Set([root.id])
    let level: { parentId: string; credit: GenerationInput | null }[] = (
      root.generation?.parentIds ?? []
    ).map((parentId) => ({
      parentId,
      credit: root.generation?.inputs.find((i) => i.id === parentId) ?? null,
    }))
    for (
      let depth = 1;
      level.length && depth <= LINEAGE_DEPTH && ancestors.length < LINEAGE_MAX;
      depth++
    ) {
      const fresh = level.filter((l) => !seen.has(l.parentId))
      for (const l of fresh) seen.add(l.parentId)
      const rows = fresh.length
        ? await ctx.repo.references.many({
            where: inArray(
              t.reference.id,
              fresh.map((l) => l.parentId),
            ),
          })
        : []
      const next: typeof level = []
      for (const l of fresh) {
        const row = rows.find((r) => r.id === l.parentId)
        const reference = row ? toReference(row) : null
        ancestors.push({ id: l.parentId, reference, credit: l.credit, depth })
        for (const parentId of reference?.generation?.parentIds ?? [])
          next.push({
            parentId,
            credit: reference?.generation?.inputs.find((i) => i.id === parentId) ?? null,
          })
      }
      level = next
    }

    const descendants: Reference[] = []
    let frontier = [root.id]
    for (
      let depth = 1;
      frontier.length && depth <= LINEAGE_DEPTH && descendants.length < LINEAGE_MAX;
      depth++
    ) {
      const rows = await ctx.repo.references.many({
        where: containsId(sql`${t.reference.generation} -> 'parentIds'`, frontier),
        orderBy: asc(t.reference.createdAt),
      })
      const fresh = rows.filter((r) => !seen.has(r.id))
      for (const r of fresh) seen.add(r.id)
      descendants.push(...fresh.map(toReference))
      frontier = fresh.map((r) => r.id)
    }

    const family = [root.id, ...descendants.map((d) => d.id)].slice(0, LINEAGE_MAX)
    const pieces = await ctx.repo.pieces.many({
      where: containsId(sql`${t.piece.origin} -> 'referenceIds'`, family),
      orderBy: desc(t.piece.updatedAt),
      limit: LINEAGE_MAX,
    })
    return {
      ancestors,
      descendants: descendants.slice(0, LINEAGE_MAX),
      pieces: pieces.map(toPieceSummary),
    }
  },

  'references.similar': async (ctx, input) => {
    const subject = input.id ? toReference(await getReference(ctx, input.id)) : null
    await ensure(getBoard, ctx, input.boardId)
    const pool = (
      await ctx.repo.references.many({
        where: and(
          input.boardId ? eq(t.reference.boardId, input.boardId) : undefined,
          subject ? ne(t.reference.id, subject.id) : undefined,
        ),
        orderBy: desc(t.reference.createdAt),
        limit: SIMILAR_POOL,
      })
    ).map(toReference)
    if (pool.length === 0) return []
    const query = {
      text: [input.text, subject && describeForEmbedding(subject)].filter(Boolean).join('\n'),
      tags: subject?.tags ?? [],
      palette: subject?.palette ?? [],
    }

    const embedding = ctx.services.optional('embedding')
    if (embedding) {
      const [q, ...vectors] = await embedding.embed(
        [{ text: query.text }, ...pool.map((r) => ({ text: describeForEmbedding(r) }))],
        serviceContext(ctx),
      )
      return pool
        .map((r, i) => ({ r, score: cosine(q!, vectors[i]!) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, input.limit)
        .map((x) => x.r)
    }
    return pool
      .map((r) => ({ r, score: overlap(query, r) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, input.limit)
      .map((x) => x.r)
  },

  'references.remove': async (ctx, { ids }) => {
    const removed = await ctx.repo.references.delete(inArray(t.reference.id, ids))
    if (removed.length)
      await touchBoards(
        ctx,
        removed.map((r) => r.boardId),
      )
    return { ok: true }
  },

  'references.estimate': (ctx, input) => estimate(ctx, input),
  'references.brief': (ctx, input) => writeBrief(ctx, input),
  'references.attestBrief': (ctx, input) => attestBrief(ctx, input),
  'references.briefs': (ctx, { boardId, limit }) => boardBriefs(ctx, boardId, limit),
  'references.generate': (ctx, input) => generate(ctx, input),
}
