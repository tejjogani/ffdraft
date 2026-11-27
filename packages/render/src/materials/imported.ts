import type { RenderScene, SourceRenderAppearance } from '@pave/schema'
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

/** A per-part choice can supply missing source information. Whole-piece variants respect the bound family. */
export function importedShotMaterial(
  source: SourceRenderAppearance | undefined,
  part: RenderScene['overrides'][string] | undefined,
  all: RenderScene['overrides'][string] | undefined,
): ResolvedMaterial | undefined {
  const explicitKind =
    part?.stone && !part.material ? 'gem' : part?.material && !part.stone ? 'metal' : undefined
  const kind = explicitKind ?? source?.kind
  if (kind === 'gem') {
    const stone = part?.stone ?? all?.stone
    if (stone) return gemMaterial(stone)
  }
  if (kind === 'metal') {
    const alloy = part?.material ?? all?.material
    const finish = part?.finish ?? all?.finish
    const plating = part?.plating ?? all?.plating
    if (alloy || finish || plating) {
      const metal = alloy ?? (source?.kind === 'metal' ? source.metal : undefined)
      if (metal) {
        const material = metalMaterial(metal, finish ?? 'polished', plating ?? 'none')
        if (!alloy && (!plating || plating === 'none') && source?.color) {
          material.color = hexToRgb(source.color).map(srgbToLinear) as Rgb
        }
        return material
      }
    }
  }
  return source && importedRenderMaterial(source)
}
