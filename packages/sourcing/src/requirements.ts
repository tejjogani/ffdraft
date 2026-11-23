/**
 * From CAD to a shopping list: every stone lot in an evaluated design becomes a
 * {@link StoneRequirement} a supplier can be searched with. Pure and provider-neutral.
 */
import type { Report, StoneLot } from '@pave/kernel/types'
import {
  type Design,
  GEM_MATERIALS,
  type GemCutId,
  type GemMaterialId,
  type MetalId,
  METALS,
  type StoneQuality,
  metalMassG,
  snapToMelee,
} from '@pave/schema'

export interface StoneRequirement {
  /** Stable per stone group: the node ids that produced it plus its size. */
  ref: string
  nodeIds: string[]
  /** single = one certified stone; matchedSet = a few that must match; parcel = melee by weight. */
  kind: 'single' | 'matchedSet' | 'parcel'
  role: StoneLot['role']
  quantity: number
  material: GemMaterialId
  origin: 'natural' | 'lab' | 'any'
  cut: GemCutId
  /** The seat as drawn, and how far a real stone may deviate before the CAD must adapt. */
  seat: { length: number; width: number; tolMinus: number; tolPlus: number; adjustable: boolean }
  caratEach: number
  caratTotal: number
  quality: { colors?: string[]; clarities?: string[]; certified: boolean }
  setting: string
  /** Parcels are bought with spare stones for breakage and selection. */
  overagePct: number
}

export interface MetalRequirement {
  metal: MetalId
  netGrams: number
  /** Sprue, button and melt loss. */
  castingAllowancePct: number
  orderGrams: number
  fineGrams: number
}

/** Seat tolerance (mm) by how the stone is held — a prong forgives, pavé does not. */
const TOLERANCE: Record<string, { minus: number; plus: number; adjustable: boolean }> = {
  prong: { minus: 0.1, plus: 0.15, adjustable: true },
  basket: { minus: 0.1, plus: 0.15, adjustable: true },
  bezel: { minus: 0.05, plus: 0.05, adjustable: true },
  halfBezel: { minus: 0.05, plus: 0.05, adjustable: true },
  channel: { minus: 0.05, plus: 0.05, adjustable: false },
}
const TIGHT = { minus: 0.03, plus: 0.03, adjustable: false }

const DEFAULT_QUALITY: Record<StoneRequirement['kind'], { colors: string[]; clarities: string[] }> = {
  single: { colors: ['E', 'F', 'G'], clarities: ['VS1', 'VS2'] },
  matchedSet: { colors: ['F', 'G'], clarities: ['VS1', 'VS2'] },
  parcel: { colors: ['F', 'G'], clarities: ['VS'] },
}

const originOf = (material: GemMaterialId, quality?: StoneQuality): StoneRequirement['origin'] =>
  quality?.origin && quality.origin !== 'any' ? quality.origin : material === 'diamond-lab' ? 'lab' : 'any'

export function stoneRequirements(design: Design, report: Report): StoneRequirement[] {
  return report.lots.map((lot) => {
    const node = lot.nodeIds.map((id) => design.nodes[id]).find((n) => n && 'quality' in n)
    const quality = node && 'quality' in node ? node.quality : undefined
    const kind: StoneRequirement['kind'] =
      lot.role === 'melee' || lot.count > 8 ? 'parcel' : lot.count > 1 ? 'matchedSet' : 'single'
    const tol = TOLERANCE[lot.setting] ?? TIGHT
    const isDiamond = lot.stone.startsWith('diamond')
    const fallback = isDiamond ? DEFAULT_QUALITY[kind] : {}
    const width = kind === 'parcel' && lot.cut === 'round' ? snapToMelee(lot.width) : lot.width
    return {
      ref: `${lot.nodeIds.join('+')}@${lot.cut}-${lot.width.toFixed(2)}`,
      nodeIds: lot.nodeIds,
      kind,
      role: lot.role,
      quantity: lot.count,
      material: lot.stone,
      origin: originOf(lot.stone, quality),
      cut: lot.cut,
      seat: {
        length: lot.cut === 'round' ? width : lot.length,
        width,
        tolMinus: tol.minus,
        tolPlus: tol.plus,
        adjustable: tol.adjustable,
      },
      caratEach: lot.caratEach,
      caratTotal: lot.caratTotal,
      quality: {
        ...fallback,
        ...(quality?.colors ? { colors: quality.colors } : {}),
        ...(quality?.clarities ? { clarities: quality.clarities } : {}),
        certified: quality?.certified ?? (kind === 'single' && lot.caratEach >= 0.3),
      },
      setting: lot.setting,
      overagePct: kind === 'parcel' ? 5 : 0,
    }
  })
}

export function metalRequirements(report: Report, castingAllowancePct = 12): MetalRequirement[] {
  return report.metals.map(({ material, volumeMm3 }) => {
    const netGrams = metalMassG(material, volumeMm3)
    const orderGrams = netGrams * (1 + castingAllowancePct / 100)
    return {
      metal: material,
      netGrams,
      castingAllowancePct,
      orderGrams,
      fineGrams: (orderGrams * METALS[material].fineness) / 1000,
    }
  })
}

/** One line a person can read: "2 × Oval diamond 7.0 × 5.0 mm (≈0.75 ct each)". */
export function describeRequirement(r: StoneRequirement): string {
  const size =
    r.seat.length === r.seat.width
      ? `${r.seat.width.toFixed(2)} mm`
      : `${r.seat.length.toFixed(2)} × ${r.seat.width.toFixed(2)} mm`
  const ct = r.kind === 'parcel' ? `${r.caratTotal.toFixed(2)} ct total` : `≈${r.caratEach.toFixed(2)} ct each`
  return `${r.quantity} × ${GEM_MATERIALS[r.material].label} ${r.cut} ${size} (${ct})`
}
