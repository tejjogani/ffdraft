import type { Evaluation, Part } from '@pave/kernel'
import { describe, expect, it } from 'vitest'
import { displayEvaluation, initialModelView } from './display-evaluation'

const bounds = { min: [20, 30, 40], max: [21, 32, 43] } as const
const reference = {
  id: 'source',
  nodeId: 'source',
  importRole: 'reference',
  bounds: { min: [...bounds.min], max: [...bounds.max] },
} as Part

const draft: Evaluation = {
  detail: 'draft',
  parts: [],
  referenceParts: [reference],
  stones: [],
  gemMeshes: {},
  diagnostics: [],
  report: {
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    metalMassG: 0,
    metals: [],
    caratTotal: 0,
    lots: [],
    stoneCount: 0,
  },
  ms: 0,
  timings: {},
}

describe('import references in the viewport', () => {
  it('frames a reference-only model at its source coordinates', () => {
    const view = displayEvaluation(draft)
    expect(view.parts).toEqual([reference])
    expect(view.report.bounds).toEqual(bounds)
    expect(draft.parts).toEqual([])
    expect(draft.report.bounds.max).toEqual([0, 0, 0])
  })

  it('frames the union of production and reference geometry', () => {
    const production = { ...reference, id: 'band', importRole: undefined }
    const piece = {
      ...draft,
      parts: [production],
      report: { ...draft.report, bounds: { min: [-3, -4, -5], max: [3, 4, 5] } as Part['bounds'] },
    }
    const view = displayEvaluation(piece)
    expect(view.parts).toEqual([production, reference])
    expect(view.report.bounds).toEqual({ min: [-3, -4, -5], max: [21, 32, 43] })
  })
})

describe('initial model view', () => {
  it('opens a reference-only import in three-quarter view', () => {
    expect(initialModelView(draft)).toBe('three-quarter')
    expect(initialModelView(displayEvaluation(draft))).toBe('three-quarter')
  })

  it('opens an import mixed with a modelled feature in three-quarter view', () => {
    const production = { ...reference, id: 'band', importRole: undefined }
    expect(initialModelView({ ...draft, parts: [production] })).toBe('three-quarter')
  })

  it('uses the conventional front view for a modelled pendant', () => {
    const pendant = { ...reference, id: 'pendant', importRole: undefined }
    expect(initialModelView({ ...draft, parts: [pendant], referenceParts: [] })).toBe('front')
  })

  it('leaves initial framing to the construction plane for a curve-only design', () => {
    const curve = { nodeId: 'profile', closed: false, plane: 'top' as const, points: [] }
    expect(initialModelView({ ...draft, referenceParts: [], curves: [curve] })).toBeNull()
  })
})
