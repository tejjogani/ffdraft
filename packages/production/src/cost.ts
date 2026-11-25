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
  type GemCutId,
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
  /** Rates that fell back to defaults, by name. */
  placeholders: string[]
  /** "placeholder — set your rates" whenever any default was used. */
  note: string | null
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

/**
 * What an estimate is worked out from. A production package has all of it; a quick estimate
 * (`roughCost`) has only an evaluation summary and prices it at the same placeholder rates.
 */
export interface CostBasis {
  rates: RateInput
  quantity: number
  metals: readonly Pick<PackageContext['metals'][number], 'metal' | 'netGrams'>[]
  lots: readonly (Pick<PackageContext['lots'][number], 'key' | 'sourcing' | 'suppliedBy'> & {
    /** Every supplier record on the lot's nodes; absent for a quick estimate, which has none. */
    sourced?: PackageContext['lots'][number]['sourced']
    lot: Pick<
      PackageContext['lots'][number]['lot'],
      'stone' | 'cut' | 'width' | 'count' | 'caratEach' | 'caratTotal' | 'setting' | 'nodeIds'
    >
  })[]
  /**
   * Per node, its stones in each lot (`stonesByNode`), so an attached price is charged once and
   * in full. Only a production package has the evaluation to work it out from.
   */
  nodeStones?: NodeStones
  plated: boolean
}

export function estimateCost(ctx: PackageContext): CostEstimate {
  return estimateFrom({
    rates: ctx.input.options.rates ?? {},
    quantity: ctx.quantity,
    metals: ctx.metals,
    lots: ctx.lots,
    nodeStones: stonesByNode(ctx),
    plated: ctx.input.evaluation.parts.some((p) => p.plating !== 'none'),
  })
}

/** The evaluation facts a rough cost reads (`EvaluationSummary` from @pave/schema fits). */
export interface CostSummary {
  metals: readonly { material: string; massG: number }[]
  lots: readonly {
    cut: string
    stone: string
    width: number
    count: number
    caratTotal: number
    setting: string
  }[]
}

/**
 * A rough cost for comparing designs (direction cards): the production estimate's formula at
 * its placeholder rates, from evaluation facts alone. Stones are priced as the house buys them;
 * plating is not known from the facts and is left out.
 */
export function roughCost(summary: CostSummary, rates: RateInput = {}): CostEstimate {
  return estimateFrom({
    rates,
    quantity: 1,
    metals: summary.metals
      .filter((m) => m.material in METALS && m.massG > 0)
      .map((m) => ({ metal: m.material as MetalId, netGrams: m.massG })),
    lots: summary.lots
      .filter((l) => l.stone in GEM_MATERIALS && l.cut in GEM_CUTS && l.count > 0)
      .map((l, i) => ({
        key: `L${i + 1}`,
        suppliedBy: 'manufacturer' as const,
        lot: {
          stone: l.stone as GemMaterialId,
          cut: l.cut as GemCutId,
          width: l.width,
          count: l.count,
          caratEach: l.caratTotal / l.count,
          caratTotal: l.caratTotal,
          setting: l.setting,
          nodeIds: [],
        },
      })),
    plated: false,
  })
}

