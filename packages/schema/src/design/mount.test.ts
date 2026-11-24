import { describe, expect, it } from 'vitest'
import { GEM_CUT_IDS, GEM_CUTS, gemDims } from '../domain/gems'
import { ringInnerDiameter } from '../domain/sizes'
import { buildDesign, TEMPLATES } from '../recipes/index'
import { applyOps, type Design, designFrom } from './design'
import {
  cathedralPeak,
  girdleRadius,
  MOUNT,
  migrateDesign,
  pinsOffRule,
  prongCountFor,
  prongDiameterFor,
  prongSpinFor,
  resolveDesign,
  stoneDims,
  unpinAtRule,
} from './mount'
import type { NodeOf } from './nodes'

const template = (id: string) => buildDesign(TEMPLATES.find((t) => t.id === id)!.spec)
const node = <K extends 'setting'>(d: Design, id: string) => resolveDesign(d).nodes[id] as NodeOf<K>

describe('mount rules', () => {
  it('give each cut its usual claws, symmetric about the band', () => {
    for (const cut of GEM_CUT_IDS) {
      const dims = gemDims(cut, 6)
      // A long baguette or emerald adds a claw each side (tested below).
      const long = (cut === 'baguette' || cut === 'emerald') && dims.length >= MOUNT.longStepClaws
      expect(prongCountFor(cut, dims)).toBe(GEM_CUTS[cut].prongs.typical + (long ? 2 : 0))
    }
    expect(prongCountFor('round', gemDims('round', 7.4))).toBe(6)
    expect(prongCountFor('trillion', gemDims('trillion', 8))).toBe(3)
    // Four at 45°, odd counts with a claw on the finger axis, other even counts on the band.
    expect([3, 4, 5, 6, 8].map(prongSpinFor)).toEqual([30, 45, 18, 0, 0])
  })

  it('size claw wire from the stone (canon 0.1·W + 0.35, never under 0.8)', () => {
    expect(prongDiameterFor(6.5, 4, false)).toBe(1)
    expect(prongDiameterFor(3, 4, false)).toBe(MOUNT.prongMin)
    expect(prongDiameterFor(8, 4, false)).toBe(1.15)
    // Six claws share the load; a halo guards the girdle.
    expect(prongDiameterFor(8, 6, false)).toBe(1)
    expect(prongDiameterFor(8, 4, true)).toBe(1.05)
  })

  it('ignore an unusable measured size and use the nominal one', () => {
    const g = { cut: 'round' as const, width: 6.5, lw: undefined }
    const bad = { provider: 'x', sku: 'y', measured: { length: 0, width: 0, depth: 0 } }
    expect(stoneDims({ ...g, sourcing: bad })).toEqual(gemDims('round', 6.5))
    expect(
      stoneDims({ ...g, sourcing: { ...bad, measured: { length: 6.4, width: 6.5, depth: 4 } } }),
    ).toEqual({ length: 6.5, width: 6.4, depth: 4 })
  })
})

describe('resolveDesign', () => {
  it('fills absent follow fields from the stone and keeps pinned ones', () => {
    const d = template('solitaire')
    const head = d.nodes.head as NodeOf<'setting'>
    expect(head.prongCount).toBeUndefined()
    expect(node<'setting'>(d, 'head')).toMatchObject({
      prongCount: 4,
      prongDiameter: 1,
      prongSpin: 45,
    })
    const trillion = applyOps(d, [{ t: 'update', id: 'center', patch: { cut: 'trillion' } }]).design
    expect(node<'setting'>(trillion, 'head')).toMatchObject({ prongCount: 3, prongSpin: 30 })
    const pinned = applyOps(trillion, [
      { t: 'update', id: 'head', patch: { prongCount: 4 } },
    ]).design
    expect(node<'setting'>(pinned, 'head').prongCount).toBe(4)
    expect(pinsOffRule(pinned)).toEqual([{ nodeId: 'head', path: 'prongCount', value: 4, rule: 3 }])
    // Reset to auto: a null patch removes the pin.
    const reset = applyOps(pinned, [
      { t: 'update', id: 'head', patch: { prongCount: null } },
    ]).design
    expect(node<'setting'>(reset, 'head').prongCount).toBe(3)
  })

  it('packs three-stone side stones 0.5 mm from the centre girdle, whatever the centre', () => {
    for (const width of [5, 7.5, 10.5]) {
      const d = applyOps(template('three-stone'), [
        { t: 'update', id: 'center', patch: { width } },
      ]).design
      const r = resolveDesign(d)
      const band = r.nodes.band as NodeOf<'ringShank'>
      const centre = r.nodes.center as NodeOf<'gem'>
      for (const id of ['side1', 'side2']) {
        const side = r.nodes[id] as NodeOf<'gem'>
        const p = side.placement as Extract<typeof side.placement, { type: 'ringTop' }>
        expect(Math.sign(p.angle!)).toBe(id === 'side1' ? -1 : 1)
        // Plan view on the centre stone: the side's near girdle edge.
        const t = (Math.abs(p.angle!) * Math.PI) / 180
        const R = girdleRadius(side, band)
        const edge = R * Math.sin(t) - (stoneDims(side).width / 2) * Math.cos(t)
        expect(edge - stoneDims(centre).width / 2).toBeCloseTo(MOUNT.sideGap, 2)
      }
    }
  })

  it('raises cathedral arches to just under the girdle, and clears the shoulder row of the head', () => {
    for (const width of [5, 6.6, 9]) {
      const d = applyOps(template('oval-pave'), [
        { t: 'update', id: 'center', patch: { width } },
      ]).design
      const r = resolveDesign(d)
      const band = r.nodes.band as NodeOf<'ringShank'>
      const g = r.nodes.center as NodeOf<'gem'>
      const outer = ringInnerDiameter(band.size) / 2 + band.thicknessTop
      const { peak } = cathedralPeak(band.shoulderHeight!, outer)
      const under = girdleRadius(g, band) - (outer + band.shoulderHeight!) * Math.cos(peak)
      expect(under).toBeGreaterThan(0.2)
      // Arms rise no higher than the rule's cap; above it the head's legs carry the stone.
      if (band.shoulderHeight! < MOUNT.shoulderAutoMax) expect(under).toBeLessThan(0.45)
      else expect(width).toBe(9)
      // The row's clear arc grows with the stone.
      const row = r.nodes.row as NodeOf<'gemRow'>
      const half = ((row.skipCenter! / 2) * Math.PI) / 180
      expect(half * outer).toBeGreaterThan(stoneDims(g).width / 2 + MOUNT.rowClearance)
    }
  })

  it('returns the same node objects when nothing follows (the kernel cache sees no change)', () => {
    const d = designFrom('pendant', [{ id: 'b', kind: 'vectorBody' }])
    expect(resolveDesign(d).nodes.b).toBe(d.nodes.b)
  })
})

