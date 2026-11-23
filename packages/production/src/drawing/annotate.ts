/**
 * Lays out one view at a given scale: geometry lines, section hatching and the drafting
 * graphics for its annotations (ISO 129-1 style dimensions: extension lines with a small gap
 * and overshoot, filled arrowheads, text above the dimension line; leader notes with a
 * horizontal shoulder). Output is in paper millimetres relative to the model origin, y down.
 */
import type { Annotation, P2, Side } from './dimensions'
import type { Box2, ViewLines } from './hlr'
import { capHeight, type Item, type MeasureText, PT, type TextStyle } from './model'
import { hatch } from './polyline'
import type { ViewId } from './views'

export interface ViewLayout {
  id: ViewId
  items: Item[]
  /** Geometry only. */
  geometry: Box2
  /** Geometry plus every annotation. */
  box: Box2
}

const DIM_TEXT: TextStyle = { size: 6.5, tabular: true }
const CAPTION: TextStyle = { size: 5, color: '#65635f' }
const NOTE: TextStyle = { size: 6 }
const NOTE_SUB: TextStyle = { size: 5.25, color: '#65635f' }
const BADGE: TextStyle = { size: 5.5, weight: 'semibold' }

const FIRST_TIER = 7
const TIER = 5.5
const GAP = 0.8
const OVERSHOOT = 1.2
const ARROW = 1.6
const ARROW_HALF = 0.3
const BADGE_R = 1.9
const NOTE_LINE = 2.6

export interface LayoutInput {
  id: ViewId
  lines: ViewLines
  annotations: readonly Annotation[]
  scale: number
  measure: MeasureText
  /** Section loops in view mm, hatched at 45°. */
  loops?: readonly Float32Array[]
  /** Annotations and boxes only: for trying scales without projecting every line. */
  annotationsOnly?: boolean
}

