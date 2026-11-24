import { describe, expect, it } from 'vitest'
import { draftKernel, template } from '../kernel.testkit'
import { caseTable, checkTable } from './report'
import { cameraError, reprojection, runCase } from './run'
import { makeCase } from './synth'
import { checkThresholds } from './thresholds'

const k = draftKernel()

describe('benchmark harness', () => {
  it('makes the same case from the same seed, with the truth hidden from the start', async () => {
    const o = {
      templateId: 'solitaire',
      views: 'two' as const,
      level: 'noisy' as const,
      seed: 3,
      px: 96,
      template: template('solitaire'),
    }
    const a = await makeCase(o, k.evaluate)
    const b = await makeCase(o, k.evaluate)
    expect(a.truthValues).toEqual(b.truthValues)
    expect(a.views.map((v) => Array.from(v.matte))).toEqual(b.views.map((v) => Array.from(v.matte)))
    expect(a.views.filter((v) => v.heldOut)).toHaveLength(1)
    expect(a.params.map((p) => p.start)).not.toEqual(a.truthValues)
    expect(a.views.every((v) => v.seed)).toBe(true)
  })

  it('treats the 180° twin of a ring view as the same camera', () => {
    const c = {
      azimuth: 30,
      elevation: 40,
      roll: 0,
      distance: 100,
      span: 30,
      shift: [0, 0] as [number, number],
      target: [0, 0, 0] as [number, number, number],
    }
    expect(cameraError(c, { ...c, azimuth: 210 }, true)).toBeCloseTo(0)
    expect(cameraError(c, { ...c, azimuth: 210 }, false)).toBeGreaterThan(60)
    expect(cameraError(c, { ...c, azimuth: 33 }, true)).toBeGreaterThan(2)
  })

  it('measures the camera by reprojection, so any symmetry of the piece is a twin', async () => {
    // A plain band turned 180° about Z is itself, so the 180° twin draws the same points; a mirror
    // view draws them flipped (a different photo), and a real miss moves them.
    const e = await k.evaluate(template('wedding-band'))
    const b = e.report.bounds
    const c = {
      azimuth: 30,
      elevation: 40,
      roll: 0,
      distance: 200,
      span: 30,
      shift: [0, 0] as [number, number],
      target: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] as [
        number,
        number,
        number,
      ],
    }
    expect(reprojection(e, c, c)).toBe(0)
    expect(reprojection(e, c, { ...c, azimuth: 210 })).toBeLessThan(0.05)
    expect(reprojection(e, c, { ...c, azimuth: -30 })).toBeGreaterThan(1)
    expect(reprojection(e, c, { ...c, azimuth: 31 })).toBeGreaterThan(0.05)
    expect(reprojection(e, c, { ...c, elevation: 50 })).toBeGreaterThan(0.5)
    expect(reprojection(e, c, { ...c, shift: [0.03, 0] })).toBeGreaterThan(0.5)
  })

  it('makes misspecified cases: held fields changed, truth outside the bands, part masks drawn', async () => {
    const o = {
      templateId: 'solitaire',
      views: 'one' as const,
      seed: 2,
      px: 96,
      template: template('solitaire'),
    }
    const m = await makeCase({ ...o, level: 'misspec' }, k.evaluate)
    const band = m.truth.nodes.band as unknown as Record<string, unknown>
    const start = m.start.nodes.band as unknown as Record<string, unknown>
    const head = m.truth.nodes.head as unknown as Record<string, unknown>
    const changed = ['profile', 'shoulder', 'widthBottom'].filter((f) => band[f] !== start[f])
    expect(changed.length).toBeGreaterThan(0)
    expect(head.taper).not.toBe((m.start.nodes.head as unknown as Record<string, unknown>).taper)
    // Some truth may lie outside the search band (drawn from bands widened by 30 % each side).
    m.params.forEach((p, j) => {
      expect(m.truthValues[j]!).toBeGreaterThanOrEqual(p.min - 0.3 * (p.max - p.min) - 1e-9)
      expect(m.truthValues[j]!).toBeLessThanOrEqual(p.max + 0.3 * (p.max - p.min) + 1e-9)
    })
    expect(m.views[0]!.parts?.map((p) => p.key)).toEqual(['head', 'band'])
    // The closed-world levels are unchanged by the new level.
    const clean = await makeCase({ ...o, level: 'clean' }, k.evaluate)
    expect((clean.truth.nodes.band as unknown as Record<string, unknown>).profile).toBe(
      start.profile,
    )
  })

  it('runs a case end to end and reports failures beside accuracy', async () => {
    const c = await makeCase(
      {
        templateId: 'solitaire',
        views: 'one',
        level: 'clean',
        seed: 1,
        px: 96,
        template: template('solitaire'),
      },
      k.evaluate,
    )
    const r = await runCase(c, k.evaluate, { evaluations: 6, observe: false })
    expect(r.threw).toBeNull()
    expect(r.invalid).toBe(false)
    expect(r.params).toHaveLength(5)
    expect(r.iouAfter[0]).toBeGreaterThan(0.5)
    expect(r.discrete?.truth).toMatch(/^[46]$/)
    const checks = checkThresholds([r])
    expect(checks.find((x) => x.measure.startsWith('Invalid builds'))!.pass).toBe(true)
    expect(caseTable([r])).toContain('solitaire/one/clean/1')
    expect(checkTable(checks)).toContain('floor met')
    // Two candidates, each with a pose search and a held-out search, on a shared machine.
  }, 240_000)
})