describe('version 1 documents keep their meaning', () => {
  it('drop the old "not set" sentinels and unpin values equal to the rule, nothing else', () => {
    const v2 = template('oval-pave')
    const resolved = resolveDesign(v2)
    // A version 1 document stored every default.
    const v1: Design = {
      ...resolved,
      schemaVersion: 1,
      nodes: {
        ...resolved.nodes,
        center: { ...(resolved.nodes.center as NodeOf<'gem'>), lw: 1 },
        row: { ...(resolved.nodes.row as NodeOf<'gemRow'>), graduateTo: 1.5, skipCenter: 44 },
        head: { ...(resolved.nodes.head as NodeOf<'setting'>), prongDiameter: 1.3 },
      },
    }
    const m = migrateDesign(v1)
    expect(m.schemaVersion).toBe(2)
    // An oval's lw of 1 meant "the cut's own"; a row's graduateTo of 1.5 meant "none".
    expect((m.nodes.center as NodeOf<'gem'>).lw).toBeUndefined()
    expect((m.nodes.row as NodeOf<'gemRow'>).graduateTo).toBeUndefined()
    // Stored values that differ from the rule stay pinned: the old piece looks as it did.
    expect((m.nodes.row as NodeOf<'gemRow'>).skipCenter).toBe(44)
    expect((m.nodes.head as NodeOf<'setting'>).prongDiameter).toBe(1.3)
    // Values equal to the rule now follow.
    expect((m.nodes.head as NodeOf<'setting'>).prongCount).toBeUndefined()
    // An edit migrates first: the result is version 2 and keeps the pins.
    const edited = applyOps(v1, [{ t: 'update', id: 'band', patch: { widthTop: 2 } }]).design
    expect(edited.schemaVersion).toBe(2)
    expect((edited.nodes.head as NodeOf<'setting'>).prongDiameter).toBe(1.3)
  })

  it('keeps a square radiant square (an lw of 1 is a real ratio for a cut that allows it)', () => {
    const d = designFrom('ring', [{ id: 'g', kind: 'gem', cut: 'radiant', lw: 1 }])
    const m = migrateDesign({ ...d, schemaVersion: 1 })
    expect((m.nodes.g as NodeOf<'gem'>).lw).toBe(1)
  })

  it('unpinAtRule is idempotent and changes nothing that is built', () => {
    for (const t of TEMPLATES) {
      const d = buildDesign(t.spec)
      expect(unpinAtRule(d)).toEqual(d)
      expect(pinsOffRule(d)).toEqual([])
    }
  })

  it('migration unpins only values exactly at their rule, and marks halos to keep their layout', () => {
    const v1: Design = {
      ...buildDesign(TEMPLATES.find((t) => t.id === 'halo')!.spec),
      schemaVersion: 1,
    }
    const near = applyOps(v1, []).design
    expect((near.nodes.halo as NodeOf<'halo'>).clearClaws).toBe(false)
    // A stored 0.99 mm wire beside a rule of 1.0 stays pinned (it would move with a later stone).
    const pinned: Design = {
      ...v1,
      nodes: { ...v1.nodes, head: { ...v1.nodes.head!, prongDiameter: 0.99 } as NodeOf<'setting'> },
    }
    expect((migrateDesign(pinned).nodes.head as NodeOf<'setting'>).prongDiameter).toBe(0.99)
  })

  it('a baguette or emerald 12 mm long takes a claw on each long side', () => {
    expect(prongCountFor('baguette', gemDims('baguette', 3, 2))).toBe(4)
    expect(prongCountFor('baguette', gemDims('baguette', 6.5, 2.5))).toBe(6)
    expect(prongCountFor('emerald', gemDims('emerald', 8.6, 1.4))).toBe(6)
  })
})
