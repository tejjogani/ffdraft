/**
 * The command registry: every operation the product can perform, declared once.
 *
 *  - the server implements a handler per command (type-checked for completeness);
 *  - the studio calls them over `POST /api/rpc/<name>` through a typed client;
 *  - the assistant's tools and the MCP server are generated from the entries marked `tool`.
 *
 * So "what can the user do", "what can the agent do" and "what can an external agent do" are
 * the same list, with the same validation, permissions, metering and trace capture.
 */
import { z } from 'zod'
import { ChangeSchema, DesignSchema, OpSchema, PIECE_KINDS } from '../design/design'
import { PieceSpecSchema } from '../design/spec'
import {
  AssetSchema,
  BoardSchema,
  BrandModelSchema,
  CapabilitiesSchema,
  CollectionSchema,
  METERS,
  MemberSchema,
  MessageSchema,
  ModelShotSchema,
  OrgSchema,
  PieceSchema,
  PieceSummarySchema,
  ProductionPackageSchema,
  RIGHTS,
  ROLES,
  ReferenceSchema,
  RenderJobSchema,
  RenderSceneSchema,
  type Role,
  RunSchema,
  STAGES,
  SearchResultSchema,
  StepSchema,
  StoredChangeSchema,
  ThreadSchema,
  UsageEventSchema,
  UserSchema,
} from './entities'

export interface CommandDef<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  /** Written for the assistant as much as for people: say when to use it. */
  description: string
  input: I
  output: O
  kind: 'query' | 'mutation'
  /** Minimum role. Defaults: queries → viewer, mutations → designer. */
  role?: Role
  /**
   * Expose to the assistant and MCP. `confirm` pauses the run for human approval — used for
   * anything destructive or that spends money.
   */
  tool?: true | { confirm: true }
}

const def = <I extends z.ZodType, O extends z.ZodType>(d: CommandDef<I, O>) => d

const id = z.string()
const ok = z.object({ ok: z.literal(true) })
const none = z.object({})

/** The geometry facts the assistant reasons over (no meshes). */
export const EvaluationSummarySchema = z.object({
  metalMassG: z.number(),
  metals: z.array(z.object({ material: z.string(), volumeMm3: z.number(), massG: z.number() })),
  stoneCount: z.number(),
  caratTotal: z.number(),
  lots: z.array(
    z.object({
      cut: z.string(),
      stone: z.string(),
      width: z.number(),
      length: z.number(),
      count: z.number(),
      caratTotal: z.number(),
      setting: z.string(),
      role: z.string(),
    }),
  ),
  boundsMm: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  diagnostics: z.array(
    z.object({ level: z.string(), code: z.string(), message: z.string(), nodeId: z.string().optional() }),
  ),
})
export type EvaluationSummary = z.infer<typeof EvaluationSummarySchema>

