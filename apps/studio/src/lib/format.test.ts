import { describe, expect, it } from 'vitest'
import { modelName, unitFor } from './format'

describe('labels people read', () => {
  it('counts units in the plural', () => {
    expect(unitFor(33, 'second')).toBe('seconds')
    expect(unitFor(96.3, 'second')).toBe('seconds')
    expect(unitFor(1, 'second')).toBe('second')
    expect(unitFor(1200, 'tokens')).toBe('tokens')
  })

  it('names Claude models as people know them', () => {
    expect(modelName('claude-opus-5-5')).toBe('Claude Opus 5.5')
    expect(modelName('gemini-x')).toBe('gemini-x')
  })
})
