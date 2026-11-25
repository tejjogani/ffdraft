/**
 * Chains: cable, curb, Cuban/Miami, figaro, rope, box and tennis, laid straight along X or
 * draped as a necklace in the XZ plane — through a bail's `opening` frame when `through` is set.
 *
 * One body per chain: every link is a moved copy of one (or two) template links, so hundreds of
 * links cost one link's meshing plus a matrix multiply each (features/chain/instances.ts).
 */
import type { NodeOf } from '@pave/schema'
import {
  type BuildContext,
  defineFeature,
  type Frame,
  type Mat4,
  metalOf,
  QUALITY,
  runtime,
  type Stone,
  type Vec3,
} from '../core'
import {
  addScaled,
  cross,
  frameMatrix,
  IDENTITY,
  multiply,
  transformFrame,
  transformPoint,
  translation,
} from '../geometry/vec'
import { trianglesFromManifold } from '../solid/solid'
import { boxClasp, boxMin, type Clasp, lobsterClasp, lobsterMin, toward } from './chain/clasp'
import { type ChainPath, drapePath, linkFrames, straightPath } from './chain/drape'
import { type Instance, instancedSolid, type Template } from './chain/instances'
import { type LinkSet, wireChain } from './chain/links'
import { type ChainSection, holeProfile, seatHeight } from './chain/seat'
import { NoRoomForHinge, type TennisLink, tennisLink } from './chain/tennis'

type ChainNode = NodeOf<'chain'>

/** What a style contributes before layout: its links, and for tennis the stone each one holds. */
interface ChainPlan extends LinkSet {
  /** Stone carried by each link, in link-local space (tennis). */
  stone?: Omit<Stone, 'frame'> & { frame: Frame }
}

/** Air between the chain and the bail it rests in. */
const BAIL_CLEARANCE = 0.1

/** Widest a tennis link is made when the asked width leaves no room for its hinge, mm. */
const TENNIS_SEARCH = 4

/**
 * The tennis link at the asked width, or, when that is too narrow to carry its hinge under the
 * stone (the node accepts links from 0.8 mm), the narrowest width that does, in 0.1 mm steps:
 * a chain that builds a little wider, said so with a one-click fix, rather than no chain.
 */
function tennisAtLeast(node: ChainNode, ctx: BuildContext): TennisLink {
  for (let width = node.linkWidth; ; width = Math.round(width * 10 + 1) / 10) {
    try {
      const link = tennisLink(width, node.wire, node.cut)
      if (width > node.linkWidth)
        ctx.report({
          level: 'warning',
          code: 'chain.widthRaised',
          message: `Tennis links ${node.linkWidth} mm wide leave no room for the hinge under the stone; the narrowest that carries it, ${width} mm, was built.`,
          value: node.linkWidth,
          limit: width,
          fix: {
            label: `Make the links ${width} mm`,
            ops: [{ t: 'update', id: node.id, patch: { linkWidth: width } }],
          },
        })
      return link
    } catch (error) {
      if (!(error instanceof NoRoomForHinge) || width >= node.linkWidth + TENNIS_SEARCH) throw error
    }
  }
}

function planFor(node: ChainNode, ctx: BuildContext): ChainPlan {
  if (node.style !== 'tennis') return wireChain(node.style, node.linkWidth, node.wire)
  const link = tennisAtLeast(node, ctx)
  // Hang each link from its middle, so the chain's centre line runs through the links.
  const centred = translation([0, 0, -link.middle])
  return {
    templates: [link.template],
    period: [{ template: 0, orient: centred }],
    pitches: [link.pitch],
    half: link.half,
    minBend: link.minBend,
    linkLength: link.length,
    wire: link.prong,
    stone: {
      cut: node.cut,
      stone: node.stone,
      dims: link.dims,
      // Stone length runs along the chain.
      frame: { origin: [0, 0, -link.middle], x: [0, -1, 0], y: [1, 0, 0], z: [0, 0, 1] },
      role: 'accent',
      setting: 'four-prong',
    },
  }
}

