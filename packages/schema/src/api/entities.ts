/**
 * Stored entities as they cross the wire. The server's tables mirror these; every domain row
 * also carries `orgId` (tenancy) which is implied by the session and never sent by clients.
 */
import { z } from 'zod'
import { ActorSchema, ChangeSchema, DesignSchema, PIECE_KINDS } from '../design/design'
import { PieceSpecSchema } from '../design/spec'

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

export const PieceSummarySchema = z.object({
  id,
  title: z.string(),
  kind: z.enum(PIECE_KINDS),
  stage: z.enum(STAGES),
  collectionId: id.nullable(),
  coverAssetId: id.nullable(),
  /** Cached facts from the last evaluation, for cards and tables. */
  facts: z
    .object({ metalMassG: z.number(), caratTotal: z.number(), stoneCount: z.number(), metal: z.string() })
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
})
export type Piece = z.infer<typeof PieceSchema>

export const StoredChangeSchema = ChangeSchema.extend({ seq: z.number().int(), pieceId: id })
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
    })
    .nullable(),
  rights: z.enum(RIGHTS),
  tags: z.array(z.string()),
  palette: z.array(z.string()),
  /** For generated items: the prompt, model and the references it was conditioned on. */
  generation: z
    .object({ prompt: z.string(), model: z.string(), parentIds: z.array(id), runId: id.nullable() })
    .nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
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
  width: z.number().nullable(),
  height: z.number().nullable(),
})
export type SearchResult = z.infer<typeof SearchResultSchema>

// ── Render ───────────────────────────────────────────────────────────────────────────────────

const Vec3 = z.tuple([z.number(), z.number(), z.number()])

/**
 * A declarative shot. The same scene drives the real-time viewport and is compiled
 * deterministically to a Blender script by @pave/render — the assistant edits this, it never
 * writes Python.
 */
export const RenderSceneSchema = z.object({
  /** Lighting + staging recipe; see @pave/render for the catalogue. */
  look: z
    .enum(['studio-soft', 'studio-contrast', 'black-acrylic', 'daylight', 'editorial-warm', 'catalog-white'])
    .default('studio-soft'),
  camera: z
    .object({
      preset: z.enum(['hero', 'front', 'side', 'top', 'three-quarter', 'macro', 'custom']).default('hero'),
      position: Vec3.optional(),
      target: Vec3.optional(),
      /** 35 mm-equivalent focal length. Jewelry reads best at 85–105. */
      focalLength: z.number().min(18).max(200).default(90),
      /** f-stop for depth of field; omit for everything sharp. */
      fStop: z.number().min(0.8).max(32).optional(),
      focusNodeId: z.string().optional(),
    })
    .default({ preset: 'hero', focalLength: 90 }),
  environment: z
    .object({
      rotation: z.number().default(0),
      intensity: z.number().min(0).max(5).default(1),
      background: z.enum(['look', 'transparent', 'white', 'black', 'color']).default('look'),
      color: z.string().optional(),
    })
    .default({ rotation: 0, intensity: 1, background: 'look' }),
  ground: z.enum(['look', 'none', 'shadow', 'reflective']).default('look'),
  /** Extra small hard lights that pull fire out of diamonds. */
  sparkle: z.number().min(0).max(1).default(0.4),
  /** Per-node appearance overrides, e.g. render the same CAD in rose gold. */
  overrides: z
    .record(z.string(), z.object({ material: z.string().optional(), finish: z.string().optional(), stone: z.string().optional() }))
    .default({}),
  animation: z
    .object({
      type: z.enum(['turntable', 'orbit-arc', 'rack-focus', 'light-sweep', 'push-in']),
      seconds: z.number().min(1).max(20).default(6),
      fps: z.number().int().min(12).max(60).default(30),
    })
    .optional(),
  output: z
    .object({
      width: z.number().int().min(256).max(8192).default(2000),
      height: z.number().int().min(256).max(8192).default(2000),
      quality: z.enum(['preview', 'standard', 'final']).default('standard'),
    })
    .default({ width: 2000, height: 2000, quality: 'standard' }),
})
export type RenderScene = z.infer<typeof RenderSceneSchema>
export type RenderSceneInput = z.input<typeof RenderSceneSchema>

