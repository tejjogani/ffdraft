/**
 * Chains: cable, curb, Cuban/Miami, figaro, rope, box and tennis, laid straight along X or
 * draped as a necklace in the XZ plane — through a bail's `opening` frame when `through` is set.
 *
 * One body per chain: every link is a moved copy of one (or two) template links, so hundreds of
 * links cost one link's meshing plus a matrix multiply each (features/chain/instances.ts).
 */
import type { NodeOf } from '@pave/schema'
import { makeBox, type Shape3D } from 'replicad'
import {
  type BuildContext,
  defineFeature,
  type Frame,
  type IndexedTriangles,
  type Mat4,
  metalOf,
  type Quality,
  type Stone,
  type Vec3,
} from '../core'
import { IDENTITY, multiply, translation } from '../geometry/vec'
import { unionBounds } from '../solid/meshing'
import { booleanShapes } from '../solid/occt'
import { manifoldFromTriangles, trianglesFromManifold } from '../solid/solid'
import { sweepAlong } from './chain/centreline'
import { type ChainPath, drapePath, linkFrames, straightPath } from './chain/drape'
import { type Instance, instancedSolid, type Template } from './chain/instances'
import { type WireLink, wireChain } from './chain/links'
import { tennisLink } from './chain/tennis'

type ChainNode = NodeOf<'chain'>

/** What a style contributes before layout. */
interface ChainPlan {
  templates: Template[]
  period: { template: number; orient: Mat4 }[]
  pitches: number[]
  /** Half-extents of the chain section across its face (y) and through it (z). */
  half: { y: number; z: number }
  /** Tightest bend the links allow, mm. */
  minBend: number
  /** Longest link, for the drape's bend radius. */
  linkLength: number
  /** Stone carried by each link, in link-local space (tennis). */
  stone?: Omit<Stone, 'frame'> & { frame: Frame }
  wire: number
}

/**
 * Wire links read as smooth round wire down to 8 facets around (45° apart) while the Cuban's
 * diamond-cut flats, which meet the wire at ~66°, keep their crisp edge.
 */
const LINK_CREASE = (52 * Math.PI) / 180

/** Air between the chain and the top of the bail it rests in. */
const BAIL_CLEARANCE = 0.1

/** Sweep stations around a link: enough for the twisted ovals to stay true to their centreline. */
const LINK_STATIONS = 24

/** Grinds a wire link's faces flat at |z| = flat (the diamond cut), on its mesh. */
function grindMesh(tris: IndexedTriangles, flat: number): IndexedTriangles {
  const wire = manifoldFromTriangles(tris)
  const below = wire.trimByPlane([0, 0, -1], -flat)
  const ground = below.trimByPlane([0, 0, 1], -flat)
  try {
    return trianglesFromManifold(ground)
  } finally {
    for (const m of [wire, below, ground]) m.delete()
  }
}

/** …and on its exact B-rep. */
function grindBrep(shape: Shape3D, flat: number): Shape3D {
  const slab = makeBox([-1e3, -1e3, -flat], [1e3, 1e3, flat])
  try {
    return booleanShapes('intersect', shape, [slab])
  } finally {
    slab.delete()
  }
}

/**
 * A wire link as an instancing template. The sweep is rebuilt inside each recipe call: it is
 * cheap, and keeps the recipe free of WASM objects.
 */
function wireTemplate(link: WireLink): Template {
  const sweep = () => sweepAlong(link.centreline(LINK_STATIONS), link.profile)
  return {
    crease: LINK_CREASE,
    mesh(quality: Quality) {
      const solid = sweep()
      try {
        const tris = solid.triangles(quality)
        return link.flat === undefined ? tris : grindMesh(tris, link.flat)
      } finally {
        solid.dispose()
      }
    },
    brep() {
      const solid = sweep()
      try {
        const shape = solid.brep()!
        return link.flat === undefined ? shape.clone() : grindBrep(shape, link.flat)
      } finally {
        solid.dispose()
      }
    },
  }
}

