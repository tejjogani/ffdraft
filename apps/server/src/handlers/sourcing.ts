import { randomUUID } from 'node:crypto'
import { DiaexStoneId, type SourcedDiamond, SourcedDiamondSchema, stoneDims } from '@pave/schema'
import { z } from 'zod'
import type { Ctx } from '../context'
import { AppError, badRequest, conflict } from '../errors'
import { getPiece } from '../lookups'
import type { HandlerGroup } from './types'

const DIAEX_BROWSE = 'https://console.thediaex.com/browse'
const SIZE_WINDOW_MM = 0.3
const LIMIT = 24
const STOCKED_DIAMONDS = ['diamond', 'diamond-lab', 'diamond-yellow', 'diamond-pink']
const CERTIFYING_LABS = ['GIA', 'IGI', 'GCAL', 'HRD', 'SGL']
const HUES = [
  'Yellow',
  'Pink',
  'Blue',
  'Green',
  'Orange',
  'Brown',
  'Purple',
  'Red',
  'Gray',
  'Violet',
]
const roundMm = (n: number) => Math.round(n * 100) / 100

const whiteGrade = /^[D-Z]$/
const names = (values: string[] | undefined) => [
  ...new Set(values?.map((v) => v.trim().toUpperCase()).filter(Boolean)),
]
const diaexHue = (v: string) => HUES.find((h) => h.toUpperCase() === v.replace(/^GREY$/, 'GRAY'))

function colorFilters(
  input: string | undefined,
  saved: string[] | undefined,
  defaultHue: string | undefined,
) {
  const values = names(input ? [input] : saved)
  const colors = values.filter((v) => whiteGrade.test(v))
  const fancyHues = values.flatMap((v) => {
    const hue = diaexHue(v)
    return hue ? [hue] : []
  })
  if (input && !colors.length && !fancyHues.length)
    throw badRequest('Enter a diamond colour grade from D to Z or a fancy hue such as Yellow.')
  if (!input && !colors.length && !fancyHues.length && defaultHue) fancyHues.push(defaultHue)
  return {
    ...(colors.length ? { colors } : {}),
    ...(fancyHues.length ? { fancy_hues: fancyHues } : {}),
  }
}

async function targetStone(ctx: Ctx, pieceId: string, nodeId: string, color?: string) {
  const { design } = await getPiece(ctx, pieceId)
  const node = design.nodes[nodeId]
  if (node?.kind !== 'gem') throw badRequest('Choose a single gemstone to search Diaex.')
  if (!STOCKED_DIAMONDS.includes(node.stone) || node.cut === 'cabochon')
    throw badRequest('Diaex does not list diamonds for this stone material or cut.')

  const defaultHue =
    node.stone === 'diamond-yellow' ? 'Yellow' : node.stone === 'diamond-pink' ? 'Pink' : undefined
  const origin = node.stone === 'diamond-lab' ? 'lab' : (node.quality?.origin ?? 'any')
  const { length, width } = stoneDims(node)
  const clarities = names(node.quality?.clarities)
  return {
    shape: node.cut,
    origin,
    seat: {
      length_mm: roundMm(Math.max(length, width)),
      width_mm: roundMm(Math.min(length, width)),
      tol_minus_mm: SIZE_WINDOW_MM,
      tol_plus_mm: SIZE_WINDOW_MM,
    },
    ...colorFilters(color, node.quality?.colors, defaultHue),
    ...(clarities.length ? { clarities } : {}),
    ...(node.quality?.certified ? { certificate: { required: true } } : {}),
  }
}

type Target = Awaited<ReturnType<typeof targetStone>>

