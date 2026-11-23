/**
 * Flow layout for the spec sheet: pages with a running header and footer, numbered sections,
 * key/value grids and tables that wrap cells and repeat their header across page breaks. The
 * visual language follows packages/ui/src/styles.css: warm-neutral ink, hairlines over boxes,
 * Inter with tabular figures, Instrument Serif for the title only.
 */
import { PDFDocument } from 'pdf-lib'
import { INK, PT, type TextStyle } from '../drawing/model'
import type { Typesetter } from '../fonts'
import { Canvas, type PdfFonts } from './canvas'

export const PAPER = { a4: [210, 297], letter: [215.9, 279.4] } as const

/** The drawing area of the spec sheet's drawings page; drawings/sheet.svg uses the same frame. */
export const drawingFrame = (paper: readonly [number, number]) => ({
  width: paper[0] - 36,
  height: paper[1] - 60,
})

export const STYLE = {
  body: { size: 8.25 } as TextStyle,
  bodyMuted: { size: 8.25, color: INK.muted } as TextStyle,
  small: { size: 7, color: INK.muted } as TextStyle,
  label: { size: 6, weight: 'medium', color: INK.subtle, tracking: 0.09 } as TextStyle,
  th: { size: 6, weight: 'medium', color: INK.muted, tracking: 0.06 } as TextStyle,
  td: { size: 7.75 } as TextStyle,
  section: { size: 10.5, weight: 'semibold' } as TextStyle,
  sectionNo: { size: 10.5, color: INK.faint } as TextStyle,
  title: { size: 30, family: 'serif' } as TextStyle,
}

export const RULE = '#dddbd6'
export const RULE_LIGHT = '#ecebe8'

export interface Cell {
  text: string
  style?: TextStyle
  /** A status dot drawn before the text. */
  dot?: string
}

export interface Column {
  title: string
  width: number
  align?: 'left' | 'right'
}

export interface FooterInfo {
  left: string
  centre: string
}

const lineH = (style: TextStyle) => style.size * PT * 1.42

/** Right-aligned columns hold numbers: set them with tabular figures so they align. */
const cellStyle = (cell: Cell, col: Column): TextStyle => ({
  ...(cell.style ?? STYLE.td),
  ...(col.align === 'right' ? { tabular: true } : {}),
})

export class Flow {
  readonly canvases: Canvas[] = []
  c!: Canvas
  y = 0
  readonly margin = { top: 16, right: 18, bottom: 18, left: 18 }
  private sectionNo = 0

  constructor(
    readonly doc: PDFDocument,
    readonly fonts: PdfFonts,
    readonly ts: Typesetter,
    readonly paper: readonly [number, number],
    readonly running: string,
  ) {}

  get width(): number {
    return this.paper[0] - this.margin.left - this.margin.right
  }

  get left(): number {
    return this.margin.left
  }

  get bottom(): number {
    return this.paper[1] - this.margin.bottom - 6
  }

  newPage(header = true): Canvas {
    const page = this.doc.addPage([this.paper[0] * (72 / 25.4), this.paper[1] * (72 / 25.4)])
    this.c = new Canvas(this.doc, page, this.fonts, this.ts)
    this.canvases.push(this.c)
    this.y = this.margin.top
    if (header) {
      this.c.text(this.left, this.y + 2.2, this.running.toUpperCase(), STYLE.label)
      this.c.line(this.left, this.y + 4.5, this.left + this.width, this.y + 4.5, RULE, 0.35)
      this.y += 11
    }
    return this.c
  }

  /** Starts a new page when fewer than `h` mm remain. */
  ensure(h: number) {
    if (this.y + h > this.bottom) this.newPage()
  }

  space(h: number) {
    this.y += h
  }

  section(title: string, minContent = 18) {
    this.ensure(12 + minContent)
    if (this.y > this.margin.top + 12) this.y += 3
    this.sectionNo++
    const no = String(this.sectionNo).padStart(2, '0')
    this.c.text(this.left, this.y + 3.6, no, STYLE.sectionNo)
    this.c.text(this.left + 9, this.y + 3.6, title, STYLE.section)
    this.c.line(this.left, this.y + 6.2, this.left + this.width, this.y + 6.2, INK.fg, 0.4)
    this.y += 9.5
  }

