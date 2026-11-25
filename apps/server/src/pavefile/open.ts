/**
 * Opening a .pave file as a new piece. Free, like saving.
 *
 * Nothing in the file is trusted: the zip is read with limits and a fixed list of names
 * (zip.ts), the manifest's checksum and every entry's SHA-256 are checked, every record is
 * validated, every id the records use must point at something the file carries, and the design
 * is migrated from older versions (a newer file is refused). Only then is anything written, in
 * one transaction, under new ids: opening the same file twice makes two pieces.
 *
 * Provenance: a file keeps where it has been (the saves it travelled through) and its history
 * keeps who made each change. A rights confirmation (attestation) is a statement by a person in
 * the organisation that saved the file, so it is kept only when the file was saved here.
 */
import { createHash } from 'node:crypto'
import {
  DesignVersionError,
  isPaveEntryName,
  type Op,
  PAVE_ENTRIES,
  PAVE_FORMAT_VERSION,
  PAVE_LIMITS,
  PAVE_MIME,
  PaveAssetSchema,
  PaveChangeSchema,
  PaveManifestSchema,
  PavePieceSchema,
  PaveReferencesSchema,
  PaveShotSchema,
  type Piece,
  type PieceProvenance,
  parseDesignDocument,
} from '@pave/schema'
import { z } from 'zod'
import { putAsset } from '../assets/assets'
import { type Ctx, publish } from '../context'
import { refreshFacts } from '../design'
import { AppError } from '../errors'
import { toPiece } from '../handlers/pieces'
import { createId } from '../ids'
import { ensure, getCollection } from '../lookups'
import { MAX_HOPS } from './save'
import { readZip, ZipRefused } from './zip'

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Every refusal says what is wrong with the file, in words a person can act on. */
const refuse = (message: string) =>
  new AppError('bad_request', `This .pave file cannot be opened: ${message}`, {
    reason: 'invalid_pave_file',
  })

type Parts = Record<string, unknown>

/**
 * One step per older format version, keyed by the version it starts from, each bringing the
 * file's parsed JSON entries up by one. Version 1 is the first, so there are none yet; the
 * first breaking change adds `1: (parts) => …` here, and older files keep opening.
 */
export const PAVE_FILE_MIGRATIONS: Record<number, (parts: Parts) => Parts> = {}

/** Brings a file's parsed entries from `from` up to `to`, one version at a time. */
export function migrateFile(
  parts: Parts,
  from: number,
  to: number = PAVE_FORMAT_VERSION,
  migrations: Record<number, (parts: Parts) => Parts> = PAVE_FILE_MIGRATIONS,
): Parts {
  let out = parts
  for (let v = from; v < to; v++) {
    const step = migrations[v]
    if (!step) throw refuse(`it is format version ${from}, which this Pavé cannot migrate`)
    out = step(out)
  }
  return out
}

function parseJson(name: string, bytes: Uint8Array | undefined): unknown {
  if (!bytes) return undefined
  if (bytes.byteLength > PAVE_LIMITS.jsonBytes) throw refuse(`${name} is too large`)
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw refuse(`${name} is not valid JSON`)
  }
}

function parse<S extends z.ZodType>(schema: S, value: unknown, name: string): z.output<S> {
  const result = schema.safeParse(value)
  if (!result.success)
    throw refuse(
      `${name} is not valid (${z
        .prettifyError(result.error)
        .replace(/\s*\n\s*/g, ' ')
        .slice(0, 300)})`,
    )
  return result.data
}

const FIXED: readonly string[] = [
  PAVE_ENTRIES.mimetype,
  PAVE_ENTRIES.manifest,
  PAVE_ENTRIES.checksum,
]

