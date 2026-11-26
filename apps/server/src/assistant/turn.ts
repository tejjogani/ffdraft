/**
 * What a new message carries to the model: the designer's words with their photos (as image
 * blocks), and the context message after it — the open piece, selection, board, references and
 * the edits people made since the assistant's last turn — rendered once and stored, never edited.
 */
import { type ContextPin, canonText, pinLabel, renderContext, type TurnContext } from '@pave/agent'
import { allowanceLine, type CommandParsedInput } from '@pave/schema'
import { and, asc, desc, eq, gt, inArray, isNull, max, ne } from 'drizzle-orm'
import { readAsset } from '../assets/assets'
import type { Ctx } from '../context'
import * as t from '../db/schema'
import { getBoard, getPiece } from '../lookups'
import { planStatus } from '../plans'
import { importedReferences } from '../references/moodboards'
import { pinnedRows } from '../references/pins'
import { viewOnlyAssets } from '../references/rights'
import { serviceContext } from '../service-context'
import { modelImage } from './images'
import { intakeContext } from './intake'

type Send = CommandParsedInput<'threads.send'>
type Piece = Awaited<ReturnType<typeof getPiece>>

/** People's edits listed in one context message at most. */
const MAX_EDITS = 20

/** Pinned pictures sent in one message at most; the rest stay readable by asset id. */
const MAX_PIN_PICTURES = 6

type RunRef = { id: string; threadId: string; pieceId: string | null }
type PinRow = Awaited<ReturnType<typeof pinnedRows>>[number]

/** What a message carries besides its text, for the context message to describe. */
export interface TurnMedia {
  /** Attachments in a format Claude cannot read. */
  skipped: string[]
  /** Attachments that are view-only references: never sent. */
  withheld: string[]
  /** The open piece's pins, and what the model can see of each. */
  pins: ContextPin[]
  moodboard?: NonNullable<TurnContext['moodboard']> & { board: NonNullable<TurnContext['board']> }
}

/**
 * The open piece's pins and which pictures go with this message: those pinned since the
 * thread's previous message about the piece (all of them on the first), never a view-only one.
 */
async function pinsForTurn(
  ctx: Ctx,
  run: RunRef,
): Promise<{ rows: PinRow[]; send: PinRow[]; earlier: Set<string>; blocked: Set<string> }> {
  const none = { rows: [], send: [], earlier: new Set<string>(), blocked: new Set<string>() }
  if (!run.pieceId) return none
  const rows = await pinnedRows(ctx, run.pieceId)
  if (!rows.length) return none
  const blocked = await viewOnlyAssets(
    ctx,
    rows.flatMap((r) => (r.assetId ? [r.assetId] : [])),
  )
  for (const r of rows) if (r.rights === 'viewOnly' && r.assetId) blocked.add(r.assetId)
  const prev = await ctx.repo.runs.first(
    and(
      eq(t.agentRun.threadId, run.threadId),
      eq(t.agentRun.pieceId, run.pieceId),
      ne(t.agentRun.id, run.id),
    )!,
    desc(t.agentRun.startedAt),
  )
  const sendable = rows.filter(
    (r) => r.assetId && r.rights !== 'viewOnly' && !blocked.has(r.assetId),
  )
  const fresh = sendable.filter((r) => !prev || r.createdAt > prev.startedAt)
  return {
    rows,
    send: fresh.slice(0, MAX_PIN_PICTURES),
    earlier: new Set(sendable.filter((r) => !fresh.includes(r)).map((r) => r.id)),
    blocked,
  }
}

/** Resolve an explicit board only within this project. A stale selection falls back to its design board. */
async function activeDesignBoard(ctx: Ctx, pieceId: string, boardId: string | undefined) {
  const owned = and(eq(t.board.pieceId, pieceId), isNull(t.board.pinsFor))!
  const selected = boardId
    ? await ctx.repo.boards.first(and(owned, eq(t.board.id, boardId))!)
    : null
  return selected ?? (await ctx.repo.boards.first(owned, asc(t.board.createdAt)))
}

async function addMoodboardContext(
  ctx: Ctx,
  input: Send,
  run: RunRef,
  content: Record<string, unknown>[],
  imagesLeft: number,
): Promise<TurnMedia['moodboard']> {
  if (!run.pieceId) return
  const board = await activeDesignBoard(ctx, run.pieceId, input.context.boardId)
  if (!board) return
  const { rows, count } = await importedReferences(ctx, board.id, input.referenceIds)
  if (!count) return
  const assets = rows.flatMap((r) => (r.assetId ? [r.assetId] : []))
  const blocked = await viewOnlyAssets(ctx, assets)
  const attached = new Set(input.attachments)
  const references: NonNullable<TurnContext['moodboard']>['references'] = []
  for (const [i, r] of rows.entries()) {
    const imageAsset = r.type === 'image' || r.type === 'generated' ? r.assetId : null
    const privateImage = r.rights === 'viewOnly' || (imageAsset && blocked.has(imageAsset))
    let picture: ContextPin['picture'] = privateImage
      ? 'viewOnly'
      : imageAsset
        ? 'available'
        : 'none'
    if (imageAsset && !privateImage && !attached.has(imageAsset) && imagesLeft > 0) {
      const { asset, bytes } = await readAsset(ctx, imageAsset)
      const image = await modelImage(bytes, asset.mime)
      if (image) {
        content.push(
          { type: 'text', text: pinLabel(i + 1, r.title, r.id, true) },
          {
            type: 'image',
            source: { type: 'base64', media_type: image.mediaType, data: image.data },
          },
        )
        attached.add(imageAsset)
        imagesLeft--
        picture = 'above'
      }
    }
    references.push({
      id: r.id,
      title: r.title,
      note: r.note,
      url: r.source?.url ?? null,
      provider: r.source?.provider ?? null,
      credit: r.source?.credit ?? null,
      license: r.source?.license ?? null,
      sourceBoardId: r.importedFrom!.sourceBoardId,
      sourceReferenceId: r.importedFrom!.sourceReferenceId,
      assetId: privateImage ? null : imageAsset,
      plane: null,
      picture,
    })
  }
  return { board: { id: board.id, title: board.title }, references, count }
}

