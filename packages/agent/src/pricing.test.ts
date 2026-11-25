import { ASSISTANT_MODELS, ASSISTANT_TIERS } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { MODELS, modelForRun, resolveTiers, TIERS, typicalRunUsd, usageCost } from './pricing'

const M = 1_000_000

describe('prices', () => {
  it('has every allow-listed model at its published rates', () => {
    expect(Object.keys(MODELS).sort()).toEqual([...ASSISTANT_MODELS].sort())
    const rate = (model: keyof typeof MODELS, u: Parameters<typeof usageCost>[1]) =>
      usageCost(model, u).costUsd
    const unit = { input_tokens: 0, output_tokens: 0 }
    // input / output / cache read / 5-minute write / 1-hour write, per million tokens
    const table: [keyof typeof MODELS, number, number, number, number, number][] = [
      ['claude-fable-5-2', 8, 40, 0.2, 10, 16],
      ['claude-opus-5-5', 4, 20, 0.2, 5, 8],
      ['claude-sonnet-5-5', 2, 10, 0.1, 2.5, 4],
      ['claude-haiku-5-5', 0.1, 0.5, 0.01, 0.125, 0.2],
    ]
    for (const [model, input, output, read, w5, w1] of table) {
      expect(rate(model, { ...unit, input_tokens: M / 10 }) * 10, model).toBeCloseTo(input)
      expect(rate(model, { ...unit, output_tokens: M / 10 }) * 10, model).toBeCloseTo(output)
      expect(rate(model, { ...unit, cache_read_input_tokens: M / 10 }) * 10, model).toBeCloseTo(
        read,
      )
      expect(rate(model, { ...unit, cache_creation_input_tokens: M / 10 }) * 10, model).toBeCloseTo(
        w5,
      )
      expect(
        rate(model, {
          ...unit,
          cache_creation_input_tokens: M / 10,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: M / 10 },
        }) * 10,
        model,
      ).toBeCloseTo(w1)
    }
  })

  it('prices Haiku’s long prompts on its second rate card', () => {
    const short = usageCost('claude-haiku-5-5', { input_tokens: 100_000, output_tokens: 1000 })
    const long = usageCost('claude-haiku-5-5', { input_tokens: 100_001, output_tokens: 1000 })
    expect(short.costUsd).toBeCloseTo((100_000 * 0.1 + 1000 * 0.5) / M)
    expect(long.costUsd).toBeCloseTo((100_001 * 0.5 + 1000 * 2.5) / M)
    // Cached tokens count toward the prompt length.
    const cached = usageCost('claude-haiku-5-5', {
      input_tokens: 1_000,
      output_tokens: 0,
      cache_read_input_tokens: 150_000,
    })
    expect(cached.costUsd).toBeCloseTo((1_000 * 0.5 + 150_000 * 0.05) / M)
  })

  it('prices each attempt at its own model when a fallback ran', () => {
    const r = usageCost('claude-opus-5', {
      input_tokens: 10,
      output_tokens: 10,
      iterations: [
        { type: 'message', model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 0 },
        {
          type: 'fallback_message',
          model: 'claude-opus-5',
          input_tokens: 1000,
          output_tokens: 500,
        },
      ],
    })
    expect(r.tokens).toEqual({ input: 2000, output: 500, cacheRead: 0, cacheWrite: 0 })
    expect(r.costUsd).toBeCloseTo((1000 * 4 + 1000 * 5 + 500 * 25) / M)
    // An unknown model is never under-counted.
    expect(usageCost('claude-new', { input_tokens: M, output_tokens: 0 }).costUsd).toBeCloseTo(8)
  })

  it('orders a typical run by tier price', () => {
    const [fable, opus, sonnet, haiku] = ASSISTANT_MODELS.map(typicalRunUsd)
    expect(fable!).toBeGreaterThan(opus!)
    expect(opus!).toBeGreaterThan(sonnet!)
    expect(sonnet!).toBeGreaterThan(haiku!)
    expect(opus!).toBeGreaterThan(0.1)
    expect(opus!).toBeLessThan(2)
  })
})

describe('tiers', () => {
  it('maps Power, Standard and Light to Fable, Opus and Sonnet by default, Standard first', () => {
    const r = resolveTiers(null)
    expect(r.defaultTier).toEqual({ tier: 'standard', source: 'default' })
    expect(r.tiers).toEqual({
      power: { model: 'claude-fable-5-2', source: 'default' },
      standard: { model: 'claude-opus-5-5', source: 'default' },
      light: { model: 'claude-sonnet-5-5', source: 'default' },
    })
    expect(Object.keys(TIERS)).toEqual([...ASSISTANT_TIERS])
  })

  it('lets settings repoint a tier and env overrides win over settings', () => {
    const settings = {
      assistantTier: 'light' as const,
      assistantModels: { light: 'claude-haiku-5-5' as const, power: null },
    }
    const r = resolveTiers(settings, {
      PAVE_ASSISTANT_MODEL_POWER: 'claude-opus-5-5',
      PAVE_ASSISTANT_TIER: 'power',
    })
    expect(r.defaultTier).toEqual({ tier: 'power', source: 'env' })
    expect(r.tiers.power).toEqual({ model: 'claude-opus-5-5', source: 'env' })
    expect(r.tiers.light).toEqual({ model: 'claude-haiku-5-5', source: 'settings' })
    expect(modelForRun(r)).toEqual({ tier: 'power', model: 'claude-opus-5-5' })
    expect(modelForRun(r, 'light')).toEqual({ tier: 'light', model: 'claude-haiku-5-5' })
    expect(modelForRun(resolveTiers(settings), undefined)).toEqual({
      tier: 'light',
      model: 'claude-haiku-5-5',
    })
  })

  it('ignores an override it does not understand, and says so', () => {
    const r = resolveTiers(null, {
      PAVE_ASSISTANT_TIER: 'turbo',
      PAVE_ASSISTANT_MODEL_LIGHT: 'gpt-4',
      PAVE_ASSISTANT_MODEL_STANDARD: '  ',
    })
    expect(r.defaultTier.tier).toBe('standard')
    expect(r.tiers.light.model).toBe('claude-sonnet-5-5')
    expect(r.warnings).toHaveLength(2)
    expect(r.warnings.join(' ')).toMatch(/PAVE_ASSISTANT_TIER=turbo.*ignored/)
  })
})
