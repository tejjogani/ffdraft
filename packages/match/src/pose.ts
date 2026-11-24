/**
 * Finding a photo's camera for a given build. Span and shift come straight from the mask's area
 * and centroid (`alignCamera`); orientation is searched coarse to fine; distance keeps its prior,
 * because fitting it from one photo was measured to make depth-like sizes worse (plan §7), and
 * other distances are tried only when the best overlap is under the floor.
 *
 * Rendering is synchronous; every search loop goes through a `Guard`, which checks the signal and
 * the deadline before each render and yields to the event loop every few tens of milliseconds.
 */
import type { Evaluation } from '@pave/kernel/types'
import { defaultCamera } from './camera'
import { type Guard, NO_GUARD } from './guard'
import { moments } from './mask'
import { rasterize } from './raster'
import { mulberry32 } from './rng'
import { FIT_FLOOR, scoreView } from './score'
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
async function compass(
  e: Evaluation,
  start: Camera,
  t: Prepared,
  steps: CameraSteps,
  minAngle: number,
  aligned: boolean,
  hide: string[],
  stats: Stats | undefined,
  guard: Guard,
  diagonal = true,
): Promise<{ camera: Camera; score: ViewScore }> {
  const evalAt = async (c: Camera) => {
    await guard.tick()
    const cam = aligned ? alignCamera(e, c, t, hide, stats) : c
    return { camera: cam, score: scoreAt(e, cam, t, hide, stats) }
  }
  let cur = await evalAt(start)
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
        const r = await evalAt(c)
        if (r.score.loss < cur.score.loss - 1e-9) {
          cur = r
          any = true
          moves++
          break
        }
      }
    }
    if (!any && diagonal && dims.length > 1) {
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
          const r = await evalAt(c)
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
      const r = await evalAt(extrapolate(before, cur.camera))
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
    guard?: Guard
    /** Seeded diagonal tries before each halving (default true). */
    diagonal?: boolean
  } = {},
): Promise<{ camera: Camera; score: ViewScore }> {
  const base = o.steps ?? FIT_CAMERA_STEPS
  const steps: CameraSteps = {
    ...base,
    ...(t.view.spanMm !== undefined ? { logSpan: 0 } : {}),
    logDistance: o.fitDistance ? (base.logDistance ?? 0.05) : 0,
  }
  // Default: one level only.
  return compass(
    e,
    c,
    t,
    steps,
    o.minAngle ?? steps.angle * 0.6,
    false,
    o.hide ?? [],
    o.stats,
    o.guard ?? NO_GUARD,
    o.diagonal ?? true,
  )
}

/** Coarse elevations, tried first. */
const ELEVATIONS = [5, 25, 45, 65, 88]
/**
 * Tried only when the first pass finds nothing at the floor: views from below (a ring seen from
 * under its band, a pendant from under its bail are not mirror images of the views from above)
 * and every direction with its roll turned to the photo's principal axis (a rotated photo).
 */
const LOW_ELEVATIONS = [-88, -55, -25]
/**
 * Raw overlap under which the second pass runs even when the loose floor is met: a wrong pose of
 * a small piece can still sit within the outline tolerance (a pendant turned 90° measured 0.83).
 */
const SECOND_PASS_IOU = 0.9
/** A mask whose principal axes differ by less than this is treated as round: no roll turn. */
const ROUND = 0.12
/** Distance ratios tried locally from the best camera; kept only with a clear gain. */
const OTHER_DISTANCES = [3.5, 30]
/** A different distance must lower the loss by this factor to replace the prior. */
const DISTANCE_GAIN = 0.75
/** Raw overlap at or above which the distance prior is not questioned. */
const DISTANCE_CHECK_IOU = 0.95

/**
 * Principal axis of a mask, in degrees counter-clockwise from the image x axis with y up (the
 * sense of `Camera.roll`), and its elongation: 0 for a disc, 1 for a line.
 */
export function principalAxis(mask: Uint8Array, size: Size): { angle: number; elongation: number } {
  const { width: w, height: h } = size
  let a = 0
  let sx = 0
  let sy = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        a++
        sx += x
        sy += y
      }
  if (!a) return { angle: 0, elongation: 0 }
  const mx = sx / a
  const my = sy / a
  let xx = 0
  let yy = 0
  let xy = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        const dx = x - mx
        const dy = my - y // y up
        xx += dx * dx
        yy += dy * dy
        xy += dx * dy
      }
  const angle = (0.5 * Math.atan2(2 * xy, xx - yy) * 180) / Math.PI
  const elongation = Math.hypot(xx - yy, 2 * xy) / Math.max(1e-12, xx + yy)
  return { angle, elongation }
}

/**
 * From scratch, at 96 px: azimuths every 30° at five elevations, each aligned (a seed and its ±30°
 * first); the best three are refined on orientation (15° halving to 1.5°), then polished at full
 * size on orientation, span and shift (3° halving to 0.3°). If the best is under the floor (or its
 * raw overlap under 0.9), a second pass adds views from below and, for an elongated target, every direction with its roll
 * turned to line the render's principal axis up with the photo's, both ways. When the
 * raw overlap is still under 0.95, a closer and a farther distance are polished from that camera
 * and replace the prior only if they cut the loss by a quarter. `found` is false when the best
 * loose overlap is under `FIT_FLOOR.looseIou`.
 */
