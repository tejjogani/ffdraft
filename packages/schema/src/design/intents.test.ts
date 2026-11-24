import { describe, expect, it } from 'vitest'
import { GEM_CUT_IDS, type GemCutId, gemCarat } from '../domain/gems'
import { buildDesign, TEMPLATES } from '../recipes/index'
import { applyOps, type Design } from './design'
import { IntentError, replaceStone } from './intents'
import { resolveDesign, stoneDims } from './mount'
import type { NodeOf } from './nodes'

const template = (id: string) => buildDesign(TEMPLATES.find((t) => t.id === id)!.spec)

/** Every template with a centre stone, and that stone's node id (plan §8). */
const CENTRE: Record<string, string> = {
  solitaire: 'center',
  'oval-pave': 'center',
  halo: 'center',
  'three-stone': 'center',
  'pendant-solitaire': 'center',
  studs: 'stone',
}
const CARATS = [0.5, 1.5, 4]
const STONE_FIELDS = new Set(['cut', 'width', 'lw', 'stone', 'quality', 'sourcing'])

describe('replaceStone: every centre-stone template × every cut × three sizes', () => {
  for (const [tid, gemId] of Object.entries(CENTRE))
    it(`${tid}: writes only stone fields, undoes exactly, and is idempotent`, () => {
      const base = template(tid)
      for (const cut of GEM_CUT_IDS as GemCutId[])
        for (const carat of CARATS) {
          const label = `${tid} ${cut} ${carat} ct`
          const r = replaceStone(base, { nodeId: gemId }, { cut, carat })
          const { design: after, inverse } = applyOps(base, r.ops)
          // Only the centre stone's own fields are written.
          for (const op of r.ops) {
            expect(op.t, label).toBe('update')
            if (op.t !== 'update') continue
            expect(op.id, label).toBe(gemId)
            for (const k of Object.keys(op.patch))
              expect(STONE_FIELDS.has(k), `${label}: ${k}`).toBe(true)
          }
          // Everything else is deep-equal: band, metals, other stones, order.
          for (const id of base.order)
            if (id !== gemId) expect(after.nodes[id], `${label}: ${id}`).toEqual(base.nodes[id])
          expect(after.order).toEqual(base.order)
          const g = resolveDesign(after).nodes[gemId] as NodeOf<'gem'>
          expect(g.cut).toBe(cut)
          expect(gemCarat(cut, stoneDims(g), g.stone)).toBeCloseTo(carat, 1)
          // Undo restores the exact document; the same change again does nothing.
          expect(applyOps(after, inverse).design, label).toEqual(base)
          expect(replaceStone(after, { nodeId: gemId }, { cut, carat }).ops, label).toEqual([])
          // A → B → A returns the original resolved design.
          const back = replaceStone(
            after,
            { nodeId: gemId },
            {
              cut: (base.nodes[gemId] as NodeOf<'gem'>).cut,
              widthMm: (base.nodes[gemId] as NodeOf<'gem'>).width,
            },
          )
          expect(resolveDesign(applyOps(after, back.ops).design), label).toEqual(
            resolveDesign(base),
          )
        }
    })
})

