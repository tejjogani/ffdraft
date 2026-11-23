/**
 * Wire link styles. Each style is one or two parametric links (a centreline and a section in
 * link-local space: x along the chain, y across it, z out of the chain's face) and a repeating
 * sequence of orientations. Pitches are not tabulated: they are solved from the geometry
 * (contact.ts), so any width/wire pair the schema allows interlocks without intersecting.
 *
 * Proportions follow docs/research/06-freeform.md §6 where it gives them (Cuban: link length
 * ≈ 1.35·W, pitch ≈ L − 2·wire; figaro: 3 short + 1 long); the rest are typical stock chain.
 */

import { circleLoop, type Loop, roundedRectLoop } from '../../geometry/loop'
import { IDENTITY, type Mat4, multiply, type Vec3 } from '../../geometry/vec'
import { type Centreline, sampleCurve } from './centreline'
import { clearance, InterlockError, linking, moveLoop, pitchRange, type WireLoop } from './contact'

export interface WireLink {
  /** The centreline at `count` samples. */
  centreline(count: number): Centreline
  /** The wire's section, drawn as (side, up). */
  profile: Loop
  /** Radius of the circle around the section, for clearance tests. */
  radius: number
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
    profile: circleLoop(radius),
    radius,
    ...(flat !== undefined && { flat }),
  }
}

const contactLoop = (link: WireLink, orient: Mat4, x = 0): WireLoop =>
  moveLoop(
    { points: link.centreline(CONTACT_SAMPLES).points, radius: link.radius },
    shifted(orient, x),
  )

/** Largest |z| a link's surface reaches. */
function reach(link: WireLink): number {
  const { points } = link.centreline(CONTACT_SAMPLES)
  let z = 0
  for (let i = 2; i < points.length; i += 3) z = Math.max(z, Math.abs(points[i]!))
  return z + link.radius
}

/** Interlocking needs room for one wire inside the other link: inner width > wire + gap. */
const maxWire = (width: number): number => width / (3 + 2 * GAP_RATIO)

