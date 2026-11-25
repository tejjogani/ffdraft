import { cinemaQuestions } from '@pave/render'
import { describe, expect, it } from 'vitest'
import { initialPicks, toggle } from './QuestionsCard'

const [purpose, aspects, motion] = cinemaQuestions({ halo: false, pave: false, stones: 1 })

describe('quick questions', () => {
  it('start with the defaults picked, so Go alone answers', () => {
    expect(initialPicks([purpose!, aspects!, motion!])).toEqual({
      purpose: ['product'],
      aspects: ['1x1'],
      motion: ['turntable'],
    })
  })

  it('a single choice takes the new pick; a multiple choice toggles but never empties', () => {
    expect(toggle(purpose!, ['product'], 'social')).toEqual(['social'])
    expect(toggle(aspects!, ['1x1'], '4x5')).toEqual(['1x1', '4x5'])
    expect(toggle(aspects!, ['1x1', '4x5'], '1x1')).toEqual(['4x5'])
    expect(toggle(aspects!, ['4x5'], '4x5')).toEqual(['4x5'])
  })

  it('"Stills only" clears the animations, and an animation clears "Stills only"', () => {
    expect(toggle(motion!, ['turntable', 'light-sweep'], 'none')).toEqual(['none'])
    expect(toggle(motion!, ['none'], 'macro-sweep')).toEqual(['macro-sweep'])
  })
})
