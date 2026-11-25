/**
 * The sketch pad's drawing, as data: strokes of a pen or an eraser on a square sheet, with Clear
 * kept in the history so Undo brings a cleared sketch back. Pure (the canvas drawing takes any
 * 2D context), so the rules are unit-tested; SketchPad.tsx only turns pointers into strokes.
 */

/** The sheet's side in pixels; the saved picture is this size, whatever the screen shows. */
export const SKETCH_PX = 1024

export type SketchTool = 'pen' | 'eraser'

export interface Stroke {
  tool: SketchTool
  /** Line width in sheet pixels. */
  size: number
  /** Points in sheet pixels. */
  points: [number, number][]
}

/** One thing done to the sheet: a stroke, or clearing it. */
export type SketchEntry = Stroke | { clear: true }

export const PEN_SIZES = { fine: 4, medium: 9, bold: 18 } as const
export const ERASER_SIZE = 36

const isClear = (e: SketchEntry): e is { clear: true } => 'clear' in e

/** The strokes on the sheet now: those after the last Clear. */
export function visibleStrokes(entries: readonly SketchEntry[]): Stroke[] {
  const at = entries.findLastIndex(isClear)
  return entries.slice(at + 1).filter((e): e is Stroke => !isClear(e))
}

/** Nothing drawn (an eraser alone draws nothing worth saving). */
export const isBlank = (entries: readonly SketchEntry[]): boolean =>
  !visibleStrokes(entries).some((s) => s.tool === 'pen')

export const addStroke = (entries: readonly SketchEntry[], s: Stroke): SketchEntry[] =>
  s.points.length ? [...entries, s] : [...entries]

/** Clearing a blank sheet records nothing, so Undo is never spent on it. */
export const clearSketch = (entries: readonly SketchEntry[]): SketchEntry[] =>
  visibleStrokes(entries).length ? [...entries, { clear: true }] : [...entries]

export const undoSketch = (entries: readonly SketchEntry[]): SketchEntry[] => entries.slice(0, -1)

/** A pointer at (x, y) on an element of this size, in sheet pixels, kept on the sheet. */
export function toSheet(x: number, y: number, width: number, height: number): [number, number] {
  const k = (v: number, d: number) => Math.min(SKETCH_PX, Math.max(0, (v / d) * SKETCH_PX))
  return [Math.round(k(x, width) * 10) / 10, Math.round(k(y, height) * 10) / 10]
}

/** The ink: dark grey on white, the way a pencil sketch reads over a model as an image plane. */
export const INK = '#2b2a28'
export const PAPER = '#ffffff'

/** Minimal 2D context the drawing needs (a canvas's, or a test double). */
export interface Ink {
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  lineCap: CanvasLineCap
  lineJoin: CanvasLineJoin
  fillRect(x: number, y: number, w: number, h: number): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  stroke(): void
  arc(x: number, y: number, r: number, a0: number, a1: number): void
  fill(): void
}

/**
 * Draws the sheet. The paper is white and the eraser paints paper, so the saved PNG is what the
 * person saw, also once it is laid in a view or read by the assistant.
 */
export function drawSketch(ctx: Ink, entries: readonly SketchEntry[], px = SKETCH_PX): void {
  const k = px / SKETCH_PX
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, px, px)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const s of visibleStrokes(entries)) {
    const colour = s.tool === 'pen' ? INK : PAPER
    const [first, ...rest] = s.points
    if (!first) continue
    if (!rest.length) {
      // A tap leaves a dot.
      ctx.fillStyle = colour
      ctx.beginPath()
      ctx.arc(first[0] * k, first[1] * k, (s.size * k) / 2, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    ctx.strokeStyle = colour
    ctx.lineWidth = s.size * k
    ctx.beginPath()
    ctx.moveTo(first[0] * k, first[1] * k)
    for (const [x, y] of rest) ctx.lineTo(x * k, y * k)
    ctx.stroke()
  }
}
