import type { Evaluation, StoneInstance } from '@pave/kernel'
import {
  applyOps,
  buildDesign,
  type Design,
  gemCarat,
  resolveDesign,
  stoneDims,
  TEMPLATES,
} from '@pave/schema'
import { describe, expect, it } from 'vitest'
import {
  askAi,
  assistantUnavailable,
  CARAT_STEPS,
  fmtCarat,
  metalOps,
  nextStep,
  quickIntents,
  type Subject,
  subjectFor,
  VIEW_ONLY,
} from './quick-intents'

const template = (id: string) => buildDesign(TEMPLATES.find((t) => t.id === id)!.spec)
const byId = (intents: ReturnType<typeof quickIntents>, id: string) =>
  intents.find((i) => i.id === id)

/** Just enough of an evaluation for picking: the stones of a node, each at a known centre. */
function stonesOf(nodeId: string, count: number): Evaluation {
  const stones = Array.from(
    { length: count },
    (_, i) =>
      ({
        id: `${nodeId}:${i}`,
        nodeId,
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, i, 10, 2, 1],
      }) as StoneInstance,
  )
  return { stones } as Evaluation
}

const caratOf = (design: Design, id: string) => {
  const g = resolveDesign(design).nodes[id] as Parameters<typeof stoneDims>[0] & {
    cut: Parameters<typeof gemCarat>[0]
    stone: Parameters<typeof gemCarat>[2]
  }
  return gemCarat(g.cut, stoneDims(g), g.stone)
}

describe('what a click is about', () => {
  const halo = template('halo')

  it('a stone of a halo addresses the whole halo, remembering which stone and where', () => {
    const s = subjectFor('p1', halo, { nodeId: 'halo', stoneId: 'halo:3' }, stonesOf('halo', 24))
    expect(s).toEqual({
      type: 'stone',
      pieceId: 'p1',
      nodeId: 'halo',
      instance: 3,
      point: [3, 10, 2],
      count: 24,
    })
  })

  it('the centre stone is that stone, with no instance', () => {
    const s = subjectFor(
      'p1',
      halo,
      { nodeId: 'center', stoneId: 'center:0' },
      stonesOf('center', 1),
    )
    expect(s).toMatchObject({ type: 'stone', nodeId: 'center', count: 1 })
    expect(s).not.toHaveProperty('instance')
  })

  it('a stone a chain carries is a stone, though no stone node holds it', () => {
    const tennis = template('tennis')
    const s = subjectFor(
      'p1',
      tennis,
      { nodeId: 'chain', stoneId: 'chain:0' },
      stonesOf('chain', 40),
    )
    expect(s).toMatchObject({ type: 'stone', nodeId: 'chain', instance: 0, count: 40 })
    // The chain's tree row (no stone clicked) is still the part.
    expect(subjectFor('p1', tennis, { nodeId: 'chain' })).toEqual({
      type: 'part',
      pieceId: 'p1',
      nodeId: 'chain',
    })
  })

  it('carries the stone’s role, so a centre stone is not sized like melee', () => {
    const ev = stonesOf('center', 1)
    ev.stones[0]!.role = 'center'
    expect(subjectFor('p1', halo, { nodeId: 'center', stoneId: 'center:0' }, ev)).toMatchObject({
      role: 'center',
    })
  })

  it('metal is a part; empty space or a node that is gone is the piece', () => {
    expect(subjectFor('p1', halo, { nodeId: 'band' })).toEqual({
      type: 'part',
      pieceId: 'p1',
      nodeId: 'band',
    })
    expect(subjectFor('p1', halo, null)).toEqual({ type: 'piece', pieceId: 'p1' })
    expect(subjectFor('p1', halo, { nodeId: 'deleted' })).toEqual({ type: 'piece', pieceId: 'p1' })
  })
})

describe('stock steps', () => {
  it('steps to the next stock weight, treating a near miss as on the step', () => {
    expect(nextStep(CARAT_STEPS, 1.2024, 'up')).toBe(1.25)
    expect(nextStep(CARAT_STEPS, 1.2024, 'down')).toBe(1.1)
    expect(nextStep(CARAT_STEPS, 1.497, 'up')).toBe(1.75)
    expect(nextStep(CARAT_STEPS, 1.497, 'down')).toBe(1.25)
  })

  it('has nowhere to go past either end', () => {
    expect(nextStep(CARAT_STEPS, 10, 'up')).toBeNull()
    expect(nextStep(CARAT_STEPS, 0.1, 'down')).toBeNull()
  })
})

