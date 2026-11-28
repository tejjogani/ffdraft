/**
 * Stored entities as they cross the wire. The server's tables mirror these; every domain row
 * also carries `orgId` (tenancy) which is implied by the session and never sent by clients.
 */
import { z } from 'zod'
import { ActorSchema, ChangeSchema, DesignSchema, PIECE_KINDS } from '../design/design'
import { DirectionSchema } from '../design/directions'
import { PieceIntakeSchema } from '../design/intake'
import { PieceSpecSchema } from '../design/spec'
import { GEM_MATERIAL_IDS } from '../domain/gems'
import { FINISH_IDS, METAL_IDS, PLATING_IDS } from '../domain/metals'
import { IMAGE_PROVIDERS } from '../images/imagegen'

const id = z.string()
const iso = z.string()

export const ROLES = ['owner', 'admin', 'designer', 'viewer', 'guest'] as const
export type Role = (typeof ROLES)[number]

export const UserSchema = z.object({
  id,
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
})
export type User = z.infer<typeof UserSchema>

export const OrgSchema = z.object({
  id,
  name: z.string(),
  slug: z.string(),
  logo: z.string().nullable(),
  role: z.enum(ROLES),
})
export type Org = z.infer<typeof OrgSchema>

export const MemberSchema = z.object({ user: UserSchema, role: z.enum(ROLES), joinedAt: iso })
export type Member = z.infer<typeof MemberSchema>

/**
 * How deep folders nest: a folder (a client, a season) and folders inside it (its collections).
 * Two levels keep the breadcrumb, the move menu and the totals one glance deep; deeper trees
 * belong to tags or search, not to more clicks.
 */
export const MAX_FOLDER_DEPTH = 2

/** A folder of projects (shown as "Folders"; stored as collections). */
export const CollectionSchema = z.object({
  id,
  name: z.string(),
  icon: z.string().nullable(),
  position: z.number(),
  /** The folder it sits in; null at the top. At most MAX_FOLDER_DEPTH levels. */
  parentId: id.nullable(),
  /** Projects directly in this folder (not in its sub-folders). */
  pieceCount: z.number(),
})
export type Collection = z.infer<typeof CollectionSchema>

/** Where a piece is in its life. A status, not a gate: any stage's tools are always usable. */
export const STAGES = ['idea', 'spec', 'design', 'render', 'production', 'done'] as const
export type Stage = (typeof STAGES)[number]

// ── Origin: where a freeform piece came from ────────────────────────────────────────────────

/** How a piece was started: from a picture, a logo, typed text, a mesh, board references or another piece. */
export const ORIGIN_KINDS = ['image', 'logo', 'text', 'mesh', 'references', 'piece'] as const
/** What image analysis noticed in the source and the person must confirm they may use. */
export const ORIGIN_FLAGS = ['logo', 'character', 'face'] as const
/** The basis on which a person may turn the source into jewelry. */
export const ATTESTATION_RIGHTS = ['own', 'licensed', 'permission'] as const

export const OriginFlagSchema = z.object({
  code: z.enum(ORIGIN_FLAGS),
  message: z.string().max(500),
})
export type OriginFlag = z.infer<typeof OriginFlagSchema>

/** A person's statement that they may use the source artwork, recorded by `pieces.attest` only. */
export const AttestationSchema = z.object({
  rights: z.enum(ATTESTATION_RIGHTS),
  /** A recognisable person is shown and they consented to their likeness being used. */
  likenessConsent: z.boolean(),
  /** The user who attested; never an agent. */
  by: id,
  at: iso,
})
export type Attestation = z.infer<typeof AttestationSchema>

export const PieceOriginSchema = z.object({
  kind: z.enum(ORIGIN_KINDS),
  sourceAssetIds: z.array(id).max(8),
  referenceIds: z.array(id).max(12),
  flags: z.array(OriginFlagSchema).max(8),
  attestation: AttestationSchema.nullable(),
})
export type PieceOrigin = z.infer<typeof PieceOriginSchema>

/** The origin as `pieces.create` / `pieces.update` take it: everything but the attestation. */
export const PieceOriginInputSchema = z.object({
  kind: z.enum(ORIGIN_KINDS),
  sourceAssetIds: z.array(id).max(8).default([]),
  referenceIds: z.array(id).max(12).default([]),
  flags: z.array(OriginFlagSchema).max(8).default([]),
})
export type PieceOriginInput = z.input<typeof PieceOriginInputSchema>

/**
 * A piece made from someone's artwork (uploaded sources or references) cannot be sent to a 3D
 * provider, packaged or exported until a person attests they may use it. The server enforces it
 * (409 `attestation_required`); a client that exports on its own (the studio's in-browser STL /
 * GLB export) must check this first and offer `pieces.attest` instead.
 */
export const originNeedsAttestation = (origin: PieceOrigin | null): boolean =>
  origin !== null &&
  origin.attestation === null &&
  origin.sourceAssetIds.length + origin.referenceIds.length > 0

/** One save of a piece to a .pave file: where and when, so a piece passed around keeps its trail. */
export const PaveHopSchema = z.object({
  /** A new id for every save. */
  fileId: z.string().min(8).max(64),
  savedAt: iso,
  app: z.string().max(60),
  appVersion: z.string().max(40),
  formatVersion: z.number().int().positive(),
  /** The piece it was saved from, as the place that saved it knew it. */
  pieceId: z.string().max(64),
  /** A fingerprint of the organisation that saved it (a hash: never its id or name). */
  org: z.string().max(64),
})
export type PaveHop = z.infer<typeof PaveHopSchema>

/** Set on a piece opened from a .pave file. */
export const PieceProvenanceSchema = z.object({
  /** When the piece was first made, wherever that was. */
  createdAt: iso,
  /** Every save it travelled through, oldest first; the last is the file it was opened from. */
  files: z.array(PaveHopSchema).min(1).max(32),
  fileName: z.string().max(200),
  openedAt: iso,
  openedBy: id,
  /** The file was saved by another organisation or another install of Pavé. */
  elsewhere: z.boolean(),
})
export type PieceProvenance = z.infer<typeof PieceProvenanceSchema>

export const PieceSummarySchema = z.object({
  id,
  title: z.string(),
  kind: z.enum(PIECE_KINDS),
  stage: z.enum(STAGES),
  collectionId: id.nullable(),
  coverAssetId: id.nullable(),
  /** The cover is re-captured from the viewport as the design changes, until someone picks one. */
  coverAuto: z.boolean(),
  /** Cached facts from the last evaluation, for cards and tables. */
  facts: z
    .object({
      metalMassG: z.number(),
      caratTotal: z.number(),
      stoneCount: z.number(),
      metal: z.string(),
    })
    .nullable(),
  createdBy: id,
  createdAt: iso,
  updatedAt: iso,
})
export type PieceSummary = z.infer<typeof PieceSummarySchema>

