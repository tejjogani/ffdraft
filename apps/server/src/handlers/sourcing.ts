import { randomUUID } from 'node:crypto'
import { measureRhinoRoleBody } from '@pave/kernel/rhino-role-measurements'
import {
  DIAEX_DIAMOND_MATERIALS,
  type DiaexCutId,
  DiaexStoneId,
  type GemMaterialId,
  importedDiamondCut,
  importedDiamondSpecies,
  isRhinoRoleBody,
  type Node,
  type NodeOf,
  type SourcedDiamond,
  SourcedDiamondSchema,
  type SourcingCadTarget,
  SourcingCadTargetSchema,
  type StoneQuality,
  stoneDims,
} from '@pave/schema'
import { z } from 'zod'
import { readAsset } from '../assets/assets'
import type { Ctx } from '../context'
import { AppError, badRequest, conflict } from '../errors'
import { getPiece } from '../lookups'
import type { HandlerGroup } from './types'

const DIAEX_BROWSE = 'https://thediaex.com/browse'
const SIZE_WINDOW_MM = 0.3
const LIMIT = 24
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

function searchTarget(
  shape: DiaexCutId,
  stone: GemMaterialId,
  length: number,
  width: number,
  color?: string,
  quality?: StoneQuality,
) {
  const defaultHue =
    stone === 'diamond-yellow' ? 'Yellow' : stone === 'diamond-pink' ? 'Pink' : undefined
  const origin = stone === 'diamond-lab' ? 'lab' : (quality?.origin ?? 'any')
  const clarities = names(quality?.clarities)
  return {
    shape,
    origin,
    seat: {
      length_mm: roundMm(Math.max(length, width)),
      width_mm: roundMm(Math.min(length, width)),
      tol_minus_mm: SIZE_WINDOW_MM,
      tol_plus_mm: SIZE_WINDOW_MM,
    },
    ...colorFilters(color, quality?.colors, defaultHue),
    ...(clarities.length ? { clarities } : {}),
    ...(quality?.certified ? { certificate: { required: true } } : {}),
  }
}

type Target = ReturnType<typeof searchTarget>

function measuredGemTarget(node: Node | undefined, color?: string): Target {
  if (node?.kind !== 'gem') throw badRequest('Choose a single gemstone to search Diaex.')
  if (!DIAEX_DIAMOND_MATERIALS.includes(node.stone) || node.cut === 'cabochon')
    throw badRequest('Diaex does not list diamonds for this stone material or cut.')
  const { length, width } = stoneDims(node)
  return searchTarget(node.cut, node.stone, length, width, color, node.quality)
}

async function importedCadTarget(
  ctx: Ctx,
  node: NodeOf<'meshBody'> & { source: Extract<NodeOf<'meshBody'>['source'], { type: 'asset' }> },
  searchCut?: DiaexCutId,
): Promise<SourcingCadTarget> {
  const cut = searchCut ?? importedDiamondCut(node)
  if (!cut) throw badRequest('Choose the cut to search Diaex for this imported diamond.')
  const { assetId, nativeMeshAssetId } = node.source
  if (
    !node.keepSourcePlacement ||
    (nativeMeshAssetId !== undefined && nativeMeshAssetId !== assetId) ||
    node.mountCage ||
    node.mountFit ||
    node.flatBack ||
    node.hollow ||
    node.smooth ||
    node.detail !== 1
  )
    throw badRequest(
      'Diaex needs a retained Rhino stone mesh at its measured size. This part has been reshaped or replaced.',
    )

  const { asset, bytes } = await readAsset(ctx, assetId)
  ctx.signal?.throwIfAborted()
  if (asset.kind !== 'mesh' || asset.mime !== 'model/stl')
    throw badRequest('A retained Rhino stone mesh is required for Diaex search.')
  let measured: ReturnType<typeof measureRhinoRoleBody>
  try {
    measured = measureRhinoRoleBody(bytes, cut, { edits: node.meshEdits?.vertices })
  } catch {
    throw badRequest('The retained Rhino mesh could not be measured for Diaex search.')
  }
  if (measured) {
    // Unassigned sources cannot be consumed by groups, patterns or booleans in the evaluator.
    // Their own translation and rotation preserve dimensions in the automatic table frame.
    const scale = node.transform?.scale ?? 1
    const parsed = SourcingCadTargetSchema.safeParse({
      cut,
      length: roundMm(measured.length * scale),
      width: roundMm(measured.width * scale),
      depth: roundMm(measured.depth * scale),
    })
    if (parsed.success) return parsed.data
  }
  throw badRequest('The retained Rhino mesh does not have usable stone dimensions for Diaex.')
}

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

