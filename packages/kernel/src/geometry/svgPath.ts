/**
 * SVG path data → exact curve segments (lines and cubic Béziers), for profiles that become
 * B-rep edges. Quadratics are degree-elevated and elliptical arcs converted to cubics (≤ 90°
 * each), so every path command is supported without flattening anything.
 */
import type { Vec2 } from './vec'

export type PathSegment = { type: 'line'; points: [Vec2, Vec2] } | { type: 'cubic'; points: [Vec2, Vec2, Vec2, Vec2] }

export interface SubPath {
  segments: PathSegment[]
  closed: boolean
}

const ARGUMENTS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }

/** Endpoint-parameterised elliptical arc → cubic Béziers (SVG 1.1 implementation notes, F.6). */
function arcToCubics(from: Vec2, rx: number, ry: number, rotation: number, large: boolean, sweep: boolean, to: Vec2): PathSegment[] {
  if (rx === 0 || ry === 0) return [{ type: 'line', points: [from, to] }]
  const phi = (rotation * Math.PI) / 180
  const c = Math.cos(phi)
  const s = Math.sin(phi)
  const dx = (from[0] - to[0]) / 2
  const dy = (from[1] - to[1]) / 2
  const x1 = c * dx + s * dy
  const y1 = -s * dx + c * dy
  let a = Math.abs(rx)
  let b = Math.abs(ry)
  const lambda = (x1 * x1) / (a * a) + (y1 * y1) / (b * b)
  if (lambda > 1) {
    a *= Math.sqrt(lambda)
    b *= Math.sqrt(lambda)
  }
  const sign = large === sweep ? -1 : 1
  const k = sign * Math.sqrt(Math.max(0, (a * a * b * b - a * a * y1 * y1 - b * b * x1 * x1) / (a * a * y1 * y1 + b * b * x1 * x1)))
  const cx1 = (k * a * y1) / b
  const cy1 = (-k * b * x1) / a
  const cx = c * cx1 - s * cy1 + (from[0] + to[0]) / 2
  const cy = s * cx1 + c * cy1 + (from[1] + to[1]) / 2
  const start = Math.atan2((y1 - cy1) / b, (x1 - cx1) / a)
  let delta = Math.atan2((-y1 - cy1) / b, (-x1 - cx1) / a) - start
  if (sweep && delta < 0) delta += 2 * Math.PI
  if (!sweep && delta > 0) delta -= 2 * Math.PI
  const pieces = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9))
  const point = (t: number): Vec2 => [cx + a * Math.cos(t) * c - b * Math.sin(t) * s, cy + a * Math.cos(t) * s + b * Math.sin(t) * c]
  const tangent = (t: number): Vec2 => [-a * Math.sin(t) * c - b * Math.cos(t) * s, -a * Math.sin(t) * s + b * Math.cos(t) * c]
  const out: PathSegment[] = []
  for (let i = 0; i < pieces; i++) {
    const t0 = start + (delta * i) / pieces
    const t1 = start + (delta * (i + 1)) / pieces
    const h = (4 / 3) * Math.tan((t1 - t0) / 4)
    const p0 = i === 0 ? from : point(t0)
    const p3 = i === pieces - 1 ? to : point(t1)
    const d0 = tangent(t0)
    const d1 = tangent(t1)
    out.push({ type: 'cubic', points: [p0, [p0[0] + d0[0] * h, p0[1] + d0[1] * h], [p3[0] - d1[0] * h, p3[1] - d1[1] * h], p3] })
  }
  return out
}

/** Parses SVG path data. Throws on malformed input. */
export function parsePathData(d: string): SubPath[] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []
  const paths: SubPath[] = []
  let current: SubPath | null = null
  let at: Vec2 = [0, 0]
  let start: Vec2 = [0, 0]
  let lastControl: Vec2 | null = null
  let lastType = ''
  let i = 0
  let command = ''
  const number = (): number => {
    const v = Number(tokens[i++])
    if (!Number.isFinite(v)) throw new Error(`the path is malformed near “${tokens[i - 1] ?? 'its end'}”`)
    return v
  }
  const push = (segment: PathSegment) => {
    current ??= { segments: [], closed: false }
    const [a, b] = [segment.points[0], segment.points[segment.points.length - 1]!]
    // Zero-length segments carry no geometry and would make degenerate edges.
    if (segment.type === 'line' && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) return
    current.segments.push(segment)
  }
  const finish = () => {
    if (current && current.segments.length > 0) paths.push(current)
    current = null
  }
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i]!)) command = tokens[i++]!
    else if (!command) throw new Error('the path must start with a move command')
    const upper = command.toUpperCase()
    const relative = command !== upper
    if (!(upper in ARGUMENTS)) throw new Error(`“${command}” is not a path command`)
    const point = (): Vec2 => {
      const x = number()
      const y = number()
      return relative ? [at[0] + x, at[1] + y] : [x, y]
    }
    const reflected = (types: string): Vec2 =>
      lastControl && types.includes(lastType) ? [2 * at[0] - lastControl[0], 2 * at[1] - lastControl[1]] : at
    let control: Vec2 | null = null
    switch (upper) {
      case 'M':
        finish()
        at = start = point()
        // Further coordinate pairs after a move are implicit line-tos.
        command = relative ? 'l' : 'L'
        break
      case 'L': {
        const to = point()
        push({ type: 'line', points: [at, to] })
        at = to
        break
      }
      case 'H':
      case 'V': {
        const v = number()
        const to: Vec2 = upper === 'H' ? [relative ? at[0] + v : v, at[1]] : [at[0], relative ? at[1] + v : v]
        push({ type: 'line', points: [at, to] })
        at = to
        break
      }
      case 'C':
      case 'S': {
        const c1 = upper === 'C' ? point() : reflected('CS')
        const c2 = point()
        const to = point()
        push({ type: 'cubic', points: [at, c1, c2, to] })
        control = c2
        at = to
        break
      }
      case 'Q':
      case 'T': {
        const q = upper === 'Q' ? point() : reflected('QT')
        const to = point()
        // Degree elevation: the same curve as a cubic.
        push({
          type: 'cubic',
          points: [at, [at[0] + (2 / 3) * (q[0] - at[0]), at[1] + (2 / 3) * (q[1] - at[1])], [to[0] + (2 / 3) * (q[0] - to[0]), to[1] + (2 / 3) * (q[1] - to[1])], to],
        })
        control = q
        at = to
        break
      }
      case 'A': {
        const rx = number()
        const ry = number()
        const rotation = number()
        const large = number() !== 0
        const sweep = number() !== 0
        const to = point()
        for (const segment of arcToCubics(at, rx, ry, rotation, large, sweep, to)) push(segment)
        at = to
        break
      }
      case 'Z':
        if (current) {
          push({ type: 'line', points: [at, start] })
          ;(current as SubPath).closed = true
        }
        finish()
        at = start
        break
    }
    lastControl = control
    lastType = upper
  }
  finish()
  return paths
}
