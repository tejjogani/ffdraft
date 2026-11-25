/**
 * Saving a piece as a .pave file. Free and never counted: the plan counts Rhino and STEP exports
 * (`design.export`), and nothing here goes through it. The exact geometry inside is written by
 * the geometry service directly, so it never claims an export either.
 *
 * Pictures travel only where their rights allow passing them on (`RIGHTS_THAT_TRAVEL`); a pinned
 * reference whose picture stays behind keeps its details (title, credit, licence, rights) so the
 * person who opens the file knows what it was and where to find it.
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { extname } from 'node:path'
import {
  ASSET_KINDS,
  originNeedsAttestation,
  PAVE_ENTRIES,
  PAVE_FORMAT_VERSION,
  PAVE_MIME,
  type PaveAsset,
  type PaveChange,
  type PaveHop,
  type PaveManifest,
  type PavePiece,
  type PaveReference,
  type PaveShot,
  RIGHTS_THAT_TRAVEL,
} from '@pave/schema'
import { asc, eq, inArray } from 'drizzle-orm'
import { assetBytes, readThumbnail } from '../assets/assets'
import type { Ctx } from '../context'
import * as t from '../db/schema'
import { createId } from '../ids'
import { getPiece } from '../lookups'
import { pinBoardOf, pinnedRows } from '../references/pins'
import { viewOnlyAssets } from '../references/rights'
import { serviceContext } from '../service-context'
import { writeZip, type ZipEntry } from './zip'

export const APP_NAME = 'Pavé'
export const APP_VERSION: string = createRequire(import.meta.url)('../../package.json').version
/** At most this many saves are remembered in a piece's provenance (the oldest are dropped). */
export const MAX_HOPS = 32
/** How long saving waits for the evaluated geometry before saving without it. */
export const GEOMETRY_BUDGET_MS = 90_000
const GEOMETRY_ENTRIES = [
  ['step', PAVE_ENTRIES.exact],
  ['glb', PAVE_ENTRIES.display],
] as const

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const json = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value, null, 1)}\n`)

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

function extensionOf(name: string, mime: string): string {
  const ext = extname(name).slice(1).toLowerCase()
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : (EXT_BY_MIME[mime] ?? 'bin')
}

/** Already compressed: deflating them again only costs time. */
const STORED = /^(image\/(jpeg|png|webp|gif|avif)|video\/|model\/gltf-binary)/

/**
 * The assets whose pixels may not leave in a file: view-only ones (the rule the assistant
 * follows too), and any shown by a reference whose rights do not let it travel (a licence may
 * cover this organisation only).
 */
async function heldBack(ctx: Ctx, ids: readonly string[]): Promise<Set<string>> {
  const held = await viewOnlyAssets(ctx, ids)
  if (!ids.length) return held
  const refs = await ctx.repo.references.many({ where: inArray(t.reference.assetId, [...ids]) })
  for (const r of refs)
    if (r.assetId && !(RIGHTS_THAT_TRAVEL as readonly string[]).includes(r.rights))
      held.add(r.assetId)
  return held
}

export interface SavedFile {
  bytes: Uint8Array
  name: string
  notes: string[]
}

export async function savePieceFile(
  ctx: Ctx,
  pieceId: string,
  { geometryBudgetMs = GEOMETRY_BUDGET_MS }: { geometryBudgetMs?: number } = {},
): Promise<SavedFile> {
  const piece = await getPiece(ctx, pieceId)
  const [changes, pins, board, shots] = await Promise.all([
    ctx.repo.changes.many({
      where: eq(t.designChange.pieceId, piece.id),
      orderBy: asc(t.designChange.seq),
    }),
    pinnedRows(ctx, piece.id),
    pinBoardOf(ctx, piece.id),
    ctx.repo.scenes.many({
      where: eq(t.renderScene.pieceId, piece.id),
      orderBy: asc(t.renderScene.position),
    }),
  ])
  const notes: string[] = []
  const entries: ZipEntry[] = []
  const add = (name: string, bytes: Uint8Array, store = false) =>
    entries.push({ name, bytes, store })

  // ── Assets: each wanted id once; identical bytes share one entry ──────────────────────────
  const directions = piece.directions ?? []
  const wanted = [
    ...(piece.coverAssetId ? [piece.coverAssetId] : []),
    ...(piece.origin?.sourceAssetIds ?? []),
    ...directions.flatMap((d) => d.previewAssetIds),
    ...pins.flatMap((r) => (r.assetId ? [r.assetId] : [])),
  ]
  const ids = [...new Set(wanted)]
  const held = await heldBack(ctx, ids)
  const rows = ids.length ? await ctx.repo.assets.many({ where: inArray(t.asset.id, ids) }) : []
  const assets: PaveAsset[] = []
  const written = new Set<string>()
  for (const row of rows) {
    if (held.has(row.id)) continue
    const path = `assets/${row.sha256}.${extensionOf(row.name, row.mime)}`
    if (!written.has(path)) {
      add(path, await assetBytes(ctx, row), STORED.test(row.mime))
      written.add(path)
    }
    assets.push({
      id: row.id,
      path,
      name: row.name,
      mime: row.mime,
      kind: (ASSET_KINDS as readonly string[]).includes(row.kind) ? row.kind : 'document',
      width: row.width,
      height: row.height,
    })
  }
  const carried = new Set(assets.map((a) => a.id))
  const keep = (id: string | null) => (id && carried.has(id) ? id : null)

  // A small cover for file browsers and the open dialog, when the cover travels.
  const cover = rows.find((r) => r.id === keep(piece.coverAssetId))
  if (cover?.mime.startsWith('image/'))
    try {
      add('thumbnails/cover.webp', (await readThumbnail(ctx, cover, 256)).bytes, true)
    } catch {
      notes.push('The cover thumbnail could not be made; the cover itself is in the file.')
    }

  // ── References ─────────────────────────────────────────────────────────────────────────────
  const references: PaveReference[] = pins.map((r) => {
    const withheld = r.assetId !== null && !carried.has(r.assetId)
    return {
      id: r.id,
      type: r.type,
      assetId: withheld ? null : r.assetId,
      thumbUrl: r.thumbUrl,
      title: r.title,
      note: r.note,
      source: r.source ?? null,
      rights: r.rights,
      tags: r.tags,
      palette: r.palette,
      generation: r.generation ?? null,
      canvas: r.canvas ?? null,
      // A plane shows the picture; without the picture there is nothing to lay in the view.
      plane: withheld ? null : (r.plane ?? null),
      width: r.width,
      height: r.height,
      position: r.position,
      createdAt: r.createdAt.toISOString(),
      withheld,
    }
  })
  const withheld = references.filter((r) => r.withheld).length
  if (withheld)
    notes.push(
      `${withheld === 1 ? 'One pinned picture stays' : `${withheld} pinned pictures stay`} behind: ${withheld === 1 ? 'its' : 'their'} rights do not allow passing ${withheld === 1 ? 'it' : 'them'} on. The file keeps ${withheld === 1 ? 'its' : 'their'} title, credit and licence.`,
    )
  const heldSources = (piece.origin?.sourceAssetIds ?? []).filter((id) => !carried.has(id)).length
  if (heldSources)
    notes.push(
      'The artwork the piece was made from stays behind (view-only); the file says it existed.',
    )

  // ── Geometry: a cache for viewers; the design is the truth ─────────────────────────────────
  const geometry: ('step' | 'glb')[] = []
  const engine = ctx.services.optional('geometry')
  if (!engine)
    notes.push(
      'No geometry engine here, so the file carries the design without its evaluated geometry.',
    )
  else if (originNeedsAttestation(piece.origin ?? null))
    notes.push(
      'The piece is made from artwork nobody has confirmed they may use yet, so the file carries the design without its geometry. Confirm the rights on its Overview, then save again.',
    )
  else {
    // Both at once (the kernel pool has more than one worker), under one deadline: the design is
    // the truth, so a slow machine saves without the cache rather than keeping the person waiting.
    const budget = AbortSignal.any([
      AbortSignal.timeout(geometryBudgetMs),
      ...(ctx.signal ? [ctx.signal] : []),
    ])
    const made = await Promise.allSettled(
      GEOMETRY_ENTRIES.map(([format]) =>
        engine.export(
          piece.design,
          { format, stones: true, pieceId: piece.id, signal: budget },
          serviceContext(ctx),
        ),
      ),
    )
    ctx.signal?.throwIfAborted()
    made.forEach((result, i) => {
      const [format, name] = GEOMETRY_ENTRIES[i]!
      if (result.status === 'fulfilled') {
        add(name, result.value.file.bytes, format === 'glb')
        geometry.push(format)
      }
    })
    const failed = made.filter((r) => r.status === 'rejected')
    if (failed.length)
      notes.push(
        budget.aborted
          ? `The evaluated geometry took longer than ${Math.round(geometryBudgetMs / 1000)} s, so the file carries the design without ${failed.length === 2 ? 'it' : 'part of it'}. Opening rebuilds it from the design.`
          : `Some of the evaluated geometry could not be made (${String((failed[0] as PromiseRejectedResult).reason?.message ?? failed[0])}); the design is complete without it.`,
      )
  }

  // ── The records ───────────────────────────────────────────────────────────────────────────
  const origin = piece.origin ?? null
  const record: PavePiece = {
    title: piece.title,
    kind: piece.kind,
    stage: piece.stage,
    brief: piece.brief,
    spec: piece.spec ?? null,
    design: piece.design,
    version: piece.version,
    coverAssetId: keep(piece.coverAssetId),
    coverAuto: piece.coverAuto,
    facts: piece.facts ?? null,
    origin: origin && {
      kind: origin.kind,
      sourceAssetIds: origin.sourceAssetIds.filter((id) => carried.has(id)),
      referenceIds: origin.referenceIds.filter((id) => references.some((r) => r.id === id)),
      flags: origin.flags,
      attestation: origin.attestation,
    },
    directions: directions.map((d) => ({
      ...d,
      previewAssetIds: d.previewAssetIds.filter((id) => carried.has(id)),
    })),
    chosenDirectionId: piece.chosenDirectionId ?? null,
    directionCount: piece.directionCount,
    createdAt: piece.createdAt.toISOString(),
    updatedAt: piece.updatedAt.toISOString(),
  }
  const history: PaveChange[] = changes.map((c) => ({
    id: c.id,
    seq: c.seq,
    ops: c.ops,
    inverse: c.inverse,
    actor: c.actor,
    userId: c.actorUserId,
    label: c.label,
    at: c.at.toISOString(),
    reverts: c.reverts,
  }))
  const savedShots: PaveShot[] = shots.map((s) => ({
    id: s.id,
    title: s.title,
    scene: s.scene,
    position: s.position,
    actor: s.actor ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }))
  add(PAVE_ENTRIES.piece, json(record))
  add(PAVE_ENTRIES.history, json(history))
  add(
    PAVE_ENTRIES.references,
    json({
      board: board
        ? { title: board.title, description: board.description, icon: board.icon }
        : null,
      items: references,
    }),
  )
  add(PAVE_ENTRIES.shots, json(savedShots))
  add(PAVE_ENTRIES.assets, json(assets))

  // ── Manifest and checksum ─────────────────────────────────────────────────────────────────
  const now = new Date()
  const save: PaveHop = {
    fileId: createId('pvf'),
    savedAt: now.toISOString(),
    app: APP_NAME,
    appVersion: APP_VERSION,
    formatVersion: PAVE_FORMAT_VERSION,
    pieceId: piece.id,
    org: ctx.orgFingerprint,
  }
  const earlier = (piece.provenance?.files ?? []).slice(-(MAX_HOPS - 1))
  const manifest: PaveManifest = {
    format: 'pave',
    formatVersion: PAVE_FORMAT_VERSION,
    app: { name: APP_NAME, version: APP_VERSION },
    createdAt: piece.provenance?.createdAt ?? piece.createdAt.toISOString(),
    modifiedAt: piece.updatedAt.toISOString(),
    savedAt: save.savedAt,
    save,
    earlier,
    piece: { title: piece.title, kind: piece.kind },
    contents: {
      changes: history.length,
      directions: directions.length,
      references: references.length,
      referencesWithoutPictures: withheld,
      shots: savedShots.length,
      assets: assets.length,
      geometry,
    },
    files: Object.fromEntries(
      entries.map((e) => [e.name, { bytes: e.bytes.byteLength, sha256: sha256(e.bytes) }]),
    ),
  }
  const manifestBytes = json(manifest)
  const zip = writeZip(
    [
      { name: PAVE_ENTRIES.mimetype, bytes: new TextEncoder().encode(PAVE_MIME), store: true },
      { name: PAVE_ENTRIES.manifest, bytes: manifestBytes },
      {
        name: PAVE_ENTRIES.checksum,
        bytes: new TextEncoder().encode(`${sha256(manifestBytes)}  ${PAVE_ENTRIES.manifest}\n`),
      },
      ...entries,
    ],
    now,
  )
  return { bytes: zip, name: `${piece.title || 'Untitled piece'}.pave`, notes }
}
