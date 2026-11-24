import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  NODE_SCHEMAS,
  TEMPLATES,
  applyOps,
  buildDesign,
  evaluationOrder,
  gemCarat,
  gemDims,
  gemDimsFromCarat,
  ringInnerDiameter,
  ringSizeFromDiameter,
  validateDesign,
} from './index'

describe('domain', () => {
  it('estimates diamond carat weights', () => {
    expect(gemCarat('round', gemDims('round', 6.5))).toBeCloseTo(1.02, 1)
    expect(gemCarat('princess', gemDims('princess', 5.5))).toBeCloseTo(1.0, 1)
    expect(gemDimsFromCarat('round', 1).width).toBeCloseTo(6.46, 1)
    expect(gemDimsFromCarat('round', 1, 'sapphire-blue').width).toBeLessThan(6.3)
  })
  it('converts ring sizes', () => {
    expect(ringInnerDiameter({ system: 'us', value: 6 })).toBeCloseTo(16.51, 2)
    // US 6 is UK L½ (letter index 11.5): circumference 37.5 + 1.25 × 11.5 mm.
    expect(ringInnerDiameter({ system: 'uk', value: 11.5 })).toBeCloseTo(16.51, 2)
    expect(ringInnerDiameter({ system: 'jp', value: 12 })).toBeCloseTo(16.68, 2)
    expect(ringSizeFromDiameter(16.51, 'uk').value).toBe(11.5)
    expect(ringInnerDiameter({ system: 'eu', value: 52 })).toBeCloseTo(16.55, 2)
    expect(ringSizeFromDiameter(17.32, 'us').value).toBe(7)
  })
})

describe('design', () => {
  it('builds every template into a valid, orderable design', () => {
    for (const t of TEMPLATES) {
      const d = buildDesign(t.spec)
      expect(validateDesign(d), t.id).toEqual([])
      expect(evaluationOrder(d), t.id).not.toBeNull()
    }
  })
  it('applies ops and inverts them exactly', () => {
    const d0 = buildDesign(TEMPLATES[0]!.spec)
    const { design: d1, inverse } = applyOps(d0, [
      { t: 'update', id: 'center', patch: { width: 7.4, placement: { elevation: 2 } } },
      { t: 'add', node: { id: 'halo', kind: 'halo', around: 'center' } },
      { t: 'remove', id: 'head' },
    ])
    expect(d1.nodes.center).toMatchObject({
      width: 7.4,
      placement: { type: 'ringTop', elevation: 2 },
    })
    expect(d1.nodes.head).toBeUndefined()
    expect(applyOps(d1, inverse).design).toEqual(d0)
  })
  it('rejects dangling references and guards removal', () => {
    const d = buildDesign(TEMPLATES[0]!.spec)
    expect(() => applyOps(d, [{ t: 'remove', id: 'band' }])).toThrow(/used by/)
    expect(
      Object.keys(applyOps(d, [{ t: 'remove', id: 'band', cascade: true }]).design.nodes),
    ).toEqual([])
    expect(() => applyOps(d, [{ t: 'update', id: 'center', patch: { width: 900 } }])).toThrow()
  })
  it('exposes field metadata through JSON Schema', () => {
    const js = z.toJSONSchema(NODE_SCHEMAS.ringShank, { io: 'input' }) as {
      properties: Record<string, { title?: string; unit?: string }>
    }
    expect(js.properties.widthTop).toMatchObject({ title: 'Width at top', unit: 'mm' })
  })
})
