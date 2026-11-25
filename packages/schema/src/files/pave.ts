/**
 * The native Pavé file (`.pave`): one piece with everything that makes it, in a zip any tool can
 * list. Saving and opening it is always free, inside Pavé; Rhino and STEP exports are what the
 * plan counts. The format is documented in docs/pave-file.md; this module is its contract, read
 * by the server (which writes and opens the files) and the studio (which names and offers them).
 *
 * Versioning: `formatVersion` changes only when a reader of the previous version would misread
 * a file. Adding a field or an entry is not a change: readers ignore what they do not know, and
 * every field added later is optional here. A reader opens files of its own version and older
 * (migrating them step by step, see `PAVE_FILE_MIGRATIONS` on the server) and refuses newer ones.
 */
import { z } from 'zod'
import {
  ASSET_KINDS,
  AttestationSchema,
  CanvasPlacementSchema,
  ImagePlaneSchema,
  ORIGIN_KINDS,
  OriginFlagSchema,
  PaveHopSchema,
  ReferenceSchema,
  RenderSceneSchema,
  RIGHTS,
  STAGES,
} from '../api/entities'
import { ActorSchema, OpSchema, PIECE_KINDS } from '../design/design'
import { DirectionSchema } from '../design/directions'
import { PieceSpecSchema } from '../design/spec'

export const PAVE_EXTENSION = 'pave'
/** The first entry of every file, stored uncompressed, so a file can be recognised by its start. */
export const PAVE_MIME = 'application/vnd.pave.piece+zip'
/** The version this build writes, and the newest it opens. */
export const PAVE_FORMAT_VERSION = 1

export const isPaveFileName = (name: string): boolean =>
  name.toLowerCase().endsWith(`.${PAVE_EXTENSION}`)

const MB = 1024 * 1024

/**
 * What an opened file may hold. Checked from the zip's own directory before anything is
 * unpacked, and again while unpacking (a zip can lie about sizes), so a crafted file cannot
 * fill memory or the disk.
 */
export const PAVE_LIMITS = {
  /** The whole file, as uploaded. */
  fileBytes: 256 * MB,
  entries: 1200,
  /** One entry, unpacked. */
  entryBytes: 128 * MB,
  /** Every entry together, unpacked. */
  totalBytes: 512 * MB,
  /** One JSON entry, unpacked. */
  jsonBytes: 32 * MB,
  assets: 1000,
  changes: 100_000,
  references: 500,
  shots: 200,
} as const

/** Fixed entries, in the order they are written. */
export const PAVE_ENTRIES = {
  mimetype: 'mimetype',
  manifest: 'manifest.json',
  checksum: 'checksum.sha256',
  piece: 'piece.json',
  history: 'history.json',
  references: 'references.json',
  shots: 'shots.json',
  assets: 'assets.json',
  exact: 'geometry/exact.step',
  display: 'geometry/display.glb',
} as const

/**
 * Every name a file may contain. Anything else (a path with `..`, a leading slash, a drive
 * letter, a backslash, a hidden file) refuses the whole file: names are never trusted as paths,
 * and nothing in a file is ever written under its own name.
 */
const ENTRY_NAME =
  /^(?:mimetype|manifest\.json|checksum\.sha256|piece\.json|history\.json|references\.json|shots\.json|assets\.json|geometry\/exact\.step|geometry\/display\.glb|assets\/[0-9a-f]{64}\.[a-z0-9]{1,8}|thumbnails\/[a-z0-9-]{1,32}\.(?:webp|png|jpg))$/

export const isPaveEntryName = (name: string): boolean => ENTRY_NAME.test(name)

const sha256 = z.string().regex(/^[0-9a-f]{64}$/)
const iso = z.string().max(40)
const fileId = z.string().max(64)