export const PieceSchema = PieceSummarySchema.extend({
  /** Markdown brief. */
  brief: z.string(),
  spec: PieceSpecSchema.nullable(),
  /** Decisions made in Home before there is a complete spec. */
  intake: PieceIntakeSchema.optional(),
  design: DesignSchema,
  /** Sequence number of the last applied change; the optimistic-concurrency token. */
  version: z.number().int(),
  boardIds: z.array(id),
  /** Set for pieces started from a picture, logo, text, mesh, references or another piece. */
  origin: PieceOriginSchema.nullable(),
  /** The Design stage's alternatives, oldest first (see design/directions.ts). */
  directions: z.array(DirectionSchema),
  /** The direction the piece's design was last taken from; null when none was chosen. */
  chosenDirectionId: id.nullable(),
  /** Where the piece came from when it was opened from a .pave file; null otherwise. */
  provenance: PieceProvenanceSchema.nullable(),
})
export type Piece = z.infer<typeof PieceSchema>

export const StoredChangeSchema = ChangeSchema.extend({
  seq: z.number().int(),
  pieceId: id,
  /** Ids of the earlier changes this one undoes (set by `design.revert`, or an undo sent through `design.apply`). */
  reverts: z.array(id).optional(),
})
export type StoredChange = z.infer<typeof StoredChangeSchema>

// ── Assets ───────────────────────────────────────────────────────────────────────────────────

export const ASSET_KINDS = ['image', 'mesh', 'render', 'video', 'document', 'archive'] as const
export const AssetSchema = z.object({
  id,
  kind: z.enum(ASSET_KINDS),
  mime: z.string(),
  name: z.string(),
  bytes: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  /** Served from `/api/assets/:id` (and `/api/assets/:id?w=480` for image thumbnails). */
  url: z.string(),
  createdAt: iso,
})
export type Asset = z.infer<typeof AssetSchema>

// ── Ideate ───────────────────────────────────────────────────────────────────────────────────

export const BoardSchema = z.object({
  id,
  title: z.string(),
  icon: z.string().nullable(),
  description: z.string(),
  pieceId: id.nullable(),
  /**
   * Set on a piece's pinned references (the reference panel beside CAD): one such board per
   * piece, created on the first pin and not listed among the moodboards.
   */
  pinsFor: id.nullable(),
  coverAssetIds: z.array(id),
  referenceCount: z.number(),
  /** The image provider this board generates with; null = the organisation's default. */
  imageProvider: z.enum(IMAGE_PROVIDERS).nullable(),
  createdAt: iso,
  updatedAt: iso,
})
export type Board = z.infer<typeof BoardSchema>

/**
 * What we may do with a reference. Only `open`, `licensed` and `own` items are sent to
 * generative models by default; `viewOnly` items stay on the board as inspiration.
 */
export const RIGHTS = ['open', 'licensed', 'own', 'viewOnly'] as const
export type Rights = (typeof RIGHTS)[number]

/** What each rights tier allows, as the one sentence people read beside a reference's credit. */
export const RIGHTS_SENTENCE: Record<Rights, string> = {
  open: 'Open access: can be shown, kept and sent to AI.',
  licensed: 'Licensed: can be shown and sent to AI within the licence’s terms.',
  own: 'Yours: can be shown, kept and sent to AI.',
  viewOnly: 'View only: can be shown here as inspiration. Can’t be sent to AI.',
}

/** What a reference is for when it conditions an image generation. */
export const GENERATION_ROLES = ['subject', 'style', 'identity', 'layout', 'product'] as const
export type GenerationRole = (typeof GENERATION_ROLES)[number]

/** Where a reference sits on the board's free canvas (board units; `z` is the stacking order). */
export const CanvasPlacementSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  z: z.number().int(),
})
export type CanvasPlacement = z.infer<typeof CanvasPlacementSchema>

/** The CAD views a reference picture can be placed in as an image plane. */
export const IMAGE_PLANE_VIEWS = ['front', 'top', 'right'] as const
export type ImagePlaneView = (typeof IMAGE_PLANE_VIEWS)[number]

/**
 * A pinned picture laid in a CAD view to model over, like Rhino's Picture command. It belongs to
 * the viewport only: never part of the design, so never in renders, exports or the kernel.
 */
export const ImagePlaneSchema = z.object({
  view: z.enum(IMAGE_PLANE_VIEWS),
  /** The picture's centre in the view's own axes, in mm: front (x, z), top (x, y), right (y, z). */
  center: z.tuple([z.number(), z.number()]),
  /** The whole picture's width in mm; its height follows the picture's proportions. */
  width: z.number().positive().max(2000),
  opacity: z.number().min(0.05).max(1),
  /** A locked plane cannot be moved or scaled until it is unlocked. */
  locked: z.boolean(),
})
export type ImagePlane = z.infer<typeof ImagePlaneSchema>

/**
 * A parent of a generated image as it was when the image was made: its credit and rights
 * survive the parent being deleted.
 */
export const GenerationInputSchema = z.object({
  id,
  role: z.enum(GENERATION_ROLES).nullable(),
  title: z.string(),
  provider: z.string().nullable(),
  url: z.string().nullable(),
  credit: z.string().nullable(),
  license: z.string().nullable(),
  rights: z.enum(RIGHTS),
})
export type GenerationInput = z.infer<typeof GenerationInputSchema>

export const REFERENCE_TYPES = ['image', 'generated', 'note', 'link', 'swatch', 'model'] as const
export type ReferenceType = (typeof REFERENCE_TYPES)[number]

