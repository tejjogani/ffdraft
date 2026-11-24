/**
 * Findings: an earring post (with its friction notch) on the back of its host, a butterfly
 * back on the notch of the post it is hosted on, a jump ring and a lobster clasp on top of
 * their host.
 * Without a host they stand at the origin: posts along +Y (the back of a piece facing −Y),
 * rings and clasps on +Z.
 */
import type { NodeOf } from '@pave/schema'
import { makeCylinder } from 'replicad'
import {
  type BuildContext,
  defineFeature,
  type Frame,
  metalOf,
  type NodeResult,
  type Solid,
  solidFromBrep,
  solidFromManifold,
  type Vec3,
} from '../core'
import { frameFromZ, frameMatrix } from '../geometry/vec'
import { RULES } from '../rules'
import { unionBounds } from '../solid/meshing'
import { manifoldFromTriangles } from '../solid/solid'
import {
  butterflyMesh,
  EMBED,
  lobsterEyeWire,
  lobsterMesh,
  notchFromTip,
  postShape,
  ringShape,
} from './finding/shapes'

type FindingNode = NodeOf<'finding'>

/** With no post to ride on, a butterfly sits where a stock post's notch would be (01-cad.md §2: 10–11 mm posts). */
const STOCK_POST = 10
/** Stock butterfly backs span 4–7 mm (5–6 mm typical); `length` sets it at about half. */
const butterflySpan = (length: number) => Math.min(7, Math.max(4, 0.55 * length))
/** How far a post pad may reach to find metal, and how thick it is, mm. */
const PAD_REACH = 4
const PAD_THICKNESS = 0.5

/**
 * The point where a ray from outside the host toward its centre first meets metal: the middle
 * of the host's back (`direction` = +Y of the host) or top (`direction` = +Z).
 */
function surfacePoint(host: NodeResult, direction: Vec3, ctx: BuildContext): Vec3 {
  const box = unionBounds(host.bodies.map((b) => b.solid.bounds()))
  const centre: Vec3 = [0, 1, 2].map((k) => (box.min[k]! + box.max[k]!) / 2) as unknown as Vec3
  const reach = Math.hypot(...box.max.map((v, k) => v - box.min[k]!)) + 1
  const from: Vec3 = [
    centre[0] + direction[0] * reach,
    centre[1] + direction[1] * reach,
    centre[2] + direction[2] * reach,
  ]
  let best: { distance: number; position: Vec3 } | null = null
  for (const body of host.bodies) {
    const hit = body.solid.manifold(ctx.quality).rayCast([...from], [...centre])[0]
    if (hit && (!best || hit.distance < best.distance))
      best = { distance: hit.distance, position: hit.position }
  }
  // A ray through an open basket can miss: fall back to the bounding box face.
  return (
    best?.position ?? [
      centre[0] + (direction[0] * (box.max[0]! - box.min[0]!)) / 2,
      centre[1] + (direction[1] * (box.max[1]! - box.min[1]!)) / 2,
      centre[2] + (direction[2] * (box.max[2]! - box.min[2]!)) / 2,
    ]
  )
}

/** Pieces face −Y (schema convention), so a post leaves the back along +Y. */
const BACK: Vec3 = [0, 1, 0]

/** Where a post leaves its host: the host's `back` frame if it has one, else the middle of its back. */
function backMount(host: NodeResult | null, ctx: BuildContext): Frame {
  if (host?.frames.back) return host.frames.back
  return frameFromZ(host ? surfacePoint(host, BACK, ctx) : [0, 0, 0], BACK, [1, 0, 0])
}

/** The top centre of the host (where a piece hangs from), z up, facing −Y like the piece. */
function topMount(host: NodeResult | null, ctx: BuildContext): Frame {
  const origin: Vec3 = host ? surfacePoint(host, [0, 0, 1], ctx) : [0, 0, 0]
  return { origin, x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }
}

/** Inside a host's metal: a ray from the point crosses its surface an odd number of times. */
function inMetal(host: NodeResult, p: Vec3, ctx: BuildContext): boolean {
  const far: [number, number, number] = [p[0], p[1], p[2] + 1e3]
  return host.bodies.some(
    (b) => b.solid.manifold(ctx.quality).rayCast([...p], far).length % 2 === 1,
  )
}

