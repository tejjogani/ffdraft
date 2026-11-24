/**
 * The structured read of a photo (`references.read`): one Messages call, separate from the
 * conversation, whose answer is constrained to `PhotoReadSchema` by structured outputs. It runs on
 * the model of the conversation's tier, with the same per-model rules as a turn (fallbacks except
 * on Haiku, effort set explicitly, adaptive thinking), and is checked here before anything uses it:
 * stop reason first, then the JSON against the schema.
 *
 * `specFromRead` turns the read into a spec draft in code, so the categories the model read become
 * a buildable spec without the model converting ratios to millimetres in its head. Whatever the
 * draft had to assume (the scale, above all) is listed, so the conversation can say so.
 */
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageStreamParams,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import {
  type AssistantModelId,
  gemDimsFromCarat,
  type MetalId,
  type PhotoRead,
  PhotoReadSchema,
  type PieceKind,
  type PieceSpecInput,
  type StoneSpec,
} from '@pave/schema'
import { z } from 'zod'
import { EFFORT, effectiveContent } from './anthropic'
import { MODELS } from './pricing'
import type { ShapeImage } from './shape'

/** A read is short; thinking counts toward the limit, so leave it room. */
export const READ_MAX_TOKENS = 32_000

/** Frozen, so repeated reads share a cached prefix. */
export const READ_SYSTEM = `You read photos of jewelry for a CAD program that rebuilds the piece parametrically. Answer only in the JSON format you are given; "observations" comes first, then every other field.

Rules:
- Read categories, not totals: the kind, the archetype, each group of stones (cut, arrangement, setting, claws), the band profile and shoulders, the metal colour and finish.
- Never give millimetres: scale is not in a photo. Proportions are ratios of things in the same photo (the band's width over the centre stone's width).
- Count claws on the head itself before you name the archetype: a solitaire suggests four and a three-stone suggests three, and both can be wrong. Count stones only up to about ten; for more, leave countVisible null.
- Mark each part visible "yes", "partly" or "no". What the photo hides (the back, the gallery, the inside of the band, depth) is "no", and goes in notVisible; never guess it as seen.
- Put every field you are not sure of in "unsure", with the question or the second photo that would settle it.
- "view" is the capture angle closest to the photo's camera: top (looking down on the stone), front (face on, slightly above), side (along the finger), threeQuarter (front and above), back, under, onBody (worn), other.
- plainBackground is true only when the piece stands on an even, plain background with nothing else in the frame.`

/** The request for one read. Images first, as Claude reads best, then the instruction. */
export function buildReadRequest(r: {
  model: AssistantModelId
  images: readonly ShapeImage[]
  kindHint?: PieceKind
  note?: string
}): BetaMessageStreamParams {
  const info = MODELS[r.model]
  // The SDK's helper turns the zod schema into the JSON Schema subset structured outputs takes.
  const { type, schema } = betaZodOutputFormat(PhotoReadSchema)
  const content: BetaContentBlockParam[] = []
  r.images.forEach((img, i) => {
    content.push({ type: 'text', text: `Photo ${i + 1}: ${img.label}` })
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data },
    })
  })
  const asks = [
    r.images.length > 1
      ? `These ${r.images.length} photos show one piece. Read it.`
      : 'Read the piece in this photo.',
    r.kindHint ? `The designer says it is a ${r.kindHint}.` : '',
    r.note ? `The designer adds: ${r.note}` : '',
  ].filter(Boolean)
  content.push({ type: 'text', text: asks.join(' ') })
  return {
    model: r.model,
    max_tokens: READ_MAX_TOKENS,
    system: [{ type: 'text', text: READ_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT, format: { type, schema } },
    ...(info.fallbacks === 'default'
      ? { fallbacks: 'default' as const, betas: ['server-side-fallback-2026-07-01'] }
      : {}),
  }
}

/** Why a read could not be used; `code` is one of the run error codes. */
export class ReadError extends Error {
  constructor(
    readonly code: 'refusal' | 'internal',
    message: string,
  ) {
    super(message)
    this.name = 'ReadError'
  }
}

/** The read in a finished response, validated; throws a {@link ReadError} otherwise. */
export function parseReadMessage(message: BetaMessage): PhotoRead {
  if (message.stop_reason === 'refusal')
    throw new ReadError(
      'refusal',
      `Claude declined to read this photo${message.stop_details?.category ? ` (${message.stop_details.category})` : ''}.`,
    )
  if (message.stop_reason === 'max_tokens')
    throw new ReadError('internal', 'The photo read was cut off before it finished. Try again.')
  const text = effectiveContent(message.content)
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('')
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new ReadError('internal', 'The photo read did not come back as JSON. Try again.')
  }
  const parsed = PhotoReadSchema.safeParse(json)
  if (!parsed.success)
    throw new ReadError(
      'internal',
      `The photo read did not match its format: ${z.prettifyError(parsed.error)}`,
    )
  return parsed.data
}

