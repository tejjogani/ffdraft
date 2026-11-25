/**
 * The loop a pendant hangs from. It places itself on the top centre of its host and is turned
 * so that a chain passes through along X.
 */
import { METALS, metalMassG, type NodeOf } from '@pave/schema'
import type { Manifold } from 'manifold-3d'
import {
  type BuildContext,
  defineFeature,
  metalOf,
  type NodeResult,
  QUALITY,
  runtime,
  type Solid,
  type Stone,
  solidFromManifold,
} from '../core'
import { circleLoop, type Loop, roundedRectLoop } from '../geometry/loop'
import { pathFrames } from '../geometry/path'
import { placeLoop, sweepSolid } from '../geometry/sweep'
import type { Frame, Vec3 } from '../geometry/vec'
import { type IndexedTriangles, meshVolume, unionBounds } from '../solid/meshing'
import type { Bounds } from '../types'
import { underlineDepth } from './vectorBody'

type BailNode = NodeOf<'bail'>

/** Least depth the bail's foot is sunk into its host so the two cast as one, mm. */
const SINK = 0.3
/** The foot sinks by this share of its wire, so a heavy bail is held by a heavy joint. */
const SINK_PER_WIRE = 0.5
/** Step of the search for metal to stand on, outward from the centre of mass, mm. */
const STEP = 0.25
/** Samples across the host's thickness when looking for the metal under the foot. */
const ACROSS = 9
/** Tops this close in height are level for choosing where across the plate a foot stands, mm. */
const FOOT_TIE = 0.05
/**
 * Farthest a hidden loop may stand off the centre of mass, as the angle the piece would hang
 * turned by, degrees. Past it the piece hangs visibly crooked, and a bail on top is the answer.
 */
const HIDDEN_TILT = 10
/** A piece hanging turned by more than this, degrees, is reported (bail.offLevel). */
const HANG_TILT = 5
/**
 * A solid body heavier than this, grams, is reported (body.heavy): past it the trade hollows a
 * pendant from the back, and the weight drags on the chain, the neck and the price.
 */
const HEAVY_G = 30
/**
 * Past this, grams, a solid body that cannot be hollowed in one click is a warning, not a note:
 * a pendant this heavy is not worn. Below it an outline body's weight is noted (info), as the
 * only remedies are a thinner plate or a rebuild.
 */
const UNWEARABLE_G = 200
/** The wall a hollowed body keeps, mm: enough under a 1.3 mm pavé seat (0.65 × stone + 0.4). */
const HOLLOW_WALL = 1.25
/**
 * Stones set in the host's top (a halo's 12 o'clock stones) are kept clear of the bail: its
 * metal stays this far behind their girdle plane, mm, and its band this far above their tops.
 */
const STONE_MARGIN = 0.1
const STONE_CLEAR = 0.2
/** Share of a stone's girdle the bail may hide from the front before it is reported. */
const STONE_HIDDEN = 0.05
/** A loop bail's leg ends stand this share of the wire either side of the foot's centre. */
const LEG_SPREAD = 0.18
/**
 * Least lap, in wires, of a hidden bail's strap on the metal below a scooped back: where the
 * back is open under the loop, the back run is carried down the back plane to the next metal.
 */
const STRAP_LAP = 2
/** Metal a strap leaves in front of it where it is sunk into the host, mm. */
const STRAP_SKIN = 0.4
/**
 * A strap's width as shares of the loop's, tried in turn: as wide as the loop where the metal
 * below takes it, narrower on a small piece whose neck is narrower than the loop (a 20 mm trophy).
 */
const STRAP_SHARES = [0.85, 0.5]
/**
 * Least metal of a hidden loop cast into its host, as lengths of its back run (each wire × width
 * × wire) wholly in the metal. Over an open back held only where its runs end, a 16 mm trophy's
 * loop had a fifth of one; a strap or a solid back gives one or many. A share of the whole back
 * run would wrongly fault a long loop held well by a strap.
 */
const JOINT_WIRES = 1

/**
 * Metal kept under a foot sunk shallower than its full sink, mm. Over a script name's centre of
 * mass the top is often a joining hairline 0.45 mm deep, under the 0.55 mm a 1.1 mm wire sinks:
 * the foot walked 1.5 mm to deeper metal and the piece hung 10° off level. A ring's joint is the
 * wire's chord, 0.99 of its width at the least sink against 1.0 at the full one, so a level hang
 * is worth the shallower sink.
 */
const THIN_SKIN = 0.1

const sinkFor = (wire: number) => Math.max(SINK, SINK_PER_WIRE * wire)

/**
 * Height of a bail's opening centre above where it stands (its foot plus any lift), for a foot
 * sunk `sink` deep: the centreline's lowest point is `sink` into the metal for every style.
 */
function openingRise(node: BailNode, sink: number): number {
  const ring = node.opening + node.wire
  if (node.style === 'loop') return -sink + (ring / 2) * (1 - Math.cos(LOOP_SPREAD.at))
  return -sink + ring / 2
}

/** Band of the given section carried round a path in the YZ plane; `x` is the band's width axis. */
function band(path: Vec3[], closed: boolean, section: (i: number) => Loop): Solid {
  const frames = pathFrames(path, { closed, up: [1, 0, 0] })
  return sweepSolid({ closed, sections: frames.map((frame, i) => placeLoop(frame, section(i))) })
}

/** Points on a circle in the YZ plane. */
const circle = (centre: Vec3, radius: number, count: number): Vec3[] =>
  Array.from({ length: count }, (_, i) => {
    const a = (i / count) * 2 * Math.PI
    return [centre[0], centre[1] + radius * Math.sin(a), centre[2] - radius * Math.cos(a)]
  })

