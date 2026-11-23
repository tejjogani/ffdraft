/**
 * SVG path data → closed polygons. Implements the full SVG 1.1 path grammar: absolute and
 * relative M L H V C S Q T A Z, implicit repeated commands, compact numbers ("1.5.5", "1e-3")
 * and unseparated arc flags ("a1 1 0 00 1 1"). Curves are flattened to within `tolerance`
 * (path units). Every subpath is returned closed, as SVG fills them. Coordinates are returned
 * as written (SVG's y axis points down; callers flip as needed).
 */

export type Point = [number, number]
export type Contour = Point[]

const COMMANDS = 'MmLlHhVvCcSsQqTtAaZz'

class Scanner {
  at = 0
  constructor(private readonly s: string) {}

  private skipSeparators(): void {
    while (this.at < this.s.length && /[\s,]/.test(this.s[this.at]!)) this.at++
  }

  /** The next command letter, or null when a number follows (an implicit repeat). */
  command(): string | null {
    this.skipSeparators()
    const c = this.s[this.at]
    if (c !== undefined && COMMANDS.includes(c)) {
      this.at++
      return c
    }
    return null
  }

  done(): boolean {
    this.skipSeparators()
    return this.at >= this.s.length
  }

  number(): number {
    this.skipSeparators()
    const match = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(this.s.slice(this.at, this.at + 64))
    if (!match) throw new Error(`Path data: expected a number at position ${this.at}`)
    this.at += match[0].length
    return Number(match[0])
  }

  flag(): boolean {
    this.skipSeparators()
    const c = this.s[this.at]
    if (c !== '0' && c !== '1') throw new Error(`Path data: expected an arc flag (0 or 1) at position ${this.at}`)
    this.at++
    return c === '1'
  }
}

/** Parses and flattens path data into closed contours (degenerate ones are dropped). */
export function parseSvgPath(d: string, tolerance: number): Contour[] {
  const scan = new Scanner(d)
  const contours: Contour[] = []
  let contour: Contour = []
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  // Reflection points for S and T.
  let lastCubic: Point | null = null
  let lastQuad: Point | null = null
  let command: string | null = null

  const finish = () => {
    if (contour.length >= 3) contours.push(contour)
    contour = []
  }
  const lineTo = (nx: number, ny: number) => {
    if (contour.length === 0) contour.push([x, y])
    contour.push([nx, ny])
    x = nx
    y = ny
  }

  while (!scan.done()) {
    const explicit = scan.command()
    if (explicit) command = explicit
    else if (!command || command === 'z' || command === 'Z')
      throw new Error('Path data must start with a move command (M)')
    const c = command!
    const lower = c.toLowerCase()
    const rel = c !== c.toUpperCase()
    const ox = rel ? x : 0
    const oy = rel ? y : 0
    let cubic: Point | null = null
    let quad: Point | null = null
    switch (lower) {
      case 'm': {
        finish()
        x = scan.number() + ox
        y = scan.number() + oy
        startX = x
        startY = y
        contour.push([x, y])
        // Further coordinate pairs after a move are line segments.
        command = rel ? 'l' : 'L'
        break
      }
      case 'l':
        lineTo(scan.number() + ox, scan.number() + oy)
        break
      case 'h':
        lineTo(scan.number() + ox, y)
        break
      case 'v':
        lineTo(x, scan.number() + oy)
        break
      case 'c':
      case 's': {
        const p1: Point =
          lower === 'c'
            ? [scan.number() + ox, scan.number() + oy]
            : lastCubic
              ? [2 * x - lastCubic[0], 2 * y - lastCubic[1]]
              : [x, y]
        const p2: Point = [scan.number() + ox, scan.number() + oy]
        const p3: Point = [scan.number() + ox, scan.number() + oy]
        flattenCubic([x, y], p1, p2, p3, tolerance, lineTo)
        cubic = p2
        break
      }
      case 'q':
      case 't': {
        const p1: Point =
          lower === 'q'
            ? [scan.number() + ox, scan.number() + oy]
            : lastQuad
              ? [2 * x - lastQuad[0], 2 * y - lastQuad[1]]
              : [x, y]
        const p2: Point = [scan.number() + ox, scan.number() + oy]
        flattenQuadratic([x, y], p1, p2, tolerance, lineTo)
        quad = p1
        break
      }
      case 'a': {
        const rx = Math.abs(scan.number())
        const ry = Math.abs(scan.number())
        const rotation = scan.number()
        const large = scan.flag()
        const sweep = scan.flag()
        const ex = scan.number() + ox
        const ey = scan.number() + oy
        flattenArc([x, y], rx, ry, rotation, large, sweep, [ex, ey], tolerance, lineTo)
        break
      }
      case 'z':
        if (contour.length > 0) {
          x = startX
          y = startY
        }
        finish()
        break
    }
    lastCubic = cubic
    lastQuad = quad
  }
  finish()
  return contours.map(dedupe).filter((c) => c.length >= 3)
}

