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
  ASSISTANT_MODELS,
  ASSISTANT_TIERS,
  AssetSchema,
  ATTESTATION_RIGHTS,
  BoardSchema,
  BrandModelSchema,
  CanvasPlacementSchema,
  CapabilitiesSchema,
  CollectionSchema,
  FeedbackSchema,
  GENERATION_ROLES,
  GenerationInputSchema,
  IMAGE_ASPECTS,
  MESH_QUALITIES,
  METERS,
  MemberSchema,
  MeshJobSchema,
  MessageSchema,
  ModelShotSchema,
  OrgSchema,
  OriginFlagSchema,
  PieceOriginInputSchema,
  PieceSchema,
  PieceSummarySchema,
  ProductionPackageSchema,
  ReferenceSchema,
  RenderEngineStatusSchema,
  RenderJobSchema,
  RenderSceneSchema,
  RIGHTS,
  ROLES,
  type Role,
  RunSchema,
  SavedSceneSchema,
  SearchResultSchema,
  STAGES,
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
  /** Input fields that are secrets (an API key): never written to the audit log. */
  secret?: readonly string[]
}

type ToolFlag = CommandDef['tool']

/**
 * Declares a command, keeping whether it is a tool in its type, so the set of tool commands is
 * known at compile time (e.g. every tool must have an assistant chip label).
 */
const def = <I extends z.ZodType, O extends z.ZodType, const T extends ToolFlag = undefined>(
  d: CommandDef<I, O> & { tool?: T },
) => d as CommandDef<I, O> & { tool: T }

const id = z.string()
const ok = z.object({ ok: z.literal(true) })
const none = z.object({})
/** A JSON merge patch (RFC 7396): objects merge, arrays and scalars replace, null deletes. */
const mergePatch = z.record(z.string(), z.unknown())

/** Which model each assistant tier runs on; null = the tier's default. */
const tierModels = z.object({
  power: z.enum(ASSISTANT_MODELS).nullable(),
  standard: z.enum(ASSISTANT_MODELS).nullable(),
  light: z.enum(ASSISTANT_MODELS).nullable(),
})

/** USD per million tokens for one model, as the settings screen shows them. */
const ModelPriceSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
})

/**
 * How the assistant is set up for the organisation. The API key itself never leaves the server:
 * only where it comes from and its last four characters (for owners and admins).
 */
export const AssistantSetupSchema = z.object({
  /** A key is available, so conversations can start. */
  configured: z.boolean(),
  key: z.object({
    /** `env`: ANTHROPIC_API_KEY in apps/server/.env, which wins and cannot be edited here. */
    source: z.enum(['env', 'settings', 'none']),
    /** The key's last four characters; null without a key or for members who are not admins. */
    last4: z.string().nullable(),
    /** Whether Save and Remove apply (not while the .env key is in force, nor in test mode). */
    editable: z.boolean(),
    updatedAt: z.string().nullable(),
  }),
  /** A scripted test model stands in for Claude (PAVE_ASSISTANT=scripted:…); never in normal use. */
  scripted: z.boolean(),
  defaultTier: z.object({
    tier: z.enum(ASSISTANT_TIERS),
    source: z.enum(['env', 'settings', 'default']),
  }),
  tiers: z.array(
    z.object({
      tier: z.enum(ASSISTANT_TIERS),
      label: z.string(),
      blurb: z.string(),
      model: z.enum(ASSISTANT_MODELS),
      modelLabel: z.string(),
      /** `env`: set by PAVE_ASSISTANT_MODEL_<TIER> in apps/server/.env, which wins over settings. */
      source: z.enum(['env', 'settings', 'default']),
      price: ModelPriceSchema,
      /** A rough cost of a typical design run on this model. */
      typicalRunUsd: z.number(),
    }),
  ),
  /** Every model a tier may point at, with its price. */
  models: z.array(
    z.object({
      id: z.enum(ASSISTANT_MODELS),
      label: z.string(),
      price: ModelPriceSchema,
      /** Fable 5.2: the Anthropic organisation must keep 30-day data retention. */
      needsRetention: z.boolean(),
    }),
  ),
  /** Names of the .env variables in force (values are not shown). */
  envOverrides: z.array(z.string()),
  /** .env values that were set but not understood, in plain words; they are ignored. */
  warnings: z.array(z.string()),
  /** This calendar month's AI spend (UTC); null for members who are not admins. */
  monthSpendUsd: z.number().nullable(),
})
export type AssistantSetup = z.infer<typeof AssistantSetupSchema>

