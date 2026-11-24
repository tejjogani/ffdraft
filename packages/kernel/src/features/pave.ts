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
import {
  iceLevel,
  type Layout,
  layoutPave,
  type PlacedStone,
  seatMetal,
  stoneForMetal,
} from '../mesh/pave/layout'
import {
  type HiddenSurfaces,
  type PaveField,
  type PlacedField,
  type PlacedHidden,
  type Region,
  selectRegion,
} from '../mesh/pave/region'
import {
  beadSolids,
  seatCutters,
  TRIANGLES_PER_BEAD,
  TRIANGLES_PER_HOLE,
  TRIANGLES_PER_SEAT,
} from '../mesh/pave/seats'
import { PaveSurface } from '../mesh/pave/surface'
import { RULES } from '../rules'
import type { IndexedTriangles } from '../solid/meshing'
import { QUALITY } from '../solid/solid'
import type { Diagnostic } from '../types'

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
/**
 * Triangles the seats, holes and beads of one field may add at production. Manifold's batch
 * boolean needs roughly 1 KB per triangle at its peak; with the host and the fused result this
 * keeps a piece well inside the 4 GB a WASM heap can address.
 */
const TRIANGLE_BUDGET = 1_500_000
/** Most stones one pavé node lays out; real iced pieces stay well under it. */
const MAX_PAVE_STONES = 25_000
/** Above this share of the open region too thin for the largest stone, thin metal is the story. */
const THIN_SHARE = 0.3

/**
 * What to say when the metal under the region is too thin for the stones asked for: how thick
 * it is, what it takes, and — on a hollowed body, where the wall is a parameter — a one-click
 * wall that takes them.
 */
function thinAdvice(
  node: PaveNode,
  host: NodeResult,
  thickness: number,
  sizes: readonly number[],
): Pick<Diagnostic, 'message' | 'value' | 'limit' | 'fix'> {
  const largest = sizes[0]!
  const fits = sizes.find((s) => s <= stoneForMetal(thickness) + 1e-9)
  const need = seatMetal(largest)
  const takes = fits
    ? `takes stones up to ${fits} mm`
    : `takes no stone in the ${sizes.at(-1)}–${largest} mm range`
  const base = `The metal under most of the region is about ${thickness.toFixed(2)} mm deep, which ${takes}; a ${largest} mm stone needs ${need.toFixed(2)} mm (its seat plus 0.4 mm below it).`
  const hostNode = host.node
  if (hostNode.kind === 'meshBody' && hostNode.hollow > 0) {
    // The cavity is offset a little beyond the wall asked for; round up to a tenth.
    const wall = Math.ceil(need * 10) / 10
    return {
      message: `${base} Use ${wall} mm hollow walls for these stones, or smaller stones.`,
      value: thickness,
      limit: need,
      fix: {
        label: `Hollow walls ${wall} mm`,
        ops: [{ t: 'update', id: node.host, patch: { hollow: wall } }],
      },
    }
  }
  return {
    message: `${base} Make the body thicker or use smaller stones.`,
    value: thickness,
    limit: need,
  }
}

/**
 * Each size on the ladder is at most this share of the one above. Melee is bought in parcels
 * per size, so a layout that tried every stock size would use most of them once or twice — a
 * stone list no one would order.
 */
const LADDER_STEP = 0.8

/**
 * A short graded ladder of stock melee sizes within the requested range, largest first: the
 * largest, then the largest stock size at most LADDER_STEP of the previous, down to the
 * smallest (or the nearest stock size when none lies in the range).
 */