  /** Label/value rows in `cols` columns; values wrap within their column. */
  kv(rows: readonly [string, string][], cols = 2, labelW = 30) {
    const gap = 8
    const colW = (this.width - gap * (cols - 1)) / cols
    for (let i = 0; i < rows.length; i += cols) {
      const slice = rows.slice(i, i + cols)
      const wrapped = slice.map(([, v]) => this.c.wrap(v, STYLE.body, colW - labelW))
      const h = Math.max(...wrapped.map((w) => w.length)) * lineH(STYLE.body) + 2.4
      this.ensure(h)
      slice.forEach(([label, _], k) => {
        const x = this.left + k * (colW + gap)
        this.c.text(x, this.y + 3.1, label.toUpperCase(), STYLE.label)
        wrapped[k]!.forEach((line, j) => {
          this.c.text(x + labelW, this.y + 3.2 + j * lineH(STYLE.body), line, STYLE.body)
        })
        this.c.line(x, this.y + h, x + colW, this.y + h, RULE_LIGHT, 0.3)
      })
      this.y += h
    }
    this.y += 1.5
  }

  paragraph(text: string, style: TextStyle = STYLE.body, indent = 0) {
    for (const line of this.c.wrap(text, style, this.width - indent)) {
      this.ensure(lineH(style))
      this.c.text(this.left + indent, this.y + 3, line, style)
      this.y += lineH(style)
    }
    this.y += 1
  }

  bullets(items: readonly string[], style: TextStyle = STYLE.body) {
    for (const item of items) {
      const lines = this.c.wrap(item, style, this.width - 5)
      this.ensure(lines.length * lineH(style))
      this.c.circle(this.left + 1.2, this.y + 2.15, 0.45, { fill: INK.subtle })
      lines.forEach((line, i) => {
        this.c.text(this.left + 4.5, this.y + 3 + i * lineH(style), line, style)
      })
      this.y += lines.length * lineH(style) + 0.6
    }
    this.y += 1
  }

  table(columns: readonly Column[], rows: readonly Cell[][], opts: { footnote?: string } = {}) {
    const total = columns.reduce((t, c) => t + c.width, 0)
    const k = this.width / total
    const widths = columns.map((c) => c.width * k)
    const pad = 1.6
    const header = () => {
      let x = this.left
      columns.forEach((c, i) => {
        const w = widths[i]!
        this.c.text(
          c.align === 'right' ? x + w - pad : x + (i ? pad : 0),
          this.y + 3,
          c.title.toUpperCase(),
          STYLE.th,
          c.align === 'right' ? 'end' : 'start',
        )
        x += w
      })
      this.c.line(this.left, this.y + 5, this.left + this.width, this.y + 5, RULE, 0.4)
      this.y += 5.4
    }
    this.ensure(14)
    header()
    for (const row of rows) {
      const lines = row.map((cell, i) => {
        const style = cellStyle(cell, columns[i]!)
        return this.c.wrap(cell.text, style, widths[i]! - 2 * pad - (cell.dot ? 2.6 : 0))
      })
      const h =
        Math.max(...lines.map((l, i) => l.length * lineH(cellStyle(row[i]!, columns[i]!)))) + 2.6
      if (this.y + h > this.bottom) {
        this.newPage()
        header()
      }
      let x = this.left
      row.forEach((cell, i) => {
        const w = widths[i]!
        const style = cellStyle(cell, columns[i]!)
        const right = columns[i]!.align === 'right'
        let tx = right ? x + w - pad : x + (i ? pad : 0)
        if (cell.dot) {
          this.c.circle(tx + 0.9, this.y + 2.75, 0.9, { fill: cell.dot })
          tx += 2.6
        }
        lines[i]!.forEach((line, j) => {
          this.c.text(tx, this.y + 3.5 + j * lineH(style), line, style, right ? 'end' : 'start')
        })
        x += w
      })
      this.y += h
      this.c.line(this.left, this.y, this.left + this.width, this.y, RULE_LIGHT, 0.3)
    }
    this.y += 2
    if (opts.footnote) this.paragraph(opts.footnote, STYLE.small)
  }

  /** Footers on every page, once the page count is known. */
  footers(info: FooterInfo) {
    const n = this.canvases.length
    this.canvases.forEach((c, i) => {
      const y = this.paper[1] - this.margin.bottom + 4
      c.line(this.left, y - 4.2, this.left + this.width, y - 4.2, RULE, 0.35)
      c.text(this.left, y, info.left, STYLE.small)
      c.text(this.left + this.width / 2, y, info.centre, STYLE.small, 'middle')
      c.text(this.left + this.width, y, `Page ${i + 1} of ${n}`, STYLE.small, 'end')
    })
  }
}

export async function createPdf(title: string, author: string, date: Date): Promise<PDFDocument> {
  const doc = await PDFDocument.create({ updateMetadata: false })
  doc.setTitle(title)
  doc.setAuthor(author)
  doc.setCreator('Pavé')
  doc.setProducer('@pave/production')
  doc.setCreationDate(date)
  doc.setModificationDate(date)
  return doc
}
