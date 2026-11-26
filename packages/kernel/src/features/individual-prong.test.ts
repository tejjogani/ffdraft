import {
  applyOps,
  buildDesign,
  type Design,
  labelForOps,
  parseDesignDocument,
  TEMPLATES,
} from '@pave/schema'
import { afterAll, describe, expect, it } from 'vitest'
import { createKernel } from '../kernel'

const kernel = createKernel()
afterAll(() => kernel.dispose())

const solitaire = () => buildDesign(TEMPLATES.find((t) => t.id === 'solitaire')!.spec)
const editHead = (design: Design, patch: Record<string, unknown>) =>
  applyOps(design, [{ t: 'update', id: 'head', patch }])

describe('individual prong tip offsets', () => {
  it('moves one claw mesh and leaves the other claws, rails and stone as built', async () => {
    const base = editHead(solitaire(), { style: 'basket' }).design
    const { design, inverse } = editHead(base, { prongTipOffsetsMm: { '1': 0.3 } })
    const compare = async (piece: Design) => {
      const scene = await kernel.scene(piece)
      return {
        head: scene.nodes.get('head')!.bodies.map(({ solid }) => solid.triangles()),
        stones: scene.evaluation.stones,
        tips: scene.evaluation.prongTips!,
        diagnostics: scene.evaluation.diagnostics,
      }
    }
    const before = await compare(base)
    const after = await compare(parseDesignDocument(JSON.parse(JSON.stringify(design))))
    expect(before.head.length).toBeGreaterThan(4)
    expect(after.head[0]!.positions).not.toEqual(before.head[0]!.positions)
    expect(after.head.slice(1)).toEqual(before.head.slice(1))
    expect(after.stones).toEqual(before.stones)
    const tip = before.tips.find(({ number }) => number === '1')!
    const moved = after.tips.find(({ number }) => number === '1')!
    expect(moved.at[0] - tip.at[0]).toBeCloseTo(0.3 * Math.SQRT1_2, 6)
    expect(moved.at[1] - tip.at[1]).toBeCloseTo(0.3 * Math.SQRT1_2, 6)
    expect(moved.at[2]).toBeCloseTo(tip.at[2], 6)
    expect(after.tips.filter(({ number }) => number !== '1')).toEqual(
      before.tips.filter(({ number }) => number !== '1'),
    )
    expect(after.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'prong.tipContact',
        nodeId: 'head',
      }),
    )
    const undone = await compare(applyOps(design, inverse).design)
    expect(undone.head).toEqual(before.head)
  })

  it('validates the chosen prong and merges independent offsets', () => {
    const base = solitaire()
    expect(() => editHead(base, { prongTipOffsetsMm: { '5': 0.2 } })).toThrow(/prong 5/i)
    expect(() => editHead(base, { prongTipOffsetsMm: { '1': 0.51 } })).toThrow()
    expect(() => editHead(base, { prongTipOffsetsMm: { '01': 0.2 } })).toThrow()
    expect(() => editHead(base, { style: 'bezel', prongTipOffsetsMm: { '1': 0.2 } })).toThrow()
    const first = editHead(base, { prongTipOffsetsMm: { '1': -0.3 } }).design
    const second = editHead(first, { prongTipOffsetsMm: { '2': 0.22 } }).design
    expect(second.nodes.head).toMatchObject({ prongTipOffsetsMm: { '1': -0.3, '2': 0.22 } })
    expect(
      labelForOps(
        [{ t: 'update', id: 'head', patch: { prongTipOffsetsMm: { '2': 0.22 } } }],
        first,
      ),
    ).toMatch(/Prong 2 tip.*0\.22 mm/)
    const reset = editHead(second, { prongTipOffsetsMm: { '1': null } }).design
    expect(reset.nodes.head).toMatchObject({ prongTipOffsetsMm: { '2': 0.22 } })
  })

  it('clears offsets when the effective layout changes and restores them on undo', () => {
    const base = editHead(solitaire(), { prongTipOffsetsMm: { '1': -0.3, '2': 0.22 } }).design
    const onlyRail = editHead(base, { style: 'basket', rails: 2 }).design
    expect(onlyRail.nodes.head).toMatchObject({ prongTipOffsetsMm: { '1': -0.3, '2': 0.22 } })
    const bezel = editHead(base, { style: 'bezel' })
    expect(bezel.design.nodes.head).not.toHaveProperty('prongTipOffsetsMm')
    expect(applyOps(bezel.design, bezel.inverse).design).toEqual(base)
    const reindexed = applyOps(base, [{ t: 'update', id: 'center', patch: { width: 8 } }])
    expect(reindexed.design.nodes.head).not.toHaveProperty('prongTipOffsetsMm')
    expect(applyOps(reindexed.design, reindexed.inverse).design).toEqual(base)
    const resetAndMove = editHead(base, { prongCount: 6, prongTipOffsetsMm: { '5': 0.25 } })
    expect(resetAndMove.design.nodes.head).toMatchObject({ prongTipOffsetsMm: { '5': 0.25 } })
    expect(resetAndMove.design.nodes.head).not.toHaveProperty('prongTipOffsetsMm.1')
    expect(applyOps(resetAndMove.design, resetAndMove.inverse).design).toEqual(base)
  })
})