/**
 * The chain's section as it hangs: up the bail's opening, and across it. Seen end on, cable
 * links (alternately flat and turned) and rope fill an ellipse; curb-family links lie flat and
 * fill their box out to the corners, as do box links and tennis settings.
 */
const sectionOf = (node: ChainNode, plan: ChainPlan, draped: boolean): ChainSection => ({
  ...(draped ? { up: plan.half.y, across: plan.half.z } : { up: plan.half.z, across: plan.half.y }),
  round: node.style === 'cable' || node.style === 'rope',
})

/**
 * Where the chain's low point goes: resting in its bail's opening — threading along the
 * opening's x with its up along the opening's z — or, with no bail, centred on the origin.
 */
function anchor(
  node: ChainNode,
  ctx: BuildContext,
  path: ChainPath,
  section: ChainSection,
  bend: number,
): Mat4 {
  const bail = node.through ? ctx.tryInput(node.through) : null
  if (node.through && !bail)
    ctx.report({
      level: 'info',
      code: 'chain.unhung',
      message:
        'The bail this chain passes through is not available, so the chain hangs on its own.',
    })
  const opening = bail?.frames.opening
  const low = path.closed ? path.at(0).point : path.at(path.length / 2).point
  if (bail && opening) {
    const hole = holeProfile(bail.bodies, opening, ctx.quality)
    // The chain stays curved across the bail, so it climbs above its seat where it leaves.
    const halfSpan = Math.max(
      ...bail.bodies.flatMap((b) => {
        const { min, max } = b.solid.bounds()
        return [min, max].map((p) =>
          Math.abs([0, 1, 2].reduce((s, k) => s + (p[k]! - opening.origin[k]!) * opening.x[k]!, 0)),
        )
      }),
    )
    const sag = Number.isFinite(bend) ? halfSpan ** 2 / (2 * bend) : 0
    // A chain that does not fit is centred in the hole; the bail check reports it.
    const lift = hole
      ? (seatHeight(hole, section, BAIL_CLEARANCE, sag) ?? (hole.top + hole.bottom) / 2)
      : 0
    const seat: Frame = { ...opening, origin: addScaled(opening.origin, opening.z, lift) }
    return multiply(frameMatrix(seat), translation([-low[0], -low[1], -low[2]]))
  }
  if (!path.closed) return IDENTITY
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < 256; i++) {
    const z = path.at((i / 256) * path.length).point[2]
    lo = Math.min(lo, z)
    hi = Math.max(hi, z)
  }
  return translation([0, 0, -(lo + hi) / 2])
}

/** A polyline of the chain's centre path, for curve exports (3DM). */
function pathPolyline(path: ChainPath, place: Mat4): Vec3[] {
  const samples = Math.max(16, Math.ceil(path.length / 2))
  const count = path.closed ? samples : samples + 1
  return Array.from({ length: count }, (_, i) =>
    transformPoint(place, path.at((i / samples) * path.length).point),
  )
}

/**
 * Where the clasp goes on a closed drape: in place of the fewest links at the back of the loop
 * (opposite its low point, where a clasp sits on the neck) that leave it room. Returns the
 * indices of the links it replaces, the clasp sized to the gap they leave, and its frame (x
 * along the chord from the farthest metal of the last link before it to the nearest of the
 * first after it, z toward the chain's face).
 */
