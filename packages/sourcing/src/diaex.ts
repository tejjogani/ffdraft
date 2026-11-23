/**
 * Diaex (thediaex.com) — P0: deep links into the Diaex console's browse and matched-pair
 * search, pre-filtered so every result fits the CAD seat. Works signed out; no API needed.
 * Filter vocabulary and URL shapes: docs/research/07-sourcing.md §1 and §6.
 */
import type { SourcingProvider } from './provider'
import type { StoneRequirement } from './requirements'

const DEFAULT_ORIGIN = 'https://console.thediaex.com'

const FANCY_HUE: Partial<Record<StoneRequirement['material'], string>> = {
  'diamond-yellow': 'Yellow',
  'diamond-pink': 'Pink',
}
/** Diaex lists diamonds only today; everything else goes through a request. */
const STOCKED = ['diamond', 'diamond-lab', 'diamond-yellow', 'diamond-pink'] as const

const round2 = (v: number) => Math.round(v * 100) / 100

function stoneTypes(r: StoneRequirement): string[] | undefined {
  if (r.origin === 'natural') return ['Natural']
  if (r.origin === 'lab') return ['CVD', 'HPHT']
  return undefined
}

function browseFilters(r: StoneRequirement): Record<string, unknown> {
  const hue = FANCY_HUE[r.material]
  return {
    shapes: [r.cut],
    ...(stoneTypes(r) ? { stone_types: stoneTypes(r) } : {}),
    ...(hue ? { fancy_hues: [hue] } : r.quality.colors ? { colors: r.quality.colors } : {}),
    ...(r.quality.clarities ? { clarities: r.quality.clarities } : {}),
    min_length_mm: round2(r.seat.length - r.seat.tolMinus),
    max_length_mm: round2(r.seat.length + r.seat.tolPlus),
    min_width_mm: round2(r.seat.width - r.seat.tolMinus),
    max_width_mm: round2(r.seat.width + r.seat.tolPlus),
    availability: ['available'],
  }
}

export function createDiaexProvider(origin: string = DEFAULT_ORIGIN): SourcingProvider {
  return {
    id: 'diaex',
    label: 'Diaex',
    capabilities: () => ({
      linkOut: true,
      match: false,
      cart: false,
      requests: false,
      metals: false,
      materials: STOCKED,
    }),
    searchUrl(r) {
      if (!(STOCKED as readonly string[]).includes(r.material)) return null
      if (r.kind === 'matchedSet') {
        const q = new URLSearchParams({
          way: 'build',
          shape: r.cut,
          unit: 'mm',
          size: String(round2(r.seat.width)),
          stones: String(r.quantity),
          ...(r.quality.colors ? { colors: r.quality.colors.join(',') } : {}),
          ...(r.quality.clarities ? { clarities: r.quality.clarities.join(',') } : {}),
          ...(r.origin !== 'any' ? { type: r.origin === 'lab' ? 'lab' : 'natural' } : {}),
        })
        return `${origin}/pairs?${q}`
      }
      return `${origin}/browse?f=${encodeURIComponent(JSON.stringify(browseFilters(r)))}`
    },
  }
}
