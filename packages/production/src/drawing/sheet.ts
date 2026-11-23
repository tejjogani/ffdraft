/**
 * Drawing sheets: the general arrangement (all views at one scale, third-angle placement, title
 * block) used on the spec sheet and as drawings/sheet.svg, and one sheet per view for
 * drawings/{front,top,side,section,iso}.svg.
 */
import type { Evaluation } from '@pave/kernel/types'
import type { PieceFacts } from '../facts'
import type { Units } from '../format'
import { layoutView, type ViewLayout } from './annotate'
import { type Annotation, extractAnnotations } from './dimensions'
import { hiddenLines, type SceneBody, type ViewLines } from './hlr'
import { INK, type Item, type MeasureText, type Sheet, type TextStyle } from './model'
import { sceneBodies } from './scene'
import { sliceBodies } from './section'
import { VIEWS, type ViewId } from './views'

const HIDDEN_LINE_STONE_LIMIT = 24

export const VIEW_ORDER: readonly ViewId[] = ['front', 'side', 'top', 'section', 'iso']

export interface DrawingSet {
  views: Partial<Record<ViewId, ViewLines>>
  loops: Float32Array[]
  annotations: Annotation[]
  /** Milliseconds spent per view, for the manifest and performance tests. */
  timings: Partial<Record<ViewId, number>>
}

export interface DrawingOptions {
  units: Units
  stampLocation: string
  resolution?: number
}

export function buildDrawingSet(
  evaluation: Evaluation,
  facts: PieceFacts,
  opts: DrawingOptions,
): DrawingSet {
  const bodies: SceneBody[] = sceneBodies(evaluation)
  const views: Partial<Record<ViewId, ViewLines>> = {}
  const timings: Partial<Record<ViewId, number>> = {}
  const res = opts.resolution ?? 2048
  let loops: Float32Array[] = []
  // Hidden lines only on the principal orthographic views, and only while they stay legible:
  // behind a pavé field they would be hundreds of dashed seats.
  const showHidden = evaluation.stones.length <= HIDDEN_LINE_STONE_LIMIT
  for (const id of VIEW_ORDER) {
    const t0 = performance.now()
    if (id === 'section') {
      const cut = sliceBodies(bodies, VIEWS.section)
      if (cut.loops.length === 0) continue
      loops = cut.loops
      views.section = hiddenLines(bodies, VIEWS.section, { resolution: res, extra: cut.world })
    } else {
      views[id] = hiddenLines(bodies, VIEWS[id], {
        resolution: res,
        hidden: id !== 'iso' && showHidden,
      })
    }
    timings[id] = performance.now() - t0
  }
  const annotations = extractAnnotations({
    facts,
    evaluation,
    views,
    units: opts.units,
    stampLocation: opts.stampLocation,
  })
  return { views, loops, annotations, timings }
}

export interface TitleInfo {
  org: string
  title: string
  subtitle: string
  sku: string
  revision: string
  date: string
  author: string
  material: string
  units: Units
}

/** ISO 5455 enlargement scales plus the in-between ratios jewellers use on A4. */
const SCALES = [10, 5, 4, 3, 2.5, 2, 1.5, 1, 0.5] as const
const GAP = 9
const TITLE_H = 21
const LABEL: TextStyle = { size: 6, weight: 'medium', color: INK.muted, tracking: 0.08 }

export const scaleLabel = (s: number) =>
  s >= 1 ? `${Number(s.toFixed(2))}:1` : `1:${Number((1 / s).toFixed(2))}`

interface Placed {
  layout: ViewLayout
  dx: number
  dy: number
  /** Baseline of the view label, shared along a row. */
  labelY: number
}

