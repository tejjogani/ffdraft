/**
 * Exact distance to a 2D outline (a set of closed contours) and inside tests, accelerated by a
 * uniform grid of edges. Drives the profiles of outline bodies (height as a function of the
 * distance to the edge), relief rims, and pavé margins inside a published field.
 */
import type { Contour } from './svgPath'

export class OutlineDistance {
  private readonly ax: Float64Array
  private readonly ay: Float64Array
  private readonly bx: Float64Array
  private readonly by: Float64Array
  private readonly cells = new Map<number, number[]>()
  /** Edges by horizontal band, for crossing-number inside tests. */
  private readonly rows = new Map<number, number[]>()
  private readonly cell: number
  private readonly x0: number
  private readonly y0: number
  private readonly columns: number
  private readonly rowCount: number

  constructor(contours: readonly Contour[]) {
    const edges: number[] = []
    for (const c of contours)
      for (let i = 0; i < c.length; i++) {
        const a = c[i]!
        const b = c[(i + 1) % c.length]!
        if (a[0] !== b[0] || a[1] !== b[1]) edges.push(a[0], a[1], b[0], b[1])
      }
    const n = edges.length / 4
    if (n === 0) throw new Error('The outline is empty')
    this.ax = new Float64Array(n)
    this.ay = new Float64Array(n)
    this.bx = new Float64Array(n)
    this.by = new Float64Array(n)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let e = 0; e < n; e++) {
      this.ax[e] = edges[e * 4]!
      this.ay[e] = edges[e * 4 + 1]!
      this.bx[e] = edges[e * 4 + 2]!
      this.by[e] = edges[e * 4 + 3]!
      minX = Math.min(minX, this.ax[e]!, this.bx[e]!)
      maxX = Math.max(maxX, this.ax[e]!, this.bx[e]!)
      minY = Math.min(minY, this.ay[e]!, this.by[e]!)
      maxY = Math.max(maxY, this.ay[e]!, this.by[e]!)
    }
    // About two edges per occupied cell.
    const span = Math.max(maxX - minX, maxY - minY, 1e-9)
    this.cell = Math.max(span / Math.max(4, Math.sqrt(n) * 2), span / 2048)
    this.x0 = minX
    this.y0 = minY
    this.columns = Math.ceil((maxX - minX) / this.cell) + 1
    this.rowCount = Math.ceil((maxY - minY) / this.cell) + 1
    for (let e = 0; e < n; e++) {
      const i0 = this.col(Math.min(this.ax[e]!, this.bx[e]!))
      const i1 = this.col(Math.max(this.ax[e]!, this.bx[e]!))
      const j0 = this.row(Math.min(this.ay[e]!, this.by[e]!))
      const j1 = this.row(Math.max(this.ay[e]!, this.by[e]!))
      for (let j = j0; j <= j1; j++) {
        push(this.rows, j, e)
        for (let i = i0; i <= i1; i++) push(this.cells, j * this.columns + i, e)
      }
    }
  }

  private col(x: number): number {
    return Math.floor((x - this.x0) / this.cell)
  }

  private row(y: number): number {
    return Math.floor((y - this.y0) / this.cell)
  }

  /** Unsigned distance from (x, y) to the nearest outline edge, or `cap` if that is nearer. */
  distance(x: number, y: number, cap = Infinity): number {
    const ci = this.col(x)
    const cj = this.row(y)
    let best = cap
    const seen = new Set<number>()
    for (let ring = 0; ; ring++) {
      // Every edge closer than `(ring − 1) · cell` has been seen by now.
      if (best <= (ring - 1) * this.cell) break
      if (ring > this.columns + this.rowCount + 2) break
      for (let j = cj - ring; j <= cj + ring; j++)
        for (let i = ci - ring; i <= ci + ring; i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== ring) continue
          if (i < 0 || i >= this.columns) continue
          const list = this.cells.get(j * this.columns + i)
          if (!list) continue
          for (const e of list) {
            if (seen.has(e)) continue
            seen.add(e)
            best = Math.min(best, this.edgeDistance(e, x, y))
          }
        }
    }
    return best
  }

  /** Even-odd inside test (union outlines have no overlaps, so even-odd equals non-zero). */
  inside(x: number, y: number): boolean {
    const list = this.rows.get(this.row(y))
    if (!list) return false
    let inside = false
    for (const e of list) {
      const ay = this.ay[e]!
      const by = this.by[e]!
      if (ay > y === by > y) continue
      const t = (y - ay) / (by - ay)
      if (this.ax[e]! + t * (this.bx[e]! - this.ax[e]!) > x) inside = !inside
    }
    return inside
  }

  /** Positive inside, negative outside. */
  signed(x: number, y: number): number {
    const d = this.distance(x, y)
    return this.inside(x, y) ? d : -d
  }

  private edgeDistance(e: number, x: number, y: number): number {
    const ax = this.ax[e]!
    const ay = this.ay[e]!
    const dx = this.bx[e]! - ax
    const dy = this.by[e]! - ay
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0
    return Math.hypot(x - ax - t * dx, y - ay - t * dy)
  }
}

function push(map: Map<number, number[]>, key: number, value: number): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}
