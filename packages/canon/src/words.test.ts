import { describe, expect, it } from 'vitest'
import { matchStyles } from './engine'
import { styleFacts } from './facts'
import { canonFor } from './query'
import { hasPhrase, tokens } from './words'

describe('brief words', () => {
  it('match whole words and phrases, accents and apostrophes aside', () => {
    expect(tokens("Men's Art Déco")).toEqual(['mens', 'art', 'deco'])
    expect(hasPhrase(['art déco'], 'art deco')).toBe(true)
    expect(hasPhrase(['priced to sell'], 'iced')).toBe(false)
  })

  const NEGATIVE = ["women's", 'engagement', 'statement', 'fine jewelry', 'signature', 'decorative']
  for (const word of NEGATIVE)
    it(`read "${word}" as no men's flag and no style guide`, () => {
      expect(styleFacts([word]).mens).toBe(0)
      expect(matchStyles([word])).toEqual([])
      const s = canonFor({ archetype: 'band', styles: [word] })
      expect(s.rules.map((r) => r.rule.id)).not.toContain('band.mens.width')
    })

  it('still name the guides by their real words, best match first', () => {
    expect(matchStyles(['art déco']).map((g) => g.id)).toEqual(['artDeco'])
    expect(matchStyles(['divine', 'rockstar', 'priced'])).toEqual([])
    expect(matchStyles(['iced out', 'vintage'])[0]!.id).toBe('icedOut')
  })
})