function searchLink(target: Target, browse = DIAEX_BROWSE): string {
  const { length_mm, width_mm, tol_minus_mm, tol_plus_mm } = target.seat
  const stoneTypes = { natural: ['Natural'], lab: ['CVD', 'HPHT'], any: undefined }
  const filters = {
    shapes: [target.shape],
    stone_types: stoneTypes[target.origin],
    colors: target.colors,
    fancy_hues: target.fancy_hues,
    clarities: target.clarities,
    // Browse exposes labs. These are the current Diaex grades that issue certificates.
    labs: target.certificate ? CERTIFYING_LABS : undefined,
    min_length_mm: roundMm(length_mm - tol_minus_mm),
    max_length_mm: roundMm(length_mm + tol_plus_mm),
    min_width_mm: roundMm(width_mm - tol_minus_mm),
    max_width_mm: roundMm(width_mm + tol_plus_mm),
    availability: ['available'],
  }
  return `${browse}?f=${encodeURIComponent(JSON.stringify(filters))}`
}

function browseUrl(address: string): URL | undefined {
  const url = URL.parse(address)
  if (
    url?.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    !url.port &&
    (url.hostname === 'thediaex.com' || url.hostname.endsWith('.thediaex.com')) &&
    url.pathname === '/browse'
  )
    return url
  return undefined
}

// Signed-out is the only scope Pavé requests here. Treat a reply from a linked
// or shared cache as unusable, even if the stone otherwise looks public.
const SignedOutAccess = z.object({
  level: z.literal('signed_out'),
  prices: z.literal(false),
  markup: z.literal(false),
  prices_hidden_reason: z.literal('signed_out'),
})

const StoneDetailReply = z.object({ stone: z.unknown(), access: SignedOutAccess })
const SearchReply = z.object({
  ref: z.string(),
  candidates: z.array(z.unknown()).max(LIMIT),
  search_url: z.string(),
  access: SignedOutAccess,
})
const SearchCandidate = z.object({
  stone: z.unknown(),
  fit: z.object({ in_window: z.literal(true) }),
})
const PartnerError = z.object({ error: z.object({ code: z.string() }) })

const PartnerStone = z.object({
  id: DiaexStoneId,
  url: z.string(),
  availability: z.literal('available'),
  shape_group: z.string(),
  measurements: z.object({ length_mm: z.number(), width_mm: z.number(), height_mm: z.number() }),
  origin: z.string().nullable(),
  carat: z.number(),
  color: z.string().nullable(),
  fancy_color: z.string().nullable(),
  fancy_hue: z.string().nullable(),
  clarity: z.string().nullable(),
  certificate: z.object({ report_no: z.string().nullable() }),
})

function usableDiamond(data: unknown, target: Target, sku?: string): SourcedDiamond | null {
  const parsed = PartnerStone.safeParse(data)
  if (!parsed.success) return null
  const stone = parsed.data
  const origin = stone.origin === 'natural' || stone.origin === 'lab' ? stone.origin : 'any'
  const { length_mm: length, width_mm: width, height_mm: depth } = stone.measurements
  const url = browseUrl(stone.url)
  if (
    (sku !== undefined && stone.id !== sku) ||
    stone.shape_group !== target.shape ||
    (target.origin !== 'any' && origin !== target.origin) ||
    length < width ||
    url?.searchParams.get('stone') !== stone.id
  )
    return null

  const candidate = SourcedDiamondSchema.safeParse({
    sku: stone.id,
    url: `${url.origin}/browse?stone=${encodeURIComponent(stone.id)}`,
    measured: { length, width, depth },
    color: stone.fancy_color || stone.color,
    clarity: stone.clarity,
    origin,
    carat: stone.carat,
    ...(stone.fancy_hue ? { fancyHue: stone.fancy_hue } : {}),
    ...(stone.certificate.report_no ? { certificate: stone.certificate.report_no } : {}),
  })
  return candidate.success ? candidate.data : null
}

function matchesSearch(stone: SourcedDiamond, target: Target): boolean {
  const { length_mm, width_mm, tol_minus_mm, tol_plus_mm } = target.seat
  const within = (v: number, size: number) =>
    v >= roundMm(size - tol_minus_mm) && v <= roundMm(size + tol_plus_mm)
  const matchesColor =
    (!target.colors && !target.fancy_hues) ||
    (stone.color !== null && target.colors?.includes(stone.color)) ||
    (stone.fancyHue !== undefined && target.fancy_hues?.includes(stone.fancyHue))
  return (
    within(stone.measured.length, length_mm) &&
    within(stone.measured.width, width_mm) &&
    Boolean(matchesColor) &&
    (!target.clarities || (stone.clarity !== null && target.clarities.includes(stone.clarity))) &&
    (!target.certificate || stone.certificate !== undefined)
  )
}