export const KEY_CHECK_CODES = [
  'invalid',
  'forbidden',
  'unreachable',
  'rate_limited',
  'error',
] as const

/** What a paid generation will cost before it is confirmed. */
export const EstimateSchema = z.object({
  provider: z.string(),
  model: z.string(),
  usd: z.number().nonnegative(),
  /** Typical wall-clock time. */
  seconds: z.number().nonnegative(),
})
export type Estimate = z.infer<typeof EstimateSchema>

const onModelShot = z.object({
  modelId: id,
  pieceId: id,
  placement: z.enum(['hand', 'neck', 'ear', 'wrist']),
  direction: z.string().max(1000).default(''),
  count: z.number().int().min(1).max(4).default(1),
  aspect: z.enum(IMAGE_ASPECTS).default('4:5'),
})

const modelCard = BrandModelSchema.shape.card
/** A new model card: the details added after the first cards may be left out. */
const newModelCard = modelCard.extend({
  monkTone: modelCard.shape.monkTone.default(null),
  undertone: modelCard.shape.undertone.default(null),
  eyes: modelCard.shape.eyes.default(''),
  marks: modelCard.shape.marks.default(''),
  handLengthMm: modelCard.shape.handLengthMm.default(null),
})

/** An image generation request, as estimated and as generated onto a board. */
const generateRequest = z.object({
  prompt: z.string().min(3).max(4000),
  referenceIds: z.array(id).max(8).default([]),
  count: z.number().int().min(1).max(4).default(2),
  /** What each reference is for ("image 1 = silhouette"); ids must be among `referenceIds`. */
  roles: z
    .array(z.object({ id, role: z.enum(GENERATION_ROLES) }))
    .max(8)
    .default([]),
  aspect: z.enum(IMAGE_ASPECTS).default('1:1'),
  style: z.enum(['photo', 'sketch', 'technical', 'render']).default('photo'),
  /** Repeat a result exactly, where the provider supports seeds. */
  seed: z.number().int().min(0).optional(),
})

const portraitViews = z.array(z.enum(['face', 'hands', 'neck', 'ear', 'body'])).min(1)

