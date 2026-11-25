/**
 * The adaptive quality controller: still pictures sharp (capped on Retina screens), moving
 * pictures following the measured frame time towards 30 fps, effects stepping down only past
 * the lowest pixel ratio, and the person's Performance mode respected throughout.
 */
import { describe, expect, it } from 'vitest'
import {
  type AdaptiveConfig,
  AdaptiveQuality,
  MIN_DPR,
  qualityState,
  RETINA_CAP,
  sameQuality,
  TARGET_FRAME_MS,
} from './adaptive'
import { gemQualityFor, qualityFor, tierOfName } from './quality'

const air: AdaptiveConfig = { mode: 'auto', deviceDpr: 2, tierMaxDpr: qualityFor('low').maxDpr }
const feed = (a: AdaptiveQuality, ms: number, n: number) => {
  let changed = 0
  for (let i = 0; i < n; i++) if (a.observe(ms)) changed++
  return changed
}

describe('still picture', () => {
  it('caps a Retina screen in Auto and draws a standard screen at its own ratio', () => {
    expect(new AdaptiveQuality(air).still()).toEqual({ dpr: RETINA_CAP, effects: 'full' })
    expect(new AdaptiveQuality({ ...air, deviceDpr: 1 }).still()).toEqual({
      dpr: 1,
      effects: 'full',
    })
    // A desktop GPU on a Retina screen: still capped, Sharp is the way to full density.
    expect(new AdaptiveQuality({ ...air, tierMaxDpr: 2 }).still().dpr).toBe(RETINA_CAP)
  })

  it('never goes above the GPU tier’s ceiling (software GL draws at 1)', () => {
    expect(new AdaptiveQuality({ ...air, tierMaxDpr: 1 }).still().dpr).toBe(1)
  })

  it('Sharp uses the screen’s own ratio up to 2; Smooth draws at 1 with lighter effects', () => {
    expect(new AdaptiveQuality({ ...air, mode: 'sharp' }).still()).toEqual({
      dpr: 2,
      effects: 'full',
    })
    expect(new AdaptiveQuality({ ...air, mode: 'sharp', deviceDpr: 3 }).still().dpr).toBe(2)
    expect(new AdaptiveQuality({ ...air, mode: 'smooth' }).still()).toEqual({
      dpr: 1,
      effects: 'reduced',
    })
  })
})

describe('moving picture', () => {
  it('starts at one pixel per CSS pixel in Auto, below the still picture', () => {
    expect(new AdaptiveQuality(air).moving()).toEqual({ dpr: 1, effects: 'full' })
  })

  it('drops the pixel ratio towards the frame-time target when frames are slow', () => {
    const a = new AdaptiveQuality(air)
    expect(a.observe(TARGET_FRAME_MS * 4)).toBe(true)
    // One slow frame never cuts more than 40 %.
    expect(a.moving().dpr).toBeGreaterThanOrEqual(0.6)
    feed(a, TARGET_FRAME_MS * 4, 1)
    expect(a.moving()).toEqual({ dpr: MIN_DPR, effects: 'full' })
  })

  it('steps the effects down only once the lowest pixel ratio is still too slow', () => {
    const a = new AdaptiveQuality(air)
    feed(a, 60, 2)
    expect(a.moving()).toEqual({ dpr: MIN_DPR, effects: 'full' })
    feed(a, 60, 3)
    expect(a.moving().effects).toBe('full')
    feed(a, 60, 1)
    expect(a.moving().effects).toBe('reduced')
    feed(a, 60, 4)
    expect(a.moving().effects).toBe('minimal')
    // The still picture is left alone until even the lightest moving picture cannot keep up.
    expect(a.still()).toEqual({ dpr: RETINA_CAP, effects: 'full' })
    feed(a, 60, 4)
    expect(a.still()).toEqual({ dpr: 1, effects: 'reduced' })
    expect(a.reduction().still).toBe(true)
  })

  it('climbs back slowly when frames are fast, never above the still picture', () => {
    const a = new AdaptiveQuality(air)
    feed(a, 60, 2)
    expect(a.moving()).toEqual({ dpr: MIN_DPR, effects: 'full' })
    feed(a, 5, 5)
    expect(a.moving().dpr).toBe(MIN_DPR)
    feed(a, 5, 1)
    expect(a.moving().dpr).toBeGreaterThan(MIN_DPR)
    feed(a, 5, 200)
    expect(a.moving().dpr).toBe(RETINA_CAP)
  })

  it('recovers the effects after a long run of fast frames', () => {
    const a = new AdaptiveQuality(air)
    feed(a, 60, 10)
    expect(a.moving().effects).toBe('minimal')
    feed(a, 5, 30)
    expect(a.moving().effects).toBe('reduced')
    feed(a, 5, 30)
    expect(a.moving().effects).toBe('full')
  })

  it('holds steady on frames near the target', () => {
    const a = new AdaptiveQuality(air)
    expect(feed(a, TARGET_FRAME_MS, 50)).toBe(0)
    expect(a.moving().dpr).toBe(1)
  })

  it('steps at once when frames are far too slow, without waiting for a run', () => {
    const a = new AdaptiveQuality(air)
    feed(a, 900, 2)
    expect(a.moving()).toEqual({ dpr: MIN_DPR, effects: 'full' })
    feed(a, 900, 1)
    expect(a.moving().effects).toBe('reduced')
    feed(a, 900, 1)
    expect(a.moving().effects).toBe('minimal')
  })

  it('lets the next view start where this one is, under the same settings only', () => {
    const a = new AdaptiveQuality(air)
    feed(a, 900, 4)
    const next = new AdaptiveQuality(air)
    next.adopt(a.learned())
    expect(next.moving()).toEqual({ dpr: MIN_DPR, effects: 'minimal' })
    const sharp = new AdaptiveQuality({ ...air, mode: 'sharp' })
    sharp.adopt(a.learned())
    expect(sharp.moving()).toEqual({ dpr: 2, effects: 'full' })
  })

  it('ignores gaps that are not frame times (a hidden tab, a long task)', () => {
    const a = new AdaptiveQuality(air)
    expect(a.observe(5000)).toBe(false)
    expect(a.observe(0)).toBe(false)
    expect(a.observe(Number.NaN)).toBe(false)
    expect(a.moving().dpr).toBe(1)
  })

  it('moves the pixel ratio in eighths, so tiny changes never reallocate the canvas', () => {
    const a = new AdaptiveQuality(air)
    a.observe(50)
    expect((a.moving().dpr * 8) % 1).toBe(0)
  })
})

