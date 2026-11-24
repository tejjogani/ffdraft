// The kernel's ambient module types, which its own tsconfig picks up from its src folder.
/// <reference path="../../kernel/src/runtime/opentype.d.ts" />
/// <reference path="../../kernel/src/runtime/vite.d.ts" />
/// <reference path="../../kernel/src/export/rhino3dmModule.d.ts" />
/**
 * The kernel outranks the canon (research 09, "Decisions"): every exemplar and every template
 * built with the canon evaluates at production detail with no kernel error or warning, and the
 * canon's lint stays clean with the evaluation summary in hand. @pave/kernel is a dev
 * dependency for this test only; the canon itself never imports it.
 */
import { createKernel } from '@pave/kernel'
import { type EvaluationSummary, PieceSpecSchema, TEMPLATES } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { buildExemplar, EXEMPLAR_SOURCES } from './exemplars/index'
import { lintDesign } from './lint'
import { suggestDesign } from './suggest'

const kernel = createKernel()

/**
 * Kernel findings the canon cannot fix, each with its owner. Research 09 lists the halo's
 * 0.25 mm border and its indexing round the claws as kernel work ("Kernel and schema work").
 */
const KERNEL_OWNED = new Set(['seat.wall@halo', 'stone.inMetal@halo'])
/** Export-size notices about dense pavé meshes, not design faults. */
const NOT_DESIGN = new Set(['mesh.dense', 'stl.large'])

const ITEMS = [
  ...EXEMPLAR_SOURCES.map((e) => ({
    id: e.id,
    design: () => buildExemplar(e),
    lint: { archetype: e.archetype, styles: e.styles },
  })),
  ...TEMPLATES.map((t) => ({
    id: `template:${t.id}`,
    design: () => suggestDesign(t.spec).design,
    lint: { spec: PieceSpecSchema.parse(t.spec) },
  })),
]

describe('canon-built designs at production detail', () => {
  for (const item of ITEMS)
    it(`${item.id}: no kernel warning, lint-clean with the summary`, async () => {
      const design = item.design()
      const ev = await kernel.evaluate(design, { detail: 'production' })
      const bad = ev.diagnostics
        .filter((d) => d.level === 'error' || d.level === 'warning')
        .filter((d) => !NOT_DESIGN.has(d.code) && !KERNEL_OWNED.has(`${d.code}@${d.nodeId}`))
        .map((d) => `${d.code}@${d.nodeId ?? ''}: ${d.message}`)
      expect(bad).toEqual([])
      const b = ev.report.bounds
      const summary: EvaluationSummary = {
        metalMassG: ev.report.metalMassG,
        metals: [],
        stoneCount: ev.report.stoneCount,
        caratTotal: ev.report.caratTotal,
        lots: [],
        boundsMm: { x: b.max[0] - b.min[0], y: b.max[1] - b.min[1], z: b.max[2] - b.min[2] },
        diagnostics: [],
      }
      expect(lintDesign(design, summary, item.lint).map((f) => f.message)).toEqual([])
    }, 300_000)
})
