/**
 * The canon's data model. Everything is plain, serialisable data: rules are formulas over facts
 * (no closures), style guides and exemplars are values, so the whole canon can be printed into
 * a prompt, hashed into CANON_VERSION and diffed between versions.
 */
import {
  ARCHETYPES,
  FINISH_IDS,
  GEM_CUT_IDS,
  METAL_IDS,
  NODE_KINDS,
  type EvaluationSummary,
  type NodeInput,
  NodeSchema,
  type Op,
  OpSchema,
  PIECE_KINDS,
  type PieceSpecInput,
  PieceSpecSchema,
} from '@pave/schema'
import { z } from 'zod'
import { ExprSchema } from './expr'

export const VARIANTS = ['delicate', 'classic', 'bold'] as const
export type Variant = (typeof VARIANTS)[number]

export const BandSchema = z.object({ typical: ExprSchema, min: ExprSchema, max: ExprSchema })
export type Band = z.infer<typeof BandSchema>

/** Evidence tags of research 09: sourced, prior research, kernel, derived, expert judgement. */
export const SourceSchema = z.object({
  tag: z.enum(['S', 'R', 'K', 'D', 'EJ']),
  ref: z.string().optional(),
})
export type Source = z.infer<typeof SourceSchema>

export const ConfidenceSchema = z.enum(['high', 'medium', 'low'])
export type Confidence = z.infer<typeof ConfidenceSchema>

export const RuleSchema = z.object({
  id: z.string().regex(/^[a-z][a-zA-Z]*(\.[a-z][a-zA-Z0-9]*)+$/),
  title: z.string().max(80),
  applies: z.object({
    kinds: z.array(z.enum(PIECE_KINDS)).optional(),
    archetypes: z.array(z.enum(ARCHETYPES)).optional(),
    styles: z.array(z.string()).optional(),
    nodeKind: z.enum(NODE_KINDS).optional(),
    when: ExprSchema.optional(),
  }),
  /** Schema paths constrained, `<nodeKind>.<field>[.<field>]`. */
  paths: z.array(z.string()),
  /** A derived quantity instead of a raw parameter (see measures.ts). */
  measure: z.string().optional(),
  band: BandSchema,
  variants: z.partialRecord(z.enum(VARIANTS), BandSchema).optional(),
  /** When the lint threshold is wider than the band. */
  lintAt: z.object({ below: ExprSchema.optional(), above: ExprSchema.optional() }).optional(),
  rationale: z.string().max(160),
  source: SourceSchema,
  confidence: ConfidenceSchema,
  /** default = a suggestion only; the canon never emits errors (the kernel owns those). */
  severity: z.enum(['warning', 'info', 'default']),
  fix: z.enum(['clampToBand', 'setTypical']).optional(),
  /**
   * The broader rule this one narrows (east-west elevation refines the solitaire elevation): it
   * wins over that rule when both hold, whatever the two filters score.
   */
  refines: z.string().optional(),
})
export type Rule = z.infer<typeof RuleSchema>

/** Where a style recipe or caveat applies; a recipe without it applies to the hero everywhere. */
const AppliesSchema = z.object({
  kinds: z.array(z.enum(PIECE_KINDS)).optional(),
  archetypes: z.array(z.enum(ARCHETYPES)).optional(),
  styles: z.array(z.string()).optional(),
  when: ExprSchema.optional(),
})

/** A look the schema cannot build: printed with its stand-in, never linted. */
export const CaveatSchema = z.object({
  id: z.string().regex(/^[a-z][a-zA-Z]*(\.[a-z][a-zA-Z0-9]*)+$/),
  feature: z.string().max(80),
  fallback: z.string().max(200),
  applies: AppliesSchema.omit({ when: true }),
  source: SourceSchema,
  confidence: ConfidenceSchema,
})
export type Caveat = z.infer<typeof CaveatSchema>

