import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  applyOps,
  buildDesign,
  evaluationOrder,
  gemCarat,
  gemDims,
  gemDimsFromCarat,
  NODE_SCHEMAS,
  ringInnerDiameter,
  ringSizeFromDiameter,
  TEMPLATES,
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
  it('undoes a variant switch sent as a plain merge patch', () => {
    // Halo ring: centre on the band (ringTop) switched to free placement, then undone.
    const d0 = buildDesign(TEMPLATES.find((t) => t.id === 'halo')!.spec)
    const { design: d1, inverse } = applyOps(d0, [
      { t: 'update', id: 'center', patch: { placement: { type: 'free' } } },
    ])
    expect(applyOps(d1, inverse).design).toEqual(d0)
    // Iced initial: the text body switched to a shape and back restores its text and font.
    const i0 = buildDesign(TEMPLATES.find((t) => t.id === 'iced-initial')!.spec)
    const body = Object.values(i0.nodes).find((n) => n.kind === 'vectorBody')!
    const switched = applyOps(i0, [
      { t: 'update', id: body.id, patch: { source: { type: 'shape', shape: 'star' } } },
    ])
    expect(applyOps(switched.design, switched.inverse).design).toEqual(i0)
  })
  it('checks ops as the wire schema does, and treats any string as an ordinary id', () => {
    const d = buildDesign(TEMPLATES[0]!.spec)
    const bad = [
      { t: 'setKind', kind: 'tiara' },
      { t: 'frobnicate' },
      { id: 'band' },
      { t: 'move', id: 'band', index: -1 },
      { t: 'move', id: 'band', index: 1.5 },
      { t: 'update', id: 'band', patch: 'x' },
    ]
    for (const op of bad)
      expect(() => applyOps(d, [op as never]), JSON.stringify(op)).toThrow(/Invalid op/)
    expect(() => applyOps(d, [{ t: 'add', node: { id: '', kind: 'ringShank' } }])).toThrow(/empty/)
    for (const id of ['constructor', 'toString', 'hasOwnProperty']) {
      const added = applyOps(d, [{ t: 'add', node: { id, kind: 'ringShank' } }]).design
      expect(Object.hasOwn(added.nodes, id), id).toBe(true)
      expect(validateDesign(added), id).toEqual([])
    }
    // It would not survive a save and load: the record parser drops that key.
    expect(() => applyOps(d, [{ t: 'add', node: { id: '__proto__', kind: 'ringShank' } }])).toThrow(
      /cannot be a node id/,
    )
  })
  it('undoes a cascade remove into the same document, node order included', () => {
    const d0 = buildDesign(TEMPLATES.find((t) => t.id === 'halo')!.spec)
    const { design: d1, inverse } = applyOps(d0, [{ t: 'remove', id: 'center', cascade: true }])
    const back = applyOps(d1, inverse).design
    expect(Object.keys(back.nodes)).toEqual(Object.keys(d0.nodes))
    expect(JSON.stringify(back)).toBe(JSON.stringify(d0))
  })
  it('reports nodes missing from the order', () => {
    const d = buildDesign(TEMPLATES[0]!.spec)
    const issues = validateDesign({ ...d, order: d.order.slice(1) })
    expect(issues.map((i) => i.nodeId)).toEqual([d.order[0]])
  })
  it('reports order entries named like Object members, duplicates, and a "__proto__" id', () => {
    const d = buildDesign(TEMPLATES[0]!.spec)
    for (const id of ['constructor', 'toString', 'hasOwnProperty'])
      expect(validateDesign({ ...d, order: [...d.order, id] }).map((i) => i.message)).toEqual([
        `Order lists missing node "${id}"`,
      ])
    expect(
      validateDesign({ ...d, order: [...d.order, d.order[0]!] }).map((i) => i.message),
    ).toEqual([`Order lists "${d.order[0]}" more than once`])
    const proto = JSON.parse(
      JSON.stringify(d).replace(
        '"nodes":{',
        `"nodes":{"__proto__":${JSON.stringify(d.nodes.band)},`,
      ),
    )
    expect(validateDesign(proto).map((i) => i.message)).toContain('"__proto__" cannot be a node id')
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
