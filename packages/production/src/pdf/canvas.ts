/**
 * A thin millimetre canvas over pdf-lib: top-left origin, y down, the embedded fonts, and a
 * renderer for the drawing model that emits raw path operators (one stroke per pen), so a sheet
 * with tens of thousands of segments stays small and fast.
 */
import {
  closePath,
  degrees,
  fill,
  lineTo,
  moveTo,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setCharacterSpacing,
  setDashPattern,
  setFillingRgbColor,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  stroke,
} from 'pdf-lib'
import {
  type FontFamily,
  type FontWeight,
  type Item,
  PENS,
  type Sheet,
  type TextStyle,
} from '../drawing/model'
import type { Typesetter } from '../fonts'

export const K = 72 / 25.4

export interface PdfFonts {
  regular: PDFFont
  medium: PDFFont
  semibold: PDFFont
  serif: PDFFont
  /** The same faces with tabular figures. */
  regularTabular: PDFFont
  mediumTabular: PDFFont
}

export const hex = (c: string) => {
  const n = Number.parseInt(c.slice(1), 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}
const hex3 = (c: string): [number, number, number] => {
  const n = Number.parseInt(c.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export class Canvas {
  constructor(
    readonly doc: PDFDocument,
    readonly page: PDFPage,
    readonly fonts: PdfFonts,
    readonly ts: Typesetter,
  ) {}

  get width(): number {
    return this.page.getWidth() / K
  }

  get height(): number {
    return this.page.getHeight() / K
  }

  private X = (x: number) => x * K
  private Y = (y: number) => this.page.getHeight() - y * K

  font(family: FontFamily = 'sans', weight: FontWeight = 'regular', tabular = false): PDFFont {
    if (family === 'serif') return this.fonts.serif
    if (tabular && weight === 'regular') return this.fonts.regularTabular
    if (tabular && weight === 'medium') return this.fonts.mediumTabular
    return this.fonts[weight]
  }

  measure(text: string, style: TextStyle): number {
    return this.ts.measure(text, style)
  }

  text(
    x: number,
    y: number,
    text: string,
    style: TextStyle,
    anchor: 'start' | 'middle' | 'end' = 'start',
    rotate = 0,
  ) {
    const safe = this.ts.safe(text, style.family, style.weight)
    // A view with no geometry has no extent to place its labels against; skip them rather
    // than abort the whole sheet on a NaN position.
    if (!safe || !Number.isFinite(x) || !Number.isFinite(y)) return
    const w = this.ts.measure(safe, style)
    const shift = anchor === 'start' ? 0 : anchor === 'middle' ? w / 2 : w
    const rad = (rotate * Math.PI) / 180
    const tx = x - shift * Math.cos(rad)
    const ty = y + shift * Math.sin(rad)
    const tracking = style.tracking ? style.tracking * style.size : 0
    if (tracking) this.page.pushOperators(setCharacterSpacing(tracking))
    this.page.drawText(safe, {
      x: this.X(tx),
      y: this.Y(ty),
      size: style.size,
      font: this.font(style.family, style.weight, style.tabular),
      color: hex(style.color ?? '#1c1b1a'),
      ...(rotate ? { rotate: degrees(rotate) } : {}),
    })
    if (tracking) this.page.pushOperators(setCharacterSpacing(0))
  }

  /** Greedy word wrap with the embedded font's metrics. */
  wrap(text: string, style: TextStyle, width: number): string[] {
    const out: string[] = []
    for (const para of text.split(/\n/)) {
      let line = ''
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word
        if (line && this.ts.measure(next, style) > width) {
          out.push(line)
          line = word
        } else line = next
      }
      out.push(line)
    }
    return out
  }

  line(x0: number, y0: number, x1: number, y1: number, color = '#c6c4bf', width = 0.25) {
    this.page.drawLine({
      start: { x: this.X(x0), y: this.Y(y0) },
      end: { x: this.X(x1), y: this.Y(y1) },
      thickness: width,
      color: hex(color),
    })
  }

  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    opts: { fill?: string; stroke?: string; width?: number },
  ) {
    this.page.drawRectangle({
      x: this.X(x),
      y: this.Y(y + h),
      width: w * K,
      height: h * K,
      ...(opts.fill ? { color: hex(opts.fill) } : {}),
      ...(opts.stroke ? { borderColor: hex(opts.stroke), borderWidth: opts.width ?? 0.25 } : {}),
    })
  }

  circle(
    cx: number,
    cy: number,
    r: number,
    opts: { fill?: string; stroke?: string; width?: number },
  ) {
    this.page.drawCircle({
      x: this.X(cx),
      y: this.Y(cy),
      size: r * K,
      ...(opts.fill ? { color: hex(opts.fill) } : {}),
      ...(opts.stroke ? { borderColor: hex(opts.stroke), borderWidth: opts.width ?? 0.25 } : {}),
    })
  }

  image(img: PDFImage, x: number, y: number, w: number, h: number) {
    this.page.drawImage(img, { x: this.X(x), y: this.Y(y + h), width: w * K, height: h * K })
  }

  /** Draws a drawing-model sheet with its top-left at (x, y), scaled by `s`. */
  sheet(sheet: Sheet, x: number, y: number, s = 1) {
    const P = (px: number, py: number): [number, number] => [this.X(x + px * s), this.Y(y + py * s)]
    for (const it of sheet.items) this.item(it, P, s)
  }

  private item(it: Item, P: (x: number, y: number) => [number, number], s: number) {
    const page = this.page
    switch (it.t) {
      case 'lines': {
        const pen = PENS[it.pen]
        const ops = [
          pushGraphicsState(),
          setStrokingRgbColor(...hex3(pen.color)),
          setLineWidth(pen.width * K * Math.max(s, 0.6)),
          setLineCap(1),
          setLineJoin(1),
        ]
        if ('dash' in pen)
          ops.push(
            setDashPattern(
              pen.dash.map((d) => d * K),
              0,
            ),
          )
        for (const pl of it.lines) {
          if (pl.length < 4) continue
          ops.push(moveTo(...P(pl[0]!, pl[1]!)))
          for (let i = 2; i < pl.length; i += 2) ops.push(lineTo(...P(pl[i]!, pl[i + 1]!)))
          if (it.closed) ops.push(closePath())
        }
        ops.push(stroke(), popGraphicsState())
        // Spread in chunks: one call with ~10⁵ operators overflows the call stack.
        for (let i = 0; i < ops.length; i += 8192) page.pushOperators(...ops.slice(i, i + 8192))
        return
      }
      case 'fill': {
        const ops = [
          pushGraphicsState(),
          setFillingRgbColor(...hex3(it.color)),
          moveTo(...P(it.pts[0]!, it.pts[1]!)),
        ]
        for (let i = 2; i < it.pts.length; i += 2)
          ops.push(lineTo(...P(it.pts[i]!, it.pts[i + 1]!)))
        ops.push(closePath(), fill(), popGraphicsState())
        page.pushOperators(...ops)
        return
      }
      case 'circle': {
        const [cx, cy] = P(it.cx, it.cy)
        const pen = it.pen ? PENS[it.pen] : null
        page.drawCircle({
          x: cx,
          y: cy,
          size: it.r * s * K,
          ...(it.fill ? { color: hex(it.fill) } : {}),
          ...(pen ? { borderColor: hex(pen.color), borderWidth: pen.width * K } : {}),
        })
        return
      }
      case 'rect': {
        const [rx, ry] = P(it.x, it.y + it.h)
        const pen = it.pen ? PENS[it.pen] : null
        page.drawRectangle({
          x: rx,
          y: ry,
          width: it.w * s * K,
          height: it.h * s * K,
          ...(it.fill ? { color: hex(it.fill) } : {}),
          ...(pen ? { borderColor: hex(pen.color), borderWidth: pen.width * K } : {}),
        })
        return
      }
      case 'text': {
        // Sheet coordinates → page millimetres, then the shared text path (anchor, tracking).
        const [px, py] = P(it.x, it.y)
        this.text(
          px / K,
          (page.getHeight() - py) / K,
          it.text,
          { ...it.style, size: it.style.size * s },
          it.anchor ?? 'start',
          it.rotate ?? 0,
        )
        return
      }
    }
  }
}