export const StyleGuideSchema = z.object({
  id: z.string(),
  label: z.string(),
  aliases: z.array(z.string()),
  reads: z.array(z.string()).max(5),
  vocabulary: z.object({
    motifs: z.array(z.string()),
    cuts: z.array(z.enum(GEM_CUT_IDS)),
    metals: z.array(z.enum(METAL_IDS)),
    finishes: z.array(z.enum(FINISH_IDS)),
    settings: z.array(z.string()),
  }),
  /**
   * Preferred values: a recipe moves the suggestion inside the archetype rules' bands, never out
   * of them, and only where `applies` holds.
   */
  recipes: z.array(
    z.object({
      path: z.string(),
      band: BandSchema,
      note: z.string().optional(),
      applies: AppliesSchema.omit({ styles: true }).optional(),
    }),
  ),
  /** Replaces a rule's band (and severity) for this style, where `when` holds. */
  overrides: z
    .array(
      z.object({
        ruleId: z.string(),
        band: BandSchema.optional(),
        severity: RuleSchema.shape.severity.optional(),
        when: ExprSchema.optional(),
      }),
    )
    .optional(),
  do: z.array(z.string()),
  dont: z.array(z.string()),
  cannotExpress: z.array(z.object({ feature: z.string(), fallback: z.string() })),
  source: SourceSchema,
  confidence: ConfidenceSchema,
})
export type StyleGuide = z.infer<typeof StyleGuideSchema>

// ── Design read (research 09 §6) ─────────────────────────────────────────────────────────────

export const VIEWS = ['top', 'front', 'side', 'threeQuarter', 'back', 'under', 'onBody'] as const
export type View = (typeof VIEWS)[number]

const Ratio = z.object({ value: z.number(), confidence: z.number().min(0).max(1) })

export const RATIO_KEYS = [
  'stoneToFinger',
  'bandToStone',
  'taperTopToBottom',
  'tableHeightToStone',
  'haloToStone',
  'sideToCenter',
  'prongToStone',
  'chainToPendant',
  'bailToPendant',
  'thicknessToHeight',
  'metalVisibleFraction',
] as const
export type RatioKey = (typeof RATIO_KEYS)[number]

export const DesignReadSchema = z.object({
  source: z.enum(['userRef', 'pastPiece', 'exemplar', 'ownDesign']),
  viewsSeen: z.array(z.enum(VIEWS)),
  scaleAnchor: z.enum(['ringSize', 'stoneMm', 'assumedFinger', 'none']),
  kind: z.enum(PIECE_KINDS),
  archetype: z.enum(ARCHETYPES),
  variant: z.enum(VARIANTS),
  silhouette: z.object({
    topOutline: z.string(),
    profile: z.enum(['low', 'classic', 'high']),
    symmetry: z.enum(['bilateral', 'radial', 'asymmetric']),
  }),
  ratios: z.partialRecord(z.enum(RATIO_KEYS), Ratio),
  centre: z
    .object({
      cut: z.enum(GEM_CUT_IDS),
      lw: z.number(),
      setting: z.string(),
      prongCount: z.number().optional(),
      prongTip: z.string().optional(),
      orientation: z.enum(['NS', 'EW']),
    })
    .optional(),
  stones: z.array(
    z.object({
      role: z.string(),
      cut: z.enum(GEM_CUT_IDS),
      setting: z.string(),
      count: z.number().optional(),
    }),
  ),
  shank: z
    .object({
      profile: z.string(),
      shoulder: z.string(),
      split: z.boolean(),
      coverageDeg: z.number().optional(),
    })
    .optional(),
  metal: z.object({
    colours: z.array(z.string()),
    finishes: z.array(z.string()),
    twoTone: z.boolean(),
  }),
  motifs: z.array(z.string()).max(3),
  styleTags: z.array(z.string()),
  mood: z.array(z.string()).max(3),
  distinctive: z.array(z.string()).max(3),
  notVisible: z.array(z.string()),
  uncertain: z.array(z.object({ field: z.string(), why: z.string() })),
})
export type DesignRead = z.infer<typeof DesignReadSchema>

// ── Exemplars ────────────────────────────────────────────────────────────────────────────────

const SpecInput = z.custom<PieceSpecInput>((x) => PieceSpecSchema.safeParse(x).success)
const OpInput = z.custom<Op>((x) => OpSchema.safeParse(x).success)
const NodeIn = z.custom<NodeInput>((x) => NodeSchema.safeParse(x).success)

export const ExemplarBuildSchema = z.union([
  z.object({ spec: SpecInput, ops: z.array(OpInput).optional() }),
  z.object({ kind: z.enum(PIECE_KINDS), nodes: z.array(NodeIn) }),
])
export type ExemplarBuild = z.infer<typeof ExemplarBuildSchema>