function unavailable(searchUrl: string): AppError {
  return new AppError(
    'provider_unavailable',
    'Diaex inventory is unavailable in Pavé right now. Open Diaex to browse.',
    { searchUrl },
  )
}

async function requestInventory(ctx: Ctx, path: string, searchUrl: string, body?: unknown) {
  if (!ctx.diaexPartnerApiUrl)
    throw new AppError(
      'not_configured',
      'Diaex inventory is not connected. Open Diaex to browse.',
      {
        searchUrl,
      },
    )
  const timeout = AbortSignal.timeout(8_000)
  try {
    const res = await fetch(`${ctx.diaexPartnerApiUrl.replace(/\/$/, '')}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache, no-store',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout,
      redirect: 'error',
    })
    const data: unknown = await res.json()
    return { status: res.status, ok: res.ok, data }
  } catch {
    throw unavailable(searchUrl)
  }
}

async function exactStone(
  ctx: Ctx,
  target: Target,
  sku: string,
  searchUrl: string,
): Promise<SourcedDiamond> {
  // URL parsers collapse dot-only path segments even if the dots are encoded.
  if (sku === '.' || sku === '..') throw badRequest('Enter a Diaex public stone ID.')
  const id = encodeURIComponent(sku).replace(/\./g, '%2E')
  const { status, ok, data } = await requestInventory(ctx, `/stones/${id}`, searchUrl)
  if (!ok) {
    const error = PartnerError.safeParse(data)
    if (status === 404 && error.data?.error.code === 'stone_unavailable')
      throw new AppError('not_found', 'That stone is no longer listed on Diaex.', { searchUrl })
    throw unavailable(searchUrl)
  }
  const reply = StoneDetailReply.safeParse(data)
  if (!reply.success) throw unavailable(searchUrl)
  const diamond = usableDiamond(reply.data.stone, target, sku)
  if (!diamond)
    throw conflict(
      'Diaex did not confirm an available stone with this ID and usable dimensions for this design.',
      {
        searchUrl,
      },
    )
  return diamond
}

export const sourcing: HandlerGroup<'sourcing'> = {
  'sourcing.search': async (ctx, { pieceId, nodeId, color, sku }) => {
    const target = await targetStone(ctx, pieceId, nodeId, sku ? undefined : color)
    const searchUrl = searchLink(target)
    if (sku) return { candidates: [await exactStone(ctx, target, sku, searchUrl)], searchUrl }

    const ref = randomUUID()
    const { ok, data } = await requestInventory(ctx, '/stones/search', searchUrl, {
      requirement: { ref, kind: 'single', quantity: 1, gem: 'diamond', ...target },
      sort: 'fit',
      limit: LIMIT,
    })
    if (!ok) throw unavailable(searchUrl)
    const reply = SearchReply.safeParse(data)
    if (!reply.success || reply.data.ref !== ref) throw unavailable(searchUrl)
    const browse = browseUrl(reply.data.search_url)
    if (!browse) throw unavailable(searchUrl)

    const candidates = new Map<string, SourcedDiamond>()
    for (const row of reply.data.candidates) {
      const match = SearchCandidate.safeParse(row)
      const stone = match.success ? usableDiamond(match.data.stone, target) : null
      if (stone && matchesSearch(stone, target) && !candidates.has(stone.sku))
        candidates.set(stone.sku, stone)
    }
    return {
      candidates: [...candidates.values()],
      searchUrl: searchLink(target, `${browse.origin}/browse`),
    }
  },
  'sourcing.stone': async (ctx, { pieceId, nodeId, sku }) => {
    const target = await targetStone(ctx, pieceId, nodeId)
    return exactStone(ctx, target, sku, searchLink(target))
  },
}