export const ReferenceSchema = z.object({
  id,
  boardId: id,
  /** `model` is a 3D file (STL, OBJ, GLB, 3MF, PLY) kept on a board as inspiration, view-only in 3D. */
  type: z.enum(REFERENCE_TYPES),
  assetId: id.nullable(),
  /** Remote thumbnail for unsaved search results. */
  thumbUrl: z.string().nullable(),
  title: z.string(),
  note: z.string(),
  /** Provenance: where it came from, who to credit, under what terms. Kept forever. */
  source: z
    .object({
      provider: z.string(),
      url: z.string().nullable(),
      credit: z.string().nullable(),
      license: z.string().nullable(),
      licenseUrl: z.string().nullable(),
      /** When the pixels were stored (on save, or by `references.capture`); null for links. */
      capturedAt: iso.nullable(),
    })
    .nullable(),
  /** The source of an independent copy made by a project moodboard import. */
  importedFrom: z.object({ sourceBoardId: id, sourceReferenceId: id }).optional(),
  rights: z.enum(RIGHTS),
  tags: z.array(z.string()),
  palette: z.array(z.string()),
  /** For generated items: the prompt, model, seed and the references it was conditioned on. */
  generation: z
    .object({
      prompt: z.string(),
      model: z.string(),
      seed: z.number().int().nullable(),
      /** What the person wrote, before Claude enhanced it into `prompt` (newer images only). */
      request: z.string().nullable().optional(),
      /** The brief the image was generated from, with its guardrail decisions. */
      briefId: id.nullable().optional(),
      provider: z.string().nullable().optional(),
      /** What this one image cost at the provider (USD). */
      costUsd: z.number().nullable().optional(),
      /** Walkable edges to the parents (which may since have been deleted). */
      parentIds: z.array(id),
      /** Snapshot of each parent at generation time, for credit lines. */
      inputs: z.array(GenerationInputSchema),
      runId: id.nullable(),
    })
    .nullable(),
  /** The piece this reference shows (a cover or render saved by "Explore from this piece"). */
  pieceId: id.nullable(),
  /** Placement on the board's canvas view; null until arranged there. */
  canvas: CanvasPlacementSchema.nullable(),
  /** For a piece's pinned picture: where it lies in a CAD view; null when not placed. */
  plane: ImagePlaneSchema.nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  /** Order in the masonry view and in the DOM, in both views. */
  position: z.number(),
  createdAt: iso,
})
export type Reference = z.infer<typeof ReferenceSchema>

export const SearchResultSchema = z.object({
  /** Stable within a search session. */
  key: z.string(),
  provider: z.string(),
  title: z.string(),
  thumbUrl: z.string(),
  imageUrl: z.string(),
  pageUrl: z.string().nullable(),
  credit: z.string().nullable(),
  license: z.string().nullable(),
  /** Where the licence or the provider's terms are written; absent from older clients. */
  licenseUrl: z.string().nullable().optional(),
  rights: z.enum(RIGHTS),
  /** The provider's terms let us store the pixels (CC0, public domain); otherwise only a link is kept. */
  mayStore: z.boolean(),
  width: z.number().nullable(),
  height: z.number().nullable(),
})
export type SearchResult = z.infer<typeof SearchResultSchema>

// ── Render ───────────────────────────────────────────────────────────────────────────────────

const Vec3 = z.tuple([z.number(), z.number(), z.number()])

/**
 * A declarative shot. @pave/render resolves it deterministically into an explicit job that both
 * the real-time viewport and a fixed Blender runner consume — the assistant edits this, it never
 * writes Python.
 */
/**
 * The camera and light moves an animation take can make: a seamless 360° turntable, a half
 * orbit round the front, a slow push-in, a macro sweep across the centre stone, a light sweep
 * that walks the sparkle across the stones, a short orbit arc and a rack focus.
 */
export const ANIMATION_TYPES = [
  'turntable',
  'half-orbit',
  'push-in',
  'macro-sweep',
  'light-sweep',
  'orbit-arc',
  'rack-focus',
] as const
export type AnimationType = (typeof ANIMATION_TYPES)[number]