function planFor(node: ChainNode): ChainPlan {
  if (node.style === 'tennis') {
    const link = tennisLink(node.linkWidth, node.wire, node.cut)
    // Hang each link from its middle, so the chain's centre line runs through the links.
    const centred = translation([0, 0, -link.middle])
    return {
      templates: [link.template],
      period: [{ template: 0, orient: centred }],
      pitches: [link.pitch],
      half: link.half,
      minBend: link.minBend,
      linkLength: link.length,
      wire: node.wire,
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
  const chain = wireChain(node.style, node.linkWidth, node.wire)
  const lengths = chain.links.map((l) => {
    const pts = l.centreline(32).points
    let max = 0
    for (let i = 0; i < pts.length; i += 3) max = Math.max(max, Math.abs(pts[i]!))
    return 2 * max + chain.wire
  })
  const linkLength = Math.max(...lengths)
  return {
    templates: chain.links.map(wireTemplate),
    period: chain.period.map((p) => ({ template: p.link, orient: p.orient })),
    pitches: chain.pitches,
    half: chain.half,
    minBend: 2 * linkLength,
    linkLength,
    wire: chain.wire,
  }
}

/**
 * Where the chain's low point goes: resting in its bail's opening, or (no bail, or the bail is
 * not available) centred on the origin.
 */
function anchor(
  node: ChainNode,
  ctx: BuildContext,
  path: ChainPath,
  halfUp: number,
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
  if (bail && opening) {
    // Gravity seats the chain against the inside top of the bail: find it straight above the
    // opening's centre, whatever the bail's shape.
    const [x, y, z] = opening.origin
    const top = Math.min(
      ...bail.bodies.map(
        (b) =>
          b.solid.manifold(ctx.quality).rayCast([x, y, z], [x, y, z + 1e3])[0]?.position[2] ?? z,
      ),
    )
    // The chain stays curved across the bail's width, so it sags below the top at its edges.
    const box = unionBounds(bail.bodies.map((b) => b.solid.bounds()))
    const sag = ((box.max[0] - box.min[0]) / 2) ** 2 / (2 * bend)
    const lift = Math.max(0, top - z - halfUp - BAIL_CLEARANCE - sag)
    const low = path.closed ? path.at(0).point : path.at(path.length / 2).point
    return translation([x - low[0], y - low[1], z - low[2] + lift])
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
  return Array.from({ length: count }, (_, i) => {
    const p = path.at((i / samples) * path.length).point
    return [
      place[0]! * p[0] + place[4]! * p[1] + place[8]! * p[2] + place[12]!,
      place[1]! * p[0] + place[5]! * p[1] + place[9]! * p[2] + place[13]!,
      place[2]! * p[0] + place[6]! * p[1] + place[10]! * p[2] + place[14]!,
    ] as Vec3
  })
}

/** Facts published for dependents and exporters (node-local space). */
export interface ChainData {
  links: number
  /** Actual length: a whole number of link repeats closest to the requested length. */
  length: number
  /** The chain's widest section, for bail-opening checks. */
  width: number
  wire: number
  path: Vec3[]
  closed: boolean
}

export const chain = defineFeature('chain', (node, ctx) => {
  const reps = (perPeriod: number, periodLength: number) =>
    Math.max(1, Math.round(node.length / periodLength)) * perPeriod
  const plan = planFor(node)
  const periodLength = plan.pitches.reduce((a, b) => a + b, 0)
  const n = reps(plan.period.length, periodLength)
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
  const frames = linkFrames(path, centres, Math.min(...plan.pitches) / 2)
  const place = anchor(
    node,
    ctx,
    path,
    draped ? plan.half.y : plan.half.z,
    draped ? bend : Infinity,
  )

  const instances: Instance[] = frames.map((frame, k) => {
    const { template, orient } = plan.period[k % plan.period.length]!
    return { template, matrix: multiply(place, multiply(frame, orient)) }
  })
  const stones: Stone[] = plan.stone
    ? frames.map((frame) => {
        const matrix = multiply(place, frame)
        const f = plan.stone!.frame
        const dir = (v: Vec3): Vec3 => [
          matrix[0]! * v[0] + matrix[4]! * v[1] + matrix[8]! * v[2],
          matrix[1]! * v[0] + matrix[5]! * v[1] + matrix[9]! * v[2],
          matrix[2]! * v[0] + matrix[6]! * v[1] + matrix[10]! * v[2],
        ]
        const o = f.origin
        const at = (k: number) =>
          matrix[k]! * o[0] + matrix[k + 4]! * o[1] + matrix[k + 8]! * o[2] + matrix[k + 12]!
        return {
          ...plan.stone!,
          frame: { origin: [at(0), at(1), at(2)], x: dir(f.x), y: dir(f.y), z: dir(f.z) },
        }
      })
    : []

  if (plan.wire < node.wire - 1e-9)
    ctx.report({
      level: 'info',
      code: 'chain.wireThinned',
      message: `${node.wire} mm wire cannot interlock ${node.style} links ${node.linkWidth} mm wide; ${plan.wire.toFixed(2)} mm wire was used.`,
      value: plan.wire,
      limit: node.wire,
    })

  const data: ChainData = {
    links: n,
    length,
    width: 2 * Math.max(plan.half.y, plan.half.z),
    wire: plan.wire,
    path: pathPolyline(path, place),
    closed: path.closed,
  }
  return {
    bodies: [{ solid: instancedSolid(plan.templates, instances), ...metalOf(node) }],
    stones,
    data,
  }
})