export function layoutView(input: LayoutInput): ViewLayout {
  const { scale: s, measure } = input
  const P = (x: number, y: number): P2 => [x * s, -y * s]
  const toPaper = (pl: ArrayLike<number>) => {
    const out = new Float32Array(pl.length)
    for (let i = 0; i < pl.length; i += 2) {
      out[i] = pl[i]! * s
      out[i + 1] = -pl[i + 1]! * s
    }
    return out
  }
  const b = input.lines.bounds
  const geometry: Box2 = {
    minX: b.minX * s,
    maxX: b.maxX * s,
    minY: -b.maxY * s,
    maxY: -b.minY * s,
  }
  const items: Item[] = []

  if (input.loops?.length && !input.annotationsOnly) {
    const paperLoops = input.loops.map(toPaper)
    const h = hatch(paperLoops, 0.7, 45)
    const segs: Float32Array[] = []
    for (let i = 0; i < h.length; i += 4) segs.push(h.subarray(i, i + 4))
    items.push({ t: 'lines', pen: 'hatch', lines: segs })
  }
  const anns = input.annotations.filter((a) => a.view === input.id)
  for (const a of anns) {
    if (a.kind === 'centerline')
      items.push({ t: 'lines', pen: 'center', lines: [[...P(...a.a), ...P(...a.b)]] })
  }
  if (!input.annotationsOnly) {
    if (input.lines.hidden.length)
      items.push({ t: 'lines', pen: 'hidden', lines: input.lines.hidden.map(toPaper) })
    items.push({ t: 'lines', pen: 'stone', lines: input.lines.stones.map(toPaper) })
    items.push({ t: 'lines', pen: 'outline', lines: input.lines.metal.map(toPaper) })
  }

  const box: Box2 = { ...geometry }
  const grow = (x: number, y: number) => {
    box.minX = Math.min(box.minX, x)
    box.maxX = Math.max(box.maxX, x)
    box.minY = Math.min(box.minY, y)
    box.maxY = Math.max(box.maxY, y)
  }
  const growText = (
    x: number,
    y: number,
    w: number,
    size: number,
    anchor: 'start' | 'middle' | 'end',
  ) => {
    const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2
    grow(x0, y - capHeight(size))
    grow(x0 + w, y + size * PT * 0.25)
  }

  for (const a of anns) if (a.kind === 'cutline') cutline(a.x * s, geometry, a.label, items, grow)

  // ── Linear dimensions, stacked in tiers per side so none overlap ──
  const tiers: Record<Side, { lo: number; hi: number }[][]> = {
    below: [],
    above: [],
    left: [],
    right: [],
  }
  const linear = anns
    .filter((a): a is Extract<Annotation, { kind: 'linear' }> => a.kind === 'linear')
    .map((a) => ({ a, pa: P(...a.a), pb: P(...a.b) }))
    .sort((p, q) => span(p) - span(q))
  for (const { a, pa, pb } of linear) {
    const horizontal = a.axis === 'h'
    const lo = Math.min(horizontal ? pa[0] : pa[1], horizontal ? pb[0] : pb[1])
    const hi = Math.max(horizontal ? pa[0] : pa[1], horizontal ? pb[0] : pb[1])
    const textW = measure(a.text, DIM_TEXT)
    const captionW = a.caption ? measure(a.caption, CAPTION) : 0
    const inside = hi - lo >= textW + 2 * ARROW + 1.5
    const mid = (lo + hi) / 2
    const extent = inside
      ? { lo: Math.min(lo - 0.5, mid - captionW / 2), hi: Math.max(hi + 0.5, mid + captionW / 2) }
      : { lo: lo - ARROW - 1, hi: hi + Math.max(textW, captionW) + ARROW + 2 }
    const side = tiers[a.side]
    let tier = side.findIndex((t) => t.every((o) => extent.hi < o.lo || extent.lo > o.hi))
    if (tier < 0) {
      tier = side.length
      side.push([])
    }
    side[tier]!.push(extent)
    const off = FIRST_TIER + tier * TIER
    const at =
      a.side === 'below'
        ? geometry.maxY + off
        : a.side === 'above'
          ? geometry.minY - off
          : a.side === 'right'
            ? geometry.maxX + off
            : geometry.minX - off
    linearDim(items, a, pa, pb, at, lo, hi, inside, textW, captionW, grow, growText)
  }

  // ── Leader notes, in columns left and right of the dimensions ──
  for (const sideName of ['left', 'right'] as const) {
    const notes = anns.filter(
      (a): a is Extract<Annotation, { kind: 'note' }> => a.kind === 'note' && a.side === sideName,
    )
    if (!notes.length) continue
    const dimReach = tiers[sideName].length
      ? FIRST_TIER + (tiers[sideName].length - 1) * TIER + 3
      : 0
    const colX =
      sideName === 'right'
        ? geometry.maxX + Math.max(dimReach, 4) + 3
        : geometry.minX - Math.max(dimReach, 4) - 3
    const placed = notes.map((n) => {
      const anchor = P(...n.anchor)
      const elbow = n.radialFrom
        ? radialElbow(anchor, P(...n.radialFrom), sideName, geometry)
        : null
      return {
        n,
        anchor,
        elbow,
        y: elbow ? elbow[1] : anchor[1],
        h: Math.max(n.lines.length * NOTE_LINE, n.badge ? BADGE_R * 2 + 0.6 : 0),
      }
    })
    // Resolve overlaps: sweep down, then pull back up if the column ran past the lowest anchor.
    placed.sort((p, q) => p.y - q.y)
    for (let i = 1; i < placed.length; i++) {
      const prev = placed[i - 1]!
      const cur = placed[i]!
      cur.y = Math.max(cur.y, prev.y + prev.h / 2 + cur.h / 2 + 1.2)
    }
    for (const p of placed) leaderNote(items, p, colX, sideName, measure, grow, growText)
  }

  return { id: input.id, items, geometry, box }
}

const span = (p: { pa: P2; pb: P2; a: { axis: 'h' | 'v' } }) =>
  p.a.axis === 'h' ? Math.abs(p.pa[0] - p.pb[0]) : Math.abs(p.pa[1] - p.pb[1])

function arrowhead(tip: P2, dx: number, dy: number): Item {
  const l = Math.hypot(dx, dy) || 1
  const ux = dx / l
  const uy = dy / l
  const bx = tip[0] - ux * ARROW
  const by = tip[1] - uy * ARROW
  return {
    t: 'fill',
    color: '#1c1b1a',
    pts: [
      tip[0],
      tip[1],
      bx - uy * ARROW_HALF,
      by + ux * ARROW_HALF,
      bx + uy * ARROW_HALF,
      by - ux * ARROW_HALF,
    ],
  }
}

