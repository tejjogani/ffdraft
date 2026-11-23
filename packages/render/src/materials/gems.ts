/**
 * Gem appearance. Refractive index comes from the schema (`GEM_MATERIALS[id].ri`, the optical
 * constant); this file adds what only rendering needs: Abbe number, absorption, and surface
 * recipes for stones that are never refracted. Sources: docs/research/03-rendering.md §2 "Gems".
 *
 * Abbe numbers marked *calc* in the research come from Sellmeier fits; the others use
 * V ≈ (n − 1) / (0.58 × B–G). Attenuation colours are *est*: the colour white light takes after
 * travelling `attenuationDistance` mm through the stone (glTF KHR_materials_volume semantics).
 */
import type { GemMaterialId } from '@pave/schema'
import type { Rgb } from '../color'

export interface TransparentGem {
  kind: 'transparent'
  abbe: number
  attenuationColor: Rgb
  attenuationDistance: number
}

/** Opaque and translucent stones: shaded as a surface, never with the refraction shader. */
export interface SurfaceGem {
  kind: 'surface'
  color: Rgb
  roughness: number
  /** Subsurface scattering mean free path in mm (pearl, opal body). */
  subsurfaceMm: number
  /** Thin-film interference thickness range in nm (pearl orient, opal play of colour). */
  thinFilm: [number, number] | null
  /** Clear lacquer-like coat weight (pearl lustre). */
  coat: number
}

export type GemAppearance = TransparentGem | SurfaceGem

const clear = (abbe: number, color: Rgb = [1, 1, 1], distance = 10): TransparentGem => ({
  kind: 'transparent',
  abbe,
  attenuationColor: color,
  attenuationDistance: distance,
})

const surface = (
  color: Rgb,
  roughness: number,
  extra: Partial<Omit<SurfaceGem, 'kind' | 'color' | 'roughness'>> = {},
): SurfaceGem => ({
  kind: 'surface',
  color,
  roughness,
  subsurfaceMm: 0,
  thinFilm: null,
  coat: 0,
  ...extra,
})

const DIAMOND_ABBE = 55.3
const CORUNDUM_ABBE = 72.3
const BERYL_ABBE = 71
const QUARTZ_ABBE = 69.7

export const GEM_APPEARANCE: Record<GemMaterialId, GemAppearance> = {
  diamond: clear(DIAMOND_ABBE),
  'diamond-lab': clear(DIAMOND_ABBE),
  'diamond-yellow': clear(DIAMOND_ABBE, [0.98, 0.88, 0.45], 5),
  'diamond-pink': clear(DIAMOND_ABBE, [0.97, 0.75, 0.82], 5),
  // Polished black diamond: a mirror-black surface (research §2, like onyx with diamond IOR).
  'diamond-black': surface([0.006, 0.006, 0.007], 0.02),
  moissanite: clear(25, [0.99, 0.99, 0.96], 10),
  cz: clear(33.5),
  'sapphire-blue': clear(CORUNDUM_ABBE, [0.05, 0.15, 0.75], 4),
  'sapphire-pink': clear(CORUNDUM_ABBE, [0.95, 0.35, 0.6], 5),
  'sapphire-yellow': clear(CORUNDUM_ABBE, [0.98, 0.8, 0.15], 6),
  'sapphire-white': clear(CORUNDUM_ABBE),
  ruby: clear(CORUNDUM_ABBE, [0.85, 0.03, 0.08], 4),
  emerald: clear(BERYL_ABBE, [0.05, 0.6, 0.25], 5),
  aquamarine: clear(BERYL_ABBE, [0.55, 0.88, 0.92], 8),
  morganite: clear(BERYL_ABBE, [0.98, 0.72, 0.7], 8),
  amethyst: clear(QUARTZ_ABBE, [0.55, 0.25, 0.8], 6),
  citrine: clear(QUARTZ_ABBE, [0.95, 0.65, 0.1], 8),
  topaz: clear(76, [0.3, 0.75, 0.95], 8),
  tourmaline: clear(64, [0.1, 0.45, 0.25], 5),
  garnet: clear(50, [0.55, 0.03, 0.05], 3),
  peridot: clear(58, [0.55, 0.8, 0.15], 6),
  tanzanite: clear(57, [0.3, 0.25, 0.85], 5),
  // Spinel and alexandrite are not in the research table: V from the formula, colours *est*.
  spinel: clear(62, [0.85, 0.1, 0.25], 4),
  alexandrite: clear(86, [0.25, 0.55, 0.45], 5),
  opal: surface([0.82, 0.86, 0.88], 0.12, { subsurfaceMm: 0.5, thinFilm: [250, 700], coat: 0.6 }),
  pearl: surface([0.8, 0.75, 0.7], 0.35, { subsurfaceMm: 0.4, thinFilm: [200, 700], coat: 1 }),
  onyx: surface([0.005, 0.005, 0.005], 0.03),
  turquoise: surface([0.05, 0.5, 0.5], 0.2),
}
