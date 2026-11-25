/**
 * Domain tables. Every row carries `org_id` and is only ever read or written through the
 * org-scoped repository (src/repo). Enumerations are plain text typed from @pave/schema so the
 * contract stays the single source of truth; imports here are type-only so drizzle-kit can load
 * this file without resolving workspace packages.
 */
import type {
  Actor,
  AiJob,
  Allowance,
  AssistantModelId,
  AssistantTier,
  BrandModel,
  CommandParsedInput,
  Design,
  Feedback,
  GuardrailDecision,
  ImageBrief,
  ImageProviderId,
  ImageQuality,
  JOB_STATUS,
  JobStage,
  KeyedImageProvider,
  METERS,
  MeshJob,
  Message,
  ModelShot,
  Op,
  PieceKind,
  PieceOrigin,
  PieceProvenance,
  PieceSpec,
  PieceSummary,
  PlanName,
  Reference,
  RenderJob,
  RenderScene,
  Run,
  Stage,
  Step,
  StoredDirection,
} from '@pave/schema'
import {
  type AnyPgColumn,
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { organization, user } from './auth'

type JobStatus = (typeof JOB_STATUS)[number]
type Meter = (typeof METERS)[number]

const at = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow()
const orgId = () =>
  text('org_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' })

export const orgSettings = pgTable('org_settings', {
  orgId: orgId().primaryKey(),
  traceRetentionDays: integer('trace_retention_days').notNull().default(90),
  allowEvalUse: boolean('allow_eval_use').notNull().default(false),
  /** The tier new conversations start on; null = Standard. */
  assistantTier: text('assistant_tier').$type<AssistantTier>(),
  /** Model per tier; a missing or null entry = that tier's default model. */
  assistantModels: jsonb('assistant_models')
    .$type<Partial<Record<AssistantTier, AssistantModelId | null>>>()
    .notNull()
    .default({}),
  monthlyBudgetUsd: doublePrecision('monthly_budget_usd'),
  /** The organisation's plan; null = the default (Free). Set by billing, not by members. */
  plan: text('plan').$type<PlanName>(),
  /** The image provider boards use unless one picks another; null = the first with a key. */
  imageProvider: text('image_provider').$type<ImageProviderId>(),
  /** How much to spend per generated image; null = standard. */
  imageQuality: text('image_quality').$type<ImageQuality>(),
  /** Model per image provider; a missing or null entry = that provider's default model. */
  imageModels: jsonb('image_models')
    .$type<Partial<Record<KeyedImageProvider, string | null>>>()
    .notNull()
    .default({}),
  /** Set once the welcome workspace has been created, so deleting it does not bring it back. */
  welcomeSeededAt: timestamp('welcome_seeded_at', { withTimezone: true }),
  updatedAt: at('updated_at'),
})

/**
 * The organisation's Claude API key, sealed with AES-256-GCM under a key derived from the
 * server's auth secret (which never enters the database), so a database file, dump or backup
 * alone does not give the key away. One row per organisation.
 */
export const assistantKey = pgTable('assistant_key', {
  orgId: orgId().primaryKey(),
  /** base64(iv ‖ tag ‖ ciphertext). */
  sealed: text('sealed').notNull(),
  /** Shown to owners and admins so they can tell keys apart. */
  last4: text('last4').notNull(),
  updatedBy: text('updated_by'),
  updatedAt: at('updated_at'),
})

/**
 * Image providers' API keys (Gemini, OpenAI, Higgsfield), sealed like the Claude key: one row per
 * organisation and provider.
 */
export const imageKey = pgTable(
  'image_key',
  {
    orgId: orgId(),
    provider: text('provider').$type<KeyedImageProvider>().notNull(),
    /** base64(iv ‖ tag ‖ ciphertext). */
    sealed: text('sealed').notNull(),
    last4: text('last4').notNull(),
    updatedBy: text('updated_by'),
    updatedAt: at('updated_at'),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.provider] })],
)

