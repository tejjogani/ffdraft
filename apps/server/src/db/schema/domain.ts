/**
 * Domain tables. Every row carries `org_id` and is only ever read or written through the
 * org-scoped repository (src/repo). Enumerations are plain text typed from @pave/schema so the
 * contract stays the single source of truth; imports here are type-only so drizzle-kit can load
 * this file without resolving workspace packages.
 */
import type {
  Actor,
  BrandModel,
  Design,
  JOB_STATUS,
  METERS,
  ModelShot,
  Op,
  PieceKind,
  PieceSpec,
  PieceSummary,
  Reference,
  RenderJob,
  RenderScene,
  Stage,
} from '@pave/schema'
import {
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
  assistantModel: text('assistant_model').notNull().default('claude-opus-5-5'),
  monthlyBudgetUsd: doublePrecision('monthly_budget_usd'),
  /** Set once the welcome workspace has been created, so deleting it does not bring it back. */
  welcomeSeededAt: timestamp('welcome_seeded_at', { withTimezone: true }),
  updatedAt: at('updated_at'),
})

export const collection = pgTable(
  'collection',
  {
    id: text('id').primaryKey(),
    orgId: orgId(),
    name: text('name').notNull(),
    icon: text('icon'),
    position: doublePrecision('position').notNull(),
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
    facts: jsonb('facts').$type<NonNullable<PieceSummary['facts']>>(),
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
    kind: text('kind').$type<'image' | 'mesh' | 'render' | 'video' | 'document' | 'archive'>().notNull(),
    mime: text('mime').notNull(),
    name: text('name').notNull(),
    bytes: integer('bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
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
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    icon: text('icon'),
    createdAt: at('created_at'),
    updatedAt: at('updated_at'),
  },
  (t) => [index('board_org_idx').on(t.orgId, t.updatedAt), index('board_piece_idx').on(t.pieceId)],
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
    width: integer('width'),
    height: integer('height'),
    position: doublePrecision('position').notNull(),
    createdAt: at('created_at'),
  },
  (t) => [index('reference_board_idx').on(t.boardId, t.position)],
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
    engine: text('engine').$type<RenderJob['engine']>().notNull(),
    status: text('status').$type<JobStatus>().notNull(),
    progress: doublePrecision('progress').notNull().default(0),
    sourceVersion: integer('source_version').notNull(),
    assetIds: jsonb('asset_ids').$type<string[]>().notNull().default([]),
    error: text('error'),
    actor: jsonb('actor').$type<Actor>().notNull(),
    createdAt: at('created_at'),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('render_job_org_idx').on(t.orgId, t.createdAt), index('render_job_piece_idx').on(t.pieceId)],
)

export const brandModel = pgTable('brand_model', {
  id: text('id').primaryKey(),
  orgId: orgId(),
  name: text('name').notNull(),
  card: jsonb('card').$type<BrandModel['card']>().notNull(),
  portraits: jsonb('portraits').$type<BrandModel['portraits']>().notNull().default([]),
  attestedSynthetic: boolean('attested_synthetic').notNull(),
  status: text('status').$type<BrandModel['status']>().notNull(),
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
    fidelity: text('fidelity').$type<ModelShot['fidelity']>().notNull(),
    status: text('status').$type<JobStatus>().notNull(),
    check: jsonb('check').$type<ModelShot['check']>(),
    createdAt: at('created_at'),
  },
  (t) => [index('model_shot_org_idx').on(t.orgId, t.createdAt)],
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
    status: text('status').$type<'running' | 'done' | 'failed' | 'canceled' | 'awaiting-approval'>().notNull(),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    tokensCacheRead: integer('tokens_cache_read').notNull().default(0),
    tokensCacheWrite: integer('tokens_cache_write').notNull().default(0),
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0),
    error: text('error'),
    startedAt: at('started_at'),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [index('agent_run_org_idx').on(t.orgId, t.startedAt), index('agent_run_piece_idx').on(t.pieceId)],
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
    input: jsonb('input').$type<unknown>(),
    output: jsonb('output').$type<unknown>(),
    isError: boolean('is_error').notNull().default(false),
    ms: integer('ms').notNull().default(0),
    changeIds: jsonb('change_ids').$type<string[]>().notNull().default([]),
    startedAt: at('started_at'),
  },
  (t) => [uniqueIndex('agent_step_run_idx').on(t.runId, t.idx)],
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
    role: text('role').$type<'user' | 'assistant'>().notNull(),
    content: jsonb('content').$type<Record<string, unknown>[]>().notNull(),
    createdAt: at('created_at'),
  },
  (t) => [index('agent_message_thread_idx').on(t.threadId, t.createdAt)],
)

export const runFeedback = pgTable('run_feedback', {
  id: text('id').primaryKey(),
  orgId: orgId(),
  runId: text('run_id')
    .notNull()
    .references(() => agentRun.id, { onDelete: 'cascade' }),
  stepId: text('step_id'),
  rating: text('rating').$type<'up' | 'down'>().notNull(),
  note: text('note'),
  userId: text('user_id').notNull(),
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
    occurredAt: at('occurred_at'),
  },
  (t) => [
    uniqueIndex('usage_event_idempotency_idx').on(t.orgId, t.idempotencyKey),
    index('usage_event_org_time_idx').on(t.orgId, t.occurredAt),
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