export const JOB_STATUS = ['queued', 'running', 'done', 'failed', 'canceled'] as const

export const RenderJobSchema = z.object({
  id,
  pieceId: id,
  title: z.string(),
  scene: RenderSceneSchema,
  engine: z.enum(['blender', 'browser']),
  status: z.enum(JOB_STATUS),
  progress: z.number().min(0).max(1),
  /** Design version rendered, so stale renders can be flagged. */
  sourceVersion: z.number().int(),
  assetIds: z.array(id),
  error: z.string().nullable(),
  actor: ActorSchema,
  createdAt: iso,
  finishedAt: iso.nullable(),
})
export type RenderJob = z.infer<typeof RenderJobSchema>

// ── Brand models ─────────────────────────────────────────────────────────────────────────────

export const BrandModelSchema = z.object({
  id,
  name: z.string(),
  /** The model card: the description that keeps generations consistent. */
  card: z.object({
    description: z.string(),
    ageRange: z.string(),
    skinTone: z.string(),
    hair: z.string(),
    build: z.string(),
    styling: z.string(),
    /** Scale anchors so jewelry sits at true size. */
    ringSizeUs: z.number().nullable(),
    wristMm: z.number().nullable(),
    neckMm: z.number().nullable(),
  }),
  /** Canonical portrait set, frozen once approved: face, hands, neck/ears, full body. */
  portraits: z.array(z.object({ view: z.enum(['face', 'hands', 'neck', 'ear', 'body']), assetId: id })),
  /** Synthetic people only; the creator attests no real person's likeness is used. */
  attestedSynthetic: z.boolean(),
  status: z.enum(['draft', 'approved']),
  createdAt: iso,
})
export type BrandModel = z.infer<typeof BrandModelSchema>

export const ModelShotSchema = z.object({
  id,
  modelId: id,
  pieceId: id,
  assetId: id.nullable(),
  placement: z.enum(['hand', 'neck', 'ear', 'wrist']),
  direction: z.string(),
  /** concept = generative with CAD renders as references; composite = render-locked. */
  fidelity: z.enum(['concept', 'composite']),
  status: z.enum(JOB_STATUS),
  /** Result of the automated fidelity check against the design. */
  check: z.object({ passed: z.boolean(), notes: z.string() }).nullable(),
  createdAt: iso,
})
export type ModelShot = z.infer<typeof ModelShotSchema>

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
  context: z.object({ pieceId: id.nullable(), boardId: id.nullable() }),
  createdAt: iso,
  updatedAt: iso,
})
export type Thread = z.infer<typeof ThreadSchema>

export const MessageSchema = z.object({
  id,
  threadId: id,
  role: z.enum(['user', 'assistant']),
  /** Provider-native content blocks (text, tool_use, tool_result, image). */
  content: z.array(z.record(z.string(), z.unknown())),
  runId: id.nullable(),
  createdAt: iso,
})
export type Message = z.infer<typeof MessageSchema>

export const RunSchema = z.object({
  id,
  threadId: id.nullable(),
  pieceId: id.nullable(),
  userId: id,
  model: z.string(),
  status: z.enum(['running', 'done', 'failed', 'canceled', 'awaiting-approval']),
  tokens: z.object({ input: z.number(), output: z.number(), cacheRead: z.number(), cacheWrite: z.number() }),
  costUsd: z.number(),
  startedAt: iso,
  endedAt: iso.nullable(),
  error: z.string().nullable(),
})
export type Run = z.infer<typeof RunSchema>

export const StepSchema = z.object({
  id,
  runId: id,
  index: z.number().int(),
  kind: z.enum(['model', 'tool']),
  name: z.string(),
  input: z.unknown(),
  output: z.unknown(),
  isError: z.boolean(),
  ms: z.number(),
  /** Design changes this step produced, linking agent traces to the edit history. */
  changeIds: z.array(id),
  startedAt: iso,
})
export type Step = z.infer<typeof StepSchema>

// ── Usage ────────────────────────────────────────────────────────────────────────────────────

export const METERS = ['llm', 'image', 'search', 'embedding', 'mesh3d', 'render', 'storage'] as const

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
})
export type Capabilities = z.infer<typeof CapabilitiesSchema>