/** Removes consecutive duplicates and a repeated closing point. */
function dedupe(contour: Contour): Contour {
  const out: Contour = []
  for (const p of contour) {
    const last = out.at(-1)
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
  }
  const first = out[0]
  const last = out.at(-1)
  if (out.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) out.pop()
  return out
}

// Uniform subdivision with the classic second-difference bound: the chord error of n equal
// steps of a polynomial curve is at most max|B''| / (8 n²).
function flattenCubic(p0: Point, p1: Point, p2: Point, p3: Point, tol: number, emit: (x: number, y: number) => void): void {
  const m = Math.max(
    Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]),
    Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1]),
  )
  const n = Math.min(512, Math.max(1, Math.ceil(Math.sqrt((0.75 * m) / tol))))
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    const a = u * u * u
    const b = 3 * u * u * t
    const c = 3 * u * t * t
    const d = t * t * t
    emit(a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1])
  }
}

function flattenQuadratic(p0: Point, p1: Point, p2: Point, tol: number, emit: (x: number, y: number) => void): void {
  const m = Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1])
  const n = Math.min(512, Math.max(1, Math.ceil(Math.sqrt(m / (4 * tol)))))
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    emit(u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1])
  }
}

/** Elliptical arc via the endpoint → centre conversion of SVG 1.1 §F.6.5–F.6.6. */
function flattenArc(
  p0: Point,
  rxIn: number,
  ryIn: number,
  rotationDeg: number,
  large: boolean,
  sweep: boolean,
  p1: Point,
  tol: number,
  emit: (x: number, y: number) => void,
): void {
  if (p0[0] === p1[0] && p0[1] === p1[1]) return
  if (rxIn === 0 || ryIn === 0) {
    emit(p1[0], p1[1])
    return
  }
  const phi = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (p0[0] - p1[0]) / 2
  const dy = (p0[1] - p1[1]) / 2
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  let rx = rxIn
  let ry = ryIn
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den))
  const cx1 = (k * rx * y1) / ry
  const cy1 = (-k * ry * x1) / rx
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2
  const cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const theta = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
  if (!sweep && delta > 0) delta -= 2 * Math.PI
  if (sweep && delta < 0) delta += 2 * Math.PI
  const r = Math.max(rx, ry)
  const step = 2 * Math.acos(Math.max(-1, 1 - tol / r))
  const n = Math.min(1024, Math.max(2, Math.ceil(Math.abs(delta) / Math.max(step, 1e-3))))
  for (let i = 1; i < n; i++) {
    const t = theta + (delta * i) / n
    const ex = rx * Math.cos(t)
    const ey = ry * Math.sin(t)
    emit(cos * ex - sin * ey + cx, sin * ex + cos * ey + cy)
  }
  emit(p1[0], p1[1])
}