export const collection = pgTable(
  'collection',
  {
    id: text('id').primaryKey(),
    orgId: orgId(),
    name: text('name').notNull(),
    icon: text('icon'),
    position: doublePrecision('position').notNull(),
    /** The folder this one sits in (two levels at most, checked by the handler). */
    parentId: text('parent_id').references((): AnyPgColumn => collection.id, {
      onDelete: 'set null',
    }),
    createdAt: at('created_at'),
    updatedAt: at('updated_at'),
  },
  (t) => [index('collection_org_idx').on(t.orgId, t.position)],
)

export const piece = pgTable(
  'piece',
  {
    id: text('id').primaryKey(),
    orgId: orgId(),
    collectionId: text('collection_id').references(() => collection.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    kind: text('kind').$type<PieceKind>().notNull(),
    stage: text('stage').$type<Stage>().notNull(),
    brief: text('brief').notNull().default(''),
    spec: jsonb('spec').$type<PieceSpec>(),
    design: jsonb('design').$type<Design>().notNull(),
    version: integer('version').notNull().default(0),
    coverAssetId: text('cover_asset_id'),
    coverAuto: boolean('cover_auto').notNull().default(true),
    origin: jsonb('origin').$type<PieceOrigin>(),
    facts: jsonb('facts').$type<NonNullable<PieceSummary['facts']>>(),
    /** The Design stage's alternatives, each with the design built for it. */
    directions: jsonb('directions').$type<StoredDirection[]>().notNull().default([]),
    chosenDirectionId: text('chosen_direction_id'),
    /** How many directions were ever proposed: the next one's letter, so letters are not reused. */
    directionCount: integer('direction_count').notNull().default(0),
    /** Where the piece came from when it was opened from a .pave file. */
    provenance: jsonb('provenance').$type<PieceProvenance>(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: at('created_at'),
    updatedAt: at('updated_at'),
  },
  (t) => [
    index('piece_org_updated_idx').on(t.orgId, t.updatedAt),
    index('piece_collection_idx').on(t.collectionId),
  ],
)

/** The design op log: one row per atomic, attributed, invertible change. */
export const designChange = pgTable(
  'design_change',
  {
    id: text('id').notNull(),
    orgId: orgId(),
    pieceId: text('piece_id')
      .notNull()
      .references(() => piece.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    ops: jsonb('ops').$type<Op[]>().notNull(),
    inverse: jsonb('inverse').$type<Op[]>().notNull(),
    actor: jsonb('actor').$type<Actor>().notNull(),
    // Denormalised from `actor` so traces and implicit feedback can be queried by column.
    actorType: text('actor_type').$type<Actor['type']>().notNull(),
    actorUserId: text('actor_user_id'),
    runId: text('run_id'),
    toolCallId: text('tool_call_id'),
    label: text('label').notNull(),
    /** Ids of the earlier changes this one undoes. */
    reverts: jsonb('reverts').$type<string[]>().notNull().default([]),
    at: at('at'),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('design_change_piece_seq_idx').on(t.pieceId, t.seq),
    index('design_change_run_idx').on(t.runId),
  ],
)

export const blob = pgTable(
  'blob',
  {
    orgId: orgId(),
    sha256: text('sha256').notNull(),
    size: integer('size').notNull(),
    mime: text('mime').notNull(),
    createdAt: at('created_at'),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.sha256] })],
)

export const asset = pgTable(
  'asset',
  {
    id: text('id').primaryKey(),
    orgId: orgId(),
    sha256: text('sha256').notNull(),
    kind: text('kind')
      .$type<'image' | 'mesh' | 'render' | 'video' | 'document' | 'archive'>()
      .notNull(),
    mime: text('mime').notNull(),
    name: text('name').notNull(),
    bytes: integer('bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    /** Where the server fetched the bytes from (a captured link or search result); null for uploads and outputs. */
    capturedFrom: text('captured_from'),
    createdBy: text('created_by'),
    createdAt: at('created_at'),
  },
  (t) => [index('asset_org_idx').on(t.orgId, t.createdAt)],
)

/** Derived renditions of an asset (thumbnails), each stored as its own blob. */
export const assetVariant = pgTable(
  'asset_variant',
  {
    orgId: orgId(),
    assetId: text('asset_id')
      .notNull()
      .references(() => asset.id, { onDelete: 'cascade' }),
    variant: text('variant').notNull(),
    sha256: text('sha256').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.variant] })],
)

