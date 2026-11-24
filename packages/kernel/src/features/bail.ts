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
  type Solid,
} from '../core'
import { circleLoop, type Loop, roundedRectLoop } from '../geometry/loop'
import { pathFrames } from '../geometry/path'
import { placeLoop, sweepSolid } from '../geometry/sweep'
import type { Frame, Vec3 } from '../geometry/vec'
import { type IndexedTriangles, meshVolume, unionBounds } from '../solid/meshing'
import type { Bounds } from '../types'

type BailNode = NodeOf<'bail'>

/** Least depth the bail's foot is sunk into its host so the two cast as one, mm. */
const SINK = 0.3
/** The foot sinks by this share of its wire, so a heavy bail is held by a heavy joint. */
const SINK_PER_WIRE = 0.5
/** Step of the search for metal to stand on, outward from the centre of mass, mm. */
const STEP = 0.25
/** Samples across the host's thickness when looking for the metal under the foot. */
const ACROSS = 9
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
/** The wall a hollowed body keeps, mm: enough under a 1.3 mm pavé seat (0.65 × stone + 0.4). */
const HOLLOW_WALL = 1.25

const sinkFor = (wire: number) => Math.max(SINK, SINK_PER_WIRE * wire)

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
): { solids: Solid[]; opening: Vec3; supported: boolean } {
  const { opening, width, wire } = node
  const [x, y, foot] = stand.top
  const SINK = sinkFor(wire)
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
      // The centreline's lowest point is `SINK` into the metal, as for every style.
      const centre: Vec3 = [x, y, z - SINK + (opening + wire) / 2]
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
      const centre: Vec3 = [x, y, z - SINK + (opening + wire) / 2]
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
      // The back run's inner face is flush with the host's back.
      const y0 = place.back - wire / 2
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
      return {
        solids: [band(path, true, () => flat(width))],
        opening: [x, y0 + depth / 2, zc],
        supported: place.supported,
      }
    }
    default: {
      // A teardrop: narrow where it joins the piece, opening out above. Both ends are sunk in.
      // `opening` is the clear hole both ways: the centreline is opening + wire high and, at
      // its widest, opening + wire across, so a chain that passes the height passes the width.
      const h = opening + wire
      const w = opening + wire
      const count = 28
      const path: Vec3[] = Array.from({ length: count + 1 }, (_, i) => {
        const t = (i / count) * 2 * Math.PI
        const spread = Math.sin(t / 2) ** 0.7 / LOOP_SPREAD
        return [
          x,
          y + (w / 2) * Math.sin(t) * spread + 0.18 * wire * Math.cos(t / 2),
          z - SINK + (h / 2) * (1 - Math.cos(t)),
        ]
      })
      // The band is narrower at its foot and full width over the top.
      const section = (i: number) => flat(width * (0.55 + 0.45 * Math.sin((i / count) * Math.PI)))
      return {
        solids: [band(path, false, section), ...stem(flat(width * 0.55))],
        opening: [x, y, z - SINK + h * 0.6],
        supported: stand.supported,
      }
    }
  }
}

/** Peak of sin t · sin(t/2)^0.7, the teardrop's unscaled half-width: dividing by it makes the
 *  loop's widest centreline exactly its nominal width. */
const LOOP_SPREAD = (() => {
  let peak = 0
  for (let i = 0; i <= 2000; i++) {
    const t = (i / 2000) * 2 * Math.PI
    peak = Math.max(peak, Math.sin(t) * Math.sin(t / 2) ** 0.7)
  }
  return peak
})()

