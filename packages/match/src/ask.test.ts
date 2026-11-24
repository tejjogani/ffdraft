import { describe, expect, it } from 'vitest'
import { rankQuestions } from './ask'

describe('rankQuestions', () => {
  it('ranks by consequence, caps at three and never asks what changes nothing', () => {
    const q = rankQuestions([
      {
        field: 'head.prongCount',
        options: [
          { id: '4', massG: 5, carat: 1, xorFraction: 0 },
          { id: '6', massG: 5.2, carat: 1, xorFraction: 0.02 },
        ],
      },
      {
        field: 'center.cut',
        options: [
          { id: 'round', massG: 5, carat: 1, xorFraction: 0 },
          { id: 'oval', massG: 5, carat: 1.4, xorFraction: 0.1 },
        ],
      },
      {
        field: 'band.profile',
        options: [
          { id: 'court', massG: 5, carat: 1, xorFraction: 0 },
          { id: 'flat', massG: 5.01, carat: 1, xorFraction: 0.001 },
        ],
      },
      {
        field: 'a',
        options: [
          { id: 'x', massG: 5, carat: 1, xorFraction: 0 },
          { id: 'y', massG: 6, carat: 1, xorFraction: 0 },
        ],
      },
      {
        field: 'b',
        options: [
          { id: 'x', massG: 5, carat: 1, xorFraction: 0 },
          { id: 'y', massG: 7, carat: 1, xorFraction: 0 },
        ],
      },
    ])
    expect(q.map((x) => x.field)).toEqual(['center.cut', 'b', 'a'])
    expect(q[0]!.options).toEqual(['round', 'oval'])
    expect(q[0]!.why).toMatch(/ct/)
    expect(
      rankQuestions([
        {
          field: 'band.profile',
          options: [
            { id: 'court', massG: 5, carat: 1, xorFraction: 0 },
            { id: 'flat', massG: 5.01, carat: 1, xorFraction: 0.001 },
          ],
        },
      ]),
    ).toEqual([])
  })
})