export const RenderSceneSchema = z.object({
  pose: z.enum(['as-designed', 'circular-band']).optional().meta({
    title: 'Jewelry pose',
    description:
      'A render-only pose. Circular band arranges a straight row of separate links around a circle at their current scale. Each station stays rigid. As designed uses the saved CAD.',
  }),
  /** Import-only shots use source materials when no look is chosen. */
  importedBodyLook: z.enum(['source', 'clay']).optional().meta({
    description:
      'Visual appearance of unassigned imported bodies for this shot. Source uses their original material information. Clay is neutral.',
  }),
  includeUnassignedRhino: z.boolean().optional().meta({
    description:
      'Include visible unassigned Rhino bodies in this shot. This defaults on for pieces with only unassigned Rhino bodies. Choose importedBodyLook for source colors or clay. Confirmed materials, CAD roles, casting facts and exports are unaffected.',
  }),
  /** Lighting + staging recipe; see @pave/render for the catalogue. */
  look: z
    .enum([
      'studio-soft',
      'studio-contrast',
      'black-acrylic',
      'daylight',
      'editorial-warm',
      'catalog-white',
    ])
    .default('studio-soft')
    .meta({ title: 'Look', group: 'Look' }),
  camera: z
    .object({
      preset: z
        .enum(['hero', 'front', 'side', 'top', 'three-quarter', 'macro', 'custom'])
        .default('hero')
        .meta({
          title: 'Angle',
          group: 'Angle',
          description: 'Orbiting the view by hand sets `custom`.',
        }),
      /**
       * A custom camera (`preset: 'custom'`): where it stands and what it looks at, in the piece's
       * millimetres (Z up, the front faces −Y). Framing a shot in the viewfinder writes these.
       */
      position: Vec3.optional().meta({
        title: 'Camera position',
        unit: 'mm',
        widget: 'vec3',
        group: 'Angle',
        advanced: true,
      }),
      target: Vec3.optional().meta({
        title: 'Look at',
        unit: 'mm',
        widget: 'vec3',
        group: 'Angle',
        advanced: true,
      }),
      /** Turns the picture about its centre, degrees; positive turns it clockwise. */
      roll: z.number().min(-180).max(180).optional().meta({
        title: 'Roll',
        unit: 'deg',
        step: 1,
        group: 'Angle',
        advanced: true,
        description: 'Turns the picture about its centre; positive turns it clockwise.',
      }),
      /**
       * The piece's bounds centre and half-diagonal (mm) when the custom camera was set. On a
       * piece of another size (a house shot reused, or a design that grew) the camera scales and
       * moves with the piece; on the piece it was framed on it is used exactly as stored.
       */
      framedOn: z
        .object({ center: Vec3, radius: z.number().positive() })
        .optional()
        .meta({ title: 'Framed on', group: 'Angle', advanced: true }),
      /** The preset the custom camera started from, so Reset can go back to it. */
      basePreset: z
        .enum(['hero', 'front', 'side', 'top', 'three-quarter', 'macro'])
        .optional()
        .meta({ title: 'Started from', group: 'Angle', advanced: true }),
      /** A locked camera is not moved by the viewfinder or the assistant until a person unlocks it. */
      locked: z.boolean().optional().meta({
        title: 'Lock camera',
        group: 'Angle',
        description: 'Keeps the framing as it is: no orbiting, and the assistant cannot move it.',
      }),
      /** 35 mm-equivalent focal length. Jewelry reads best at 85–105. */
      focalLength: z
        .number()
        .min(18)
        .max(200)
        .default(90)
        .meta({ title: 'Lens', unit: 'mm', step: 1, group: 'Lens', widget: 'slider' }),
      /** f-stop for depth of field; omit for everything sharp. */
      fStop: z.number().min(0.8).max(32).optional().meta({
        title: 'Background blur',
        step: 0.1,
        group: 'Background blur',
        description: 'f-stop: lower blurs more. Leave unset to keep everything sharp.',
      }),
      focusNodeId: z.string().optional().meta({
        title: 'Focus on',
        group: 'Background blur',
        description: 'The feature kept sharp.',
      }),
    })
    .default({ preset: 'hero', focalLength: 90 })
    .meta({ title: 'Camera', group: 'Angle' }),
  environment: z
    .object({
      rotation: z.number().default(0).meta({
        title: 'Light direction',
        unit: 'deg',
        step: 1,
        group: 'Light direction',
        widget: 'slider',
      }),
      intensity: z
        .number()
        .min(0)
        .max(5)
        .default(1)
        .meta({ title: 'Brightness', step: 0.05, group: 'Light direction', widget: 'slider' }),
      background: z
        .enum(['look', 'transparent', 'white', 'black', 'color'])
        .default('look')
        .meta({ title: 'Backdrop', group: 'Backdrop' }),
      color: z
        .string()
        .optional()
        .meta({ title: 'Backdrop colour', group: 'Backdrop', when: { background: ['color'] } }),
    })
    .default({ rotation: 0, intensity: 1, background: 'look' })
    .meta({ title: 'Environment', group: 'Light direction' }),
  ground: z
    .enum(['look', 'none', 'shadow', 'sweep', 'reflective', 'white-gloss'])
    .default('look')
    .meta({
      title: 'Ground',
      group: 'Backdrop',
      description:
        'shadow = soft contact shadow only; sweep = seamless paper; reflective = black acrylic; white-gloss = pale floor with a soft reflection.',
    }),
  /** Extra small hard lights that pull fire out of diamonds. */
  sparkle: z.number().min(0).max(1).default(0.4).meta({
    title: 'Sparkle',
    step: 0.05,
    group: 'Sparkle',
    widget: 'slider',
    description: 'Extra small hard lights that pull fire out of diamonds.',
  }),
  /**
   * Per-node appearance overrides, e.g. render the same CAD in rose gold. Library ids only, so
   * an unknown material is a validation error rather than a silent fallback. The key `'*'`
   * means the whole piece: it applies under every node, and a node's own key wins over it.
   */
  overrides: z
    .record(
      z.string(),
      z.object({
        material: z.enum(METAL_IDS).optional().meta({ title: 'Metal', widget: 'metal' }),
        finish: z.enum(FINISH_IDS).optional().meta({ title: 'Finish', widget: 'finish' }),
        plating: z.enum(PLATING_IDS).optional().meta({ title: 'Plating', widget: 'plating' }),
        stone: z.enum(GEM_MATERIAL_IDS).optional().meta({ title: 'Stone', widget: 'stone' }),
      }),
    )
    .default({})
    .meta({
      title: 'Materials',
      group: 'Look',
      description:
        "Render in other materials without editing the CAD. Keyed by node id; '*' = the whole piece.",
    }),
  animation: z
    .object({
      type: z.enum(ANIMATION_TYPES).meta({ title: 'Motion' }),
      seconds: z.number().min(1).max(20).default(6).meta({ title: 'Length', unit: 's', step: 0.5 }),
      fps: z
        .number()
        .int()
        .min(12)
        .max(60)
        .default(30)
        .meta({ title: 'Frame rate', step: 1, advanced: true }),
      /**
       * Ends where it starts, so it plays round and round without a jump. A turntable always
       * loops (it turns a full circle); any other move goes there and comes back. Unset = the
       * motion's own default (only the turntable loops).
       */
      loop: z.boolean().optional().meta({
        title: 'Loop',
        description: 'Ends where it starts, so it plays round without a jump.',
      }),
    })
    .optional()
    .meta({ title: 'Motion', group: 'Motion', description: 'Leave unset for a still.' }),
  output: z
    .object({
      width: z
        .number()
        .int()
        .min(256)
        .max(8192)
        .default(2000)
        .meta({ title: 'Width', unit: 'px', step: 1 }),
      height: z
        .number()
        .int()
        .min(256)
        .max(8192)
        .default(2000)
        .meta({ title: 'Height', unit: 'px', step: 1 }),
      quality: z
        .enum(['preview', 'standard', 'final'])
        .default('standard')
        .meta({ title: 'Quality' }),
      device: z.enum(['auto', 'cpu']).optional().meta({
        title: 'Render device',
        description: 'Blender only. Auto uses the host setting. CPU runs this take on the CPU.',
      }),
    })
    .default({ width: 2000, height: 2000, quality: 'standard' })
    .meta({ title: 'Size', group: 'Size' }),
})
export type RenderScene = z.infer<typeof RenderSceneSchema>
export type RenderSceneInput = z.input<typeof RenderSceneSchema>

/** A shot saved for a piece, or (with no piece) one of the organisation's house shots. */
export const SavedSceneSchema = z.object({
  id,
  pieceId: id.nullable(),
  title: z.string(),
  scene: RenderSceneSchema,
  /** Order in the shot list. */
  position: z.number(),
  /**
   * The take this shot uses in the set (a person swapped it in); null = its newest finished take.
   */
  takeId: id.nullable(),
  updatedAt: iso,
})
export type SavedScene = z.infer<typeof SavedSceneSchema>

/**
 * One change to a saved shot, kept so it can be undone (by anyone, the assistant's included):
 * the scene before and after, and who made it. Undoing is itself a change that `reverts` it.
 */
export const SceneChangeSchema = z.object({
  id,
  sceneId: id,
  seq: z.number().int(),
  before: RenderSceneSchema,
  after: RenderSceneSchema,
  actor: ActorSchema,
  /** The change this one undoes, if it is an undo. */
  reverts: id.nullable(),
  /** Set when a later change undid this one. */
  revertedBy: id.nullable(),
  at: iso,
})
export type SceneChange = z.infer<typeof SceneChangeSchema>

