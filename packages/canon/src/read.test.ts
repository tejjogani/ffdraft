import { applyOps } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { buildExemplar, EXEMPLAR_SOURCES } from './exemplars/index'
import { pieceFacts } from './facts'
import { diffReads, inferArchetype, readDesign, targetsFrom } from './read'

const source = EXEMPLAR_SOURCES.find((e) => e.id === 'sol-classic-round')!
const design = buildExemplar(source)

describe('design reads', () => {
  it('infer the archetype of every spec-built exemplar from its document alone', () => {
    for (const e of EXEMPLAR_SOURCES)
      if ('spec' in e.build) expect(inferArchetype(buildExemplar(e)), e.id).toBe(e.archetype)
  })

  it('read a design as ratios and categoricals', () => {
    const r = readDesign(design)
    expect(r.archetype).toBe('solitaire')
    expect(r.centre).toMatchObject({
      cut: 'round',
      setting: 'basket',
      prongCount: 4,
      orientation: 'NS',
    })
    expect(r.ratios.bandToStone?.value).toBeCloseTo(0.3, 1)
    expect(r.silhouette.profile).toBe('classic')
  })

  it('find no difference between a design and itself, and flag a 25 % change', () => {
    const r = readDesign(design)
    expect(diffReads(r, r).filter((d) => d.finding)).toEqual([])
    const wide = applyOps(design, [{ t: 'update', id: 'band', patch: { widthTop: 3.0 } }]).design
    const diff = diffReads(r, readDesign(wide)).filter((d) => d.finding)
    expect(diff.map((d) => d.field)).toContain('ratios.bandToStone')
  })

  it('turn a read into parameter targets that hold the design it came from', () => {
    const r = readDesign(design)
    const targets = targetsFrom(r, pieceFacts(design))
    const band = targets.find((t) => t.param === 'band.widthTop')!
    const width = design.nodes.band?.kind === 'ringShank' ? design.nodes.band.widthTop : 0
    expect(width).toBeGreaterThanOrEqual(band.band[0])
    expect(width).toBeLessThanOrEqual(band.band[1])
    expect(targets.every((t) => t.variant === 'classic')).toBe(true)
  })
})
