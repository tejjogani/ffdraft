import type { SourceRenderAppearance } from '@pave/schema'
import { hexToRgb, type Rgb, srgbToLinear } from '../color'
import { gemMaterial, metalMaterial, type ResolvedMaterial } from './index'

/** The legacy neutral diffuse on a transmissive gem doesn't describe the color of its glass. */
export function importedRenderMaterial(source: SourceRenderAppearance): ResolvedMaterial {
  const color = source.color ? (hexToRgb(source.color).map(srgbToLinear) as Rgb) : undefined
  if (source.kind === 'metal') {
    const material = metalMaterial(source.metal, 'polished', 'none')
    return color ? { ...material, color } : material
  }
  if (source.kind === 'gem') {
    const material = gemMaterial(source.stone)
    if (!color) return material
    if (material.kind === 'surface') return { ...material, color }
    const saturated = Math.max(...color) - Math.min(...color) > 0.04
    return saturated ? { ...material, attenuationColor: color } : material
  }
  return {
    kind: 'surface',
    color: color ?? [0.34, 0.34, 0.34],
    roughness: 0.35,
    ior: 1.45,
    coat: 0,
    thinFilm: null,
    subsurfaceMm: 0,
    opacity: source.opacity,
  }
}
