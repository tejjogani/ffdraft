import type { Evaluation, Report } from '@pave/kernel'
import { buildDesign, type Piece, TEMPLATES } from '@pave/schema'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PiecePanel } from '../PiecePanel'
import { pieceFigures } from './figures'
import type { ProductionCheck } from './useProductionCheck'

const report = (metalMassG: number): Report => ({
  metals: [{ material: 'au18k-white', volumeMm3: metalMassG * 64, massG: metalMassG }],
  metalMassG,
  lots: [],
  stoneCount: 21,
  caratTotal: 1.62,
  bounds: { min: [-10, -10, -2], max: [10, 12, 8] },
  ringInnerDiameter: 16.5,
})
// The halo ring of the review: the draft (seats uncut) says 3.6 g, the production check 3.24 g.
const draft = { report: report(3.6), detail: 'draft' } as Evaluation
const done: ProductionCheck = { state: 'done', diagnostics: [], report: report(3.24) }

describe('the piece’s figures on the CAD screen', () => {
  it('are the production check’s, exact, once it has run on the version shown', () => {
    expect(pieceFigures(draft, done, true)).toEqual({ report: done.report, exact: true })
  })

  it('are the draft’s, approximate, until then', () => {
    for (const check of [
      { state: 'idle' },
      { state: 'running' },
      { state: 'failed', error: 'x' },
    ] as ProductionCheck[])
      expect(pieceFigures(draft, check, true)).toEqual({ report: draft.report, exact: false })
  })

  it('go back to the draft while the shown design is ahead of the checked one (a drag)', () => {
    expect(pieceFigures(draft, done, false)).toEqual({ report: draft.report, exact: false })
  })

  it('are absent before the first evaluation', () => {
    expect(pieceFigures(null, done, true)).toBeNull()
  })
})

describe('the Facts panel', () => {
  const design = buildDesign(TEMPLATES.find((t) => t.id === 'halo')!.spec)
  const piece = { title: 'Cushion halo ring', design } as unknown as Piece
  const facts = (figures: ReturnType<typeof pieceFigures>) =>
    renderToStaticMarkup(
      createElement(PiecePanel, { piece, design, figures, session: null, readOnly: true }),
    )

  it('shows the readout’s production weight once checked, without “≈”', () => {
    const html = facts(pieceFigures(draft, done, true))
    expect(html).toContain('3.24 g')
    expect(html).not.toContain('3.6 g')
    expect(html).not.toContain('≈')
  })

  it('shows the same approximate draft weight as the readout before the check', () => {
    const html = facts(pieceFigures(draft, { state: 'running' }, true))
    expect(html).toContain('3.6 g')
    expect(html).toContain('≈')
  })
})
