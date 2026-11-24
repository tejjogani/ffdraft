/**
 * Bill of materials and stone list (research Decisions: `bom.csv`, `stones.csv`). Metal weights
 * and stone lots come from @pave/sourcing's requirements via the package context.
 */
import {
  FINISHES,
  GEM_CUTS,
  GEM_MATERIALS,
  METALS,
  metalMassG,
  PLATINGS,
  type PlatingId,
} from '@pave/schema'
import type { PackageContext } from './context'
import { type Cell, round, toCsv } from './csv'

export interface BomLine {
  line: number
  type: 'metal' | 'metal-order' | 'stone' | 'finding' | 'finish' | 'plating'
  item: string
  description: string
  material: string
  fineness: string
  hallmark: string
  qtyPerPiece: number
  unit: string
  volumeMm3?: number
  netWeightG?: number
  castingAllowancePct?: number
  orderWeightG?: number
  finish?: string
  plating?: string
  notes?: string
}

/** Typical plating thickness when the designer has not specified one (research §1, Plating). */
export const PLATING_DEFAULT: Record<PlatingId, string> = {
  none: '',
  rhodium: '0.1–0.2 µm',
  'black-rhodium': '0.1–0.2 µm',
  'yellow-vermeil': '≥ 2.5 µm gold over sterling',
  'rose-vermeil': '≥ 2.5 µm gold over sterling',
}

export function platingSpec(ctx: PackageContext, plating: PlatingId): string {
  const microns = ctx.input.options.plating?.microns
  return microns !== undefined ? `${microns} µm` : PLATING_DEFAULT[plating]
}

