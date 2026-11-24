/**
 * Stored entities as they cross the wire. The server's tables mirror these; every domain row
 * also carries `orgId` (tenancy) which is implied by the session and never sent by clients.
 */
import { z } from 'zod'
import { ActorSchema, ChangeSchema, DesignSchema, PIECE_KINDS } from '../design/design'
import { PieceSpecSchema } from '../design/spec'
import { GEM_MATERIAL_IDS } from '../domain/gems'
import { FINISH_IDS, METAL_IDS, PLATING_IDS } from '../domain/metals'

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

export const CollectionSchema = z.object({
  id,
  name: z.string(),
  icon: z.string().nullable(),
  position: z.number(),
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
  design: DesignSchema,
  /** Sequence number of the last applied change; the optimistic-concurrency token. */
  version: z.number().int(),
  boardIds: z.array(id),
  /** Set for pieces started from a picture, logo, text, mesh, references or another piece. */
  origin: PieceOriginSchema.nullable(),
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
  coverAssetIds: z.array(id),
  referenceCount: z.number(),
  createdAt: iso,
  updatedAt: iso,
})
export type Board = z.infer<typeof BoardSchema>

/**
 * What we may do with a reference. Only `open`, `licensed` and `own` items are sent to
 * generative models by default; `viewOnly` items stay on the board as inspiration.
 */
export const RIGHTS = ['open', 'licensed', 'own', 'viewOnly'] as const

/** What a reference is for when it conditions an image generation. */
export const GENERATION_ROLES = ['subject', 'style', 'identity', 'layout', 'product'] as const

/** Where a reference sits on the board's free canvas (board units; `z` is the stacking order). */
export const CanvasPlacementSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  z: z.number().int(),
})
export type CanvasPlacement = z.infer<typeof CanvasPlacementSchema>

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

export const ReferenceSchema = z.object({
  id,
  boardId: id,
  type: z.enum(['image', 'generated', 'note', 'link', 'swatch']),
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
  rights: z.enum(RIGHTS),
  tags: z.array(z.string()),
  palette: z.array(z.string()),
  /** For generated items: the prompt, model, seed and the references it was conditioned on. */
  generation: z
    .object({
      prompt: z.string(),
      model: z.string(),
      seed: z.number().int().nullable(),
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
export const RenderSceneSchema = z.object({
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
  /** `shadow` = soft contact shadow only, `sweep` = seamless paper, `reflective` = black acrylic. */
  ground: z.enum(['look', 'none', 'shadow', 'sweep', 'reflective']).default('look').meta({
    title: 'Ground',
    group: 'Backdrop',
    description:
      'shadow = soft contact shadow only; sweep = seamless paper; reflective = black acrylic.',
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
      type: z
        .enum(['turntable', 'orbit-arc', 'rack-focus', 'light-sweep', 'push-in'])
        .meta({ title: 'Motion' }),
      seconds: z.number().min(1).max(20).default(6).meta({ title: 'Length', unit: 's', step: 0.5 }),
      fps: z
        .number()
        .int()
        .min(12)
        .max(60)
        .default(30)
        .meta({ title: 'Frame rate', step: 1, advanced: true }),
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
  updatedAt: iso,
})
export type SavedScene = z.infer<typeof SavedSceneSchema>

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
  /** The piece has changed since this was rendered (server-computed). */
  stale: z.boolean(),
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
  createdAt: iso,
  finishedAt: iso.nullable(),
})
export type RenderJob = z.infer<typeof RenderJobSchema>

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

export const RUN_STATUS = ['running', 'done', 'failed', 'canceled', 'awaiting-approval'] as const
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
})
export type Run = z.infer<typeof RunSchema>

export const STEP_STATUS = [
  'running',
  'awaiting-approval',
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
 * Feedback on a run: explicit (thumbs, from a person) or implicit, read from the edit history —
 * an agent's change undone, corrected or removed by a person soon after.
 */
export const FeedbackSchema = z.object({
  id,
  runId: id,
  stepId: id.nullable(),
  source: z.enum(['explicit', 'implicit']),
  kind: z.enum(['up', 'down', 'undone', 'corrected', 'removed']),
  /** The agent change the implicit feedback is about. */
  changeId: id.nullable(),
  /** A person's note, or what the implicit signal saw. */
  detail: z.string(),
  userId: id.nullable(),
  at: iso,
})
export type Feedback = z.infer<typeof FeedbackSchema>

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
  at: iso,
})
export type UsageEvent = z.infer<typeof UsageEventSchema>

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
