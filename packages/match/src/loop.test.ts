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
})
