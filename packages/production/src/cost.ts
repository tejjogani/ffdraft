/**
 * Cost estimate — the transparent formula of docs/research/02-production.md §4:
 *
 *   metal_cost  = metal_g × (1 + loss) × spot_per_g × fineness × (1 + alloy_premium)
 *   setting     = Σ qty × rate[setting_type]
 *   stones_cost = Σ qty × ct × price_per_ct          (0 if customer-supplied)
 *   labour      = cad_fee/qty + print_fee + casting_fee + finish_hours × hourly_rate
 *                 + plating_fee + assay_fee
 *   cost        = (metal_cost + stones_cost + setting + labour) × (1 + overhead)
 *   price       = cost × (1 + margin) × (1 + tax)
 *
 * Every rate is an input with its source. Nothing is fetched: unset rates fall back to defaults
 * flagged "placeholder — set your rates" (the research found no current trade rate cards).
 */
import {
  GEM_CUTS,
  GEM_MATERIALS,
  type GemMaterialId,
  METALS,
  type MetalFamily,
  type MetalId,
} from '@pave/schema'
import type { PackageContext } from './context'

export interface RateInput {
  currency?: string
  /** Pure-metal spot price per gram, by family. */
  spotPerGram?: Partial<Record<MetalFamily, number>>
  /** Alloy price per gram; replaces spot × fineness × premium for every alloy. */
  metalPricePerGramUsd?: number
  castingLossPct?: number
  alloyPremiumPct?: number
  cadFee?: number
  printFee?: number
  castingFee?: number
  finishHours?: number
  hourlyRate?: number
  platingFee?: number
  assayFee?: number
  /** One labour figure per piece; replaces the itemised labour lines. */
  laborUsd?: number
  settingPerStone?: Partial<Record<string, number>>
  /** One setting rate for every stone; replaces the per-type table. */
  settingPerStoneUsd?: number
  stonePricePerCt?: Partial<Record<GemMaterialId, number>>
  overheadPct?: number
  marginPct?: number
  taxPct?: number
  /** Where the metal price came from and when (shown with the estimate). */
  priceSource?: string
  priceTimestamp?: string
}

/** user: from options; default: placeholder; sourcing: an attached supplier price; computed: from the CAD. */
export type RateSource = 'user' | 'default' | 'sourcing' | 'computed'

export interface CostInput {
  name: string
  value: number
  unit: string
  source: RateSource
}

export interface CostLine {
  id: string
  group: 'metal' | 'stones' | 'setting' | 'labour' | 'overhead' | 'margin' | 'tax'
  label: string
  formula: string
  inputs: CostInput[]
  amount: number
  note?: string
}

export interface CostEstimate {
  currency: string
  quantity: number
  lines: CostLine[]
  perPiece: { materials: number; cost: number; price: number }
  order: { cost: number; price: number }
  placeholders: string[]
  priceSource: string | null
  priceTimestamp: string | null
  formula: string
}

export const PLACEHOLDER_NOTE = 'placeholder — set your rates'

/** Placeholder defaults. Spot prices are round figures, not market data. */
const DEFAULTS = {
  spotPerGram: {
    gold: 130,
    platinum: 50,
    palladium: 45,
    silver: 1.6,
    titanium: 0.1,
    base: 0.02,
  } as Record<MetalFamily, number>,
  castingLossPct: 5,
  alloyPremiumPct: 15,
  cadFee: 0,
  printFee: 31.5,
  castingFee: 25,
  finishHours: 1,
  hourlyRate: 60,
  platingFee: 15,
  assayFee: 5,
  settingPerStone: {
    prong: 20,
    basket: 20,
    bezel: 30,
    halfBezel: 25,
    flush: 12,
    channel: 12,
    pave: 6,
    sharedProng: 8,
    bar: 10,
  } as Record<string, number>,
  settingFallback: 20,
  stonePricePerCt: { diamond: 1500, 'diamond-lab': 150, moissanite: 60, cz: 1 } as Partial<
    Record<GemMaterialId, number>
  >,
  stoneFallbackPerCt: 200,
  overheadPct: 15,
  marginPct: 0,
  taxPct: 0,
}

const r2 = (v: number) => Math.round(v * 100) / 100