function build(
  node: BailNode,
  stand: Stand,
): { solids: Solid[]; opening: Vec3; supported: boolean; topOnly?: boolean } {
  const { opening, width, wire } = node
  const [x, y, foot] = stand.top
  const SINK = stand.sink
  // Where the bail proper starts: raised over neighbouring metal that stands taller than its
  // foot (a script capital, a heart's lobes) so the chain clears it, on a stem down to the foot.
  const z = foot + stand.lift
  // Section drawn as (through the wire, along X).
  const flat = (w: number) => roundedRectLoop(wire, w, Math.min(wire, w) * 0.3)
  const stem = (section: Loop): Solid[] =>
    stand.lift > 0
      ? [
          band(
            [
              [x, y, foot - SINK],
              [x, y, z - SINK / 2],
            ],
            false,
            () => section,
          ),
        ]
      : []
  switch (node.style) {
    case 'ring': {
      const centre: Vec3 = [x, y, z + openingRise(node, SINK)]
      return {
        solids: [
          band(circle(centre, (opening + wire) / 2, 32), true, () => circleLoop(wire / 2)),
          ...stem(circleLoop(wire / 2)),
        ],
        opening: centre,
        supported: stand.supported,
      }
    }
    case 'tube': {
      const centre: Vec3 = [x, y, z + openingRise(node, SINK)]
      return {
        solids: [
          band(circle(centre, (opening + wire) / 2, 32), true, () => flat(width)),
          ...stem(flat(width)),
        ],
        opening: centre,
        supported: stand.supported,
      }
    }
    case 'hidden': {
      // A closed flat loop standing off the back of the piece: its back run lies in the host's
      // back (so the joint is a full lap and the slot is closed for the chain check), its front
      // run stands behind. The slot is `opening` high and 0.6 of that deep, clear: a chain lies
      // flat behind a piece, and every millimetre of stand-off holds the piece off the chest.
      const depth = 0.6 * opening + wire
      const height = opening + wire
      const place = stand.hidden(height)
      const { x, zc } = place
      // The back run is sunk into the host's back, its slot face standing proud of the back by
      // its rounded edge, so the round edges clear the back plane. Flush, they left knife edges
      // of host metal along the back run, down to nothing where a scooped back's rim ends
      // (wall.thin 0.00 mm on a 100 mm trophy).
      const edge = Math.min(wire, width) * 0.3
      const y0 = place.back - wire / 2 + edge
      // Tight corners: a flat-link chain fills the slot out to its corners.
      const r = Math.min(depth, height) * 0.2
      const corners: [number, number][] = [
        [0, -height / 2],
        [depth, -height / 2],
        [depth, height / 2],
        [0, height / 2],
      ]
      const path: Vec3[] = []
      corners.forEach(([cy, cz], k) => {
        // Corner centres sit r inside the rectangle; each arc turns a quarter.
        const oy = cy === 0 ? r : -r
        const oz = cz < 0 ? r : -r
        const start = [Math.PI, 1.5 * Math.PI, 0, 0.5 * Math.PI][k]!
        for (let i = 0; i <= 6; i++) {
          const a = start + ((i / 6) * Math.PI) / 2
          path.push([x, y0 + cy + oy + r * Math.cos(a), zc + cz + oz + r * Math.sin(a)])
        }
      })
      // Over a scooped back only the top of the back run meets metal (the rim): a strap carries
      // the back run on down the back plane to the metal below, so the loop is held at both ends
      // of its back run, as a jeweler bridges an open back. It is narrower than the loop and
      // stops short of its slot face, so no face of the strap lies on one of the loop's.
      const s = place.strap
      // Behind, the strap stops just inside the loop's slot face; in front, it reaches `front`.
      const rear = y0 + wire / 2 - 0.05 * wire
      /** A straight bar down the back plane from `top` to `bottom`, reaching forward to `front`. */
      const bar = (top: number, bottom: number, front: number, back: number, across: number) =>
        band(
          [
            [x, (front + back) / 2, top],
            [x, (front + back) / 2, bottom],
          ],
          false,
          () => roundedRectLoop(back - front, across, Math.min(back - front, across) * 0.25),
        )
      // The rim tab is narrower again and stops short of the strap's back, inside it.
      const strap = s
        ? [
            bar(s.top, s.bottom, s.front, rear, s.across),
            ...(s.rim.front < s.front - 0.05
              ? [bar(s.top, s.rim.bottom, s.rim.front, rear - 0.05 * wire, 0.8 * s.across)]
              : []),
          ]
        : []
      return {
        solids: [band(path, true, () => flat(width)), ...strap],
        opening: [x, y0 + depth / 2, zc],
        supported: place.supported,
        topOnly: place.topOnly,
      }
    }
    default: {
      // A teardrop: narrow where it joins the piece, opening out above. Both ends are sunk in.
      // `opening` is the clear hole both ways: the centreline is opening + wire high and, at
      // its widest, opening + wire across, so a chain that passes the height passes the width.
      const h = opening + wire
      const w = opening + wire
      const count = 28
      // The legs come down into the host steeply (the spread grows as t³ off the foot while the
      // height grows as t²), and their ends stand no farther apart than the host is thick, so
      // both cut ends are buried in the metal. A shallow leg ran out through the face of a thin
      // plate as a feathered tongue (wall.thin on a 1.6 mm heart with a 3.5 mm opening).
      const legs = Math.max(0, Math.min(LEG_SPREAD * wire, stand.thick - wire / 2))
      const path: Vec3[] = Array.from({ length: count + 1 }, (_, i) => {
        const t = (i / count) * 2 * Math.PI
        const spread = Math.sin(t / 2) ** LOOP_POWER / LOOP_SPREAD.peak
        return [
          x,
          y + (w / 2) * Math.sin(t) * spread + legs * Math.cos(t / 2),
          z - SINK + (h / 2) * (1 - Math.cos(t)),
        ]
      })
      // The band is narrower at its foot and full width over the top.
      const section = (i: number) => flat(width * (0.55 + 0.45 * Math.sin((i / count) * Math.PI)))
      return {
        solids: [band(path, false, section), ...stem(flat(width * 0.55))],
        // The chain threads the loop where it is widest.
        opening: [x, y, z + openingRise(node, SINK)],
        supported: stand.supported,
      }
    }
  }
}

/** How sharply the teardrop narrows to its foot: above 1 its legs meet the host steeply. */
const LOOP_POWER = 2
/** Peak of sin t · sin(t/2)^LOOP_POWER, the teardrop's unscaled half-width, and where it is:
 *  dividing by it makes the loop's widest centreline exactly its nominal width. */
const LOOP_SPREAD = (() => {
  let peak = 0
  let at = Math.PI / 2
  for (let i = 0; i <= 2000; i++) {
    const t = (i / 2000) * Math.PI
    const v = Math.sin(t) * Math.sin(t / 2) ** LOOP_POWER
    if (v > peak) [peak, at] = [v, t]
  }
  return { peak, at }
})()

/** Where the bail stands on its host, and what the hidden style needs to place itself. */
interface Stand {
  /** Top of the metal under the foot's centre: x, y and z of real metal. */
  top: Vec3
  /** How far the bail rises on a stem above its foot to clear taller metal beside it, mm. */
  lift: number
  /** How deep the foot is sunk into the metal under it, mm. */
  sink: number
  /** False when no metal was found under the foot (the bail then stands on the highest point). */
  supported: boolean
  /** Metal either side of the foot's centre across the host's thickness (y), mm. */
  thick: number
  /** The host's centre of mass. */
  com: Vec3
  /** Where a hidden loop `height` tall (centreline) lies against the host's back. */
  hidden(height: number): HiddenPlace
}

