import { RenderSceneSchema } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { applyAdjustments, assessRender, type RenderMetrics } from './assess'

const scene = RenderSceneSchema.parse({ output: { quality: 'preview' } })
const good: RenderMetrics = {
  width: 768,
  height: 768,
  subjectBox: [0.18, 0.17, 0.82, 0.83],
  subjectCoverage: 0.3,
  clippedPct: 0.2,
  crushedPct: 5,
  subjectLuminance: 0.45,
  firefliesPerMp: 2,
  noise: 0.004,
}
const codes = (m: Partial<RenderMetrics>) =>
  assessRender({ ...good, ...m }, scene).map((i) => i.code)

describe('assessRender', () => {
  it('passes a well-made render', () => {
    expect(assessRender(good, scene)).toEqual([])
  })

  it('flags framing and suggests a focal length', () => {
    const [small] = assessRender({ ...good, subjectBox: [0.35, 0.35, 0.65, 0.65] }, scene)
    expect(small?.code).toBe('framing.small')
    expect(small?.adjust).toEqual([{ path: 'camera.focalLength', value: 198 }])
    expect(codes({ subjectBox: [0, 0.1, 0.9, 0.9] })).toContain('framing.cropped')
    expect(codes({ subjectBox: [0.05, 0.05, 0.95, 0.95] })).toContain('framing.large')
    expect(codes({ subjectBox: [0.4, 0.2, 0.95, 0.8] })).toContain('framing.offCentre')
    expect(codes({ subjectBox: null })).toEqual(['subject.missing'])
  })

  it('lets a macro crop the piece', () => {
    const macro = RenderSceneSchema.parse({ camera: { preset: 'macro' } })
    expect(assessRender({ ...good, subjectBox: [0.05, 0.3, 0.95, 1] }, macro)).toEqual([])
  })

  it('flags exposure, noise and fireflies', () => {
    expect(codes({ clippedPct: 4 })).toEqual(['exposure.clipped'])
    expect(codes({ subjectLuminance: 0.1 })).toEqual(['exposure.dark'])
    expect(codes({ crushedPct: 40 })).toEqual(['exposure.crushed'])
    const [noise] = assessRender({ ...good, noise: 0.03 }, scene)
    expect(noise?.adjust).toEqual([{ path: 'output.quality', value: 'standard' }])
    expect(codes({ firefliesPerMp: 100 })).toEqual(['noise.fireflies'])
  })

  it('applies adjustments immutably to a valid scene', () => {
    const issues = assessRender({ ...good, clippedPct: 4, noise: 0.03 }, scene)
    const next = applyAdjustments(
      scene,
      issues.flatMap((i) => i.adjust),
    )
    expect(next.environment.intensity).toBe(0.8)
    expect(next.output.quality).toBe('standard')
    expect(scene.environment.intensity).toBe(1)
    expect(RenderSceneSchema.safeParse(next).success).toBe(true)
  })
})