/** Where each file's piece came from; the opener adds the hop it was opened from. */
export const PaveManifestSchema = z.object({
  format: z.literal('pave'),
  formatVersion: z.number().int().positive(),
  app: z.object({ name: z.string().max(60), version: z.string().max(40) }),
  /** When the piece was first made (wherever that was), last changed, and saved to this file. */
  createdAt: iso,
  modifiedAt: iso,
  savedAt: iso,
  /** This save: its id, the piece it was saved from, a fingerprint of the organisation. */
  save: PaveHopSchema,
  /** Saves the piece travelled through before this one, oldest first. */
  earlier: z.array(PaveHopSchema).max(31),
  piece: z.object({ title: z.string().max(200), kind: z.enum(PIECE_KINDS) }),
  /** What is inside, for a reader that only lists the file. */
  contents: z.object({
    changes: z.number().int().nonnegative(),
    directions: z.number().int().nonnegative(),
    references: z.number().int().nonnegative(),
    /** Pinned references kept as details only: their rights do not allow passing the picture on. */
    referencesWithoutPictures: z.number().int().nonnegative(),
    shots: z.number().int().nonnegative(),
    assets: z.number().int().nonnegative(),
    geometry: z.array(z.enum(['step', 'glb'])),
  }),
  /** Every entry but `mimetype`, this manifest and its checksum: size and SHA-256. */
  files: z.record(z.string(), z.object({ bytes: z.number().int().nonnegative(), sha256 })),
})
export type PaveManifest = z.infer<typeof PaveManifestSchema>

/** A picture or other file carried in `assets/`, under the id the piece's records use for it. */
export const PaveAssetSchema = z.object({
  id: fileId,
  path: z.string().max(200),
  name: z.string().max(200),
  mime: z.string().max(100),
  kind: z.enum(ASSET_KINDS),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
})
export type PaveAsset = z.infer<typeof PaveAssetSchema>

export const PavePieceSchema = z.object({
  title: z.string().max(200),
  kind: z.enum(PIECE_KINDS),
  stage: z.enum(STAGES),
  brief: z.string().max(200_000),
  spec: PieceSpecSchema.nullable(),
  /** The design document; any earlier version is migrated on open. */
  design: z.unknown(),
  /** Sequence number of the last change: the history ends here. */
  version: z.number().int().nonnegative(),
  coverAssetId: fileId.nullable(),
  coverAuto: z.boolean(),
  facts: z
    .object({
      metalMassG: z.number(),
      caratTotal: z.number(),
      stoneCount: z.number(),
      metal: z.string(),
    })
    .nullable(),
  /** Where a freeform piece came from; asset and reference ids are the file's own. */
  origin: z
    .object({
      kind: z.enum(ORIGIN_KINDS),
      sourceAssetIds: z.array(fileId).max(8),
      referenceIds: z.array(fileId).max(12),
      flags: z.array(OriginFlagSchema).max(8),
      attestation: AttestationSchema.nullable(),
    })
    .nullable(),
  directions: z.array(DirectionSchema.extend({ design: z.unknown() })).max(200),
  chosenDirectionId: fileId.nullable(),
  directionCount: z.number().int().nonnegative(),
  createdAt: iso,
  updatedAt: iso,
})
export type PavePiece = z.infer<typeof PavePieceSchema>

/** One change of the design's history, as `design.history` gives it. */
export const PaveChangeSchema = z.object({
  id: fileId,
  seq: z.number().int().positive(),
  ops: z.array(OpSchema),
  inverse: z.array(OpSchema),
  actor: ActorSchema,
  /** The person the change was made for (an assistant's changes too); absent in older files. */
  userId: fileId.nullable().optional(),
  label: z.string().max(200),
  at: iso,
  reverts: z.array(fileId),
})
export type PaveChange = z.infer<typeof PaveChangeSchema>

/** A pinned reference. `assetId` is null when the picture is not in the file (`withheld`). */
export const PaveReferenceSchema = ReferenceSchema.omit({
  boardId: true,
  pieceId: true,
}).extend({
  rights: z.enum(RIGHTS),
  canvas: CanvasPlacementSchema.nullable(),
  plane: ImagePlaneSchema.nullable(),
  /** Its picture stayed behind: only open-access and the organisation's own pictures travel. */
  withheld: z.boolean(),
})
export type PaveReference = z.infer<typeof PaveReferenceSchema>

export const PaveReferencesSchema = z.object({
  /** The piece's pin board; null when nothing was pinned. */
  board: z
    .object({
      title: z.string().max(120),
      description: z.string().max(2000),
      icon: z.string().max(8).nullable(),
    })
    .nullable(),
  items: z.array(PaveReferenceSchema),
})

export const PaveShotSchema = z.object({
  id: fileId,
  title: z.string().max(80),
  scene: RenderSceneSchema,
  position: z.number(),
  actor: ActorSchema.nullable(),
  createdAt: iso,
  updatedAt: iso,
})
export type PaveShot = z.infer<typeof PaveShotSchema>

/** Only these rights let a picture travel in a file another organisation may open. */
export const RIGHTS_THAT_TRAVEL = ['open', 'own'] as const