/** One numeric fix the critique proposes: a scene path and the value to set it to. */
export const SceneAdjustmentSchema = z.object({
  path: z.enum([
    'camera.focalLength',
    'camera.preset',
    'environment.intensity',
    'output.quality',
    'sparkle',
  ]),
  value: z.union([z.number(), z.string()]),
})
export type SceneAdjustment = z.infer<typeof SceneAdjustmentSchema>

/** A measured problem with a render (framing, exposure, noise) and the adjustments that fix it. */
export const RenderIssueSchema = z.object({
  code: z.enum([
    'subject.missing',
    'framing.cropped',
    'framing.small',
    'framing.large',
    'framing.margin',
    'framing.offCentre',
    'exposure.clipped',
    'exposure.crushed',
    'exposure.dark',
    'exposure.bright',
    'noise.high',
    'noise.fireflies',
  ]),
  severity: z.enum(['error', 'warning']),
  message: z.string(),
  value: z.number(),
  limit: z.number(),
  adjust: z.array(SceneAdjustmentSchema),
})
export type RenderIssue = z.infer<typeof RenderIssueSchema>

export const JOB_STATUS = ['queued', 'running', 'done', 'failed', 'canceled'] as const
export type JobStatus = (typeof JOB_STATUS)[number]
/** Every kind of long-running job; `job.updated` events name one. */
export const JOB_KINDS = ['render', 'shot', 'production', 'mesh3d'] as const
export type JobKind = (typeof JOB_KINDS)[number]

export const RenderJobSchema = z.object({
  id,
  pieceId: id,
  title: z.string(),
  /** What was rendered: the requested scene after any numeric auto-tune. */
  scene: RenderSceneSchema,
  /** What was asked for, before auto-tune. */
  requestedScene: RenderSceneSchema,
  /** The saved shot this take came from, if any. */
  sceneId: id.nullable(),
  /** Takes queued together ("5 shots × 3 metals") share a group. */
  groupId: id.nullable(),
  /** e.g. "18k Rose Gold" for one cell of a variants matrix. */
  variantLabel: z.string().nullable(),
  /** `reference` renders feed on-model generation and are hidden from the takes list. */
  purpose: z.enum(['take', 'reference']),
  engine: z.enum(['blender', 'browser']),
  /** Numeric framing/exposure fixes may be applied in preview drafts before the final pass. */
  autoTune: z.boolean(),
  status: z.enum(JOB_STATUS),
  progress: z.number().min(0).max(1),
  /** Design version rendered, so stale renders can be flagged. */
  sourceVersion: z.number().int(),
  /**
   * Fingerprint of the exact resolved scene rendered (`sceneHash` in @pave/render): the same
   * hash means the same camera, light, materials and design version. Null until it has run.
   */
  sceneHash: z.string().nullable(),
  /** The piece has changed since this was rendered (server-computed). */
  stale: z.boolean(),
  /**
   * The take's files. A still: the image. An animation: the video (MP4, H.264) first, then a
   * poster still (its first frame), then a small looping GIF when one was made.
   */
  assetIds: z.array(id),
  /** The numeric critique: each preview draft, what it measured and what was adjusted. */
  critique: z
    .object({
      passes: z.array(
        z.object({
          adjustments: z.array(SceneAdjustmentSchema),
          issues: z.array(RenderIssueSchema),
          draftAssetId: id.nullable(),
        }),
      ),
    })
    .nullable(),
  /** The take this one re-renders (a retry, or the assistant acting on a vision critique). */
  retryOf: id.nullable(),
  /** Why it was re-rendered, in plain words ("warmer key"). */
  note: z.string().nullable(),
  starred: z.boolean(),
  /** Render time and the device that did it. */
  seconds: z.number().nullable(),
  device: z.string().nullable(),
  error: z.string().nullable(),
  actor: ActorSchema,
  /** The person who queued it (or whose assistant did): only their window renders a browser take. */
  createdBy: id.nullable(),
  createdAt: iso,
  finishedAt: iso.nullable(),
})
export type RenderJob = z.infer<typeof RenderJobSchema>

/** How long takes would keep this computer busy: machine time, never money. */
export const RenderEstimateSchema = z.object({
  engine: z.enum(['blender', 'browser']),
  /** All the takes together, in seconds. */
  seconds: z.number(),
  /** Each take, in the order asked. */
  takes: z.array(z.number()),
  /** `measured`: from this machine's finished takes; `typical`: a reference machine's rate. */
  basis: z.enum(['measured', 'typical', 'browser']),
  device: z.string().nullable(),
})
export type RenderEstimate = z.infer<typeof RenderEstimateSchema>

/** Whether Blender can be used on this machine, and if not, why. */
export const RenderEngineStatusSchema = z.object({
  available: z.boolean(),
  version: z.string().nullable(),
  /** e.g. "CPU", "NVIDIA RTX 4070 (OPTIX)". */
  device: z.string().nullable(),
  path: z.string().nullable(),
  /** Why it is unavailable, in plain words; null when available. */
  reason: z.string().nullable(),
})
export type RenderEngineStatus = z.infer<typeof RenderEngineStatusSchema>

/** Progress of the local, version-pinned Blender installation. */
export const RenderInstallStatusSchema = z.object({
  supported: z.boolean(),
  phase: z.enum([
    'checking',
    'idle',
    'downloading',
    'verifying',
    'extracting',
    'checkingEngine',
    'ready',
    'failed',
    'cancelled',
  ]),
  version: z.string(),
  downloadedBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  reason: z.string().nullable().optional(),
})
export type RenderInstallStatus = z.infer<typeof RenderInstallStatusSchema>

// ── Brand models ─────────────────────────────────────────────────────────────────────────────

/** Brand models are adults only. */
export const ADULT_AGE_RANGES = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'] as const
export const UNDERTONES = ['cool', 'neutral', 'warm', 'olive'] as const

