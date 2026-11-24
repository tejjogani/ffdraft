import { GEM_CUT_IDS, GEM_CUTS, type GemCut } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { weld } from '../solid/meshing'
import { facetCounts, gemUnit, unitContains } from './index'

/** Every edge of a closed surface is shared by exactly two triangles. */
function openEdges(positions: Float32Array, indices: Uint32Array): number {
  // Flat shading splits vertices per facet; weld them back on a 1e-5 grid to see the topology.
  const snapped = positions.map((v) => Math.round(v * 1e5) / 1e5)
  const welded = weld(snapped, indices)
  const count = new Map<string, number>()
  for (let t = 0; t < welded.indices.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = welded.indices[t + e]!
      const b = welded.indices[t + ((e + 1) % 3)]!
      const key = a < b ? `${a}/${b}` : `${b}/${a}`
      count.set(key, (count.get(key) ?? 0) + 1)
    }
  return [...count.values()].filter((n) => n !== 2).length
}

describe('gem unit meshes', () => {
  it.each(GEM_CUT_IDS)('%s is closed, outward-facing and the right size', (id) => {
    const cut: GemCut = GEM_CUTS[id]
    const unit = gemUnit(id)
    const { positions, normals, indices } = unit.mesh
    expect(openEdges(positions, indices)).toBe(0)

    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < positions.length; i++) {
      min[i % 3] = Math.min(min[i % 3]!, positions[i]!)
      max[i % 3] = Math.max(max[i % 3]!, positions[i]!)
    }
    expect(Math.abs(max[0]! - min[0]! - 1)).toBeLessThan(1e-3) // unit girdle width
    expect(max[1]! - min[1]!).toBeCloseTo(cut.lw.default, 2) // length along y
    expect(unit.depth).toBeCloseTo(cut.depthPct, 3) // table to culet
    expect(unit.top).toBeGreaterThan(0)
    expect(unit.bottom).toBeLessThanOrEqual(-cut.girdlePct / 2 + 1e-9)

    // Triangles wind counter-clockwise about their (unit) normal, which points out of the stone.
    let volume = 0
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t]! * 3, indices[t + 1]! * 3, indices[t + 2]! * 3]
      const u = [0, 1, 2].map((k) => positions[b + k]! - positions[a + k]!)
      const v = [0, 1, 2].map((k) => positions[c + k]! - positions[a + k]!)
      const n = [
        u[1]! * v[2]! - u[2]! * v[1]!,
        u[2]! * v[0]! - u[0]! * v[2]!,
        u[0]! * v[1]! - u[1]! * v[0]!,
      ]
      expect(
        n[0]! * normals[a]! + n[1]! * normals[a + 1]! + n[2]! * normals[a + 2]!,
      ).toBeGreaterThan(0)
      expect(Math.hypot(normals[a]!, normals[a + 1]!, normals[a + 2]!)).toBeCloseTo(1, 4)
      volume += (positions[a]! * n[0]! + positions[a + 1]! * n[1]! + positions[a + 2]! * n[2]!) / 6
    }
    // A real stone fills a good part of its bounding box (and has positive volume).
    const box = cut.lw.default * unit.depth
    expect(volume / box).toBeGreaterThan(0.2)
    expect(volume / box).toBeLessThan(0.75)
    // The silhouette used for seats and collision tests agrees with the mesh.
    expect(unitContains(unit, [unit.outline.centre[0], unit.outline.centre[1], 0])).toBe(true)
    expect(unitContains(unit, [0.6, 0, 0])).toBe(false)
  })

  it('round brilliant has 57 facets plus a faceted girdle', () => {
    const counts = facetCounts(gemUnit('round'))
    expect(counts).toMatchObject({
      table: 1,
      star: 8,
      kite: 8,
      upperGirdle: 16,
      lowerGirdle: 16,
      pavilionMain: 8,
    })
    const { girdle, ...crownAndPavilion } = counts
    expect(Object.values(crownAndPavilion).reduce((a, b) => a + b, 0)).toBe(57)
    expect(girdle).toBe(64)
  })

  it('fancy brilliants keep the brilliant facet arrangement on their own outline', () => {
    for (const id of ['oval', 'pear', 'marquise', 'heart', 'cushion', 'radiant'] as const)
      expect(facetCounts(gemUnit(id)), id).toMatchObject({
        table: 1,
        star: 8,
        kite: 8,
        upperGirdle: 16,
        lowerGirdle: 16,
        pavilionMain: 8,
      })
    expect(facetCounts(gemUnit('princess'))).toMatchObject({
      table: 1,
      star: 4,
      kite: 4,
      pavilionMain: 4,
    })
    expect(facetCounts(gemUnit('trillion'))).toMatchObject({
      table: 1,
      star: 6,
      kite: 6,
      pavilionMain: 6,
    })
  })

  it('step cuts have three tiers of steps above and below the girdle', () => {
    expect(facetCounts(gemUnit('emerald'))).toEqual({
      table: 1,
      crownStep: 24,
      girdle: 8,
      pavilionStep: 24,
    })
    expect(facetCounts(gemUnit('asscher'))).toEqual({
      table: 1,
      crownStep: 24,
      girdle: 8,
      pavilionStep: 24,
    })
    expect(facetCounts(gemUnit('baguette'))).toEqual({
      table: 1,
      crownStep: 12,
      girdle: 4,
      pavilionStep: 12,
    })
  })

  it('cuts are convex: no vertex lies outside any facet plane', () => {
    // Pointed outlines (pear, marquise, heart, trillion) fold their tip facets and are excluded.
    for (const id of [
      'round',
      'emerald',
      'asscher',
      'baguette',
      'oval',
      'cushion',
      'radiant',
      'princess',
    ] as const) {
      const { positions, normals, indices } = gemUnit(id).mesh
      let worst = 0
      for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t]! * 3
        for (let v = 0; v < positions.length; v += 3) {
          const d =
            (positions[v]! - positions[a]!) * normals[a]! +
            (positions[v + 1]! - positions[a + 1]!) * normals[a + 1]! +
            (positions[v + 2]! - positions[a + 2]!) * normals[a + 2]!
          worst = Math.max(worst, d)
        }
      }
      // Round and step cuts are exactly convex; on fancy outlines the half facets next to a
      // strongly curved girdle dent the hull by a few percent of the width.
      const exact = ['round', 'emerald', 'asscher', 'baguette'].includes(id)
      expect(worst, id).toBeLessThan(exact ? 1e-4 : 0.04)
    }
  })

  it('every cut at its shortest, usual and longest ratio is closed and consistently wound, with no triangle facing in', () => {
    for (const id of GEM_CUT_IDS) {
      const { lw } = GEM_CUTS[id]
      for (const ratio of new Set([lw.min, lw.default, lw.max])) {
        const unit = gemUnit(id, ratio)
        const snapped = unit.mesh.positions.map((v) => Math.round(v * 1e5) / 1e5)
        const { positions: p, indices: ix } = weld(snapped, unit.mesh.indices)
        const label = `${id}@${ratio}`
        expect(openEdges(unit.mesh.positions, unit.mesh.indices), label).toBe(0)
        // Each edge is walked once each way by its two triangles.
        const walked = new Set<string>()
        let twice = 0
        let inward = 0
        const [cx, cy] = unit.outline.centre
        const mid = [cx, cy, (unit.top + unit.bottom) / 2]
        for (let t = 0; t < ix.length; t += 3) {
          const v = [0, 1, 2].map((k) => [
            p[ix[t + k]! * 3]!,
            p[ix[t + k]! * 3 + 1]!,
            p[ix[t + k]! * 3 + 2]!,
          ])
          for (let e = 0; e < 3; e++) {
            const key = `${ix[t + e]}>${ix[t + ((e + 1) % 3)]}`
            if (walked.has(key)) twice++
            walked.add(key)
          }
          const [a, b, c] = v as [number[], number[], number[]]
          const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!]
          const w = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!]
          const n = [
            u[1]! * w[2]! - u[2]! * w[1]!,
            u[2]! * w[0]! - u[0]! * w[2]!,
            u[0]! * w[1]! - u[1]! * w[0]!,
          ]
          if (
            n[0]! * (a[0]! - mid[0]!) + n[1]! * (a[1]! - mid[1]!) + n[2]! * (a[2]! - mid[2]!) <
            -1e-12
          )
            inward++
        }
        expect(twice, `${label}: edges walked the same way twice`).toBe(0)
        expect(inward, `${label}: triangles facing in`).toBe(0)
      }
    }
  })

  it('the silhouette seats and claws are measured from contains every vertex of the stone', () => {
    for (const id of GEM_CUT_IDS) {
      const { lw } = GEM_CUTS[id]
      for (const ratio of new Set([lw.min, lw.default, lw.max])) {
        const unit = gemUnit(id, ratio)
        const { stack, outline: o, keel } = unit
        const p = unit.mesh.positions
        let worst = 0
        for (let i = 0; i < p.length; i += 3) {
          const [x, y, z] = [p[i]!, p[i + 1]!, p[i + 2]!]
          if (z <= stack[0]!.z + 1e-6 || z >= stack[stack.length - 1]!.z - 1e-6) continue
          let k = 0
          while (stack[k + 1]!.z < z) k++
          const a = stack[k]!
          const b = stack[k + 1]!
          const scale = a.scale + ((b.scale - a.scale) * (z - a.z)) / (b.z - a.z)
          const anchor = o.centre[1] + Math.min(keel, Math.max(-keel, y - o.centre[1]))
          const gx = (x - o.centre[0]) / Math.max(scale, 1e-9)
          const gy = anchor - o.centre[1] + (y - anchor) / Math.max(scale, 1e-9)
          worst = Math.max(worst, (Math.hypot(gx, gy) - o.radius(Math.atan2(gy, gx))) * scale)
        }
        expect(worst, `${id}@${ratio}`).toBeLessThan(2e-3)
      }
    }
  })

  it('meshes are shared per cut and ratio', () => {
    expect(gemUnit('oval', 1.4)).toBe(gemUnit('oval', 1.401))
    expect(gemUnit('oval', 1.5).key).toBe('oval@1.5')
    expect(gemUnit('oval', 9).length).toBe(GEM_CUTS.oval.lw.max)
    // No ratio means the cut's own; a ratio of 1 is a real request, clamped like any other.
    expect(gemUnit('oval').length).toBe(GEM_CUTS.oval.lw.default)
    expect(gemUnit('oval', 1).length).toBe(GEM_CUTS.oval.lw.min)
  })
})

describe('gem meshes weld exactly', () => {
  it.each(GEM_CUT_IDS)('%s: coincident facet corners are bit-identical', (id) => {
    // Consumers build solids from these meshes by welding equal positions, with no tolerance.
    const { positions, indices } = gemUnit(id).mesh
    const welded = weld(positions, indices)
    const count = new Map<number, number>()
    const n = welded.positions.length / 3
    for (let t = 0; t < welded.indices.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const a = welded.indices[t + e]!
        const b = welded.indices[t + ((e + 1) % 3)]!
        const key = a < b ? a * n + b : b * n + a
        count.set(key, (count.get(key) ?? 0) + 1)
      }
    expect([...count.values()].filter((c) => c !== 2)).toEqual([])
  })
})