/** What an exemplar is authored as; `read` and `keyParams` are derived from the built design. */
export const ExemplarSourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Generic names, never brands. */
  title: z.string().max(60),
  kind: z.enum(PIECE_KINDS),
  archetype: z.enum(ARCHETYPES),
  styles: z.array(z.string()).min(1),
  variant: z.enum(VARIANTS),
  build: ExemplarBuildSchema,
  why: z.array(z.string().max(140)).min(1).max(3),
  /** One out-of-band change: the critic's bad anchor. `ruleId` is the fault it must trip. */
  antiTwin: z.object({ ops: z.array(OpInput).min(1), fault: z.string(), ruleId: z.string() }),
  sizeKey: z.object({ W: z.number().optional(), H: z.number().optional() }),
})
export type ExemplarSource = z.infer<typeof ExemplarSourceSchema>

export const ExemplarSchema = ExemplarSourceSchema.extend({
  read: DesignReadSchema,
  keyParams: z.record(z.string(), z.union([z.number(), z.string()])),
})
export type Exemplar = z.infer<typeof ExemplarSchema>

// ── Rubric and critique (research 09 §6) ─────────────────────────────────────────────────────

export const CRITERION_IDS = [
  'focal',
  'proportion',
  'silhouette',
  'fidelity',
  'line',
  'profile',
  'rhythm',
  'unity',
  'wearability',
  'durability',
] as const
export type CriterionId = (typeof CRITERION_IDS)[number]

export const RubricCriterionSchema = z.object({
  id: z.enum(CRITERION_IDS),
  title: z.string(),
  views: z.array(z.enum(VIEWS)),
  judgedBy: z.enum(['numbers', 'vision', 'both']),
  anchors: z.object({ 5: z.string(), 3: z.string(), 1: z.string() }),
  questions: z.array(z.string()),
})
export type RubricCriterion = z.infer<typeof RubricCriterionSchema>

export const CritiqueSchema = z.object({
  canonVersion: z.string(),
  pieceVersion: z.number().int(),
  round: z.number().int().min(0),
  scores: z.array(
    z.object({
      criterion: z.enum(CRITERION_IDS),
      score: z.union([z.literal(1), z.literal(3), z.literal(5)]),
      evidence: z.object({
        view: z.enum(VIEWS).optional(),
        nodeId: z.string().optional(),
        note: z.string(),
      }),
    }),
  ),
  /** Of 50. */
  total: z.number().min(0).max(50),
  findings: z.array(
    z.object({
      id: z.string(),
      severity: z.enum(['blocker', 'major', 'minor']),
      criterion: z.enum(CRITERION_IDS),
      nodeId: z.string().optional(),
      param: z.string().optional(),
      observed: z.number().optional(),
      target: z.tuple([z.number(), z.number()]).optional(),
      suggestion: z.string(),
    }),
  ),
  referenceDiff: z.array(
    z.object({
      refId: z.string(),
      field: z.string(),
      target: z.unknown(),
      actual: z.unknown(),
      relErr: z.number().optional(),
    }),
  ),
  verdict: z.enum(['accept', 'revise', 'ask']),
  questions: z.array(z.string()),
  visionSkipped: z.literal(true).optional(),
})
export type Critique = z.infer<typeof CritiqueSchema>

// ── Findings and slices ──────────────────────────────────────────────────────────────────────

/**
 * A diagnostic shaped like the evaluation summary's (and the kernel's), plus the rule and band it
 * came from. Declared from @pave/schema so the canon needs no kernel dependency.
 */
export type CanonFinding = EvaluationSummary['diagnostics'][number] & {
  level: 'warning' | 'info'
  code: `style.${string}`
  value: number
  limit: number
  fix?: { label: string; ops: Op[] }
  ruleId: string
  param: string
  band: [number, number]
  variant?: Variant
}

/** A rule with its band evaluated where the facts are known. */
export interface SliceRule {
  rule: Rule
  band?: { typical: number; min: number; max: number }
}

export interface ExemplarCard {
  id: string
  title: string
  archetype: Exemplar['archetype']
  variant: Variant
  styles: string[]
  keyParams: Exemplar['keyParams']
  why: string[]
  antiTwin: string
}

export interface CanonSlice {
  version: string
  /** Changes exactly when the slice's content changes; the harness re-sends only on change. */
  key: string
  rules: SliceRule[]
  styles: StyleGuide[]
  exemplars: ExemplarCard[]
  caveats: { feature: string; fallback: string }[]
  failureModes: string[]
  questions: string[]
}