/**
 * The user message: pinned pictures first, each after its label, then the designer's photos
 * (as Claude reads best), then the text. View-only pictures are never among them.
 */
export async function userContent(
  ctx: Ctx,
  input: Send,
  run: RunRef,
): Promise<{ content: Record<string, unknown>[]; media: TurnMedia }> {
  const content: Record<string, unknown>[] = []
  const media: TurnMedia = { skipped: [], withheld: [], pins: [] }
  const pins = await pinsForTurn(ctx, run)
  const shown = new Set<string>()
  const attached = new Set(input.attachments)
  for (const r of pins.send) {
    // A selected design can also be pinned for the CAD job. Send the attachment once.
    if (attached.has(r.assetId!)) continue
    const { asset, bytes } = await readAsset(ctx, r.assetId!)
    const image = await modelImage(bytes, asset.mime)
    if (!image) continue
    content.push(
      { type: 'text', text: pinLabel(pins.rows.indexOf(r) + 1, r.title, r.id) },
      { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
    )
    shown.add(r.id)
  }
  media.pins = pins.rows.map((r) => ({
    id: r.id,
    title: r.title,
    provider: r.source?.provider ?? null,
    credit: r.source?.credit ?? null,
    license: r.source?.license ?? null,
    assetId: r.assetId,
    plane: r.plane?.view ?? null,
    picture: !r.assetId
      ? 'none'
      : r.rights === 'viewOnly' || pins.blocked.has(r.assetId)
        ? 'viewOnly'
        : shown.has(r.id)
          ? 'above'
          : pins.earlier.has(r.id)
            ? 'earlier'
            : 'available',
  }))

  const moodboard = await addMoodboardContext(
    ctx,
    input,
    run,
    content,
    MAX_PIN_PICTURES - shown.size,
  )
  if (moodboard) media.moodboard = moodboard
  const blocked = await viewOnlyAssets(ctx, input.attachments)
  for (const id of input.attachments) {
    const { asset, bytes } = await readAsset(ctx, id)
    if (blocked.has(id)) {
      media.withheld.push(asset.name)
      continue
    }
    const image = await modelImage(bytes, asset.mime)
    if (!image) {
      media.skipped.push(`${asset.name} (${asset.mime})`)
      continue
    }
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.data },
    })
  }
  content.push({ type: 'text', text: input.text })
  return { content, media }
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
    // Addressed to the model, "you" would read as the model itself.
    for (const m of await ctx.repo.members())
      names.set(m.user.id, m.user.id === ctx.user.id ? 'the designer' : m.user.name)
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
  run: RunRef,
  media: TurnMedia,
): Promise<string> {
  const piece = run.pieceId ? await getPiece(ctx, run.pieceId) : null
  const board =
    media.moodboard?.board ??
    (input.context.boardId
      ? piece
        ? await ctx.repo.boards.first(
            and(
              eq(t.board.id, input.context.boardId),
              eq(t.board.pieceId, piece.id),
              isNull(t.board.pinsFor),
            )!,
          )
        : await getBoard(ctx, input.context.boardId)
      : null)
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
      return a && !media.withheld.includes(a.name)
        ? [{ assetId: a.id, name: a.name, mime: a.mime }]
        : []
    }),
    references: refs.map((r) => ({
      id: r.id,
      title: r.title,
      viewOnly: r.rights === 'viewOnly',
    })),
    designerEdits: piece ? await designerEdits(ctx, piece.id, run.threadId, run.id) : [],
    canon: piece ? canonText({ spec: piece.spec, design: piece.design }) : null,
    plan: allowanceLine(await planStatus(ctx)),
    images: await imagesLine(ctx),
    pins: media.pins,
    ...(media.moodboard ? { moodboard: media.moodboard } : {}),
  })
  const notes = [
    piece?.intake &&
      Object.keys(piece.intake.details).length &&
      `Confirmed intake decisions: ${JSON.stringify(piece.intake.details)}`,
    media.skipped.length &&
      `Not shown to you (a format you cannot read): ${media.skipped.join(', ')}.`,
    media.withheld.length &&
      `Not shown to you (view-only references; their pictures never are): ${media.withheld.join(', ')}.`,
  ].filter(Boolean)
  return [`${intakeContext(input)}${text}`, ...notes].join('\n')
}

/** One line on whether concept images can be generated here, so a job never promises them. */
async function imagesLine(ctx: Ctx): Promise<string> {
  const imageGen = ctx.services.optional('imageGen')
  if (!imageGen || imageGen.available(ctx.orgId).length === 0)
    return 'not set up (no image provider key); do not offer to generate images, say an owner or admin can add a key in Settings, AI.'
  try {
    const p = await imageGen.price(serviceContext(ctx), null)
    return `available with ${p.provider.label} (${p.model}), about $${p.perImageUsd.toFixed(3)} an image; references.brief first, then references.generate.`
  } catch {
    return 'available; references.brief first, then references.generate.'
  }
}
