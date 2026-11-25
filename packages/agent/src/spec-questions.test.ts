import {
  commands,
  PieceSpecSchema,
  QuickQuestionSchema,
  resolveAnswers,
  SPEC_QUESTION_IDS,
} from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { specQuestions } from './spec-questions'

const ring = PieceSpecSchema.parse({
  kind: 'ring',
  archetype: 'solitaire',
  title: 'Oval solitaire',
  summary: 'An oval on a fine band.',
  metal: { alloy: 'au18k-rose' },
  ring: { size: { system: 'us', value: 7 } },
  stones: [{ role: 'center', cut: 'oval', carat: 1.5 }],
})

describe('the spec questions asked before building from a picture', () => {
  it('asks the five specs, each defaulting to what the picture showed', () => {
    const qs = specQuestions(ring)
    expect(qs.map((q) => q.id)).toEqual(['kind', 'size', 'centre-stone', 'metal', 'budget'])
    for (const q of qs) expect(() => QuickQuestionSchema.parse(q)).not.toThrow()
    // chat.ask lets these five through together, and no other set of more than three.
    expect(qs.map((q) => q.id)).toEqual(SPEC_QUESTION_IDS)
    const ask = commands['chat.ask'].input
    expect(ask.safeParse({ intro: 'Read the picture', questions: qs }).success).toBe(true)
    const others = qs.slice(0, 4).map((q, i) => ({ ...q, id: `q${i}` }))
    expect(ask.safeParse({ intro: 'Hi', questions: others }).success).toBe(false)
    expect(ask.safeParse({ intro: 'Hi', questions: others.slice(0, 3) }).success).toBe(true)
    const picks = Object.fromEntries(qs.map((q) => [q.id, q.defaults]))
    expect(picks).toEqual({
      kind: ['ring'],
      size: ['us-7'],
      'centre-stone': ['oval-1-5'],
      metal: ['au18k-rose'],
      budget: ['none'],
    })
    // One Go answers with the read.
    const answered = resolveAnswers(qs, undefined)
    expect(answered.answers.map((a) => a.chosen[0]!.label)).toEqual([
      'Ring',
      'US 7',
      'Oval 1.5 ct',
      '18k Rose Gold',
      'No set budget',
    ])
  })

  it('asks a length for a necklace and a height for a pendant, and offers no stone when none was seen', () => {
    const pendant = specQuestions(
      PieceSpecSchema.parse({
        ...ring,
        kind: 'pendant',
        archetype: 'medallion',
        ring: undefined,
        stones: [],
        body: { heightMm: 24 },
      }),
    )
    expect(pendant[1]).toMatchObject({ question: 'How tall?', defaults: ['height-25'] })
    expect(pendant[2]!.defaults).toEqual(['none'])
    const necklace = specQuestions(
      PieceSpecSchema.parse({ ...ring, kind: 'necklace', archetype: 'tennis', ring: undefined }),
    )
    expect(necklace[1]).toMatchObject({ question: 'Length?', defaults: ['len-450'] })
  })

  it('picks the budget band the spec’s budget falls in', () => {
    const qs = specQuestions(PieceSpecSchema.parse({ ...ring, budgetUsd: 4000 }))
    expect(qs[4]!.defaults).toEqual(['to-6000'])
  })
})