export const BrandModelSchema = z.object({
  id,
  name: z.string(),
  /** The model card: the description that keeps generations consistent. Text only; no real person. */
  card: z.object({
    description: z.string(),
    ageRange: z.enum(ADULT_AGE_RANGES),
    skinTone: z.string(),
    /** Monk Skin Tone scale, 1 (lightest) – 10 (deepest). */
    monkTone: z.number().int().min(1).max(10).nullable(),
    undertone: z.enum(UNDERTONES).nullable(),
    hair: z.string(),
    eyes: z.string(),
    /** Freckles, moles, tattoos: details that keep the identity consistent across shots. */
    marks: z.string(),
    build: z.string(),
    styling: z.string(),
    /** Scale anchors so jewelry sits at true size. */
    ringSizeUs: z.number().nullable(),
    wristMm: z.number().nullable(),
    neckMm: z.number().nullable(),
    handLengthMm: z.number().positive().nullable(),
  }),
  /** Canonical portrait set, frozen once approved: face, hands, neck/ears, full body. */
  portraits: z.array(
    z.object({ view: z.enum(['face', 'hands', 'neck', 'ear', 'body']), assetId: id }),
  ),
  /** How the portraits were generated, so the set can be extended consistently. */
  recipe: z
    .object({ provider: z.string(), model: z.string(), seed: z.number().int().nullable() })
    .nullable(),
  /** Synthetic people only; the creator attests no real person's likeness is used. */
  attestedSynthetic: z.boolean(),
  status: z.enum(['draft', 'approved']),
  /** Bumped on each approval; shots record the version they used and go stale after a re-approval. */
  version: z.number().int(),
  approvedBy: id.nullable(),
  approvedAt: iso.nullable(),
  createdAt: iso,
})
export type BrandModel = z.infer<typeof BrandModelSchema>

export const IMAGE_ASPECTS = ['1:1', '4:5', '3:2', '16:9'] as const
export type ImageAspect = (typeof IMAGE_ASPECTS)[number]
/** The on-model pipeline: render CAD references → generate → verify against the CAD → label. */
export const SHOT_STAGES = ['references', 'generate', 'verify', 'label'] as const

export const ModelShotSchema = z.object({
  id,
  modelId: id,
  pieceId: id,
  assetId: id.nullable(),
  placement: z.enum(['hand', 'neck', 'ear', 'wrist']),
  direction: z.string(),
  aspect: z.enum(IMAGE_ASPECTS),
  /** concept = generative with CAD renders as references; composite = render-locked. */
  fidelity: z.enum(['concept', 'composite']),
  status: z.enum(JOB_STATUS),
  /** Where a queued or running shot is; null before it starts. */
  stage: z.enum(SHOT_STAGES).nullable(),
  attempts: z.number().int(),
  error: z.string().nullable(),
  /** Design and model versions used; the shot is stale once either moves on (server-computed). */
  sourceVersion: z.number().int(),
  modelVersion: z.number().int(),
  stale: z.boolean(),
  /** Result of the automated fidelity check against the design. Only a passed shot exports. */
  check: z
    .object({
      passed: z.boolean(),
      notes: z.string(),
      findings: z.array(
        z.object({
          /** e.g. `stones.hero`, `metal.color`, `pave.coverage`. */
          code: z.string(),
          ok: z.boolean(),
          expected: z.string().optional(),
          seen: z.string().optional(),
        }),
      ),
    })
    .nullable(),
  /** Everything needed to say how the image was made. */
  provenance: z
    .object({
      provider: z.string(),
      model: z.string(),
      seed: z.number().int().nullable(),
      prompt: z.string(),
      referenceRenderIds: z.array(id),
      portraitAssetIds: z.array(id),
      /** The visible disclosure label ("AI · Concept"). */
      disclosure: z.string(),
    })
    .nullable(),
  actor: ActorSchema,
  createdAt: iso,
})
export type ModelShot = z.infer<typeof ModelShotSchema>

// ── Image to 3D ──────────────────────────────────────────────────────────────────────────────

export const MESH_QUALITIES = ['draft', 'standard', 'ultra'] as const

/** An image-to-3D generation; the mesh feeds a `relief` (default) or `meshBody` node. */
export const MeshJobSchema = z.object({
  id,
  pieceId: id,
  status: z.enum(JOB_STATUS),
  progress: z.number().min(0).max(1),
  provider: z.string(),
  model: z.string().nullable(),
  quality: z.enum(MESH_QUALITIES),
  inputAssetIds: z.array(id),
  meshAssetId: id.nullable(),
  /** What it actually cost, once known. */
  costUsd: z.number().nullable(),
  error: z.string().nullable(),
  actor: ActorSchema,
  createdAt: iso,
  finishedAt: iso.nullable(),
})
export type MeshJob = z.infer<typeof MeshJobSchema>

// ── Production ───────────────────────────────────────────────────────────────────────────────

export const ProductionPackageSchema = z.object({
  id,
  pieceId: id,
  revision: z.number().int(),
  sourceVersion: z.number().int(),
  status: z.enum(JOB_STATUS),
  /** The zip bundle. */
  assetId: id.nullable(),
  /** Mirrors manifest.json inside the bundle. */
  manifest: z.record(z.string(), z.unknown()).nullable(),
  createdBy: id,
  createdAt: iso,
})
export type ProductionPackage = z.infer<typeof ProductionPackageSchema>

// ── Assistant & traces ───────────────────────────────────────────────────────────────────────

export const ThreadSchema = z.object({
  id,
  title: z.string(),
  /** What the conversation is about; tools default to this context. */
  context: z.object({ pieceId: id.nullable(), boardId: id.nullable(), sceneId: id.nullable() }),
  createdAt: iso,
  updatedAt: iso,
})
export type Thread = z.infer<typeof ThreadSchema>

export const MessageSchema = z.object({
  id,
  threadId: id,
  /** Position in the thread (1, 2, …): the order the model saw, stable for replay. */
  seq: z.number().int(),
  /** `system` messages carry context (piece, selection, version, designer edits) after a user turn. */
  role: z.enum(['user', 'assistant', 'system']),
  /** Provider-native content blocks (text, tool_use, tool_result, image). */
  content: z.array(z.record(z.string(), z.unknown())),
  runId: id.nullable(),
  createdAt: iso,
})
export type Message = z.infer<typeof MessageSchema>

/**
 * The assistant's model tiers, as a person picks them in the composer. Settings point each tier
 * at one model of the allow-list below; the default mapping and the prices live in @pave/agent.
 */
export const ASSISTANT_TIERS = ['power', 'standard', 'light'] as const
export type AssistantTier = (typeof ASSISTANT_TIERS)[number]

/** The models a tier may point at. Every request rule and price is keyed by these ids. */
export const ASSISTANT_MODELS = [
  'claude-fable-5-2',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
] as const
export type AssistantModelId = (typeof ASSISTANT_MODELS)[number]

export const RUN_STATUS = [
  'running',
  'done',
  'failed',
  'canceled',
  'awaiting-approval',
  /** An AI job a person paused (or took over, or edited by hand); Resume starts a run that replans. */
  'paused',
  /**
   * Waiting for work its tools started to finish (a render take), with no model call open; the
   * run goes on by itself when the work settles.
   */
  'waiting',
] as const
/** Why a run stopped short, so the UI can say what to do next. */
export const RUN_ERROR_CODES = [
  'rate_limited',
  'provider_auth',
  /** Claude's API could not be reached, or failed to answer. */
  'provider_unreachable',
  /** The tier's model cannot be used by this key or organisation (access, data retention). */
  'model_unavailable',
  'refusal',
  'interrupted',
  'budget_exceeded',
  'run_cap',
  'internal',
] as const

