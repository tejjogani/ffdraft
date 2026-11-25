import { applyOps, buildDesign, GEM_CUTS, type NodeOf, TEMPLATES } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import type { Subject } from './quick-intents'
import {
  CENTRE_MIN_CT,
  factRows,
  initialForm,
  opsToApply,
  planReplace,
  shownSize,
  sidePartner,
  sizeRange,
  switchUnit,
  toChange,
} from './replace-stone'

const template = (id: string) => buildDesign(TEMPLATES.find((t) => t.id === id)!.spec)
const halo = template('halo')
const centre = halo.nodes.center as NodeOf<'gem'>
const haloField = halo.nodes.halo as NodeOf<'halo'>
const onCentre: Subject & { type: 'stone' } = { type: 'stone', pieceId: 'p', nodeId: 'center' }

describe('the form sends only what was changed', () => {
  it('starts as the stone is: carats for a single stone, millimetres for melee', () => {
    expect(initialForm(centre)).toEqual({
      cut: 'cushion',
      size: null,
      unit: 'ct',
      lw: null,
      stone: centre.stone,
      sides: 'keep',
      pair: 'both',
      fixes: [],
    })
    expect(initialForm(haloField).unit).toBe('mm')
    expect(toChange(initialForm(centre), centre)).toEqual({})
  })

  it('a new cut alone leaves the size to the intent’s rule', () => {
    expect(toChange({ ...initialForm(centre), cut: 'pear' }, centre)).toEqual({ cut: 'pear' })
  })

  it('a typed size goes as carats or millimetres; a field is always in millimetres', () => {
    const form = { ...initialForm(centre), cut: 'pear' as const, size: 1.5 }
    expect(toChange(form, centre)).toEqual({ cut: 'pear', carat: 1.5 })
    expect(toChange({ ...form, unit: 'mm' }, centre)).toEqual({ cut: 'pear', widthMm: 1.5 })
    expect(toChange({ ...initialForm(haloField), size: 1.5, unit: 'ct' }, haloField)).toEqual({
      widthMm: 1.5,
    })
  })

  it('sends a ratio only for a fancy cut of a single stone', () => {
    const form = { ...initialForm(centre), lw: 1.6 }
    expect(toChange({ ...form, cut: 'pear' }, centre)).toEqual({ cut: 'pear', lw: 1.6 })
    expect(toChange({ ...form, cut: 'round' }, centre)).toEqual({ cut: 'round' })
  })
})

describe('the plan is the intent Apply will run', () => {
  it('the Cushion halo’s centre as a pear keeps its 1.20 ct and changes only the stone', () => {
    const plan = planReplace(halo, onCentre, { ...initialForm(centre), cut: 'pear' })
    expect(plan.error).toBeNull()
    expect(plan.outcome!.cut).toBe('pear')
    expect(plan.outcome!.carat).toBeCloseTo(1.2, 2)
    // The ratio follows the new cut's own default.
    expect(plan.outcome!.lw).toBeCloseTo(GEM_CUTS.pear.lw.default, 2)
    expect(plan.result!.notes.join(' ')).toContain('Kept 1.20 ct')
    expect(plan.result!.ops.every((op) => op.t === 'update' && op.id === 'center')).toBe(true)
    // The same plan applied twice is a no-op: Apply cannot double up.
    const after = applyOps(halo, plan.result!.ops).design
    expect(
      planReplace(after, onCentre, { ...initialForm(centre), cut: 'pear' }).result!.ops,
    ).toEqual([])
  })

  it('a halo stone replaces every stone of the halo, snapped to stock melee', () => {
    const plan = planReplace(
      halo,
      { type: 'stone', pieceId: 'p', nodeId: 'halo', instance: 5 },
      { ...initialForm(haloField), size: 1.43 },
    )
    expect(plan.result!.ops).toEqual([{ t: 'update', id: 'halo', patch: { stoneWidth: 1.4 } }])
    expect(plan.outcome!.widthMm).toBe(1.4)
  })

  it('reports what the intent refuses instead of throwing', () => {
    const plan = planReplace(
      halo,
      { type: 'stone', pieceId: 'p', nodeId: 'gone' },
      initialForm(centre),
    )
    expect(plan.error).toBeTruthy()
    expect(plan.result).toBeNull()
  })

  it('shows the outcome until a size is typed, and switching unit keeps the same stone', () => {
    const form = { ...initialForm(centre), cut: 'pear' as const }
    const { outcome } = planReplace(halo, onCentre, form)
    expect(shownSize(form, outcome)).toBeCloseTo(1.2, 2)
    expect(shownSize({ ...form, unit: 'mm' }, outcome)).toBe(Number(outcome!.widthMm.toFixed(2)))
    expect(shownSize(form, outcome)).toBe(1.2)
    expect(switchUnit(form, 'mm', outcome)).toEqual({ ...form, unit: 'mm' })
    const typed = switchUnit({ ...form, size: 1.2 }, 'mm', outcome)
    expect(typed.size).toBeCloseTo(outcome!.widthMm, 2)
  })
})