/** A hidden loop's place: its x, centre height, and the back plane its back run lies in. */
interface HiddenPlace {
  x: number
  zc: number
  back: number
  /** False when no metal across the back can take both its runs near the centre of mass. */
  supported: boolean
  /**
   * Set when only the top of the back run meets metal (an open, scooped back): a strap in the
   * back plane from `top` (up in the rim) down to `bottom` (lapped on the metal below), reaching
   * forward to `front` so it is sunk into the metal at both ends.
   */
  strap?: {
    top: number
    bottom: number
    front: number
    /** The strap's width along x. */
    across: number
    rim: { bottom: number; front: number }
  }
  /** Only the top of the back run meets metal and no metal below takes a strap. */
  topOnly?: boolean
}

/** Volume centroid of closed triangles. */
function centroid({ positions: p, indices }: IndexedTriangles): Vec3 {
  let volume = 0
  const sum = [0, 0, 0]
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]! * 3
    const b = indices[i + 1]! * 3
    const c = indices[i + 2]! * 3
    const d =
      p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) -
      p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) +
      p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)
    volume += d
    for (let k = 0; k < 3; k++) sum[k]! += d * (p[a + k]! + p[b + k]! + p[c + k]!)
  }
  const [x, y, z] = sum.map((v) => (volume === 0 ? 0 : v / (4 * volume)))
  return [x!, y!, z!]
}

/** Centre of mass of solids by volume, or the middle of their bounds when they have none. */
function centreOfMass(solids: readonly Solid[], bounds: Bounds): Vec3 {
  let mass = 0
  const sum = [0, 0, 0]
  for (const s of solids) {
    const t = s.triangles(QUALITY.draft)
    const v = meshVolume(t)
    const c = centroid(t)
    mass += v
    for (let k = 0; k < 3; k++) sum[k]! += v * c[k]!
  }
  const [x, y, z] = sum.map((v, k) => (mass > 0 ? v / mass : (bounds.min[k]! + bounds.max[k]!) / 2))
  return [x!, y!, z!]
}

/** Every hit of a ray through the meshes, as distances along it. */
function hits(meshes: readonly Manifold[], from: Vec3, to: Vec3): number[] {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2])
  return meshes.flatMap((m) =>
    m
      .rayCast([...from], [...to])
      .map((hit) => Math.hypot(...hit.position.map((v, k) => v - from[k]!)) / length),
  )
}

/**
 * Where the bail stands: over the host's centre of mass in x, so the piece hangs level, on metal
 * that is really there. Rays are cast straight down across the host's thickness at the foot's
 * centre and at both edges of its band; the foot needs metal under all three. When the centre
 * of mass sits over a gap (a cleft heart, a hollow crown, between two letters) the search walks
 * outward to the nearest place that carries the foot, and stands on that metal's x, y and z —
 * never on the bounding box's centre, which may be air.
 */
