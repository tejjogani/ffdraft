import { RenderSceneSchema } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SHOTS,
  draftOf,
  estimateTakeSeconds,
  machineTime,
  rateFrom,
  TYPICAL_RATE,
  takeWork,
} from './takes'

const scene = (output: { width: number; height: number; quality: 'preview' | 'standard' }) =>
  RenderSceneSchema.parse({ output })

describe('default shots', () => {
  it('gives every piece Hero, Front, Macro, and a top or profile view by its shape', () => {
    expect(DEFAULT_SHOTS('ring').map((s) => s.title)).toEqual(['Hero', 'Front', 'Top', 'Macro'])
    expect(DEFAULT_SHOTS('pendant').map((s) => s.title)).toEqual([
      'Hero',
      'Front',
      'Profile',
      'Macro',
    ])
    for (const s of DEFAULT_SHOTS('ring'))
      expect(RenderSceneSchema.safeParse(s.scene).success).toBe(true)
  })
})

describe('machine time', () => {
  it('counts the auto-tune draft as a second pass unless the draft is the take', () => {
    const big = scene({ width: 2000, height: 2000, quality: 'standard' })
    expect(takeWork(big, true).passes).toBe(2)
    expect(takeWork(big, false).passes).toBe(1)
    const small = draftOf(big)
    expect(takeWork(small, true).passes).toBe(1)
  })

  it('grows with size and quality, and is never under the fixed cost of starting Blender', () => {
    const rate = { ...TYPICAL_RATE, basis: 'typical' as const }
    const preview = estimateTakeSeconds(
      scene({ width: 512, height: 512, quality: 'preview' }),
      true,
      rate,
    )
    const standard = estimateTakeSeconds(
      scene({ width: 2000, height: 2000, quality: 'standard' }),
      true,
      rate,
    )
    expect(preview).toBeGreaterThanOrEqual(TYPICAL_RATE.passSeconds)
    expect(standard).toBeGreaterThan(preview * 10)
  })

  it('learns this machine’s rate from its finished takes, by the median', () => {
    const s = scene({ width: 768, height: 768, quality: 'preview' })
    const { work, passes } = takeWork(s, false)
    const at = (k: number) => ({
      scene: s,
      autoTune: false,
      seconds: passes * TYPICAL_RATE.passSeconds + work * k,
    })
    expect(rateFrom([at(0.5)]).basis).toBe('typical')
    const rate = rateFrom([at(0.2), at(0.3), at(9)])
    expect(rate.basis).toBe('measured')
    expect(rate.secondsPerWork).toBeCloseTo(0.3, 5)
  })

  it('counts a fixed cost per animation frame, matching a measured turntable', () => {
    const rate = { ...TYPICAL_RATE, basis: 'typical' as const }
    const turntable = RenderSceneSchema.parse({
      output: { width: 256, height: 256, quality: 'preview' },
      animation: { type: 'turntable', seconds: 1, fps: 24 },
    })
    expect(takeWork(turntable, false).frames).toBe(23)
    // Measured on the development machine: 81–94 s for this take.
    const seconds = estimateTakeSeconds(turntable, false, rate)
    expect(seconds).toBeGreaterThan(75)
    expect(seconds).toBeLessThan(100)
    // A still has no frame cost.
    expect(takeWork(scene({ width: 640, height: 640, quality: 'preview' }), false).frames).toBe(0)
  })

  it('learns from the device in use when it has two takes from it', () => {
    const s = scene({ width: 768, height: 768, quality: 'preview' })
    const { work, passes } = takeWork(s, false)
    const at = (k: number, device: string) => ({
      scene: s,
      autoTune: false,
      seconds: passes * TYPICAL_RATE.passSeconds + work * k,
      device,
    })
    const history = [at(0.1, 'METAL'), at(0.12, 'METAL'), at(0.8, 'CPU'), at(0.9, 'CPU')]
    expect(rateFrom(history, 'METAL').secondsPerWork).toBeCloseTo(0.11, 5)
    expect(rateFrom(history, 'CPU').secondsPerWork).toBeCloseTo(0.85, 5)
    // One take on a new device is not enough: every take counts until there are two.
    expect(rateFrom([...history, at(0.3, 'OPTIX')], 'OPTIX').secondsPerWork).toBeCloseTo(0.3, 5)
  })

  it('says machine time roughly, in words', () => {
    expect(machineTime(42)).toBe('about 40 s')
    expect(machineTime(390)).toBe('about 7 min')
    expect(machineTime(4800)).toBe('about 1 h 20 min')
  })
})
