/**
 * Resolves schema ids to explicit, renderer-neutral material parameters. Both the three.js
 * factories and the Blender worker consume only these resolved records, never the tables.
 */
import { type FinishId, GEM_MATERIALS, type GemMaterialId, type MetalId, type PlatingId } from '@pave/schema'
import type { Rgb } from '../color'
import { GEM_APPEARANCE } from './gems'
import { BRUSH_AXIS, FINISH_APPEARANCE, METAL_APPEARANCE, PLATING_APPEARANCE, type Relief } from './metals'

export { GEM_APPEARANCE, type GemAppearance, type SurfaceGem, type TransparentGem } from './gems'
export {
  BRUSH_AXIS,
  FINISH_APPEARANCE,
  type FinishAppearance,
  METAL_APPEARANCE,
  type MetalAppearance,
  PLATING_APPEARANCE,
  type Relief,
} from './metals'

export interface MetalMaterial {
  kind: 'metal'
  color: Rgb
  edgeTint: Rgb
  roughness: number
  anisotropy: number
  /** Brushed streaks run around this axis (piece frame). */
  brushAxis: [number, number, number]
  relief: Relief | null
}

export interface GemMaterial {
  kind: 'gem'
  ior: number
  abbe: number
  /** glTF KHR_materials_dispersion / three.js `dispersion`: 20 / V (research §2). */
  dispersion: number
  attenuationColor: Rgb
  /** mm. */
  attenuationDistance: number
}

export interface SurfaceMaterial {
  kind: 'surface'
  color: Rgb
  roughness: number
  ior: number
  subsurfaceMm: number
  thinFilm: [number, number] | null
  coat: number
}

export type ResolvedMaterial = MetalMaterial | GemMaterial | SurfaceMaterial

export function metalMaterial(metal: MetalId, finish: FinishId, plating: PlatingId): MetalMaterial {
  const surface = PLATING_APPEARANCE[plating] ?? METAL_APPEARANCE[metal]
  const f = FINISH_APPEARANCE[finish]
  return {
    kind: 'metal',
    color: surface.color,
    edgeTint: surface.edgeTint,
    roughness: f.roughness,
    anisotropy: f.anisotropy,
    brushAxis: BRUSH_AXIS,
    relief: f.relief,
  }
}

export function gemMaterial(stone: GemMaterialId): GemMaterial | SurfaceMaterial {
  const a = GEM_APPEARANCE[stone]
  const ior = GEM_MATERIALS[stone].ri
  if (a.kind === 'surface') {
    const { kind: _, ...rest } = a
    return { kind: 'surface', ior, ...rest }
  }
  return {
    kind: 'gem',
    ior,
    abbe: a.abbe,
    dispersion: 20 / a.abbe,
    attenuationColor: a.attenuationColor,
    attenuationDistance: a.attenuationDistance,
  }
}

/** Stable keys so identical materials are shared between parts and across renderers. */
export const metalKey = (metal: MetalId, finish: FinishId, plating: PlatingId): string =>
  `metal:${metal}/${finish}/${plating}`
export const gemKey = (stone: GemMaterialId): string => `gem:${stone}`
