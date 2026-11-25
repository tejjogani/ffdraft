/**
 * The two Claude calls around an image generation, each a separate structured-output Messages call
 * on the run's (or the organisation's) tier, like the photo read:
 *
 *  - the brief, before anything is generated: understand the request and the board pictures it
 *    names, decide whether Pavé may make it (the guardrail), and write the prompt enhanced for
 *    jewelry. With `checkOnly`, the person's own edited prompt is checked and kept as written.
 *  - the check, after: look at each image the provider returned and refuse any that breaks the
 *    same rules, so a refused image is never stored.
 *
 * Both answers are checked here before anything uses them: stop reason first, then the JSON
 * against its schema. A refusal by Claude itself (`stop_reason: refusal`) is a refusal of the
 * request or of the images: the pipeline fails closed.
 */
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageStreamParams,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import {
  type AssistantModelId,
  type BriefMode,
  type BriefRead,
  BriefReadSchema,
  type ImageCheckRead,
  ImageCheckReadSchema,
} from '@pave/schema'
import type { z } from 'zod'
import { prettifyError } from 'zod'
import { EFFORT, effectiveContent } from './anthropic'
import { MODELS } from './pricing'
import type { ShapeImage } from './shape'

/** Short answers; thinking counts toward the limit, so leave it room. */
export const IMAGEGEN_MAX_TOKENS = 32_000

/** The rules both calls apply, word for word, so the check never drifts from the brief. */
const RULES = `Pavé's rules for generated images. Refuse (verdict "refuse") anything that is or asks for:
- sexual content or nudity of anyone, including "artistic" nudity and sexualised poses (category "sexual");
- a child or anyone who looks under 18 in any sexualised, unsafe or exploitative way, and any jewelry modelled on a child's body (category "minors"); jewelry worn by an adult is fine;
- a real, identifiable person (a celebrity, a public figure, a named private person, a face from a reference photo) unless the designer says that person consented (category "likeness"); a generic, anonymous adult model is fine;
- hateful content or symbols of hate, including extremist insignia, whatever the material (category "hate");
- gore, cruelty or glorified violence (category "violence"); weapons as working weapons, or jewelry that celebrates a real attack (category "weapons"); a decorative motif such as a dagger pendant or an arrow is fine;
- self-harm (category "self_harm").
Another party's trademark, logo, character or recognisable brand design (a sports team's crest, a fashion house's monogram or signature design, a cartoon character, a trophy that is itself a trademark) is not refused outright: answer "needs_rights" (category "trademark") and name it in rightsSubject, unless the designer has attested the right to use it, in which case it is allowed. A generic style ("art deco", "in the manner of a signet ring") is not a trademark.
Everything else about jewelry is allowed, including religious symbols, skulls, and pieces worn on the body by an adult model.`

/** Frozen, so repeated briefs share a cached prefix. */
export const BRIEF_SYSTEM = `You write briefs for an image model that makes concept pictures of jewelry for a jewelry designer, who will rebuild the chosen picture in CAD. Answer only in the JSON format you are given.

${RULES}

When the request is allowed, or only needs rights, write "prompt": one paragraph for the image model that keeps what the designer asked for and adds what a good jewelry concept picture needs:
- the piece kind and its parts (head, setting, band or bail, chain), the metal and its colour and finish, each stone with its cut, colour and setting;
- proportions in words a jeweler uses (a 2 mm band, a stone about 7 mm across, a pendant about 25 mm tall) when the request or references imply them;
- one clear view: front for pendants and earrings, front three-quarter for rings, unless asked otherwise; the whole piece in frame, centred, nothing cropped;
- even studio light with soft reflections, true metal and stone colours;
- a plain, seamless, light grey or white background with no props, hands, text, logos or watermarks, so the piece can be cut out and modelled in CAD.
Say what each reference picture contributes ("the trophy shape from reference 1 as the pendant's body, the milgrain border and bail of reference 2"); the image model sees the references in the same order. For a variation, keep the parent image's idea and change one or two secondary choices; for a refinement, apply the designer's change to the parent image and keep everything else. Never add a brand or a real person. Write the prompt in English, at most 120 words. "piece" describes the piece as you understood it. "understanding" is one sentence in the designer's terms.
When refused, leave "prompt" empty and give a calm, plain reason without repeating anything explicit.`

/** Frozen, as above. */
export const CHECK_SYSTEM = `You check concept pictures made by an image model for a jewelry designer before they are kept. Answer only in the JSON format you are given, one entry per image, using the image numbers as labelled.

${RULES}

Judge each picture on what it shows, not on what was asked: refuse a picture that shows any of the refused things, even if the request was innocent. A picture that shows a trademark is allowed only when the request says the designer attested the right to use it; otherwise refuse it with category "trademark". A picture that is simply poor, off-brief or not jewelry is allowed: the designer judges quality. For an allowed picture, "reason" says in a few words what it shows.`

export interface BriefImage extends ShapeImage {
  /** "Reference 1: The trophy (subject)" or "Parent image". */
  label: string
}

