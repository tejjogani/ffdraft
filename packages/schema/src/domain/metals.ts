/**
 * Precious-metal alloys. Physical data only — rendering appearance lives in @pave/render,
 * keyed by the same ids, so there is exactly one place for each kind of number.
 *
 * `density` is g/cm³ at 20 °C for a typical casting alloy of that fineness. Real alloys vary
 * by a few percent with the master alloy; manufacturers confirm final weights. Values follow
 * docs/research/01-cad.md §3 (JewelCraft's alloy table, Stuller's specific-gravity chart):
 * platinum 950 is the common Pt/Ru casting alloy (20.7), not pure platinum (21.45).
 */
export type MetalFamily = 'gold' | 'platinum' | 'palladium' | 'silver' | 'titanium' | 'base'

export interface Metal {
  label: string
  family: MetalFamily
  /** Parts per thousand of the precious metal; also the fineness hallmark. */
  fineness: number
  hallmark: string
  density: number
  /** sRGB swatch for UI chips only. */
  swatch: string
  /** Typical casting shrinkage (linear %), surfaced in the production package. */
  shrinkagePct: number
}

const m = (
  label: string,
  family: MetalFamily,
  fineness: number,
  hallmark: string,
  density: number,
  swatch: string,
  shrinkagePct: number,
): Metal => ({ label, family, fineness, hallmark, density, swatch, shrinkagePct })

export const METALS = {
  'au24k-yellow': m('24k Yellow Gold', 'gold', 999, '999', 19.32, '#F2C14E', 1.25),
  'au22k-yellow': m('22k Yellow Gold', 'gold', 916, '916', 17.8, '#EDBE55', 1.25),
  'au18k-yellow': m('18k Yellow Gold', 'gold', 750, '750', 15.5, '#E6BE6A', 1.25),
  'au18k-white': m('18k White Gold', 'gold', 750, '750', 15.7, '#D9D6CF', 1.25),
  'au18k-rose': m('18k Rose Gold', 'gold', 750, '750', 15.1, '#E0A58C', 1.25),
  'au14k-yellow': m('14k Yellow Gold', 'gold', 585, '585', 13.1, '#DDBE78', 1.25),
  'au14k-white': m('14k White Gold', 'gold', 585, '585', 12.8, '#D5D3CC', 1.25),
  'au14k-rose': m('14k Rose Gold', 'gold', 585, '585', 13.2, '#DBA38F', 1.25),
  'au10k-yellow': m('10k Yellow Gold', 'gold', 417, '417', 11.6, '#D6BE86', 1.25),
  'au10k-white': m('10k White Gold', 'gold', 417, '417', 11.1, '#D2D0CA', 1.25),
  'au9k-yellow': m('9k Yellow Gold', 'gold', 375, '375', 11.2, '#D4BE8C', 1.25),
  pt950: m('Platinum 950', 'platinum', 950, 'PT950', 20.7, '#D4D4D2', 1.5),
  pt900: m('Platinum 900', 'platinum', 900, 'PT900', 21.5, '#D2D2D0', 1.5),
  pd950: m('Palladium 950', 'palladium', 950, 'PD950', 12.16, '#CFCFCD', 1.5),
  'ag925-sterling': m('Sterling Silver', 'silver', 925, '925', 10.36, '#E3E3E1', 1.4),
  'ag999-fine': m('Fine Silver', 'silver', 999, '999', 10.49, '#E8E8E6', 1.4),
  'ti-grade5': m('Titanium', 'titanium', 900, 'TI', 4.43, '#A9A9A6', 0),
  brass: m('Brass (prototype)', 'base', 0, '', 8.5, '#D8B45A', 1.5),
} as const satisfies Record<string, Metal>

export type MetalId = keyof typeof METALS
export const METAL_IDS = Object.keys(METALS) as [MetalId, ...MetalId[]]

/** Surface finishes; roughness etc. are resolved by @pave/render. */
export const FINISHES = {
  polished: { label: 'High polish' },
  satin: { label: 'Satin' },
  brushed: { label: 'Brushed' },
  matte: { label: 'Matte / sandblast' },
  hammered: { label: 'Hammered' },
} as const
export type FinishId = keyof typeof FINISHES
export const FINISH_IDS = Object.keys(FINISHES) as [FinishId, ...FinishId[]]

export const PLATINGS = {
  none: { label: 'None' },
  rhodium: { label: 'Rhodium' },
  'black-rhodium': { label: 'Black rhodium' },
  'yellow-vermeil': { label: 'Gold vermeil (2.5 µm+)' },
  'rose-vermeil': { label: 'Rose vermeil (2.5 µm+)' },
} as const
export type PlatingId = keyof typeof PLATINGS
export const PLATING_IDS = Object.keys(PLATINGS) as [PlatingId, ...PlatingId[]]

/** Metal mass in grams for a solid volume in mm³. */
export const metalMassG = (metal: MetalId, volumeMm3: number): number =>
  (volumeMm3 / 1000) * METALS[metal].density