export const board = pgTable(
  'board',
  {
    id: text('id').primaryKey(),
    orgId: orgId(),
    pieceId: text('piece_id').references(() => piece.id, { onDelete: 'set null' }),
    /** The piece whose pinned references this board holds; they go with the piece. */
    pinsFor: text('pins_for').references(() => piece.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    icon: text('icon'),
    /** The image provider this board generates with; null = the organisation's default. */
    imageProvider: text('image_provider').$type<ImageProviderId>(),
    createdAt: at('created_at'),
    updatedAt: at('updated_at'),
  },
  (t) => [
    index('board_org_idx').on(t.orgId, t.updatedAt),
    index('board_piece_idx').on(t.pieceId),
    // One pin board per piece: two windows pinning at once race to create it, and this decides.
    uniqueIndex('board_pins_for_idx').on(t.pinsFor),
  ],
)

export const reference = pgTable(
  'reference',
  {
    id: text('id').primaryKey(),
    orgId: orgId(),
    boardId: text('board_id')
      .notNull()
      .references(() => board.id, { onDelete: 'cascade' }),
    type: text('type').$type<Reference['type']>().notNull(),
    assetId: text('asset_id'),
    thumbUrl: text('thumb_url'),
    title: text('title').notNull().default(''),
    note: text('note').notNull().default(''),
    source: jsonb('source').$type<Reference['source']>(),
    rights: text('rights').$type<Reference['rights']>().notNull(),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    palette: jsonb('palette').$type<string[]>().notNull().default([]),
    generation: jsonb('generation').$type<Reference['generation']>(),
    pieceId: text('piece_id').references(() => piece.id, { onDelete: 'set null' }),
    canvas: jsonb('canvas').$type<Reference['canvas']>(),
    plane: jsonb('plane').$type<Reference['plane']>(),
    width: integer('width'),
    height: integer('height'),
    position: doublePrecision('position').notNull(),
    createdAt: at('created_at'),
  },
  (t) => [index('reference_board_idx').on(t.boardId, t.position)],
)

/**
 * A generation request as Claude understood it: the guardrail's verdict, the enhanced prompt, and
 * every decision since (the check of the request, each image's check, the provider's own filter).
 * It is the trace of what was allowed and refused; refused images themselves are never stored.
 */
export const imageBrief = pgTable(
  'image_brief',
  {
    id: text('id').primaryKey(),
    orgId: orgId(),
    boardId: text('board_id')
      .notNull()
      .references(() => board.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    /** The assistant run that asked, when one did. */
    runId: text('run_id'),
    request: text('request').notNull(),
    mode: text('mode').$type<ImageBrief['mode']>().notNull(),
    parentId: text('parent_id'),
    referenceIds: jsonb('reference_ids').$type<string[]>().notNull().default([]),
    roles: jsonb('roles').$type<{ id: string; role: string }[]>().notNull().default([]),
    verdict: text('verdict').$type<ImageBrief['verdict']>().notNull(),
    category: text('category').$type<ImageBrief['category']>(),
    reason: text('reason').notNull(),
    rightsSubject: text('rights_subject'),
    attestation: jsonb('attestation').$type<ImageBrief['attestation']>(),
    understanding: text('understanding').notNull(),
    piece: jsonb('piece').$type<ImageBrief['piece']>().notNull(),
    prompt: text('prompt').notNull(),
    aspect: text('aspect').$type<ImageBrief['aspect']>().notNull(),
    provider: text('provider').$type<ImageProviderId>().notNull(),
    model: text('model').notNull(),
    claudeModel: text('claude_model').notNull(),
    claudeMicros: bigint('claude_micros', { mode: 'number' }).notNull().default(0),
    decisions: jsonb('decisions').$type<GuardrailDecision[]>().notNull().default([]),
    generations: integer('generations').notNull().default(0),
    createdAt: at('created_at'),
  },
  (t) => [index('image_brief_board_idx').on(t.boardId, t.createdAt)],
)

/** Saved shots: per piece, or the org's house shots when `piece_id` is null. */
export const renderScene = pgTable(
  'render_scene',
  {
    id: text('id').primaryKey(),
    orgId: orgId(),
    pieceId: text('piece_id').references(() => piece.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    scene: jsonb('scene').$type<RenderScene>().notNull(),
    position: doublePrecision('position').notNull(),
    /** The take a person put in the set for this shot; null = the shot's newest finished take. */
    takeId: text('take_id'),
    createdBy: text('created_by').notNull(),
    /** Who made the shot: a person, or an assistant run (so changes to it count as feedback). */
    actor: jsonb('actor').$type<Actor>(),
    createdAt: at('created_at'),
    updatedAt: at('updated_at'),
  },
  (t) => [index('render_scene_piece_idx').on(t.orgId, t.pieceId, t.position)],
)

/** Every change to a saved shot, so any of them can be undone (see `scenes.revert`). */
export const renderSceneChange = pgTable(
  'render_scene_change',
  {
    id: text('id').primaryKey(),
    orgId: orgId(),
    sceneId: text('scene_id')
      .notNull()
      .references(() => renderScene.id, { onDelete: 'cascade' }),
    /** 1, 2, … per shot; the unique index decides two writers racing on one shot. */
    seq: integer('seq').notNull(),
    before: jsonb('before').$type<RenderScene>().notNull(),
    after: jsonb('after').$type<RenderScene>().notNull(),
    actor: jsonb('actor').$type<Actor>().notNull(),
    /** The change this one undoes. */
    reverts: text('reverts'),
    /** The later change that undid this one. */
    revertedBy: text('reverted_by'),
    at: at('at'),
  },
  (t) => [uniqueIndex('render_scene_change_seq_idx').on(t.sceneId, t.seq)],
)

export const renderJob = pgTable(
  'render_job',
  {
    id: text('id').primaryKey(),
    orgId: orgId(),
    pieceId: text('piece_id')
      .notNull()
      .references(() => piece.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    scene: jsonb('scene').$type<RenderScene>().notNull(),
    /** Null on jobs from before auto-tune existed, where it equals `scene`. */
    requestedScene: jsonb('requested_scene').$type<RenderScene>(),
    sceneId: text('scene_id').references(() => renderScene.id, { onDelete: 'set null' }),
    groupId: text('group_id'),
    variantLabel: text('variant_label'),
    purpose: text('purpose').$type<RenderJob['purpose']>().notNull().default('take'),
    engine: text('engine').$type<RenderJob['engine']>().notNull(),
    autoTune: boolean('auto_tune').notNull().default(true),
    status: text('status').$type<JobStatus>().notNull(),
    progress: doublePrecision('progress').notNull().default(0),
    sourceVersion: integer('source_version').notNull(),
    assetIds: jsonb('asset_ids').$type<string[]>().notNull().default([]),
    critique: jsonb('critique').$type<RenderJob['critique']>(),
    retryOf: text('retry_of'),
    note: text('note'),
    starred: boolean('starred').notNull().default(false),
    seconds: doublePrecision('seconds'),
    device: text('device'),
    /** Set by the queue: sha256 of piece, version, requested scene, engine and runner version. */
    cacheKey: text('cache_key'),
    /** `sceneHash` of the resolved scene rendered; set when the take finishes. */
    sceneHash: text('scene_hash'),
    error: text('error'),
    actor: jsonb('actor').$type<Actor>().notNull(),
    /** The user who queued it (for an agent actor, the user it acts for). Null on older rows. */
    createdBy: text('created_by'),
    createdAt: at('created_at'),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('render_job_org_idx').on(t.orgId, t.createdAt),
    index('render_job_piece_idx').on(t.pieceId),
    index('render_job_cache_idx').on(t.orgId, t.cacheKey),
  ],
)

export const brandModel = pgTable('brand_model', {
  id: text('id').primaryKey(),
  orgId: orgId(),
  name: text('name').notNull(),
  card: jsonb('card').$type<BrandModel['card']>().notNull(),
  portraits: jsonb('portraits').$type<BrandModel['portraits']>().notNull().default([]),
  recipe: jsonb('recipe').$type<BrandModel['recipe']>(),
  attestedSynthetic: boolean('attested_synthetic').notNull(),
  status: text('status').$type<BrandModel['status']>().notNull(),
  version: integer('version').notNull().default(0),
  approvedBy: text('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt: at('created_at'),
  updatedAt: at('updated_at'),
})

export const modelShot = pgTable(
  'model_shot',
  {
    id: text('id').primaryKey(),
    orgId: orgId(),
    modelId: text('model_id')
      .notNull()
      .references(() => brandModel.id, { onDelete: 'cascade' }),
    pieceId: text('piece_id')
      .notNull()
      .references(() => piece.id, { onDelete: 'cascade' }),
    assetId: text('asset_id'),
    placement: text('placement').$type<ModelShot['placement']>().notNull(),
    direction: text('direction').notNull().default(''),
    aspect: text('aspect').$type<ModelShot['aspect']>().notNull().default('4:5'),
    fidelity: text('fidelity').$type<ModelShot['fidelity']>().notNull(),
    status: text('status').$type<JobStatus>().notNull(),
    stage: text('stage').$type<NonNullable<ModelShot['stage']>>(),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    sourceVersion: integer('source_version').notNull().default(0),
    modelVersion: integer('model_version').notNull().default(0),
    check: jsonb('check').$type<ModelShot['check']>(),
    provenance: jsonb('provenance').$type<ModelShot['provenance']>(),
    /** Null on rows from before shots were attributed. */
    actor: jsonb('actor').$type<Actor>(),
    /** The user who asked (for an agent actor, the user it acts for). Null on older rows. */
    createdBy: text('created_by'),
    createdAt: at('created_at'),
  },
  (t) => [index('model_shot_org_idx').on(t.orgId, t.createdAt)],
)

/** Image-to-3D jobs. `provider_job_id` lets polling resume after a restart. */
export const meshJob = pgTable(
  'mesh_job',
  {
    id: text('id').primaryKey(),
    orgId: orgId(),
    pieceId: text('piece_id')
      .notNull()
      .references(() => piece.id, { onDelete: 'cascade' }),
    status: text('status').$type<JobStatus>().notNull(),
    progress: doublePrecision('progress').notNull().default(0),
    provider: text('provider').notNull(),
    model: text('model'),
    quality: text('quality').$type<MeshJob['quality']>().notNull(),
    inputAssetIds: jsonb('input_asset_ids').$type<string[]>().notNull(),
    meshAssetId: text('mesh_asset_id'),
    providerJobId: text('provider_job_id'),
    costMicros: bigint('cost_micros', { mode: 'number' }),
    error: text('error'),
    actor: jsonb('actor').$type<Actor>().notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: at('created_at'),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('mesh_job_piece_idx').on(t.orgId, t.pieceId, t.createdAt)],
)

export const productionPackage = pgTable(
  'production_package',
  {
    id: text('id').primaryKey(),
    orgId: orgId(),
    pieceId: text('piece_id')
      .notNull()
      .references(() => piece.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    sourceVersion: integer('source_version').notNull(),
    status: text('status').$type<JobStatus>().notNull(),
    assetId: text('asset_id'),
    manifest: jsonb('manifest').$type<Record<string, unknown>>(),
    /** What was asked for (quantity, notes, rates), so a build cut off by a restart can resume. */
    request: jsonb('request').$type<Omit<CommandParsedInput<'production.create'>, 'pieceId'>>(),
    createdBy: text('created_by').notNull(),
    createdAt: at('created_at'),
  },
  (t) => [uniqueIndex('production_package_piece_rev_idx').on(t.pieceId, t.revision)],
)

// ── Assistant & traces ───────────────────────────────────────────────────────────────────────

export const thread = pgTable(
  'thread',
  {
    id: text('id').primaryKey(),
    orgId: orgId(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    pieceId: text('piece_id').references(() => piece.id, { onDelete: 'set null' }),
    boardId: text('board_id').references(() => board.id, { onDelete: 'set null' }),
    sceneId: text('scene_id').references(() => renderScene.id, { onDelete: 'set null' }),
    /** Hash of the frozen system prompt and tool list the thread was started with. */
    promptHash: text('prompt_hash'),
    createdAt: at('created_at'),
    updatedAt: at('updated_at'),
  },
  (t) => [index('thread_org_idx').on(t.orgId, t.updatedAt)],
)

export const agentRun = pgTable(
  'agent_run',
  {
    id: text('id').primaryKey(),
    orgId: orgId(),
    parentRunId: text('parent_run_id'),
    threadId: text('thread_id').references(() => thread.id, { onDelete: 'set null' }),
    userId: text('user_id').notNull(),
    pieceId: text('piece_id').references(() => piece.id, { onDelete: 'set null' }),
    /** Design version the model saw, so the run can be replayed. */
    baseSeq: integer('base_seq'),
    model: text('model').notNull(),
    tier: text('tier').$type<AssistantTier>(),
    origin: text('origin').$type<Run['origin']>().notNull().default('studio'),
    status: text('status').$type<Run['status']>().notNull(),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    tokensCacheRead: integer('tokens_cache_read').notNull().default(0),
    tokensCacheWrite: integer('tokens_cache_write').notNull().default(0),
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0),
    error: text('error'),
    errorCode: text('error_code').$type<NonNullable<Run['errorCode']>>(),
    /** Set when the run is an AI job: its stage, goal, plan and review. */
    job: jsonb('job').$type<AiJob>(),
    /** The project stage its spend counts against (the job's, else the tab it was sent from). */
    stage: text('stage').$type<JobStage>(),
    startedAt: at('started_at'),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    index('agent_run_org_idx').on(t.orgId, t.startedAt),
    index('agent_run_piece_idx').on(t.pieceId),
  ],
)

export const agentStep = pgTable(
  'agent_step',
  {
    id: text('id').primaryKey(),
    orgId: orgId(),
    runId: text('run_id')
      .notNull()
      .references(() => agentRun.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    kind: text('kind').$type<'model' | 'tool'>().notNull(),
    name: text('name').notNull(),
    toolCallId: text('tool_call_id'),
    status: text('status').$type<Step['status']>().notNull().default('done'),
    input: jsonb('input').$type<unknown>(),
    output: jsonb('output').$type<unknown>(),
    isError: boolean('is_error').notNull().default(false),
    ms: integer('ms').notNull().default(0),
    approval: jsonb('approval').$type<Step['approval']>(),
    usage: jsonb('usage').$type<Step['usage']>(),
    stopReason: text('stop_reason'),
    changeIds: jsonb('change_ids').$type<string[]>().notNull().default([]),
    startedAt: at('started_at'),
  },
  (t) => [
    uniqueIndex('agent_step_run_idx').on(t.runId, t.idx),
    // A tool call is begun once, however often the loop resumes.
    uniqueIndex('agent_step_tool_call_idx').on(t.runId, t.toolCallId),
  ],
)

export const agentMessage = pgTable(
  'agent_message',
  {
    id: text('id').primaryKey(),
    orgId: orgId(),
    threadId: text('thread_id')
      .notNull()
      .references(() => thread.id, { onDelete: 'cascade' }),
    runId: text('run_id'),
    /** The thread's owner, so a studio's message ids are unique per person, not per org. */
    userId: text('user_id').notNull(),
    /** 1, 2, … within the thread: the order the model saw. */
    seq: integer('seq').notNull(),
    role: text('role').$type<Message['role']>().notNull(),
    content: jsonb('content').$type<Record<string, unknown>[]>().notNull(),
    /** The studio's id for a user message, so a retried send stores it once. */
    clientMessageId: text('client_message_id'),
    createdAt: at('created_at'),
  },
  (t) => [
    index('agent_message_thread_idx').on(t.threadId, t.createdAt),
    uniqueIndex('agent_message_seq_idx').on(t.threadId, t.seq),
    uniqueIndex('agent_message_client_idx').on(t.orgId, t.userId, t.clientMessageId),
  ],
)

export const runFeedback = pgTable('run_feedback', {
  id: text('id').primaryKey(),
  orgId: orgId(),
  runId: text('run_id')
    .notNull()
    .references(() => agentRun.id, { onDelete: 'cascade' }),
  stepId: text('step_id'),
  source: text('source').$type<Feedback['source']>().notNull().default('explicit'),
  kind: text('kind').$type<Feedback['kind']>().notNull(),
  /** The agent change implicit feedback is about. */
  changeId: text('change_id'),
  /** A render signal's subject: `render:<takeId>` or `scene:<sceneId>`. */
  target: text('target'),
  /** Explicit thumbs only; superseded by `kind`. */
  rating: text('rating').$type<'up' | 'down'>(),
  note: text('note'),
  /** Null for implicit feedback recorded by the system. */
  userId: text('user_id'),
  createdAt: at('created_at'),
})

// ── Usage & audit ────────────────────────────────────────────────────────────────────────────

/** Append-only usage ledger. */
export const usageEvent = pgTable(
  'usage_event',
  {
    id: text('id').primaryKey(),
    orgId: orgId(),
    idempotencyKey: text('idempotency_key').notNull(),
    meter: text('meter').$type<Meter>().notNull(),
    provider: text('provider').notNull(),
    model: text('model'),
    quantity: doublePrecision('quantity').notNull(),
    unit: text('unit').notNull(),
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull(),
    userId: text('user_id'),
    runId: text('run_id'),
    pieceId: text('piece_id'),
    /** The project stage it was spent on, so a project's page shows what each stage cost. */
    stage: text('stage').$type<JobStage>(),
    occurredAt: at('occurred_at'),
  },
  (t) => [
    uniqueIndex('usage_event_idempotency_idx').on(t.orgId, t.idempotencyKey),
    index('usage_event_org_time_idx').on(t.orgId, t.occurredAt),
    index('usage_event_piece_idx').on(t.orgId, t.pieceId),
  ],
)

/**
 * One counted use of a plan allowance (a Blender take, a Rhino or STEP export). The database
 * decides who gets the last one: a claim takes a numbered slot in its month, and the unique index
 * on (org, allowance, period, slot) lets only one claim hold each slot, however many tabs, agent
 * runs or MCP clients ask at once. Releasing a claim (the work failed or was canceled) clears its
 * slot, so the slot can be taken again; the row stays as a record.
 */
export const planClaim = pgTable(
  'plan_claim',
  {
    id: text('id').primaryKey(),
    orgId: orgId(),
    /** Derived from the work (`render:<takeId>`), so a retried claim is counted once. */
    idempotencyKey: text('idempotency_key').notNull(),
    allowance: text('allowance').$type<Allowance>().notNull(),
    /** Calendar month (UTC), `YYYY-MM`. */
    period: text('period').notNull(),
    /** 1..limit while held or used; null once released. */
    slot: integer('slot'),
    /** held: the work is running; used: delivered; released: it failed or was canceled. */
    state: text('state').$type<'held' | 'used' | 'released'>().notNull(),
    /** What it was for, e.g. `step` or `render`, for the record. */
    subject: text('subject').notNull(),
    pieceId: text('piece_id'),
    userId: text('user_id').notNull(),
    actor: jsonb('actor').$type<Actor>().notNull(),
    createdAt: at('created_at'),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('plan_claim_idempotency_idx').on(t.orgId, t.idempotencyKey),
    uniqueIndex('plan_claim_slot_idx').on(t.orgId, t.allowance, t.period, t.slot),
  ],
)

/** Append-only record of every mutation, by whom (person, agent run or system). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    orgId: orgId(),
    action: text('action').notNull(),
    actor: jsonb('actor').$type<Actor>().notNull(),
    userId: text('user_id'),
    targetId: text('target_id'),
    input: jsonb('input').$type<unknown>(),
    at: at('at'),
  },
  (t) => [index('audit_log_org_time_idx').on(t.orgId, t.at)],
)
