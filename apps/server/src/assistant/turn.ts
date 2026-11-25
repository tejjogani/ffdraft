/**
 * What a new message carries to the model: the designer's words with their photos (as image
 * blocks), and the context message after it — the open piece, selection, board, references and
 * the edits people made since the assistant's last turn — rendered once and stored, never edited.
 */
import { canonText, renderContext, type TurnContext } from '@pave/agent'
import { allowanceLine, type CommandParsedInput } from '@pave/schema'
import { and, asc, desc, eq, gt, inArray, isNull, max, ne } from 'drizzle-orm'
import { readAsset } from '../assets/assets'
import type { Ctx } from '../context'
import * as t from '../db/schema'
import { getBoard, getPiece } from '../lookups'
import { planStatus } from '../plans'
import { modelImage } from './images'

type Send = CommandParsedInput<'threads.send'>
type Piece = Awaited<ReturnType<typeof getPiece>>

/** People's edits listed in one context message at most. */
const MAX_EDITS = 20

/** The user message: photos first (as Claude reads best), then the text. */
export async function userContent(
  ctx: Ctx,
  input: Send,
): Promise<{ content: Record<string, unknown>[]; skipped: string[] }> {
  const content: Record<string, unknown>[] = []
  const skipped: string[] = []
  for (const id of input.attachments) {
    const { asset, bytes } = await readAsset(ctx, id)
    const image = await modelImage(bytes, asset.mime)
    if (!image) {
      skipped.push(`${asset.name} (${asset.mime})`)
      continue
    }
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.data },
    })
  }
  content.push({ type: 'text', text: input.text })
  return { content, skipped }
}

/** Selected ids as the studio sends them: a node, or one stone of a row (`nodeId:index`). */
function selection(piece: Piece | null, ids: readonly string[]): TurnContext['selection'] {
  if (!piece) return []
  return ids.flatMap((raw) => {
    const [nodeId, at] = raw.split(':') as [string, string | undefined]
    const node = piece.design.nodes[nodeId] as { kind?: string; name?: string } | undefined
    if (!node) return []
    const instance = at !== undefined && /^\d+$/.test(at) ? Number(at) : undefined
    return [
      {
        nodeId,
        kind: node.kind ?? 'node',
        ...(node.name ? { name: node.name } : {}),
        ...(instance !== undefined ? { instance } : {}),
      },
    ]
  })
}

/**
 * Edits on the piece by anyone but the assistant since the thread's previous run last saw it
 * (the version it was shown, or its own last change). Nothing before the first run.
 */
async function designerEdits(
  ctx: Ctx,
  pieceId: string,
  threadId: string,
  runId: string,
): Promise<TurnContext['designerEdits']> {
  const prev = await ctx.repo.runs.first(
    and(
      eq(t.agentRun.threadId, threadId),
      eq(t.agentRun.pieceId, pieceId),
      ne(t.agentRun.id, runId),
    )!,
    desc(t.agentRun.startedAt),
  )
  if (!prev) return []
  const [own] = await ctx.repo.changes.select(
    { seq: max(t.designChange.seq) },
    and(eq(t.designChange.pieceId, pieceId), eq(t.designChange.runId, prev.id)),
  )
  const since = Math.max(prev.baseSeq ?? 0, own?.seq ?? 0)
  const rows = await ctx.repo.changes.many({
    where: and(
      eq(t.designChange.pieceId, pieceId),
      gt(t.designChange.seq, since),
      isNull(t.designChange.runId),
    ),
    orderBy: asc(t.designChange.seq),
    limit: MAX_EDITS,
  })
  const names = new Map<string, string>()
  if (rows.some((r) => r.actorUserId)) {
    for (const m of await ctx.repo.members())
      names.set(m.user.id, m.user.id === ctx.user.id ? 'you' : m.user.name)
  }
  return rows.map((r) => ({
    seq: r.seq,
    label: r.label,
    by: r.actorUserId ? (names.get(r.actorUserId) ?? 'a teammate') : 'Pavé',
  }))
}

export async function contextText(
  ctx: Ctx,
  input: Send,
  run: { id: string; threadId: string; pieceId: string | null },
  skipped: readonly string[],
): Promise<string> {
  const piece = run.pieceId ? await getPiece(ctx, run.pieceId) : null
  const board = input.context.boardId ? await getBoard(ctx, input.context.boardId) : null
  const [assets, refs] = await Promise.all([
    input.attachments.length
      ? ctx.repo.assets.many({ where: inArray(t.asset.id, input.attachments) })
      : [],
    input.referenceIds.length
      ? ctx.repo.references.many({ where: inArray(t.reference.id, input.referenceIds) })
      : [],
  ])
  const text = renderContext({
    date: new Date().toISOString().slice(0, 10),
    piece: piece
      ? {
          id: piece.id,
          title: piece.title,
          kind: piece.kind,
          stage: piece.stage,
          version: piece.version,
          archetype: piece.spec?.archetype ?? null,
          nodes: piece.design.order.map((id) => {
            const n = piece.design.nodes[id] as { kind?: string; name?: string } | undefined
            return { id, kind: n?.kind ?? 'node', ...(n?.name ? { name: n.name } : {}) }
          }),
          directions: piece.directions.map((d) => ({
            id: d.id,
            letter: d.letter,
            name: d.name,
            chosen: d.id === piece.chosenDirectionId,
          })),
        }
      : null,
    selection: selection(piece, input.context.selection),
    board: board ? { id: board.id, title: board.title } : null,
    // In the order sent, matching the images in the message.
    attachments: input.attachments.flatMap((id) => {
      const a = assets.find((x) => x.id === id)
      return a ? [{ assetId: a.id, name: a.name, mime: a.mime }] : []
    }),
    references: refs.map((r) => ({
      id: r.id,
      title: r.title,
      viewOnly: r.rights === 'viewOnly',
    })),
    designerEdits: piece ? await designerEdits(ctx, piece.id, run.threadId, run.id) : [],
    canon: piece ? canonText({ spec: piece.spec, design: piece.design }) : null,
    plan: allowanceLine(await planStatus(ctx)),
  })
  return skipped.length
    ? `${text}\nNot shown to you (a format you cannot read): ${skipped.join(', ')}.`
    : text
}