type BrowseDetails = { searchUrl: string; cadTarget?: SourcingCadTarget }

function unavailable(details: BrowseDetails): AppError {
  return new AppError(
    'provider_unavailable',
    'Diaex inventory is unavailable in Pavé right now. Open Diaex to browse.',
    details,
  )
}

async function requestInventory(ctx: Ctx, path: string, details: BrowseDetails, body?: unknown) {
  if (!ctx.diaexPartnerApiUrl)
    throw new AppError(
      'not_configured',
      'Diaex inventory is not connected. Open Diaex to browse.',
      details,
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
    throw unavailable(details)
  }
}

async function exactStone(
  ctx: Ctx,
  target: Target,
  sku: string,
  details: BrowseDetails,
): Promise<SourcedDiamond> {
  // URL parsers collapse dot-only path segments even if the dots are encoded.
  if (sku === '.' || sku === '..') throw badRequest('Enter a Diaex public stone ID.')
  const id = encodeURIComponent(sku).replace(/\./g, '%2E')
  const { status, ok, data } = await requestInventory(ctx, `/stones/${id}`, details)
  if (!ok) {
    const error = PartnerError.safeParse(data)
    if (status === 404 && error.data?.error.code === 'stone_unavailable')
      throw new AppError('not_found', 'That stone is no longer listed on Diaex.', details)
    throw unavailable(details)
  }
  const reply = StoneDetailReply.safeParse(data)
  if (!reply.success) throw unavailable(details)
  const diamond = usableDiamond(reply.data.stone, target, sku)
  if (!diamond)
    throw conflict(
      'Diaex did not confirm an available stone with this ID and usable dimensions for this design.',
      details,
    )
  return diamond
}

export const sourcing: HandlerGroup<'sourcing'> = {
  'sourcing.search': async (ctx, { pieceId, nodeId, color, sku, searchCut }) => {
    const { design } = await getPiece(ctx, pieceId)
    const node = design.nodes[nodeId]
    const requestedColor = sku ? undefined : color
    let target: Target
    let cadTarget: SourcingCadTarget | undefined
    if (node?.kind === 'gem') {
      if (searchCut) throw badRequest('The design already specifies the cut for this gemstone.')
      target = measuredGemTarget(node, requestedColor)
    } else {
      const species = importedDiamondSpecies(node)
      if (!species || !isRhinoRoleBody(node))
        throw badRequest('Choose a single gemstone or visible Rhino diamond to search Diaex.')
      cadTarget = await importedCadTarget(ctx, node, searchCut)
      target = searchTarget(
        cadTarget.cut,
        species,
        cadTarget.length,
        cadTarget.width,
        requestedColor,
      )
    }
    const details = { searchUrl: searchLink(target), ...(cadTarget && { cadTarget }) }
    if (sku) return { candidates: [await exactStone(ctx, target, sku, details)], ...details }

    const ref = randomUUID()
    const { ok, data } = await requestInventory(ctx, '/stones/search', details, {
      requirement: { ref, kind: 'single', quantity: 1, gem: 'diamond', ...target },
      sort: 'fit',
      limit: LIMIT,
    })
    if (!ok) throw unavailable(details)
    const reply = SearchReply.safeParse(data)
    if (!reply.success || reply.data.ref !== ref) throw unavailable(details)
    const browse = browseUrl(reply.data.search_url)
    if (!browse) throw unavailable(details)

    const candidates = new Map<string, SourcedDiamond>()
    for (const row of reply.data.candidates) {
      const match = SearchCandidate.safeParse(row)
      const stone = match.success ? usableDiamond(match.data.stone, target) : null
      if (stone && matchesSearch(stone, target) && !candidates.has(stone.sku))
        candidates.set(stone.sku, stone)
    }
    return {
      candidates: [...candidates.values()],
      ...details,
      searchUrl: searchLink(target, `${browse.origin}/browse`),
    }
  },
  'sourcing.stone': async (ctx, { pieceId, nodeId, sku }) => {
    const { design } = await getPiece(ctx, pieceId)
    const target = measuredGemTarget(design.nodes[nodeId])
    return exactStone(ctx, target, sku, { searchUrl: searchLink(target) })
  },
}
