/**
 * Findings: an earring post (with its friction notch) on the back of its host, a butterfly
 * back where that post's notch would be, a jump ring and a lobster clasp on top of their host.
 * Without a host they stand at the origin: posts along +Y (the back of a piece facing −Y),
 * rings and clasps on +Z.
 */
import type { NodeOf } from '@pave/schema'
import {
  type BuildContext,
  type Frame,
  type NodeResult,
  type Solid,
  type Vec3,
  defineFeature,
  metalOf,
  solidFromBrep,
  solidFromManifold,
} from '../core'
import { frameFromZ, frameMatrix, normalize, transformDirection } from '../geometry/vec'
import { unionBounds } from '../solid/meshing'
import { manifoldFromTriangles } from '../solid/solid'
import { EMBED, NOTCH_FROM_TIP, butterflyMesh, lobsterMesh, postShape, ringShape } from './finding/shapes'

type FindingNode = NodeOf<'finding'>

/** Butterflies are placed on the notch of a stock post of this length (01-cad.md §2: 10–11 mm). */
const STOCK_POST = 10

/**
 * The point where a ray from outside the host toward its centre first meets metal: the middle
 * of the host's back (`direction` = +Y of the host) or top (`direction` = +Z).
 */
function surfacePoint(host: NodeResult, direction: Vec3, ctx: BuildContext): Vec3 {
  const box = unionBounds(host.bodies.map((b) => b.solid.bounds()))
  const centre: Vec3 = [0, 1, 2].map((k) => (box.min[k]! + box.max[k]!) / 2) as unknown as Vec3
  const reach = Math.hypot(...box.max.map((v, k) => v - box.min[k]!)) + 1
  const from: Vec3 = [centre[0] + direction[0] * reach, centre[1] + direction[1] * reach, centre[2] + direction[2] * reach]
  let best: { distance: number; position: Vec3 } | null = null
  for (const body of host.bodies) {
    const hit = body.solid.manifold(ctx.quality).rayCast([...from], [...centre])[0]
    if (hit && (!best || hit.distance < best.distance)) best = { distance: hit.distance, position: hit.position }
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

/** Where a post leaves its host: the host's `back` frame if it has one, else the middle of its back. */
function backMount(host: NodeResult | null, ctx: BuildContext): Frame {
  if (!host) return frameFromZ([0, 0, 0], [0, 1, 0], [1, 0, 0])
  if (host.frames.back) return host.frames.back
  const back = normalize(transformDirection(host.matrix, [0, 1, 0]))
  return frameFromZ(surfacePoint(host, back, ctx), back, [1, 0, 0])
}

/** The top centre of the host (where a piece hangs from), z up, facing −Y like the piece. */
function topMount(host: NodeResult | null, ctx: BuildContext): Frame {
  const origin: Vec3 = host ? surfacePoint(host, [0, 0, 1], ctx) : [0, 0, 0]
  return { origin, x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }
}

const along = (frame: Frame, distance: number): Frame => ({
  ...frame,
  origin: [
    frame.origin[0] + frame.z[0] * distance,
    frame.origin[1] + frame.z[1] * distance,
    frame.origin[2] + frame.z[2] * distance,
  ],
})

function build(node: FindingNode, ctx: BuildContext): { solid: Solid; frames?: Record<string, Frame> } {
  const host = node.host ? ctx.input(node.host) : null
  switch (node.type) {
    case 'earringPost': {
      const mount = backMount(host, ctx)
      return {
        solid: solidFromBrep(postShape(node.length, node.wire)).transformed(frameMatrix(mount)),
        frames: { tip: along(mount, node.length) },
      }
    }
    case 'butterfly': {
      const seat = along(backMount(host, ctx), STOCK_POST - NOTCH_FROM_TIP)
      const mesh = butterflyMesh(node.length, node.wire, ctx.quality)
      return { solid: solidFromManifold(manifoldFromTriangles(mesh)).transformed(frameMatrix(seat)) }
    }
    case 'jumpRing': {
      // Standing across the piece (axis along X) so a chain runs through it like a bail.
      const top = topMount(host, ctx)
      const centre = along(top, host ? node.length / 2 - EMBED : 0)
      const ring = frameFromZ(centre.origin, [1, 0, 0], [0, 0, 1])
      return {
        solid: solidFromBrep(ringShape(node.length, node.wire)).transformed(frameMatrix(ring)),
        frames: { opening: ring },
      }
    }
    case 'lobsterClasp': {
      const base = along(topMount(host, ctx), host ? -EMBED : 0)
      const mesh = lobsterMesh(node.length, node.wire, ctx.quality)
      return {
        solid: solidFromManifold(manifoldFromTriangles(mesh)).transformed(frameMatrix(base)),
        frames: { eye: base },
      }
    }
  }
}

export const finding = defineFeature('finding', (node, ctx) => {
  const { solid, frames } = build(node, ctx)
  return { bodies: [{ solid, ...metalOf(node) }], ...(frames && { frames }) }
})
