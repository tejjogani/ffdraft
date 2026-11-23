/**
 * Wire link styles. Each style is one or two parametric links (a centreline and a section in
 * link-local space: x along the chain, y across it, z out of the chain's face) and a repeating
 * sequence of orientations. Pitches are not tabulated: they are solved from the geometry
 * (contact.ts), so any width/wire pair the schema allows interlocks without intersecting.
 *
 * Proportions follow docs/research/06-freeform.md §6 where it gives them (Cuban: link length
 * ≈ 1.35·W, pitch ≈ L − 2·wire; figaro: 3 short + 1 long); the rest are typical stock chain.
 */
import { IDENTITY, type Mat4, type Vec3, multiply } from '../../geometry/vec'
import { type Loop, clearance, linking, moveLoop, tautPitch } from './contact'
import { type Centreline, type Section, sampleCurve } from './tube'

export interface WireLink {
  /** The centreline at `count` samples. */
  centreline(count: number): Centreline
  section: Section
  /** Faces ground flat to |z| ≤ flat — the diamond cut of curb and Cuban chain. */
  flat?: number
}

export interface WireChain {
  links: WireLink[]
  /** One repeat of the chain: which link, rotated how about its own centre. */
  period: { link: number; orient: Mat4 }[]
  /** Centre-to-centre distance from each period element to the next. */
  pitches: number[]
  /** Half-extents of the chain section: across the face (y) and through it (z). */
  half: { y: number; z: number }
  /** The wire actually used, when the requested one had to be thinned to interlock. */
  wire: number
}

/** Samples per centreline when solving contacts: plenty for a smooth loop, cheap to compare. */
const CONTACT_SAMPLES = 48
/** Air left between wires so links never touch, even on the drape's tightest bend. */
const GAP_RATIO = 0.06

/** Rotation about the chain axis (x). */
export function roll(angle: number): Mat4 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]
}

const shifted = (m: Mat4, x: number): Mat4 => [...m.slice(0, 12), m[12]! + x, m[13]!, m[14]!, 1]

/**
 * A rounded oval centreline: superellipse with semi-axes a (x) and b (y). `twist` rotates the
 * point about x by twist(x) — opposite ways on either half — which is what makes curb links
 * lie flat and nest (see `curbLink`).
 */
function ovalLink(
  a: number,
  b: number,
  squareness: number,
  radius: number,
  twist?: (x: number) => number,
  flat?: number,
): WireLink {
  const e = 2 / squareness
  const base = (t: number): Vec3 => {
    const c = Math.cos(2 * Math.PI * t)
    const s = Math.sin(2 * Math.PI * t)
    return [a * Math.sign(c) * Math.abs(c) ** e, b * Math.sign(s) * Math.abs(s) ** e, 0]
  }
  const turn = (p: Vec3, v: Vec3): Vec3 => {
    const angle = twist ? twist(p[0]) : 0
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c]
  }
  return {
    centreline: (count) =>
      sampleCurve(
        (t) => turn(base(t), base(t)),
        (t) => turn(base(t), [0, 0, 1]),
        count,
        true,
      ),
    section: { side: radius, up: radius },
    ...(flat !== undefined && { flat }),
  }
}

const contactLoop = (link: WireLink, radius: number, orient: Mat4, x = 0): Loop =>
  moveLoop({ points: link.centreline(CONTACT_SAMPLES).points, radius }, shifted(orient, x))

/** Largest |z| a link's surface reaches. */
function reach(link: WireLink, radius: number): number {
  const { points } = link.centreline(CONTACT_SAMPLES)
  let z = 0
  for (let i = 2; i < points.length; i += 3) z = Math.max(z, Math.abs(points[i]!))
  return z + radius
}

/** Interlocking needs room for one wire inside the other link: inner width > wire + gap. */
const maxWire = (width: number): number => width / (3 + 2 * GAP_RATIO)

function cable(width: number, wire: number): WireChain {
  const r = wire / 2
  // Stock cable links are about 1.4× as long as they are wide.
  const link = ovalLink((1.4 * width - wire) / 2, (width - wire) / 2, 2.4, r)
  const gap = GAP_RATIO * wire
  const turned = roll(Math.PI / 2)
  const pitch = tautPitch(
    (p) => [contactLoop(link, r, IDENTITY), contactLoop(link, r, turned, p)],
    1.4 * width,
    wire / 8,
    gap,
  )
  return {
    links: [link],
    period: [
      { link: 0, orient: IDENTITY },
      { link: 0, orient: turned },
    ],
    pitches: [pitch, pitch],
    half: { y: width / 2, z: width / 2 },
    wire,
  }
}

