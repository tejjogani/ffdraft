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
import {
  ChangeSchema,
  DesignSchema,
  MAX_DESIGN_CHANGE_OPS,
  OpSchema,
  PIECE_KINDS,
} from '../design/design'
import { DirectionSchema, MIX_PARTS } from '../design/directions'
import {
  IntakeDetailsSchema,
  IntakeSelectionInputSchema,
  PieceIntakeSchema,
} from '../design/intake'
import { StoneChangeSchema, StoneTargetSchema } from '../design/intents'
import { NODE_KINDS, StoneSourcing } from '../design/nodes'
import { PhotoReadSchema } from '../design/photo-read'
import { PieceSpecSchema } from '../design/spec'
import {
  BRIEF_MODES,
  GENERATION_COUNT,
  GenerationCostSchema,
  GUARDRAIL_CATEGORIES,
  IMAGE_PROVIDERS,
  IMAGE_QUALITIES,
  ImageBriefSchema,
  ImageSetupSchema,
  KEYED_IMAGE_PROVIDERS,
} from '../images/imagegen'
import { PlanStatusSchema } from '../plans/plans'
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
  FolderTotalSchema,
  GENERATION_ROLES,
  GenerationInputSchema,
  IMAGE_ASPECTS,
  ImagePlaneSchema,
  JOB_STAGES,
  JOB_STATUS,
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
  ProjectCostSchema,
  QuickAnswersSchema,
  QuickQuestionSchema,
  ReferenceSchema,
  RenderEngineStatusSchema,
  RenderEstimateSchema,
  RenderInstallStatusSchema,
  RenderJobSchema,
  RenderSceneSchema,
  RIGHTS,
  ROLES,
  type Role,
  RunSchema,
  SavedSceneSchema,
  SceneChangeSchema,
  SearchResultSchema,
  SpecEstimateSchema,
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
const meshPoint = z.tuple([z.number(), z.number(), z.number()])
const componentId = z.number().int().nonnegative()
/** Every format the CAD exports to; which of them count is in plans/plans.ts. */
export const EXPORT_FORMATS = ['stl', 'step', '3dm', 'glb', 'obj', '3mf'] as const
const ok = z.object({ ok: z.literal(true) })
const none = z.object({})
/** A JSON merge patch (RFC 7396): objects merge, arrays and scalars replace, null deletes. */
const mergePatch = z.record(z.string(), z.unknown())

/** Diaex's exact public stone ID, kept opaque. */
export const DiaexStoneId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[^\s\p{Cc}]+$/u)

export const SourcedDiamondSchema = StoneSourcing.pick({ certificate: true }).extend({
  sku: DiaexStoneId,
  url: z.url({ protocol: /^https$/ }),
  measured: StoneSourcing.shape.measured.unwrap(),
  color: z.string().nullable(),
  fancyHue: z.string().optional(),
  clarity: z.string().nullable(),
  origin: z.enum(['natural', 'lab', 'any']),
  carat: z.number().positive(),
})
export type SourcedDiamond = z.infer<typeof SourcedDiamondSchema>

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

/** How a generation request is checked and enhanced before any image is made (`references.brief`). */
const briefRequest = z.object({
  boardId: id,
  /** What the designer wants, in their words ("this trophy as a pendant, in the style of this one"). */
  request: z.string().trim().min(2).max(2000),
  /** Pictures on the board to work from, in the order the request names them. */
  referenceIds: z.array(id).max(8).default([]),
  /** What each reference is for; ids must be among `referenceIds`. */
  roles: z
    .array(z.object({ id, role: z.enum(GENERATION_ROLES) }))
    .max(8)
    .default([]),
  /** new: fresh images; vary: a variation of `parentId`; refine: `parentId` changed as asked. */
  mode: z.enum(BRIEF_MODES).default('new'),
  /** The generated image to vary or refine. */
  parentId: id.optional(),
  aspect: z.enum(IMAGE_ASPECTS).default('1:1'),
  /** Another provider than the board's for this request. */
  provider: z.enum(IMAGE_PROVIDERS).optional(),
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

/** A warning from a targeted edit, with a ready fix where there is one. */
export const IntentWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  nodeId: z.string().optional(),
  suggestion: z.object({ label: z.string(), ops: z.array(OpSchema) }).optional(),
})

const SummaryDiagnostic = EvaluationSummarySchema.shape.diagnostics.element

/**
 * The ids of the spec questions asked before building from a picture (packages/agent's
 * specQuestions): the one set chat.ask may pass with more than three questions.
 */
export const SPEC_QUESTION_IDS: readonly string[] = [
  'kind',
  'size',
  'centre-stone',
  'metal',
  'budget',
]

