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
  type MetalSpec,
  type NodeResult,
  type Quality,
  type ScenePart,
  type Solid,
  runtime,
  solidFromManifold,
} from '../core'
import {
  type IndexedTriangles,
  boundsOfPositions,
  boundsOverlap,
  mergeTessellations,
  meshVolume,
  unionBounds,
} from '../solid/meshing'
import { manifoldFromTriangles } from '../solid/solid'
import type { Bounds, Part } from '../types'
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
export function activeResults(design: Design, results: ReadonlyMap<string, NodeResult>): NodeResult[] {
  const consumed = consumedBy(results)
  return [...results.values()].filter(
    (r) => r.status === 'ok' && r.node.visible && !consumed.has(r.id) && design.nodes[r.id],
  )
}

function consumedBy(results: ReadonlyMap<string, NodeResult>): Map<string, string> {
  const map = new Map<string, string>()
  for (const r of results.values()) if (r.status === 'ok') for (const id of r.consumes) map.set(id, r.id)
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

const specOf = (b: MetalSpec): MetalSpec => ({ material: b.material, finish: b.finish, plating: b.plating })

/**
 * Volume of overlapping solids fused together. The fuse runs on meshes; each exact solid's
 * tessellation deficit is added back so the figure is as good as the exact volumes allow.
 */
function fusedVolume(solids: readonly Solid[], quality: Quality): number {
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
      if (host) sources.push({ nodeId: result.id, body: { solid: addition.solid, ...specOf(host.bodies[0]!) } })
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
function batch(solids: readonly Solid[], quality: Quality, own: (m: Manifold) => Manifold): Manifold[] {
  if (solids.length <= 1) return solids.map((s) => s.manifold(quality))
  const out: Manifold[] = []
  const batches: { members: { tris: IndexedTriangles; box: Bounds }[]; cells: Map<string, number[]> }[] = []
  const boxes = solids.map((solid) => boundsOfPositions(solid.triangles(quality).positions))
  // Hash grid sized to the typical solid, so overlap tests stay local with thousands of stones.
  const sizes = boxes.map((b) => Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])).sort((a, b) => a - b)
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
      for (let y = lo[1]!; y <= hi[1]!; y++) for (let z = lo[2]!; z <= hi[2]!; z++) keys.push(`${x},${y},${z}`)
    let home = batches.find((b) => !keys.some((k) => b.cells.get(k)?.some((i) => boundsOverlap(b.members[i]!.box, box))))
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
  const fuse = (list: readonly Manifold[]): Manifold => (list.length === 1 ? list[0]! : temp(mf.Manifold.union(list)))

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

    const seats = everywhere.length > 0 ? fuse(batch(everywhere, quality, temp)) : null
    const parts: ScenePart[] = []
    for (const [material, group] of groups) {
      let fused = fuse([...batch(group.solids, quality, temp), ...group.precut])
      if (seats) fused = temp(fused.subtract(seats))
      if (group.late.length > 0) fused = temp(mf.Manifold.union([fused, ...batch(group.late, quality, temp)]))
      const shells = fused
        .decompose()
        .map((shell) => ({ shell, volume: shell.volume() }))
        .sort((a, b) => b.volume - a.volume)
      const kept = shells.filter((s) => s.volume > DUST_MM3)
      for (const s of shells) if (s.volume <= DUST_MM3) s.shell.delete()
      const boxes = kept.map(({ shell }) => boundsOfManifold(shell))
      // Each source body is attributed to the first shell it touches.
      const owner = group.sources.map((source) => {
        const box = source.body.solid.bounds()
        const index = boxes.findIndex((b) => boundsOverlap(b, box))
        return index < 0 ? 0 : index
      })
      kept.forEach(({ shell, volume }, i) => {
        const sources = group.sources.filter((_, k) => owner[k] === i)
        const solid = solidFromManifold(shell)
        // Add back what tessellation shaved off the exact bodies (second-order for cutters).
        const deficit = sources.reduce(
          (sum, s) => sum + s.body.solid.volume() - meshVolume(s.body.solid.triangles(quality)),
          0,
        )
        const first = sources[0] && results.get(sources[0].nodeId)
        const part = partOf(
          `${material}:${i}`,
          first?.id ?? material,
          rev,
          kept.length === 1 || !first ? METALS[material].label : labelOf(first.node),
          group.spec,
          [solid],
          quality,
          volume + deficit,
        )
        part.exact = sources.length > 0 && sources.every((s) => s.body.solid.exact)
        parts.push({ part, fused: solid, sources })
      })
    }
    return { parts, dispose: () => parts.forEach((p) => p.fused?.dispose()) }
  } finally {
    for (const m of temporaries) m.delete()
  }
}

function boundsOfManifold(m: Manifold): Bounds {
  const box = m.boundingBox()
  return { min: [...box.min], max: [...box.max] }
}
