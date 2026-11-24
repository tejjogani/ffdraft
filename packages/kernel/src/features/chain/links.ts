/**
 * Wire link styles. Each style is one or two parametric links (a centreline and a section in
 * link-local space: x along the chain, y across it, z out of the chain's face) and a repeating
 * sequence of orientations. Pitches are not tabulated: they are solved from the geometry
 * (contact.ts) against every link close enough to touch, laid straight and bent to the drape's
 * tightest radius, so any width/wire pair the schema allows interlocks without intersecting.
 *
 * Proportions follow docs/research/06-freeform.md §6 where it gives them (Cuban: link length
 * ≈ 1.35·W, pitch ≈ L − 2·wire, i.e. pulled taut; figaro: 3 short + 1 long; rope:
 * helix-instanced links); the rest are typical stock chain.
 */

import { circleLoop } from '../../geometry/loop'
import { IDENTITY, type Mat4, multiply, type Vec3 } from '../../geometry/vec'
import { boxChain } from './box'
import { sampleCurve } from './centreline'
import {
  atTightestBend,
  densePitch,
  GAP_RATIO,
  InterlockError,
  type LinkRun,
  moveLoop,
  runClears,
  tautPitch,
  type WireLoop,
} from './contact'
import type { Template } from './instances'
import { type WireLink, wireTemplate } from './wireTemplate'

/** What a link style contributes to a chain, before layout. */
export interface LinkSet {
  templates: Template[]
  /** One repeat of the chain: which template, rotated how about its own centre. */
  period: { template: number; orient: Mat4 }[]
  /** Centre-to-centre distance from each period element to the next. */
  pitches: number[]
  /** Half-extents of the chain section: across the face (y) and through it (z). */
  half: { y: number; z: number }
  /** The wire actually used, when the requested one had to be thinned to interlock. */
  wire: number
  /** Longest link along the chain. */
  linkLength: number
  /** Tightest radius the chain bends to (about its face normal) with every link still clear. */
  minBend: number
}

/** Samples per centreline when solving contacts: plenty for a smooth loop, cheap to compare. */
const CONTACT_SAMPLES = 48
/** Sweep stations around a link: enough for the twisted ovals to stay true to their centreline. */
const LINK_STATIONS = 24
/** Links checked beyond the ones a link threads: enough to reach past any link it can touch. */
const NEIGHBOURS = 3

/** Rotation about the chain axis (x). */
export function roll(angle: number): Mat4 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]
}

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
  }
}

/** A link's centreline loop, rotated about its centre. */
const contactLoop = (link: WireLink, orient: Mat4): WireLoop =>
  moveLoop({ points: link.centreline(CONTACT_SAMPLES).points, radius: link.radius }, orient)

/** Largest |coordinate k| a link's surface reaches. */
function reach(link: WireLink, k: 0 | 1 | 2): number {
  const { points } = link.centreline(CONTACT_SAMPLES)
  let v = 0
  for (let i = k; i < points.length; i += 3) v = Math.max(v, Math.abs(points[i]!))
  return v + link.radius
}

/** Links of one shape repeating with a uniform pitch. */
const uniformRun = (period: readonly WireLoop[], pitch: number, count: number): LinkRun => ({
  count,
  loop: (k) => period[k % period.length]!,
  centre: (k) => k * pitch,
})

/** Interlocking needs room for one wire inside the other link: inner width > wire + gap. */
const maxWire = (width: number): number => width / (3 + 2 * GAP_RATIO)

/** A one-link-shape style pulled taut: each link threads the next, at the tightest bend that clears. */
function tautChain(
  link: WireLink,
  orients: readonly Mat4[],
  wire: number,
  half: LinkSet['half'],
): LinkSet {
  const linkLength = 2 * reach(link, 0)
  const loops = orients.map((o) => contactLoop(link, o))
  const gap = GAP_RATIO * wire
  const { solved: pitch, minBend } = atTightestBend(linkLength, (bend) =>
    tautPitch(
      (p) => runClears(uniformRun(loops, p, 2 + NEIGHBOURS), 1, gap, bend),
      linkLength,
      wire / 8,
    ),
  )
  return {
    templates: [wireTemplate(link, LINK_STATIONS)],
    period: orients.map((orient) => ({ template: 0, orient })),
    pitches: orients.map(() => pitch),
    half,
    wire,
    linkLength,
    minBend,
  }
}

function cable(width: number, wire: number): LinkSet {
  // Stock cable links are about 1.4× as long as they are wide.
  const link = ovalLink((1.4 * width - wire) / 2, (width - wire) / 2, 2.4, wire / 2)
  return tautChain(link, [IDENTITY, roll(Math.PI / 2)], wire, { y: width / 2, z: width / 2 })
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
  return cut > 0 ? { ...raw, flat: reach(raw, 2) - cut * wire } : raw
}

interface CurbProportions {
  length: number
  tilt: number
  cut: number
}

/**
 * Curb: open links, light facet. Cuban/Miami: heavy wire, links twisted further so they nest
 * into each other when pulled taut, deep facet (06-freeform.md §6).
 */
const CURB: CurbProportions = { length: 1.45, tilt: (38 * Math.PI) / 180, cut: 0.12 }
const CUBAN: CurbProportions = { length: 1.35, tilt: (48 * Math.PI) / 180, cut: 0.3 }

