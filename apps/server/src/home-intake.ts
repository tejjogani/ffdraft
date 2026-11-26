import { createHash } from 'node:crypto'
import { type CommandParsedInput, chainFromBrief, emptyDesign, type PieceKind } from '@pave/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { type Ctx, publish } from './context'
import * as t from './db/schema'
import { forbidden, notFound } from './errors'
import { insertReferences, referenceFromItem, toReference } from './handlers/ideate'
import { designBoardFor } from './ideas'

function kindFromBrief(brief: string): PieceKind {
  if (/\b(pendants?|medallions?|charms?)\b/i.test(brief)) return 'pendant'
  if (/\b(earrings?|studs?)\b/i.test(brief)) return 'earrings'
  if (/\bbracelets?\b/i.test(brief)) return 'bracelet'
  if (/\b(necklaces?|chains?)\b/i.test(brief)) return 'chain'
  if (/\b(rings?|signets?|bands?)\b/i.test(brief)) return 'ring'
  return 'other'
}

function initialDetails(kind: PieceKind, brief: string) {
  const chain = kind === 'pendant' ? chainFromBrief(brief) : null
  return chain ? { chain } : {}
}

export async function startIntake(
  ctx: Ctx,
  { requestId, brief, assetIds }: CommandParsedInput<'pieces.startIntake'>,
) {
  const pieceId = `pc_${createHash('sha256')
    .update(JSON.stringify([ctx.orgId, ctx.user.id, requestId]))
    .digest('hex')
    .slice(0, 24)}`
  const ids = [...new Set(assetIds)]
  const kind = kindFromBrief(brief)
  const board = await ctx.repo.transaction(async (repo) => {
    const tx = { ...ctx, repo }
    const created = await repo.pieces.insertIfAbsent({
      id: pieceId,
      createdBy: ctx.user.id,
      title: brief.split(/\r?\n/, 1)[0]!.slice(0, 80),
      kind,
      stage: 'idea',
      brief,
      design: emptyDesign(kind),
      intake: { details: initialDetails(kind, brief), selection: null },
      origin: ids.length
        ? { kind: 'image', sourceAssetIds: ids, referenceIds: [], flags: [], attestation: null }
        : { kind: 'text', sourceAssetIds: [], referenceIds: [], flags: [], attestation: null },
    })
    const board = await designBoardFor(tx, pieceId, false)
    if (created && ids.length) {
      const items = await Promise.all(ids.map((assetId) => referenceFromItem(tx, { assetId })))
      await insertReferences(tx, board.id, items, false)
    }
    return board
  })
  publish(ctx, { type: 'piece.updated', pieceId })
  publish(ctx, { type: 'board.updated', boardId: board.id })
  return { pieceId, boardId: board.id }
}

export async function addIntakeAssets(
  ctx: Ctx,
  { pieceId, boardId, assetIds }: CommandParsedInput<'pieces.addIntakeAssets'>,
) {
  const refs = await ctx.repo.transaction(async (repo) => {
    const tx = { ...ctx, repo }
    // Serialize additions to the same board before reading its assets, including retries in another tab.
    const [board] = await repo.boards
      .select(
        { id: t.board.id },
        and(eq(t.board.id, boardId), eq(t.board.pieceId, pieceId), isNull(t.board.pinsFor)),
      )
      .for('update')
    if (!board) throw notFound('Design board', boardId)
    const ids = [...new Set(assetIds)]
    const existing = await repo.references.many({
      where: and(eq(t.reference.boardId, boardId), inArray(t.reference.assetId, ids)),
    })
    const seen = new Set(existing.map((r) => r.assetId))
    const added = await Promise.all(
      ids.filter((id) => !seen.has(id)).map((assetId) => referenceFromItem(tx, { assetId })),
    )
    return [
      ...existing.map(toReference),
      ...(added.length ? await insertReferences(tx, boardId, added, false) : []),
    ]
  })
  publish(ctx, { type: 'board.updated', boardId })
  return refs
}

type Confirm = CommandParsedInput<'pieces.confirmIntake'>

/** User-operated confirmation. The quick-reply loop calls the save directly for a recorded approval. */
export async function confirmIntake(ctx: Ctx, input: Confirm) {
  if (ctx.actor.type !== 'user') throw forbidden('Only the designer can confirm intake decisions')
  return saveIntakeDecisions(ctx, input)
}

export async function saveIntakeDecisions(
  ctx: Ctx,
  { pieceId, boardId, details, selection }: Confirm,
) {
  const intake = await ctx.repo.transaction(async (repo) => {
    const [piece] = await repo.pieces
      .select(
        { intake: t.piece.intake, kind: t.piece.kind, brief: t.piece.brief },
        eq(t.piece.id, pieceId),
      )
      .for('update')
    if (!piece) throw notFound('Piece', pieceId)
    const board = await repo.boards.first(
      and(eq(t.board.id, boardId), eq(t.board.pieceId, pieceId), isNull(t.board.pinsFor)),
    )
    if (!board) throw notFound('Design board', boardId)
    let chosen = piece.intake?.selection ?? null
    if (selection === null) chosen = null
    if (selection) {
      const ids = [selection.conceptId, ...(selection.visualId ? [selection.visualId] : [])]
      const refs = await repo.references.many({
        where: and(eq(t.reference.boardId, boardId), inArray(t.reference.id, ids)),
      })
      const concept = refs.find((r) => r.id === selection.conceptId)
      if (!concept || (concept.type !== 'generated' && !concept.tags.includes('Design concept')))
        throw notFound('Design concept', selection.conceptId)
      const visual = refs.find((r) => r.id === selection.visualId)
      if (
        selection.visualId &&
        (!visual?.assetId ||
          (visual.type !== 'image' && visual.type !== 'generated') ||
          visual.rights === 'viewOnly')
      )
        throw notFound('Usable design visual', selection.visualId)
      chosen = { ...selection, boardId, visualAssetId: visual?.assetId ?? null }
    }
    const confirmed = {
      ...(piece.intake?.details ?? initialDetails(piece.kind, piece.brief)),
      ...details,
    }
    // A newly confirmed colour without fineness must not keep an unrelated previous alloy.
    if (details?.metalDescription && !details.metal) delete confirmed.metal
    const updated = { details: confirmed, selection: chosen }
    await repo.pieces.update(eq(t.piece.id, pieceId), { intake: updated, updatedAt: new Date() })
    return updated
  })
  publish(ctx, { type: 'piece.updated', pieceId })
  return intake
}
