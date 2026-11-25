/**
 * Turns node results into the parts a viewer or caster sees.
 *
 * draft       one part per node, bodies shown as built (nothing fused, nothing cut);
 * production  per alloy: bodies + additions fused, seats and engravings cut, late additions
 *             (beads) fused back, then split into connected, watertight shells.
 */
import { type Design, METALS, type MetalId } from '@pave/schema'
import type { Manifold } from 'manifold-3d'
import {
  type Body,
  IDENTITY,
  lazySolid,
  type MetalSpec,
  type NodeResult,
  type Quality,
  runtime,
  type ScenePart,
  type Solid,
  solidFromManifold,
} from '../core'
import {
  boundsOfPositions,
  boundsOverlap,
  type IndexedTriangles,
  mergeTessellations,
  meshVolume,
  separateTouching,
  unionBounds,
} from '../solid/meshing'
import { manifoldFromTriangles, trianglesFromManifold } from '../solid/solid'
import type { Bounds, Part, PartRegion } from '../types'
import { labelOf } from './build'
import { hashString } from './hash'

export interface Assembly {
  parts: ScenePart[]
  dispose(): void
}

interface Source {
  nodeId: string
  body: Body
}

/** Nodes whose output takes part in the piece: built, visible and not replaced by another node. */
export function activeResults(
  design: Design,
  results: ReadonlyMap<string, NodeResult>,
): NodeResult[] {
  const consumed = consumedBy(results)
  return [...results.values()].filter(
    (r) => r.status === 'ok' && r.node.visible && !consumed.has(r.id) && design.nodes[r.id],
  )
}

function consumedBy(results: ReadonlyMap<string, NodeResult>): Map<string, string> {
  const map = new Map<string, string>()
  for (const r of results.values())
    if (r.status === 'ok') for (const id of r.consumes) map.set(id, r.id)
  return map
}

/** Follows `consumes` links to the node that currently carries a target's metal. */
function resolveTarget(
  id: string,
  consumed: ReadonlyMap<string, string>,
  results: ReadonlyMap<string, NodeResult>,
): NodeResult | null {
  let current = id
  for (let hops = 0; consumed.has(current) && hops < 64; hops++) current = consumed.get(current)!
  const result = results.get(current)
  return result?.status === 'ok' && result.node.visible && result.bodies.length > 0 ? result : null
}

const specOf = (b: MetalSpec): MetalSpec => ({
  material: b.material,
  finish: b.finish,
  plating: b.plating,
})

/**
 * The solids with coincident copies left out: the same body in the same place, recognised by
 * equal bounds (to 0.1 µm) and volume (to six figures). A polar pattern about an axis through
 * its source (the default) stacks every copy on the original; fusing eight coincident spheres
 * took seconds and adds nothing. A hash, not pairwise tests: a pavé has thousands of bodies.
 * Values that straddle a rounding step are merely kept, and fused as before.
 */