function linearDim(
  items: Item[],
  a: Extract<Annotation, { kind: 'linear' }>,
  pa: P2,
  pb: P2,
  at: number,
  lo: number,
  hi: number,
  inside: boolean,
  textW: number,
  captionW: number,
  grow: (x: number, y: number) => void,
  growText: (
    x: number,
    y: number,
    w: number,
    size: number,
    anchor: 'start' | 'middle' | 'end',
  ) => void,
) {
  const h = a.axis === 'h'
  const ext: number[][] = []
  for (const p of [pa, pb]) {
    if (h) {
      const dir = Math.sign(at - p[1]) || 1
      ext.push([p[0], p[1] + dir * GAP, p[0], at + dir * OVERSHOOT])
    } else {
      const dir = Math.sign(at - p[0]) || 1
      ext.push([p[0] + dir * GAP, p[1], at + dir * OVERSHOOT, p[1]])
    }
  }
  const lineLo = inside ? lo : lo - ARROW - 1
  const lineHi = inside ? hi : hi + ARROW + 1
  const dimLine = h ? [lineLo, at, lineHi, at] : [at, lineLo, at, lineHi]
  items.push({ t: 'lines', pen: 'dim', lines: [...ext, dimLine] })
  const sgn = inside ? 1 : -1
  if (h) {
    items.push(arrowhead([lo, at], -sgn, 0), arrowhead([hi, at], sgn, 0))
  } else {
    items.push(arrowhead([at, lo], 0, -sgn), arrowhead([at, hi], 0, sgn))
  }
  for (const e of ext) {
    grow(e[0]!, e[1]!)
    grow(e[2]!, e[3]!)
  }
  // Value above the line (horizontal) or left of it reading upward (vertical); the caption
  // mirrors it on the other side of the line, so it never pushes the value outside.
  const capOff = 0.8 + capHeight(CAPTION.size)
  if (h) {
    const y = at - 0.8
    const cx = inside ? (lo + hi) / 2 : hi + ARROW + 1.5 + Math.max(textW, captionW) / 2
    items.push({ t: 'text', x: cx, y, text: a.text, style: DIM_TEXT, anchor: 'middle' })
    growText(cx, y, textW, DIM_TEXT.size, 'middle')
    if (a.caption) {
      items.push({
        t: 'text',
        x: cx,
        y: at + capOff,
        text: a.caption,
        style: CAPTION,
        anchor: 'middle',
      })
      growText(cx, at + capOff, captionW, CAPTION.size, 'middle')
    }
  } else {
    const x = at - 0.8
    const cy = inside ? (lo + hi) / 2 : lo - ARROW - 1.5 - Math.max(textW, captionW) / 2
    items.push({ t: 'text', x, y: cy, text: a.text, style: DIM_TEXT, anchor: 'middle', rotate: 90 })
    grow(x - capHeight(DIM_TEXT.size), cy - textW / 2)
    grow(x, cy + textW / 2)
    if (a.caption) {
      items.push({
        t: 'text',
        x: at + capOff,
        y: cy,
        text: a.caption,
        style: CAPTION,
        anchor: 'middle',
        rotate: 90,
      })
      grow(at + capOff, cy - captionW / 2)
      grow(at + capOff - capHeight(CAPTION.size), cy + captionW / 2)
    }
  }
}

/**
 * The knee of a radial leader: it leaves `anchor` straight away from `centre` until it clears
 * the geometry box, but never more than a short run, then turns horizontal to the text.
 */
function radialElbow(anchor: P2, centre: P2, side: 'left' | 'right', g: Box2): P2 {
  let dx = anchor[0] - centre[0]
  let dy = anchor[1] - centre[1]
  const l = Math.hypot(dx, dy) || 1
  dx /= l
  dy /= l
  const targetX = side === 'left' ? g.minX - 2 : g.maxX + 2
  const reach =
    dx !== 0 && Math.sign(targetX - anchor[0]) === Math.sign(dx) ? (targetX - anchor[0]) / dx : 3
  const t = Math.min(reach, 7)
  return [anchor[0] + dx * t, anchor[1] + dy * t]
}