/**
 * Curb family: identical links, each half turned about the chain axis by ±`tilt`, so that one
 * link's leading end rises on one side and dips on the other while the next link's trailing end
 * does the opposite — they thread through each other while every link lies flat. The faces are
 * then ground flat (`cut` of the wire diameter) for the diamond-cut look.
 */
function curbLink(length: number, width: number, wire: number, tilt: number, cut: number): WireLink {
  const r = wire / 2
  const a = (length - wire) / 2
  const twist = (x: number) => tilt * Math.sin((Math.PI / 2) * Math.max(-1, Math.min(1, x / a)))
  const raw = ovalLink(a, (width - wire) / 2, 2.2, r, twist)
  return cut > 0 ? { ...raw, flat: reach(raw, r) - cut * wire } : raw
}

function curbPitch(a: WireLink, b: WireLink, wire: number, start: number): number {
  const r = wire / 2
  return tautPitch(
    (p) => [contactLoop(a, r, IDENTITY), contactLoop(b, r, IDENTITY, p)],
    start,
    wire / 8,
    GAP_RATIO * wire,
  )
}

interface CurbProportions {
  length: number
  tilt: number
  cut: number
}

/** Curb: open links, light facet. Cuban/Miami: heavy wire, long links nested tight, deep facet. */
const CURB: CurbProportions = { length: 1.45, tilt: (38 * Math.PI) / 180, cut: 0.12 }
const CUBAN: CurbProportions = { length: 1.35, tilt: (48 * Math.PI) / 180, cut: 0.3 }

function curb(width: number, wire: number, p: CurbProportions): WireChain {
  const link = curbLink(p.length * width, width, wire, p.tilt, p.cut)
  const pitch = curbPitch(link, link, wire, p.length * width)
  return {
    links: [link],
    period: [{ link: 0, orient: IDENTITY }],
    pitches: [pitch],
    half: { y: width / 2, z: link.flat ?? reach(link, wire / 2) },
    wire,
  }
}

/** Figaro: a flattened curb in a 3 short + 1 long rhythm (06-freeform.md §6). */
function figaro(width: number, wire: number): WireChain {
  const short = curbLink(1.3 * width, width, wire, CURB.tilt, CURB.cut)
  const long = curbLink(2.6 * width, width, wire, CURB.tilt, CURB.cut)
  const ss = curbPitch(short, short, wire, 1.3 * width)
  const sl = curbPitch(short, long, wire, 1.95 * width)
  const ls = curbPitch(long, short, wire, 1.95 * width)
  return {
    links: [short, long],
    period: [0, 0, 0, 1].map((link) => ({ link, orient: IDENTITY })),
    pitches: [ss, ss, sl, ls],
    half: { y: width / 2, z: Math.max(short.flat ?? 0, long.flat ?? 0) },
    wire,
  }
}

/**
 * Rope: round links set off the axis, tilted, and turned a little under half a revolution
 * each, so alternate links form two strands that wind around each other. Each link threads
 * the next; the axial step is the smallest that keeps every neighbour clear.
 */
const ROPE_TILT = (60 * Math.PI) / 180
/** Just under 180°: the two strands precess slowly, which reads as a two-ply twist. */
const ROPE_TURN = (150 * Math.PI) / 180
/** Link centre offset from the axis, as a fraction of the link's centreline radius. */
const ROPE_OFFSET = 0.6
/** Rope links need room for two wires through them (they are threaded by their neighbours). */
const ROPE_WIRE_RATIO = 6