/** Lays out the general arrangement inside a frame; returns the sheet and the scale chosen. */
export function composeArrangement(
  set: DrawingSet,
  measure: MeasureText,
  frame: { width: number; height: number },
  title: TitleInfo,
): { sheet: Sheet; scale: number } {
  const avail = { width: frame.width, height: frame.height - TITLE_H - 16 }
  // Largest scale that fits; the isometric shrinks, then drops out (it is also the cover
  // pictorial) before the orthographic views give up a scale step.
  let best: ReturnType<typeof arrange> | null = null
  for (const s of SCALES) {
    for (const isoScale of [s, s * 0.6, 0]) {
      const r = arrange(set, measure, s, isoScale, avail.width)
      best = r
      if (r.w <= avail.width && r.h <= avail.height) break
    }
    if (best && best.w <= avail.width && best.h <= avail.height) break
  }
  const { placed, scale, isoScale, w } = best!
  const ox = (frame.width - w) / 2
  const items: Item[] = []
  for (const p of placed) {
    items.push(...translate(p.layout.items, p.dx + ox, p.dy + 4))
    const own = p.layout.id === 'iso' && isoScale !== scale ? isoScale : null
    items.push(viewLabel(p, labelFor(p.layout.id, own), ox, 4))
  }
  items.push(...titleBlock(title, scale, frame.width, frame.height - TITLE_H, measure))
  return { sheet: { width: frame.width, height: frame.height, items }, scale }
}

function arrange(set: DrawingSet, measure: MeasureText, s: number, isoScale: number, maxW: number) {
  const lay = (id: ViewId, scale = s): ViewLayout | null =>
    set.views[id]
      ? layoutView({
          id,
          lines: set.views[id]!,
          annotations: set.annotations,
          scale,
          measure,
          ...(id === 'section' ? { loops: set.loops } : {}),
        })
      : null
  const front = lay('front')!
  const side = lay('side')
  const top = lay('top')
  const extras = [lay('section'), isoScale > 0 ? lay('iso', isoScale) : null].filter(
    (v): v is ViewLayout => !!v,
  )
  // Every assignment of the free views (section, iso) to the top, middle or a third row; the
  // shortest arrangement that fits the width wins.
  let best: ReturnType<typeof rows> | null = null
  for (let code = 0; code < 3 ** extras.length; code++) {
    const rowOf = extras.map((_, i) => Math.floor(code / 3 ** i) % 3)
    const r = rows(front, side, top, extras, rowOf)
    if (r.w > maxW && best) continue
    if (!best || (r.w <= maxW && (best.w > maxW || r.h < best.h))) best = r
  }
  return { ...best!, scale: s, isoScale }
}

type Cell = { layout: ViewLayout; x: number }

function rows(
  front: ViewLayout,
  side: ViewLayout | null,
  top: ViewLayout | null,
  extras: ViewLayout[],
  rowOf: number[],
) {
  const LABEL_H = 7
  // Column 1 shares the model x-origin between top and front (projection alignment).
  const colL = Math.max(-front.box.minX, top ? -top.box.minX : 0)
  const colR = Math.max(front.box.maxX, top ? top.box.maxX : 0)
  const grid: Cell[][] = [top ? [{ layout: top, x: colL }] : [], [{ layout: front, x: colL }], []]
  const width = [top ? colL + colR : 0, colL + colR, 0]
  const append = (r: number, v: ViewLayout) => {
    const gap = width[r]! > 0 ? GAP : 0
    grid[r]!.push({ layout: v, x: width[r]! + gap - v.box.minX })
    width[r]! += gap + v.box.maxX - v.box.minX
  }
  if (side) append(1, side)
  extras.forEach((v, i) => {
    append(rowOf[i]!, v)
  })
  // The third row has no projection ties: centre it.
  const shift = (Math.max(...width) - width[2]!) / 2
  for (const c of grid[2]!) c.x += shift
  // Rows align on the model origin, so front and side share heights (projection alignment).
  const placed: Placed[] = []
  let y = 0
  for (const row of grid) {
    if (!row.length) continue
    const topY = Math.min(...row.map((c) => c.layout.box.minY))
    const bottom = Math.max(...row.map((c) => c.layout.box.maxY))
    for (const c of row)
      placed.push({ layout: c.layout, dx: c.x, dy: y - topY, labelY: y + bottom - topY + 5 })
    y += bottom - topY + LABEL_H + GAP
  }
  return { placed, w: Math.max(...width), h: y - GAP }
}

const labelFor = (id: ViewId, ownScale: number | null) =>
  `${VIEWS[id].title}${ownScale ? ` · ${scaleLabel(ownScale)}` : ''}`

