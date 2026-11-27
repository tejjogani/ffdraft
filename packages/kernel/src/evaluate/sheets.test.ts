import { designFrom } from '@pave/schema'
import { makePolygon } from 'replicad'
import { expect, it } from 'vitest'
import { defineFeature, metalOf, solidFromBrep } from '../core'
import { step } from '../export/step'
import { loadRuntime } from '../runtime/index'
import { Evaluator } from './evaluate'

it('displays an editable exact sheet at both details, excludes it from casting and writes it to STEP', async () => {
  const feature = defineFeature('primitive', (node) => ({
    sheets: [
      {
        ...metalOf(node),
        solid: solidFromBrep(
          makePolygon([
            [0, 0, 0],
            [4, 0, 0],
            [4, 3, 0],
            [0, 3, 0],
          ]),
        ),
      },
    ],
  }))
  await loadRuntime()
  const evaluator = new Evaluator([feature])
  try {
    const document = designFrom('other', [
      { id: 'patch', kind: 'primitive', transform: { position: [2, 1, 5] } },
    ])
    for (const detail of ['draft', 'production'] as const) {
      const scene = await evaluator.scene(document, { detail })
      expect(scene.evaluation.diagnostics.filter((d) => d.level === 'error')).toEqual([])
      expect(scene.evaluation.parts).toHaveLength(0)
      expect(scene.evaluation.report.metalMassG).toBe(0)
      const patch = scene.evaluation.referenceParts?.[0]
      expect(patch?.areaMm2).toBeCloseTo(12)
      expect(patch?.bounds.min[2]).toBeCloseTo(5)
      if (detail === 'production') {
        const result = await step.run(scene, {})
        expect(new TextDecoder().decode(result.bytes)).toContain('ADVANCED_FACE')
      }
    }
  } finally {
    evaluator.dispose()
  }
})
