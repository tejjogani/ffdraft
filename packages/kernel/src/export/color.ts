/** Colour conversions for exporters whose formats store linear RGB. */

/** An sRGB `#rrggbb` swatch as linear RGB in 0…1 (IEC 61966-2-1). */
export function linearRgb(hex: string): [number, number, number] {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return [channel(0), channel(1), channel(2)]
}

/** The same colour as a `#rrggbb` string of linear values, for APIs that take hex but store linear. */
export function linearHex(hex: string): string {
  return `#${linearRgb(hex)
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}
