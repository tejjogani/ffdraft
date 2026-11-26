/**
 * From the design board to CAD. The Design stage is image-based: a piece's design board is the
 * moodboard linked to it (boards live on their own in Ideas too). These are the ways out of it:
 *
 *  - Take to CAD: a picture or sketch is pinned beside the piece's CAD (with its provenance), and
 *    the CAD job reads it, asks for the specs, shows an estimate and builds from it.
 *  - Open as CAD: a 3D file becomes a sculpted body in the design (the kernel's mesh importers).
 *  - Estimate: what a spec would weigh and cost, from the canon's build of it, before building.
 */
import { lintDesign } from '@pave/canon'
import {
  emptyBuildReason,
  newId,
  type Piece,
  type PieceSpec,
  type SpecEstimate,
} from '@pave/schema'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { getAssetRow } from './assets/assets'
import { type Ctx, invoke, publish } from './context'
import * as t from './db/schema'
import { commitChange, FACTS_DETAIL } from './design'
import { designFor, factsOf } from './directions'
import { badRequest, conflict } from './errors'
import { createId } from './ids'
import { getPiece, getReference } from './lookups'
import { serviceContext } from './service-context'

type BoardRow = typeof t.board.$inferSelect

/** The 3D formats the kernel's importers read (packages/kernel/src/mesh/parse). */
export const OPENABLE_MODEL_EXTENSIONS = ['stl', 'obj', 'glb', '3mf', 'ply'] as const
const PLANNED_MODEL_EXTENSIONS = ['step', 'stp']

const extensionOf = (name: string) => name.toLowerCase().split('.').pop() ?? ''

/**
 * The piece's design board: the oldest board linked to it, else a new one. The new board's id is
 * derived from the piece, so two windows saving to Design at once insert one board (the
 * primary key decides); if that id is taken by a board someone unlinked, a fresh one is made.
 */
export async function designBoardFor(ctx: Ctx, pieceId: string, notify = true): Promise<BoardRow> {
  const piece = await getPiece(ctx, pieceId)
  const linked = () =>
    ctx.repo.boards.first(
      and(eq(t.board.pieceId, pieceId), isNull(t.board.pinsFor)),
      asc(t.board.createdAt),
    )
  const existing = await linked()
  if (existing) return existing
  const values = {
    title: `${piece.title || 'Untitled'} · Design`,
    description: '',
    pieceId,
  }
  const inserted = await ctx.repo.boards.insertIfAbsent({ id: `brd_design_${pieceId}`, ...values })
  const board =
    inserted ??
    (await linked()) ??
    (await ctx.repo.boards.insert({ id: createId('brd'), ...values }))
  if (notify) publish(ctx, { type: 'board.updated', boardId: board.id })
  return board
}

/**
 * Pins a board picture beside the piece's CAD for the CAD job to build from. Only pictures that
 * may be sent to AI go: the job reads the picture with Claude.
 */
export async function takeToCad(
  ctx: Ctx,
  input: { pieceId: string; referenceId: string },
): Promise<{ pin: Awaited<ReturnType<typeof invoke<'references.pin'>>>[number]; assetId: string }> {
  await getPiece(ctx, input.pieceId)
  const ref = await getReference(ctx, input.referenceId)
  if (!ref.assetId || (ref.type !== 'image' && ref.type !== 'generated'))
    throw badRequest(
      ref.type === 'model'
        ? 'This is a 3D model: open it as CAD instead'
        : 'Only a picture or a sketch can be taken to CAD',
    )
  if (ref.rights === 'viewOnly')
    throw conflict(
      'This picture is view-only, so it cannot be sent to AI to build from. Pin it beside CAD and model over it by hand, or use a picture you own or that is open access.',
    )
  const [pin] = await invoke(ctx, 'references.pin', {
    pieceId: input.pieceId,
    items: [{ referenceId: ref.id }],
  })
  return { pin: pin!, assetId: ref.assetId }
}