function standPoint(
  solids: readonly Solid[],
  bounds: Bounds,
  node: BailNode,
  stones: readonly Stone[],
): Stand {
  const meshes = solids.map((s) => s.manifold(QUALITY.draft))
  const com = centreOfMass(solids, bounds)
  const above = bounds.max[2] + 1
  const below = bounds.min[2] - 1
  // Half the foot's length along x: a loop stands on its narrowed band, a tube on all of it.
  const half = (node.style === 'loop' ? 0.55 : 1) * (node.width / 2)
  // Metal needed straight under the foot: as deep as the foot is sunk, so it is held by metal
  // and not by a kiss on the edge of a hairline.
  const need = sinkFor(node.wire)
  /** The top of the metal under (x, y) and how deep it runs from there, or null. */
  const columnAt = (x: number, y: number): { z: number; run: number } | null => {
    const t = hits(meshes, [x, y, above], [x, y, below]).sort((a, b) => a - b)
    if (t.length === 0) return null
    const drop = above - below
    return { z: above - t[0]! * drop, run: ((t[1] ?? t[0]!) - t[0]!) * drop }
  }
  const pitch = (bounds.max[1] - bounds.min[1]) / ACROSS
  const ys = Array.from({ length: ACROSS }, (_, i) => bounds.min[1] + (i + 0.5) * pitch)
  /** The foot centred at (x, y): the lowest top under its centre and ends, and their least run. */
  const carry = (x: number, y: number): { z: number; run: number } | null => {
    const centre = columnAt(x, y)
    // A ring stands on its round wire alone.
    const sides = (node.style === 'ring' ? [] : [x - half, x + half]).map((sx) => columnAt(sx, y))
    if (!centre || sides.some((c) => c === null)) return null
    return {
      z: Math.min(centre.z, ...sides.map((c) => c!.z)),
      run: Math.min(centre.run, ...sides.map((c) => c!.run)),
    }
  }
  /**
   * The metal carrying a foot centred at x: its top, the middle of its thickness, its depth.
   * `enough` is the depth of metal that carries the foot (a shallower sink takes less).
   */
  const footAt = (x: number, enough = need): { at: Vec3; run: number; thick: number } | null => {
    const columns = ys.map((y) => ({ y, c: columnAt(x, y) }))
    let best: { y: number; z: number; run: number } | null = null
    for (const { y, c } of columns) if (c && (!best || c.z > best.z)) best = { y, ...c }
    if (!best) return null
    // The foot stands across the metal that is near the top there (a plate's thickness): in its
    // middle, or, where the ends of the foot find too little metal there (the lip of a cup seen
    // edge on), at the place across it where they find enough and the foot stands highest. The
    // highest, not merely the nearest: an end that drops to a plinth below a cup would stand the
    // bail on the plinth, on a stem up the piece's front.
    const near = columns.filter((t) => t.c && t.c.z > best!.z - node.wire)
    const mid = (Math.min(...near.map((t) => t.y)) + Math.max(...near.map((t) => t.y))) / 2
    let found: { at: Vec3; run: number; off: number } | null = null
    for (const y of [mid, ...near.map((t) => t.y)]) {
      // Both ends of the foot must have metal under them too; the foot sinks to the lowest.
      const c = carry(x, y)
      if (!c) continue
      const candidate = { at: [x, y, c.z] as Vec3, run: c.run, off: Math.abs(y - mid) }
      if (beats(candidate, found, enough)) found = candidate
    }
    if (!found) return null
    // The metal's faces lie between the outermost samples that found it and the next ones.
    const lo = Math.min(...near.map((t) => t.y))
    const hi = Math.max(...near.map((t) => t.y))
    const y = found.at[1]
    return { ...found, thick: Math.min(y - lo, hi - y) + pitch / 2 }
  }
  /**
   * One foot beats another: carried beats not; then higher; then nearer the plate's middle.
   * Heights within FOOT_TIE count as level: a tessellated top differs by hundredths across the
   * plate, and the highest sample stood a tube a third of the way to one face of a 1.6 mm disc,
   * its stem standing out of that face.
   */
  function beats(
    a: { at: Vec3; run: number; off: number },
    b: { at: Vec3; run: number; off: number } | null,
    enough: number,
  ): boolean {
    if (!b) return true
    const carried = a.run >= enough
    if (carried !== b.run >= enough) return carried
    if (!carried) return a.run > b.run
    if (Math.abs(a.at[2] - b.at[2]) > FOOT_TIE) return a.at[2] > b.at[2]
    return a.off < b.off
  }
  const span = bounds.max[0] - bounds.min[0]
  // Nearest the centre of mass first: hanging level matters more than standing on the very top.
  let found: { at: Vec3; thick: number } | null = null
  let walked = 0
  for (let d = 0; d <= span / 2 && !found; d += STEP)
    for (const x of d > 0 ? [com[0] + d, com[0] - d] : [com[0]]) {
      const foot = footAt(x)
      if (foot && foot.run >= need) {
        found = { at: foot.at, thick: foot.thick }
        walked = d
        break
      }
    }
  // The tallest metal within the bail's reach either side: the hole must sit above it.
  const reach = (node.opening + node.wire) / 2 + node.wire
  const clearAt = (x: number): number => {
    let clear = -Infinity
    for (let dx = -reach; dx <= reach + 1e-9; dx += STEP)
      for (const y of ys) {
        const c = columnAt(x + dx, y)
        if (c) clear = Math.max(clear, c.z)
      }
    return clear
  }
  const first = settle(found?.at ?? null, found?.thick ?? node.wire, need)
  const level = (stand: Stand) => {
    const tilt = hangTilt(node, stand)
    return tilt !== null && tilt <= HANG_TILT
  }
  if (!first.supported || node.style === 'hidden' || level(first)) return first
  // Where the full sink found metal only so far off the centre of mass that the piece hangs
  // turned, however it then stands, a nearer foot on shallower metal that hangs it level is
  // taken, sunk to THIN_SKIN above that metal's underside (no less than SINK). Judged on the
  // stand as settled: a foot that rises onto an ascender beside it may hang level already, and
  // a lower foot nearer the centre then let the chain run through the letters (Legend, 16 mm).
  for (let d = 0; d < walked; d += STEP)
    for (const x of d > 0 ? [com[0] + d, com[0] - d] : [com[0]]) {
      // Carried by the shallow metal, the foot keeps to the middle of the plate: chosen by
      // depth alone it stood a third of the way to the front of a 1.4 mm name.
      const foot = footAt(x, SINK + THIN_SKIN)
      if (!foot || foot.run < SINK + THIN_SKIN) continue
      const stand = settle(foot.at, foot.thick, Math.min(need, foot.run - THIN_SKIN))
      if (level(stand)) return stand
    }
  return first

  /**
   * The stand on a foot at `at` (null: none carries it), `across` thick and sunk `deep`: raised
   * over taller metal within reach, out of a thin plate, and behind stones set in the top.
   */
  function settle(at: Vec3 | null, across: number, deep: number): Stand {
    let top = at
    let thick = across
    let sink = deep
    // Nothing anywhere carries the foot: stand on the highest point so the problem is visible.
    let supported = true
    if (!top) {
      supported = false
      top = [com[0], (bounds.min[1] + bounds.max[1]) / 2, bounds.max[2]]
    }
    let clear = Math.max(top[2], clearAt(top[0]))
    if (supported && node.style !== 'hidden' && clear - top[2] > node.wire) {
      // Taller metal within reach (an ascender beside a low letter): rather than raise the bail
      // on a stem drawn across that letter, stand on the taller metal itself, if that keeps the
      // piece hanging as level as it would from here (or within HANG_TILT).
      const tilt = (x: number, z: number) =>
        Math.atan2(Math.abs(x - com[0]), Math.max(1e-6, z + node.opening - com[2]))
      const limit = Math.max((HANG_TILT * Math.PI) / 180, tilt(top[0], clear))
      const from = top
      search: for (let d = STEP; d <= reach + 1e-9; d += STEP)
        for (const x of [from[0] + d, from[0] - d]) {
          const foot = footAt(x)
          if (!foot || foot.run < need || tilt(x, foot.at[2]) > limit) continue
          const over = Math.max(foot.at[2], clearAt(x))
          if (over - foot.at[2] > node.wire / 2) continue
          top = foot.at
          thick = foot.thick
          sink = need
          clear = over
          break search
        }
    }
    // A rise smaller than the foot's own sink is taken up by the sink: a stem that short would
    // be a sliver of metal under the casting's wall limit.
    const rise = clear - top[2]
    let lift = node.style === 'hidden' || rise < sink ? 0 : rise
    // A ring or tube sinks into the host, but its arc widens as it rises: on a plate thinner
    // than that arc's chord at the plate's top, the sunk arc stood out of both faces (1.1 mm
    // proud each side of a 1.4 mm name; over the top stones of an iced 45 mm KING, buried 59 %
    // in metal). It is raised until its arc is no wider than the metal under it where it meets
    // the top, and stands on a stem sunk in its place.
    if (supported && (node.style === 'ring' || node.style === 'tube')) {
      const outer = node.opening / 2 + node.wire
      const width = Math.min(outer, thick)
      // How deep the arc's outer face may go into the top before it is wider than the metal.
      const fits = outer - Math.sqrt(outer * outer - width * width)
      // The foot stands on the lowest metal under its width; a rounded top (a disc's) is higher
      // under the middle of the band, where the arc meets it first.
      const band = node.style === 'ring' ? node.wire / 2 : half
      const high = Math.max(
        top[2],
        ...[-1, -0.5, 0.5, 1].map((f) => columnAt(top![0] + f * band, top![1])?.z ?? -Infinity),
      )
      const raise = high - top[2] + sink + node.wire / 2 - fits
      if (raise > 0) lift = Math.max(lift, raise)
    }
    // Stones set in the host's top (a halo's top stones, tables to the front): the foot and the
    // bottom of the band would sit across their crowns, where no setter can reach them. As a
    // bench jeweler hangs a halo, the foot moves behind the stones' girdle plane, onto the back
    // of the rim, and the band rises on a stem until its lowest metal clears the stones' tops.
    // The bail's lowest metal is at its foot, whatever its lift: a stem stands there.
    const footLow = top[2] - sink - node.wire / 2
    const under =
      node.style === 'hidden' || !supported ? null : stonesUnder(stones, top[0], footLow)
    if (under) {
      const front = node.wire / 2 + (node.style === 'loop' ? LEG_SPREAD * node.wire : 0)
      const want = under.girdle + under.side * (STONE_MARGIN + front)
      if ((want - top[1]) * under.side > 0) {
        // The nearest place to `want`, walking back toward the first stand, that carries it.
        const from = top
        for (let k = 0; k <= 16; k++) {
          const y = want + ((from[1] - want) * k) / 16
          const c = carry(from[0], y)
          if (c && c.run >= sink) {
            // The foot may now overhang the back of the rim: a loop's legs meet at its centre.
            thick = node.wire / 2
            top = [from[0], y, c.z]
            break
          }
        }
      }
      const rise = under.top + STONE_CLEAR + sink + node.wire / 2 - top[2]
      if (rise > 0) lift = Math.max(lift, rise, sink)
    }
    return { top, lift, sink, supported, thick, com, hidden: hiddenPlace }
  }

  /**
   * The stones of the host whose girdle the bail's band, reaching down to `low`, could stand
   * across: stones turned to face front or back (a pendant's), within the band's width of x.
   * Returns their girdle plane on the side the bail must keep behind (`side` points from the
   * tables to the pavilions), and their highest point. Null when none, or when they face both
   * ways (nothing behind them to stand on).
   */
  function stonesUnder(
    all: readonly Stone[],
    x: number,
    low: number,
  ): { side: 1 | -1; girdle: number; top: number } | null {
    const reach = (node.style === 'ring' ? node.wire : node.width) / 2
    let side: 1 | -1 | 0 = 0
    let girdle = 0
    let high = -Infinity
    for (const s of all) {
      const n = s.frame.z
      if (Math.abs(n[1]) < 0.7) continue
      const r = Math.max(s.dims.width, s.dims.length) / 2
      const [sx, sy, sz] = s.frame.origin
      if (Math.abs(sx - x) > reach + r) continue
      const stoneTop = sz + r * Math.sqrt(Math.max(0, 1 - n[2] ** 2))
      if (stoneTop <= low) continue
      const pavilion = n[1] < 0 ? 1 : -1
      if (side !== 0 && pavilion !== side) return null
      girdle = side === 0 ? sy : pavilion > 0 ? Math.max(girdle, sy) : Math.min(girdle, sy)
      side = pavilion
      high = Math.max(high, stoneTop)
    }
    return side === 0 ? null : { side, girdle, top: high }
  }

  /**
   * A hidden loop lies in the host's back plane, as high as it can go while staying under the
   * top edge across its whole width (the higher the hole above the centre of mass, the less the
   * piece tips forward). Its runs must meet metal in the back plane, both where they can and the
   * top one at least, or it is held by nothing: a crown open at the back. Where the back is
   * open over the centre of mass the search walks outward, but only as far as the piece would
   * still hang near level (HIDDEN_TILT); beyond that a hidden bail is the wrong bail.
   */
  function hiddenPlace(h: number): HiddenPlace {
    const behind = bounds.max[1] + 1
    const depth = behind - bounds.min[1] + 1
    /** The back where a leg at height z meets metal, from behind, or null. */
    const legAt = (x: number, z: number): number | null => {
      const t = hits(meshes, [x, behind, z], [x, bounds.min[1] - 1, z])
      const y = t.length > 0 ? behind - Math.min(...t) * depth : null
      // Metal only far in front of the back is the far wall of an open or scooped back; on a
      // small piece "far" is a fraction of its thickness (a 20 mm trophy's scoop is 2.4 mm deep,
      // and a loop in there would have the chain run through the handles).
      const near = Math.min(2 * node.wire, 0.15 * (bounds.max[1] - bounds.min[1]))
      return y !== null && y > bounds.max[1] - near ? y : null
    }
    /** Highest metal at x across the host's thickness, or null where there is none. */
    const topAt = (x: number): number | null => {
      let best: number | null = null
      for (const y of ys) {
        const c = columnAt(x, y)
        if (c && (best === null || c.z > best)) best = c.z
      }
      return best
    }
    /**
     * The strap for a loop held only at the top of its back run (zc ± h/2 against a rim whose
     * back is at `rim`): down the back plane from up in the rim to STRAP_LAP wires onto the
     * first metal below that is there across its whole width, and forward far enough to sink
     * into that metal by the foot's sink. Without such metal the loop hangs from the rim alone.
     */
    const strapDown = (
      x: number,
      zc: number,
      h: number,
      rim: number,
    ): { strap: NonNullable<HiddenPlace['strap']> } | { topOnly: true } => {
      const lap = STRAP_LAP * node.wire
      /** Where the metal met from behind at (sx, z) ends toward the front. */
      const frontFace = (sx: number, z: number): number => {
        const t = hits(meshes, [sx, behind, z], [sx, bounds.min[1] - 1, z]).sort((a, b) => a - b)
        return t.length > 1 ? behind - t[1]! * depth : -Infinity
      }
      // Up into the rim as high as the loop's own top, no higher: above it the rim's back edge
      // is rounded off and the strap's end would stand out of it.
      const top = zc + h / 2 + node.wire / 2
      for (let z = zc - h / 2 - STEP; z - lap >= bounds.min[2]; z -= STEP)
        for (const share of STRAP_SHARES) {
          // Samples just outside the strap's edges and on its centre.
          const edge = (share / 2 + 0.025) * node.width
          const across = [x - edge, x, x + edge]
          const backs = (hz: number) => across.map((sx) => legAt(sx, hz))
          // Where the strap meets metal: the top of the back run in the rim, and the landing.
          const heights = [zc + h / 2, z, z - lap / 2, z - lap]
          const found = heights.slice(1).flatMap(backs)
          if (found.some((y) => y === null)) continue
          // Sunk into the metal at both ends, but never out through its front: a trophy's neck,
          // where the strap lands, is thinner than the cup's rim. The neck is turned, so its
          // front is read all down the landing, not at its ends: sampled at three heights, a
          // waist between them let the strap's end show through the front of a 30 mm trophy.
          const landingHeights = Array.from(
            { length: Math.ceil(lap / STEP) + 1 },
            (_, i) => z - Math.min(lap, i * STEP),
          )
          const skin = Math.max(
            ...[heights[0]!, ...landingHeights].flatMap((hz) =>
              across.map((sx) => frontFace(sx, hz)),
            ),
          )
          // A landing's back is rarely flat (a trophy's neck is turned): the strap sinks into the
          // metal by the middle of its back faces, and lands only where that leaves it sunk.
          const sorted = (found as number[]).sort((a, b) => a - b)
          const landing = Math.min(rim, sorted[Math.floor(sorted.length / 2)]!)
          const front = Math.max(landing - Math.max(need, node.wire), skin + STRAP_SKIN)
          if (front > landing - need / 2) continue
          // The rim, where the chain pulls, is usually far deeper than the landing (a cup's top
          // wall runs right through the piece): a tab sinks the strap's top end into it.
          const rimHeights = [zc + h / 2, zc + h / 2 + node.wire / 2]
          const rimSkin = Math.max(
            ...rimHeights.flatMap((hz) => across.map((sx) => frontFace(sx, hz))),
          )
          const rimFront = Math.min(front, Math.max(rimSkin + STRAP_SKIN, rim - 3 * node.wire))
          return {
            strap: {
              top,
              bottom: z - lap,
              front,
              across: share * node.width,
              rim: { bottom: zc + h / 2 - node.wire / 2, front: rimFront },
            },
          }
        }
      return { topOnly: true }
    }
    const tan = Math.tan((HIDDEN_TILT * Math.PI) / 180)
    // An open back with a rim along the top (a scooped trophy) holds the loop by its top run
    // alone, which is where the chain pulls; used only when no place holds both runs.
    let hangsFromTop: HiddenPlace | undefined
    for (let d = 0; d <= span / 2; d += STEP)
      for (const x of d > 0 ? [com[0] + d, com[0] - d] : [com[0]]) {
        const tops = [x - node.width / 2, x, x + node.width / 2].map(topAt)
        if (tops.some((t) => t === null)) continue
        const zc = Math.min(...(tops as number[])) - node.wire - h / 2
        // Off-centre the piece hangs turned; a hole at or below the centre of mass is reported
        // by bail.hiddenLow, so only the sideways reach is limited here.
        if (d > tan * Math.max(0, zc - com[2])) continue
        const [low, high] = [zc - h / 2, zc + h / 2].map((z) => legAt(x, z))
        if (high == null) continue
        if (low != null) return { x, zc, back: Math.min(low, high), supported: true }
        hangsFromTop ??= { x, zc, back: high, supported: true, ...strapDown(x, zc, h, high) }
      }
    return (
      hangsFromTop ?? {
        x: com[0],
        zc: bounds.max[2] - node.wire - h / 2,
        back: bounds.max[1],
        supported: false,
      }
    )
  }
}