/** Reads and checks the container: the zip, the mimetype, the checksum, every entry's hash. */
async function readFile(bytes: Uint8Array, signal?: AbortSignal) {
  let files: Map<string, Uint8Array>
  try {
    files = await readZip(bytes, PAVE_LIMITS, isPaveEntryName, signal)
  } catch (err) {
    if (err instanceof ZipRefused) throw refuse(err.message)
    throw err
  }
  const text = (name: string) => {
    const b = files.get(name)
    return b && new TextDecoder().decode(b)
  }
  if (text(PAVE_ENTRIES.mimetype) !== PAVE_MIME) throw refuse('it is not a Pavé file')
  const manifestBytes = files.get(PAVE_ENTRIES.manifest)
  if (!manifestBytes) throw refuse('its manifest is missing')
  const checksum = text(PAVE_ENTRIES.checksum)?.trim().split(/\s+/)[0]
  if (checksum !== sha256(manifestBytes)) throw refuse('its manifest does not match its checksum')

  const raw = parseJson('The manifest', manifestBytes)
  const version = (raw as { formatVersion?: unknown } | null)?.formatVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    throw refuse('its manifest has no format version')
  // Refused before anything else is read: a newer format may mean something else by any field.
  if (version > PAVE_FORMAT_VERSION)
    throw new AppError(
      'bad_request',
      `This file was saved by a newer version of Pavé (file format ${version}; this one opens up to ${PAVE_FORMAT_VERSION}). Update Pavé to open it.`,
      { reason: 'newer_pave_file', formatVersion: version },
    )
  const manifest = parse(PaveManifestSchema, raw, 'The manifest')

  // Every entry is listed with its hash, and every listed entry is there.
  for (const [name, data] of files) {
    if (FIXED.includes(name)) continue
    const listed = manifest.files[name]
    if (!listed) throw refuse(`it contains “${name}”, which its manifest does not list`)
    if (listed.bytes !== data.byteLength || listed.sha256 !== sha256(data))
      throw refuse(`“${name}” is damaged (its checksum does not match)`)
  }
  for (const name of Object.keys(manifest.files))
    if (!files.has(name)) throw refuse(`“${name}” is missing`)

  const parts = migrateFile(
    Object.fromEntries(
      [
        PAVE_ENTRIES.piece,
        PAVE_ENTRIES.history,
        PAVE_ENTRIES.references,
        PAVE_ENTRIES.shots,
        PAVE_ENTRIES.assets,
      ].map((name) => [name, parseJson(name, files.get(name))]),
    ),
    version,
  )
  return { files, manifest, parts, version }
}