function stockSizes(node: PaveNode, ctx: BuildContext): number[] {
  const lo = Math.min(node.sizeMin, node.sizeMax)
  const hi = Math.max(node.sizeMin, node.sizeMax)
  const inRange = MELEE_SIZES_MM.filter((s) => s >= lo - 1e-9 && s <= hi + 1e-9).reverse()
  if (inRange.length > 0) {
    const ladder = [inRange[0]!]
    for (const s of inRange.slice(1))
      if (s <= ladder.at(-1)! * LADDER_STEP + 1e-9 || s === inRange.at(-1)) ladder.push(s)
    return ladder
  }
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

/** Cavity walls and a flat back the host publishes, which no region may cover. */
function publishedHidden(host: NodeResult): PlacedHidden | null {
  const hidden = (host.data as { hidden?: HiddenSurfaces } | undefined)?.hidden
  return hidden ? { hidden, matrix: host.matrix } : null
}

/** A packed field: the host's region, its sampled surface and the full (ice level 1) layout. */
interface Packed {
  region: Region
  surface: PaveSurface
  full: Layout
}

/**
 * Recent packings by host geometry and layout parameters — everything but the ice level, so
 * dragging the ice slider re-selects stones in milliseconds instead of packing thousands again.
 * The key holds the host's hash, so a changed host never meets a stale layout.
 */
const PACKED = new Map<string, Packed>()
const PACKED_KEEP = 2

function packed(
  node: PaveNode,
  host: NodeResult,
  sizes: readonly number[],
  margin: number,
  ctx: BuildContext,
): Packed | null {
  const key = JSON.stringify([host.hash, node.region, sizes, node.gap, margin, node.seed])
  const hit = PACKED.get(key)
  if (hit) {
    // Most recent last, so the oldest is the first to go.
    PACKED.delete(key)
    PACKED.set(key, hit)
    return hit
  }
  const largest = sizes[0]!
  const smallest = sizes.at(-1)!
  const mesh = hostSurface(host)
  // Edge distances matter up to the half-width of the widest band that is paved in rows
  // (twice the largest stone; see mesh/pave/layout.ts), beyond which a field is open.
  const edgeCap = 2 * largest + margin
  const region = selectRegion(
    mesh,
    node.region,
    publishedField(host),
    Math.max(smallest / 2, 0.1),
    edgeCap,
    publishedHidden(host),
  )
  if (region.area === 0) return null
  // Checked before packing, which is the expensive part: a body scaled up 80 times would take
  // millions of stones and minutes to lay out. Densest packing of the largest stock size.
  const estimate = (0.9 * region.area) / (Math.PI * (largest / 2) ** 2)
  if (estimate > MAX_PAVE_STONES)
    throw new Error(
      `this surface would take about ${Math.round(estimate).toLocaleString('en-US')} stones; the limit is ${MAX_PAVE_STONES.toLocaleString('en-US')}. Use larger stones, pave a smaller region or scale the piece down`,
    )
  const surface = new PaveSurface(mesh, region, {
    spacing: Math.min(Math.max(smallest / 3, 0.12), 0.4),
    normalRadius: largest / 2,
    edgeCap,
  })
  const full = layoutPave(surface, {
    sizes,
    gap: node.gap,
    margin,
    coverage: 1,
    seed: node.seed,
    rowDirection: [1, 0, 0],
    sink: GEM_CUTS.round.girdlePct / 2 + GIRDLE_BELOW,
    edgeDistance: (p) => region.edgeDistance(p),
    checkpoint: () => ctx.signal?.throwIfAborted(),
  })
  const result = { region, surface, full }
  PACKED.set(key, result)
  while (PACKED.size > PACKED_KEEP) PACKED.delete(PACKED.keys().next().value!)
  return result
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

  // A seat needs its wall of metal wherever the region ends (the DFM seat-wall rule), whatever
  // smaller margin was asked for. Inside a raised rim at least that wide the rim is the wall:
  // stones go up to it with half a gap to spare, and only margin asked beyond the wall is kept.
  const rim = publishedField(host)?.field.rim ?? 0
  const margin =
    rim >= RULES.channelWall
      ? Math.max(node.gap / 2, node.margin - RULES.channelWall)
      : Math.max(node.margin, RULES.channelWall)
  const built = packed(node, host, sizes, margin, ctx)
  if (!built) {
    ctx.report({
      level: 'warning',
      code: 'pave.noRegion',
      message: 'No part of the body faces the chosen direction, so no stones were placed.',
    })
    return {}
  }
  const { region, surface, full } = built
  // The ice level only drops stones from the full packing: no need to pack again for it.
  const layout = { ...full, stones: iceLevel(full.all, full.spread, node.coverage, node.gap) }

  // Thin metal is the cause when most of the region could take the largest stone but for it.
  const thin =
    layout.thin.share > THIN_SHARE ? thinAdvice(node, host, layout.thin.thickness, sizes) : null
  if (thin) ctx.report({ level: 'warning', code: 'pave.thin', ...thin })
  if (layout.stones.length === 0) {
    if (!thin)
      ctx.report({
        level: 'warning',
        code: 'pave.empty',
        message: `No ${smallest}–${largest} mm stones fit the region with a ${margin} mm margin; try smaller stones or a smaller margin.`,
      })
    else
      ctx.report({
        level: 'warning',
        code: 'pave.empty',
        message: 'No stones fit: the metal is too thin for a seat.',
      })
  } else {
    // Judged on the part of the region stones may go at all: the stem of a trophy or the wire of
    // a handle is too tightly curved for any stock melee, and smaller stones would not help.
    const fillable = layout.fillable * region.area
    if (!thin && layout.packedArea / fillable < SPARSE_FILL)
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

  // A fully iced piece can hold thousands of stones, and every seat, hole and bead adds
  // triangles to one boolean. Past a budget the WASM heap runs out mid-way (and takes the
  // Worker with it): leave the drill holes to the setter first, then refuse plainly.
  const holes = layout.stones.filter((s) => s.hole > 0).length
  const beadsEach = node.beads ? 3 : 0
  const estimate = (withHoles: boolean) =>
    stones.length * (TRIANGLES_PER_SEAT + beadsEach * TRIANGLES_PER_BEAD) +
    (withHoles ? holes * TRIANGLES_PER_HOLE : 0)
  const drill = estimate(true) <= TRIANGLE_BUDGET
  if (estimate(false) > TRIANGLE_BUDGET) {
    ctx.report({
      level: 'error',
      code: 'pave.tooLarge',
      message: `${stones.length.toLocaleString('en')} stones are more than one piece can have its seats cut in here (about ${(estimate(false) / 1e6).toFixed(1)} million triangles against ${TRIANGLE_BUDGET / 1e6} million). The stones are listed, but no seats or beads are cut: use larger stones or a lower ice level.`,
      value: stones.length,
    })
    return { stones }
  }
  if (!drill && holes > 0)
    ctx.report({
      level: 'info',
      code: 'pave.holesOmitted',
      message: `With ${stones.length.toLocaleString('en')} stones the drill holes under the seats are left for the setter to drill, to keep the casting file within what can be built here.`,
    })
  const seats = stones.map((stone, i) => ({ stone, hole: drill ? layout.stones[i]!.hole : 0 }))
  const cuts: Cut[] = [
    {
      solid: solidFromManifold(seatCutters(seats, { opening: largest * 0.5 }, ctx.quality)),
      targets: [node.host],
    },
  ]
  const additions: Addition[] = []
  if (node.beads) {
    const beads = layoutBeads(layout.stones, node.gap, (q) => surface.snapExact(q))
    if (beads.length > 0)
      additions.push({
        solid: solidFromManifold(beadSolids(beads, ctx.quality)),
        target: node.host,
        afterCuts: true,
      })
  }
  return { stones, cuts, additions }
})
