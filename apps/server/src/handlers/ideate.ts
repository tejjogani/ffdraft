import type { Board, CommandParsedInput, Reference } from '@pave/schema'
import { and, asc, count, desc, eq, inArray, max } from 'drizzle-orm'
import { getAssetRow, putAsset } from '../assets/assets'
import { actorRunId, type Ctx } from '../context'
import * as t from '../db/schema'
import { badRequest } from '../errors'
import { createId } from '../ids'
import { ensure, getBoard, getPiece, getReference } from '../lookups'
import { serviceContext } from '../service-context'
import type { HandlerGroup } from './types'

type BoardRow = typeof t.board.$inferSelect
type ReferenceRow = typeof t.reference.$inferSelect
export type NewReference = Omit<
  typeof t.reference.$inferInsert,
  'orgId' | 'id' | 'boardId' | 'position'
>

const COVER_COUNT = 4

export const toReference = (r: ReferenceRow): Reference => ({
  id: r.id,
  boardId: r.boardId,
  type: r.type,
  assetId: r.assetId,
  thumbUrl: r.thumbUrl,
  title: r.title,
  note: r.note,
  source: r.source ?? null,
  rights: r.rights,
  tags: r.tags,
  palette: r.palette,
  generation: r.generation ?? null,
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
    coverAssetIds: imageRefs
      .filter((r) => r.boardId === b.id && r.assetId)
      .slice(0, COVER_COUNT)
      .map((r) => r.assetId!),
    referenceCount: countOf.get(b.id) ?? 0,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  }))
}

const toBoard = async (ctx: Ctx, row: BoardRow) => (await toBoards(ctx, [row]))[0]!

/** Appends references to a board, after its current last item. */
export async function insertReferences(
  ctx: Ctx,
  boardId: string,
  items: NewReference[],
): Promise<Reference[]> {
  const [last] = await ctx.repo.references.select(
    { position: max(t.reference.position) },
    eq(t.reference.boardId, boardId),
  )
  const start = (last?.position ?? 0) + 1
  const rows = await ctx.repo.references.insertMany(
    items.map((item, i) => ({ ...item, id: createId('ref'), boardId, position: start + i })),
  )
  await ctx.repo.boards.update(eq(t.board.id, boardId), { updatedAt: new Date() })
  return rows.map(toReference)
}

type SaveItem = CommandParsedInput<'references.save'>['items'][number]

async function referenceFromItem(ctx: Ctx, item: SaveItem): Promise<NewReference> {
  const text = { title: item.title ?? '', note: item.note ?? '' }
  if (item.result) {
    const r = item.result
    return {
      ...text,
      title: item.title ?? r.title,
      type: 'image',
      thumbUrl: r.thumbUrl,
      source: {
        provider: r.provider,
        url: r.pageUrl ?? r.imageUrl,
        credit: r.credit,
        license: r.license,
      },
      rights: item.rights ?? r.rights,
      width: r.width,
      height: r.height,
    }
  }
  if (item.assetId) {
    const asset = await getAssetRow(ctx, item.assetId)
    return {
      ...text,
      title: item.title ?? asset.name,
      type: asset.kind === 'image' || asset.kind === 'render' ? 'image' : 'link',
      assetId: asset.id,
      source: { provider: 'upload', url: null, credit: null, license: null },
      rights: item.rights ?? 'own',
      width: asset.width,
      height: asset.height,
    }
  }
  if (item.url) {
    return {
      ...text,
      type: 'link',
      source: { provider: 'web', url: item.url, credit: null, license: null },
      rights: item.rights ?? 'viewOnly',
    }
  }
  if (item.note) return { ...text, type: 'note', rights: item.rights ?? 'own' }
  throw badRequest('Each item needs a search result, a URL, an asset id or a note')
}

export const ideate: HandlerGroup<'boards' | 'references'> = {
  'boards.list': async (ctx, input) => {
    const rows = await ctx.repo.boards.many({
      where: input.pieceId ? eq(t.board.pieceId, input.pieceId) : undefined,
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

  'boards.create': async (ctx, input) => {
    await ensure(getPiece, ctx, input.pieceId)
    const row = await ctx.repo.boards.insert({
      id: createId('brd'),
      title: input.title,
      description: input.description ?? '',
      pieceId: input.pieceId ?? null,
    })
    return toBoard(ctx, row)
  },

  'boards.update': async (ctx, { id, ...patch }) => {
    await getBoard(ctx, id)
    await ensure(getPiece, ctx, patch.pieceId)
    const [row] = await ctx.repo.boards.update(eq(t.board.id, id), {
      ...patch,
      updatedAt: new Date(),
    })
    return toBoard(ctx, row!)
  },

  'boards.delete': async (ctx, { id }) => {
    await getBoard(ctx, id)
    await ctx.repo.boards.delete(eq(t.board.id, id))
    return { ok: true }
  },

  'references.search': async (ctx, input) =>
    ctx.services.get('search').search(input, serviceContext(ctx)),

  'references.save': async (ctx, input) => {
    await getBoard(ctx, input.boardId)
    const items = await Promise.all(input.items.map((item) => referenceFromItem(ctx, item)))
    return insertReferences(ctx, input.boardId, items)
  },

  'references.update': async (ctx, { id, ...patch }) => {
    const ref = await getReference(ctx, id)
    const [row] = await ctx.repo.references.update(eq(t.reference.id, id), patch)
    await ctx.repo.boards.update(eq(t.board.id, ref.boardId), { updatedAt: new Date() })
    return toReference(row!)
  },

  'references.remove': async (ctx, { ids }) => {
    await ctx.repo.references.delete(inArray(t.reference.id, ids))
    return { ok: true }
  },

  'references.generate': async (ctx, input) => {
    await getBoard(ctx, input.boardId)
    const refs = input.referenceIds.length
      ? await ctx.repo.references.many({ where: inArray(t.reference.id, input.referenceIds) })
      : []
    const missing = input.referenceIds.filter((id) => !refs.some((r) => r.id === id))
    if (missing.length) throw badRequest(`Unknown references: ${missing.join(', ')}`)
    const viewOnly = refs.filter((r) => r.rights === 'viewOnly')
    if (viewOnly.length)
      throw badRequest(
        `These references are view-only and cannot be sent to a generative model: ${viewOnly.map((r) => r.title || r.id).join(', ')}`,
      )

    const { boardId, referenceIds, ...request } = input
    const result = await ctx.services
      .get('imageGen')
      .generate({ ...request, references: refs.map(toReference) }, serviceContext(ctx))
    const items: NewReference[] = []
    for (const [i, image] of result.images.entries()) {
      const asset = await putAsset(ctx, { ...image, kind: 'image' })
      items.push({
        type: 'generated',
        assetId: asset.id,
        title: `${input.prompt.slice(0, 80)} (${i + 1})`,
        source: { provider: result.model, url: null, credit: null, license: null },
        rights: 'own',
        generation: {
          prompt: input.prompt,
          model: result.model,
          parentIds: referenceIds,
          runId: actorRunId(ctx.actor),
        },
        width: asset.width,
        height: asset.height,
      })
    }
    return insertReferences(ctx, boardId, items)
  },
}
