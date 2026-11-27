import { RenderSceneSchema } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { solitaireRing } from '../fixtures'
import { placeShot, shotFraming, shotVocabulary } from './cinema'
import { projectPoint } from './framing'
import { resolveScene } from './resolve'
import { type SceneSubject, subjectOf } from './subject'

const ring = subjectOf(solitaireRing())
const template = ring.parts[0]!

/** A synthetic rail with the measured proportions of an open row of jewelry settings. */
function straightSettings(step = 6.52, width = 6.35): SceneSubject {
  const parts = Array.from({ length: 30 }, (_, index): SceneSubject['parts'][number][] => {
    const x = index * step
    return [
      {
        ...template,
        id: `original-${index}`,
        nodeId: `original-${index}`,
        importRole: 'unassigned',
        sourceAppearance: { kind: 'gem', stone: index % 2 ? 'emerald' : 'diamond' },
        bounds: { min: [x - width / 2, -width / 2, -2.83], max: [x + width / 2, width / 2, 1.11] },
      },
      {
        ...template,
        id: `basket-${index}`,
        nodeId: `basket-${index}`,
        importRole: 'unassigned',
        sourceAppearance: { kind: 'metal', metal: 'au18k-white' },
        bounds: { min: [x - 3.23, -3.23, -3.5], max: [x + 3.23, 3.23, 2.62] },
      },
    ]
  }).flat()
  parts.push({
    ...template,
    id: 'clasp',
    nodeId: 'clasp',
    importRole: 'unassigned',
    bounds: { min: [29 * step + 2.5, -6.56, -3.5], max: [29 * step + 9.52, 6.56, 2.62] },
  })
  return {
    bounds: { min: [-3.23, -6.56, -3.5], max: [29 * step + 9.52, 6.56, 2.62] },
    parts,
    stones: [],
  }
}

const setup = (camera: unknown) =>
  RenderSceneSchema.parse({ camera, includeUnassignedRhino: true, importedBodyLook: 'source' })

describe('initial views of long imported setting rows', () => {
  it.each(['hero', 'macro'] as const)('%s makes the original middle stone legible', (preset) => {
    const subject = straightSettings()
    const scene = setup({ preset, focalLength: 90 })
    const camera = resolveScene(scene, subject).camera
    const halfWidth = 6.35 / 2
    const centreX = 15 * 6.52
    const l = projectPoint(camera, 1, [centreX - halfWidth, 0, 0])!
    const r = projectPoint(camera, 1, [centreX + halfWidth, 0, 0])!
    expect(camera.elevation).toBeGreaterThan(45)
    expect(camera.target[0]).toBeCloseTo(centreX, -1)
    expect(Math.abs(r[0] - l[0])).toBeGreaterThan(0.17)
    expect(shotFraming(scene, subject)).toMatchObject({ ok: true, subject: 'setting detail' })
  })

  it('uses the same Hero preset when the assistant suggests a shot', () => {
    const subject = straightSettings()
    const recipe = shotVocabulary('bracelet', true, true)[0]!
    expect(recipe.key).toBe('hero')
    const suggested = placeShot(recipe, subject, 1)
    const resolved = resolveScene(setup(suggested), subject).camera
    expect(resolved).toEqual(
      resolveScene(setup({ preset: 'hero', focalLength: recipe.focalLength }), subject).camera,
    )
  })

  it('leaves whole-model views, a locked Hero, and a custom pose in place', () => {
    const subject = straightSettings()
    const hero = resolveScene(setup({ preset: 'hero', focalLength: 90 }), subject).camera
    for (const preset of ['front', 'top'] as const) {
      const scene = setup({ preset, focalLength: 90 })
      expect(resolveScene(scene, subject).camera.distance).toBeGreaterThan(hero.distance * 3)
      expect(shotFraming(scene, subject).subject).toBe('piece')
    }
    expect(
      resolveScene(setup({ preset: 'hero', focalLength: 90, locked: true }), subject).camera
        .elevation,
    ).toBe(24)
    const target = [20, 0, 0]
    const camera = resolveScene(
      setup({ preset: 'custom', position: [20, -80, 40], target }),
      subject,
    ).camera
    expect(camera.target).toEqual(target)
    expect(camera.distance).toBeCloseTo(Math.hypot(80, 40))
  })

  it('follows a row rotated in the CAD ground plane', () => {
    const subject = straightSettings()
    const turn = ({ min, max }: SceneSubject['bounds']): SceneSubject['bounds'] => ({
      min: [-max[1], min[0], min[2]],
      max: [-min[1], max[0], max[2]],
    })
    const rotated = {
      ...subject,
      bounds: turn(subject.bounds),
      parts: subject.parts.map((part) => ({ ...part, bounds: turn(part.bounds) })),
    }
    const scene = setup({ preset: 'hero' })
    const camera = resolveScene(scene, rotated).camera
    expect(camera.azimuth).toBeCloseTo(105)
    expect(camera.target[1]).toBeCloseTo(15 * 6.52, -1)
    expect(shotFraming(scene, rotated)).toMatchObject({ ok: true, subject: 'setting detail' })
  })

  it('keeps the Hero of compact imports and authored pieces at its original angle', () => {
    const scene = setup({ preset: 'hero' })
    const compact = straightSettings(0.5)
    expect(resolveScene(scene, compact).camera.elevation).toBe(24)
    expect(resolveScene(scene, ring).camera.elevation).toBe(24)
  })
})