const fallbacksFor = (model: AssistantModelId) =>
  MODELS[model].fallbacks === 'default'
    ? { fallbacks: 'default' as const, betas: ['server-side-fallback-2026-07-01'] }
    : {}

function images(content: BetaContentBlockParam[], list: readonly BriefImage[]) {
  for (const img of list) {
    content.push({ type: 'text', text: img.label })
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data },
    })
  }
}

/** The request for a brief. Pictures first, as Claude reads best, then the designer's words. */
export function buildBriefRequest(r: {
  model: AssistantModelId
  request: string
  mode: BriefMode
  references: readonly BriefImage[]
  parent: BriefImage | null
  aspect: string
  /** Whether the provider sees the references (some take none: say so, so the prompt carries them). */
  providerSeesReferences: boolean
  /** The brand or design the designer attested the right to use, if any. */
  attested: string | null
  /** Check this prompt as the designer edited it, instead of writing one. */
  checkOnly?: string
}): BetaMessageStreamParams {
  const { type, schema } = betaZodOutputFormat(BriefReadSchema)
  const content: BetaContentBlockParam[] = []
  if (r.parent) images(content, [r.parent])
  images(content, r.references)
  const asks = [
    r.checkOnly
      ? `The designer edited the prompt themselves. Check it against the rules and return it unchanged as "prompt" if it is allowed:\n${r.checkOnly}`
      : r.mode === 'vary'
        ? 'Write a brief for a variation of the parent image.'
        : r.mode === 'refine'
          ? 'Write a brief that refines the parent image as the designer asks.'
          : 'Write a brief for new concept pictures.',
    `The designer wrote: ${r.request}`,
    `Aspect ratio: ${r.aspect}.`,
    r.references.length && !r.providerSeesReferences
      ? 'This image model cannot see the reference pictures: describe what each contributes in words, in the prompt.'
      : '',
    r.attested ? `The designer attested the right to use: ${r.attested}.` : '',
  ].filter(Boolean)
  content.push({ type: 'text', text: asks.join('\n') })
  return {
    model: r.model,
    max_tokens: IMAGEGEN_MAX_TOKENS,
    system: [{ type: 'text', text: BRIEF_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT, format: { type, schema } },
    ...fallbacksFor(r.model),
  }
}

/** The request for the check of generated images, labelled "Image 1"… in the provider's order. */
export function buildCheckRequest(r: {
  model: AssistantModelId
  request: string
  prompt: string
  images: readonly BriefImage[]
  attested: string | null
}): BetaMessageStreamParams {
  const { type, schema } = betaZodOutputFormat(ImageCheckReadSchema)
  const content: BetaContentBlockParam[] = []
  images(content, r.images)
  content.push({
    type: 'text',
    text: [
      `Check these ${r.images.length} pictures.`,
      `The designer asked: ${r.request}`,
      `The image model was given: ${r.prompt}`,
      r.attested
        ? `The designer attested the right to use: ${r.attested}.`
        : 'The designer attested no rights to any trademark.',
    ].join('\n'),
  })
  return {
    model: r.model,
    max_tokens: IMAGEGEN_MAX_TOKENS,
    system: [{ type: 'text', text: CHECK_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT, format: { type, schema } },
    ...fallbacksFor(r.model),
  }
}

/** Why a brief or check answer could not be used. `refusal`: Claude itself declined. */
export class GuardError extends Error {
  constructor(
    readonly code: 'refusal' | 'internal',
    message: string,
  ) {
    super(message)
    this.name = 'GuardError'
  }
}

function parse<S extends z.ZodType>(message: BetaMessage, schema: S, what: string): z.infer<S> {
  if (message.stop_reason === 'refusal')
    throw new GuardError(
      'refusal',
      `Claude declined to ${what}${message.stop_details?.category ? ` (${message.stop_details.category})` : ''}.`,
    )
  if (message.stop_reason === 'max_tokens')
    throw new GuardError('internal', `The ${what} was cut off before it finished. Try again.`)
  const text = effectiveContent(message.content)
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('')
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new GuardError('internal', `The ${what} did not come back as JSON. Try again.`)
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success)
    throw new GuardError(
      'internal',
      `The ${what} did not match its format: ${prettifyError(parsed.error)}`,
    )
  return parsed.data
}

export const parseBriefMessage = (message: BetaMessage): BriefRead =>
  parse(message, BriefReadSchema, 'read the request')

/**
 * The check, made whole: an image Claude did not mention is refused, so a short answer can never
 * let an unchecked picture through.
 */
export function parseCheckMessage(message: BetaMessage, count: number): ImageCheckRead {
  const read = parse(message, ImageCheckReadSchema, 'check the images')
  const byIndex = new Map(read.images.map((i) => [i.index, i]))
  return {
    images: Array.from({ length: count }, (_, k) => {
      const found = byIndex.get(k + 1)
      return (
        found ?? {
          index: k + 1,
          verdict: 'refuse' as const,
          category: 'other' as const,
          reason: 'The safety check did not report on this image, so it was not kept.',
        }
      )
    }),
  }
}
