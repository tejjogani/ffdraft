import type { Report } from '@pave/kernel/types'
import { TEMPLATES, buildDesign } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { createDiaexProvider, describeRequirement, metalRequirements, stoneRequirements } from './index'

const report: Report = {
  metals: [{ material: 'pt950', volumeMm3: 180, massG: 3.85 }],
  metalMassG: 3.85,
  lots: [
    { cut: 'oval', stone: 'diamond', width: 6, length: 8, count: 1, caratEach: 1.5, caratTotal: 1.5, setting: 'prong', role: 'center', nodeIds: ['center'] },
    { cut: 'round', stone: 'diamond', width: 1.32, length: 1.32, count: 28, caratEach: 0.0085, caratTotal: 0.238, setting: 'pave', role: 'melee', nodeIds: ['row'] },
    { cut: 'round', stone: 'sapphire-blue', width: 3, length: 3, count: 2, caratEach: 0.13, caratTotal: 0.26, setting: 'bezel', role: 'side', nodeIds: ['side1', 'side2'] },
  ],
  stoneCount: 31,
  caratTotal: 2,
  bounds: { min: [-10, -2, -10], max: [10, 2, 14] },
}

describe('sourcing', () => {
  const design = buildDesign(TEMPLATES.find((t) => t.id === 'oval-pave')!.spec)
  const reqs = stoneRequirements(design, report)

  it('classifies lots and snaps melee to stock sizes', () => {
    expect(reqs.map((r) => r.kind)).toEqual(['single', 'parcel', 'matchedSet'])
    expect(reqs[1]!.seat.width).toBe(1.3)
    expect(reqs[0]!.quality.certified).toBe(true)
    expect(describeRequirement(reqs[0]!)).toContain('8.00 × 6.00 mm')
  })

  it('builds Diaex deep links that fit the seat', () => {
    const diaex = createDiaexProvider()
    const url = new URL(diaex.searchUrl(reqs[0]!)!)
    const f = JSON.parse(url.searchParams.get('f')!)
    expect(url.pathname).toBe('/browse')
    expect(f).toMatchObject({ shapes: ['oval'], min_length_mm: 7.9, max_length_mm: 8.15, availability: ['available'] })
    expect(diaex.searchUrl(reqs[2]!)).toBeNull()
  })

  it('searches lab-grown stock for a lab-grown diamond, whatever an old quality note says', () => {
    // The stone was changed from a natural to a lab-grown diamond; its quality still says natural.
    const centre = design.nodes.center!
    if (centre.kind !== 'gem') throw new Error('the template has a centre gem')
    const swapped = {
      ...design,
      nodes: { ...design.nodes, center: { ...centre, stone: 'diamond-lab' as const, quality: { origin: 'natural' as const } } },
    }
    const lab = { ...report, lots: [{ ...report.lots[0]!, stone: 'diamond-lab' as const }] }
    const [r] = stoneRequirements(swapped, lab)
    expect(r!.origin).toBe('lab')
    const f = JSON.parse(new URL(createDiaexProvider().searchUrl(r!)!).searchParams.get('f')!)
    expect(f.stone_types).toEqual(['CVD', 'HPHT'])
  })

  it('adds a casting allowance to metal', () => {
    const [m] = metalRequirements(report)
    expect(m!.orderGrams).toBeCloseTo(m!.netGrams * 1.12)
    expect(m!.fineGrams).toBeCloseTo(m!.orderGrams * 0.95)
  })
})