export const TokensSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
})
export type Tokens = z.infer<typeof TokensSchema>

/**
 * A piece moves through three stages, each done by hand or by an AI job: Design (directions),
 * CAD (design to CAD) and Render (CAD to renders).
 */
export const JOB_STAGES = ['design', 'cad', 'render'] as const
export type JobStage = (typeof JOB_STAGES)[number]

export const PLAN_STEP_STATES = ['pending', 'running', 'done', 'failed', 'skipped'] as const
export type PlanStepState = (typeof PLAN_STEP_STATES)[number]

/**
 * An AI job: an assistant run with a stage, a one-sentence goal and a short plan shown before
 * it starts. The server moves the plan along as the run's tool calls go (the stage's recipe in
 * @pave/agent says which tools belong to which step), so every window shows the same progress.
 * Its outputs are the design changes (and, later, directions and takes) its run made.
 */
export const AiJobSchema = z.object({
  stage: z.enum(JOB_STAGES),
  goal: z.string(),
  plan: z.array(z.object({ id: z.string(), label: z.string(), state: z.enum(PLAN_STEP_STATES) })),
  /** The job run this one carries on (Resume, a re-run step, a change asked for in review). */
  continues: id.nullable(),
  /** Set when the run ends well: its outputs wait for a person, who accepts them. */
  review: z.enum(['pending', 'accepted']).nullable(),
  /** Why a paused job stopped: a person paused it, took over, or edited the piece by hand. */
  pausedBy: z.enum(['pause', 'takeover', 'edit']).nullable(),
  /**
   * The machine time (seconds) the person saw in the Start popover for a Render job. The takes
   * the job approves on its own stay within it; anything beyond asks. Absent: a default budget.
   */
  machineSeconds: z.number().int().min(0).max(604_800).nullable().optional(),
  /**
   * What the person answered to the job's quick questions (chat.ask), under the step that asked,
   * so the plan shows what was settled and a resumed job does not ask again. Absent on jobs
   * stored before questions were recorded.
   */
  answers: z
    .array(
      z.object({
        stepId: z.string(),
        id: z.string(),
        question: z.string(),
        answer: z.string(),
        /** True when the person left the assistant's default as it was. */
        default: z.boolean(),
      }),
    )
    .optional(),
})
export type AiJob = z.infer<typeof AiJobSchema>
export type JobAnswer = NonNullable<AiJob['answers']>[number]

export const RunSchema = z.object({
  id,
  threadId: id.nullable(),
  pieceId: id.nullable(),
  userId: id,
  model: z.string(),
  /** The tier the run was asked for; null for MCP runs, which have no model of their own. */
  tier: z.enum(ASSISTANT_TIERS).nullable(),
  /** `mcp` runs collect the calls an outside agent makes over MCP. */
  origin: z.enum(['studio', 'mcp']),
  status: z.enum(RUN_STATUS),
  tokens: TokensSchema,
  costUsd: z.number(),
  startedAt: iso,
  endedAt: iso.nullable(),
  error: z.string().nullable(),
  errorCode: z.enum(RUN_ERROR_CODES).nullable(),
  /** Set when the run is an AI job (started from a stage, or continuing one). */
  job: AiJobSchema.nullable(),
  /**
   * The stage its spend is counted against: the job's stage, else the stage tab the message was
   * sent from; null for a run about no piece's stage (Home, MCP).
   */
  stage: z.enum(JOB_STAGES).nullable(),
})
export type Run = z.infer<typeof RunSchema>

export const STEP_STATUS = [
  'running',
  'awaiting-approval',
  /** The call started a job (a render take) and its result is the job's outcome, not yet in. */
  'waiting',
  'done',
  'failed',
  'denied',
  'canceled',
] as const

export const StepSchema = z.object({
  id,
  runId: id,
  index: z.number().int(),
  kind: z.enum(['model', 'tool']),
  name: z.string(),
  /** The model's tool-use id; unique within a run. Null for model steps. */
  toolCallId: id.nullable(),
  status: z.enum(STEP_STATUS),
  input: z.unknown(),
  output: z.unknown(),
  isError: z.boolean(),
  ms: z.number(),
  /** For `confirm` tools: when approval was asked for and how a person answered. */
  approval: z
    .object({
      requestedAt: iso,
      decision: z.enum(['approve', 'deny']).nullable(),
      decidedBy: id.nullable(),
      decidedAt: iso.nullable(),
      note: z.string().nullable(),
      /** For `chat.ask`: the options the person picked, by question id. */
      answers: z.record(z.string(), z.array(z.string())).optional(),
    })
    .nullable(),
  /** Model steps: tokens and cost of the call, and why the model stopped. */
  usage: TokensSchema.extend({ costUsd: z.number() }).nullable(),
  stopReason: z.string().nullable(),
  /** Design changes this step produced, linking agent traces to the edit history. */
  changeIds: z.array(id),
  startedAt: iso,
})
export type Step = z.infer<typeof StepSchema>

/**
 * Kinds of feedback. Design: thumbs, and an agent's change undone, corrected or removed. Render
 * (a person acting on a take or shot the assistant made): kept (set as the cover, or swapped
 * into the set), swapped (another take put in its place), starred and unstarred, deleted,
 * reframed (its camera moved), restyled (look, light, backdrop or materials changed) and
 * rerendered (rendered again by hand).
 */
export const FEEDBACK_KINDS = [
  'up',
  'down',
  'undone',
  'corrected',
  'removed',
  'kept',
  'swapped',
  'starred',
  'unstarred',
  'deleted',
  'reframed',
  'restyled',
  'rerendered',
] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

/**
 * Feedback on a run: explicit (thumbs, from a person) or implicit, read from the edit history —
 * an agent's change undone, corrected or removed by a person soon after.
 */
export const FeedbackSchema = z.object({
  id,
  runId: id,
  stepId: id.nullable(),
  source: z.enum(['explicit', 'implicit']),
  kind: z.enum(FEEDBACK_KINDS),
  /** The agent change the implicit feedback is about. */
  changeId: id.nullable(),
  /**
   * What a render signal is about: `render:<takeId>` or `scene:<sceneId>` (a take or shot the
   * assistant made); null for design feedback.
   */
  target: z.string().nullable(),
  /** A person's note, or what the implicit signal saw. */
  detail: z.string(),
  userId: id.nullable(),
  at: iso,
})
export type Feedback = z.infer<typeof FeedbackSchema>