export function distinctSolids(solids: readonly Solid[]): Solid[] {
  const seen = new Set<string>()
  return solids.filter((solid) => {
    const key = placeKey(solid)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Equal for the same body in the same place (see `distinctSolids`). */
function placeKey(solid: Solid): string {
  const { min, max } = solid.bounds()
  return (
    [...min, ...max].map((v) => Math.round(v * 1e4)).join(',') + `|${solid.volume().toPrecision(6)}`
  )
}

/**
 * The metal each part adds to the piece at draft, where parts are per node and not fused: a
 * body that sits exactly on a body of an earlier part (a polar pattern stacked on its source)
 * adds none, as production's fuse finds. Without this the inspector showed twice the metal of
 * a coincident pattern while `pattern.coincident` said its copies add none. Other overlaps
 * between nodes are left to production, as before.
 */
export function draftVolumes(parts: readonly ScenePart[], quality: Quality): number[] {
  const placed = new Set<string>()
  return parts.map(({ part, sources }) => {
    const solids = distinctSolids(sources.map((s) => s.body.solid))
    const keys = solids.map(placeKey)
    const kept = solids.filter((_, i) => !placed.has(keys[i]!))
    for (const key of keys) placed.add(key)
    if (kept.length === solids.length) return part.volumeMm3
    return kept.length > 0 ? fusedVolume(kept, quality) : 0
  })
}

/**
 * Volume of overlapping solids fused together. The fuse runs on meshes; each exact solid's
 * tessellation deficit is added back so the figure is as good as the exact volumes allow.
 */
function fusedVolume(all: readonly Solid[], quality: Quality): number {
  const solids = all.length > 1 ? distinctSolids(all) : all
  if (solids.length === 1) return solids[0]!.volume()
  const { manifold: mf } = runtime()
  const meshes = solids.map((s) => s.manifold(quality))
  const fused = mf.Manifold.union(meshes)
  try {
    return fused.volume() + solids.reduce((sum, s, i) => sum + s.volume() - meshes[i]!.volume(), 0)
  } finally {
    fused.delete()
  }
}

function partOf(
  id: string,
  nodeId: string,
  rev: string,
  name: string,
  spec: MetalSpec,
  solids: readonly Solid[],
  quality: Quality,
  volumeMm3: number,
): Part {
  const tessellation = mergeTessellations(solids.map((s) => s.tessellate(quality)))
  return {
    id,
    nodeId,
    rev,
    name,
    ...spec,
    mesh: tessellation.mesh,
    edges: tessellation.edges,
    volumeMm3,
    areaMm2: solids.reduce((sum, s) => sum + s.area(), 0),
    bounds: unionBounds(solids.map((s) => s.bounds())),
    exact: solids.every((s) => s.exact),
  }
}

/**
 * The finish and plating most of a fused casting's metal carries, by volume. A casting fuses
 * bodies of one alloy that may be finished differently; the odd ones become regions. Taking the
 * first body's spec instead would make a small rhodium-plated head, listed first, the casting's
 * plating and the band its exception.
 */
function majoritySpec(sources: readonly Source[], fallback: MetalSpec): MetalSpec {
  const totals = new Map<string, { spec: MetalSpec; volume: number }>()
  for (const { body } of sources) {
    const key = `${body.finish}/${body.plating}`
    const entry = totals.get(key) ?? { spec: specOf(body), volume: 0 }
    entry.volume += body.solid.volume()
    totals.set(key, entry)
  }
  let best: { spec: MetalSpec; volume: number } | undefined
  // Ties go to the first spec met, so the choice is stable for a given design.
  for (const entry of totals.values()) if (!best || entry.volume > best.volume) best = entry
  return best ? { ...best.spec, material: fallback.material } : fallback
}

/** Source nodes whose finish or plating differ from the part's (see `Part.regions`). */
function regionsOf(
  part: Part,
  sources: readonly Source[],
  results: ReadonlyMap<string, NodeResult>,
): PartRegion[] | undefined {
  const regions = new Map<string, PartRegion>()
  for (const source of sources) {
    const { body } = source
    if (body.finish === part.finish && body.plating === part.plating) continue
    const nodeId = body.from ?? source.nodeId
    const result = results.get(nodeId)
    regions.set(nodeId, {
      nodeId,
      name: result ? labelOf(result.node) : nodeId,
      finish: body.finish,
      plating: body.plating,
    })
  }
  return regions.size > 0 ? [...regions.values()] : undefined
}

/**
 * The parts with their names (and their regions' names) taken from the current nodes. Node
 * hashes leave names out, so cached parts can carry a name the designer has since changed; the
 * geometry, and so `rev`, stays as it is. Parts whose names are current are returned as they are.
 */
export function withCurrentNames(
  parts: readonly ScenePart[],
  results: ReadonlyMap<string, NodeResult>,
): ScenePart[] {
  const label = (id: string, fallback: string) => {
    const result = results.get(id)
    return result ? labelOf(result.node) : fallback
  }
  return parts.map((scenePart) => {
    const { part, namedAfter } = scenePart
    const name = namedAfter ? label(namedAfter, part.name) : part.name
    const regions = part.regions?.map((r) => {
      const current = label(r.nodeId, r.name)
      return current === r.name ? r : { ...r, name: current }
    })
    const renamed = name !== part.name || regions?.some((r, i) => r !== part.regions![i])
    if (!renamed) return scenePart
    return { ...scenePart, part: { ...part, name, ...(regions ? { regions } : {}) } }
  })
}

// ── Draft ────────────────────────────────────────────────────────────────────────────────────

/** Per-node draft parts, reused while the node's hash and its additions' alloys are unchanged. */
export type DraftCache = Map<string, { key: string; parts: ScenePart[] }>

export function assembleDraft(
  design: Design,
  results: ReadonlyMap<string, NodeResult>,
  quality: Quality,
  cache: DraftCache,
): Assembly {
  const consumed = consumedBy(results)
  const parts: ScenePart[] = []
  const seen = new Set<string>()
  for (const result of activeResults(design, results)) {
    // A node's own bodies, then metal it adds to other nodes (shown in the host's alloy).
    const sources: Source[] = result.bodies.map((body) => ({ nodeId: result.id, body }))
    for (const addition of result.additions) {
      const host = resolveTarget(addition.target, consumed, results)
      if (host)
        sources.push({
          nodeId: result.id,
          body: { solid: addition.solid, ...specOf(host.bodies[0]!) },
        })
    }
    if (sources.length === 0) continue
    seen.add(result.id)
    const key = `${result.hash}|${sources.map((s) => `${s.body.material}/${s.body.finish}/${s.body.plating}`).join(',')}`
    let entry = cache.get(result.id)
    if (entry?.key !== key) {
      const groups = new Map<string, Source[]>()
      for (const s of sources) {
        const k = `${s.body.material}/${s.body.finish}/${s.body.plating}`
        groups.set(k, [...(groups.get(k) ?? []), s])
      }
      entry = {
        key,
        parts: [...groups.values()].map((group, i) => {
          const solids = group.map((s) => s.body.solid)
          return {
            part: partOf(
              i === 0 ? result.id : `${result.id}#${i}`,
              result.id,
              hashString(key),
              labelOf(result.node),
              specOf(group[0]!.body),
              solids,
              quality,
              fusedVolume(solids, quality),
            ),
            fused: null,
            sources: group,
            namedAfter: result.id,
          }
        }),
      }
      cache.set(result.id, entry)
    }
    parts.push(...entry.parts)
  }
  for (const id of cache.keys()) if (!seen.has(id)) cache.delete(id)
  return { parts, dispose: () => {} }
}

// ── Production ───────────────────────────────────────────────────────────────────────────────

/**
 * Packs many small solids into a few Manifolds. A boolean costs roughly the same however small
 * its operands (and every Manifold has a fixed overhead), so hundreds of beads or seat cutters
 * are far cheaper as a handful of multi-shell meshes. Shells in one mesh must not overlap, so
 * solids are batched greedily by bounding box.
 */
function batch(
  solids: readonly Solid[],
  quality: Quality,
  own: (m: Manifold) => Manifold,
): Manifold[] {
  if (solids.length <= 1) return solids.map((s) => s.manifold(quality))
  const out: Manifold[] = []
  const batches: {
    members: { tris: IndexedTriangles; box: Bounds }[]
    cells: Map<string, number[]>
  }[] = []
  const boxes = solids.map((solid) => boundsOfPositions(solid.triangles(quality).positions))
  // Hash grid sized to the typical solid, so overlap tests stay local with thousands of stones.
  const sizes = boxes
    .map((b) => Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]))
    .sort((a, b) => a - b)
  const cell = Math.max(0.5, sizes[sizes.length >> 1]! * 1.5)
  solids.forEach((solid, n) => {
    const box = boxes[n]!
    const lo = box.min.map((v) => Math.floor(v / cell))
    const hi = box.max.map((v) => Math.floor(v / cell))
    // Large bodies keep a mesh of their own (the solid's cached one).
    if ((hi[0]! - lo[0]! + 1) * (hi[1]! - lo[1]! + 1) * (hi[2]! - lo[2]! + 1) > 64) {
      out.push(solid.manifold(quality))
      return
    }
    const keys: string[] = []
    for (let x = lo[0]!; x <= hi[0]!; x++)
      for (let y = lo[1]!; y <= hi[1]!; y++)
        for (let z = lo[2]!; z <= hi[2]!; z++) keys.push(`${x},${y},${z}`)
    let home = batches.find(
      (b) => !keys.some((k) => b.cells.get(k)?.some((i) => boundsOverlap(b.members[i]!.box, box))),
    )
    if (!home) {
      home = { members: [], cells: new Map() }
      batches.push(home)
    }
    const index = home.members.push({ tris: solid.triangles(quality), box }) - 1
    for (const k of keys) home.cells.set(k, [...(home.cells.get(k) ?? []), index])
  })
  for (const { members } of batches) {
    let vertices = 0
    let corners = 0
    for (const m of members) {
      vertices += m.tris.positions.length
      corners += m.tris.indices.length
    }
    const positions = new Float32Array(vertices)
    const indices = new Uint32Array(corners)
    let v = 0
    let i = 0
    for (const m of members) {
      positions.set(m.tris.positions, v)
      for (let k = 0; k < m.tris.indices.length; k++) indices[i + k] = m.tris.indices[k]! + v / 3
      v += m.tris.positions.length
      i += m.tris.indices.length
    }
    out.push(own(manifoldFromTriangles({ positions, indices })))
  }
  return out
}

interface MetalGroup {
  spec: MetalSpec
  sources: Source[]
  /** Bodies and additions to fuse. */
  solids: Solid[]
  /** Bodies that already had their own cutters (engraving) applied. */
  precut: Manifold[]
  /** Additions fused after the seats are cut. */
  late: Solid[]
}

/** Shells smaller than this are numerical dust from booleans, not metal (mm³). */
const DUST_MM3 = 1e-3
const GENERAL_POSITION: [number, number, number] = [1.3e-4, 0.7e-4, 0.9e-4]
/** Edges shorter than this are collapsed in the fused body (mm) — a tenth of the chord tolerance. */
const SLIVER = 5e-4

export function assembleProduction(
  design: Design,
  results: ReadonlyMap<string, NodeResult>,
  quality: Quality,
  /** Hash of everything that went into this assembly; the parts' `rev`. */
  rev: string,
): Assembly {
  const { manifold: mf } = runtime()
  const consumed = consumedBy(results)
  const active = activeResults(design, results)
  const temporaries: Manifold[] = []
  const temp = (m: Manifold): Manifold => {
    temporaries.push(m)
    return m
  }
  const fuse = (list: readonly Manifold[]): Manifold =>
    list.length === 1 ? list[0]! : temp(mf.Manifold.union(list))

  try {
    // Cutters: those aimed at specific nodes, and those that cut whatever metal they touch.
    const targeted = new Map<string, Solid[]>()
    const everywhere: Solid[] = []
    for (const result of active)
      for (const cut of result.cuts) {
        if (cut.targets === 'all') everywhere.push(cut.solid)
        else
          for (const id of cut.targets) {
            const host = resolveTarget(id, consumed, results)
            if (host) targeted.set(host.id, [...(targeted.get(host.id) ?? []), cut.solid])
          }
      }

    const chains = new Set(
      active.filter((r) => r.node.kind === 'chain').flatMap((r) => r.bodies.map((b) => b.solid)),
    )
    const groups = new Map<MetalId, MetalGroup>()
    const groupFor = (spec: MetalSpec): MetalGroup => {
      let group = groups.get(spec.material)
      if (!group) {
        group = { spec, sources: [], solids: [], precut: [], late: [] }
        groups.set(spec.material, group)
      }
      return group
    }
    for (const result of active) {
      const cutters = targeted.get(result.id)
      const tool = cutters && fuse(batch(cutters, quality, temp))
      for (const body of result.bodies) {
        const group = groupFor(specOf(body))
        if (tool) group.precut.push(temp(body.solid.manifold(quality).subtract(tool)))
        else group.solids.push(body.solid)
        group.sources.push({ nodeId: result.id, body })
      }
    }
    for (const result of active)
      for (const addition of result.additions) {
        const host = resolveTarget(addition.target, consumed, results)
        if (!host) continue
        const spec = specOf(host.bodies[0]!)
        const group = groupFor(spec)
        ;(addition.afterCuts ? group.late : group.solids).push(addition.solid)
        group.sources.push({ nodeId: result.id, body: { solid: addition.solid, ...spec } })
      }

    // Cutters and the metal they cut are built from the same outlines, so their edges often
    // coincide exactly — which leaves bodies pinched along an edge. A tenth of a micron of
    // offset puts the cutters in general position.
    const seats =
      everywhere.length > 0
        ? temp(fuse(batch(everywhere, quality, temp)).translate(GENERAL_POSITION))
        : null
    const parts: ScenePart[] = []
    const cutterBoxes = [...everywhere, ...[...groups.values()].flatMap((g) => g.late)].map((c) =>
      c.bounds(),
    )
    /** Every alloy fused so far: a later alloy gives up the metal it shares with an earlier one. */
    const castSoFar: { metal: Manifold; box: Bounds }[] = []
    // Smallest alloy first, so where castings of two alloys share metal the smaller one (a head,
    // an accent) keeps its shape and the larger one (the band) is cut to receive it — as a
    // jeweler seats a separately cast head. Parts are put back in design order afterwards.
    const designOrder = [...groups.keys()]
    const metalOf = (g: MetalGroup) => g.solids.reduce((sum, s) => sum + s.volume(), 0)
    const bySize =
      groups.size > 1 ? [...groups].sort(([, a], [, b]) => metalOf(a) - metalOf(b)) : [...groups]
    for (const [material, group] of bySize) {
      // A mesh body can hold many separate shells (the links of a chain). Shells that touch
      // nothing outside their own body need no boolean at all — and fusing a thousand links
      // with a pendant they never touch would take most of a minute — so they are set aside
      // as "loose" and rejoin their body as one part at the end.
      const single: Solid[] = []
      const multi = new Map<Solid, { tris: IndexedTriangles; shells: Shells; loose: Set<number> }>()
      // Coincident copies add no metal and cost a slow union; their sources stay on record.
      for (const solid of distinctSolids(group.solids)) {
        const tris = solid.triangles(quality)
        const found = shellsIn(tris)
        // A chain is a separate component, bought or cast apart and threaded on after: its links
        // never fuse with the piece, even where they touch it (the chain checks report that).
        if (chains.has(solid)) {
          multi.set(solid, { tris, shells: found, loose: new Set(found.boxes.keys()) })
          continue
        }
        // Dust shells (slivers a mesh pipeline left behind) do not make a body "multi-shell".
        if (found.volumes.filter((v) => v > DUST_MM3).length > 1)
          multi.set(solid, { tris, shells: found, loose: new Set() })
        else single.push(solid)
      }
      const singleBoxes = single.map((solid) => solid.bounds())
      const precutBoxes = group.precut.map(boundsOfManifold)
      /** Shells that might touch something else and so go through the fuse. */
      const busyShells: {
        home: Solid
        index: number
        manifold: Manifold
        box: Bounds
        volume: number
      }[] = []
      for (const [solid, body] of multi) {
        const foreign = [
          ...singleBoxes,
          ...precutBoxes,
          ...cutterBoxes,
          ...[...multi].flatMap(([other, b]) =>
            other === solid || chains.has(other) ? [] : b.shells.boxes,
          ),
        ]
        body.shells.boxes.forEach((box, index) => {
          if (body.shells.volumes[index]! <= DUST_MM3 || body.loose.has(index)) return
          if (!foreign.some((f) => boundsOverlap(f, box))) {
            body.loose.add(index)
            return
          }
          const manifold = temp(
            manifoldFromTriangles(shellTriangles(body.tris, body.shells, (i) => i === index)),
          )
          busyShells.push({ home: solid, index, manifold, box, volume: manifold.volume() })
        })
      }
      /** The busy shell a fused shell is identical to, if the fuse left it untouched. */
      const untouched = (box: Bounds, volume: number) =>
        busyShells.find(
          (u) =>
            Math.abs(u.volume - volume) <= 1e-3 * u.volume &&
            [0, 1, 2].every(
              (k) =>
                Math.abs(u.box.min[k]! - box.min[k]!) < 5e-3 &&
                Math.abs(u.box.max[k]! - box.max[k]!) < 5e-3,
            ),
        )

      const busy = [
        ...batch(single, quality, temp),
        ...group.precut,
        ...busyShells.map((b) => b.manifold),
      ]
      const shells: { shell: Manifold; volume: number }[] = []
      if (busy.length > 0) {
        let fused = fuse(busy)
        if (seats) fused = temp(fused.subtract(seats))
        if (group.late.length > 0)
          fused = temp(mf.Manifold.union([fused, ...batch(group.late, quality, temp)]))
        // Two-tone: where a head of one alloy sinks into a band of another, the metal is the
        // smaller casting's, or it would be weighed in both and the castings would not fit.
        const box = boundsOfManifold(fused)
        const overlapping = castSoFar.filter((c) => boundsOverlap(c.box, box))
        if (overlapping.length > 0)
          fused = temp(fused.subtract(fuse(overlapping.map((c) => c.metal))))
        castSoFar.push({ metal: fused, box })
        for (const raw of fused.decompose()) {
          const same = untouched(boundsOfManifold(raw), raw.volume())
          if (same) {
            // It only passed near the rest of the piece: back with its siblings, as it was.
            multi.get(same.home)!.loose.add(same.index)
            raw.delete()
            continue
          }
          const shell = castable(raw)
          const volume = shell.volume()
          if (volume > DUST_MM3) shells.push({ shell, volume })
          else shell.delete()
        }
        shells.sort((a, b) => b.volume - a.volume)
      }
      /** Bodies whose shells (all or some) stay loose, each to become one part. */
      const loose = new Map([...multi].filter(([, body]) => body.loose.size > 0))
      const kept = shells
      // Sources of bodies that became a loose part belong to that part; the rest are shared
      // out among the fused shells.
      const fusedSources = group.sources.filter((source) => !loose.has(source.body.solid))
      const boxes = kept.map(({ shell }) => boundsOfManifold(shell))
      // Each source body belongs to the shell whose box holds its centre (the nearest one when
      // several do).
      const centre = (b: Bounds): [number, number, number] => [
        (b.min[0] + b.max[0]) / 2,
        (b.min[1] + b.max[1]) / 2,
        (b.min[2] + b.max[2]) / 2,
      ]
      const centres = boxes.map(centre)
      const sourceCentres = fusedSources.map((source) => centre(source.body.solid.bounds()))
      const nearest = (
        p: readonly number[],
        candidates: readonly (readonly number[])[],
        allowed?: (i: number) => boolean,
      ) => {
        let best = -1
        let bestDistance = Infinity
        candidates.forEach((c, i) => {
          if (allowed && !allowed(i)) return
          const d = Math.hypot(c[0]! - p[0]!, c[1]! - p[1]!, c[2]! - p[2]!)
          if (d < bestDistance) {
            best = i
            bestDistance = d
          }
        })
        return best
      }
      const owner = sourceCentres.map((p) => {
        const inside = (i: number) =>
          [0, 1, 2].every(
            (k) => p[k]! >= boxes[i]!.min[k]! - 1e-6 && p[k]! <= boxes[i]!.max[k]! + 1e-6,
          )
        const held = nearest(p, centres, inside)
        return held >= 0 ? held : Math.max(0, nearest(p, centres))
      })
      // Add back what tessellation shaved off the exact bodies (second-order for cutters).
      const deficitOf = (sources: readonly Source[]) =>
        sources.reduce(
          (sum, s) => sum + s.body.solid.volume() - meshVolume(s.body.solid.triangles(quality)),
          0,
        )
      kept.forEach(({ shell, volume }, i) => {
        const sources = fusedSources.filter((_, k) => owner[k] === i)
        const solid = solidFromManifold(shell)
        // A shell that no body's centre fell into is still named after the body nearest to it.
        const named =
          sources[0] ?? fusedSources[nearest(centres[i]!, sourceCentres)] ?? group.sources[0]
        const first = named && results.get(named.nodeId)
        const part = partOf(
          `${material}:${i}`,
          first?.id ?? material,
          rev,
          kept.length === 1 || !first ? METALS[material].label : labelOf(first.node),
          majoritySpec(sources.length > 0 ? sources : fusedSources, group.spec),
          [solid],
          quality,
          volume + deficitOf(sources),
        )
        part.exact = sources.length > 0 && sources.every((s) => s.body.solid.exact)
        const regions = regionsOf(part, sources, results)
        if (regions) part.regions = regions
        parts.push({
          part,
          fused: solid,
          sources,
          ...(kept.length > 1 && first ? { namedAfter: first.id } : {}),
        })
      })
      for (const [home, body] of loose) {
        const sources = group.sources.filter((source) => source.body.solid === home)
        const node = results.get(sources[0]!.nodeId)!
        // Untouched bodies are passed on as they are — no boolean, no re-tessellation.
        const whole = body.loose.size === body.shells.boxes.length
        const kept = whole ? null : shellTriangles(body.tris, body.shells, (i) => body.loose.has(i))
        const solid = kept ? lazySolid({ mesh: () => kept }) : home.transformed(IDENTITY)
        const volume = kept ? meshVolume(kept) : home.volume()
        const part = partOf(
          `${material}:${node.id}`,
          node.id,
          rev,
          labelOf(node.node),
          group.spec,
          [solid],
          quality,
          volume,
        )
        part.exact = whole && home.exact
        parts.push({ part, fused: solid, sources, namedAfter: node.id })
      }
    }
    parts.sort(
      (a, b) => designOrder.indexOf(a.part.material) - designOrder.indexOf(b.part.material),
    )
    return {
      parts,
      dispose: () => {
        for (const p of parts) p.fused?.dispose()
      },
    }
  } finally {
    for (const m of temporaries) m.delete()
  }
}

/**
 * Tidies a fused shell for casting: collapses the zero-area slivers booleans leave behind and
 * parts surfaces that merely touch, so the mesh is manifold by position as well as by topology.
 * Takes ownership of `shell`.
 */
function castable(shell: Manifold): Manifold {
  const tidy = shell.simplify(SLIVER)
  shell.delete()
  const parted = separateTouching(trianglesFromManifold(tidy))
  if (!parted) return tidy
  try {
    const result = manifoldFromTriangles(parted)
    tidy.delete()
    return result
  } catch {
    return tidy
  }
}

/** The separate shells of a mesh: which shell each vertex belongs to, and each shell's box. */
interface Shells {
  ofVertex: Uint32Array
  boxes: Bounds[]
  /** Enclosed volume of each shell, mm³. */
  volumes: number[]
}

/** Finds the connected shells of a welded mesh (union-find over its vertices). */
function shellsIn({ positions, indices }: IndexedTriangles): Shells {
  const count = positions.length / 3
  const parent = new Uint32Array(count)
  for (let i = 0; i < count; i++) parent[i] = i
  const find = (v: number): number => {
    while (parent[v] !== v) {
      parent[v] = parent[parent[v]!]!
      v = parent[v]!
    }
    return v
  }
  for (let t = 0; t < indices.length; t += 3) {
    const a = find(indices[t]!)
    parent[find(indices[t + 1]!)] = a
    parent[find(indices[t + 2]!)] = a
  }
  const shellOfRoot = new Map<number, number>()
  const ofVertex = new Uint32Array(count)
  const boxes: Bounds[] = []
  for (let v = 0; v < count; v++) {
    const root = find(v)
    let shell = shellOfRoot.get(root)
    if (shell === undefined) {
      shell = boxes.length
      shellOfRoot.set(root, shell)
      boxes.push({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] })
    }
    ofVertex[v] = shell
    const box = boxes[shell]!
    for (let k = 0; k < 3; k++) {
      const value = positions[v * 3 + k]!
      if (value < box.min[k]!) box.min[k] = value
      if (value > box.max[k]!) box.max[k] = value
    }
  }
  const volumes = boxes.map(() => 0)
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3
    const b = indices[t + 1]! * 3
    const c = indices[t + 2]! * 3
    volumes[ofVertex[indices[t]!]!]! +=
      (positions[a]! *
        (positions[b + 1]! * positions[c + 2]! - positions[b + 2]! * positions[c + 1]!) -
        positions[a + 1]! *
          (positions[b]! * positions[c + 2]! - positions[b + 2]! * positions[c]!) +
        positions[a + 2]! *
          (positions[b]! * positions[c + 1]! - positions[b + 1]! * positions[c]!)) /
      6
  }
  return { ofVertex, boxes, volumes }
}

/** The triangles of the shells that `keep` selects, with their vertices renumbered. */
function shellTriangles(
  tris: IndexedTriangles,
  shells: Shells,
  keep: (shell: number) => boolean,
): IndexedTriangles {
  const { positions, indices } = tris
  const renumbered = new Int32Array(positions.length / 3).fill(-1)
  const outPositions: number[] = []
  const outIndices: number[] = []
  for (let t = 0; t < indices.length; t++) {
    const v = indices[t]!
    if (!keep(shells.ofVertex[v]!)) continue
    if (renumbered[v]! < 0) {
      renumbered[v] = outPositions.length / 3
      outPositions.push(positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!)
    }
    outIndices.push(renumbered[v]!)
  }
  return { positions: new Float32Array(outPositions), indices: new Uint32Array(outIndices) }
}

function boundsOfManifold(m: Manifold): Bounds {
  const box = m.boundingBox()
  return { min: [...box.min], max: [...box.max] }
}
