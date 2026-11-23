/**
 * Animation recipes (research §3 "Animation") compiled to explicit keyframes, and the sampler
 * the real-time preview uses. Easing is Penner's cubic family, which is exactly what Blender's
 * CUBIC interpolation with EASE_IN / EASE_OUT / EASE_IN_OUT evaluates, so both renderers move
 * identically between keys.
 */
import type { RenderScene } from '@pave/schema'
import type { Ease, Keyframe, ResolvedAnimation, ResolvedCamera, TrackTarget } from './types'

export function ease(kind: Ease, t: number): number {
  switch (kind) {
    case 'linear':
      return t
    case 'easeIn':
      return t * t * t
    case 'easeOut':
      return 1 - (1 - t) ** 3
    case 'easeInOut':
      return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
  }
}

/** Value of a track at `frame`, holding the end values outside the keyed range. */
export function sampleTrack(keys: readonly Keyframe[], frame: number): number {
  const first = keys[0]
  if (!first) throw new Error('Empty animation track')
  if (frame <= first.frame) return first.value
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!
    if (frame <= b.frame) {
      const a = keys[i - 1]!
      return a.value + (b.value - a.value) * ease(a.ease, (frame - a.frame) / (b.frame - a.frame))
    }
  }
  return keys[keys.length - 1]!.value
}

const key = (frame: number, value: number, e: Ease = 'easeInOut'): Keyframe => ({ frame, value, ease: e })

/** Rack focus at f/2.8 unless the scene chose an aperture (research §3). */
export const RACK_FOCUS_FSTOP = 2.8

export function resolveAnimation(
  animation: NonNullable<RenderScene['animation']>,
  camera: ResolvedCamera,
  rigRotation: number,
  radius: number,
): ResolvedAnimation {
  const fps = animation.fps
  const n = Math.max(2, Math.round(animation.seconds * fps))
  const tracks: Partial<Record<TrackTarget, Keyframe[]>> = {}
  let loop = false
  switch (animation.type) {
    // 360° linear; the key at frame n equals frame 0, which is not rendered — a seamless loop.
    case 'turntable':
      tracks.pieceRotation = [key(0, 0, 'linear'), key(n, 360, 'linear')]
      loop = true
      break
    case 'orbit-arc':
      tracks.cameraAzimuth = [key(0, camera.azimuth - 30), key(n - 1, camera.azimuth + 30)]
      break
    case 'light-sweep':
      tracks.rigRotation = [key(0, rigRotation), key(n - 1, rigRotation + 120)]
      break
    case 'push-in':
      tracks.cameraDistance = [key(0, camera.distance * 1.35), key(n - 1, camera.distance)]
      break
    // Hold on the near side (prongs), travel, hold on the far side (band).
    case 'rack-focus': {
      const near = Math.max(1, camera.focusDistance - radius * 0.6)
      const far = camera.focusDistance + radius * 0.6
      const a = Math.round(n * 0.2)
      const b = Math.round(n * 0.8)
      tracks.focusDistance = [key(0, near, 'linear'), key(a, near), key(b, far, 'linear'), key(n - 1, far)]
      break
    }
  }
  return { fps, frameCount: n, loop, tracks }
}