export function billOfMaterials(ctx: PackageContext): BomLine[] {
  const lines: Omit<BomLine, 'line'>[] = []
  const { evaluation } = ctx.input
  const allowance = ctx.profile.castingAllowancePct

  for (const g of ctx.groups) {
    // A chain threaded on after casting is listed once, as a finding with its weight, below.
    if (ctx.boughtChains.has(g.key)) continue
    const part = g.parts[0]!
    const metal = METALS[part.material]
    const unitVolume = g.volumeMm3 / g.count
    const net = metalMassG(part.material, unitVolume)
    lines.push({
      type: 'metal',
      item: g.name,
      description: `Cast part, ${part.exact ? 'exact solid' : 'mesh'} (node ${g.key})${g.identical ? `; ${g.count} identical bodies` : g.parts.length > 1 ? `; ${g.parts.length} bodies` : ''}`,
      material: metal.label,
      fineness: String(metal.fineness),
      hallmark: metal.hallmark,
      qtyPerPiece: g.count,
      unit: 'pc',
      volumeMm3: round(unitVolume, 2),
      netWeightG: round(net, 3),
      castingAllowancePct: allowance,
      orderWeightG: round(net * (1 + allowance / 100), 3),
      finish: FINISHES[part.finish].label,
      plating: PLATINGS[part.plating].label,
    })
  }
  for (const m of ctx.castMetals) {
    const metal = METALS[m.metal]
    lines.push({
      type: 'metal-order',
      item: `${metal.label} casting grain`,
      description: `Order for ${ctx.quantity} pc (net ${round(m.netGrams * ctx.quantity, 2)} g)`,
      material: metal.label,
      fineness: String(metal.fineness),
      hallmark: metal.hallmark,
      qtyPerPiece: round(m.orderGrams, 3),
      unit: 'g',
      netWeightG: round(m.netGrams, 3),
      castingAllowancePct: m.castingAllowancePct,
      orderWeightG: round(m.orderGrams * ctx.quantity, 2),
      notes: `Fine metal content ${round(m.fineGrams * ctx.quantity, 2)} g`,
    })
  }
  for (const info of ctx.lots) {
    const { lot, requirement: r } = info
    const extra = r.overagePct
      ? `; order +${r.overagePct}% spares (${Math.ceil(lot.count * (1 + r.overagePct / 100))} pcs)`
      : ''
    lines.push({
      type: 'stone',
      item: `${info.key} ${GEM_MATERIALS[lot.stone].label}`,
      description: `${GEM_CUTS[lot.cut].label} ${lot.cut === 'round' ? `${lot.width.toFixed(2)} mm` : `${lot.length.toFixed(2)} × ${lot.width.toFixed(2)} mm`}, ${lot.caratEach.toFixed(3)} ct each`,
      material: GEM_MATERIALS[lot.stone].label,
      fineness: '',
      hallmark: '',
      qtyPerPiece: lot.count,
      unit: 'pcs',
      notes: `${lot.setting} setting; ${info.origin}; supplied by ${info.suppliedBy}${extra}`,
    })
  }
  for (const f of ctx.facts.findings) {
    lines.push({
      type: 'finding',
      item: f.name ?? f.type,
      description: `${f.type}, ${f.length} mm, ${f.wire} mm wire`,
      material: METALS[f.material].label,
      fineness: String(METALS[f.material].fineness),
      hallmark: METALS[f.material].hallmark,
      qtyPerPiece: 1,
      unit: 'pc',
      finish: FINISHES[f.finish].label,
      plating: PLATINGS[f.plating].label,
    })
  }
  for (const c of ctx.facts.chains) {
    // A chain that is the whole piece is the cast part above, not a finding.
    if (!ctx.boughtChains.has(c.id)) continue
    const group = ctx.groups.find((g) => g.key === c.id)
    const volume = group?.volumeMm3
    const net = volume === undefined ? undefined : metalMassG(c.material, volume)
    lines.push({
      type: 'finding',
      item: c.name ?? 'Chain',
      description: `${c.style} chain, ${c.length} mm (${(c.length / 25.4).toFixed(1)} in), ${c.linkWidth} mm links, ${c.wire} mm wire`,
      material: METALS[c.material].label,
      fineness: String(METALS[c.material].fineness),
      hallmark: METALS[c.material].hallmark,
      qtyPerPiece: 1,
      unit: 'pc',
      ...(volume === undefined ? {} : { volumeMm3: round(volume, 2) }),
      ...(net === undefined ? {} : { netWeightG: round(net, 3) }),
      finish: FINISHES[c.finish].label,
      plating: PLATINGS[c.plating].label,
      notes:
        'Bought-in or made to spec, threaded on after casting; not in the casting-grain order (research §1, Findings)',
    })
  }
  // A fused casting can carry regions finished or plated differently (a rhodium-plated head on
  // a yellow band): each finish and plating names exactly the surfaces it applies to.
  const regions = evaluation.parts.flatMap((p) => p.regions ?? [])
  const finishes = [...new Set([...evaluation.parts, ...regions].map((p) => p.finish))]
  for (const f of finishes) {
    const parts = ctx.groups.filter((g) => g.parts[0]!.finish === f).map((g) => g.name)
    const areas = regions.filter((r) => r.finish === f).map((r) => r.name)
    const others = regions.filter((r) => r.finish !== f).map((r) => r.name)
    lines.push({
      type: 'finish',
      item: FINISHES[f].label,
      description: [
        parts.length
          ? `All surfaces of ${parts.join(', ')}${others.length ? ` except ${others.join(', ')}` : ''}`
          : '',
        areas.length ? `${parts.length ? 'and ' : ''}${areas.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(' '),
      material: '',
      fineness: '',
      hallmark: '',
      qtyPerPiece: 1,
      unit: 'op',
    })
  }
  const platings = [...new Set([...evaluation.parts, ...regions].map((p) => p.plating))].filter(
    (p) => p !== 'none',
  )
  for (const p of platings) {
    const where = [
      ...ctx.groups.filter((g) => g.parts[0]!.plating === p).map((g) => g.name),
      ...regions.filter((r) => r.plating === p).map((r) => r.name),
    ]
    lines.push({
      type: 'plating',
      item: PLATINGS[p].label,
      description: `${platingSpec(ctx, p)}${ctx.input.options.plating?.layers ? `, ${ctx.input.options.plating.layers}` : ''}${where.length ? `; ${where.join(', ')}` : ''}`,
      material: '',
      fineness: '',
      hallmark: '',
      qtyPerPiece: 1,
      unit: 'op',
      notes: regions.some((r) => r.plating === p)
        ? 'Selective plating: mask the rest. Verify thickness by XRF'
        : 'Verify thickness by XRF',
    })
  }
  return lines.map((l, i) => ({ line: i + 1, ...l }))
}

const BOM_HEADER = [
  'line',
  'type',
  'item',
  'description',
  'material',
  'fineness',
  'hallmark',
  'qty_per_piece',
  'unit',
  'volume_mm3',
  'net_weight_g',
  'casting_allowance_pct',
  'order_weight_g',
  'finish',
  'plating',
  'notes',
] as const

export function bomCsv(lines: BomLine[]): string {
  return toCsv(
    BOM_HEADER,
    lines.map((l): Cell[] => [
      l.line,
      l.type,
      l.item,
      l.description,
      l.material,
      l.fineness,
      l.hallmark,
      l.qtyPerPiece,
      l.unit,
      l.volumeMm3,
      l.netWeightG,
      l.castingAllowancePct,
      l.orderWeightG,
      l.finish,
      l.plating,
      l.notes,
    ]),
  )
}

export interface StoneRow {
  lot: string
  role: string
  type: string
  origin: string
  shape: string
  cut: string
  lengthMm: number
  widthMm: number
  depthMm: number
  ctEach: number
  ctTotal: number
  count: number
  setting: string
  color: string
  clarity: string
  certified: boolean
  suppliedBy: string
  sourcingProvider: string
  sourcingSku: string
  sourcingUrl: string
  certificate: string
  tolMinusMm: number
  tolPlusMm: number
  nodeIds: string
}

export function stoneRows(ctx: PackageContext): StoneRow[] {
  return ctx.lots.map(({ key, lot, requirement: r, depth, origin, suppliedBy, sourcing }) => ({
    lot: key,
    role: lot.role,
    type: GEM_MATERIALS[lot.stone].label,
    origin,
    shape: GEM_CUTS[lot.cut].outline,
    cut: GEM_CUTS[lot.cut].label,
    lengthMm: round(lot.length, 2),
    widthMm: round(lot.width, 2),
    depthMm: round(depth, 2),
    ctEach: round(lot.caratEach, 4),
    ctTotal: round(lot.caratTotal, 3),
    count: lot.count,
    setting: lot.setting,
    color: r.quality.colors?.join('/') ?? '',
    clarity: r.quality.clarities?.join('/') ?? '',
    certified: r.quality.certified,
    suppliedBy,
    sourcingProvider: sourcing?.provider ?? '',
    sourcingSku: sourcing?.sku ?? '',
    sourcingUrl: sourcing?.url ?? '',
    certificate: sourcing?.certificate ?? '',
    tolMinusMm: r.seat.tolMinus,
    tolPlusMm: r.seat.tolPlus,
    nodeIds: lot.nodeIds.join(' '),
  }))
}

const STONE_HEADER = [
  'lot',
  'role',
  'type',
  'origin',
  'shape',
  'cut',
  'length_mm',
  'width_mm',
  'depth_mm',
  'ct_each',
  'ct_total',
  'count',
  'setting',
  'color',
  'clarity',
  'certified',
  'supplied_by',
  'sourcing_provider',
  'sourcing_sku',
  'sourcing_url',
  'certificate',
  'seat_tol_minus_mm',
  'seat_tol_plus_mm',
  'node_ids',
] as const

export function stonesCsv(rows: StoneRow[]): string {
  return toCsv(
    STONE_HEADER,
    rows.map((s): Cell[] => [
      s.lot,
      s.role,
      s.type,
      s.origin,
      s.shape,
      s.cut,
      s.lengthMm,
      s.widthMm,
      s.depthMm,
      s.ctEach,
      s.ctTotal,
      s.count,
      s.setting,
      s.color,
      s.clarity,
      s.certified,
      s.suppliedBy,
      s.sourcingProvider,
      s.sourcingSku,
      s.sourcingUrl,
      s.certificate,
      s.tolMinusMm,
      s.tolPlusMm,
      s.nodeIds,
    ]),
  )
}