/**
 * A pendant body cast solid when its weight says it should be hollow: a 100 mm iced name in
 * block letters is half a kilo of gold. A sculpted body has a one-click hollow; an outline body
 * cannot be hollowed yet, so the warning says what can be done instead.
 */
function heavyBody(host: NodeResult, ctx: BuildContext) {
  const body = host.node
  if (body.kind !== 'meshBody' && body.kind !== 'vectorBody' && body.kind !== 'relief') return
  // Solid is what was built, not what was asked for: a hollow that failed casts solid, and
  // offering the same hollow again would do nothing.
  const failed = host.diagnostics.some((d) => d.code === 'mesh.hollowFailed')
  if (body.kind === 'meshBody' && body.hollow > 0 && !failed) return
  const metal = host.bodies[0]?.material
  if (!metal) return
  const grams = metalMassG(
    metal,
    host.bodies.reduce((sum, b) => sum + b.solid.volume(), 0),
  )
  if (grams <= HEAVY_G) return
  // The body as its own node built it: pavé seats are cut into it by a later node, which this
  // one cannot see, so the weight is said to be before them (an iced 100 mm KING: 658 g here,
  // 577 g once its seats were cut).
  const what = `${grams.toFixed(0)} g of ${METALS[metal].label} hanging from the bail (weighed before any stone seats are cut)`
  ctx.report({
    level: body.kind === 'meshBody' || grams > UNWEARABLE_G ? 'warning' : 'info',
    code: 'body.heavy',
    message:
      body.kind === 'meshBody' && failed
        ? `The hollow failed, so the piece is cast solid: ${what}. Thin walls stopped it: try a thinner hollow wall, or a larger piece.`
        : body.kind === 'meshBody'
          ? `The piece is cast solid: ${what}. Hollow it from the back to a ${HOLLOW_WALL} mm wall, which still takes 1.3 mm pavé seats.`
          : `The piece is cast solid: ${what}. ${body.kind === 'vectorBody' ? 'An outline body cannot be hollowed yet: make the plate thinner, or build the piece as a sculpted body and hollow that.' : 'Make the base thinner, or build the piece as a sculpted body and hollow that.'}`,
    value: grams,
    limit: HEAVY_G,
    ...(body.kind === 'meshBody' && !failed
      ? {
          fix: {
            label: `Hollow to a ${HOLLOW_WALL} mm wall`,
            ops: [
              {
                t: 'update' as const,
                id: body.id,
                patch: { hollow: HOLLOW_WALL, flatBack: Math.max(body.flatBack, 0.5) },
              },
            ],
          },
        }
      : {}),
  })
}