describe('a side stone and its partner', () => {
  const three = template('three-stone')
  const left = three.nodes.side1 as NodeOf<'gem'>
  const onLeft: Subject & { type: 'stone' } = { type: 'stone', pieceId: 'p', nodeId: 'side1' }
  const pear = { ...initialForm(left), cut: 'pear' as const }

  it('finds the other side stone; the centre and a lone stone have none', () => {
    expect(sidePartner(three, left)?.id).toBe('side2')
    expect(sidePartner(three, three.nodes.center as NodeOf<'gem'>)).toBeNull()
    const uneven = applyOps(three, [{ t: 'update', id: 'side2', patch: { cut: 'oval' } }]).design
    expect(sidePartner(uneven, uneven.nodes.side1 as NodeOf<'gem'>)).toBeNull()
  })

  it('changes both side stones by default, through the intent’s `alike` scope', () => {
    const plan = planReplace(three, onLeft, pear)
    expect(plan.target).toEqual({ nodeId: 'side1', scope: 'alike' })
    expect(plan.partner?.id).toBe('side2')
    const after = applyOps(three, opsToApply(plan, pear)).design
    expect((after.nodes.side1 as NodeOf<'gem'>).cut).toBe('pear')
    expect((after.nodes.side2 as NodeOf<'gem'>).cut).toBe('pear')
    expect((after.nodes.center as NodeOf<'gem'>).cut).toBe(
      (three.nodes.center as NodeOf<'gem'>).cut,
    )
    expect(plan.result!.warnings.some((w) => w.code === 'side.pair')).toBe(false)
  })

  it('“Only this one” changes one stone and keeps the warning, with no duplicate fix', () => {
    const plan = planReplace(three, onLeft, { ...pear, pair: 'one' })
    expect(plan.target).toEqual({ nodeId: 'side1' })
    expect(plan.result!.warnings.map((w) => w.code)).toContain('side.pair')
    // The pair choice is the fix for this one: it is not offered twice.
    expect(plan.fixes.some((f) => f.key.startsWith('side.pair'))).toBe(false)
    const after = applyOps(three, opsToApply(plan, pear)).design
    expect((after.nodes.side2 as NodeOf<'gem'>).cut).toBe(left.cut)
  })

  it('a warning’s ready fix rides in the same change when ticked', () => {
    // Three equal stones: `alike` would take the centre along, so no pair choice; the
    // intent's own "make the same change" fix is offered instead.
    const equal = applyOps(three, [
      { t: 'update', id: 'center', patch: { cut: left.cut, width: left.width, stone: left.stone } },
    ]).design
    const plan = planReplace(equal, onLeft, pear)
    expect(plan.partner).toBeNull()
    const fix = plan.fixes.find((f) => f.key.startsWith('side.pair'))!
    expect(fix.label).toMatch(/Make the same change/)
    expect(opsToApply(plan, pear)).toEqual(plan.result!.ops)
    const ops = opsToApply(plan, { ...pear, fixes: [fix.key] })
    const after = applyOps(equal, ops).design
    expect((after.nodes.side2 as NodeOf<'gem'>).cut).toBe('pear')
    expect((after.nodes.center as NodeOf<'gem'>).cut).toBe(left.cut)
  })
})

describe('the size field’s range', () => {
  const solitaire = template('solitaire')
  const gem = solitaire.nodes.center as NodeOf<'gem'>

  it('a centre stone stops at the smallest stock weight, in carats and in millimetres', () => {
    const form = { ...initialForm(gem), cut: 'princess' as const }
    expect(sizeRange(gem, form, 'center').min).toBe(CENTRE_MIN_CT)
    const mm = sizeRange(gem, { ...form, unit: 'mm' }, 'center').min
    // A 0.10 ct princess is about 2.5 mm across: far from the 0.6 mm a melee accent allows.
    expect(mm).toBeGreaterThan(2)
    expect(mm).toBeLessThan(3.5)
    const plan = planReplace(
      solitaire,
      { type: 'stone', pieceId: 'p', nodeId: 'center' },
      {
        ...form,
        unit: 'mm',
        size: mm,
      },
    )
    expect(plan.outcome!.carat).toBeGreaterThanOrEqual(CENTRE_MIN_CT - 0.001)
  })

  it('a side stone or accent keeps the stone field’s own minimum', () => {
    expect(sizeRange(gem, { ...initialForm(gem), unit: 'mm' }, 'side').min).toBe(0.6)
    expect(sizeRange(gem, initialForm(gem)).min).toBe(0.01)
    expect(sizeRange(haloField, initialForm(haloField)).min).toBe(0.8)
  })
})

describe('the before / after facts', () => {
  it('lists weight, carats and count with signed changes, and none when equal', () => {
    const rows = factRows(
      { metalMassG: 4.214, caratTotal: 1.62, stoneCount: 25 },
      { metalMassG: 4.05, caratTotal: 1.62, stoneCount: 27 },
    )
    expect(rows).toEqual([
      { label: 'Metal', before: '4.21 g', after: '4.05 g', delta: '−0.16 g' },
      { label: 'Carats', before: '1.62 ct', after: '1.62 ct', delta: null },
      { label: 'Stones', before: '25', after: '27', delta: '+2' },
    ])
  })
})