function viewLabel(p: Placed, label: string, ox: number, oy: number): Item {
  const g = p.layout.geometry
  const text = label.toUpperCase()
  const x = p.dx + ox + (g.minX + g.maxX) / 2
  const y = p.labelY + oy
  return { t: 'text', x, y, text, style: LABEL, anchor: 'middle' }
}

export function translate(items: readonly Item[], dx: number, dy: number): Item[] {
  return items.map((it) => {
    switch (it.t) {
      case 'lines':
        return {
          ...it,
          lines: it.lines.map((pl) => {
            const out = new Float32Array(pl.length)
            for (let i = 0; i < pl.length; i += 2) {
              out[i] = pl[i]! + dx
              out[i + 1] = pl[i + 1]! + dy
            }
            return out
          }),
        }
      case 'fill':
        return { ...it, pts: it.pts.map((v, i) => v + (i % 2 ? dy : dx)) }
      case 'circle':
        return { ...it, cx: it.cx + dx, cy: it.cy + dy }
      default:
        return { ...it, x: it.x + dx, y: it.y + dy }
    }
  })
}

/** One view on its own sheet with a compact title block. */
export function composeViewSheet(
  set: DrawingSet,
  id: ViewId,
  scale: number,
  measure: MeasureText,
  title: TitleInfo,
): Sheet | null {
  const lines = set.views[id]
  if (!lines) return null
  const layout = layoutView({
    id,
    lines,
    annotations: set.annotations,
    scale,
    measure,
    ...(id === 'section' ? { loops: set.loops } : {}),
  })
  const b = layout.box
  const margin = 14
  const width = Math.max(b.maxX - b.minX + 2 * margin, 190)
  const contentH = b.maxY - b.minY + 2 * margin + 8
  const height = contentH + TITLE_H + 8
  const dx = (width - (b.maxX - b.minX)) / 2 - b.minX
  const dy = margin - b.minY
  const items = translate(layout.items, dx, dy)
  items.push(viewLabel({ layout, dx, dy, labelY: dy + b.maxY + 5 }, labelFor(id, null), 0, 0))
  items.push(...translate(titleBlock(title, scale, width - 16, contentH, measure), 8, 0))
  return { width, height, items }
}

/** Title block: identity, revision, scale, units, projection and the shrinkage declaration. */
function titleBlock(
  t: TitleInfo,
  scale: number,
  width: number,
  y: number,
  measure: MeasureText,
): Item[] {
  const items: Item[] = []
  const h = TITLE_H
  items.push({ t: 'rect', x: 0, y, w: width, h, pen: 'frame' })
  const row = 12
  items.push({ t: 'lines', pen: 'dim', lines: [[0, y + row, width, y + row]] })
  const col = (fr: number) => fr * width
  const cells: {
    x0: number
    x1: number
    y0: number
    label: string
    value: string
    style?: TextStyle
  }[] = [
    {
      x0: 0,
      x1: col(0.44),
      y0: y,
      label: t.subtitle,
      value: t.title,
      style: { size: 13, family: 'serif' },
    },
    { x0: col(0.44), x1: col(0.62), y0: y, label: 'SKU', value: t.sku },
    { x0: col(0.62), x1: col(0.7), y0: y, label: 'Rev', value: t.revision },
    { x0: col(0.7), x1: col(0.84), y0: y, label: 'Date', value: t.date },
    { x0: col(0.84), x1: width, y0: y, label: 'Scale', value: scaleLabel(scale) },
    { x0: 0, x1: col(0.44), y0: y + row, label: 'Drawn', value: `${t.author} · ${t.org}` },
    { x0: col(0.44), x1: col(0.7), y0: y + row, label: 'Material', value: t.material },
    {
      x0: col(0.7),
      x1: col(0.84),
      y0: y + row,
      label: 'Units',
      value: t.units === 'mm' ? 'mm' : 'in [mm]',
    },
    { x0: col(0.84), x1: width, y0: y + row, label: 'Projection', value: '' },
  ]
  for (const c of cells) {
    if (c.x0 > 0)
      items.push({
        t: 'lines',
        pen: 'dim',
        lines: [[c.x0, c.y0, c.x0, c.y0 + (c.y0 === y ? row : h - row)]],
      })
    const tall = c.y0 === y
    items.push({
      t: 'text',
      x: c.x0 + 2,
      y: c.y0 + 3.4,
      text: c.label.toUpperCase(),
      style: { size: 4.75, color: INK.subtle, weight: 'medium', tracking: 0.08 },
    })
    const style = c.style ?? { size: tall ? 8.5 : 6.5 }
    const maxW = c.x1 - c.x0 - 4
    items.push({
      t: 'text',
      x: c.x0 + 2,
      y: c.y0 + (tall ? 9.6 : 7.4),
      text: fit(c.value, style, maxW, measure),
      style,
    })
  }
  items.push(...projectionSymbol(col(0.84) + 13, y + row + 5.9))
  // Scale bar and the shrinkage statement sit just above the block.
  items.push(...scaleBar(scale, 1, y - 4))
  items.push({
    t: 'text',
    x: width,
    y: y - 3,
    text: 'Nominal geometry — not shrink-compensated. Do not scale drawing.',
    style: { size: 5.5, color: INK.muted },
    anchor: 'end',
  })
  return items
}

