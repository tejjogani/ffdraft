/**
 * Finding a photo's camera for a given build. Span and shift come straight from the mask's area
 * and centroid (`alignCamera`); orientation is searched coarse to fine; distance keeps its prior,
 * because fitting it from one photo was measured to make depth-like sizes worse (plan §7).
 */
import type { Evaluation } from '@pave/kernel/types'
import { defaultCamera } from './camera'
import { moments } from './mask'
import { rasterize } from './raster'
import { mulberry32 } from './rng'
import { scoreView } from './score'
import type { Camera, CameraSteps, Prepared, Size, Stats, ViewScore } from './types'

const ALIGN_PX = 64

export function sizeOf(t: Prepared): Size {
  return { width: t.view.width, height: t.view.height }
}

function scaled(t: Prepared, side: number): Size {
  const k = side / Math.max(t.view.width, t.view.height)
  return {
    width: Math.max(1, Math.round(t.view.width * k)),
    height: Math.max(1, Math.round(t.view.height * k)),
  }
}

const copy = (c: Camera): Camera => ({
  ...c,
  shift: [c.shift[0], c.shift[1]],
  target: [...c.target],
})

/**
 * Three rounds at 64 px: scale `span` by √(render area / target area), then move `shift` by the
 * centroid difference. `distance` is untouched; a span fixed by a reference object is held.
 */
export function alignCamera(
  e: Evaluation,
  c: Camera,
  t: Prepared,
  hide: string[] = [],
  stats?: Stats,
): Camera {
  const size = scaled(t, ALIGN_PX)
  const n = Math.max(size.width, size.height)
  const hold = t.view.spanMm !== undefined
  const cam = copy(c)
  if (hold) cam.span = t.view.spanMm!
  const tm = t.moments
  if (!tm.area) return cam
  for (let round = 0; round < 3; round++) {
    const m = moments(rasterize(e, cam, size, { hide, ...(stats ? { stats } : {}) }).cls, size)
    if (!m.area) {
      // Nothing in frame: recentre and zoom out.
      cam.shift = [0, 0]
      if (!hold) cam.span *= 1.5
      continue
    }
    if (!hold) cam.span *= Math.sqrt(m.area / tm.area)
    const m2 = moments(rasterize(e, cam, size, { hide, ...(stats ? { stats } : {}) }).cls, size)
    if (!m2.area) continue
    cam.shift = [
      cam.shift[0] + ((tm.cx - m2.cx) * size.width) / n,
      cam.shift[1] + ((tm.cy - m2.cy) * size.height) / n,
    ]
  }
  return cam
}

function scoreAt(e: Evaluation, c: Camera, t: Prepared, hide: string[], stats?: Stats): ViewScore {
  return scoreView(rasterize(e, c, sizeOf(t), { hide, ...(stats ? { stats } : {}) }), t, c)
}

type Dim = 'azimuth' | 'elevation' | 'roll' | 'span' | 'shiftX' | 'shiftY' | 'distance'

function moved(c: Camera, dim: Dim, d: number): Camera | null {
  const n = copy(c)
  switch (dim) {
    case 'azimuth':
      n.azimuth += d
      break
    case 'elevation':
      n.elevation += d
      if (n.elevation > 90 || n.elevation < -90) return null
      break
    case 'roll':
      n.roll += d
      break
    case 'span':
      n.span *= Math.exp(d)
      break
    case 'shiftX':
      n.shift[0] += d
      break
    case 'shiftY':
      n.shift[1] += d
      break
    case 'distance':
      n.distance *= Math.exp(d)
      break
  }
  return n
}

/**
 * Compass search: try +step then −step on each term, take the first that lowers the loss, and
 * halve every step when a full pass finds none, until the angle step is at most `minAngle`.
 */
function compass(
  e: Evaluation,
  start: Camera,
  t: Prepared,
  steps: CameraSteps,
  minAngle: number,
  aligned: boolean,
  hide: string[],
  stats?: Stats,
): { camera: Camera; score: ViewScore } {
  const evalAt = (c: Camera) => {
    const cam = aligned ? alignCamera(e, c, t, hide, stats) : c
    return { camera: cam, score: scoreAt(e, cam, t, hide, stats) }
  }
  let cur = evalAt(start)
  const dims: [Dim, number][] = (
    [
      ['azimuth', steps.angle],
      ['elevation', steps.angle],
      ['roll', steps.angle],
      ['span', aligned ? 0 : steps.logSpan],
      ['shiftX', aligned ? 0 : steps.shift],
      ['shiftY', aligned ? 0 : steps.shift],
      ['distance', steps.logDistance ?? 0],
    ] as [Dim, number][]
  ).filter(([, s]) => s > 0)
  let k = 1
  let moves = 0
  const rnd = mulberry32(1)
  while (steps.angle * k > minAngle && moves < 400) {
    let any = false
    const before = cur.camera
    for (const [dim, s] of dims) {
      for (const sgn of [1, -1]) {
        const c = moved(cur.camera, dim, sgn * s * k)
        if (!c) continue
        const r = evalAt(c)
        if (r.score.loss < cur.score.loss - 1e-9) {
          cur = r
          any = true
          moves++
          break
        }
      }
    }
    if (!any && dims.length > 1) {
      // Seeded random directions over all terms at once, before halving: a narrow diagonal
      // valley (azimuth against roll) has no descent along any single axis.
      for (let tries = 0; tries < 2 * dims.length && !any; tries++) {
        const dir = dims.map(() => rnd() * 2 - 1)
        const norm = Math.hypot(...dir)
        for (const sgn of [1, -1]) {
          let c: Camera | null = cur.camera
          for (let d = 0; d < dims.length && c; d++)
            c = moved(c, dims[d]![0], (sgn * dims[d]![1] * k * dir[d]!) / norm)
          if (!c) continue
          const r = evalAt(c)
          if (r.score.loss < cur.score.loss - 1e-9) {
            cur = r
            any = true
            moves++
            break
          }
        }
      }
    }
    if (any) {
      // Pattern move: azimuth, roll and elevation trade against each other, so axis steps alone
      // crawl along the valley; extrapolating the pass's displacement follows it.
      const r = evalAt(extrapolate(before, cur.camera))
      if (r.score.loss < cur.score.loss - 1e-9) cur = r
    } else k /= 2
  }
  return cur
}