/** Where a bail stands on these host solids (world space), or at the origin with no host. */
function standOn(
  node: BailNode,
  hostSolids: readonly Solid[],
  hostStones: readonly Stone[] = [],
): { stand: Stand; bounds: Bounds | null } {
  const bounds = hostSolids.length > 0 ? unionBounds(hostSolids.map((s) => s.bounds())) : null
  const stand: Stand = bounds
    ? standPoint(hostSolids, bounds, node, hostStones)
    : {
        top: [0, 0, 0],
        lift: 0,
        sink: sinkFor(node.wire),
        supported: true,
        thick: node.wire,
        com: [0, 0, 0],
        hidden: (h) => ({ x: 0, zc: -node.wire - h / 2, back: 0, supported: true }),
      }
  return { stand, bounds }
}

/** How far a bail standing so hangs the piece turned from level, degrees, or null if it flips. */
function hangTilt(node: BailNode, stand: Stand): number | null {
  const pivot = stand.top[2] + stand.lift + openingRise(node, stand.sink) + node.opening / 2
  const lever = pivot - stand.com[2]
  if (lever <= 0) return null
  return (Math.atan2(Math.abs(stand.top[0] - stand.com[0]), lever) * 180) / Math.PI
}

/**
 * Whether standing a text body's letters on its bar (join: underline) would hang the piece
 * level. The bail stands again on the letters with the bar under them: the bar pulls the centre
 * of mass down, and between letters it may be the metal the bail stands on. On Ava, Zoe and Tej
 * the bar was offered and the piece still hung 7 to 9° off, the bail staying where it was.
 */