/**
 * Adds a 3D file to a piece's design as a sculpted body (one change, undoable), or makes a new
 * piece around it. STEP is refused with a plain sentence: the kernel cannot read it yet.
 */
export async function openAsCad(
  ctx: Ctx,
  input: { assetId: string; pieceId?: string; title?: string; collectionId?: string | null },
): Promise<{ piece: Piece; nodeId: string }> {
  const asset = await getAssetRow(ctx, input.assetId)
  const ext = extensionOf(asset.name)
  if (PLANNED_MODEL_EXTENSIONS.includes(ext))
    throw badRequest(
      'STEP files cannot be opened as CAD yet; that is planned. Open an STL, OBJ, GLB, 3MF or PLY export of it instead.',
    )
  if (asset.kind !== 'mesh' || !(OPENABLE_MODEL_EXTENSIONS as readonly string[]).includes(ext))
    throw badRequest(`${asset.name} is not a 3D model Pavé can open: use STL, OBJ, GLB, 3MF or PLY`)
  const name = asset.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Model'
  const pieceId =
    input.pieceId ??
    (
      await invoke(ctx, 'pieces.create', {
        title: input.title ?? name,
        kind: 'other',
        collectionId: input.collectionId ?? null,
      })
    ).id
  if (input.pieceId) await getPiece(ctx, input.pieceId)
  const nodeId = newId('meshBody')
  await commitChange(ctx, {
    pieceId,
    label: `Opened ${asset.name} as CAD`,
    ops: [
      {
        t: 'add',
        node: { id: nodeId, kind: 'meshBody', name, source: { type: 'asset', assetId: asset.id } },
      },
    ],
  })
  // The CAD is where the piece now is.
  await ctx.repo.pieces.update(eq(t.piece.id, pieceId), { stage: 'design', updatedAt: new Date() })
  publish(ctx, { type: 'piece.updated', pieceId })
  return { piece: await invoke(ctx, 'pieces.get', { id: pieceId }), nodeId }
}

/** What a spec would weigh and cost: the canon's build of it, evaluated by the kernel. */
export async function estimateSpec(
  ctx: Ctx,
  input: { id: string; spec?: PieceSpec },
): Promise<SpecEstimate> {
  const piece = await getPiece(ctx, input.id)
  const spec = input.spec ?? piece.spec
  if (!spec) throw badRequest('This piece has no spec yet: save one with pieces.setSpec first')
  const { design, notes: recipeNotes } = designFor(spec)
  // Nothing to measure: say so first, and give no price for a piece that would not exist.
  const empty = emptyBuildReason(spec, design)
  if (empty)
    return {
      metalMassG: 0,
      caratTotal: 0,
      stoneCount: 0,
      metal: spec.metal.alloy,
      boundsMm: { x: 0, y: 0, z: 0 },
      costUsd: null,
      notes: [empty, ...recipeNotes.filter((n) => n !== empty)].slice(0, 6),
    }
  const geometry = ctx.services.require('geometry')
  const summary = await geometry.evaluate(
    design,
    { detail: FACTS_DETAIL, pieceId: piece.id, ...(ctx.signal ? { signal: ctx.signal } : {}) },
    serviceContext(ctx),
  )
  const facts = factsOf(summary)
  let findings: ReturnType<typeof lintDesign> = []
  try {
    findings = lintDesign(design, summary)
  } catch {
    findings = []
  }
  const notes = [
    ...new Set([
      ...summary.diagnostics
        .filter((d) => d.level === 'error' || d.level === 'warning')
        .map((d) => d.message),
      ...findings.filter((f) => f.level === 'warning').map((f) => f.message),
      ...recipeNotes,
    ]),
  ].slice(0, 6)
  return {
    metalMassG: facts.metalMassG,
    caratTotal: facts.caratTotal,
    stoneCount: facts.stoneCount,
    metal: facts.metal || spec.metal.alloy,
    boundsMm: facts.boundsMm,
    costUsd: facts.costUsd,
    notes,
  }
}