describe('replaceStone: what is kept', () => {
  it('a new cut with no size keeps a single stone’s carat, and says so', () => {
    const r = replaceStone(template('solitaire'), { nodeId: 'center' }, { cut: 'oval' })
    expect(r.notes[0]).toMatch(/^Kept 1\.00 ct: 6\.44 mm round brilliant is now .* oval$/)
    expect(r.label).toBe('Replace “Centre stone”: 1.00 ct oval')
  })

  it('a material change keeps the millimetres, so the mount does not move', () => {
    const base = template('solitaire')
    const r = replaceStone(base, { nodeId: 'center' }, { stone: 'sapphire-blue' })
    expect(r.ops).toEqual([{ t: 'update', id: 'center', patch: { stone: 'sapphire-blue' } }])
    expect(r.notes).toEqual(['6.44 mm round brilliant blue sapphire weighs 1.14 ct'])
  })

  it('a hand override survives with a warning and a ready reset', () => {
    const pinned = applyOps(template('solitaire'), [
      { t: 'update', id: 'head', patch: { prongCount: 4 } },
    ]).design
    const r = replaceStone(pinned, { nodeId: 'center' }, { cut: 'trillion' })
    expect(r.ops.every((op) => op.t === 'update' && op.id === 'center')).toBe(true)
    const w = r.warnings.find((x) => x.code === 'pin.offRule')!
    expect(w.nodeId).toBe('head')
    expect(w.suggestion?.ops).toEqual([{ t: 'update', id: 'head', patch: { prongCount: null } }])
    const after = applyOps(pinned, r.ops).design
    expect((resolveDesign(after).nodes.head as NodeOf<'setting'>).prongCount).toBe(4)
    // Without the pin the claws follow the trillion.
    const free = replaceStone(template('solitaire'), { nodeId: 'center' }, { cut: 'trillion' })
    expect(free.warnings).toEqual([])
    expect(free.notes).toContain('Claws 4 → 3')
  })

  it('three-stone: side stones keep their size by default, or resize in proportion', () => {
    const base = template('three-stone')
    const keep = replaceStone(base, { nodeId: 'center' }, { cut: 'round', carat: 4 })
    expect(keep.ops.map((op) => (op as { id: string }).id)).toEqual(['center'])
    const warning = keep.warnings.find((w) => w.code === 'side.proportion')!
    expect(warning.suggestion?.ops.map((op) => (op as { id: string }).id)).toEqual([
      'side1',
      'side2',
    ])
    expect(keep.notes.some((n) => /Side stone R moves .* around the band/.test(n))).toBe(true)
    const prop = replaceStone(
      base,
      { nodeId: 'center' },
      { cut: 'round', carat: 4, sides: 'proportion' },
    )
    expect(prop.ops).toHaveLength(3)
    expect(prop.warnings.find((w) => w.code === 'side.proportion')).toBeUndefined()
  })

  it('scope alike changes both side stones; a field snaps to stock melee', () => {
    const sides = replaceStone(
      template('three-stone'),
      { nodeId: 'side1', scope: 'alike' },
      {
        stone: 'ruby',
      },
    )
    expect(sides.ops.map((op) => (op as { id: string }).id)).toEqual(['side1', 'side2'])
    const halo = replaceStone(template('halo'), { nodeId: 'halo' }, { widthMm: 1.47 })
    expect(halo.ops).toEqual([{ t: 'update', id: 'halo', patch: { stoneWidth: 1.5 } }])
  })

  it('a graduated row keeps its graduation; a pavé keeps its spread of sizes', () => {
    const graduated = applyOps(template('eternity'), [
      { t: 'update', id: 'row', patch: { coverage: 180, graduateTo: 1.5 } },
    ]).design
    const r = replaceStone(graduated, { nodeId: 'row' }, { widthMm: 2.5 })
    expect(r.ops).toEqual([{ t: 'update', id: 'row', patch: { stoneWidth: 2.5, graduateTo: 1.9 } }])
    const ice = replaceStone(template('iced-trophy'), { nodeId: 'ice' }, { widthMm: 1.8 })
    expect(ice.ops[0]).toMatchObject({ patch: { sizeMax: 1.8 } })
  })

  it('one stone inside a field cannot change alone: no ops, and the whole field offered', () => {
    const r = replaceStone(template('halo'), { nodeId: 'row', instance: 3 }, { widthMm: 1.5 })
    expect(r.ops).toEqual([])
    expect(r.warnings[0]).toMatchObject({ code: 'instance.fixed', nodeId: 'row' })
    expect(r.warnings[0]!.suggestion?.ops).toEqual([
      { t: 'update', id: 'row', patch: { stoneWidth: 1.5 } },
    ])
  })

  it('rejects a missing node or one with no stones', () => {
    expect(() => replaceStone(template('solitaire'), { nodeId: 'nope' }, { cut: 'oval' })).toThrow(
      IntentError,
    )
    expect(() => replaceStone(template('solitaire'), { nodeId: 'band' }, { cut: 'oval' })).toThrow(
      /carries no stones/,
    )
    expect(() =>
      replaceStone(template('solitaire'), { nodeId: 'center' }, { carat: 1, widthMm: 6 }),
    ).toThrow(IntentError)
  })
})

