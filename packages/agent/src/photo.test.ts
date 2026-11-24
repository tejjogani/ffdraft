import { type PhotoRead, PhotoReadSchema, PieceSpecSchema, planDesign } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { messageFor } from './model'
import { buildReadRequest, parseReadMessage, ReadError, specFromRead } from './photo'

const image = { label: 'ring.jpg', mediaType: 'image/jpeg' as const, data: 'AAAA' }

export const SOLITAIRE_READ: PhotoRead = {
  observations:
    'A round brilliant in six slim claws on a plain band; the band is seen from the front and narrows slightly at the back.',
  kind: { value: 'ring', visible: 'yes' },
  view: 'threeQuarter',
  archetype: { value: 'solitaire', visible: 'yes' },
  stones: [
    {
      role: 'center',
      cut: 'round',
      arrangement: 'single',
      setting: 'prong',
      prongs: 6,
      countVisible: 1,
      widthToCentre: 1,
      visible: 'yes',
    },
  ],
  band: {
    profile: 'court',
    shoulder: 'plain',
    widthToStone: 0.36,
    taperTopToBottom: 1.1,
    visible: 'partly',
  },
  body: null,
  metal: { colour: 'yellow', finish: 'polished', visible: 'yes' },
  notVisible: ['the inside of the band', 'the gallery under the stone'],
  unsure: [{ field: 'band.profile', why: 'a photo along the finger would show it' }],
  plainBackground: true,
}

describe('buildReadRequest', () => {
  it('asks for the read as structured output with the per-model rules of a turn', () => {
    const r = buildReadRequest({ model: 'claude-opus-5-5', images: [image], kindHint: 'ring' })
    expect(r.output_config?.effort).toBe('high')
    expect(r.output_config?.format?.type).toBe('json_schema')
    const schema = r.output_config?.format?.schema as { properties: Record<string, unknown> }
    // Reasoning first, the structured answer after it.
    expect(Object.keys(schema.properties)[0]).toBe('observations')
    expect(r.thinking).toEqual({ type: 'adaptive' })
    expect(r.fallbacks).toBe('default')
    expect(r.betas).toEqual(['server-side-fallback-2026-07-01'])
    // No sampling parameters, no prefill, no tools.
    for (const k of ['temperature', 'top_p', 'top_k', 'tools', 'tool_choice'])
      expect(r).not.toHaveProperty(k)
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0]!.role).toBe('user')
    const content = r.messages[0]!.content as { type: string }[]
    expect(content.map((b) => b.type)).toEqual(['text', 'image', 'text'])
  })

  it('leaves fallbacks off on Haiku, which has none', () => {
    const r = buildReadRequest({ model: 'claude-haiku-5-5', images: [image] })
    expect(r).not.toHaveProperty('fallbacks')
    expect(r).not.toHaveProperty('betas')
  })

  it('sends a JSON schema inside the structured-output subset', () => {
    const r = buildReadRequest({ model: 'claude-sonnet-5-5', images: [image] })
    const json = JSON.stringify(r.output_config?.format?.schema)
    for (const banned of ['"minimum"', '"maximum"', '"minLength"', '"maxLength"'])
      expect(json).not.toContain(banned)
    // Every object closes its properties, as structured outputs require.
    const walk = (s: unknown): void => {
      if (!s || typeof s !== 'object') return
      const o = s as Record<string, unknown>
      if (o.type === 'object') expect(o.additionalProperties).toBe(false)
      for (const v of Object.values(o)) walk(v)
    }
    walk(r.output_config?.format?.schema)
  })
})

describe('parseReadMessage', () => {
  const answer = (text: string, stop?: 'refusal' | 'max_tokens') =>
    messageFor(
      { content: [{ type: 'text', text }], ...(stop ? { stop_reason: stop } : {}) },
      1,
      'claude-opus-5-5',
    )

  it('returns the validated read', () => {
    expect(parseReadMessage(answer(JSON.stringify(SOLITAIRE_READ)))).toEqual(SOLITAIRE_READ)
  })

  it('refuses to use a declined, cut-off, non-JSON or off-format answer', () => {
    expect(() => parseReadMessage(answer('{}', 'refusal'))).toThrow(ReadError)
    expect(() => parseReadMessage(answer('{"observ', 'max_tokens'))).toThrow(/cut off/)
    expect(() => parseReadMessage(answer('not json'))).toThrow(/JSON/)
    expect(() =>
      parseReadMessage(answer(JSON.stringify({ ...SOLITAIRE_READ, view: 'aerial' }))),
    ).toThrow(/format/)
  })
})

describe('specFromRead', () => {
  it('turns a read into a buildable spec, listing what it assumed', () => {
    const { spec, assumed } = specFromRead(SOLITAIRE_READ)
    const parsed = PieceSpecSchema.parse(spec)
    expect(parsed.archetype).toBe('solitaire')
    expect(parsed.stones[0]).toMatchObject({ role: 'center', cut: 'round', prongs: 6, carat: 1 })
    expect(parsed.metal.alloy).toBe('au18k-yellow')
    expect(parsed.ring?.profile).toBe('court')
    // 1 ct round ≈ 6.4 mm; the band is 0.36 of it.
    expect(parsed.ring?.bandWidthMm).toBeGreaterThan(2)
    expect(parsed.ring?.bandWidthMm).toBeLessThan(2.6)
    expect(assumed.join(' ')).toMatch(/1 ct/)
    expect(assumed.join(' ')).toMatch(/US 6/)
    expect(() => planDesign(spec)).not.toThrow()
  })

  it('uses the designer’s scale when given, and every schema field stays valid', () => {
    const { spec, assumed } = specFromRead(SOLITAIRE_READ, { centreCarat: 2, ringSizeUs: 7 })
    expect(assumed.join(' ')).not.toMatch(/ct|US/)
    expect(PieceSpecSchema.parse(spec).ring?.size.value).toBe(7)
    expect(PhotoReadSchema.safeParse(SOLITAIRE_READ).success).toBe(true)
  })
})
