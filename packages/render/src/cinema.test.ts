import { type Design, QuickQuestionSchema, RenderSceneSchema, resolveAnswers } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { paveBar, solitaireRing } from '../fixtures'
import { loops, resolveAnimation, sampleTrack } from './animation'
import { resolveCamera } from './camera'
import {
  ASPECTS,
  type AspectKey,
  aspectOf,
  cinemaQuestions,
  MOTION_CHOICES,
  motionOf,
  outputSize,
  pieceFeatures,
  placeShot,
  shotFraming,
  shotVocabulary,
} from './cinema'
import { resolveScene } from './resolve'
import { subjectOf } from './subject'

const ring = subjectOf(solitaireRing())

const design = (nodes: Record<string, Record<string, unknown>>, kind: Design['kind'] = 'ring') =>
  ({ schemaVersion: 1, kind, nodes, order: Object.keys(nodes) }) as unknown as Design

const haloRing = design({
  shank: { id: 'shank', kind: 'ringShank', material: 'au18k-rose' },
  center: { id: 'center', kind: 'gem', cut: 'round', stone: 'diamond', width: 6.5 },
  head: { id: 'head', kind: 'setting', gem: 'center', style: 'basket' },
  halo: { id: 'halo', kind: 'halo', around: 'center' },
  row: { id: 'row', kind: 'gemRow', host: 'shank', setting: 'pave' },
  words: { id: 'words', kind: 'engraving' },
})

const sceneWith = (camera: unknown, aspect: AspectKey = '1:1') =>
  RenderSceneSchema.parse({ camera, output: { ...outputSize(aspect, 2000), quality: 'preview' } })

describe('what matters about a piece', () => {
  it('names the centre stone (with its weight), halo, pavé, engraving, gallery and metal', () => {
    const f = pieceFeatures(haloRing)
    expect(f.centreStoneNodeId).toBe('center')
    expect(f.halo && f.pave && f.engraving && f.gallery).toBe(true)
    expect(f.lines[0]).toMatch(/Centre stone: round brilliant diamond, 6.5 mm, about 1.02 ct/)
    expect(f.lines.join('\n')).toMatch(/basket and gallery rails/)
    expect(f.lines.join('\n')).toMatch(/18k Rose Gold/)
  })

  it('a plain band has no stone, so no macro shot is offered', () => {
    const f = pieceFeatures(design({ shank: { id: 'shank', kind: 'ringShank' } }))
    expect(f.centreStoneNodeId).toBeNull()
    expect(shotVocabulary('ring', false).map((s) => s.key)).not.toContain('macro')
    expect(shotVocabulary('ring').map((s) => s.key)).toEqual([
      'hero',
      'profile',
      'top',
      'macro',
      'low',
    ])
  })
})

describe('placing each camera', () => {
  for (const aspect of Object.keys(ASPECTS) as AspectKey[])
    it(`every ring shot frames well at ${aspect}`, () => {
      for (const recipe of shotVocabulary('ring')) {
        const camera = placeShot(recipe, ring, ASPECTS[aspect].ratio, 'center')
        const check = shotFraming(sceneWith(camera, aspect), ring)
        expect(check.problem, `${recipe.key} at ${aspect}`).toBeNull()
        expect(check.subject).toBe(recipe.frame === 'stone' ? 'centre stone' : 'piece')
        // The camera stands at the recipe's angle.
        const r = resolveCamera(sceneWith(camera, aspect).camera, ring, ASPECTS[aspect].ratio)
        expect(r.elevation).toBeCloseTo(recipe.elevation, 1)
      }
    })

  it('a macro aims at the centre stone and blurs the background; the rest may run out of frame', () => {
    const macro = shotVocabulary('ring').find((s) => s.key === 'macro')!
    const camera = placeShot(macro, ring, 1, 'center')
    expect(camera.focusNodeId).toBe('center')
    expect(camera.fStop).toBe(5.6)
    expect(camera.framedOn).toBeDefined()
    // The target sits on the stone (girdle at z ≈ 13.75 mm), not at the ring's middle.
    expect(camera.target![2]).toBeGreaterThan(12)
  })

  it('a placed camera fills the frame as the recipe asks', () => {
    const hero = shotVocabulary('ring')[0]!
    const check = shotFraming(sceneWith(placeShot(hero, ring, 1)), ring)
    expect(check.framing.fill).toBeGreaterThan(0.6)
    expect(check.framing.fill).toBeLessThan(0.72)
  })

  it('works for a flat pavé piece too', () => {
    const bar = subjectOf(paveBar())
    for (const recipe of shotVocabulary('brooch')) {
      const camera = placeShot(recipe, bar, 4 / 5)
      expect(shotFraming(sceneWith(camera, '4:5'), bar).problem, recipe.key).toBeNull()
    }
  })
})

describe('the framing check before render time is spent', () => {
  const hero = placeShot(shotVocabulary('ring')[0]!, ring, 1)

  it('catches a piece cut off, and says which edge and what to do', () => {
    const pan = {
      ...hero,
      target: [hero.target![0] + 25, hero.target![1], hero.target![2]] as const,
    }
    const moved = {
      ...pan,
      position: [hero.position![0] + 25, hero.position![1], hero.position![2]],
    }
    const check = shotFraming(sceneWith(moved), ring)
    expect(check.ok).toBe(false)
    expect(check.framing.verdict).toBe('cropped')
    expect(check.problem).toMatch(/cut off at the left/)
    expect(check.problem).toMatch(/farther back/)
  })

  it('catches a piece too small in the frame', () => {
    const far = sceneWith({ ...hero, focalLength: 35 })
    const check = shotFraming(far, ring)
    expect(check.ok).toBe(false)
    expect(check.problem).toMatch(/fills only \d+% of the frame: move about \d+% closer/)
  })

  it('a preset macro is judged on the centre stone, not the whole ring', () => {
    const check = shotFraming(sceneWith({ preset: 'macro', focalLength: 105 }), ring)
    expect(check.subject).toBe('centre stone')
    expect(check.ok).toBe(true)
  })
})