/** Radius of a pad in the plane of `at` that reaches the nearest host metal (null: none in reach). */
function padRadius(host: NodeResult, at: Frame, ctx: BuildContext): number | null {
  let nearest = Infinity
  for (let i = 0; i < 16; i++) {
    const a = (2 * Math.PI * i) / 16
    const dir: Vec3 = [0, 1, 2].map(
      (k) => at.x[k]! * Math.cos(a) + at.y[k]! * Math.sin(a),
    ) as unknown as Vec3
    const o = at.origin
    const to: [number, number, number] = [
      o[0] + dir[0] * PAD_REACH,
      o[1] + dir[1] * PAD_REACH,
      o[2] + dir[2] * PAD_REACH,
    ]
    for (const b of host.bodies) {
      const hit = b.solid.manifold(ctx.quality).rayCast([...o], to)[0]
      if (hit) nearest = Math.min(nearest, Math.hypot(...hit.position.map((v, k) => v - o[k]!)))
    }
  }
  return Number.isFinite(nearest) ? nearest + EMBED : null
}

/**
 * The post and, when its foot would land in the open back of a basket, a pad soldered across
 * to the nearest metal — as a bench jeweller would. The pad stands clear of the culet.
 */
function post(
  node: FindingNode,
  host: NodeResult | null,
  ctx: BuildContext,
): { solids: Solid[]; tip: Frame } {
  const mount = backMount(host, ctx)
  const rod = (at: Frame) =>
    solidFromBrep(postShape(node.length, node.wire)).transformed(frameMatrix(at))
  if (!host || inMetal(host, along(mount, -EMBED / 2).origin, ctx))
    return { solids: [rod(mount)], tip: along(mount, node.length) }
  const padAt = along(mount, RULES.culetClearance + PAD_THICKNESS / 2)
  const radius = padRadius(host, padAt, ctx)
  if (radius === null) return { solids: [rod(mount)], tip: along(mount, node.length) }
  const foot = along(padAt, EMBED - PAD_THICKNESS / 2)
  const pad = solidFromBrep(
    makeCylinder(radius, PAD_THICKNESS, [0, 0, -PAD_THICKNESS / 2]),
  ).transformed(frameMatrix(padAt))
  return { solids: [rod(foot), pad], tip: along(foot, node.length) }
}

const along = (frame: Frame, distance: number): Frame => ({
  ...frame,
  origin: [
    frame.origin[0] + frame.z[0] * distance,
    frame.origin[1] + frame.z[1] * distance,
    frame.origin[2] + frame.z[2] * distance,
  ],
})

function build(
  node: FindingNode,
  ctx: BuildContext,
): { solids: Solid[]; frames?: Record<string, Frame> } {
  const host = node.host ? ctx.input(node.host) : null
  switch (node.type) {
    case 'earringPost': {
      const { solids, tip } = post(node, host, ctx)
      return { solids, frames: { tip } }
    }
    case 'butterfly': {
      // Hosted on a post: on its notch, a little back from its tip. On a piece: where a stock
      // post's notch would be.
      const post =
        host?.node.kind === 'finding' && host.node.type === 'earringPost' ? host.node : null
      const tip = host?.frames.tip
      const seat =
        post && tip
          ? along(tip, -notchFromTip(post.length))
          : along(backMount(host, ctx), STOCK_POST - notchFromTip(STOCK_POST))
      const mesh = butterflyMesh(butterflySpan(node.length), node.wire, ctx.quality)
      return {
        solids: [solidFromManifold(manifoldFromTriangles(mesh)).transformed(frameMatrix(seat))],
      }
    }
    case 'jumpRing': {
      // Standing across the piece (axis along X) so a chain runs through it like a bail.
      const top = topMount(host, ctx)
      const centre = along(top, host ? node.length / 2 - EMBED : 0)
      const ring = frameFromZ(centre.origin, [1, 0, 0], [0, 0, 1])
      return {
        solids: [solidFromBrep(ringShape(node.length, node.wire)).transformed(frameMatrix(ring))],
        frames: { opening: ring },
      }
    }
    case 'lobsterClasp': {
      const base = along(topMount(host, ctx), host ? -EMBED : 0)
      const eye = lobsterEyeWire(node.length, node.wire)
      if (eye < node.wire - 1e-9)
        ctx.report({
          level: 'info',
          code: 'finding.wireThinned',
          message: `A ${node.length} mm clasp cannot carry ${node.wire} mm wire; its eye uses ${eye.toFixed(2)} mm. Make the clasp longer for heavier wire.`,
          value: eye,
          limit: node.wire,
        })
      const mesh = lobsterMesh(node.length, eye, ctx.quality)
      return {
        solids: [solidFromManifold(manifoldFromTriangles(mesh)).transformed(frameMatrix(base))],
        frames: { eye: base },
      }
    }
  }
}

export const finding = defineFeature('finding', (node, ctx) => {
  const { solids, frames } = build(node, ctx)
  return { bodies: solids.map((solid) => ({ solid, ...metalOf(node) })), ...(frames && { frames }) }
})