const referenceSaveItems = z
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
  .max(50)

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
    description:
      'List folders (collections: groups of projects, e.g. a client or a season). A folder may sit in another folder (`parentId`), two levels at most.',
    kind: 'query',
    tool: true,
    input: none,
    output: z.array(CollectionSchema),
  }),
  'collections.create': def({
    description: 'Create a collection.',
    kind: 'mutation',
    tool: true,
    input: z.object({
      name: z.string().min(1).max(80),
      icon: z.string().max(8).optional(),
      /** The folder to put it in; it must be a top-level folder (two levels at most). */
      parentId: id.nullable().optional(),
    }),
    output: CollectionSchema,
  }),
  'collections.update': def({
    description:
      'Rename, re-icon, reorder or move a folder. A folder that holds folders stays at the top level.',
    kind: 'mutation',
    input: z.object({
      id,
      name: z.string().min(1).max(80).optional(),
      icon: z.string().max(8).nullable().optional(),
      position: z.number().optional(),
      parentId: id.nullable().optional(),
    }),
    output: CollectionSchema,
  }),
  'collections.delete': def({
    description:
      'Delete a folder. Its projects are kept and become unfiled; its sub-folders move up to the top level.',
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
  'pieces.startIntake': def({
    description:
      'Save a Home commission, its Design board, and all attached assets as one project. Repeat with the same requestId to return the same project.',
    kind: 'mutation',
    input: z.object({
      requestId: z.string().min(8).max(64),
      brief: z.string().trim().min(1).max(20_000),
      assetIds: z.array(id).max(8).default([]),
    }),
    output: z.object({ pieceId: id, boardId: id }),
  }),
  'pieces.confirmIntake': def({
    description:
      'Save the designer’s confirmed partial measurements and visual choice for this project without building CAD.',
    kind: 'mutation',
    input: z.object({
      pieceId: id,
      boardId: id,
      details: IntakeDetailsSchema.optional(),
      selection: IntakeSelectionInputSchema.nullable().optional(),
    }),
    output: PieceIntakeSchema,
  }),
  'pieces.addIntakeAssets': def({
    description:
      'Keep uploaded assets on this project’s Design board, skipping assets already there.',
    kind: 'mutation',
    input: z.object({ pieceId: id, boardId: id, assetIds: z.array(id).min(1).max(8) }),
    output: z.array(ReferenceSchema),
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
  'pieces.estimate': def({
    description:
      'What a spec would weigh and cost before anything is built: Pavé builds it with the canon’s proportions, evaluates it and prices it (metal weight, total carats, stone count, outside size, rough cost to make at placeholder rates, and any warnings). Without `spec` it estimates the piece’s saved spec. Show this to the designer before pieces.buildFromSpec.',
    kind: 'query',
    tool: true,
    input: z.object({ id, spec: PieceSpecSchema.optional() }),
    output: SpecEstimateSchema,
  }),
  // People's actions on the design board; the assistant takes over through a CAD job.
  'pieces.takeToCad': def({
    description:
      'Take a picture or sketch from a design board to CAD: it is pinned beside the piece’s CAD (copied with its provenance and rights), ready for the CAD job to read and build from and to lie in a view as an image plane. View-only pictures cannot be sent to AI and are refused.',
    kind: 'mutation',
    input: z.object({ pieceId: id, referenceId: id }),
    output: z.object({ pin: ReferenceSchema, assetId: id }),
  }),
  'pieces.openAsCad': def({
    description:
      'Open a 3D model (an uploaded STL, OBJ, GLB, 3MF or PLY asset) as CAD: a sculpted body added to the piece’s design as one change that can be undone, or a new piece when no `pieceId` is given. STEP files cannot be opened yet (planned).',
    kind: 'mutation',
    input: z.object({
      assetId: id,
      pieceId: id.optional(),
      title: z.string().max(120).optional(),
      collectionId: id.nullable().optional(),
    }),
    output: z.object({ piece: PieceSchema, nodeId: z.string() }),
  }),
  'pieces.duplicate': def({
    description: 'Duplicate a piece (design and spec) as a starting point for a variation.',
    kind: 'mutation',
    tool: true,
    input: z.object({ id, title: z.string().max(120).optional() }),
    output: PieceSchema,
  }),
  // Not tools for now: a .pave file is for people moving a piece between installs.
  'pieces.saveFile': def({
    description:
      'Save a piece as a native Pavé file (.pave): the design with its full change history, spec, directions, pinned references (pictures only where their rights let them travel), image planes, saved shots, thumbnails and the evaluated geometry. Always free: never counted against the plan’s exports. Returns the file as a downloadable asset.',
    kind: 'mutation',
    input: z.object({ id }),
    output: z.object({
      asset: AssetSchema,
      /** What could not go in, in plain sentences (e.g. a picture whose rights stay behind). */
      notes: z.array(z.string()),
    }),
  }),
  'pieces.openFile': def({
    description:
      'Open a .pave file uploaded as an asset as a new piece, with its history, references, image planes and shots. The file is checked first (format version, sizes, names, checksums); a file from an older Pavé is migrated, one from a newer Pavé is refused. A file saved elsewhere keeps its provenance.',
    kind: 'mutation',
    input: z.object({ assetId: id, collectionId: id.nullable().optional() }),
    output: z.object({ piece: PieceSchema, notes: z.array(z.string()) }),
  }),
  'pieces.proposeDirections': def({
    description:
      'Add design directions to a piece for the designer to compare side by side (two to four in a round). Give each a name of two to four words, a one-line idea, its honest trade-off, and one of: `spec` (a full spec), `templateId`, or `mix` (a direction with parts taken from others: `head`, `band`, `metal`, `style`). Pavé builds each with the canon’s proportions, evaluates and draws it, and returns each direction’s letter and id, metal weight, carats, stone count, rough cost, kernel warnings and style findings. Earlier directions stay as alternatives. Let the designer choose.',
    kind: 'mutation',
    tool: true,
    input: z.object({
      pieceId: id,
      directions: z
        .array(
          z
            .object({
              name: z.string().min(1).max(60).optional(),
              idea: z.string().max(240).optional(),
              tradeOff: z.string().max(240).optional(),
              spec: PieceSpecSchema.optional(),
              templateId: z.string().optional(),
              mix: z
                .object({
                  base: id.describe('The direction the mix starts from: its id or its letter.'),
                  take: z
                    .array(
                      z.object({
                        from: id.describe('The direction lending the parts: its id or its letter.'),
                        parts: z.array(z.enum(MIX_PARTS)).min(1),
                      }),
                    )
                    .min(1)
                    .max(3),
                })
                .optional(),
            })
            .refine(
              (d) => [d.spec, d.templateId, d.mix].filter((x) => x !== undefined).length === 1,
              { message: 'Give exactly one of spec, templateId or mix' },
            ),
        )
        .min(1)
        .max(4),
    }),
    output: z.object({
      directions: z.array(DirectionSchema),
      /** Letters of older unchosen directions that gave way (a piece keeps twelve). */
      dropped: z.array(z.string()),
    }),
  }),
  'pieces.chooseDirection': def({
    description:
      'Make a direction the piece’s design: its spec and its built variant replace the current ones as one undoable change, and the piece moves on to CAD. Only when the designer has picked it (in words or on its card); the other directions stay as alternatives.',
    kind: 'mutation',
    tool: true,
    input: z.object({ pieceId: id, directionId: id.describe('Its id or its letter.') }),
    output: z.object({ version: z.number().int(), direction: DirectionSchema }),
  }),
  'pieces.removeDirection': def({
    description: 'Remove a direction from a piece. The chosen one cannot be removed.',
    kind: 'mutation',
    input: z.object({ pieceId: id, directionId: id }),
    output: ok,
  }),
  'pieces.delete': def({
    description: 'Delete a piece and everything attached to it.',
    kind: 'mutation',
    tool: { confirm: true },
    input: z.object({ id }),
    output: ok,
  }),

  // ── Design document ───────────────────────────────────────────────────────────────────────
  'design.describe': def({
    description:
      'Inspect one feature by its id in this project. Returns the current values and input JSON Schema used by the CAD editor, including field descriptions, conditions, units, ranges and defaults. Use its version as baseVersion for a subsequent design.apply.',
    kind: 'query',
    tool: true,
    input: z.object({ pieceId: id, nodeId: id }),
    output: z.object({
      pieceId: id,
      nodeId: id,
      version: z.number().int(),
      kind: z.enum(NODE_KINDS),
      values: z.record(z.string(), z.unknown()),
      schema: z.record(z.string(), z.unknown()),
    }),
  }),
  'design.meshComponents': def({
    description:
      'Read the editable vertices and triangular faces of an imported mesh body in this project. IDs remain stable for the same source asset. Coordinates are absolute XYZ millimetres in the source frame before part transforms. Each face contains three vertex IDs. Page through both lists with offset and limit, or request specific IDs to inspect the endpoints of a face. Pass assetId and version back when writing meshEdits with design.apply.',
    kind: 'query',
    tool: true,
    input: z.object({
      pieceId: id,
      nodeId: id,
      offset: componentId.default(0),
      limit: z.number().int().min(1).max(100).default(30),
      vertexIds: z.array(componentId).max(100).optional(),
      faceIds: z.array(componentId).max(100).optional(),
    }),
    output: z.object({
      pieceId: id,
      nodeId: id,
      version: componentId,
      assetId: id,
      vertexCount: componentId,
      faceCount: componentId,
      vertices: z.array(z.object({ id: componentId, xyz: meshPoint })),
      faces: z.array(
        z.object({ id: componentId, vertexIds: z.tuple([componentId, componentId, componentId]) }),
      ),
    }),
  }),
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
      ops: z.array(OpSchema).min(1).max(MAX_DESIGN_CHANGE_OPS),
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
  'design.replaceStone': def({
    description:
      'Replace or resize a stone (or every stone of a row, halo or pavé field) and let the mount follow: claws, wire, side stones, shoulders and the shoulder row adjust to the new stone; ring size, metal, setting style and anything set by hand stay. Use this, never hand-written ops, for any change of cut, size, carat, colour or quality. Target one stone by node id (scope `alike` for both side stones or both studs). Give the size as `widthMm` or `carat`; a new cut with no size keeps a single stone’s carat and a field’s millimetres. `dryRun` first when the designer asked what it would cost or weigh; the reply’s `notes`, `warnings` and `delta` say what changed.',
    kind: 'mutation',
    tool: true,
    input: z.object({
      pieceId: id,
      target: StoneTargetSchema,
      change: StoneChangeSchema,
      /** Preview only: the ops and the before/after facts, nothing written. */
      dryRun: z.boolean().default(false),
      baseVersion: z.number().int().optional(),
      /** Client-generated id so retries are idempotent (an assistant call defaults to its tool call). */
      changeId: z.string().optional(),
    }),
    output: z.object({
      applied: z.boolean(),
      /** The version written, or for a preview the version looked at. */
      version: z.number().int(),
      change: StoredChangeSchema.optional(),
      ops: z.array(OpSchema),
      label: z.string(),
      notes: z.array(z.string()),
      warnings: z.array(IntentWarningSchema),
      /** Draft facts before and after; null without a geometry engine. */
      before: EvaluationSummarySchema.nullable(),
      after: EvaluationSummarySchema.nullable(),
      delta: z
        .object({ metalMassG: z.number(), caratTotal: z.number(), stoneCount: z.number() })
        .nullable(),
      diagnostics: z.object({
        added: z.array(SummaryDiagnostic),
        resolved: z.array(SummaryDiagnostic),
      }),
    }),
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
      'Export the CAD as STL, STEP, 3DM, GLB, OBJ or 3MF. Returns a downloadable asset. STEP and 3DM count against the plan’s monthly allowance of CAD exports (plan_limit, 402, once it is used up); STL, 3MF, OBJ and GLB are never counted. A piece made from someone’s artwork needs a person’s attestation first (409 otherwise).',
    kind: 'mutation',
    tool: true,
    input: z.object({
      pieceId: id,
      format: z.enum(EXPORT_FORMATS),
      stones: z.boolean().optional(),
      /** The studio's claim (plan.claim) when its own exporter failed; never set by the assistant. */
      claimId: id.optional(),
    }),
    output: z.object({ asset: AssetSchema, notes: z.array(z.string()) }),
  }),

  // ── Sourcing ──────────────────────────────────────────────────────────────────────────────
  'sourcing.search': def({
    description:
      'Find available Diaex diamonds near a single stone’s size, or look up its exact public ID.',
    kind: 'query',
    input: z.object({
      pieceId: id,
      nodeId: id,
      color: z.string().trim().min(1).max(32).optional(),
      sku: DiaexStoneId.optional(),
    }),
    output: z.object({
      candidates: z.array(SourcedDiamondSchema),
      searchUrl: z.url({ protocol: /^https$/ }),
    }),
  }),
  'sourcing.stone': def({
    description:
      'Recheck an exact Diaex diamond against the piece’s current stone before applying its measurements.',
    kind: 'query',
    input: z.object({ pieceId: id, nodeId: id, sku: DiaexStoneId }),
    output: SourcedDiamondSchema,
  }),

  // ── Ideate ────────────────────────────────────────────────────────────────────────────────
  'boards.list': def({
    description: 'List moodboards.',
    kind: 'query',
    tool: true,
    input: z.object({ pieceId: id.optional(), scope: z.literal('library').optional() }),
    output: z.array(BoardSchema),
  }),
  'boards.get': def({
    description: 'A moodboard with all of its references.',
    kind: 'query',
    tool: true,
    input: z.object({ id }),
    output: z.object({ board: BoardSchema, references: z.array(ReferenceSchema) }),
  }),
  'boards.forPiece': def({
    description:
      'The piece’s design board (the moodboard linked to it, shown on its Design stage), created when it has none. Save references, sketches and pictures for the piece here.',
    kind: 'mutation',
    tool: true,
    input: z.object({ pieceId: id }),
    output: BoardSchema,
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
      /** The image provider this board generates with; null = the organisation's default. */
      imageProvider: z.enum(IMAGE_PROVIDERS).nullable().optional(),
    }),
    output: BoardSchema,
  }),
  'boards.importMoodboard': def({
    description: 'Copy references from a studio moodboard into an owned project board.',
    kind: 'mutation',
    input: z.object({ sourceBoardId: id, pieceId: id, targetBoardId: id.optional() }),
    output: z.object({ board: BoardSchema, added: z.number().int().nonnegative() }),
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
      items: referenceSaveItems,
    }),
    output: z.array(ReferenceSchema),
  }),
  'references.saveForPiece': def({
    description:
      'Save references to the piece’s design board, creating the board with its first items.',
    kind: 'mutation',
    input: z.object({ pieceId: id, items: referenceSaveItems }),
    output: z.array(ReferenceSchema),
  }),
  'references.proposeConcepts': def({
    description:
      'Save up to four distinct pre-CAD concepts as selectable notes on the project’s Design board. Each note describes what changes visually and preserves the confirmed measurements and materials. Generated images already on the board can be chosen directly.',
    kind: 'mutation',
    tool: true,
    input: z.object({
      boardId: id,
      concepts: z
        .array(
          z.object({
            title: z.string().trim().min(1).max(100),
            note: z.string().trim().min(1).max(2000),
          }),
        )
        .min(1)
        .max(4),
    }),
    output: z.array(ReferenceSchema),
  }),
  'references.pins': def({
    description:
      'The references pinned to a piece for the reference panel beside CAD, in the designer’s order, with source, credit, licence and rights. A view-only pin comes with its details only: its picture is never shown to you and cannot be read or fitted.',
    kind: 'query',
    tool: true,
    input: z.object({ pieceId: id }),
    output: z.object({
      /** The piece's pin board; null until the first pin. */
      boardId: id.nullable(),
      references: z.array(ReferenceSchema),
    }),
  }),
  'references.pin': def({
    description:
      'Pin references to a piece so they show in the reference panel beside CAD. Each item is exactly one of `result` (a search result, re-checked with its provider; its picture is kept only where the provider’s terms allow), `assetId` (an uploaded picture), `url` (a web page, kept as a view-only link) or `referenceId` (a reference on one of the organisation’s boards, copied with its provenance and rights).',
    kind: 'mutation',
    tool: true,
    input: z.object({
      pieceId: id,
      items: z
        .array(
          z
            .object({
              result: SearchResultSchema.optional(),
              url: z.string().url().optional(),
              assetId: id.optional(),
              referenceId: id.optional(),
              title: z.string().max(200).optional(),
              note: z.string().max(4000).optional(),
              /** As in references.save: uploads may say whose they are; others can only be lowered to `viewOnly`. */
              rights: z.enum(RIGHTS).optional(),
            })
            .refine(
              (item) =>
                [item.result, item.url, item.assetId, item.referenceId].filter(
                  (x) => x !== undefined,
                ).length === 1,
              { message: 'Give exactly one of result, url, assetId or referenceId' },
            ),
        )
        .min(1)
        .max(20),
    }),
    output: z.array(ReferenceSchema),
  }),
  'references.place': def({
    description:
      'Lay a pinned picture in a CAD view (front, top or right) as an image plane to model over; move, scale, fade or lock it; or take it out of the view with `plane: null`. A plane belongs to the viewport, never to the design.',
    kind: 'mutation',
    input: z.object({ id, plane: ImagePlaneSchema.nullable() }),
    output: ReferenceSchema,
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
      'What generating images on a board would cost with its image provider (the provider’s price plus Claude’s check of each image), and about how long it takes.',
    kind: 'query',
    tool: true,
    input: z.object({
      boardId: id,
      count: z.number().int().min(1).max(GENERATION_COUNT).default(GENERATION_COUNT),
      provider: z.enum(IMAGE_PROVIDERS).optional(),
    }),
    output: EstimateSchema.extend({ count: z.number().int(), perImageUsd: z.number() }),
  }),
  'references.brief': def({
    description:
      'Before generating concept images: Claude reads the designer’s request and the board pictures it names, checks it against Pavé’s rules (no nudity, minors, a real person’s likeness, hate or violence; another company’s trademark or design needs the designer’s attestation), and writes the enhanced jewelry prompt (piece, metal, stones and cut, proportions, view, light, a clean background). Returns the brief to show before references.generate. Costs a little.',
    kind: 'mutation',
    tool: true,
    input: briefRequest,
    output: ImageBriefSchema,
  }),
  'references.attestBrief': def({
    description:
      'The designer attests that they own, have licensed or have permission to use the brand or design a brief names, which lets it generate. People only: never a tool.',
    kind: 'mutation',
    input: z.object({ id, rights: z.enum(ATTESTATION_RIGHTS) }),
    output: ImageBriefSchema,
  }),
  'references.generate': def({
    description:
      'Generate concept images (four unless asked for fewer) from a brief made by references.brief, onto its board. Each image is checked by Claude before it is kept; refused images are never stored. Pass `prompt` only to change the brief’s enhanced prompt (it is checked again). Each image keeps its prompt, references and parents. Costs money per image.',
    kind: 'mutation',
    tool: { confirm: true },
    input: z.object({
      briefId: id,
      /** The enhanced prompt as the designer edited it; checked again when it differs. */
      prompt: z.string().trim().min(3).max(4000).optional(),
      count: z.number().int().min(1).max(GENERATION_COUNT).default(GENERATION_COUNT),
      /** Repeat a result exactly, where the provider supports seeds. */
      seed: z.number().int().min(0).optional(),
    }),
    output: z.object({
      brief: ImageBriefSchema,
      /** The images kept, in the order the provider returned them. */
      references: z.array(ReferenceSchema),
      /** Images the guardrail (or the provider’s own filter) refused; never stored. */
      refused: z.array(
        z.object({
          index: z.number().int(),
          category: z.enum(GUARDRAIL_CATEGORIES),
          reason: z.string(),
        }),
      ),
      provider: z.enum(IMAGE_PROVIDERS),
      model: z.string(),
      cost: GenerationCostSchema,
      notes: z.array(z.string()),
    }),
  }),
  'references.briefs': def({
    description:
      'The image briefs of a board, newest first: each request, its guardrail verdict and decisions, and the enhanced prompt.',
    kind: 'query',
    input: z.object({ boardId: id, limit: z.number().int().min(1).max(50).default(20) }),
    output: z.array(ImageBriefSchema),
  }),
  'references.read': def({
    description:
      'Read one to four photos of one piece (uploaded image assets): its kind, the camera angle, the archetype, each group of stones (cut, arrangement, setting, claws), the band profile and proportions as ratios, the metal, and what the photos hide, each part marked visible, partly or not. Call it first when the designer wants a design from a photo or a picture from the design board; use the saved specification and ask only unresolved questions with chat.ask. For new designs, confirm the specDraft before saving it with pieces.setSpec. It is a separate Claude call on the conversation’s tier and costs a little.',
    kind: 'mutation',
    tool: true,
    input: z.object({
      assetIds: z.array(id).min(1).max(4),
      /** What the designer says the piece is, when the photo is ambiguous. */
      kindHint: z.enum(PIECE_KINDS).optional(),
      /** Anything else the designer said about the photo ("the left one", "ignore the chain"). */
      note: z.string().max(500).optional(),
    }),
    output: z.object({
      read: PhotoReadSchema,
      /**
       * The read as a spec the canon can fill in: categories from the read, proportions turned
       * into millimetres through an assumed centre stone and ring size (listed in `assumed`).
       */
      specDraft: PieceSpecSchema,
      assumed: z.array(z.string()),
      /** Whether a cut-out of the piece can be made from the first photo (match.fit needs one). */
      cutout: z.object({ ok: z.boolean(), reason: z.string() }),
      /**
       * The spec questions to ask before building (kind, size, centre stone, metal, budget), each
       * with the read's answer as its default: pass them to chat.ask as they are.
       */
      questions: z.array(QuickQuestionSchema),
      model: z.string(),
    }),
  }),
  'match.traceOutline': def({
    description:
      'Trace the silhouette and holes of a selected project logo or flat artwork on a plain background. The returned SVG path can supply the source of an editable vectorBody. Use the agreed height, thickness and metal from the project spec. Preview only.',
    kind: 'query',
    tool: true,
    input: z.object({ pieceId: id, referenceId: id }),
    output: z.object({
      path: z.string(),
      width: z.number(),
      height: z.number(),
      version: z.number().int(),
      islands: z.number().int(),
    }),
  }),
  'match.fit': def({
    description:
      'Fit a built piece to a photo by its outline: Pavé renders the design from the photo’s angle and adjusts a handful of sizes (the centre stone, the band’s width and thickness, claw thickness, halo stones, the bail) until the outlines agree. Use after building from a references.read whose `cutout.ok` is true. Takes up to `seconds`; returns the ops to apply with design.apply (it never changes the piece itself), the overlap reached, and which numbers the photo could not constrain. `quality: poor` means the recipe does not explain the photo: do not apply, compare by eye instead.',
    // Changes nothing, but it is a long computation: run it in turn, never cached or refetched.
    kind: 'mutation',
    tool: true,
    input: z.object({
      pieceId: id,
      /** The photo: an uploaded image of the piece on a plain background. */
      assetId: id,
      /** The angle the photo was taken from, from references.read; omitted = searched. */
      view: z.enum(['top', 'front', 'side', 'threeQuarter', 'back', 'under']).optional(),
      seconds: z.number().int().min(10).max(120).default(45),
    }),
    output: z.object({
      quality: z.enum(['good', 'poor', 'failed']),
      /** Why the quality is what it is, in plain words. */
      reason: z.string(),
      /** Outline overlap of the fitted design with the photo (1 = identical); null when not fitted. */
      overlap: z.number().nullable(),
      /** The design version that was fitted; apply the ops on top of it. */
      version: z.number().int(),
      ops: z.array(OpSchema),
      params: z.array(
        z.object({
          key: z.string(),
          from: z.number(),
          to: z.number(),
          /** `assumed`: the photo could not constrain it, so it keeps the recipe’s value. */
          status: z.enum(['fitted', 'assumed', 'pinned', 'clamped', 'weak', 'unmoved']),
        }),
      ),
      camera: z.object({ azimuth: z.number(), elevation: z.number() }).nullable(),
      stopped: z.enum(['converged', 'poor', 'budget', 'aborted', 'rejected']),
      evaluations: z.number().int(),
      seconds: z.number(),
    }),
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
      'Adjust a saved shot. `patch` is a JSON merge patch on its scene (e.g. {"camera":{"focalLength":105}}); the result is re-validated, and the viewfinder shows the change before any render time is spent. Each change can be undone (scenes.revert). To move the camera, set {"camera":{"preset":"custom","position":[x,y,z],"target":[x,y,z]}} in the piece\'s millimetres (Z up, the front faces −Y; the result names the current pose) and optionally `roll` in degrees; keep the target to orbit, move both to pan. A shot whose camera is `locked` cannot be moved until a person unlocks it.',
    kind: 'mutation',
    tool: true,
    input: z.object({
      id,
      title: z.string().min(1).max(80).optional(),
      position: z.number().optional(),
      patch: mergePatch.optional(),
      /** Swap the take this shot uses in the set (one of its takes); null = its newest. */
      takeId: id.nullable().optional(),
    }),
    output: SavedSceneSchema,
  }),
  'scenes.suggest': def({
    description:
      'Before setting up shots: what matters in this piece for photography (its kind, centre stone, halo, pavé, engraving, gallery) and the shot vocabulary for it, each with a camera already placed for the aspect ratio you give (hero three-quarter, profile, top-down, macro on the centre stone, low angle; per kind for pendants, earrings and bracelets), the framing it predicts, and default quick questions for chat.ask. Pass a camera to scenes.create as it is or adjusted; then check the framing with scenes.capture before rendering.',
    kind: 'query',
    tool: true,
    input: z.object({
      pieceId: id,
      aspect: z.enum(['1:1', '4:5', '9:16', '16:9', '3:2']).default('1:1'),
    }),
    output: z.object({
      kind: z.enum(PIECE_KINDS),
      /** What matters about the piece in pictures, one plain line each. */
      features: z.array(z.string()),
      centreStoneNodeId: id.nullable(),
      shots: z.array(
        z.object({
          key: z.string(),
          title: z.string(),
          /** Why a jeweller shoots it: what it shows. */
          why: z.string(),
          camera: RenderSceneSchema.shape.camera,
          /** e.g. "64% · good" (the piece), or the centre stone's fill for a macro. */
          framing: z.string(),
        }),
      ),
      questions: z.array(QuickQuestionSchema),
    }),
  }),
  'scenes.capture': def({
    description:
      "Look through saved shots' cameras before spending render time: a plain clay picture of each shot exactly as its camera frames it (its aspect ratio, lens and roll), drawn on the server, with the framing measured: how much of the frame the piece fills (for a macro, the centre stone) and whether anything is cut off or too small. Fix a shot that fails with scenes.update and capture it again. When a shot copies a shot reference, name it in `references` so the reference is shown beside the capture.",
    kind: 'query',
    tool: true,
    input: z.object({
      ids: z.array(id).min(1).max(6),
      /** Long side of each picture, in pixels. */
      size: z.number().int().min(192).max(768).default(384),
      /**
       * The shot reference each shot copies (an image asset the designer pinned or attached):
       * it is shown beside that shot's capture, to the designer and to you, so the two can be
       * compared before rendering.
       */
      references: z
        .array(z.object({ id, assetId: id }))
        .max(6)
        .optional(),
    }),
    output: z.object({
      version: z.number().int(),
      shots: z.array(
        z.object({
          id,
          title: z.string(),
          assetId: id.nullable(),
          /** What must be in the frame: the whole piece, or the centre stone for a macro. */
          subject: z.enum(['piece', 'centre stone']),
          framing: z.string(),
          ok: z.boolean(),
          /** What is wrong and how to fix it, in plain words; null when the framing is good. */
          problem: z.string().nullable(),
          /** The shot reference this shot copies, when one was named. */
          referenceAssetId: id.nullable(),
        }),
      ),
    }),
  }),
  'scenes.history': def({
    description: 'The changes made to a saved shot, newest first: before and after, and by whom.',
    kind: 'query',
    input: z.object({ id, limit: z.number().int().min(1).max(200).default(50) }),
    output: z.array(SceneChangeSchema),
  }),
  'scenes.revert': def({
    description:
      'Undo a change to a saved shot: `changeId`, or the latest change not yet undone. Only the fields that change touched go back; later changes to other fields stay. Undoing an undo redoes it. Refused while the camera is locked if it would move it.',
    kind: 'mutation',
    tool: true,
    input: z.object({ id, changeId: id.optional() }),
    output: z.object({ scene: SavedSceneSchema, change: SceneChangeSchema }),
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
      /** Only takes in these states, e.g. the queued ones a window should render. */
      status: z.array(z.enum(JOB_STATUS)).max(5).optional(),
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
  'renders.estimate': def({
    description:
      'How long takes would keep this computer busy, before rendering them: one entry per take (a saved `sceneId` or a `scene`). Renders cost machine time on this computer, not money. Says which engine would render them and whether the time is measured on this machine or a typical figure.',
    kind: 'query',
    tool: true,
    input: z.object({
      pieceId: id,
      takes: z
        .array(
          z
            .object({ sceneId: id.optional(), scene: RenderSceneSchema.optional() })
            .refine((v) => v.scene !== undefined || v.sceneId !== undefined, {
              message: 'Give a scene or a saved sceneId',
            }),
        )
        .min(1)
        .max(48),
      autoTune: z.boolean().default(false),
      engine: z.enum(['auto', 'blender', 'browser']).default('auto'),
    }),
    output: RenderEstimateSchema,
  }),
  'renders.create': def({
    description:
      'Queue a photoreal render (still or animation) of a piece from a saved shot (`sceneId`) or a declarative scene: look, camera, environment, overrides, animation, output. `engine: auto` uses Blender when available, else the browser (preview quality, labelled so). Each finished Blender take counts against the plan’s monthly render allowance (plan_limit, 402, once it is used up; a failed or canceled take is not counted); browser takes never count. It costs machine time on this computer, not money; outside a Render job the designer approves it, and every call in one turn is approved together. For variants ("in rose gold and platinum"), make one call per variant in the same turn, with a shared `groupId`, a `variantLabel` and the metal in `scene.overrides["*"]`. A take renders exactly the scene asked for (fixed seed: the same scene gives the same pixels); `autoTune: true` lets numeric checks adjust framing and exposure in a draft first, for inside a Render job or when the designer asks you to improve a shot. To re-render after a critique, pass `retryOf` (the take it replaces) and a short `note` saying what changed. In a conversation you do not poll: the result arrives when the take is finished, with the image.',
    kind: 'mutation',
    tool: { confirm: true },
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
        /**
         * Let numeric checks fix framing and exposure in a preview draft first. Off by default:
         * a take renders exactly the scene asked for.
         */
        autoTune: z.boolean().default(false),
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
        /** `sceneHash` of the resolved scene the browser drew. */
        sceneHash: z.string().max(64).optional(),
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

  'renders.installStatus': def({
    description: 'Check availability and progress of the built-in local Blender installer.',
    kind: 'query',
    role: 'owner',
    input: z.strictObject({}),
    output: RenderInstallStatusSchema,
  }),
  'renders.installEngine': def({
    description: 'Install the pinned Blender release on this computer in the background.',
    kind: 'mutation',
    role: 'owner',
    input: z.strictObject({}),
    output: RenderInstallStatusSchema,
  }),
  'renders.cancelInstall': def({
    description: 'Cancel a running Blender installation on this computer.',
    kind: 'mutation',
    role: 'owner',
    input: z.strictObject({}),
    output: RenderInstallStatusSchema,
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
      'Build a manufacturer-ready production package for a piece: spec sheet PDF, dimensioned drawings, STL/STEP/3DM, stone list and BOM, cost estimate and manufacturability report, zipped as a new revision. A package with its STEP and 3DM files counts as one CAD export against the plan’s monthly allowance; `cadFiles: false` builds it with STL only, which is never counted. A piece made from someone’s artwork needs a person’s attestation first (409 otherwise).',
    kind: 'mutation',
    tool: true,
    input: z.object({
      pieceId: id,
      /** Include the editable STEP and 3DM files (one CAD export). */
      cadFiles: z.boolean().default(true),
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
          /** Home stays in Design until the designer explicitly hands the concept to CAD. */
          intake: z.literal(true).optional(),
          /** Talk through ideas without changing the studio or continuing an AI job. */
          brainstorm: z.literal(true).optional(),
          selection: z.array(id).max(200).default([]),
          /** The stage tab the message was sent from: the run's spend counts against it. */
          stage: z.enum(JOB_STAGES).optional(),
        })
        .default({ selection: [] }),
      /** The model tier for this run (the composer's picker); omitted = the organisation's default. */
      tier: z.enum(ASSISTANT_TIERS).optional(),
      /**
       * Start an AI job for a stage of the piece (a stage's button, or a starter in the dock):
       * the run gets the stage's plan. Without it, a message in a thread whose last job waits for
       * review or is paused carries that job on (a change asked for by chat).
       */
      job: z
        .object({
          stage: z.enum(JOB_STAGES),
          goal: z.string().trim().min(1).max(300).optional(),
          /** A Render job: the machine time its Start popover showed (its own approval's budget). */
          machineSeconds: z.number().int().min(0).max(604_800).optional(),
        })
        .optional(),
      /** The studio window sending it, which client tools are asked first. */
      clientId: z.string().min(1).max(64),
      clientMessageId: z.string().min(1).max(64),
    }),
    output: z.object({ thread: ThreadSchema, run: RunSchema }),
  }),
  'runs.pause': def({
    description:
      'Pause a running AI job: it stops where it is, keeping its edits. `takeover` says the person is carrying on by hand. Resume replans from the piece as it is then.',
    kind: 'mutation',
    input: z.object({ runId: id, takeover: z.boolean().default(false) }),
    output: RunSchema,
  }),
  'runs.resume': def({
    description:
      'Carry a paused, stopped or finished AI job on in a new run of the same conversation, replanning from the piece as it is now (a person’s edits since are kept). With `redoStepId`, that step and the ones after it are done again.',
    kind: 'mutation',
    input: z.object({
      runId: id,
      redoStepId: z.string().min(1).max(64).optional(),
      tier: z.enum(ASSISTANT_TIERS).optional(),
      clientId: z.string().min(1).max(64),
      clientMessageId: z.string().min(1).max(64),
    }),
    output: z.object({ thread: ThreadSchema, run: RunSchema }),
  }),
  'runs.accept': def({
    description: 'Accept the outputs of a finished AI job, ending its review.',
    kind: 'mutation',
    input: z.object({ runId: id }),
    output: RunSchema,
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
      /**
       * Answering a `chat.ask`: the option ids picked, by question id. A question left out (or
       * answered with nothing valid) takes its defaults, so Go alone is a full answer.
       */
      answers: z.record(z.string(), z.array(z.string()).max(6)).optional(),
    }),
    output: RunSchema,
  }),
  'chat.ask': def({
    description:
      'Ask the designer one to three short questions as quick replies, and wait for their answer: each with two to six options and the good default already picked (`defaults`), so one press of Go answers with no typing. Ask only what changes the work and cannot be read from the piece or the brief (for directions: the budget, the metal, who wears it; for CAD: the ring size, the centre stone, the setting the spec leaves open; for renders: what the images are for, aspect ratios, which animations); never more than three, except on a new photo-only brief, when up to five unresolved spec questions from references.read are allowed. Keep saved project decisions. Write `intro` as one plain sentence saying what you saw and what you are about to do. The result is what they picked; if they type a message instead, that message is the answer.',
    kind: 'query',
    tool: { confirm: true },
    input: z.object({
      intro: z.string().min(1).max(300),
      /** Three at most, except the five spec questions references.read returns. */
      questions: z
        .array(QuickQuestionSchema)
        .min(1)
        .max(5)
        .refine((qs) => qs.length <= 3 || qs.every((q) => SPEC_QUESTION_IDS.includes(q.id)), {
          message:
            'Ask at most three questions; only the spec questions references.read returns (up to five) may be passed together',
        }),
    }),
    output: QuickAnswersSchema,
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

  'images.setup.get': def({
    description:
      'How image generation is set up: each provider, where its key comes from (never the key), its models and prices, the default provider and quality.',
    kind: 'query',
    input: none,
    output: ImageSetupSchema,
  }),
  'images.key.set': def({
    description:
      'Save an image provider’s API key on the server (encrypted). It takes effect at once. Refused while the provider’s key is set in apps/server/.env.',
    kind: 'mutation',
    role: 'admin',
    secret: ['apiKey'],
    input: z.object({
      provider: z.enum(KEYED_IMAGE_PROVIDERS),
      apiKey: z.string().trim().min(8).max(500),
    }),
    output: ImageSetupSchema,
  }),
  'images.key.test': def({
    description:
      'Check an image provider’s key with a free request to the provider (its model list): the key given, or else the one in use.',
    kind: 'query',
    role: 'admin',
    secret: ['apiKey'],
    input: z.object({
      provider: z.enum(KEYED_IMAGE_PROVIDERS),
      apiKey: z.string().trim().min(8).max(500).optional(),
    }),
    output: z.object({
      ok: z.boolean(),
      code: z.enum(KEY_CHECK_CODES).nullable(),
      message: z.string(),
    }),
  }),
  'images.key.remove': def({
    description: 'Remove an image provider’s saved API key.',
    kind: 'mutation',
    role: 'admin',
    input: z.object({ provider: z.enum(KEYED_IMAGE_PROVIDERS) }),
    output: ImageSetupSchema,
  }),
  'images.settings.update': def({
    description:
      'Choose the default image provider, the quality (draft is cheapest) and each provider’s model.',
    kind: 'mutation',
    role: 'admin',
    input: z.object({
      defaultProvider: z.enum(IMAGE_PROVIDERS).nullable().optional(),
      quality: z.enum(IMAGE_QUALITIES).optional(),
      /** Only the providers given change; null puts one back on its default model. */
      models: z
        .partialRecord(z.enum(KEYED_IMAGE_PROVIDERS), z.string().max(80).nullable())
        .optional(),
    }),
    output: ImageSetupSchema,
  }),

  // ── Usage ─────────────────────────────────────────────────────────────────────────────────
  'projects.summary': def({
    description:
      'What each project (piece) has cost, stage by stage: Claude runs and image generations in USD, Blender renders and Rhino/STEP exports counted against the plan, and what each stage holds. With `collectionId`, the projects in that folder and its sub-folders; with `pieceIds`, those projects. Also each folder’s totals.',
    kind: 'query',
    tool: true,
    input: z.object({
      collectionId: id.nullable().optional(),
      pieceIds: z.array(id).max(200).optional(),
    }),
    output: z.object({
      projects: z.array(ProjectCostSchema),
      folders: z.array(FolderTotalSchema),
    }),
  }),
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

  // ── Plan: never tools; the assistant sees its allowance in the context message ──────────────
  'plan.get': def({
    description:
      'The organisation’s plan and this month’s use of its allowances (Blender renders, Rhino and STEP exports), and when the counts reset.',
    kind: 'query',
    input: none,
    output: PlanStatusSchema,
  }),
  'plan.claim': def({
    description:
      'Claim one CAD export from the allowance before the studio exports in the browser, so the server still decides. Formats that are never counted return `counted: false` and no claim. The same `key` returns the same claim. Refused with plan_limit (402) once the allowance is used up.',
    kind: 'mutation',
    input: z.object({
      pieceId: id,
      format: z.enum(EXPORT_FORMATS),
      /** Made once per export attempt by the studio, so a retried claim is counted once. */
      key: z.string().min(8).max(100),
    }),
    output: z.object({ claimId: id.nullable(), counted: z.boolean(), plan: PlanStatusSchema }),
  }),
  'plan.settle': def({
    description:
      'Say how a claimed browser export ended: `delivered: false` (it failed or was canceled before the file was saved) gives the export back to the allowance. Only the person who claimed it, once.',
    kind: 'mutation',
    input: z.object({ claimId: id, delivered: z.boolean() }),
    output: PlanStatusSchema,
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