function barLevels(
  node: BailNode,
  solids: readonly Solid[],
  bounds: Bounds,
  stones: readonly Stone[],
  height: number,
): boolean {
  const { manifold: mf } = runtime()
  const depth = underlineDepth(height)
  const { min, max } = bounds
  // The bar runs under the full width, overlapping the letters' feet by half its depth; only
  // its part outside the letters is new metal (the bevel on its edges is left out).
  const box = mf.Manifold.cube([max[0] - min[0], max[1] - min[1], depth]).translate([
    min[0],
    min[1],
    min[2] - depth / 2,
  ])
  const piece = mf.Manifold.union(solids.map((s) => s.manifold(QUALITY.draft)))
  const added = box.subtract(piece)
  box.delete()
  piece.delete()
  if (added.isEmpty()) {
    added.delete()
    return false
  }
  const bar = solidFromManifold(added)
  try {
    const barred = [...solids, bar]
    const stand = standPoint(barred, unionBounds(barred.map((s) => s.bounds())), node, stones)
    if (!stand.supported) return false
    const tilt = hangTilt(node, stand)
    return tilt !== null && tilt <= HANG_TILT
  } finally {
    bar.dispose()
  }
}

/**
 * The bail's metal and opening for a node on these host solids, before the node's own
 * transform — for checks that try other sizes on the real builder instead of assuming the hole
 * scales (dfm/chains.ts). The caller owns and disposes the solids.
 */
export function bailGeometry(
  node: BailNode,
  hostSolids: readonly Solid[],
  hostStones: readonly Stone[] = [],
): { solids: Solid[]; opening: Vec3 } {
  return build(node, standOn(node, hostSolids, hostStones).stand)
}

/** Ray-box test: does the segment from `p` along `d` for `t` in [0, length] meet the box? */
function rayMeetsBox(p: Vec3, d: Vec3, length: number, box: Bounds): boolean {
  let lo = 0
  let hi = length
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]!) < 1e-12) {
      if (p[k]! < box.min[k]! || p[k]! > box.max[k]!) return false
      continue
    }
    const a = (box.min[k]! - p[k]!) / d[k]!
    const b = (box.max[k]! - p[k]!) / d[k]!
    lo = Math.max(lo, Math.min(a, b))
    hi = Math.min(hi, Math.max(a, b))
    if (lo > hi) return false
  }
  return true
}

/**
 * How much of each host stone's girdle the bail's metal hides, seen from the stone's table
 * (rays from far out along its axis back to just in front of the girdle). A stone behind
 * metal cannot be set or seen. Returns the stones hidden past STONE_HIDDEN with their share.
 */
function stonesHidden(
  solids: readonly Solid[],
  stones: readonly Stone[],
): { index: number; share: number }[] {
  if (stones.length === 0 || solids.length === 0) return []
  const box = unionBounds(solids.map((s) => s.bounds()))
  const meshes = solids.map((s) => s.manifold(QUALITY.draft))
  const FAR = 30
  const out: { index: number; share: number }[] = []
  stones.forEach((stone, index) => {
    const { origin: o, x: u, y: v, z: n } = stone.frame
    const a = stone.dims.width / 2
    const b = stone.dims.length / 2
    const r = Math.max(a, b)
    const grown: Bounds = {
      min: [box.min[0] - r, box.min[1] - r, box.min[2] - r],
      max: [box.max[0] + r, box.max[1] + r, box.max[2] + r],
    }
    if (!rayMeetsBox(o, n, FAR, grown)) return
    let total = 0
    let hidden = 0
    for (let i = -8; i <= 8; i++)
      for (let j = -8; j <= 8; j++) {
        if (i * i + j * j > 64) continue
        total++
        const at = (k: number, along: number) =>
          o[k]! + (i / 8) * a * u[k]! + (j / 8) * b * v[k]! + along * n[k]!
        const from: Vec3 = [at(0, FAR), at(1, FAR), at(2, FAR)]
        const to: Vec3 = [at(0, 0.05), at(1, 0.05), at(2, 0.05)]
        if (hits(meshes, from, to).length > 0) hidden++
      }
    if (hidden / total > STONE_HIDDEN) out.push({ index, share: hidden / total })
  })
  return out
}

/** Volume of the bail's metal that lies inside its host's, mm³: what casts them as one. */
function jointVolume(solids: readonly Solid[], host: readonly Solid[]): number {
  const { manifold: mf } = runtime()
  // Each side is united first: the strap and its rim tab overlap inside the rim.
  const bail = mf.Manifold.union(solids.map((s) => s.manifold(QUALITY.draft)))
  const piece = mf.Manifold.union(host.map((s) => s.manifold(QUALITY.draft)))
  const shared = bail.intersect(piece)
  try {
    return shared.volume()
  } finally {
    for (const m of [bail, piece, shared]) m.delete()
  }
}

/**
 * Share of a hidden bail seen from the front through an opening (a letter's counter, a pierced
 * plate): rays straight back across the bail's outline that meet its metal before any of the
 * piece's (`cover`: every body of the piece, not only the bail's host, since a plug standing in
 * a pierced plate hides the bail as well as the plate does).
 */
export function seenThrough(solids: readonly Solid[], cover: readonly Solid[]): number {
  const box = unionBounds(solids.map((s) => s.bounds()))
  const all = unionBounds([...solids, ...cover].map((s) => s.bounds()))
  const bailMeshes = solids.map((s) => s.manifold(QUALITY.draft))
  const hostMeshes = cover.map((s) => s.manifold(QUALITY.draft))
  const front = all.min[1] - 1
  const back = all.max[1] + 1
  const N = 12
  let seen = 0
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const x = box.min[0] + ((i + 0.5) / N) * (box.max[0] - box.min[0])
      const z = box.min[2] + ((j + 0.5) / N) * (box.max[2] - box.min[2])
      const toBail = hits(bailMeshes, [x, front, z], [x, back, z])
      if (toBail.length === 0) continue
      const toHost = hits(hostMeshes, [x, front, z], [x, back, z])
      if (toHost.length === 0 || Math.min(...toBail) < Math.min(...toHost)) seen++
    }
  return seen / (N * N)
}