function cable(width: number, wire: number): WireChain {
  const r = wire / 2
  // Stock cable links are about 1.4× as long as they are wide.
  const link = ovalLink((1.4 * width - wire) / 2, (width - wire) / 2, 2.4, r)
  const gap = GAP_RATIO * wire
  const turned = roll(Math.PI / 2)
  const pitch = pitchRange(
    (p) => [contactLoop(link, IDENTITY), contactLoop(link, turned, p)],
    1.4 * width,
    wire / 8,
    gap,
  ).max
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
function curbLink(
  length: number,
  width: number,
  wire: number,
  tilt: number,
  cut: number,
): WireLink {
  const r = wire / 2
  const a = (length - wire) / 2
  const twist = (x: number) => tilt * Math.sin((Math.PI / 2) * Math.max(-1, Math.min(1, x / a)))
  const raw = ovalLink(a, (width - wire) / 2, 2.2, r, twist)
  return cut > 0 ? { ...raw, flat: reach(raw) - cut * wire } : raw
}

/** Taut pitch, or for nested links the tightest pitch at which they still clear each other. */
function curbPitch(a: WireLink, b: WireLink, wire: number, start: number, nested = false): number {
  const range = pitchRange(
    (p) => [contactLoop(a, IDENTITY), contactLoop(b, IDENTITY, p)],
    start,
    wire / 8,
    GAP_RATIO * wire,
  )
  return nested ? range.min : range.max
}

interface CurbProportions {
  length: number
  tilt: number
  cut: number
  /**
   * Links pressed together until they nest, rather than pulled taut: the Cuban look. This packs
   * tighter than the L − 2·wire rule of thumb in 06-freeform.md §6 (≈ 0.55·L instead of 0.6–0.7·L
   * at the recipe's 0.26·W wire), because the rule leaves visible play between the links.
   */
  nested: boolean
}

/** Curb: open links, light facet. Cuban/Miami: heavy wire, long links nested tight, deep facet. */
const CURB: CurbProportions = { length: 1.45, tilt: (38 * Math.PI) / 180, cut: 0.12, nested: false }
const CUBAN: CurbProportions = { length: 1.35, tilt: (48 * Math.PI) / 180, cut: 0.3, nested: true }

function curb(width: number, wire: number, p: CurbProportions): WireChain {
  const link = curbLink(p.length * width, width, wire, p.tilt, p.cut)
  const pitch = curbPitch(link, link, wire, p.length * width, p.nested)
  return {
    links: [link],
    period: [{ link: 0, orient: IDENTITY }],
    pitches: [pitch],
    half: { y: width / 2, z: link.flat ?? reach(link) },
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
 * Rope: round links on the chain axis, each tilted steeply and turned a third of a turn from
 * the last, so that every link threads the next two (contact.ts checks both) and their crossing
 * wires spiral like a laid rope. Found by searching tilt × turn for the densest packing that
 * stays clear; links need about 6 wire diameters across to make room for two wires inside.
 */
const ROPE_TILT = (70 * Math.PI) / 180
const ROPE_TURN = (2 * Math.PI) / 3
const ROPE_WIRE_RATIO = 6

function rope(width: number, wire: number): WireChain {
  const d = Math.min(wire, width / ROPE_WIRE_RATIO)
  const R = (width - d) / 2
  const link = ovalLink(R, R, 2, d / 2)
  // Drawn in XY; stood up across the chain, then leaned back by the tilt about y.
  const c = Math.cos(ROPE_TILT)
  const s = Math.sin(ROPE_TILT)
  const tilted: Mat4 = [s, 0, c, 0, 0, 1, 0, 0, -c, 0, s, 0, 0, 0, 0, 1]
  const orientOf = (k: number): Mat4 => multiply(roll(k * ROPE_TURN), tilted)
  const loopAt = (k: number, step: number) => contactLoop(link, orientOf(k), k * step)
  const gap = GAP_RATIO * d
  const clear = (step: number) => {
    const first = loopAt(0, step)
    for (let k = 1; k <= 8; k++) if (clearance(first, loopAt(k, step)) < gap) return false
    return [1, 2].every((k) => Math.abs(Math.abs(linking(first, loopAt(k, step))) - 1) < 0.25)
  }
  let step = d / 4
  while (step < 2 * width && !clear(step)) step += d / 8
  if (step >= 2 * width) throw new InterlockError()
  let lo = step - d / 8
  let hi = step
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2
    if (clear(mid)) hi = mid
    else lo = mid
  }
  // One full turn per repeat, so a closed rope joins up.
  const period = Array.from({ length: 3 }, (_, k) => ({ link: 0, orient: orientOf(k) }))
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
/**
 * How far the cross bars are folded out of the link's plane, as a fraction of its half-width.
 * Deeper cups no longer thread through a quarter-turned neighbour of the same size (checked
 * with the contact solver), so the box look comes from the square links and flat strip.
 */
const BOX_FOLD = 0.35

function box(width: number, wire: number): WireChain {
  const strip = Math.min(wire, width / 5.5)
  const half = (width - strip) / 2
  const corner = strip * 0.9
  // Square loop in XY whose two cross bars (x = ±half) are folded up out of its plane.
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
    return [px, py, BOX_FOLD * half * (2 * fold * fold * (3 - 2 * fold) - 1)]
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
    profile: roundedRectLoop(strip, strip, corner / 3),
    // The rounded square is tested as its circumscribed circle: conservative, never touching.
    radius: Math.hypot(strip / 2 - corner / 3, strip / 2 - corner / 3) + corner / 3,
  }
  const turned = roll(Math.PI / 2)
  const pitch = pitchRange(
    (p) => [contactLoop(link, IDENTITY), contactLoop(link, turned, p)],
    width,
    strip / 8,
    GAP_RATIO * strip,
  ).max
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

/** Each retry thins the wire by this factor; links that still cannot interlock are an error. */
const THINNING = 0.85
const RETRIES = 5

function build(style: WireStyle, width: number, wire: number): WireChain {
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

/**
 * The link set and rhythm for a wire chain style. A wire too thick to thread through links this
 * wide is thinned until it does (the result reports the wire used).
 */
export function wireChain(style: WireStyle, width: number, requestedWire: number): WireChain {
  let wire = Math.min(requestedWire, maxWire(width))
  for (let attempt = 0; ; attempt++) {
    try {
      return build(style, width, wire)
    } catch (error) {
      if (!(error instanceof InterlockError) || attempt === RETRIES) throw error
      wire *= THINNING
    }
  }
}
