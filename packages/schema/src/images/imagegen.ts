/**
 * AI image generation on the design board: the providers, the brief Claude writes before any image
 * is made (what the person asked for, the guardrail's verdict, and the prompt enhanced for jewelry),
 * and the check of each image after it is made.
 *
 * Two of the schemas here (`BriefReadSchema`, `ImageCheckReadSchema`) are also the structured-output
 * formats sent to Claude, so they stay inside what that accepts: every field required (null when it
 * does not apply), enums, no numeric or length limits. The stored entities add ids and timestamps.
 */
import { z } from 'zod'
import { PIECE_KINDS } from '../design/design'

const id = z.string()
const iso = z.string()

/** The image providers the server can talk to. `fake` is the test provider and needs no key. */
export const IMAGE_PROVIDERS = ['gemini', 'openai', 'higgsfield', 'fake'] as const
export type ImageProviderId = (typeof IMAGE_PROVIDERS)[number]
/** Providers that need a key, in the order Settings lists them. */
export const KEYED_IMAGE_PROVIDERS = ['gemini', 'openai', 'higgsfield'] as const
export type KeyedImageProvider = (typeof KEYED_IMAGE_PROVIDERS)[number]

/** How much to spend per image: draft is the cheapest the provider offers. */
export const IMAGE_QUALITIES = ['draft', 'standard', 'high'] as const
export type ImageQuality = (typeof IMAGE_QUALITIES)[number]

/** The four images a generation makes unless asked for fewer. */
export const GENERATION_COUNT = 4

/**
 * What the guardrail refuses. `trademark` is the only one a person can lift, by attesting that
 * they own the brand or design or may use it.
 */
export const GUARDRAIL_CATEGORIES = [
  'sexual',
  'minors',
  'likeness',
  'hate',
  'violence',
  'weapons',
  'self_harm',
  'trademark',
  'other',
] as const
export type GuardrailCategory = (typeof GUARDRAIL_CATEGORIES)[number]

/** The plain sentence a person reads for each category, after the guardrail's own reason. */
export const GUARDRAIL_WORDS: Record<GuardrailCategory, string> = {
  sexual: 'Pavé does not make nude or sexual images.',
  minors: 'Pavé does not make images that sexualise or endanger children.',
  likeness: 'Pavé does not make images of a real person without their consent.',
  hate: 'Pavé does not make hateful images or symbols of hate.',
  violence: 'Pavé does not make violent or gory images.',
  weapons: 'Pavé does not make images that promote weapons or real attacks.',
  self_harm: 'Pavé does not make images that promote self-harm.',
  trademark:
    'This uses another company’s trademark or design. You can go on if you own it or have permission to use it.',
  other: 'Pavé cannot make this image.',
}

/** What the person asked a generation to do: new images, a variation of one, or a refinement. */
export const BRIEF_MODES = ['new', 'vary', 'refine'] as const
export type BriefMode = (typeof BRIEF_MODES)[number]

export const BRIEF_VERDICTS = ['allow', 'refuse', 'needs_rights'] as const

/**
 * Claude's answer to a request, before anything is generated (structured output). The verdict
 * comes first, then the reading of the request, then the enhanced prompt.
 */
export const BriefReadSchema = z.object({
  verdict: z
    .enum(BRIEF_VERDICTS)
    .describe(
      'allow; refuse for a category that can never be lifted; needs_rights when the only problem is another party’s trademark or brand design.',
    ),
  category: z
    .enum(GUARDRAIL_CATEGORIES)
    .nullable()
    .describe('Why it was refused or needs rights; null when allowed.'),
  reason: z
    .string()
    .describe('One plain sentence the designer reads: why, without repeating anything explicit.'),
  rightsSubject: z
    .string()
    .nullable()
    .describe('The brand, logo, character or design whose rights are in question; else null.'),
  understanding: z.string().describe('One sentence: what the designer wants, in their own terms.'),
  piece: z.object({
    kind: z.enum(PIECE_KINDS).nullable(),
    metal: z.string().nullable().describe('e.g. "18k yellow gold"; null when unsaid.'),
    stones: z.string().nullable().describe('e.g. "round brilliant diamond pavé"; null when none.'),
    view: z.string().describe('The camera view chosen, e.g. "front, three-quarter".'),
  }),
  prompt: z
    .string()
    .describe(
      'The enhanced prompt for the image model; empty only when refused (written when rights are needed, used once the designer attests).',
    ),
})
export type BriefRead = z.infer<typeof BriefReadSchema>

/** Claude's look at the images a provider returned (structured output), one entry per image. */
export const ImageCheckReadSchema = z.object({
  images: z.array(
    z.object({
      index: z.number().int().describe('The image number as labelled, starting at 1.'),
      verdict: z.enum(['allow', 'refuse']),
      category: z.enum(GUARDRAIL_CATEGORIES).nullable(),
      reason: z.string().describe('One plain sentence; for an allowed image, what it shows.'),
    }),
  ),
})
export type ImageCheckRead = z.infer<typeof ImageCheckReadSchema>