/** The file's records, validated and cross-checked: every id they use is one the file has. */
function readRecords(files: Map<string, Uint8Array>, parts: Parts) {
  if (parts[PAVE_ENTRIES.piece] === undefined) throw refuse('the piece is missing')
  const piece = parse(PavePieceSchema, parts[PAVE_ENTRIES.piece], 'The piece')
  const history = parse(
    z.array(PaveChangeSchema).max(PAVE_LIMITS.changes),
    parts[PAVE_ENTRIES.history] ?? [],
    'The history',
  )
  const references = parse(
    PaveReferencesSchema.extend({
      items: PaveReferencesSchema.shape.items.max(PAVE_LIMITS.references),
    }),
    parts[PAVE_ENTRIES.references] ?? { board: null, items: [] },
    'The references',
  )
  const shots = parse(
    z.array(PaveShotSchema).max(PAVE_LIMITS.shots),
    parts[PAVE_ENTRIES.shots] ?? [],
    'The shots',
  )
  const assets = parse(
    z.array(PaveAssetSchema).max(PAVE_LIMITS.assets),
    parts[PAVE_ENTRIES.assets] ?? [],
    'The asset list',
  )

  let design: Piece['design']
  let directionDesigns: Piece['design'][]
  try {
    design = parseDesignDocument(piece.design)
    directionDesigns = piece.directions.map((d) => parseDesignDocument(d.design))
  } catch (err) {
    if (err instanceof DesignVersionError) throw refuse(err.message)
    throw err
  }

  // Assets: unique ids, each path an entry of the file whose bytes are what the path says.
  const assetIds = new Set<string>()
  for (const a of assets) {
    if (assetIds.has(a.id)) throw refuse(`the asset “${a.id}” is listed twice`)
    assetIds.add(a.id)
    const data = files.get(a.path)
    if (!a.path.startsWith('assets/') || !data) throw refuse(`the asset “${a.id}” is missing`)
    if (!a.path.startsWith(`assets/${sha256(data)}.`))
      throw refuse(`the asset “${a.id}” is damaged`)
  }
  const assetRef = (id: string | null, what: string) => {
    if (id !== null && !assetIds.has(id))
      throw refuse(`${what} points at a picture it does not carry`)
  }

  // History: increasing sequence numbers ending at or before the piece's version, unique ids,
  // and undo records pointing at earlier changes of the same history.
  const changeIds = new Set<string>()
  let last = 0
  for (const c of history) {
    if (c.seq <= last) throw refuse('its history is out of order')
    if (changeIds.has(c.id)) throw refuse(`its history lists the change “${c.id}” twice`)
    for (const r of c.reverts)
      if (!changeIds.has(r)) throw refuse(`its history undoes a change it does not contain`)
    changeIds.add(c.id)
    last = c.seq
  }
  if (last > piece.version) throw refuse('its history goes past the design’s version')

  const refIds = new Set<string>()
  for (const r of references.items) {
    if (refIds.has(r.id)) throw refuse(`the reference “${r.id}” is listed twice`)
    refIds.add(r.id)
    assetRef(r.assetId, `The reference “${r.title || r.id}”`)
  }
  assetRef(piece.coverAssetId, 'The cover')
  for (const id of piece.origin?.sourceAssetIds ?? []) assetRef(id, 'The piece’s origin')
  for (const id of piece.origin?.referenceIds ?? [])
    if (!refIds.has(id)) throw refuse('the piece’s origin points at a reference it does not carry')
  const directionIds = new Set<string>()
  for (const d of piece.directions) {
    if (directionIds.has(d.id)) throw refuse(`the direction “${d.letter}” is listed twice`)
    directionIds.add(d.id)
    for (const id of d.previewAssetIds) assetRef(id, `Direction ${d.letter}`)
  }
  if (piece.chosenDirectionId !== null && !directionIds.has(piece.chosenDirectionId))
    throw refuse('its chosen direction is missing')
  const shotIds = new Set<string>()
  for (const s of shots) {
    if (shotIds.has(s.id)) throw refuse(`the shot “${s.title}” is listed twice`)
    shotIds.add(s.id)
  }
  return { piece, design, directionDesigns, history, references, shots, assets }
}

export interface OpenedFile {
  piece: Piece
  notes: string[]
}