describe('motion', () => {
  const camera = resolveScene(sceneWith({ preset: 'hero', focalLength: 90 }), ring).camera

  it('the turntable loops seamlessly: the last key is frame n, which equals frame 0', () => {
    const a = resolveAnimation(motionOf('turntable', 24, 1), camera, 0, 10)
    expect(a.frameCount).toBe(24)
    expect(a.loop).toBe(true)
    const keys = a.tracks.pieceRotation!
    expect(sampleTrack(keys, 24) - sampleTrack(keys, 0)).toBe(360)
  })

  it('a looping half orbit goes round the front and comes back to where it started', () => {
    const a = resolveAnimation(motionOf('half-orbit', 30, 5), camera, 0, 10)
    const keys = a.tracks.cameraAzimuth!
    expect(sampleTrack(keys, 0)).toBeCloseTo(camera.azimuth - 90)
    expect(sampleTrack(keys, 75)).toBeCloseTo(camera.azimuth + 90)
    expect(sampleTrack(keys, a.frameCount)).toBeCloseTo(sampleTrack(keys, 0))
  })

  it('a push-in that does not loop ends on the last rendered frame', () => {
    const a = resolveAnimation({ ...motionOf('push-in'), loop: false }, camera, 0, 10)
    expect(a.loop).toBe(false)
    expect(sampleTrack(a.tracks.cameraDistance!, a.frameCount - 1)).toBeCloseTo(camera.distance)
  })

  it('a macro sweep moves closer and across; a sparkle pass turns only the light', () => {
    const m = resolveAnimation(motionOf('macro-sweep'), camera, 0, 10)
    expect(Object.keys(m.tracks).sort()).toEqual(['cameraAzimuth', 'cameraDistance'])
    const l = resolveAnimation(motionOf('light-sweep'), camera, 30, 10)
    expect(Object.keys(l.tracks)).toEqual(['rigRotation'])
    expect(l.loop).toBe(true)
  })

  it('only the turntable loops unless asked', () => {
    expect(loops({ type: 'turntable' })).toBe(true)
    expect(loops({ type: 'push-in' })).toBe(false)
    expect(loops({ type: 'push-in', loop: true })).toBe(true)
    expect(MOTION_CHOICES.map((m) => m.type)).toEqual([
      'turntable',
      'half-orbit',
      'push-in',
      'macro-sweep',
      'light-sweep',
      'orbit-arc',
      'rack-focus',
    ])
  })
})

describe('aspect ratios', () => {
  it('sizes are even, and read back as their aspect', () => {
    for (const k of Object.keys(ASPECTS) as AspectKey[]) {
      const { width, height } = outputSize(k, 1080)
      expect(width % 2).toBe(0)
      expect(height % 2).toBe(0)
      expect(aspectOf(width, height)).toBe(k)
    }
    expect(outputSize('9:16', 640)).toEqual({ width: 360, height: 640 })
  })
})

describe('the quick questions', () => {
  it('are valid quick questions, at most three, with defaults preselected', () => {
    const qs = cinemaQuestions(pieceFeatures(haloRing))
    expect(qs.length).toBeLessThanOrEqual(3)
    for (const q of qs) expect(QuickQuestionSchema.safeParse(q).success).toBe(true)
    expect(qs.map((q) => q.id)).toEqual(['purpose', 'aspects', 'motion'])
  })

  it('a sparkly piece defaults to a turntable and a sparkle pass; a solitaire to a turntable', () => {
    const halo = cinemaQuestions({ halo: true, pave: false, stones: 17 })
    expect(halo[2]!.defaults).toEqual(['turntable', 'light-sweep'])
    expect(cinemaQuestions({ halo: false, pave: false, stones: 1 })[2]!.defaults).toEqual([
      'turntable',
    ])
  })

  it('Go alone answers with the defaults; picks are cleaned', () => {
    const qs = cinemaQuestions({ halo: false, pave: false, stones: 1 })
    const go = resolveAnswers(qs, undefined)
    expect(go.answers.map((a) => a.chosen.map((c) => c.label))).toEqual([
      ['Product page on white'],
      ['1:1'],
      ['360° turntable, 6 s'],
    ])
    expect(go.answers.every((a) => a.default)).toBe(true)
    const picked = resolveAnswers(qs, {
      purpose: ['social', 'lookbook'],
      aspects: ['4x5', '9x16', 'nope', '4x5'],
      motion: [],
    })
    expect(picked.answers[0]!.chosen.map((c) => c.id)).toEqual(['social'])
    expect(picked.answers[1]!.chosen.map((c) => c.id)).toEqual(['4x5', '9x16'])
    expect(picked.answers[2]!.default).toBe(true)
  })

  it('a question whose default is not an option is refused', () => {
    const bad = { ...cinemaQuestions({ halo: false, pave: false, stones: 1 })[0]!, defaults: ['x'] }
    expect(QuickQuestionSchema.safeParse(bad).success).toBe(false)
  })
})
