/**
 * Minimum stroke width. Hairlines of script fonts and fine artwork vanish in casting; the
 * Materialise gold/silver guides put the minimum feature at 0.35 mm wide (docs/research/
 * 06-freeform.md §4). Parts of the outline that do not survive a morphological opening of that
 * width are thickened — corners, which an opening also rounds, are left alone.
 */
import type { CrossSection } from 'manifold-3d'
import { runtime } from '../../runtime/index'

export const MIN_STROKE = 0.35

/** Returns the thickened outline (or null when nothing was thinner than `width`). The caller owns it. */
export function thickenStrokes(
  outline: CrossSection,
  width: number,
  segments: number,
): CrossSection | null {
  const { manifold: mf } = runtime()
  const r = width / 2
  const owned: CrossSection[] = []
  const own = (c: CrossSection) => {
    owned.push(c)
    return c
  }
  try {
    const opened = own(
      own(outline.offset(-r, 'Round', 2, segments)).offset(r, 'Round', 2, segments),
    )
    const thin = own(mf.CrossSection.difference(outline, opened))
    // A corner loses ≈ 0.2 r² to the opening; a real hairline loses its whole length × width.
    const strokes = thin.decompose().filter((piece) => {
      own(piece)
      return piece.area() > 2 * width * width
    })
    if (strokes.length === 0) return null
    const grown = strokes.map((piece) => own(piece.offset(r / 2, 'Round', 2, segments)))
    return mf.CrossSection.union([outline, ...grown])
  } finally {
    for (const c of owned) c.delete()
  }
}