export async function openPieceFile(
  ctx: Ctx,
  bytes: Uint8Array,
  fileName: string,
  opts: { collectionId?: string | null } = {},
): Promise<OpenedFile> {
  await ensure(getCollection, ctx, opts.collectionId)
  const { files, manifest, parts } = await readFile(bytes, ctx.signal)
  const file = readRecords(files, parts)
  const notes: string[] = []
  const elsewhere = manifest.save.org !== ctx.orgFingerprint
  const now = new Date()

  // New ids for everything, so the same file opened twice makes two independent pieces.
  const pieceId = createId('pc')
  const refId = new Map(file.references.items.map((r) => [r.id, createId('ref')]))
  const changeId = new Map(file.history.map((c) => [c.id, createId('chg')]))

  const provenance: PieceProvenance = {
    createdAt: manifest.createdAt,
    files: [...manifest.earlier, manifest.save].slice(-MAX_HOPS),
    fileName: fileName.slice(0, 200),
    openedAt: now.toISOString(),
    openedBy: ctx.user.id,
    elsewhere,
  }
  const origin = file.piece.origin
  const attestation = origin?.attestation && !elsewhere ? origin.attestation : null
  if (origin?.attestation && elsewhere)
    notes.push(
      'This piece is made from artwork. The confirmation that it may be used was given where the file was saved, so someone here must confirm it again before exporting.',
    )
  const withheld = file.references.items.filter((r) => r.withheld).length
  if (withheld)
    notes.push(
      `${withheld === 1 ? 'One pinned reference arrives' : `${withheld} pinned references arrive`} without ${withheld === 1 ? 'its picture' : 'their pictures'}: ${withheld === 1 ? 'its' : 'their'} rights kept ${withheld === 1 ? 'it' : 'them'} out of the file. The title, credit and licence are kept.`,
    )

  const row = await ctx.repo.transaction(async (tx) => {
    const tctx: Ctx = { ...ctx, repo: tx }
    // Pictures first: the records point at them. Identical bytes are stored once (by hash).
    const assetId = new Map<string, string>()
    for (const a of file.assets) {
      const stored = await putAsset(tctx, {
        bytes: files.get(a.path)!,
        name: a.name,
        mime: a.mime,
        kind: a.kind,
      })
      assetId.set(a.id, stored.id)
    }
    const asset = (id: string | null) => (id === null ? null : (assetId.get(id) ?? null))

    const inserted = await tx.pieces.insert({
      id: pieceId,
      createdBy: ctx.user.id,
      collectionId: opts.collectionId ?? null,
      title: file.piece.title || manifest.piece.title || 'Untitled piece',
      // The design says what it is; the record's kind follows it.
      kind: file.design.kind,
      stage: file.piece.stage,
      brief: file.piece.brief,
      spec: file.piece.spec,
      design: file.design,
      version: file.piece.version,
      coverAssetId: asset(file.piece.coverAssetId),
      coverAuto: file.piece.coverAuto,
      facts: file.piece.facts,
      origin: origin && {
        kind: origin.kind,
        sourceAssetIds: origin.sourceAssetIds.map((id) => asset(id)!),
        referenceIds: origin.referenceIds.map((id) => refId.get(id)!),
        flags: origin.flags,
        attestation,
      },
      directions: file.piece.directions.map((d, i) => ({
        ...d,
        previewAssetIds: d.previewAssetIds.map((id) => asset(id)!),
        design: file.directionDesigns[i]!,
      })),
      chosenDirectionId: file.piece.chosenDirectionId,
      // Letters are never reused, so the count is at least how many there are.
      directionCount: Math.max(file.piece.directionCount, file.piece.directions.length),
      provenance,
    })

    if (file.history.length)
      await tx.changes.insertMany(
        file.history.map((c) => ({
          id: changeId.get(c.id)!,
          pieceId,
          seq: c.seq,
          // The wire schema types `add.node` loosely; a later undo applies them through applyOps,
          // which validates every node.
          ops: c.ops as Op[],
          inverse: c.inverse as Op[],
          actor: c.actor,
          actorType: c.actor.type,
          actorUserId: c.userId ?? (c.actor.type === 'user' ? c.actor.id : null),
          runId: c.actor.type === 'agent' ? c.actor.runId : null,
          toolCallId: c.actor.type === 'agent' ? (c.actor.toolCallId ?? null) : null,
          label: c.label,
          reverts: c.reverts.map((id) => changeId.get(id)!),
          at: new Date(c.at),
        })),
      )

    const { board, items } = file.references
    if (items.length || board) {
      const boardId = createId('brd')
      await tx.boards.insert({
        id: boardId,
        title: (board?.title ?? `Pinned for ${inserted.title}`).slice(0, 120),
        description: board?.description ?? 'References pinned beside CAD.',
        icon: board?.icon ?? '📌',
        pieceId: null,
        pinsFor: pieceId,
      })
      if (items.length)
        await tx.references.insertMany(
          items.map((r) => ({
            id: refId.get(r.id)!,
            boardId,
            type: r.type,
            assetId: asset(r.assetId),
            thumbUrl: r.thumbUrl,
            title: r.title,
            note: r.note,
            source: r.source,
            rights: r.rights,
            tags: r.tags,
            palette: r.palette,
            generation: r.generation,
            pieceId: null,
            canvas: r.canvas,
            plane: r.assetId === null ? null : r.plane,
            width: r.width,
            height: r.height,
            position: r.position,
            createdAt: new Date(r.createdAt),
          })),
        )
    }

    if (file.shots.length)
      await tx.scenes.insertMany(
        file.shots.map((s) => ({
          id: createId('scn'),
          pieceId,
          title: s.title,
          scene: s.scene,
          position: s.position,
          takeId: null,
          createdBy: ctx.user.id,
          actor: s.actor,
        })),
      )
    return inserted
  })

  publish(ctx, { type: 'piece.updated', pieceId })
  refreshFacts(ctx, pieceId, row.version, row.design)
  return { piece: await toPiece(ctx, row), notes }
}
