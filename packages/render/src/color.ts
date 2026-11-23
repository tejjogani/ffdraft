/** Colour conversions. All scene colours are linear Rec.709/sRGB primaries unless named `display`. */

export type Rgb = [number, number, number]

export const luminance = ([r, g, b]: Rgb): number => 0.2126 * r + 0.7152 * g + 0.0722 * b

export const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4

/** `#rrggbb` → display-referred sRGB in 0–1. */
export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) throw new Error(`Invalid colour "${hex}", expected #rrggbb`)
  return [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255]
}

/**
 * Linear RGB of a black body at `kelvin`, normalised to luminance 1 so a light's colour never
 * changes its brightness. Uses Tanner Helland's fit of the sRGB-encoded Planckian locus
 * (1000–40000 K), which is accurate to a few percent — plenty for light tints.
 */
export function kelvinToRgb(kelvin: number): Rgb {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  const lin: Rgb = [r, g, b].map((c) => srgbToLinear(Math.min(255, Math.max(0, c)) / 255)) as Rgb
  const y = luminance(lin)
  return [lin[0] / y, lin[1] / y, lin[2] / y]
}

export const mulRgb = (c: Rgb, s: number): Rgb => [c[0] * s, c[1] * s, c[2] * s]