describe('replaceStone: sourcing', () => {
  const linked = (): Design =>
    applyOps(template('solitaire'), [
      {
        t: 'update',
        id: 'center',
        patch: {
          sourcing: {
            provider: 'diaex',
            sku: 'D123',
            priceUsd: 5400,
            measured: { length: 6.45, width: 6.41, depth: 3.95 },
          },
        },
      },
    ]).design

  it('a cut change clears the link in the same change and names it; undo restores it', () => {
    const base = linked()
    const r = replaceStone(base, { nodeId: 'center' }, { cut: 'cushion' })
    expect(r.ops[0]).toMatchObject({ patch: { cut: 'cushion', sourcing: null } })
    expect(r.warnings[0]).toMatchObject({ code: 'sourcing.unlinked' })
    expect(r.warnings[0]!.message).toMatch(/diaex D123 \(\$5400\)/)
    const { design, inverse } = applyOps(base, r.ops)
    expect(applyOps(design, inverse).design).toEqual(base)
  })

  it('a grade change keeps the link and warns', () => {
    const r = replaceStone(linked(), { nodeId: 'center' }, { quality: { origin: 'lab' } })
    expect(r.ops).toEqual([{ t: 'update', id: 'center', patch: { quality: { origin: 'lab' } } }])
    expect(r.warnings.map((w) => w.code)).toEqual(['sourcing.grade'])
  })

  it('fit sets the link with its measured size and the nominal fields to match', () => {
    const fit = { provider: 'diaex', sku: 'X9', measured: { length: 9.1, width: 6.5, depth: 4 } }
    const r = replaceStone(template('solitaire'), { nodeId: 'center' }, { cut: 'oval', fit })
    expect(r.ops).toEqual([
      { t: 'update', id: 'center', patch: { sourcing: fit, cut: 'oval', width: 6.5, lw: 1.4 } },
    ])
  })
})

describe('replaceStone: round-2 regressions', () => {
  it('a colour-only change keeps a lab stone lab (no origin default written)', () => {
    const lab = applyOps(template('solitaire'), [
      {
        t: 'update',
        id: 'center',
        patch: {
          stone: 'diamond-lab',
          quality: { origin: 'lab', colors: ['D'], certified: true },
        },
      },
    ]).design
    const r = replaceStone(lab, { nodeId: 'center' }, { quality: { colors: ['E', 'F'] } })
    expect(r.ops).toEqual([
      { t: 'update', id: 'center', patch: { quality: { colors: ['E', 'F'] } } },
    ])
    const after = applyOps(lab, r.ops).design.nodes.center as NodeOf<'gem'>
    expect(after.quality).toEqual({ origin: 'lab', colors: ['E', 'F'], certified: true })
    // The same grade again changes nothing.
    expect(replaceStone(applyOps(lab, r.ops).design, { nodeId: 'center' }, { quality: { colors: ['E', 'F'] } }).ops).toEqual([])
  })

  it('fitting a measured stone does not call its own ratio a hand pin, now or on a repeat', () => {
    const fit = { provider: 'diaex', sku: 'OV1', measured: { length: 9.1, width: 6.6, depth: 4 } }
    const r = replaceStone(template('solitaire'), { nodeId: 'center' }, { cut: 'oval', fit })
    expect(r.ops[0]).toMatchObject({ patch: { lw: 1.379 } })
    expect(r.warnings).toEqual([])
    const again = replaceStone(
      applyOps(template('solitaire'), r.ops).design,
      { nodeId: 'center' },
      { cut: 'oval', fit },
    )
    expect(again.ops).toEqual([])
    expect(again.warnings).toEqual([])
  })

  it('one side stone changed alone warns that the pair no longer matches, with the twin edit', () => {
    const base = template('three-stone')
    const r = replaceStone(base, { nodeId: 'side1' }, { widthMm: 6 })
    const pair = r.warnings.find((w) => w.code === 'side.pair')!
    expect(pair.suggestion?.ops).toEqual([{ t: 'update', id: 'side2', patch: { width: 6 } }])
    // 6 mm sides on a 5.69 mm centre: out of proportion, and larger than the centre.
    const prop = r.warnings.find((w) => w.code === 'side.proportion')!
    expect(prop.message).toMatch(/larger than the centre stone/)
    // Both together: no pair warning.
    const both = replaceStone(base, { nodeId: 'side1', scope: 'alike' }, { stone: 'ruby' })
    expect(both.warnings.find((w) => w.code === 'side.pair')).toBeUndefined()
  })
})