export async function searchPose(
  e: Evaluation,
  t: Prepared,
  o: { distanceRatio?: number; hide?: string[]; stats?: Stats; guard?: Guard } = {},
): Promise<{ camera: Camera; score: ViewScore; found: boolean }> {
  const hide = o.hide ?? []
  const stats = o.stats
  const guard = o.guard ?? NO_GUARD
  const small = t.small ?? t
  const smallSize = sizeOf(small)
  const base = defaultCamera(e, 'front', { distanceRatio: o.distanceRatio ?? 10, hide })
  const seen = new Set<string>()
  const cands: { i: number; camera: Camera; loss: number }[] = []
  const add = async (cam: Camera) => {
    const a = ((((cam.azimuth + 180) % 360) + 360) % 360) - 180
    const key = `${a.toFixed(3)},${cam.elevation.toFixed(3)},${cam.roll.toFixed(1)}`
    if (cam.elevation > 90 || cam.elevation < -90 || seen.has(key)) return
    seen.add(key)
    await guard.tick()
    const c = alignCamera(e, { ...cam, azimuth: a }, small, hide, stats)
    cands.push({ i: cands.length, camera: c, loss: scoreAt(e, c, small, hide, stats).loss })
  }
  const refineTop = async (from: typeof cands) => {
    const out: { camera: Camera; score: ViewScore }[] = []
    for (const c of from
      .slice()
      .sort((a, b) => a.loss - b.loss || a.i - b.i)
      .slice(0, 3))
      out.push(
        await compass(
          e,
          c.camera,
          small,
          { angle: 15, logSpan: 0, shift: 0 },
          1.5,
          true,
          hide,
          stats,
          guard,
        ),
      )
    return out.sort((a, b) => a.score.loss - b.score.loss)
  }

  const s = t.view.seed
  if (s) {
    await add({ ...base, azimuth: s.azimuth, elevation: s.elevation })
    for (const da of [-30, -15, 0, 15, 30])
      for (const de of [-30, -15, 0, 15, 30])
        await add({ ...base, azimuth: s.azimuth + da, elevation: s.elevation + de })
  }
  for (const el of ELEVATIONS)
    for (let az = -180; az < 180; az += el >= 80 ? 90 : 30)
      await add({ ...base, azimuth: az, elevation: el })
  const polishTop = async (top: { camera: Camera; score: ViewScore }[]) => {
    let best: { camera: Camera; score: ViewScore } | null = null
    for (const c of top.slice(0, 3)) {
      const fine = await compass(
        e,
        c.camera,
        t,
        { angle: 3, logSpan: t.view.spanMm !== undefined ? 0 : 0.03, shift: 0.015 },
        0.3,
        false,
        hide,
        stats,
        guard,
      )
      if (!best || fine.score.loss < best.score.loss) best = fine
    }
    return best!
  }
  let best = await polishTop(await refineTop(cands))

  if (!(best.score.looseIou >= FIT_FLOOR.looseIou) || best.score.iou < SECOND_PASS_IOU) {
    // Second pass: from below, and turned to the photo's principal axis.
    const first = cands.length
    for (const el of LOW_ELEVATIONS)
      for (let az = -180; az < 180; az += el <= -80 ? 90 : 30)
        await add({ ...base, azimuth: az, elevation: el })
    const target = principalAxis(small.view.matte, smallSize)
    if (target.elongation >= ROUND)
      for (const c of cands.slice(0, cands.length)) {
        const r = rasterize(e, c.camera, smallSize, { hide, ...(stats ? { stats } : {}) })
        const mine = principalAxis(r.cls, smallSize)
        if (mine.elongation < ROUND) continue
        for (const turn of [0, 180]) {
          const roll = wrap(c.camera.roll + target.angle - mine.angle + turn)
          if (Math.abs(wrap(roll - c.camera.roll)) >= 10) await add({ ...c.camera, roll })
        }
      }
    const second = await polishTop(await refineTop(cands.slice(first)))
    if (second.score.loss < best.score.loss) best = second
  }

  if (o.distanceRatio === undefined && best.score.iou < DISTANCE_CHECK_IOU) {
    // `span` is measured at the target's depth, so the scale stays put while perspective changes.
    const diag = base.distance / 10
    let alt: typeof best | null = null
    for (const ratio of OTHER_DISTANCES) {
      const r = await compass(
        e,
        { ...best.camera, distance: diag * ratio },
        t,
        { angle: 3, logSpan: t.view.spanMm !== undefined ? 0 : 0.03, shift: 0.015 },
        0.3,
        false,
        hide,
        stats,
        guard,
      )
      if (!alt || r.score.loss < alt.score.loss) alt = r
    }
    if (alt && alt.score.loss < DISTANCE_GAIN * best.score.loss) best = alt
  }
  return { ...best, found: best.score.looseIou >= FIT_FLOOR.looseIou }
}

/** Degrees into (−180, 180]. */
const wrap = (a: number) => {
  const x = ((((a + 180) % 360) + 360) % 360) - 180
  return x === -180 ? 180 : x
}