/** One guardrail decision, as recorded on the brief (the trace of what was allowed or refused). */
export const GuardrailDecisionSchema = z.object({
  /** `request`: the check before generating; `image`: one image after; `provider`: the provider's own filter. */
  stage: z.enum(['request', 'image', 'provider']),
  /** The image number within a generation (1-based), for image and provider decisions. */
  index: z.number().int().nullable(),
  verdict: z.enum(['allow', 'refuse', 'needs_rights', 'attested']),
  category: z.enum(GUARDRAIL_CATEGORIES).nullable(),
  reason: z.string(),
  /** The Claude model (or provider model) that decided. */
  model: z.string().nullable(),
  at: iso,
})
export type GuardrailDecision = z.infer<typeof GuardrailDecisionSchema>

/** What one image request cost, so the person sees it beside the images. */
export const GenerationCostSchema = z.object({
  /** Paid to the image provider for the images that came back. */
  imageUsd: z.number().nonnegative(),
  /** Claude: the brief and the check of the images. */
  claudeUsd: z.number().nonnegative(),
  /** True when the provider's price is a published per-image figure, not metered from its usage. */
  estimated: z.boolean(),
})

/**
 * A request as Claude understood it: the guardrail's verdict, the enhanced prompt and every
 * decision since. The prompt shown to the person is exactly the one generated from.
 */
export const ImageBriefSchema = z.object({
  id,
  boardId: id,
  /** What the person wrote. */
  request: z.string(),
  mode: z.enum(BRIEF_MODES),
  /** For vary and refine: the generated image this one starts from. */
  parentId: id.nullable(),
  referenceIds: z.array(id),
  verdict: z.enum(BRIEF_VERDICTS),
  category: z.enum(GUARDRAIL_CATEGORIES).nullable(),
  /** The guardrail's reason plus the category's sentence, ready to show. */
  reason: z.string(),
  rightsSubject: z.string().nullable(),
  /** Set when a person attested the right to use `rightsSubject`; lifts `needs_rights`. */
  attestation: z
    .object({
      rights: z.enum(['own', 'licensed', 'permission']),
      by: id,
      at: iso,
    })
    .nullable(),
  understanding: z.string(),
  piece: BriefReadSchema.shape.piece,
  /** The enhanced prompt; empty when refused (kept back until attested when rights are needed). */
  prompt: z.string(),
  aspect: z.enum(['1:1', '4:5', '3:2', '16:9']),
  provider: z.enum(IMAGE_PROVIDERS),
  model: z.string(),
  /** What generating `count` images would cost on this provider (Claude's check included). */
  estimate: z.object({
    count: z.number().int(),
    perImageUsd: z.number().nonnegative(),
    usd: z.number().nonnegative(),
    seconds: z.number().nonnegative(),
  }),
  /** The Claude model that wrote the brief, and what the brief cost. */
  claudeModel: z.string(),
  claudeUsd: z.number().nonnegative(),
  decisions: z.array(GuardrailDecisionSchema),
  /** Generations made from this brief so far. */
  generations: z.number().int(),
  createdAt: iso,
})
export type ImageBrief = z.infer<typeof ImageBriefSchema>

/** One provider as Settings, AI shows it. The key itself never leaves the server. */
export const ImageProviderSetupSchema = z.object({
  id: z.enum(IMAGE_PROVIDERS),
  label: z.string(),
  /** Where to get a key, in words (with the address when the provider publishes one). */
  keyHelp: z.string(),
  key: z.object({
    source: z.enum(['env', 'settings', 'none']),
    last4: z.string().nullable(),
    editable: z.boolean(),
    /** The .env variable that holds or would hold the key. */
    envName: z.string().nullable(),
    updatedAt: z.string().nullable(),
  }),
  configured: z.boolean(),
  model: z.string(),
  models: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      /** Per image at the organisation's quality; `priceNote` says how sure that figure is. */
      perImageUsd: z.number().nonnegative(),
      takesReferences: z.boolean(),
    }),
  ),
  priceNote: z.string(),
  /** Plain words on what this provider can and cannot do here (e.g. no reference pictures). */
  notes: z.array(z.string()),
})

export const ImageSetupSchema = z.object({
  providers: z.array(ImageProviderSetupSchema),
  /** The organisation's default provider (a board may pick another); null until one has a key. */
  defaultProvider: z.enum(IMAGE_PROVIDERS).nullable(),
  quality: z.enum(IMAGE_QUALITIES),
  /** Generating needs Claude too: it writes the prompt and checks every image. */
  claudeReady: z.boolean(),
  /** The fake test provider stands in (PAVE_IMAGE_GEN=fake); never in normal use. */
  testMode: z.boolean(),
  /** This calendar month's image spend (UTC); null for members who are not admins. */
  monthSpendUsd: z.number().nullable(),
})
export type ImageSetup = z.infer<typeof ImageSetupSchema>