export function estimateCost(ctx: PackageContext): CostEstimate {
  const rates = ctx.input.options.rates ?? {}
  const currency = rates.currency ?? 'USD'
  const placeholders = new Set<string>()
  const rate = (
    name: string,
    user: number | undefined,
    fallback: number,
    unit: string,
  ): CostInput => {
    if (user !== undefined) return { name, value: user, unit, source: 'user' }
    placeholders.add(name)
    return { name, value: fallback, unit, source: 'default' }
  }
  const computed = (name: string, value: number, unit: string): CostInput => ({
    name,
    value,
    unit,
    source: 'computed',
  })
  const lines: CostLine[] = []
  const q = ctx.quantity

  // Metal, per alloy.
  const loss = rate('casting loss', rates.castingLossPct, DEFAULTS.castingLossPct, '%')
  for (const m of ctx.metals) {
    const metal = METALS[m.metal as MetalId]
    const grams = computed('net metal', round3(m.netGrams), 'g')
    if (rates.metalPricePerGramUsd !== undefined || metal.fineness === 0) {
      const price = rate(
        `${metal.label} per g`,
        rates.metalPricePerGramUsd,
        DEFAULTS.spotPerGram[metal.family],
        `${currency}/g`,
      )
      lines.push({
        id: `metal:${m.metal}`,
        group: 'metal',
        label: `${metal.label}`,
        formula: 'metal_g × (1 + loss) × price_per_g',
        inputs: [grams, loss, price],
        amount: r2(m.netGrams * (1 + loss.value / 100) * price.value),
      })
    } else {
      const spot = rate(
        `${metal.family} spot`,
        rates.spotPerGram?.[metal.family],
        DEFAULTS.spotPerGram[metal.family],
        `${currency}/g`,
      )
      const premium = rate('alloy premium', rates.alloyPremiumPct, DEFAULTS.alloyPremiumPct, '%')
      const fineness = computed('fineness', metal.fineness / 1000, '')
      lines.push({
        id: `metal:${m.metal}`,
        group: 'metal',
        label: `${metal.label}`,
        formula: 'metal_g × (1 + loss) × spot_per_g × fineness × (1 + alloy_premium)',
        inputs: [grams, loss, spot, fineness, premium],
        amount: r2(
          m.netGrams *
            (1 + loss.value / 100) *
            spot.value *
            fineness.value *
            (1 + premium.value / 100),
        ),
      })
    }
  }

  // Stones, per lot.
  for (const info of ctx.lots) {
    const { lot, sourcing } = info
    const label = `${info.key} · ${lot.count} × ${GEM_MATERIALS[lot.stone].label}, ${GEM_CUTS[lot.cut].label.toLowerCase()} ${lot.width.toFixed(2)} mm`
    if (sourcing?.priceUsd !== undefined) {
      // A gem node's sourcing prices one stone; a pavé or row node's prices the parcel.
      const perStone = lot.count === 1 || lot.nodeIds.length === lot.count
      const price: CostInput = {
        name: perStone ? 'price per stone' : 'parcel price',
        value: sourcing.priceUsd,
        unit: currency,
        source: 'sourcing',
      }
      lines.push({
        id: `stones:${info.key}`,
        group: 'stones',
        label,
        formula: perStone ? 'qty × price_per_stone' : 'parcel_price',
        inputs: [computed('qty', lot.count, 'pcs'), price],
        amount: r2(perStone ? lot.count * sourcing.priceUsd : sourcing.priceUsd),
        note: `${sourcing.provider} ${sourcing.sku}`,
      })
    } else if (info.suppliedBy === 'brand') {
      lines.push({
        id: `stones:${info.key}`,
        group: 'stones',
        label,
        formula: 'customer-supplied',
        inputs: [computed('qty', lot.count, 'pcs')],
        amount: 0,
        note: 'Supplied by the brand; not priced',
      })
    } else {
      const perCt = rate(
        `${lot.stone} per ct`,
        rates.stonePricePerCt?.[lot.stone],
        DEFAULTS.stonePricePerCt[lot.stone] ?? DEFAULTS.stoneFallbackPerCt,
        `${currency}/ct`,
      )
      lines.push({
        id: `stones:${info.key}`,
        group: 'stones',
        label,
        formula: 'qty × ct × price_per_ct',
        inputs: [
          computed('qty', lot.count, 'pcs'),
          computed('ct each', round3(lot.caratEach), 'ct'),
          perCt,
        ],
        amount: r2(lot.caratTotal * perCt.value),
      })
    }
  }

  // Setting, per lot by setting type.
  for (const info of ctx.lots) {
    const s = info.lot.setting
    const per =
      rates.settingPerStoneUsd !== undefined
        ? rate(
            'setting per stone',
            rates.settingPerStoneUsd,
            DEFAULTS.settingFallback,
            `${currency}/stone`,
          )
        : rate(
            `${s} setting per stone`,
            rates.settingPerStone?.[s],
            DEFAULTS.settingPerStone[s] ?? DEFAULTS.settingFallback,
            `${currency}/stone`,
          )
    lines.push({
      id: `setting:${info.key}`,
      group: 'setting',
      label: `${info.key} · ${s} setting`,
      formula: 'qty × rate[setting_type]',
      inputs: [computed('qty', info.lot.count, 'pcs'), per],
      amount: r2(info.lot.count * per.value),
    })
  }

  // Labour.
  if (rates.laborUsd !== undefined) {
    const l = rate('labour per piece', rates.laborUsd, 0, currency)
    lines.push({
      id: 'labour',
      group: 'labour',
      label: 'Labour (all-in)',
      formula: 'labour',
      inputs: [l],
      amount: r2(l.value),
    })
  } else {
    const labour = (
      id: string,
      label: string,
      formula: string,
      inputs: CostInput[],
      amount: number,
    ) =>
      lines.push({
        id: `labour:${id}`,
        group: 'labour',
        label,
        formula,
        inputs,
        amount: r2(amount),
      })
    const cad = rate('CAD fee', rates.cadFee, DEFAULTS.cadFee, currency)
    labour(
      'cad',
      'CAD (amortised)',
      'cad_fee / qty',
      [cad, { name: 'qty', value: q, unit: 'pcs', source: 'user' }],
      cad.value / q,
    )
    const print = rate('print fee', rates.printFee, DEFAULTS.printFee, currency)
    labour('print', 'Pattern print', 'print_fee', [print], print.value)
    const cast = rate('casting fee', rates.castingFee, DEFAULTS.castingFee, currency)
    labour('cast', 'Casting', 'casting_fee', [cast], cast.value)
    const hours = rate('finish hours', rates.finishHours, DEFAULTS.finishHours, 'h')
    const hourly = rate('hourly rate', rates.hourlyRate, DEFAULTS.hourlyRate, `${currency}/h`)
    labour(
      'finish',
      'Finishing and polishing',
      'finish_hours × hourly_rate',
      [hours, hourly],
      hours.value * hourly.value,
    )
    if (ctx.input.evaluation.parts.some((p) => p.plating !== 'none')) {
      const plating = rate('plating fee', rates.platingFee, DEFAULTS.platingFee, currency)
      labour('plating', 'Plating', 'plating_fee', [plating], plating.value)
    }
    const assay = rate('assay / hallmark fee', rates.assayFee, DEFAULTS.assayFee, currency)
    labour('assay', 'Assay and hallmark', 'assay_fee', [assay], assay.value)
  }

  const materials = r2(lines.reduce((t, l) => t + l.amount, 0))
  const overhead = rate('overhead', rates.overheadPct, DEFAULTS.overheadPct, '%')
  const overheadAmount = r2(materials * (overhead.value / 100))
  lines.push({
    id: 'overhead',
    group: 'overhead',
    label: 'Overhead',
    formula: 'subtotal × overhead',
    inputs: [computed('subtotal', materials, currency), overhead],
    amount: overheadAmount,
  })
  const cost = r2(materials + overheadAmount)
  const margin = rate('margin', rates.marginPct, DEFAULTS.marginPct, '%')
  const marginAmount = r2(cost * (margin.value / 100))
  lines.push({
    id: 'margin',
    group: 'margin',
    label: 'Margin',
    formula: 'cost × margin',
    inputs: [computed('cost', cost, currency), margin],
    amount: marginAmount,
  })
  const tax = rate('tax', rates.taxPct, DEFAULTS.taxPct, '%')
  const taxAmount = r2((cost + marginAmount) * (tax.value / 100))
  lines.push({
    id: 'tax',
    group: 'tax',
    label: 'Tax',
    formula: '(cost + margin) × tax',
    inputs: [computed('cost + margin', r2(cost + marginAmount), currency), tax],
    amount: taxAmount,
  })
  const price = r2(cost + marginAmount + taxAmount)

  return {
    currency,
    quantity: q,
    lines,
    perPiece: { materials, cost, price },
    order: { cost: r2(cost * q), price: r2(price * q) },
    placeholders: [...placeholders],
    priceSource: rates.priceSource ?? null,
    priceTimestamp: rates.priceTimestamp ?? null,
    formula:
      'cost = (metal + stones + setting + labour) × (1 + overhead); price = cost × (1 + margin) × (1 + tax)',
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000