function curb(width: number, wire: number, p: CurbProportions): LinkSet {
  const link = curbLink(p.length * width, width, wire, p.tilt, p.cut)
  return tautChain(link, [IDENTITY], wire, { y: width / 2, z: link.flat ?? reach(link, 2) })
}

/** Figaro: a flattened curb in a 3 short + 1 long rhythm (06-freeform.md §6). */
function figaro(width: number, wire: number): LinkSet {
  const short = curbLink(1.3 * width, width, wire, CURB.tilt, CURB.cut)
  const long = curbLink(2.6 * width, width, wire, CURB.tilt, CURB.cut)
  const shapes = [short, short, short, long]
  const loops = [contactLoop(short, IDENTITY), contactLoop(long, IDENTITY)]
  const sequence = [0, 0, 0, 1]
  const lengths = shapes.map((l) => 2 * reach(l, 0))
  const gap = GAP_RATIO * wire
  const { solved: pitches, minBend } = atTightestBend(2 * reach(short, 0), (bend) => {
    // Each pair pulled taut on its own…
    const pair = (a: number, b: number) =>
      tautPitch(
        (p) =>
          runClears(
            { count: 2, loop: (k) => loops[k === 0 ? a : b]!, centre: (k) => k * p },
            1,
            gap,
            bend,
          ),
        (lengths[a]! + lengths[b]!) / 2,
        wire / 8,
      )
    const ss = pair(0, 0)
    const sl = pair(0, 1)
    const ls = pair(1, 0)
    const pitches = [ss, ss, sl, ls]
    // …then every link checked against the next few as they actually fall.
    for (let start = 0; start < sequence.length; start++) {
      const run: LinkRun = {
        count: 2 + NEIGHBOURS,
        loop: (k) => loops[sequence[(start + k) % 4]!]!,
        centre: (k) => {
          let s = 0
          for (let i = 0; i < k; i++) s += pitches[(start + i) % 4]!
          return s
        },
      }
      if (!runClears(run, 1, gap, bend)) throw new InterlockError()
    }
    return pitches
  })
  return {
    templates: [wireTemplate(short, LINK_STATIONS), wireTemplate(long, LINK_STATIONS)],
    period: sequence.map((template) => ({ template, orient: IDENTITY })),
    pitches,
    half: { y: width / 2, z: Math.max(short.flat ?? 0, long.flat ?? 0) },
    wire,
    linkLength: Math.max(...lengths),
    minBend,
  }
}

/**
 * Rope: long oval links whose planes almost contain the chain axis (leaning back `ROPE_LEAN`),
 * each turned a fifth of a turn from the last and threading the next four. Their outer wires
 * then line up into the diagonal strands of a laid rope (helix-instanced, 06-freeform.md §6).
 * Found by searching aspect × lean × turn × threads for the look, with the contact solver
 * checking every candidate; four threads need about eight wire diameters across the link.
 */
const ROPE_ASPECT = 1.6
const ROPE_LEAN = (10 * Math.PI) / 180
const ROPE_TURN = (2 * Math.PI) / 5
const ROPE_THREADS = 4
const ROPE_WIRE_RATIO = 8

function rope(width: number, wire: number): LinkSet {
  const d = Math.min(wire, width / ROPE_WIRE_RATIO)
  const link = ovalLink((ROPE_ASPECT * width - d) / 2, (width - d) / 2, 2, d / 2)
  // Drawn in XY (the plane holding the axis), then leaned back about y.
  const c = Math.cos(ROPE_LEAN)
  const s = Math.sin(ROPE_LEAN)
  const leaned: Mat4 = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]
  // One full turn per repeat, so a closed rope joins up.
  const orients = Array.from({ length: 5 }, (_, k) => multiply(roll(k * ROPE_TURN), leaned))
  const loops = orients.map((o) => contactLoop(link, o))
  const linkLength = 2 * reach(link, 0)
  const gap = GAP_RATIO * d
  const { solved: pitch, minBend } = atTightestBend(linkLength, (bend) =>
    densePitch(
      (p) =>
        runClears(uniformRun(loops, p, 1 + ROPE_THREADS + NEIGHBOURS), ROPE_THREADS, gap, bend),
      d / 16,
      linkLength,
    ),
  )
  return {
    templates: [wireTemplate(link, LINK_STATIONS)],
    period: orients.map((orient) => ({ template: 0, orient })),
    pitches: orients.map(() => pitch),
    half: { y: width / 2, z: width / 2 },
    wire: d,
    linkLength,
    minBend,
  }
}

export type WireStyle = 'cable' | 'curb' | 'cuban' | 'figaro' | 'rope' | 'box'

/** Each retry thins the wire by this factor; links that still cannot interlock are an error. */
const THINNING = 0.85
const RETRIES = 5

function build(style: WireStyle, width: number, wire: number): LinkSet {
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
      return boxChain(width, wire)
  }
}

/**
 * The link set and rhythm for a wire chain style. A wire too thick to thread through links this
 * wide is thinned until it does (the result reports the wire used).
 */
export function wireChain(style: WireStyle, width: number, requestedWire: number): LinkSet {
  let wire = Math.min(requestedWire, maxWire(width))
  // A box link caps its own strip and fails for reasons a thinner one cannot fix.
  if (style === 'box') return build(style, width, wire)
  for (let attempt = 0; ; attempt++) {
    try {
      return build(style, width, wire)
    } catch (error) {
      if (!(error instanceof InterlockError) || attempt === RETRIES) throw error
      wire *= THINNING
    }
  }
}
