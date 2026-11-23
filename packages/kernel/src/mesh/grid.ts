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

/** Dense cell arrays are capped at this many cells; the cell grows to fit. */
const MAX_DENSE_CELLS = 1 << 22

/**
 * The same queries over a fixed point set, with cells in flat arrays instead of a hash map.
 * Several times faster for large radii (which visit many mostly empty cells), so it carries
 * the dense surface samples behind pavé.
 */
export class StaticPointGrid {
  private readonly cell: number
  private readonly origin: [number, number, number]
  private readonly dims: [number, number, number]
  private readonly start: Uint32Array
  private readonly items: Uint32Array

  constructor(
    private readonly xyz: Float64Array,
    cell: number,
  ) {
    const count = xyz.length / 3
    const lo: [number, number, number] = [Infinity, Infinity, Infinity]
    const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < count; i++)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, xyz[i * 3 + k]!)
        hi[k] = Math.max(hi[k]!, xyz[i * 3 + k]!)
      }
    if (count === 0) lo.fill(0), hi.fill(0)
    let size = cell
    const cellsFor = (s: number) => [0, 1, 2].reduce((n, k) => n * (Math.floor((hi[k]! - lo[k]!) / s) + 1), 1)
    while (cellsFor(size) > MAX_DENSE_CELLS) size *= 1.5
    this.cell = size
    this.origin = lo
    this.dims = [0, 1, 2].map((k) => Math.floor((hi[k]! - lo[k]!) / size) + 1) as [number, number, number]
    const cells = this.dims[0] * this.dims[1] * this.dims[2]
    const of = new Uint32Array(count)
    this.start = new Uint32Array(cells + 1)
    for (let i = 0; i < count; i++) {
      of[i] = this.cellOf(xyz[i * 3]!, xyz[i * 3 + 1]!, xyz[i * 3 + 2]!)
      this.start[of[i]! + 1]!++
    }
    for (let c = 0; c < cells; c++) this.start[c + 1]! += this.start[c]!
    const fill = this.start.slice(0, cells)
    this.items = new Uint32Array(count)
    for (let i = 0; i < count; i++) this.items[fill[of[i]!]!++] = i
  }

  private index(v: number, k: number): number {
    return Math.min(this.dims[k]! - 1, Math.max(0, Math.floor((v - this.origin[k]!) / this.cell)))
  }

  private cellOf(x: number, y: number, z: number): number {
    return (this.index(z, 2) * this.dims[1] + this.index(y, 1)) * this.dims[0] + this.index(x, 0)
  }

  /** Calls `visit(index, distanceSquared)` for every point within `radius` of (x, y, z). */
  near(x: number, y: number, z: number, radius: number, visit: (index: number, d2: number) => void): void {
    const r2 = radius * radius
    const [nx, ny] = this.dims
    const x0 = this.index(x - radius, 0)
    const x1 = this.index(x + radius, 0)
    const y0 = this.index(y - radius, 1)
    const y1 = this.index(y + radius, 1)
    const z0 = this.index(z - radius, 2)
    const z1 = this.index(z + radius, 2)
    const p = this.xyz
    for (let k = z0; k <= z1; k++)
      for (let j = y0; j <= y1; j++) {
        const row = (k * ny + j) * nx
        for (let c = row + x0; c <= row + x1; c++)
          for (let s = this.start[c]!; s < this.start[c + 1]!; s++) {
            const index = this.items[s]!
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
}