describe('slow still frames', () => {
  it('asks for edits to draw light first once a still frame is slow, but never in Sharp', () => {
    const a = new AdaptiveQuality(air)
    expect(a.stillIsSlow()).toBe(false)
    a.observeStill(40)
    expect(a.stillIsSlow()).toBe(false)
    a.observeStill(400)
    expect(a.stillIsSlow()).toBe(true)
    const sharp = new AdaptiveQuality({ ...air, mode: 'sharp' })
    sharp.observeStill(400)
    expect(sharp.stillIsSlow()).toBe(false)
  })

  it('smooths the still frame time, so one slow frame among fast ones does not decide', () => {
    const a = new AdaptiveQuality(air)
    a.observeStill(30)
    a.observeStill(30)
    a.observeStill(150)
    expect(a.stillIsSlow()).toBe(false)
    a.observeStill(5000)
    expect(a.stillIsSlow()).toBe(false)
  })
})

describe('Performance modes', () => {
  it('Sharp never reduces, whatever the frame time', () => {
    const a = new AdaptiveQuality({ ...air, mode: 'sharp' })
    expect(feed(a, 500, 50)).toBe(0)
    expect(a.moving()).toEqual({ dpr: 2, effects: 'full' })
    expect(a.reduction()).toEqual({ still: false, moving: false })
  })

  it('Smooth keeps moving pictures at or below 0.75 with lighter effects', () => {
    const a = new AdaptiveQuality({ ...air, mode: 'smooth' })
    expect(a.moving()).toEqual({ dpr: 0.75, effects: 'reduced' })
    feed(a, 2, 300)
    expect(a.moving()).toEqual({ dpr: 0.75, effects: 'reduced' })
    expect(a.reduction()).toEqual({ still: true, moving: true })
  })

  it('forgets what it learned when the mode or the screen changes', () => {
    const a = new AdaptiveQuality(air)
    feed(a, 60, 20)
    expect(a.still().effects).toBe('reduced')
    a.configure({ ...air })
    expect(a.still().effects).toBe('reduced')
    a.configure({ ...air, mode: 'sharp' })
    a.configure({ ...air })
    expect(a.still()).toEqual({ dpr: RETINA_CAP, effects: 'full' })
    expect(a.moving().dpr).toBe(1)
  })

  it('reports a reduced still picture on a Retina screen in Auto, none on a standard one', () => {
    expect(new AdaptiveQuality(air).reduction().still).toBe(true)
    expect(new AdaptiveQuality({ ...air, deviceDpr: 1 }).reduction()).toEqual({
      still: false,
      moving: false,
    })
  })
})

describe('what the page shows', () => {
  it('asks for solid glass in Smooth, or once Auto had to lighten the effects; never in Sharp', () => {
    expect(qualityState(new AdaptiveQuality(air), true).solidGlass).toBe(false)
    expect(qualityState(new AdaptiveQuality({ ...air, mode: 'smooth' }), false).solidGlass).toBe(
      true,
    )
    const slow = new AdaptiveQuality(air)
    feed(slow, 900, 3)
    expect(qualityState(slow, false).solidGlass).toBe(true)
    const sharp = new AdaptiveQuality({ ...air, mode: 'sharp' })
    feed(sharp, 900, 10)
    expect(qualityState(sharp, true).solidGlass).toBe(false)
  })

  it('reports moving only while moving, and ignores frame-by-frame pixel ratio changes', () => {
    const a = new AdaptiveQuality(air)
    expect(qualityState(a, false).reducedNow).toBe(false)
    expect(qualityState(a, true).reducedNow).toBe(true)
    const before = qualityState(a, true)
    a.observe(50)
    const after = qualityState(a, true)
    expect(after.movingDpr).not.toBe(before.movingDpr)
    expect(sameQuality(before, after)).toBe(true)
  })
})

describe('GPU tiers and effects', () => {
  it('treats the base Apple M chips as integrated and their Pro/Max/Ultra siblings as not', () => {
    expect(tierOfName('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)')).toBe(
      'low',
    )
    expect(tierOfName('Apple GPU')).toBe('low')
    expect(tierOfName('ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified)')).toBe(
      'high',
    )
    expect(tierOfName('ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro)')).toBe('high')
    expect(tierOfName('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics)')).toBe('low')
    expect(tierOfName('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))')).toBe('software')
    expect(tierOfName('NVIDIA GeForce RTX 4070')).toBe('high')
  })

  it('lowers bounces for lighter effects without toggling dispersion until minimal', () => {
    const low = qualityFor('low')
    expect(gemQualityFor(low, 'full', false)).toBe(low.rest)
    const reduced = gemQualityFor(low, 'reduced', false)
    expect(reduced.hero).toEqual({ bounces: 2, dispersion: low.rest.hero.dispersion })
    expect(reduced.melee.bounces).toBe(1)
    expect(gemQualityFor(low, 'minimal', true).hero).toEqual({ bounces: 1, dispersion: false })
  })
})