// ── From a read to a spec draft ─────────────────────────────────────────────────────────────

/** The scale assumed when the designer gives none (the photo skill's defaults). */
export const ASSUMED_SCALE = { ringSizeUs: 6, centreCarat: 1, pendantHeightMm: 22 } as const

const METAL_FOR: Record<PhotoRead['metal']['colour'], MetalId> = {
  yellow: 'au18k-yellow',
  white: 'au18k-white',
  rose: 'au18k-rose',
  twoTone: 'au18k-yellow',
  black: 'au18k-white',
  other: 'au18k-yellow',
}

const round = (x: number, d = 2) => Number(x.toFixed(d))
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/**
 * A spec from a read, with what it assumed. The centre stone's size is assumed (1 ct) unless
 * the designer gave one; every other width follows from it through the read's ratios, which is
 * why the proportions survive a wrong scale: a different scale moves all of them together.
 */
export function specFromRead(
  read: PhotoRead,
  o: { centreCarat?: number; ringSizeUs?: number; title?: string } = {},
): { spec: PieceSpecInput; assumed: string[] } {
  const assumed: string[] = []
  const kind = read.kind.value
  const centreGroup = read.stones.find((s) => s.role === 'center')
  const carat = o.centreCarat ?? ASSUMED_SCALE.centreCarat
  if (centreGroup && o.centreCarat === undefined)
    assumed.push(`centre stone ${carat} ct (scale is not in a photo)`)
  const centreWidth = centreGroup ? gemDimsFromCarat(centreGroup.cut, carat).width : null

  const stones: StoneSpec[] = read.stones.map((s) => {
    const stone: StoneSpec = { role: s.role, cut: s.cut, stone: 'diamond', setting: s.setting }
    if (s.role === 'center') stone.carat = carat
    else if (centreWidth && s.widthToCentre && s.widthToCentre > 0)
      stone.widthMm = round(clamp(centreWidth * s.widthToCentre, 0.8, 40))
    if (s.prongs !== null && s.setting === 'prong') stone.prongs = clamp(s.prongs, 3, 8)
    else if (s.setting === 'prong' && s.role === 'center') assumed.push('claw count (not visible)')
    // A count is only kept when it was countable; rows and fields are counted by the kernel.
    if (s.countVisible !== null && s.countVisible > 1 && s.countVisible <= 10)
      stone.count = s.countVisible
    if (s.visible === 'no') assumed.push(`${s.role} stones (hidden in the photo)`)
    return stone
  })

  const spec: PieceSpecInput = {
    kind,
    archetype: read.archetype.value,
    title: o.title ?? `From a photo: ${read.archetype.value} ${kind}`.slice(0, 120),
    summary: read.observations.slice(0, 1200),
    metal: { alloy: METAL_FOR[read.metal.colour], finish: read.metal.finish, plating: 'none' },
    stones,
    ...(read.notVisible.length > 0
      ? { notes: `Not visible in the photo: ${read.notVisible.join('; ')}.`.slice(0, 2000) }
      : {}),
    openQuestions: read.unsure.slice(0, 8).map((u) => `${u.field}: ${u.why}`.slice(0, 200)),
  }
  if (read.metal.visible !== 'yes') assumed.push('metal colour')

  if (kind === 'ring') {
    const size = o.ringSizeUs ?? ASSUMED_SCALE.ringSizeUs
    if (o.ringSizeUs === undefined) assumed.push(`ring size US ${size}`)
    const band = read.band
    const ring: NonNullable<PieceSpecInput['ring']> = { size: { system: 'us', value: size } }
    if (band?.profile) ring.profile = band.profile
    if (band?.shoulder) ring.shoulder = band.shoulder
    // Band width from the stone: the one proportion a top or front view shows well.
    if (band?.widthToStone && centreWidth)
      ring.bandWidthMm = round(clamp(centreWidth * band.widthToStone, 1, 14))
    if (!band || band.visible === 'no') assumed.push('band profile and width (not visible)')
    spec.ring = ring
  } else if (read.body) {
    const height = ASSUMED_SCALE.pendantHeightMm
    assumed.push(`overall height ${height} mm`)
    spec.body = {
      heightMm: height,
      shape: read.body.shape.slice(0, 40),
      ...(read.body.thicknessToHeight
        ? { thicknessMm: round(clamp(height * read.body.thicknessToHeight, 0.6, 30)) }
        : {}),
    }
  }
  if (read.body?.sculpted) assumed.push('the sculpted body is approximated by the recipe')
  return { spec, assumed }
}