function rope(width: number, wire: number): WireChain {
  // The rope's diameter is the link's offset plus its own diameter.
  const outer = width / (1 + ROPE_OFFSET / 2)
  const d = Math.min(wire, outer / ROPE_WIRE_RATIO)
  const R = (outer - d) / 2
  const r = d / 2
  const link = ovalLink(R, R, 2, r)
  const tiltM: Mat4 = [
    Math.cos(ROPE_TILT), 0, -Math.sin(ROPE_TILT), 0,
    0, 1, 0, 0,
    Math.sin(ROPE_TILT), 0, Math.cos(ROPE_TILT), 0,
    0, ROPE_OFFSET * R, 0, 1,
  ] // biome-ignore format: matrix layout
  // The link is drawn in the XY plane; stand it up across the chain before tilting.
  const upright: Mat4 = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1]
  const orientOf = (k: number): Mat4 => multiply(roll(k * ROPE_TURN), multiply(tiltM, upright))
  const loopAt = (k: number, step: number) => contactLoop(link, r, orientOf(k), k * step)
  const gap = GAP_RATIO * d
  const clear = (step: number) => {
    const first = loopAt(0, step)
    for (let k = 1; k <= 8; k++) if (clearance(first, loopAt(k, step)) < gap) return false
    return Math.abs(Math.abs(linking(first, loopAt(1, step))) - 1) < 0.25
  }
  let step = d / 4
  while (step < 2 * outer && !clear(step)) step += d / 8
  if (step >= 2 * outer) throw new Error('Rope links cannot be packed at this wire size')
  let lo = step - d / 8
  let hi = step
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2
    if (clear(mid)) hi = mid
    else lo = mid
  }
  // A whole number of links per repeat so a closed rope joins up.
  const period = Array.from({ length: 12 }, (_, k) => ({ link: 0, orient: orientOf(k) }))
  return {
    links: [link],
    period,
    pitches: period.map(() => hi),
    half: { y: width / 2, z: width / 2 },
    wire: d,
  }
}

/**
 * Box (Venetian): square links of flat strip, each folded into a shallow cup so that the next
 * link, turned a quarter, sits inside it. From the side the chain reads as a row of boxes.
 */
function box(width: number, wire: number): WireChain {
  const strip = Math.min(wire, width / 4)
  const half = (width - strip) / 2
  const corner = strip * 0.9
  // Square loop in XY whose two cross bars (x = ±half) are folded up to z = +half.
  const loop = (t: number): Vec3 => {
    const u = t * 4
    const side = Math.floor(u) % 4
    const f = u - Math.floor(u)
    // Walk the square with rounded corners: each side is a straight run then a quarter turn.
    const run = 2 * (half - corner)
    const arc = (Math.PI / 2) * corner
    const s = f * (run + arc)
    let x: number
    let y: number
    if (s < run) {
      x = -half + corner + s
      y = -half
    } else {
      const angle = (s - run) / corner - Math.PI / 2
      x = half - corner + corner * Math.cos(angle)
      y = -half + corner + corner * Math.sin(angle)
    }
    const rotations = [
      [x, y],
      [-y, x],
      [-x, -y],
      [y, -x],
    ] as const
    const [px, py] = rotations[side]!
    // Fold: the cross bars rise, the long sides stay down; blend over the corner radius.
    const fold = Math.min(1, Math.max(0, (Math.abs(px) - (half - corner)) / corner))
    return [px, py, -half + 2 * half * fold * fold * (3 - 2 * fold)]
  }
  const link: WireLink = {
    centreline: (count) =>
      sampleCurve(
        loop,
        (t) => {
          const [, y, z] = loop(t)
          return [0, y, z]
        },
        count,
        true,
      ),
    section: { side: strip / 2, up: strip / 2, squareness: 4 },
  }
  const turned = roll(Math.PI / 2)
  // Square sections are tested as their circumscribed circle: conservative, never touching.
  const r = (strip / 2) * Math.SQRT2
  const pitch = tautPitch(
    (p) => [contactLoop(link, r, IDENTITY), contactLoop(link, r, turned, p)],
    width,
    strip / 8,
    GAP_RATIO * strip,
  )
  return {
    links: [link],
    period: [
      { link: 0, orient: IDENTITY },
      { link: 0, orient: turned },
    ],
    pitches: [pitch, pitch],
    half: { y: width / 2, z: width / 2 },
    wire: strip,
  }
}

export type WireStyle = 'cable' | 'curb' | 'cuban' | 'figaro' | 'rope' | 'box'

/** The link set and rhythm for a wire chain style. `wire` is thinned if it cannot interlock. */
export function wireChain(style: WireStyle, width: number, requestedWire: number): WireChain {
  const wire = Math.min(requestedWire, maxWire(width))
  switch (style) {
    case 'cable':
      return cable(width, wire)
    case 'curb':
      return curb(width, wire, CURB)
    case 'cuban':
      return curb(width, wire, CUBAN)
    case 'figaro':
      return figaro(width, wire)
    case 'rope':
      return rope(width, wire)
    case 'box':
      return box(width, wire)
  }
}
