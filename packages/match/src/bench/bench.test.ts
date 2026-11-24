import { describe, expect, it } from 'vitest'
import { draftKernel, template } from '../kernel.testkit'
import { caseTable, checkTable } from './report'
import { cameraError, runCase } from './run'
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
  })
})