function extrapolate(a: Camera, b: Camera): Camera {
  const n = copy(b)
  n.azimuth += b.azimuth - a.azimuth
  n.elevation = Math.max(-90, Math.min(90, b.elevation + (b.elevation - a.elevation)))
  n.roll += b.roll - a.roll
  n.span *= b.span / a.span
  n.distance *= b.distance / a.distance
  n.shift = [2 * b.shift[0] - a.shift[0], 2 * b.shift[1] - a.shift[1]]
  return n
}

/** Steps of the shape fit's camera re-polish: one level of 1°, 1 % span, 0.5 % shift. */
export const FIT_CAMERA_STEPS: CameraSteps = { angle: 1, logSpan: 0.01, shift: 0.005 }

export function refineCamera(
  e: Evaluation,
  c: Camera,
  t: Prepared,
  o: {
    steps?: CameraSteps
    minAngle?: number
    fitDistance?: boolean
    hide?: string[]
    stats?: Stats
  } = {},
): { camera: Camera; score: ViewScore } {
  const base = o.steps ?? FIT_CAMERA_STEPS
  const steps: CameraSteps = {
    ...base,
    ...(t.view.spanMm !== undefined ? { logSpan: 0 } : {}),
    logDistance: o.fitDistance ? (base.logDistance ?? 0.05) : 0,
  }
  // Default: one level only.
  return compass(e, c, t, steps, o.minAngle ?? steps.angle * 0.6, false, o.hide ?? [], o.stats)
}

const ELEVATIONS = [5, 25, 45, 65, 88]

/**
 * From scratch: 12 azimuths × 5 elevations at 96 px, each aligned (a seed and its ±30° first);
 * the best three refined on orientation (15° halving to 1.5°), then polished at full size on
 * orientation, span and shift (3° halving to 0.3°).
 */
export function searchPose(
  e: Evaluation,
  t: Prepared,
  o: { distanceRatio?: number; hide?: string[]; stats?: Stats } = {},
): { camera: Camera; score: ViewScore } {
  const hide = o.hide ?? []
  const small = t.small ?? t
  const base = defaultCamera(e, 'front', { distanceRatio: o.distanceRatio ?? 10, hide })
  const dirs: [number, number][] = []
  const seen = new Set<string>()
  const push = (az: number, el: number) => {
    if (el > 90 || el < -90) return
    const a = ((((az + 180) % 360) + 360) % 360) - 180
    const key = `${a.toFixed(3)},${el.toFixed(3)}`
    if (seen.has(key)) return
    seen.add(key)
    dirs.push([a, el])
  }
  const s = t.view.seed
  if (s) {
    push(s.azimuth, s.elevation)
    for (const da of [-30, -15, 0, 15, 30])
      for (const de of [-30, -15, 0, 15, 30]) push(s.azimuth + da, s.elevation + de)
  }
  for (const el of ELEVATIONS) for (let az = -180; az < 180; az += 30) push(az, el)
  const cands = dirs.map(([azimuth, elevation], i) => {
    const cam = alignCamera(e, { ...base, azimuth, elevation }, small, hide, o.stats)
    return { i, camera: cam, loss: scoreAt(e, cam, small, hide, o.stats).loss }
  })
  cands.sort((a, b) => a.loss - b.loss || a.i - b.i)
  let best: { camera: Camera; score: ViewScore } | null = null
  for (const c of cands.slice(0, 3)) {
    const coarse = compass(
      e,
      c.camera,
      small,
      { angle: 15, logSpan: 0, shift: 0 },
      1.5,
      true,
      hide,
      o.stats,
    )
    const fine = compass(
      e,
      coarse.camera,
      t,
      { angle: 3, logSpan: t.view.spanMm !== undefined ? 0 : 0.03, shift: 0.015 },
      0.3,
      false,
      hide,
      o.stats,
    )
    if (!best || fine.score.loss < best.score.loss) best = fine
  }
  return best!
}
