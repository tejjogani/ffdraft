/**
 * No rule may suggest below a manufacturability minimum of docs/research/02-production.md (and the
 * kernel floors that encode it). Checked on every band, in every corpus context where it applies.
 */
import { describe, expect, it } from 'vitest'
import { evaluations } from './corpus.testkit'

const EPS = 1e-6

/** Path → least value any canon band may reach, with its source. */
const MINIMUMS: Record<string, { min: number; why: string }> = {
  'setting.prongDiameter': {
    min: 0.8,
    why: 'claws ≥ 0.8 mm when long (02-production §3; kernel prong.small)',
  },
  'setting.wall': { min: 0.45, why: 'bezel wall ≥ 0.45 mm (Stuller, 02-production)' },
  'ringShank.thicknessTop': {
    min: 1.5,
    why: 'ring band ≥ 1.0 mm (02-production), daily wear ≥ 1.5 (kernel shank.thin)',
  },
  'ringShank.thicknessBottom': { min: 1.5, why: 'as above' },
  'ringShank.widthTop': { min: 1.5, why: 'below 1.5 mm bands bend (kernel shank.narrow)' },
  'bail.wire': { min: 1.0, why: 'bail wall ≥ 1.0 mm (06-freeform §6; kernel bail.thin)' },
  'finding.wire': { min: 0.8, why: 'posts 0.8–0.9 mm (01-cad §2; kernel post.thin)' },
  'pipe.width': { min: 0.8, why: 'structural wall ≥ 0.8 mm (02-production)' },
  'vectorBody.thickness': { min: 0.8, why: 'structural wall ≥ 0.8 mm (02-production)' },
  'relief.baseThickness': { min: 0.8, why: 'structural wall ≥ 0.8 mm (02-production)' },
  'chain.wire': { min: 0.5, why: 'cast wire ≥ 0.5 mm (02-production print floor)' },
  'pave.gap': { min: 0.1, why: 'room for beads 0.4–0.5 mm between seats (02-production)' },
  'gemRow.gap': { min: 0.05, why: 'channel stones never touch (09 §1, kernel)' },
}

/** Path → most any canon band may reach. */
const MAXIMUMS: Record<string, { max: number; why: string }> = {
  'engraving.depth': { max: 0.5, why: 'recessed text ≤ 0.50 mm deep (02-production)' },
}

const evals = evaluations()

describe('manufacturability', () => {
  it('no band reaches below a production minimum', () => {
    let checked = 0
    for (const e of evals) {
      if (e.rule.measure) continue
      const floor = MINIMUMS[e.rule.paths[0]!]
      if (!floor) continue
      checked++
      for (const b of [e.band, ...e.variants])
        expect(b.min, `${e.rule.id} on ${e.item.id}: ${floor.why}`).toBeGreaterThanOrEqual(
          floor.min - EPS,
        )
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('no band reaches above a production maximum', () => {
    for (const e of evals) {
      const cap = MAXIMUMS[e.rule.paths[0]!]
      if (!cap || e.rule.measure) continue
      expect(e.hull.max, `${e.rule.id}: ${cap.why}`).toBeLessThanOrEqual(cap.max + EPS)
    }
  })

  it('walled rows keep 0.5 mm of wall each side and bails clear the chain by 1.5 mm', () => {
    for (const e of evals) {
      const f = e.facts
      if (
        e.rule.id === 'rows.walledPave' &&
        f.rowRows === 1 &&
        f.bandW !== undefined &&
        f.bandW >= 1.6
      )
        expect(e.hull.max + 1.0, e.item.id).toBeLessThanOrEqual(f.bandW + EPS)
      if (e.rule.id === 'bail.opening' && f.chainW !== undefined)
        expect(e.hull.min, e.item.id).toBeGreaterThanOrEqual(f.chainW + 1.5 - EPS)
      if (e.rule.id === 'iced.edge')
        expect(e.hull.min, 'GIA pavé border ≥ 0.5').toBeGreaterThanOrEqual(0.5)
    }
  })
})