export const bail = defineFeature('bail', (node, ctx) => {
  const host = node.host ? ctx.input(node.host) : null
  const { stand, bounds } = standOn(
    node,
    host?.bodies.map((b) => b.solid) ?? [],
    host?.stones ?? [],
  )
  const { solids, opening, supported, topOnly } = build(node, stand)
  if (host && supported) {
    const hidden = stonesHidden(solids, host.stones)
    if (hidden.length > 0) {
      const worst = Math.max(...hidden.map((h) => h.share))
      ctx.report({
        level: 'warning',
        code: 'bail.coversStone',
        message: `The bail stands across ${hidden.length} of the stones set in its host and hides up to ${(100 * worst).toFixed(0)} % of one from the front: a setter cannot reach ${hidden.length === 1 ? 'it' : 'them'}, and nobody sees ${hidden.length === 1 ? 'it' : 'them'}. Move the bail behind the stones, onto a stem above them, or leave those stones out.`,
        at: [...host.stones[hidden[0]!.index]!.frame.origin],
        value: worst,
        limit: STONE_HIDDEN,
        related: hidden.map((h) => `${host.id}:${h.index}`),
      })
    }
  }
  // Whether a hidden bail shows through an opening is judged against the whole piece, which
  // only the scene has (dfm/bails.ts).
  // How much of the loop is cast into the piece. Over an open back held at the ends of its back
  // run only (a small scooped trophy whose neck is too thin for a strap) it was a fifth of a
  // wire's length of the run, with nothing said.
  const joint =
    host && supported && node.style === 'hidden'
      ? jointVolume(
          solids,
          host.bodies.map((b) => b.solid),
        )
      : Infinity
  const least = JOINT_WIRES * node.wire * node.wire * node.width
  if (topOnly || joint < least)
    ctx.report({
      level: 'warning',
      code: 'bail.weakJoint',
      message: topOnly
        ? 'The back is open under the hidden bail and no metal below it takes a strap, so the loop is held by the top rim alone: a thin joint that a chain pulls on. Use a bail on top, or close the back under the loop.'
        : `The back is open under the hidden bail, so only ${joint.toFixed(1)} mm³ of the loop is cast into the piece, less than a wire's length of its back run (${least.toFixed(1)} mm³): a thin joint that a chain pulls on. Use a bail on top, or close the back under the loop.`,
      at: [...opening],
      ...(Number.isFinite(joint) ? { value: joint, limit: Number(least.toFixed(2)) } : {}),
      fix: {
        label: 'Use a tube bail on top',
        ops: [{ t: 'update' as const, id: node.id, patch: { style: 'tube' } }],
      },
    })
  if (!supported)
    ctx.report({
      level: 'error',
      code: 'bail.unsupported',
      message:
        node.style === 'hidden'
          ? 'The back of the piece is open near its centre of mass (no metal across the back plane for the hidden bail to lie in), so the bail would cast loose. Use a bail on top.'
          : 'There is no metal under the bail anywhere along the top of the piece, so it would cast loose. Give the piece a solid top edge, or place the bail by hand.',
      at: [...opening],
      ...(node.style === 'hidden'
        ? {
            fix: {
              label: 'Use a tube bail on top',
              ops: [{ t: 'update' as const, id: node.id, patch: { style: 'tube' } }],
            },
          }
        : {}),
    })
  if (supported && bounds) {
    // A chain runs through the hole along x, so the piece turns in its own plane about the top
    // of the hole until its centre of mass hangs under it. The bail stands over the centre of
    // mass when there is metal there; when the nearest metal that carries it is off to one side
    // (a gap between letters) the piece hangs crooked, which a bench jeweler would see at once.
    const pivot = opening[2] + node.opening / 2
    const lever = pivot - stand.com[2]
    const dx = opening[0] - stand.com[0]
    const tilt = (Math.atan2(Math.abs(dx), lever) * 180) / Math.PI
    // On text, standing the letters on a bar (join: underline) lowers the centre of mass under
    // the bail, which levels a short name hung from a letter beside it (Layla). It is offered
    // only where it does: where the bail stays as far off, the button promised a level hang and
    // the warning stayed.
    const body = host?.node
    const bar =
      lever > 0 &&
      tilt > HANG_TILT &&
      node.style !== 'hidden' &&
      body?.kind === 'vectorBody' &&
      body.source.type === 'text' &&
      body.join !== 'underline' &&
      barLevels(
        node,
        host!.bodies.map((b) => b.solid),
        bounds,
        host!.stones,
        body.height,
      )
        ? {
            fix: {
              label: 'Stand the letters on a bar',
              ops: [{ t: 'update' as const, id: body.id, patch: { join: 'underline' } }],
            },
          }
        : {}
    if (lever > 0 && tilt > HANG_TILT)
      ctx.report({
        level: 'warning',
        code: 'bail.offLevel',
        message: `The bail stands ${Math.abs(dx).toFixed(1)} mm ${dx > 0 ? 'right' : 'left'} of the piece's centre of mass, on the nearest metal that carries it, so the piece hangs turned about ${tilt.toFixed(0)}°. Give it metal over its centre of mass to stand on (join or thicken the letters there)${'fix' in bar ? ', stand the letters on a bar to bring the centre of mass down under it' : ''}, or hang it from two points.`,
        at: [...opening],
        value: Math.abs(dx),
        limit: Number((Math.tan((HANG_TILT * Math.PI) / 180) * lever).toFixed(2)),
        ...bar,
      })
  }
  if (host) heavyBody(host, ctx)
  if (node.style === 'hidden' && bounds && supported) {
    // Hung from a hole behind it, a piece turns until its centre of mass is under the hole: with
    // the hole low on the piece it tips well forward, and at or below the centre it flips. The
    // chest carries a flat back, so only a hole outside the top third or too near the centre
    // (a tenth of the height above it) is reported: the piece is too small to hide this bail.
    const height = bounds.max[2] - bounds.min[2]
    const tilt = (Math.atan2(opening[1] - stand.com[1], opening[2] - stand.com[2]) * 180) / Math.PI
    const low = opening[2] < Math.max(stand.com[2] + 0.1 * height, bounds.max[2] - height / 3)
    if (low)
      ctx.report({
        level: 'warning',
        code: 'bail.hiddenLow',
        message: `At ${height.toFixed(1)} mm the piece is too small to hide a ${node.opening} mm bail high enough behind it: the hole is ${opening[2] <= stand.com[2] ? 'below its centre of mass, so it would flip' : `close to its centre of mass, so it tips forward about ${tilt.toFixed(0)}°`}. Use a bail on top.`,
        at: [...opening],
        value: opening[2] - stand.com[2],
        limit: 0.1 * height,
        fix: {
          label: 'Use a tube bail on top',
          ops: [{ t: 'update', id: node.id, patch: { style: 'tube' } }],
        },
      })
  }
  if (node.opening < node.wire * 1.2)
    ctx.report({
      level: 'info',
      code: 'bail.tight',
      message:
        'The bail opening is barely larger than its wire; check that the chain end passes through.',
    })
  // A chain threads the opening along x.
  const frame: Frame = { origin: opening, x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }
  return {
    bodies: solids.map((solid) => ({ solid, ...metalOf(node) })),
    frames: { opening: frame },
  }
})
