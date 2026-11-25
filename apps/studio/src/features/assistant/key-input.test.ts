import { describe, expect, it } from 'vitest'
import { keyProblem, saveAfterCheck } from './key-input'

describe('a pasted key', () => {
  it('says plainly when it is too short, instead of a validation error', () => {
    expect(keyProblem('sk-ant-short')).toMatch(/too short to be a Claude key/)
    expect(keyProblem('sk-ant-short')).not.toMatch(/✖|>=|apiKey/)
    expect(keyProblem('sk-ant-api03-abcd efgh-ijklmnopqrstuvwxyz')).toMatch(/spaces/)
    expect(keyProblem('  sk-ant-api03-abcdefghijklmnopqrstuvwxyz  ')).toBeNull()
    expect(keyProblem('')).toBeNull()
  })

  it('is not saved when Claude refused it; saved but marked unchecked when Claude could not be asked', () => {
    const base = { message: '', models: [] }
    expect(saveAfterCheck({ ...base, ok: true, code: null })).toBe('save')
    expect(saveAfterCheck({ ...base, ok: false, code: 'invalid' })).toBe('refuse')
    expect(saveAfterCheck({ ...base, ok: false, code: 'forbidden' })).toBe('refuse')
    expect(saveAfterCheck({ ...base, ok: false, code: 'unreachable' })).toBe('save-unchecked')
  })
})