// ── Quick questions ──────────────────────────────────────────────────────────────────────────

const choiceId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,31}$/, 'lowercase letters, digits and hyphens')

/**
 * One question the assistant asks as quick replies: two to six options, the good default
 * already picked, so the person can press Go without typing.
 */
export const QuickQuestionSchema = z
  .object({
    id: choiceId,
    question: z.string().min(1).max(120),
    options: z
      .array(
        z.object({
          id: choiceId,
          label: z.string().min(1).max(60),
          hint: z.string().max(120).optional(),
        }),
      )
      .min(2)
      .max(6),
    /** Several options may be picked (aspect ratios, animations); otherwise exactly one. */
    multiple: z.boolean().default(false),
    /** Picked before the person touches anything. */
    defaults: z.array(choiceId).min(1).max(6),
  })
  .refine((q) => q.defaults.every((d) => q.options.some((o) => o.id === d)), {
    message: 'Every default must be one of the options',
  })
  .refine((q) => q.multiple || q.defaults.length === 1, {
    message: 'A single-choice question has exactly one default',
  })
  .refine((q) => new Set(q.options.map((o) => o.id)).size === q.options.length, {
    message: 'Option ids must differ',
  })
export type QuickQuestion = z.infer<typeof QuickQuestionSchema>

/** What the person answered, question by question, in words the model reads. */
export const QuickAnswersSchema = z.object({
  answers: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      chosen: z.array(z.object({ id: z.string(), label: z.string() })),
      /** True when the person left the default as it was. */
      default: z.boolean(),
    }),
  ),
})
export type QuickAnswers = z.infer<typeof QuickAnswersSchema>

/**
 * Picks for each question, made whole: unknown option ids are dropped, a single-choice
 * question keeps one pick, and a question with no valid pick takes its defaults.
 */
export function resolveAnswers(
  questions: readonly QuickQuestion[],
  picks: Readonly<Record<string, readonly string[]>> | undefined,
): QuickAnswers {
  return {
    answers: questions.map((q) => {
      const valid = (picks?.[q.id] ?? []).filter(
        (id, i, all) => q.options.some((o) => o.id === id) && all.indexOf(id) === i,
      )
      const chosenIds = valid.length ? (q.multiple ? valid : valid.slice(0, 1)) : q.defaults
      const same =
        chosenIds.length === q.defaults.length && chosenIds.every((id) => q.defaults.includes(id))
      return {
        id: q.id,
        question: q.question,
        chosen: chosenIds.map((id) => ({ id, label: q.options.find((o) => o.id === id)!.label })),
        default: same,
      }
    }),
  }
}

// ── Usage ────────────────────────────────────────────────────────────────────────────────────

export const METERS = [
  'llm',
  'image',
  'search',
  'embedding',
  'mesh3d',
  'render',
  'storage',
] as const

export const UsageEventSchema = z.object({
  id,
  meter: z.enum(METERS),
  provider: z.string(),
  model: z.string().nullable(),
  quantity: z.number(),
  unit: z.string(),
  costUsd: z.number(),
  userId: id.nullable(),
  runId: id.nullable(),
  pieceId: id.nullable(),
  /** The project stage it was spent on (Design, CAD or Render); null when it was about none. */
  stage: z.enum(JOB_STAGES).nullable(),
  at: iso,
})
export type UsageEvent = z.infer<typeof UsageEventSchema>

// ── Projects: what each stage of a piece holds and has cost ─────────────────────────────────

/** One stage of a project, as its section on the project page and its column in lists. */
export const StageCostSchema = z.object({
  /** Claude runs counted against this stage, in USD. */
  aiUsd: z.number(),
  /** Paid image generations (Design only), in USD. */
  imageUsd: z.number(),
  /** Blender takes counted against the plan's render allowance (Render only). */
  rendersUsed: z.number().int(),
  /** Rhino and STEP exports counted against the plan's export allowance (CAD only). */
  exportsUsed: z.number().int(),
  /** What the stage holds: board items (Design), design changes (CAD), takes (Render). */
  items: z.number().int(),
})
export type StageCost = z.infer<typeof StageCostSchema>

export const ProjectCostSchema = z.object({
  pieceId: id,
  design: StageCostSchema,
  cad: StageCostSchema,
  render: StageCostSchema,
  /** Spend on the project no stage claims (a chat about it from Home): counted in the total. */
  otherUsd: z.number(),
  /** Everything paid for this project, in USD: AI and image generations. Renders and exports are counts. */
  totalUsd: z.number(),
})
export type ProjectCost = z.infer<typeof ProjectCostSchema>

/** A folder's totals, its sub-folders' projects included. */
export const FolderTotalSchema = z.object({
  collectionId: id,
  pieceCount: z.number().int(),
  totalUsd: z.number(),
  rendersUsed: z.number().int(),
  exportsUsed: z.number().int(),
})
export type FolderTotal = z.infer<typeof FolderTotalSchema>

/** What `pieces.estimate` says a spec would weigh and cost before anything is built. */
export const SpecEstimateSchema = z.object({
  metalMassG: z.number(),
  caratTotal: z.number(),
  stoneCount: z.number().int(),
  /** The main metal (an alloy id). */
  metal: z.string(),
  boundsMm: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  /** Rough cost to make at the production estimate's placeholder rates; null when it cannot price it. */
  costUsd: z.number().nullable(),
  /** Kernel warnings and the canon's findings about the spec, in plain words. */
  notes: z.array(z.string()),
})
export type SpecEstimate = z.infer<typeof SpecEstimateSchema>

/** Which optional capabilities this deployment has credentials for. */
export const CapabilitiesSchema = z.object({
  assistant: z.boolean(),
  imageSearch: z.array(z.string()),
  imageGeneration: z.array(z.string()),
  mesh3d: z.array(z.string()),
  blender: z.boolean(),
  sourcing: z.array(z.string()),
  /** Image understanding (subject flags, on-model checks). */
  vision: z.boolean(),
  /** Semantic similarity for references; without it `references.similar` matches tags and palette. */
  embedding: z.boolean(),
  /** Monocular depth for reliefs; without it height maps come from the silhouette and luminance. */
  depth: z.boolean(),
  /** On-model imaging providers (needs both image generation and vision). */
  onModel: z.array(z.string()),
  /** Exports carry signed C2PA content credentials. */
  c2pa: z.boolean(),
})
export type Capabilities = z.infer<typeof CapabilitiesSchema>