function claspAt(
  node: ChainNode,
  plan: ChainPlan,
  path: ChainPath,
  centres: readonly number[],
): { dropped: Set<number>; clasp: Clasp; frame: Frame } | null {
  if (node.clasp === 'none' || !path.closed || centres.length < 4) return null
  const top = path.length / 2
  const tennis = node.style === 'tennis'
  // How far a link's metal reaches ahead of its centre and behind it: half its length for wire
  // links, more for a tennis link, whose hinge tongue reaches under the next box.
  let ahead = plan.linkLength / 2
  let behind = -plan.linkLength / 2
  for (const t of plan.templates) {
    const p = t.mesh(QUALITY.draft).positions
    for (let i = 0; i < p.length; i += 3) {
      ahead = Math.max(ahead, p[i]!)
      behind = Math.min(behind, p[i]!)
    }
  }
  const least = tennis ? boxMin(2 * plan.half.y) : lobsterMin(node.linkWidth, plan.wire)
  // Links nearest the top first; the nearest m form one run.
  const order = centres.map((s, i) => ({ i, d: Math.abs(s - top) })).sort((a, b) => a.d - b.d)
  for (let m = 1; m <= centres.length - 2; m++) {
    const run = order.slice(0, m).map((o) => o.i)
    const first = Math.min(...run)
    const last = Math.max(...run)
    if (first === 0 || last === centres.length - 1) return null
    const sa = centres[first - 1]!
    const sb = centres[last + 1]!
    const a0 = path.at(sa + ahead).point
    const b0 = path.at(sb + behind).point
    const x = toward(a0, b0)
    // On a tight curve (a bracelet's) the end links and the straight clasp meet at an angle, and
    // their corners reach across the gap by their width where they meet times its sine: each end
    // stands off by that much (a box clasp touched the next box at the back of a 180 mm line).
    // A box clasp meets a box across its whole width; a lobster's round eye and its ring meet
    // round link ends, which clear by the clasp's own clearance.
    const standOff = (s: number) => {
      const t = toward(
        path.at(s - plan.linkLength / 2).point,
        path.at(s + plan.linkLength / 2).point,
      )
      const cos = Math.min(1, Math.abs(t[0] * x[0] + t[1] * x[1] + t[2] * x[2]))
      return tennis ? 2 * plan.half.y * Math.sqrt(1 - cos * cos) : 0
    }
    const a = addScaled(a0, x, standOff(sa))
    const b = addScaled(b0, x, -standOff(sb))
    const span = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    if (span < least) continue
    const f = path.face
    const along = f[0] * x[0] + f[1] * x[1] + f[2] * x[2]
    const z = toward([0, 0, 0], [f[0] - along * x[0], f[1] - along * x[1], f[2] - along * x[2]])
    const frame: Frame = { origin: a, x, y: cross(z, x), z }
    const clasp = tennis
      ? boxClasp(2 * plan.half.y, 1.6 * plan.half.z, span)
      : lobsterClasp(node.linkWidth, plan.wire, span)
    return { dropped: new Set(run), clasp, frame }
  }
  return null
}

/**
 * The clasp as one more part of the chain's body, in clasp-local space: one copy, placed by its
 * frame, meshed at full quality (a link's share of the triangle budget would lose its shape).
 */
function claspTemplate(clasp: Clasp): Template {
  return {
    fixed: true,
    mesh: (quality) => {
      const { manifold: mf } = runtime()
      const owned: { delete(): void }[] = []
      const own = <T extends { delete(): void }>(m: T): T => {
        owned.push(m)
        return m
      }
      try {
        return trianglesFromManifold(own(mf.Manifold.union(clasp.parts(own, quality))))
      } finally {
        for (const m of owned) m.delete()
      }
    },
  }
}

/** Facts published for dependents, checks and exporters (node-local space). */
export interface ChainData {
  links: number
  /** Actual length: a whole number of link repeats closest to the requested length. */
  length: number
  /** The chain's widest section, for bail-opening checks. */
  width: number
  /** The section as it hangs through a bail: half-extents up the opening and across it. */
  section: ChainSection
  wire: number
  path: Vec3[]
  /** False once a clasp opens the loop. */
  closed: boolean
  /** The clasp that opens the chain, when it has one. */
  clasp?: { style: 'lobster' | 'box'; length: number }
}