const meshRequest = {
  /** One to four photos of the same object (front first). */
  imageAssetIds: z.array(id).min(1).max(4),
  quality: z.enum(MESH_QUALITIES).default('standard'),
}

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
    z.object({
      level: z.string(),
      code: z.string(),
      message: z.string(),
      nodeId: z.string().optional(),
    }),
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
      /** The tier a new conversation starts on; null means Standard. */
      assistantTier: z.enum(ASSISTANT_TIERS).nullable(),
      /** The model each tier runs on; null means that tier's default model. */
      assistantModels: tierModels,
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
      assistantTier: z.enum(ASSISTANT_TIERS).nullable().optional(),
      /** Only the tiers given change; null puts a tier back on its default model. */
      assistantModels: tierModels.partial().optional(),
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
      'Create a piece. Pass `templateId` to start from a template, or `spec` to build from a confirmed spec; with neither the piece starts empty at the idea stage. Pass `origin` when the piece starts from a picture, logo, text, mesh, board references or another piece ("make it jewelry"); list the source assets and references so they are credited.',
    kind: 'mutation',
    tool: true,
    input: z.object({
      title: z.string().max(120).optional(),
      kind: z.enum(PIECE_KINDS).optional(),
      collectionId: id.nullable().optional(),
      templateId: z.string().optional(),
      spec: PieceSpecSchema.optional(),
      brief: z.string().max(20_000).optional(),
      origin: PieceOriginInputSchema.optional(),
    }),
    output: PieceSchema,
  }),
  'pieces.update': def({
    description:
      'Update a piece’s title, stage, brief, collection, cover or origin. Setting `coverAssetId` stops automatic cover capture unless `coverAuto: true` is sent with it. Changing the origin’s sources clears its attestation. The assistant may only add sources and flags to an origin; only a person can remove them, clear the origin or attest (403 otherwise).',
    kind: 'mutation',
    tool: true,
    input: z.object({
      id,
      title: z.string().max(120).optional(),
      stage: z.enum(STAGES).optional(),
      brief: z.string().max(20_000).optional(),
      collectionId: id.nullable().optional(),
      coverAssetId: id.nullable().optional(),
      coverAuto: z.boolean().optional(),
      origin: PieceOriginInputSchema.nullable().optional(),
    }),
    output: PieceSummarySchema,
  }),
  'pieces.attest': def({
    description:
      'Record that the signed-in person owns, has licensed or has permission to use the artwork a piece was made from (and, when a person is shown, has their consent). Required before image-to-3D, export or a production package of such a piece. Only a person can attest; never offered to the assistant.',
    kind: 'mutation',
    input: z.object({
      id,
      rights: z.enum(ATTESTATION_RIGHTS),
      likenessConsent: z.boolean().default(false),
    }),
    output: PieceSchema,
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
      /** When these ops undo earlier changes (a guarded undo), their ids. */
      reverts: z.array(id).min(1).max(200).optional(),
    }),
    output: z.object({ version: z.number().int(), change: StoredChangeSchema }),
  }),
  'design.history': def({
    description:
      'The edit history of a piece: who (person or assistant run) changed what, newest first.',
    kind: 'query',
    tool: true,
    input: z.object({
      pieceId: id,
      before: z.number().int().optional(),
      limit: z.number().int().max(200).default(50),
    }),
    output: z.array(StoredChangeSchema),
  }),
  'design.revert': def({
    description:
      'Undo earlier edits by applying their inverse as one new change: give `seq` for one change, or `runId` for everything an assistant run changed on this piece that is not undone yet. Fails with a conflict (409, naming the `nodeIds`) if later edits changed the same features since, so a later edit is never overwritten, and with a conflict if everything asked for is already undone.',
    kind: 'mutation',
    tool: true,
    input: z
      .object({ pieceId: id, seq: z.number().int().optional(), runId: id.optional() })
      .refine((v) => (v.seq === undefined) !== (v.runId === undefined), {
        message: 'Give exactly one of seq or runId',
      }),
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
    description:
      'Export the CAD as STL, STEP, 3DM, GLB, OBJ or 3MF. Returns a downloadable asset. A piece made from someone’s artwork needs a person’s attestation first (409 otherwise).',
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
      /** Only results whose pixels may be stored and used (open access, CC0). */
      openOnly: z.boolean().default(false),
      page: z.number().int().min(1).default(1),
    }),
    output: z.object({
      results: z.array(SearchResultSchema),
      providers: z.array(z.string()),
      /** Providers that could not answer this time, and why in plain words. */
      unavailable: z.array(z.object({ provider: z.string(), reason: z.string() })),
    }),
  }),
  'references.save': def({
    description:
      'Save search results, pasted URLs, uploaded assets, notes or colour swatches to a board, keeping provenance. Each item is exactly one of `result`, `url`, `assetId` or `swatch` (a `note` may go with it), or a note alone. Search results are re-checked with their provider: rights come from the provider, and pixels are stored only where its terms allow. URLs are kept as view-only links, and an image captured from one stays view-only wherever it is saved again. `pieceId` marks a reference that shows one of your pieces.',
    kind: 'mutation',
    tool: true,
    input: z.object({
      boardId: id,
      items: z
        .array(
          z
            .object({
              result: SearchResultSchema.optional(),
              url: z.string().url().optional(),
              assetId: id.optional(),
              swatch: z.object({ hex: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).optional(),
              pieceId: id.optional(),
              note: z.string().max(4000).optional(),
              title: z.string().max(200).optional(),
              /** For uploads and notes; a search result or URL can only be lowered to `viewOnly`. */
              rights: z.enum(RIGHTS).optional(),
            })
            .refine(
              (item) => {
                const sources = [item.result, item.url, item.assetId, item.swatch].filter(
                  (x) => x !== undefined,
                ).length
                return sources === 1 || (sources === 0 && item.note !== undefined)
              },
              {
                message:
                  'Give exactly one of result, url, assetId or swatch (a note may go with it), or a note alone',
              },
            ),
        )
        .min(1)
        .max(50),
    }),
    output: z.array(ReferenceSchema),
  }),
  'references.update': def({
    description:
      'Edit a reference’s title, note, tags, rights, order, canvas placement or board. Raising a view-only reference’s rights needs `attestation: true` from a person.',
    kind: 'mutation',
    input: z
      .object({
        id,
        title: z.string().max(200).optional(),
        note: z.string().max(4000).optional(),
        tags: z.array(z.string().max(40)).max(30).optional(),
        rights: z.enum(RIGHTS).optional(),
        /** The person confirms they may use a view-only item beyond inspiration. */
        attestation: z.literal(true).optional(),
        position: z.number().optional(),
        canvas: CanvasPlacementSchema.nullable().optional(),
        /** Move to another board. */
        boardId: id.optional(),
      })
      .refine(
        (v) =>
          Object.entries(v).some(([k, x]) => k !== 'id' && k !== 'attestation' && x !== undefined),
        { message: 'Give at least one field to change' },
      ),
    output: ReferenceSchema,
  }),
  'references.arrange': def({
    description: 'Reorder references on a board and place them on its canvas, in one step.',
    kind: 'mutation',
    input: z.object({
      boardId: id,
      items: z
        .array(
          z.object({
            id,
            position: z.number().optional(),
            canvas: CanvasPlacementSchema.nullable().optional(),
          }),
        )
        .min(1)
        .max(500),
    }),
    output: z.array(ReferenceSchema),
  }),
  'references.capture': def({
    description:
      'Store the image behind a saved link so it shows on the board. Its rights stay view-only: a captured page is inspiration, not material for generation.',
    kind: 'mutation',
    input: z.object({ id }),
    output: ReferenceSchema,
  }),
  'references.lineage': def({
    description:
      'Where a reference came from and what came of it: the references it was generated from (with credit lines even when deleted), the images generated from it, and the pieces started from it or its descendants.',
    kind: 'query',
    tool: true,
    input: z.object({ id }),
    output: z.object({
      ancestors: z.array(
        z.object({
          id,
          /** Null when the parent has since been deleted; `credit` still names it. */
          reference: ReferenceSchema.nullable(),
          credit: GenerationInputSchema.nullable(),
          /** 1 = parent, 2 = grandparent, … */
          depth: z.number().int().min(1),
        }),
      ),
      descendants: z.array(ReferenceSchema),
      pieces: z.array(PieceSummarySchema),
    }),
  }),
  'references.similar': def({
    description:
      'References similar to one reference or to a text description, from one board or the whole organisation. Uses semantic embeddings when configured, otherwise shared tags, palette and title words.',
    kind: 'query',
    tool: true,
    input: z
      .object({
        id: id.optional(),
        text: z.string().min(1).max(500).optional(),
        boardId: id.optional(),
        limit: z.number().int().min(1).max(50).default(12),
      })
      .refine((v) => v.id !== undefined || v.text !== undefined, {
        message: 'Give a reference id or a text description',
      }),
    output: z.array(ReferenceSchema),
  }),
  'references.remove': def({
    description: 'Remove references from a board.',
    kind: 'mutation',
    input: z.object({ ids: z.array(id).min(1).max(100) }),
    output: ok,
  }),
  'references.estimate': def({
    description:
      'What references.generate would cost for this request and how long it takes, before asking for confirmation.',
    kind: 'query',
    tool: true,
    input: generateRequest,
    output: EstimateSchema,
  }),
  'references.generate': def({
    description:
      'Generate concept images from a prompt, optionally conditioned on references from a board. New images are saved to the board with their lineage. Costs money per image.',
    kind: 'mutation',
    tool: { confirm: true },
    input: generateRequest.extend({ boardId: id }),
    output: z.array(ReferenceSchema),
  }),

  // ── Make it jewelry: freeform and image to 3D ─────────────────────────────────────────────
  'freeform.analyze': def({
    description:
      'Analyse a picture or mesh for turning it into jewelry: cut-out and outline, a height map for a relief, colour layers for pavé regions, the recommended mode (outline, relief or sculpt) and why, and printability warnings at the target height. Flags logos, characters and faces, which need the person’s attestation. Cheap and repeatable; tune `threshold` to change what counts as the subject.',
    kind: 'mutation',
    tool: true,
    input: z.object({
      /** An uploaded image or mesh. */
      assetId: id,
      /** Subject/background cut-off, 0–1; omitted = automatic. */
      threshold: z.number().min(0).max(1).optional(),
      invert: z.boolean().optional(),
      /** The intended finished height, for the printability warnings. */
      heightMm: z.number().min(3).max(200).optional(),
    }),
    output: z.object({
      maskAssetId: id,
      /** The subject on transparency; null for a mesh. */
      cutoutAssetId: id.nullable(),
      /** The traced outline as an SVG path, ready for an outline body. */
      outline: z.object({ d: z.string(), aspect: z.number().positive() }),
      heightMapAssetId: id,
      /** `model` = a depth model; `basic` = silhouette dome plus luminance; `mesh` = the mesh’s own depth. */
      depthSource: z.enum(['model', 'basic', 'mesh']),
      colorLayers: z.array(
        z.object({
          hex: z.string(),
          areaPct: z.number().min(0).max(100),
          maskAssetId: id,
        }),
      ),
      suggestedMode: z.enum(['outline', 'relief', 'sculpt']),
      reason: z.string(),
      lints: z.array(
        z.object({
          code: z.enum(['stroke', 'gap', 'island']),
          message: z.string(),
          valueMm: z.number(),
          limitMm: z.number(),
        }),
      ),
      flags: z.array(OriginFlagSchema),
    }),
  }),
  'mesh3d.estimate': def({
    description:
      'What an image-to-3D generation would cost and how long it takes, before asking for confirmation.',
    kind: 'query',
    tool: true,
    input: z.object(meshRequest),
    output: EstimateSchema,
  }),
  'mesh3d.create': def({
    description:
      'Generate a 3D model from one to four photos of an object, for a high relief or a full-round body. Costs money and takes about a minute; poll mesh3d.get. Needs a person’s attestation for pieces made from someone’s artwork.',
    kind: 'mutation',
    tool: { confirm: true },
    input: z.object({ pieceId: id, ...meshRequest }),
    output: MeshJobSchema,
  }),
  'mesh3d.list': def({
    description: 'Image-to-3D jobs for a piece, newest first.',
    kind: 'query',
    tool: true,
    input: z.object({ pieceId: id }),
    output: z.array(MeshJobSchema),
  }),
  'mesh3d.get': def({
    description: 'One image-to-3D job with its status, progress and resulting mesh asset.',
    kind: 'query',
    tool: true,
    input: z.object({ id }),
    output: MeshJobSchema,
  }),
  'mesh3d.cancel': def({
    description: 'Cancel a queued or running image-to-3D job.',
    kind: 'mutation',
    input: z.object({ id }),
    output: MeshJobSchema,
  }),

  // ── Render ────────────────────────────────────────────────────────────────────────────────
  'scenes.list': def({
    description:
      'Saved shots for a piece, in shot-list order; `pieceId: null` lists the organisation’s house shots.',
    kind: 'query',
    tool: true,
    input: z.object({ pieceId: id.nullable() }),
    output: z.array(SavedSceneSchema),
  }),
  'scenes.create': def({
    description:
      'Save a shot (a render scene) for a piece, or as a house shot with `pieceId: null`. Edit it with scenes.update and render it with renders.create {sceneId}.',
    kind: 'mutation',
    tool: true,
    input: z.object({
      pieceId: id.nullable(),
      title: z.string().min(1).max(80),
      scene: RenderSceneSchema,
      position: z.number().optional(),
    }),
    output: SavedSceneSchema,
  }),
  'scenes.update': def({
    description:
      'Adjust a saved shot. `patch` is a JSON merge patch on its scene (e.g. {"camera":{"focalLength":105}}); the result is re-validated. The viewport shows the change before any render time is spent.',
    kind: 'mutation',
    tool: true,
    input: z.object({
      id,
      title: z.string().min(1).max(80).optional(),
      position: z.number().optional(),
      patch: mergePatch.optional(),
    }),
    output: SavedSceneSchema,
  }),
  'scenes.delete': def({
    description: 'Delete a saved shot. Its takes are kept.',
    kind: 'mutation',
    input: z.object({ id }),
    output: ok,
  }),
  'renders.list': def({
    description:
      'Render takes, newest first, optionally for one piece. Page with `before` (a createdAt). Each says whether the design has changed since (`stale`).',
    kind: 'query',
    tool: true,
    input: z.object({
      pieceId: id.optional(),
      purpose: z.enum(['take', 'reference']).default('take'),
      before: z.string().optional(),
      limit: z.number().int().max(200).default(60),
    }),
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
      'Queue a photoreal render (still or animation) of a piece from a saved shot (`sceneId`) or a declarative scene: look, camera, environment, overrides, animation, output. `engine: auto` uses Blender when available, else the browser (preview quality). For variants ("in rose gold"), make one call per variant with a shared `groupId` and a `variantLabel`. To re-render after critique, pass `retryOf` and a short `note`. Poll renders.get for the result.',
    kind: 'mutation',
    tool: true,
    input: z
      .object({
        pieceId: id,
        title: z.string().max(120).optional(),
        sceneId: id.optional(),
        /** Overrides the saved shot’s scene when both are given. */
        scene: RenderSceneSchema.optional(),
        groupId: z.string().min(1).max(64).optional(),
        variantLabel: z.string().max(80).optional(),
        engine: z.enum(['auto', 'blender', 'browser']).default('auto'),
        /** Let numeric checks fix framing and exposure in preview drafts first. */
        autoTune: z.boolean().default(true),
        retryOf: id.optional(),
        note: z.string().max(500).optional(),
        purpose: z.enum(['take', 'reference']).default('take'),
      })
      .refine((v) => v.scene !== undefined || v.sceneId !== undefined, {
        message: 'Give a scene or a saved sceneId',
      }),
    output: RenderJobSchema,
  }),
  'renders.complete': def({
    description:
      'Deliver the result of a browser render: the uploaded images, or the error. Only the user who queued it can complete it, once.',
    kind: 'mutation',
    input: z
      .object({
        id,
        assetIds: z.array(id).max(50).default([]),
        error: z.string().max(2000).optional(),
        seconds: z.number().nonnegative().optional(),
        device: z.string().max(200).optional(),
      })
      .refine((v) => v.assetIds.length > 0 !== (v.error !== undefined), {
        message: 'Give either the rendered assetIds or an error',
      }),
    output: RenderJobSchema,
  }),
  'renders.update': def({
    description: 'Star or rename a take.',
    kind: 'mutation',
    input: z
      .object({ id, starred: z.boolean().optional(), title: z.string().max(120).optional() })
      .refine((v) => v.starred !== undefined || v.title !== undefined, {
        message: 'Give starred or title',
      }),
    output: RenderJobSchema,
  }),
  'renders.cancel': def({
    description: 'Cancel a queued or running render.',
    kind: 'mutation',
    input: z.object({ id }),
    output: RenderJobSchema,
  }),
  'renders.delete': def({
    description: 'Delete a take. Its images remain available to anything that uses them.',
    kind: 'mutation',
    input: z.object({ id }),
    output: ok,
  }),
  'renders.engine': def({
    description:
      'Whether Blender is available for photoreal renders: version, device and path, or why not.',
    kind: 'query',
    input: none,
    output: RenderEngineStatusSchema,
  }),
  'renders.configureEngine': def({
    description:
      'Point the server at a Blender install (or `null` to search again). Checked before it is saved. Local installs only.',
    kind: 'mutation',
    role: 'owner',
    input: z.object({ blenderPath: z.string().min(1).max(1024).nullable() }),
    output: RenderEngineStatusSchema,
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
      card: newModelCard,
      attestedSynthetic: z.literal(true),
    }),
    output: BrandModelSchema,
  }),
  'models.update': def({
    description:
      'Edit a brand model’s card or name, or approve it. Approving freezes its card and portraits, records you as approver and bumps its version; set it back to draft to change them.',
    kind: 'mutation',
    input: z.object({
      id,
      name: z.string().min(1).max(80).optional(),
      /** Only the fields given change. */
      card: modelCard.partial().optional(),
      status: z.enum(['draft', 'approved']).optional(),
    }),
    output: BrandModelSchema,
  }),
  'models.estimatePortraits': def({
    description:
      'What models.generatePortraits would cost for these views and how long it takes, before asking for confirmation.',
    kind: 'query',
    tool: true,
    input: z.object({ id, views: portraitViews }),
    output: EstimateSchema,
  }),
  'models.generatePortraits': def({
    description:
      'Generate (or regenerate) the canonical portrait set for a brand model. Generate the face first; once it is kept, the other views are conditioned on it.',
    kind: 'mutation',
    tool: { confirm: true },
    input: z.object({ id, views: portraitViews }),
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
  'shots.get': def({
    description: 'One on-model image with its stage, fidelity findings and provenance.',
    kind: 'query',
    tool: true,
    input: z.object({ id }),
    output: ModelShotSchema,
  }),
  'shots.estimate': def({
    description:
      'What on-model images would cost and how long they take, before asking for confirmation.',
    kind: 'query',
    tool: true,
    input: onModelShot,
    output: EstimateSchema,
  }),
  'shots.create': def({
    description:
      'Create on-model images of a piece worn by an approved brand model (`count` images, one shot each). Uses renders of the real CAD as references and checks each result against the design; results are concepts, labelled as AI. Costs money.',
    kind: 'mutation',
    tool: { confirm: true },
    input: onModelShot,
    output: z.array(ModelShotSchema),
  }),
  'shots.cancel': def({
    description: 'Cancel an on-model image that is still being made.',
    kind: 'mutation',
    input: z.object({ id }),
    output: ModelShotSchema,
  }),
  'shots.delete': def({
    description: 'Delete an on-model image.',
    kind: 'mutation',
    input: z.object({ id }),
    output: ok,
  }),
  'shots.export': def({
    description:
      'A downloadable copy of an on-model image that passed its check against the design, with the visible “AI” disclosure label unless `label: false`. The original is never altered.',
    kind: 'mutation',
    input: z.object({ id, label: z.boolean().default(true) }),
    output: AssetSchema,
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
      'Build a manufacturer-ready production package for a piece: spec sheet PDF, dimensioned drawings, STL/STEP/3DM, stone list and BOM, cost estimate and manufacturability report, zipped as a new revision. A piece made from someone’s artwork needs a person’s attestation first (409 otherwise).',
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
    description: 'Your assistant conversations, most recent first.',
    kind: 'query',
    input: z.object({ pieceId: id.optional(), limit: z.number().int().max(100).default(30) }),
    output: z.array(ThreadSchema),
  }),
  'threads.get': def({
    description: 'One of your conversations with its messages in order, and its latest run.',
    kind: 'query',
    input: z.object({ id }),
    output: z.object({
      thread: ThreadSchema,
      messages: z.array(MessageSchema),
      run: RunSchema.nullable(),
    }),
  }),
  'threads.send': def({
    description:
      'Send a message to the assistant, starting a conversation when `threadId` is omitted, and start a run. Safe to retry with the same `clientMessageId`. Approvals still pending in the thread are declined.',
    kind: 'mutation',
    input: z.object({
      threadId: id.optional(),
      text: z.string().min(1).max(20_000),
      attachments: z.array(id).max(8).default([]),
      referenceIds: z.array(id).max(12).default([]),
      context: z
        .object({
          pieceId: id.optional(),
          boardId: id.optional(),
          sceneId: id.optional(),
          selection: z.array(id).max(200).default([]),
        })
        .default({ selection: [] }),
      /** The model tier for this run (the composer's picker); omitted = the organisation's default. */
      tier: z.enum(ASSISTANT_TIERS).optional(),
      /** The studio window sending it, which client tools are asked first. */
      clientId: z.string().min(1).max(64),
      clientMessageId: z.string().min(1).max(64),
    }),
    output: z.object({ thread: ThreadSchema, run: RunSchema }),
  }),
  'runs.decide': def({
    description:
      'Approve or decline a tool call an assistant run is waiting on. Only the run’s own user can.',
    kind: 'mutation',
    input: z.object({
      runId: id,
      toolCallId: id,
      decision: z.enum(['approve', 'deny']),
      note: z.string().max(2000).optional(),
    }),
    output: RunSchema,
  }),
  'runs.cancel': def({
    description: 'Stop an assistant run. Edits it already made stay, and can be undone.',
    kind: 'mutation',
    input: z.object({ runId: id }),
    output: RunSchema,
  }),
  'client.respond': def({
    description:
      'A studio window’s answer to a `client.request` event (a client tool call). The first answer wins.',
    kind: 'mutation',
    // Client tools include reads a viewer may make; the request itself is addressed to this user.
    role: 'viewer',
    input: z
      .object({
        requestId: id,
        output: z.unknown().optional(),
        error: z.string().max(2000).optional(),
      })
      .refine((v) => (v.output === undefined) !== (v.error === undefined), {
        message: 'Give either an output or an error',
      }),
    output: ok,
  }),
  'threads.delete': def({
    description: 'Delete a conversation.',
    kind: 'mutation',
    input: z.object({ id }),
    output: ok,
  }),
  'traces.runs': def({
    description:
      'Your assistant runs with token usage and cost, newest first; admins and owners see the whole organisation’s.',
    kind: 'query',
    input: z.object({ pieceId: id.optional(), limit: z.number().int().max(200).default(50) }),
    output: z.array(RunSchema),
  }),
  'traces.run': def({
    description:
      'One assistant run with every model and tool step, linked to the design changes it made, and the feedback it received. Runs are private to the person they acted for; admins and owners may read any run of the organisation.',
    kind: 'query',
    input: z.object({ id }),
    output: z.object({
      run: RunSchema,
      steps: z.array(StepSchema),
      feedback: z.array(FeedbackSchema),
    }),
  }),
  'traces.feedback': def({
    description:
      'Record explicit feedback on one of your runs or one of its steps (admins and owners: any run of the organisation).',
    kind: 'mutation',
    input: z.object({
      runId: id,
      stepId: id.optional(),
      rating: z.enum(['up', 'down']),
      note: z.string().max(2000).optional(),
    }),
    output: ok,
  }),

  // ── Assistant setup: never tools, so neither the model nor MCP can reach them ──────────────
  'assistant.setup.get': def({
    description:
      'How the assistant is set up: whether a Claude API key is available and where it comes from, each tier’s model and price, and any apps/server/.env overrides.',
    kind: 'query',
    input: none,
    output: AssistantSetupSchema,
  }),
  'assistant.key.set': def({
    description:
      'Save the organisation’s Claude API key on the server (encrypted). It takes effect at once. Refused while ANTHROPIC_API_KEY is set in apps/server/.env.',
    kind: 'mutation',
    role: 'admin',
    secret: ['apiKey'],
    input: z.object({ apiKey: z.string().trim().min(20).max(500) }),
    output: AssistantSetupSchema,
  }),
  'assistant.key.test': def({
    description:
      'Check a Claude API key with Claude’s free Models API: the key given, or else the one in use. Says in plain words what is wrong, and which tier models the key can use.',
    kind: 'query',
    role: 'admin',
    secret: ['apiKey'],
    input: z.object({ apiKey: z.string().trim().min(20).max(500).optional() }),
    output: z.object({
      ok: z.boolean(),
      code: z.enum(KEY_CHECK_CODES).nullable(),
      message: z.string(),
      models: z.array(z.enum(ASSISTANT_MODELS)),
    }),
  }),
  'assistant.key.remove': def({
    description: 'Remove the organisation’s saved Claude API key. The assistant turns off at once.',
    kind: 'mutation',
    role: 'admin',
    input: none,
    output: AssistantSetupSchema,
  }),

  // ── Usage ─────────────────────────────────────────────────────────────────────────────────
  'usage.summary': def({
    description: 'Metered usage and cost for the organisation over a period, by meter and by day.',
    kind: 'query',
    role: 'admin',
    input: z.object({ days: z.number().int().min(1).max(365).default(30) }),
    output: z.object({
      totalUsd: z.number(),
      byMeter: z.array(
        z.object({
          meter: z.enum(METERS),
          quantity: z.number(),
          unit: z.string(),
          costUsd: z.number(),
        }),
      ),
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

/** The commands offered to the assistant and over MCP. */
export type ToolCommandName = {
  [K in CommandName]: (typeof commands)[K]['tool'] extends undefined ? never : K
}[CommandName]

export const isToolCommand = (name: CommandName): name is ToolCommandName =>
  commands[name].tool !== undefined
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