export const commands = {
  // ── Session & organisation ────────────────────────────────────────────────────────────────
  'session.get': def({
    description: 'The signed-in user, their organisations and what this deployment can do.',
    kind: 'query',
    input: none,
    output: z.object({
      user: UserSchema,
      orgs: z.array(OrgSchema),
      activeOrgId: id,
      capabilities: CapabilitiesSchema,
    }),
  }),
  'org.members': def({
    description: 'Members of the active organisation.',
    kind: 'query',
    input: none,
    output: z.array(MemberSchema),
  }),
  'org.invite': def({
    description: 'Invite someone to the organisation by email.',
    kind: 'mutation',
    role: 'admin',
    input: z.object({ email: z.email(), role: z.enum(ROLES).default('designer') }),
    output: ok,
  }),
  'org.setRole': def({
    description: 'Change a member’s role.',
    kind: 'mutation',
    role: 'admin',
    input: z.object({ userId: id, role: z.enum(ROLES) }),
    output: ok,
  }),
  'org.settings.get': def({
    description: 'Organisation settings, including trace retention and data-use consent.',
    kind: 'query',
    input: none,
    output: z.object({
      traceRetentionDays: z.number().int(),
      allowEvalUse: z.boolean(),
      assistantModel: z.string(),
      monthlyBudgetUsd: z.number().nullable(),
    }),
  }),
  'org.settings.update': def({
    description: 'Update organisation settings.',
    kind: 'mutation',
    role: 'admin',
    input: z.object({
      traceRetentionDays: z.number().int().min(0).max(3650).optional(),
      allowEvalUse: z.boolean().optional(),
      assistantModel: z.string().optional(),
      monthlyBudgetUsd: z.number().nonnegative().nullable().optional(),
    }),
    output: ok,
  }),

  // ── Collections & pieces ──────────────────────────────────────────────────────────────────
  'collections.list': def({
    description: 'List collections (groups of pieces, e.g. a season or a client).',
    kind: 'query',
    tool: true,
    input: none,
    output: z.array(CollectionSchema),
  }),
  'collections.create': def({
    description: 'Create a collection.',
    kind: 'mutation',
    tool: true,
    input: z.object({ name: z.string().min(1).max(80), icon: z.string().max(8).optional() }),
    output: CollectionSchema,
  }),
  'collections.update': def({
    description: 'Rename, re-icon or reorder a collection.',
    kind: 'mutation',
    input: z.object({
      id,
      name: z.string().min(1).max(80).optional(),
      icon: z.string().max(8).nullable().optional(),
      position: z.number().optional(),
    }),
    output: CollectionSchema,
  }),
  'collections.delete': def({
    description: 'Delete a collection. Its pieces are kept and become unfiled.',
    kind: 'mutation',
    input: z.object({ id }),
    output: ok,
  }),
  'pieces.list': def({
    description: 'List pieces, optionally filtered by collection, stage or a text query.',
    kind: 'query',
    tool: true,
    input: z.object({
      collectionId: id.nullable().optional(),
      stage: z.enum(STAGES).optional(),
      q: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(200).default(100),
    }),
    output: z.array(PieceSummarySchema),
  }),
  'pieces.get': def({
    description: 'A piece with its brief, spec and full design document.',
    kind: 'query',
    tool: true,
    input: z.object({ id }),
    output: PieceSchema,
  }),
  'pieces.create': def({
    description:
      'Create a piece. Pass `templateId` to start from a template, or `spec` to build from a confirmed spec; with neither the piece starts empty at the idea stage.',
    kind: 'mutation',
    tool: true,
    input: z.object({
      title: z.string().max(120).optional(),
      kind: z.enum(PIECE_KINDS).optional(),
      collectionId: id.nullable().optional(),
      templateId: z.string().optional(),
      spec: PieceSpecSchema.optional(),
      brief: z.string().max(20_000).optional(),
    }),
    output: PieceSchema,
  }),
  'pieces.update': def({
    description: 'Update a piece’s title, stage, brief, collection or cover.',
    kind: 'mutation',
    tool: true,
    input: z.object({
      id,
      title: z.string().max(120).optional(),
      stage: z.enum(STAGES).optional(),
      brief: z.string().max(20_000).optional(),
      collectionId: id.nullable().optional(),
      coverAssetId: id.nullable().optional(),
    }),
    output: PieceSummarySchema,
  }),
  'pieces.setSpec': def({
    description:
      'Save the agreed spec for a piece — the plan the designer confirms before CAD. Put anything still unknown in openQuestions rather than guessing silently.',
    kind: 'mutation',
    tool: true,
    input: z.object({ id, spec: PieceSpecSchema }),
    output: PieceSummarySchema,
  }),
  'pieces.buildFromSpec': def({
    description:
      'Replace the piece’s design with a first CAD built from its saved spec. Use once the designer has confirmed the spec; refine afterwards with design.apply.',
    kind: 'mutation',
    tool: { confirm: true },
    input: z.object({ id }),
    output: z.object({ version: z.number().int(), design: DesignSchema }),
  }),
  'pieces.duplicate': def({
    description: 'Duplicate a piece (design and spec) as a starting point for a variation.',
    kind: 'mutation',
    tool: true,
    input: z.object({ id, title: z.string().max(120).optional() }),
    output: PieceSchema,
  }),
  'pieces.delete': def({
    description: 'Delete a piece and everything attached to it.',
    kind: 'mutation',
    tool: { confirm: true },
    input: z.object({ id }),
    output: ok,
  }),

  // ── Design document ───────────────────────────────────────────────────────────────────────
  'design.apply': def({
    description:
      'Edit a piece’s CAD by applying ops to its feature tree: add / update / remove / move nodes. Updates are JSON merge patches. All ops in one call form a single undoable change; give it a short human label. Fails atomically with a precise message if an op is invalid.',
    kind: 'mutation',
    tool: true,
    input: z.object({
      pieceId: id,
      /** Version the ops were authored against; omitted = apply on top of whatever is current. */
      baseVersion: z.number().int().optional(),
      label: z.string().min(1).max(200),
      ops: z.array(OpSchema).min(1).max(200),
      /** Client-generated id so retries are idempotent. */
      changeId: z.string().optional(),
    }),
    output: z.object({ version: z.number().int(), change: StoredChangeSchema }),
  }),
  'design.history': def({
    description: 'The edit history of a piece: who (person or assistant run) changed what, newest first.',
    kind: 'query',
    tool: true,
    input: z.object({ pieceId: id, before: z.number().int().optional(), limit: z.number().int().max(200).default(50) }),
    output: z.array(StoredChangeSchema),
  }),
  'design.revert': def({
    description: 'Undo one earlier change by applying its inverse as a new change.',
    kind: 'mutation',
    tool: true,
    input: z.object({ pieceId: id, seq: z.number().int() }),
    output: z.object({ version: z.number().int(), change: StoredChangeSchema }),
  }),
  'design.evaluate': def({
    description:
      'Compute the facts of a piece’s current CAD: metal weight per alloy, stone lots and total carat, overall size, and manufacturability diagnostics. Call after edits to check your work.',
    kind: 'query',
    tool: true,
    input: z.object({ pieceId: id, detail: z.enum(['draft', 'production']).default('draft') }),
    output: EvaluationSummarySchema,
  }),
  'design.export': def({
    description: 'Export the CAD as STL, STEP, 3DM, GLB, OBJ or 3MF. Returns a downloadable asset.',
    kind: 'mutation',
    tool: true,
    input: z.object({
      pieceId: id,
      format: z.enum(['stl', 'step', '3dm', 'glb', 'obj', '3mf']),
      stones: z.boolean().optional(),
    }),
    output: z.object({ asset: AssetSchema, notes: z.array(z.string()) }),
  }),

  // ── Ideate ────────────────────────────────────────────────────────────────────────────────
  'boards.list': def({
    description: 'List moodboards.',
    kind: 'query',
    tool: true,
    input: z.object({ pieceId: id.optional() }),
    output: z.array(BoardSchema),
  }),
  'boards.get': def({
    description: 'A moodboard with all of its references.',
    kind: 'query',
    tool: true,
    input: z.object({ id }),
    output: z.object({ board: BoardSchema, references: z.array(ReferenceSchema) }),
  }),
  'boards.create': def({
    description: 'Create a moodboard, optionally attached to a piece.',
    kind: 'mutation',
    tool: true,
    input: z.object({
      title: z.string().min(1).max(120),
      description: z.string().max(2000).optional(),
      pieceId: id.nullable().optional(),
    }),
    output: BoardSchema,
  }),
  'boards.update': def({
    description: 'Update a moodboard’s title, description, icon or piece link.',
    kind: 'mutation',
    input: z.object({
      id,
      title: z.string().min(1).max(120).optional(),
      description: z.string().max(2000).optional(),
      icon: z.string().max(8).nullable().optional(),
      pieceId: id.nullable().optional(),
    }),
    output: BoardSchema,
  }),
  'boards.delete': def({
    description: 'Delete a moodboard and its references.',
    kind: 'mutation',
    tool: { confirm: true },
    input: z.object({ id }),
    output: ok,
  }),
  'references.search': def({
    description:
      'Search for visual references across the configured image providers and open-access museum collections. Results are transient until saved to a board.',
    kind: 'query',
    tool: true,
    input: z.object({
      query: z.string().min(1).max(300),
      providers: z.array(z.string()).optional(),
      page: z.number().int().min(1).default(1),
    }),
    output: z.object({ results: z.array(SearchResultSchema), providers: z.array(z.string()) }),
  }),
  'references.save': def({
    description: 'Save search results, a pasted URL or an uploaded asset to a board, keeping provenance.',
    kind: 'mutation',
    tool: true,
    input: z.object({
      boardId: id,
      items: z
        .array(
          z.object({
            result: SearchResultSchema.optional(),
            url: z.string().url().optional(),
            assetId: id.optional(),
            note: z.string().max(4000).optional(),
            title: z.string().max(200).optional(),
            rights: z.enum(RIGHTS).optional(),
          }),
        )
        .min(1)
        .max(50),
    }),
    output: z.array(ReferenceSchema),
  }),
  'references.update': def({
    description: 'Edit a reference’s title, note, tags, rights or position.',
    kind: 'mutation',
    input: z.object({
      id,
      title: z.string().max(200).optional(),
      note: z.string().max(4000).optional(),
      tags: z.array(z.string().max(40)).max(30).optional(),
      rights: z.enum(RIGHTS).optional(),
      position: z.number().optional(),
    }),
    output: ReferenceSchema,
  }),
  'references.remove': def({
    description: 'Remove references from a board.',
    kind: 'mutation',
    input: z.object({ ids: z.array(id).min(1).max(100) }),
    output: ok,
  }),
  'references.generate': def({
    description:
      'Generate concept images from a prompt, optionally conditioned on references from a board. New images are saved to the board with their lineage. Costs money per image.',
    kind: 'mutation',
    tool: { confirm: true },
    input: z.object({
      boardId: id,
      prompt: z.string().min(3).max(4000),
      referenceIds: z.array(id).max(8).default([]),
      count: z.number().int().min(1).max(4).default(2),
      aspect: z.enum(['1:1', '4:5', '3:2', '16:9']).default('1:1'),
      style: z.enum(['photo', 'sketch', 'technical', 'render']).default('photo'),
    }),
    output: z.array(ReferenceSchema),
  }),

  // ── Render ────────────────────────────────────────────────────────────────────────────────
  'renders.list': def({
    description: 'Render jobs, newest first, optionally for one piece.',
    kind: 'query',
    tool: true,
    input: z.object({ pieceId: id.optional(), limit: z.number().int().max(200).default(60) }),
    output: z.array(RenderJobSchema),
  }),
  'renders.get': def({
    description: 'One render job with its status and outputs.',
    kind: 'query',
    tool: true,
    input: z.object({ id }),
    output: RenderJobSchema,
  }),
  'renders.create': def({
    description:
      'Queue a photoreal render (still or animation) of a piece from a declarative scene: look, camera, environment, overrides, animation, output. Poll renders.get for the result.',
    kind: 'mutation',
    tool: true,
    input: z.object({ pieceId: id, title: z.string().max(120).optional(), scene: RenderSceneSchema }),
    output: RenderJobSchema,
  }),
  'renders.cancel': def({
    description: 'Cancel a queued or running render.',
    kind: 'mutation',
    input: z.object({ id }),
    output: RenderJobSchema,
  }),

  // ── Brand models ──────────────────────────────────────────────────────────────────────────
  'models.list': def({
    description: 'The brand’s synthetic models.',
    kind: 'query',
    tool: true,
    input: none,
    output: z.array(BrandModelSchema),
  }),
  'models.create': def({
    description: 'Define a new brand model from a model card. Portraits are generated separately.',
    kind: 'mutation',
    input: z.object({
      name: z.string().min(1).max(80),
      card: BrandModelSchema.shape.card,
      attestedSynthetic: z.literal(true),
    }),
    output: BrandModelSchema,
  }),
  'models.update': def({
    description: 'Edit a brand model’s card, name or approval status.',
    kind: 'mutation',
    input: z.object({
      id,
      name: z.string().min(1).max(80).optional(),
      card: BrandModelSchema.shape.card.partial().optional(),
      status: z.enum(['draft', 'approved']).optional(),
    }),
    output: BrandModelSchema,
  }),
  'models.generatePortraits': def({
    description: 'Generate (or regenerate) the canonical portrait set for a brand model.',
    kind: 'mutation',
    tool: { confirm: true },
    input: z.object({ id, views: z.array(z.enum(['face', 'hands', 'neck', 'ear', 'body'])).min(1) }),
    output: BrandModelSchema,
  }),
  'models.delete': def({
    description: 'Delete a brand model.',
    kind: 'mutation',
    input: z.object({ id }),
    output: ok,
  }),
  'shots.list': def({
    description: 'On-model images, optionally for one piece or one model.',
    kind: 'query',
    tool: true,
    input: z.object({ pieceId: id.optional(), modelId: id.optional() }),
    output: z.array(ModelShotSchema),
  }),
  'shots.create': def({
    description:
      'Create an on-model image of a piece worn by a brand model. Uses renders of the real CAD as references and checks the result against the design.',
    kind: 'mutation',
    tool: { confirm: true },
    input: z.object({
      modelId: id,
      pieceId: id,
      placement: z.enum(['hand', 'neck', 'ear', 'wrist']),
      direction: z.string().max(1000).default(''),
    }),
    output: ModelShotSchema,
  }),

  // ── Production ────────────────────────────────────────────────────────────────────────────
  'production.list': def({
    description: 'Production packages for a piece, newest revision first.',
    kind: 'query',
    tool: true,
    input: z.object({ pieceId: id }),
    output: z.array(ProductionPackageSchema),
  }),
  'production.create': def({
    description:
      'Build a manufacturer-ready production package for a piece: spec sheet PDF, dimensioned drawings, STL/STEP/3DM, stone list and BOM, cost estimate and manufacturability report, zipped as a new revision.',
    kind: 'mutation',
    tool: true,
    input: z.object({
      pieceId: id,
      notes: z.string().max(4000).optional(),
      quantity: z.number().int().min(1).max(100_000).default(1),
      rates: z
        .object({
          metalPricePerGramUsd: z.number().nonnegative().optional(),
          castingLossPct: z.number().min(0).max(50).optional(),
          laborUsd: z.number().nonnegative().optional(),
          settingPerStoneUsd: z.number().nonnegative().optional(),
        })
        .optional(),
    }),
    output: ProductionPackageSchema,
  }),

  // ── Assistant & traces ────────────────────────────────────────────────────────────────────
  'threads.list': def({
    description: 'Assistant conversations.',
    kind: 'query',
    input: z.object({ pieceId: id.optional(), limit: z.number().int().max(100).default(30) }),
    output: z.array(ThreadSchema),
  }),
  'threads.get': def({
    description: 'A conversation with its messages.',
    kind: 'query',
    input: z.object({ id }),
    output: z.object({ thread: ThreadSchema, messages: z.array(MessageSchema) }),
  }),
  'threads.delete': def({
    description: 'Delete a conversation.',
    kind: 'mutation',
    input: z.object({ id }),
    output: ok,
  }),
  'traces.runs': def({
    description: 'Assistant runs with token usage and cost, newest first.',
    kind: 'query',
    input: z.object({ pieceId: id.optional(), limit: z.number().int().max(200).default(50) }),
    output: z.array(RunSchema),
  }),
  'traces.run': def({
    description: 'One assistant run with every model and tool step, linked to the design changes it made.',
    kind: 'query',
    input: z.object({ id }),
    output: z.object({ run: RunSchema, steps: z.array(StepSchema) }),
  }),
  'traces.feedback': def({
    description: 'Record explicit feedback on a run or one of its steps.',
    kind: 'mutation',
    input: z.object({
      runId: id,
      stepId: id.optional(),
      rating: z.enum(['up', 'down']),
      note: z.string().max(2000).optional(),
    }),
    output: ok,
  }),

  // ── Usage ─────────────────────────────────────────────────────────────────────────────────
  'usage.summary': def({
    description: 'Metered usage and cost for the organisation over a period, by meter and by day.',
    kind: 'query',
    role: 'admin',
    input: z.object({ days: z.number().int().min(1).max(365).default(30) }),
    output: z.object({
      totalUsd: z.number(),
      byMeter: z.array(z.object({ meter: z.enum(METERS), quantity: z.number(), unit: z.string(), costUsd: z.number() })),
      byDay: z.array(z.object({ day: z.string(), costUsd: z.number() })),
      recent: z.array(UsageEventSchema),
    }),
  }),
} as const

export type CommandName = keyof typeof commands
export type CommandInput<N extends CommandName> = z.input<(typeof commands)[N]['input']>
export type CommandParsedInput<N extends CommandName> = z.output<(typeof commands)[N]['input']>
export type CommandOutput<N extends CommandName> = z.output<(typeof commands)[N]['output']>
export const COMMAND_NAMES = Object.keys(commands) as CommandName[]

export const isToolCommand = (name: CommandName): boolean => 'tool' in commands[name]
export const needsConfirmation = (name: CommandName): boolean => {
  const c: CommandDef = commands[name]
  return typeof c.tool === 'object' && c.tool.confirm
}
export const minimumRole = (name: CommandName): Role => {
  const c: CommandDef = commands[name]
  return c.role ?? (c.kind === 'query' ? 'viewer' : 'designer')
}

/** Roles ordered from least to most privileged. */
const RANK: Record<Role, number> = { guest: 0, viewer: 1, designer: 2, admin: 3, owner: 4 }
export const roleAllows = (have: Role, need: Role): boolean => RANK[have] >= RANK[need]

/** Re-exported for handlers that need the change shape without the storage fields. */
export { ChangeSchema }