function estimateFrom(ctx: CostBasis): CostEstimate {
  const rates = ctx.rates
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
        // An alloy with no fineness (brass) is bought by the gram: its family rate is the price.
        rates.metalPricePerGramUsd ?? rates.spotPerGram?.[metal.family],
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
  const nodeStones: NodeStones = ctx.nodeStones ?? new Map()
  /** What each parcel has been charged to the lots before this one, so the last takes the rest. */
  const charged = new Map<string, number>()
  ctx.lots.forEach((info, index) => {
    const { lot } = info
    const label = `${info.key} · ${lot.count} × ${GEM_MATERIALS[lot.stone].label}, ${GEM_CUTS[lot.cut].label.toLowerCase()} ${lot.width.toFixed(2)} mm`
    const priced = (info.sourced ?? []).flatMap(({ nodeId, sourcing }) =>
      sourcing.priceUsd === undefined ? [] : [{ nodeId, sourcing, price: sourcing.priceUsd }],
    )
    if (priced.length) {
      // A node that is one stone (a gem) is priced by the stone; a node that is many (a pavé
      // field, a row) is a parcel bought at one price, shared by weight between the lots its
      // stones fall in: one field in two graded sizes is two lots, and one purchase.
      const isParcel = (nodeId: string) => (nodeStones.get(nodeId)?.count ?? 0) > 1
      const singles = priced.filter((p) => !isParcel(p.nodeId))
      const parcels = priced.filter((p) => isParcel(p.nodeId))
      const inputs: CostInput[] = [computed('qty', lot.count, 'pcs')]
      let amount = 0
      let shared = false
      for (const p of parcels) {
        const { carats, total } = nodeStones.get(p.nodeId)!
        const share = total > 0 ? carats[index]! / total : 1
        const last = carats.findLastIndex((ct) => ct > 0) === index
        const before = charged.get(p.nodeId) ?? 0
        // The last lot takes what is left, so the lots add up to the parcel price to the cent.
        const part = last ? r2(p.price - before) : r2(p.price * share)
        charged.set(p.nodeId, before + part)
        amount += part
        inputs.push({ name: 'parcel price', value: p.price, unit: currency, source: 'sourcing' })
        if (share < 1) {
          shared = true
          inputs.push(computed('share of the parcel in this lot', round3(share), ''))
        }
      }
      // Stones in the lot with no price of their own (a mirrored copy, the twin of a matched
      // pair not bought yet) are estimated at the price of the stones they match, when the lot
      // is single stones throughout.
      const everyNodeOneStone = lot.nodeIds.length === lot.count
      if (singles.length) {
        const sum = singles.reduce((t, p) => t + p.price, 0)
        const estimated = everyNodeOneStone ? lot.count - parcels.length : singles.length
        amount += (sum / singles.length) * estimated
        for (const p of singles)
          inputs.push({
            name: 'price per stone',
            value: p.price,
            unit: currency,
            source: 'sourcing',
          })
      }
      const formula =
        parcels.length === 0
          ? singles.length === 1
            ? 'qty × price_per_stone'
            : everyNodeOneStone && singles.length < lot.count
              ? 'qty × mean price_per_stone'
              : 'Σ price_per_stone'
          : singles.length === 0
            ? `${parcels.length > 1 ? 'Σ ' : ''}parcel_price${shared ? ' × share' : ''}`
            : 'Σ attached prices'
      lines.push({
        id: `stones:${info.key}`,
        group: 'stones',
        label,
        formula,
        inputs,
        amount: r2(amount),
        note: priced.map((p) => `${p.sourcing.provider} ${p.sourcing.sku}`).join('; '),
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
  })

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
    if (ctx.plated) {
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
    note: placeholders.size ? PLACEHOLDER_NOTE : null,
    priceSource: rates.priceSource ?? null,
    priceTimestamp: rates.priceTimestamp ?? null,
    formula:
      'cost = (metal + stones + setting + labour) × (1 + overhead); price = cost × (1 + margin) × (1 + tax)',
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

/**
 * Per node: how many stones it has in the evaluation, and their carats in each lot and in
 * total. Lots are matched the way the kernel builds them (cut, stone, size to 0.01 mm, setting,
 * role), among the lots that name the node.
 */
type NodeStones = Map<string, { count: number; carats: number[]; total: number }>

function stonesByNode(ctx: PackageContext): NodeStones {
  const size = (v: number) => Math.round(v * 100) / 100
  const key = (o: {
    cut: string
    stone: string
    width: number
    length: number
    setting: string
    role: string
  }) => [o.cut, o.stone, size(o.width), size(o.length), o.setting, o.role].join('|')
  const lotsByKey = new Map<string, number[]>()
  ctx.lots.forEach(({ lot }, i) => {
    lotsByKey.set(key(lot), [...(lotsByKey.get(key(lot)) ?? []), i])
  })
  const out: NodeStones = new Map()
  for (const s of ctx.input.evaluation.stones) {
    const node = out.get(s.nodeId) ?? { count: 0, carats: ctx.lots.map(() => 0), total: 0 }
    out.set(s.nodeId, node)
    node.count++
    const lot = lotsByKey
      .get(key({ ...s, width: s.dims.width, length: s.dims.length }))
      ?.find((i) => ctx.lots[i]!.lot.nodeIds.includes(s.nodeId))
    if (lot === undefined) continue
    node.carats[lot]! += s.carat
    node.total += s.carat
  }
  return out
}