export const chain = defineFeature('chain', (node, ctx) => {
  const plan = planFor(node, ctx)
  const periodLength = plan.pitches.reduce((a, b) => a + b, 0)
  const n = Math.max(1, Math.round(node.length / periodLength)) * plan.period.length
  const centres: number[] = []
  let s = 0
  for (let k = 0; k < n; k++) {
    centres.push(s)
    s += plan.pitches[k % plan.pitches.length]!
  }
  const draped = node.layout === 'drape'
  const length = draped ? s : s - plan.pitches[(n - 1) % plan.pitches.length]!
  const bend = Math.max(plan.minBend, node.through ? Math.max(6, 3 * plan.linkLength) : 25)
  const path = draped ? drapePath(length, bend) : straightPath(length)
  if (path.minRadius < plan.minBend * 0.99)
    ctx.report({
      level: 'warning',
      code: 'chain.tight',
      message: `A ${length.toFixed(0)} mm chain closes into a ${path.minRadius.toFixed(0)} mm radius, tighter than these links can bend (${plan.minBend.toFixed(0)} mm): neighbouring links would collide. Lengthen the chain or use narrower links.`,
      value: path.minRadius,
      limit: plan.minBend,
    })
  const frames = linkFrames(path, centres, Math.min(...plan.pitches) / 2)
  const section = sectionOf(node, plan, draped)
  const place = anchor(node, ctx, path, section, draped ? bend : Infinity)

  // A clasp opens a draped chain at the back, in place of the links there.
  const clasp = draped ? claspAt(node, plan, path, centres) : null
  const kept = (k: number) => !clasp?.dropped.has(k)
  const instances: Instance[] = frames.flatMap((frame, k) => {
    if (!kept(k)) return []
    const { template, orient } = plan.period[k % plan.period.length]!
    return [{ template, matrix: multiply(place, multiply(frame, orient)) }]
  })
  const stones: Stone[] = plan.stone
    ? frames.flatMap((frame, k) =>
        kept(k)
          ? [{ ...plan.stone!, frame: transformFrame(multiply(place, frame), plan.stone!.frame) }]
          : [],
      )
    : []

  if (plan.wire < node.wire - 1e-9)
    ctx.report({
      level: 'info',
      code: 'chain.wireThinned',
      message: `${node.wire} mm wire is too heavy for ${node.style} links ${node.linkWidth} mm wide; ${plan.wire.toFixed(2)} mm wire was used.`,
      value: plan.wire,
      limit: node.wire,
    })

  // The clasp is one more part of the chain's one body: its shells stay apart from the links'.
  const templates = clasp ? [...plan.templates, claspTemplate(clasp.clasp)] : plan.templates
  if (clasp)
    instances.push({
      template: templates.length - 1,
      matrix: multiply(place, frameMatrix(clasp.frame)),
    })
  const { solid, reduced } = instancedSolid(templates, instances)
  if (reduced(ctx.quality))
    ctx.report({
      level: 'info',
      code: 'chain.simplified',
      message: `The ${n} links were meshed coarser than ${ctx.detail} detail to keep the chain's triangle count down; its volume and weight are unaffected.`,
    })

  const ends = clasp
    ? {
        end0: transformFrame(place, clasp.frame),
        end1: transformFrame(place, {
          ...clasp.frame,
          origin: addScaled(clasp.frame.origin, clasp.frame.x, clasp.clasp.span),
        }),
      }
    : undefined
  const data: ChainData = {
    links: n - (clasp?.dropped.size ?? 0),
    length,
    width: 2 * Math.max(plan.half.y, plan.half.z),
    section,
    wire: plan.wire,
    path: pathPolyline(path, place),
    closed: path.closed && !clasp,
    ...(clasp ? { clasp: { style: clasp.clasp.style, length: clasp.clasp.length } } : {}),
  }
  return { bodies: [{ solid, ...metalOf(node) }], stones, data, ...(ends ? { frames: ends } : {}) }
})
