/** Drawing model → standalone SVG in millimetres (opens in browsers, Illustrator, Rhino). */
import { type Item, PENS, PT, type Sheet, type TextStyle } from '../drawing/model'

const FAMILY = {
  sans: "Inter, 'Helvetica Neue', Arial, sans-serif",
  serif: "'Instrument Serif', Georgia, 'Times New Roman', serif",
} as const
const WEIGHT = { regular: 400, medium: 500, semibold: 600 } as const

const n = (v: number) => {
  const r = Math.round(v * 1000) / 1000
  return Object.is(r, -0) ? '0' : String(r)
}

export const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)

function pathData(lines: readonly ArrayLike<number>[], closed?: boolean): string {
  const parts: string[] = []
  for (const pl of lines) {
    if (pl.length < 4) continue
    let d = `M${n(pl[0]!)} ${n(pl[1]!)}`
    for (let i = 2; i < pl.length; i += 2) d += `L${n(pl[i]!)} ${n(pl[i + 1]!)}`
    parts.push(closed ? `${d}Z` : d)
  }
  return parts.join('')
}

function textAttrs(style: TextStyle): string {
  const size = style.size * PT
  const attrs = [
    `font-family="${FAMILY[style.family ?? 'sans']}"`,
    `font-size="${n(size)}"`,
    `font-weight="${WEIGHT[style.weight ?? 'regular']}"`,
    `fill="${style.color ?? '#1c1b1a'}"`,
  ]
  if (style.tracking) attrs.push(`letter-spacing="${n(style.tracking * size)}"`)
  return attrs.join(' ')
}

function item(it: Item): string {
  switch (it.t) {
    case 'lines': {
      const pen = PENS[it.pen]
      const d = pathData(it.lines, it.closed)
      if (!d) return ''
      const dash = 'dash' in pen ? ` stroke-dasharray="${pen.dash.join(' ')}"` : ''
      return `<path d="${d}" fill="none" stroke="${pen.color}" stroke-width="${pen.width}"${dash} stroke-linecap="round" stroke-linejoin="round"/>`
    }
    case 'fill':
      return `<path d="${pathData([it.pts], true)}" fill="${it.color}"/>`
    case 'circle': {
      const stroke = it.pen ? ` stroke="${PENS[it.pen].color}" stroke-width="${PENS[it.pen].width}"` : ''
      return `<circle cx="${n(it.cx)}" cy="${n(it.cy)}" r="${n(it.r)}" fill="${it.fill ?? 'none'}"${stroke}/>`
    }
    case 'rect': {
      const stroke = it.pen ? ` stroke="${PENS[it.pen].color}" stroke-width="${PENS[it.pen].width}"` : ''
      return `<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" fill="${it.fill ?? 'none'}"${stroke}/>`
    }
    case 'text': {
      const anchor = it.anchor && it.anchor !== 'start' ? ` text-anchor="${it.anchor}"` : ''
      const rot = it.rotate ? ` transform="rotate(${n(-it.rotate)} ${n(it.x)} ${n(it.y)})"` : ''
      return `<text x="${n(it.x)}" y="${n(it.y)}" ${textAttrs(it.style)}${anchor}${rot}>${escapeXml(it.text)}</text>`
    }
  }
}

export function sheetToSvg(sheet: Sheet, title: string): string {
  const body = sheet.items.map(item).filter(Boolean).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${n(sheet.width)}mm" height="${n(sheet.height)}mm" viewBox="0 0 ${n(sheet.width)} ${n(sheet.height)}" style="font-variant-numeric: tabular-nums">
<title>${escapeXml(title)}</title>
<rect width="100%" height="100%" fill="#ffffff"/>
${body}
</svg>
`
}
