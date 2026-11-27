import { designFrom } from '@pave/schema'
import { expect, it } from 'vitest'
import { step } from '../export/step'
import { curve } from '../features/curve'
import { loft } from '../features/loft'
import { loadRuntime } from '../runtime/index'
import { Evaluator } from './evaluate'

it('displays an editable exact sheet at both details, excludes it from casting and writes it to STEP', async () => {
  await loadRuntime()
  const evaluator = new Evaluator([curve, loft])
  try {
    const document = designFrom('other', [
      ...[0, 3].map((v) => ({
        kind: 'curve' as const,
        id: 'edge' + v,
        plane: 'top' as const,
        points: [
          { id: 'a', u: 0, v },
          { id: 'b', u: 4, v },
        ],
      })),
      {
        id: 'patch',
        kind: 'loft',
        sections: ['edge0', 'edge3'],
        capped: false,
        transform: { position: [2, 1, 5] },
      },
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
