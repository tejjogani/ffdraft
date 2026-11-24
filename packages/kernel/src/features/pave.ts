/**
 * Automatic pavé: "ice out" a region of any body — a sculpted trophy, a puffy letter, a ring.
 * Packs graded stock-size melee over the region (mesh/pave/layout.ts), seats every stone just
 * below the surface along the smoothed normal, and at production cuts the seats and raises
 * shared beads, each in one batch boolean (docs/research/06-freeform.md §5 and its Decisions).
 */
import { GEM_CUTS, gemDims, MELEE_SIZES_MM, type NodeOf } from '@pave/schema'
import {
  type Addition,
  type BuildContext,
  type Cut,
  defineFeature,
  type NodeResult,
  type Stone,
  solidFromManifold,
} from '../core'
import { frameFromZ } from '../geometry/vec'
import { layoutBeads } from '../mesh/pave/beads'
import { layoutPave, type PlacedStone } from '../mesh/pave/layout'
import { type PaveField, type PlacedField, selectRegion } from '../mesh/pave/region'
import { beadSolids, seatCutters } from '../mesh/pave/seats'
import { PaveSurface } from '../mesh/pave/surface'
import type { IndexedTriangles } from '../solid/meshing'
import { QUALITY } from '../solid/solid'

type PaveNode = NodeOf<'pave'>

/**
 * The girdle's upper edge sits this share of the stone below the surface — "just below", so
 * the seat holds it while the whole crown stands proud (06-freeform.md §5 step 5).
 */
const GIRDLE_BELOW = 0.03
/** Below this share of the paveable surface covered, the size range is too coarse for the shape. */
const SPARSE_FILL = 0.45
/** Below this share of the region able to take stones at all, say which part stays bare. */
const LEFT_BARE = 0.65

/** Stock melee sizes within the requested range, largest first (or the nearest one). */
function stockSizes(node: PaveNode, ctx: BuildContext): number[] {
  const lo = Math.min(node.sizeMin, node.sizeMax)
  const hi = Math.max(node.sizeMin, node.sizeMax)
  const inRange = MELEE_SIZES_MM.filter((s) => s >= lo - 1e-9 && s <= hi + 1e-9)
  if (inRange.length > 0) return [...inRange].reverse()
  const mid = (lo + hi) / 2
  const nearest = MELEE_SIZES_MM.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a))
  ctx.report({
    level: 'warning',
    code: 'pave.sizeRange',
    message: `No stock melee size lies between ${lo} and ${hi} mm, so ${nearest} mm stones are used.`,
    value: nearest,
  })
  return [nearest]
}

/** The host's metal as one triangle soup, at a fixed quality so the layout never depends on detail. */
function hostSurface(host: NodeResult): IndexedTriangles {
  const meshes = host.bodies.map((b) => b.solid.triangles(QUALITY.draft))
  if (meshes.length === 1) return meshes[0]!
  const positions = new Float32Array(meshes.reduce((n, m) => n + m.positions.length, 0))
  const indices = new Uint32Array(meshes.reduce((n, m) => n + m.indices.length, 0))
  let v = 0
  let i = 0
  for (const m of meshes) {
    positions.set(m.positions, v * 3)
    for (let k = 0; k < m.indices.length; k++) indices[i + k] = m.indices[k]! + v
    v += m.positions.length / 3
    i += m.indices.length
  }
  return { positions, indices }
}

/** A raised-border field published by an outline body, if the host has one. */
function publishedField(host: NodeResult): PlacedField | null {
  const field = (host.data as { paveField?: PaveField } | undefined)?.paveField
  return field ? { field, matrix: host.matrix } : null
}

export const pave = defineFeature('pave', (node, ctx) => {
  const host = ctx.input(node.host)
  if (host.bodies.length === 0) throw new Error('The body it covers has no metal to set stones in')
  if (node.cut !== 'round')
    ctx.report({
      level: 'warning',
      code: 'pave.roundOnly',
      message: `Automatic pavé packs round stones; the ${node.cut} cut was laid out as round brilliants.`,
    })
  const sizes = stockSizes(node, ctx)
  const largest = sizes[0]!
  const smallest = sizes.at(-1)!

  const mesh = hostSurface(host)
  // Edge distances matter up to the half-width of the widest band that is paved in rows
  // (twice the largest stone; see mesh/pave/layout.ts), beyond which a field is open.
  const edgeCap = 2 * largest + node.margin
  const region = selectRegion(
    mesh,
    node.region,
    publishedField(host),
    Math.max(smallest / 2, 0.1),
    edgeCap,
  )
  if (region.area === 0) {
    ctx.report({
      level: 'warning',
      code: 'pave.noRegion',
      message: 'No part of the body faces the chosen direction, so no stones were placed.',
    })
    return {}
  }
  const surface = new PaveSurface(mesh, region, {
    spacing: Math.min(Math.max(smallest / 3, 0.12), 0.4),
    normalRadius: largest / 2,
    edgeCap,
  })
  const layout = layoutPave(surface, {
    sizes,
    gap: node.gap,
    margin: node.margin,
    coverage: node.coverage,
    seed: node.seed,
    rowDirection: [1, 0, 0],
    sink: GEM_CUTS.round.girdlePct / 2 + GIRDLE_BELOW,
    edgeDistance: (p) => region.edgeDistance(p),
    checkpoint: () => ctx.signal?.throwIfAborted(),
  })

  if (layout.stones.length === 0)
    ctx.report({
      level: 'warning',
      code: 'pave.empty',
      message: `No ${smallest}–${largest} mm stones fit the region with a ${node.margin} mm margin; try smaller stones or a smaller margin.`,
    })
  else {
    // Judged on the part of the region stones may go at all: the stem of a trophy or the wire of
    // a handle is too tightly curved for any stock melee, and smaller stones would not help.
    const fillable = layout.fillable * region.area
    if (layout.packedArea / fillable < SPARSE_FILL)
      ctx.report({
        level: 'warning',
        code: 'pave.sparse',
        message: `Only ${Math.round((100 * layout.packedArea) / fillable)} % of the paveable surface can take ${smallest}–${largest} mm stones; smaller stones would cover more of it.`,
        value: smallest,
      })
    if (layout.fillable < LEFT_BARE)
      ctx.report({
        level: 'info',
        code: 'pave.bare',
        message: `${Math.round(100 * (1 - layout.fillable))} % of the region is too thin, too tightly curved or too close to an edge for ${smallest} mm stones, and stays polished metal.`,
        value: smallest,
      })
  }

  const stones: Stone[] = layout.stones.map((s: PlacedStone) => ({
    cut: 'round',
    stone: node.stone,
    dims: gemDims('round', s.diameter),
    frame: frameFromZ(s.position, s.normal, [1, 0, 0]),
    role: 'melee',
    setting: 'pave',
  }))
  if (ctx.detail === 'draft' || stones.length === 0) return { stones }

  const cuts: Cut[] = [
    {
      solid: solidFromManifold(seatCutters(stones, { opening: largest * 0.5 }, ctx.quality)),
      targets: [node.host],
    },
  ]
  const additions: Addition[] = []
  if (node.beads) {
    const beads = layoutBeads(layout.stones, node.gap, (q) => surface.snap(q))
    if (beads.length > 0)
      additions.push({
        solid: solidFromManifold(beadSolids(beads, ctx.quality)),
        target: node.host,
        afterCuts: true,
      })
  }
  return { stones, cuts, additions }
})