function fit(text: string, style: TextStyle, maxW: number, measure: MeasureText): string {
  if (measure(text, style) <= maxW) return text
  let t = text
  while (t.length > 1 && measure(`${t}…`, style) > maxW) t = t.slice(0, -1)
  return `${t}…`
}

/** Alternating bar: whole millimetres of model length, labelled at the ends. */
function scaleBar(scale: number, x: number, y: number): Item[] {
  const targetPaper = 24
  const steps = [1, 2, 5, 10, 20, 50]
  const len = steps.find((v) => v * scale >= targetPaper) ?? 50
  const seg = len <= 5 ? 1 : len / 5
  const items: Item[] = []
  const h = 1.1
  for (let i = 0; i * seg < len; i++) {
    items.push({
      t: 'rect',
      x: x + i * seg * scale,
      y: y - h,
      w: seg * scale,
      h,
      pen: 'dim',
      ...(i % 2 === 0 ? { fill: INK.fg } : { fill: INK.paper }),
    })
  }
  const lab: TextStyle = { size: 5, color: INK.muted }
  items.push({ t: 'text', x, y: y - h - 1, text: '0', style: lab, anchor: 'middle' })
  items.push({
    t: 'text',
    x: x + len * scale,
    y: y - h - 1,
    text: `${len} mm`,
    style: lab,
    anchor: 'middle',
  })
  return items
}

/** ISO 5456-2 third-angle symbol: frustum elevation on the left, end view circles on the right. */
function projectionSymbol(cx: number, cy: number): Item[] {
  const h = 4.4
  const items: Item[] = []
  const x0 = cx - 9
  items.push({
    t: 'lines',
    pen: 'dim',
    closed: true,
    lines: [[x0, cy - h / 2, x0 + 5.5, cy - h / 4, x0 + 5.5, cy + h / 4, x0, cy + h / 2]],
  })
  items.push({
    t: 'lines',
    pen: 'center',
    lines: [
      [x0 - 1, cy, x0 + 6.5, cy],
      [cx - 1.2, cy, cx + 3.6 + 1.2, cy],
    ],
  })
  items.push({ t: 'circle', cx: cx + 1.2, cy, r: h / 2, pen: 'dim' })
  items.push({ t: 'circle', cx: cx + 1.2, cy, r: h / 4, pen: 'dim' })
  return items
}

/** One view without annotations, scaled to fit a box: the pictorial on the spec sheet cover. */
export function fitView(
  set: DrawingSet,
  id: ViewId,
  width: number,
  height: number,
  measure: MeasureText,
): Sheet | null {
  const lines = set.views[id]
  if (!lines) return null
  const b = lines.bounds
  const scale = Math.min(width / (b.maxX - b.minX), height / (b.maxY - b.minY))
  const layout = layoutView({ id, lines, annotations: [], scale, measure })
  const g = layout.geometry
  const items = translate(
    layout.items,
    (width - (g.maxX - g.minX)) / 2 - g.minX,
    (height - (g.maxY - g.minY)) / 2 - g.minY,
  )
  return { width, height, items }
}
