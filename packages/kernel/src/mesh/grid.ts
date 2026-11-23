/**
 * A uniform hash grid over points for fixed-radius neighbour queries — the neighbourhood
 * structure behind surface sampling, field smoothing and stone packing. Points can be added at
 * any time; queries visit every point within a radius exactly once.
 */

/** Cells per axis stay below 2^17 so the packed key is an exact integer (< 2^51). */
const SPAN = 131072
const HALF = SPAN / 2

export class PointGrid {
  private readonly cells = new Map<number, number[]>()
  private xyz = new Float64Array(3 * 64)
  private count = 0

  constructor(private readonly cell: number) {
    if (!(cell > 0)) throw new Error('PointGrid cell size must be positive')
  }

  get size(): number {
    return this.count
  }

  /** Adds a point and returns its index (indices are assigned 0, 1, 2, … in insertion order). */
  add(x: number, y: number, z: number): number {
    if (this.count * 3 + 3 > this.xyz.length) {
      const grown = new Float64Array(this.xyz.length * 2)
      grown.set(this.xyz)
      this.xyz = grown
    }
    const index = this.count++
    this.xyz[index * 3] = x
    this.xyz[index * 3 + 1] = y
    this.xyz[index * 3 + 2] = z
    const key = this.key(this.coord(x), this.coord(y), this.coord(z))
    const bucket = this.cells.get(key)
    if (bucket) bucket.push(index)
    else this.cells.set(key, [index])
    return index
  }

  /** Calls `visit(index, distanceSquared)` for every point within `radius` of (x, y, z). */
  near(x: number, y: number, z: number, radius: number, visit: (index: number, d2: number) => void): void {
    const r2 = radius * radius
    const x0 = this.coord(x - radius)
    const x1 = this.coord(x + radius)
    const y0 = this.coord(y - radius)
    const y1 = this.coord(y + radius)
    const z0 = this.coord(z - radius)
    const z1 = this.coord(z + radius)
    const p = this.xyz
    for (let i = x0; i <= x1; i++)
      for (let j = y0; j <= y1; j++)
        for (let k = z0; k <= z1; k++) {
          const bucket = this.cells.get(this.key(i, j, k))
          if (!bucket) continue
          for (const index of bucket) {
            const dx = p[index * 3]! - x
            const dy = p[index * 3 + 1]! - y
            const dz = p[index * 3 + 2]! - z
            const d2 = dx * dx + dy * dy + dz * dz
            if (d2 <= r2) visit(index, d2)
          }
        }
  }

  /** Index of the closest point within `radius`, or -1. */
  nearest(x: number, y: number, z: number, radius: number): number {
    let best = -1
    let bestD2 = Infinity
    this.near(x, y, z, radius, (index, d2) => {
      if (d2 < bestD2 || (d2 === bestD2 && index < best)) {
        best = index
        bestD2 = d2
      }
    })
    return best
  }

  private coord(v: number): number {
    return Math.floor(v / this.cell)
  }

  private key(i: number, j: number, k: number): number {
    return ((i + HALF) * SPAN + (j + HALF)) * SPAN + (k + HALF)
  }
}