function leaderNote(
  items: Item[],
  p: {
    n: Extract<Annotation, { kind: 'note' }>
    anchor: P2
    elbow: P2 | null
    y: number
    h: number
  },
  colX: number,
  side: 'left' | 'right',
  measure: MeasureText,
  grow: (x: number, y: number) => void,
  growText: (
    x: number,
    y: number,
    w: number,
    size: number,
    anchor: 'start' | 'middle' | 'end',
  ) => void,
) {
  const dir = side === 'right' ? 1 : -1
  const shoulderEnd: P2 = [colX, p.y]
  const shoulderStart: P2 = [colX - dir * 2.5, p.y]
  const path: number[] = [...p.anchor]
  if (p.elbow) path.push(...p.elbow)
  path.push(...shoulderStart, ...shoulderEnd)
  items.push({ t: 'lines', pen: 'leader', lines: [path] })
  const next: P2 = p.elbow ?? shoulderStart
  if (p.n.head === 'arrow')
    items.push(arrowhead(p.anchor, p.anchor[0] - next[0], p.anchor[1] - next[1]))
  else items.push({ t: 'circle', cx: p.anchor[0], cy: p.anchor[1], r: 0.35, fill: '#1c1b1a' })
  grow(...p.anchor)

  let x = colX + dir * 0.8
  if (p.n.badge) {
    // A circle for one key, a stadium for a range ("S1–S11").
    const half = Math.max(BADGE_R, measure(p.n.badge, BADGE) / 2 + 0.9)
    const cx = x + dir * half
    if (half === BADGE_R)
      items.push({ t: 'circle', cx, cy: p.y, r: BADGE_R, pen: 'leader', fill: '#ffffff' })
    else
      items.push({
        t: 'lines',
        pen: 'leader',
        closed: true,
        lines: [stadium(cx, p.y, half, BADGE_R)],
      })
    items.push({
      t: 'text',
      x: cx,
      y: p.y + capHeight(BADGE.size) / 2,
      text: p.n.badge,
      style: BADGE,
      anchor: 'middle',
    })
    grow(cx - half, p.y - BADGE_R)
    grow(cx + half, p.y + BADGE_R)
    x = cx + dir * (half + 1.2)
  }
  const anchor = side === 'right' ? 'start' : 'end'
  const top = p.y - ((p.n.lines.length - 1) * NOTE_LINE) / 2 + capHeight(NOTE.size) / 2
  p.n.lines.forEach((line, i) => {
    const style = i === 0 ? NOTE : NOTE_SUB
    const y = top + i * NOTE_LINE
    items.push({ t: 'text', x, y, text: line, style, anchor })
    growText(x, y, measure(line, style), style.size, anchor)
  })
}

function stadium(cx: number, cy: number, half: number, r: number): number[] {
  const pts: number[] = []
  const straight = half - r
  for (const [ox, a0] of [
    [straight, -Math.PI / 2],
    [-straight, Math.PI / 2],
  ] as const)
    for (let k = 0; k <= 12; k++) {
      const a = a0 + (k / 12) * Math.PI
      pts.push(cx + ox + r * Math.cos(a), cy + r * Math.sin(a))
    }
  return pts
}

/** Cutting-plane line A–A: chain line with heavy ends and arrows showing the viewing direction. */
function cutline(
  x: number,
  g: Box2,
  label: string,
  items: Item[],
  grow: (x: number, y: number) => void,
) {
  const y0 = g.minY - 3
  const y1 = g.maxY + 3
  items.push({ t: 'lines', pen: 'cut', lines: [[x, y0, x, y1]] })
  for (const y of [y0, y1]) {
    // Section A–A looks toward −X, i.e. to the left on the front view.
    items.push({ t: 'lines', pen: 'frame', lines: [[x, y, x - 3.2, y]] })
    items.push(arrowhead([x - 3.6, y], -1, 0))
    items.push({
      t: 'text',
      x: x - 4.6,
      y: y + capHeight(6.5) / 2,
      text: label,
      style: { size: 6.5, weight: 'semibold' },
      anchor: 'end',
    })
    grow(x - 7, y - 2)
    grow(x + 1, y + 2)
  }
}