describe('quick intents for a stone', () => {
  const halo = template('halo')
  const centre: Subject = { type: 'stone', pieceId: 'p1', nodeId: 'center' }

  it('offers Replace stone, then bigger and smaller as ready, undoable edits', () => {
    const intents = quickIntents(centre, halo)
    expect(intents.map((i) => i.id)).toEqual(['replaceStone', 'bigger', 'smaller'])
    expect(byId(intents, 'replaceStone')).toMatchObject({ label: 'Replace stone…' })
    const bigger = byId(intents, 'bigger')!
    // Two decimals, as the inspector shows carats.
    expect(bigger.hint).toBe('1.20 → 1.25 ct')
    const after = applyOps(halo, bigger.edit!.ops).design
    expect(caratOf(after, 'center')).toBeCloseTo(1.25, 2)
    // Only stone fields change: the mount follows by rule.
    expect(bigger.edit!.ops.every((op) => op.t === 'update' && op.id === 'center')).toBe(true)
    expect(
      caratOf(applyOps(halo, byId(intents, 'smaller')!.edit!.ops).design, 'center'),
    ).toBeCloseTo(1.1, 2)
  })

  it('a halo stone means every stone of the halo, stepped in stock melee sizes', () => {
    const subject: Subject = {
      type: 'stone',
      pieceId: 'p1',
      nodeId: 'halo',
      instance: 3,
      count: 24,
    }
    const intents = quickIntents(subject, halo)
    expect(byId(intents, 'replaceStone')).toMatchObject({
      label: 'Replace stones…',
      hint: 'All 24 stones in this halo',
    })
    // The halo template's melee are 1.1 mm (a 1.6× face); the next stock size is 1.2.
    expect(byId(intents, 'bigger')).toMatchObject({ hint: '1.1 → 1.2 mm' })
    expect(byId(intents, 'bigger')!.edit!.ops).toEqual([
      { t: 'update', id: 'halo', patch: { stoneWidth: 1.2 } },
    ])
  })

  it('stops at the field’s largest size with the reason', () => {
    const big = applyOps(template('halo'), [
      { t: 'update', id: 'halo', patch: { stoneWidth: 3.5 } },
    ]).design
    const bigger = byId(
      quickIntents({ type: 'stone', pieceId: 'p1', nodeId: 'halo' }, big),
      'bigger',
    )
    expect(bigger).toMatchObject({ disabled: 'Already the largest stock size' })
    expect(bigger!.edit).toBeUndefined()
  })

  it('keeps every row for a viewer, disabled with the reason and no edit', () => {
    const intents = quickIntents(centre, halo, { readOnly: true })
    expect(intents).toHaveLength(3)
    for (const i of intents) {
      expect(i.disabled).toBe(VIEW_ONLY)
      expect(i.edit).toBeUndefined()
    }
  })
})

describe('quick intents for a stone on a chain', () => {
  it('lists Replace stone disabled with the reason, and the chain’s metal', () => {
    const tennis = template('tennis')
    const intents = quickIntents({ type: 'stone', pieceId: 'p1', nodeId: 'chain' }, tennis)
    expect(intents.map((i) => i.id)).toEqual(['replaceStone', 'changeMetal'])
    expect(intents[0]).toMatchObject({ label: 'Replace stone…' })
    expect(intents[0]!.disabled).toMatch(/can’t be replaced here yet/)
    expect(intents[0]!.edit).toBeUndefined()
    expect(intents[1]!.metal!.nodeIds).toEqual(['chain'])
    expect(
      askAi({ type: 'stone', pieceId: 'p1', nodeId: 'chain' }, { assistant: true }).label,
    ).toBe('Ask AI about this stone…')
  })
})

describe('carats as the inspector shows them', () => {
  it('two decimals, three below a tenth of a carat', () => {
    expect(fmtCarat(1.2)).toBe('1.20')
    expect(fmtCarat(0.1)).toBe('0.10')
    expect(fmtCarat(0.0123)).toBe('0.012')
  })
})

describe('quick intents for a part and for the piece', () => {
  it('a band offers its metal, and no "bigger" (a ring size is not a size step)', () => {
    const intents = quickIntents({ type: 'part', pieceId: 'p1', nodeId: 'band' }, template('halo'))
    expect(intents.map((i) => i.id)).toEqual(['changeMetal'])
    expect(intents[0]!.metal).toEqual({ nodeIds: ['band'], current: 'au18k-white' })
  })

  it('a lettered pendant grows and shrinks by its height', () => {
    const d = template('name-pendant')
    const intents = quickIntents({ type: 'part', pieceId: 'p1', nodeId: 'body' }, d)
    expect(intents.map((i) => i.id)).toEqual(['changeMetal', 'bigger', 'smaller'])
    expect(byId(intents, 'bigger')!.edit!.ops).toEqual([
      { t: 'update', id: 'body', patch: { height: 9.9 } },
    ])
    expect(byId(intents, 'smaller')!.edit!.ops).toEqual([
      { t: 'update', id: 'body', patch: { height: 8.2 } },
    ])
  })

  it('empty space offers the metal of every metal feature at once', () => {
    const d = template('halo')
    const [metal] = quickIntents({ type: 'piece', pieceId: 'p1' }, d)
    expect(metal).toMatchObject({ id: 'changeMetal', label: 'Change metal everywhere' })
    expect(metal!.metal!.nodeIds.sort()).toEqual(['band', 'halo', 'head'])
    expect(metalOps(d, metal!.metal!.nodeIds, 'pt950')).toHaveLength(3)
    expect(metalOps(d, metal!.metal!.nodeIds, metal!.metal!.current!)).toEqual([])
  })
})

describe('Ask AI', () => {
  it('names what it is about and stays disabled with a short reason until the assistant ships', () => {
    const stone = askAi({ type: 'stone', pieceId: 'p', nodeId: 'center' }, { assistant: true })
    expect(stone.label).toBe('Ask AI about this stone…')
    expect(stone.disabled).toBeTruthy()
    expect(askAi({ type: 'part', pieceId: 'p', nodeId: 'band' }, { assistant: false }).label).toBe(
      'Ask AI about this part…',
    )
    expect(askAi({ type: 'piece', pieceId: 'p' }, { assistant: false }).label).toBe(
      'Ask AI about this piece…',
    )
  })

  it('gives the palette the same reason as the menu row', () => {
    const subject: Subject = { type: 'piece', pieceId: 'p' }
    for (const assistant of [true, false])
      expect(assistantUnavailable({ assistant })).toBe(askAi(subject, { assistant }).disabled)
  })
})