/** Where the bail stands on its host, and what the hidden style needs to place itself. */
interface Stand {
  /** Top of the metal under the foot's centre: x, y and z of real metal. */
  top: Vec3
  /** How far the bail rises on a stem above its foot to clear taller metal beside it, mm. */
  lift: number
  /** False when no metal was found under the foot (the bail then stands on the highest point). */
  supported: boolean
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
function standPoint(solids: readonly Solid[], bounds: Bounds, node: BailNode): Stand {
  const meshes = solids.map((s) => s.manifold(QUALITY.draft))
  const tris = solids.map((s) => s.triangles(QUALITY.draft))
  // Centre of mass of all the host's bodies, by volume.
  let mass = 0
  const sum = [0, 0, 0]
  for (const t of tris) {
    const v = meshVolume(t)
    const c = centroid(t)
    mass += v
    for (let k = 0; k < 3; k++) sum[k]! += v * c[k]!
  }
  const [cx, cy, cz] = sum.map((v, k) =>
    mass > 0 ? v / mass : (bounds.min[k]! + bounds.max[k]!) / 2,
  )
  const com: Vec3 = [cx!, cy!, cz!]
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
  const ys = Array.from(
    { length: ACROSS },
    (_, i) => bounds.min[1] + ((i + 0.5) / ACROSS) * (bounds.max[1] - bounds.min[1]),
  )
  /** The metal carrying a foot centred at x: its top, the middle of its thickness, its depth. */
  const footAt = (x: number): { at: Vec3; run: number } | null => {
    const columns = ys.map((y) => ({ y, c: columnAt(x, y) }))
    let best: { y: number; z: number; run: number } | null = null
    for (const { y, c } of columns) if (c && (!best || c.z > best.z)) best = { y, ...c }
    if (!best) return null
    // The foot stands across the metal that is near the top there (a plate's thickness).
    const near = columns.filter((t) => t.c && t.c.z > best!.z - node.wire)
    const y = (Math.min(...near.map((t) => t.y)) + Math.max(...near.map((t) => t.y))) / 2
    const centre = columnAt(x, y) ?? best
    // Both ends of the foot must have metal under them too; the foot sinks to the lowest. A
    // ring stands on its round wire alone.
    const sides = (node.style === 'ring' ? [] : [x - half, x + half]).map((sx) => columnAt(sx, y))
    if (sides.some((c) => c === null)) return null
    const z = Math.min(centre.z, ...sides.map((c) => c!.z))
    return { at: [x, y, z], run: Math.min(centre.run, ...sides.map((c) => c!.run)) }
  }
  const span = bounds.max[0] - bounds.min[0]
  // Nearest the centre of mass first: hanging level matters more than standing on the very top.
  let top: Vec3 | null = null
  for (let d = 0; d <= span / 2 && !top; d += STEP)
    for (const x of d > 0 ? [com[0] + d, com[0] - d] : [com[0]]) {
      const foot = footAt(x)
      if (foot && foot.run >= need) {
        top = foot.at
        break
      }
    }
  // Nothing anywhere carries the foot: stand on the highest point so the problem is visible.
  let supported = true
  if (!top) {
    supported = false
    top = [com[0], (bounds.min[1] + bounds.max[1]) / 2, bounds.max[2]]
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
        clear = over
        break search
      }
  }
  const lift = node.style === 'hidden' ? 0 : clear - top[2]
  const stood = top
  return {
    top: stood,
    lift,
    supported,
    com,
    hidden: hiddenPlace,
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
      // Metal only far in front of the back is the far wall of an open or scooped back.
      return y !== null && y > bounds.max[1] - 2 * node.wire ? y : null
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
        hangsFromTop ??= { x, zc, back: high, supported: true }
      }
    return (
      hangsFromTop ?? {
        x: com[0],
        zc: stood[2] - node.wire - h / 2,
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
  if (body.kind === 'meshBody' && body.hollow > 0) return
  const metal = host.bodies[0]?.material
  if (!metal) return
  const grams = metalMassG(
    metal,
    host.bodies.reduce((sum, b) => sum + b.solid.volume(), 0),
  )
  if (grams <= HEAVY_G) return
  const what = `${grams.toFixed(0)} g of ${METALS[metal].label}`
  ctx.report({
    level: 'warning',
    code: 'body.heavy',
    message:
      body.kind === 'meshBody'
        ? `The piece is cast solid: ${what} hanging from the bail. Hollow it from the back to a ${HOLLOW_WALL} mm wall, which still takes 1.3 mm pavé seats.`
        : `The piece is cast solid: ${what} hanging from the bail. ${body.kind === 'vectorBody' ? 'An outline body cannot be hollowed yet: make the plate thinner, or build the piece as a sculpted body and hollow that.' : 'Make the base thinner, or build the piece as a sculpted body and hollow that.'}`,
    value: grams,
    limit: HEAVY_G,
    ...(body.kind === 'meshBody'
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
): { stand: Stand; bounds: Bounds | null } {
  const bounds = hostSolids.length > 0 ? unionBounds(hostSolids.map((s) => s.bounds())) : null
  const stand: Stand = bounds
    ? standPoint(hostSolids, bounds, node)
    : {
        top: [0, 0, 0],
        lift: 0,
        supported: true,
        com: [0, 0, 0],
        hidden: (h) => ({ x: 0, zc: -node.wire - h / 2, back: 0, supported: true }),
      }
  return { stand, bounds }
}

/**
 * The bail's metal and opening for a node on these host solids, before the node's own
 * transform — for checks that try other sizes on the real builder instead of assuming the hole
 * scales (dfm/chains.ts). The caller owns and disposes the solids.
 */
export function bailGeometry(
  node: BailNode,
  hostSolids: readonly Solid[],
): { solids: Solid[]; opening: Vec3 } {
  return build(node, standOn(node, hostSolids).stand)
}

export const bail = defineFeature('bail', (node, ctx) => {
  const host = node.host ? ctx.input(node.host) : null
  const { stand, bounds } = standOn(node, host?.bodies.map((b) => b.solid) ?? [])
  const { solids, opening, supported } = build(node, stand)
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
    if (lever > 0 && tilt > HANG_TILT)
      ctx.report({
        level: 'warning',
        code: 'bail.offLevel',
        message: `The bail stands ${Math.abs(dx).toFixed(1)} mm ${dx > 0 ? 'right' : 'left'} of the piece's centre of mass, on the nearest metal that carries it, so the piece hangs turned about ${tilt.toFixed(0)}°. Give it metal over its centre of mass to stand on (join or thicken the letters there), or hang it from two points.`,
        at: [...opening],
        value: Math.abs(dx),
        limit: Number((Math.tan((HANG_TILT * Math.PI) / 180) * lever).toFixed(2)),
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
