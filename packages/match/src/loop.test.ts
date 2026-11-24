import { applyOps } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { draftKernel, template } from './kernel.testkit'
import { type Recipe, runMatch } from './loop'
import { rasterize } from './raster'
import { fieldsOf, readStatus, scriptedReader } from './read'
import type { Camera, TargetView } from './types'

const k = draftKernel()

describe('the loop without any model', () => {
  it('reads statuses from agreement and visibility', () => {
    expect(readStatus({ value: '4', visible: 'yes', agreement: 3 })).toBe('seen')
    expect(readStatus({ value: '4', visible: 'partly', agreement: 3 })).toBe('unsure')
    expect(readStatus({ value: '4', visible: 'yes', agreement: 2 })).toBe('unsure')
    expect(readStatus({ value: '4', visible: 'no', agreement: 3 })).toBe('assumed')
    expect(readStatus(undefined)).toBe('assumed')
  })

  async function setup() {
    const base = template('solitaire')
    const truth = applyOps(base, [
      { t: 'update', id: 'head', patch: { prongCount: 6 } },
      { t: 'update', id: 'band', patch: { widthTop: 3, widthBottom: 3 } },
    ]).design
    const e = await k.evaluate(truth)
    const b = e.report.bounds
    const diag = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])
    const cam: Camera = {
      azimuth: 12,
      elevation: 74,
      roll: -3,
      distance: diag * 10,
      span: diag / 0.64,
      shift: [0.01, 0.02],
      target: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2],
    }
    const r = rasterize(e, cam, { width: 128, height: 128 })
    const view: TargetView = {
      id: 'p1',
      width: 128,
      height: 128,
      matte: r.cls.map((v) => (v ? 1 : 0)),
      stones: r.cls.map((v) => (v === 2 ? 1 : 0)),
    }
    const recipe: Recipe = {
      templateId: 'solitaire',
      design: base,
      keys: ['band.widthTop'],
      bands: { 'band.widthTop': [1.6, 4] },
      ties: { 'band.widthTop': ['band.widthBottom'] },
      discrete: { 'head.prongCount': ['4', '6'] },
    }
    return { truth, view, recipe }
  }

  it('a wrong read biased to the familiar answer ends right, or as a question', async () => {
    const { truth, view, recipe } = await setup()
    const reader = scriptedReader(
      {
        kind: 'ring',
        templateId: 'solitaire',
        fields: fieldsOf(truth, ['head.prongCount']),
        views: { p1: 'top' },
      },
      { errorRate: 1, familiar: { 'head.prongCount': '4' } },
    )
    const out = await runMatch({
      views: [view],
      reader,
      recipes: [recipe],
      anchor: { type: 'ringSize', nodeId: 'band', size: { system: 'us', value: 6 } },
      evaluate: k.evaluate,
      budget: { evaluations: 16 },
    })
    expect(reader.errors).toEqual(['head.prongCount'])
    const choice = out.choices.find((c) => c.field === 'head.prongCount')!
    expect(choice.value === '6' || choice.status === 'question').toBe(true)
    if (choice.status === 'question') expect(out.questions.length).toBeGreaterThan(0)
    expect(out.scaleAssumed).toBe(false)
    expect(out.result.params.find((p) => p.key === 'band.widthTop')!.value).toBeGreaterThan(2.5)
  })

  it('a read that is wrong and sure of it is not caught (known limit)', async () => {
    const { truth, view, recipe } = await setup()
    const reader = scriptedReader(
      {
        kind: 'ring',
        templateId: 'solitaire',
        fields: fieldsOf(truth, ['head.prongCount']),
        views: { p1: 'top' },
      },
      { errorRate: 1, familiar: { 'head.prongCount': '4' }, confident: true },
    )
    const out = await runMatch({
      views: [view],
      reader,
      recipes: [recipe],
      evaluate: k.evaluate,
      budget: { evaluations: 8 },
      observe: false,
    })
    expect(out.choices.find((c) => c.field === 'head.prongCount')).toMatchObject({
      value: '4',
      status: 'seen',
    })
    expect(out.scaleAssumed).toBe(true)
  })

  it('settles two open fields one at a time, each with its own margin, building every option', async () => {
    const { truth, view, recipe } = await setup()
    const two: Recipe = {
      ...recipe,
      discrete: {
        'head.prongCount': ['4', '6'],
        'head.prongTip': ['round', 'claw', 'tab', 'double'],
      },
    }
    // Both read as unsure, each biased to the familiar answer; the truth is 6 prongs, round tips.
    const reader = scriptedReader(
      {
        kind: 'ring',
        templateId: 'solitaire',
        fields: fieldsOf(truth, ['head.prongCount', 'head.prongTip']),
        views: { p1: 'top' },
      },
      { errorRate: 1, familiar: { 'head.prongCount': '4', 'head.prongTip': 'claw' } },
    )
    const out = await runMatch({
      views: [view],
      reader,
      recipes: [two],
      evaluate: k.evaluate,
      budget: { evaluations: 8 },
      observe: false,
    })
    expect(reader.errors.sort()).toEqual(['head.prongCount', 'head.prongTip'])
    const count = out.choices.find((c) => c.field === 'head.prongCount')!
    const tip = out.choices.find((c) => c.field === 'head.prongTip')!
    // Every option of every open field is built, so the truth can win or at least be offered.
    expect(count.built).toEqual(['4', '6'])
    expect(tip.built.slice().sort()).toEqual(['claw', 'double', 'round', 'tab'])
    expect(count.notBuilt).toEqual([])
    expect(count.margin).not.toBeNull()
    expect(tip.margin).not.toBeNull()
    expect(count.margin).not.toBe(tip.margin)
    expect(count.value === '6' || count.status === 'question').toBe(true)
    if (count.status === 'question')
      expect(out.questions.find((q) => q.field === 'head.prongCount')?.options).toContain('6')
  }, 180_000) // Builds and fits six options: about 50 s alone, past the default under load.

  it('says which options it did not build when the cap cuts a field short', async () => {
    const { truth, view, recipe } = await setup()
    const reader = scriptedReader(
      {
        kind: 'ring',
        templateId: 'solitaire',
        fields: fieldsOf(truth, ['head.prongTip']),
        views: { p1: 'top' },
      },
      { errorRate: 1, familiar: { 'head.prongTip': 'claw' } },
    )
    const out = await runMatch({
      views: [view],
      reader,
      recipes: [{ ...recipe, discrete: { 'head.prongTip': ['round', 'claw', 'tab', 'double'] } }],
      evaluate: k.evaluate,
      budget: { evaluations: 4 },
      maxCandidates: 2,
      observe: false,
    })
    const tip = out.choices.find((c) => c.field === 'head.prongTip')!
    expect(tip.built).toEqual(['claw', 'round'])
    expect(tip.notBuilt).toEqual(['tab', 'double'])
  })

  it('reports a photo of another recipe as poor and routes it off the parametric path', async () => {
    const e = await k.evaluate(template('wedding-band'))
    const b = e.report.bounds
    const diag = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])
    const cam: Camera = {
      azimuth: 40,
      elevation: 38,
      roll: 3,
      distance: diag * 10,
      span: diag / 0.62,
      shift: [0, 0],
      target: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2],
    }
    const r = rasterize(e, cam, { width: 96, height: 96 })
    const view: TargetView = {
      id: 'p1',
      width: 96,
      height: 96,
      matte: r.cls.map((v) => (v ? 1 : 0)),
      stones: r.cls.map((v) => (v === 2 ? 1 : 0)),
    }
    const out = await runMatch({
      views: [view],
      reader: scriptedReader({ kind: 'ring', templateId: 'solitaire', fields: {}, views: {} }),
      recipes: [
        {
          templateId: 'solitaire',
          design: template('solitaire'),
          keys: ['center.width'],
          bands: { 'center.width': [5, 9] },
        },
      ],
      evaluate: k.evaluate,
      budget: { evaluations: 6 },
      observe: false,
    })
    expect(out.fit.quality).toBe('poor')
    expect(out.result.stopped).not.toBe('converged')
    expect(out.fit.route?.route).not.toBe('parametric')
    expect(out.fit.reason).toMatch(/stone overlap/)
  })

  it('refuses an empty photo before any build and says why', async () => {
    let calls = 0
    const out = await runMatch({
      views: [{ id: 'p1', width: 64, height: 64, matte: new Uint8Array(64 * 64) }],
      reader: scriptedReader({ kind: 'ring', templateId: 'solitaire', fields: {}, views: {} }),
      recipes: [
        { templateId: 'solitaire', design: template('solitaire'), keys: ['band.widthTop'] },
      ],
      evaluate: async (d, s) => {
        calls++
        return k.evaluate(d, s)
      },
    })
    expect(out.fit.quality).toBe('failed')
    expect(out.result.stopped).toBe('rejected')
    expect(out.fit.reason).toMatch(/cannot be fitted/)
    expect(calls).toBe(0)
  })
})
