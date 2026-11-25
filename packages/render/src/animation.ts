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

const key = (frame: number, value: number, e: Ease = 'easeInOut'): Keyframe => ({
  frame,
  value,
  ease: e,
})

/** Rack focus at f/2.8 unless the scene chose an aperture (research §3). */
export const RACK_FOCUS_FSTOP = 2.8

/** Whether a motion loops: a turntable always; anything else when asked (it goes and comes back). */
export function loops(animation: Pick<NonNullable<RenderScene['animation']>, 'type' | 'loop'>) {
  return animation.type === 'turntable' || animation.loop === true
}

/**
 * A move from `a` to `b` over the take. Looping, it goes there by the middle and comes back by
 * frame n, which equals frame 0 and is not rendered, so the video loops without a jump.
 */
function move(n: number, a: number, b: number, loop: boolean, e: Ease = 'easeInOut'): Keyframe[] {
  if (!loop) return [key(0, a, e), key(n - 1, b, e)]
  const mid = Math.round(n / 2)
  return [key(0, a, e), key(mid, b, e), key(n, a, e)]
}

export function resolveAnimation(
  animation: NonNullable<RenderScene['animation']>,
  camera: ResolvedCamera,
  rigRotation: number,
  radius: number,
): ResolvedAnimation {
  const fps = animation.fps
  const n = Math.max(2, Math.round(animation.seconds * fps))
  const tracks: Partial<Record<TrackTarget, Keyframe[]>> = {}
  const loop = loops(animation)
  switch (animation.type) {
    // 360° linear; the key at frame n equals frame 0, which is not rendered — a seamless loop.
    case 'turntable':
      tracks.pieceRotation = [key(0, 0, 'linear'), key(n, 360, 'linear')]
      break
    // Half way round, through the shot's own angle: from one profile to the other.
    case 'half-orbit':
      tracks.cameraAzimuth = move(n, camera.azimuth - 90, camera.azimuth + 90, loop)
      break
    case 'orbit-arc':
      tracks.cameraAzimuth = move(n, camera.azimuth - 30, camera.azimuth + 30, loop)
      break
    // The light turns, the piece and camera stay: sparkle walks across the stones.
    case 'light-sweep':
      tracks.rigRotation = move(n, rigRotation, rigRotation + 120, loop)
      break
    case 'push-in':
      tracks.cameraDistance = move(n, camera.distance * 1.35, camera.distance, loop)
      break
    // Close in and drift across the stone: a slow push with a small sideways arc.
    case 'macro-sweep':
      tracks.cameraDistance = move(n, camera.distance * 1.25, camera.distance * 0.95, loop)
      tracks.cameraAzimuth = move(n, camera.azimuth - 15, camera.azimuth + 15, loop)
      break
    // Hold on the near side (prongs), travel, hold on the far side (band).
    case 'rack-focus': {
      const near = Math.max(1, camera.focusDistance - radius * 0.6)
      const far = camera.focusDistance + radius * 0.6
      const a = Math.round(n * 0.2)
      const b = Math.round(n * 0.8)
      tracks.focusDistance = loop
        ? [
            key(0, near, 'linear'),
            key(a, near),
            key(Math.round(n / 2), far),
            key(b, far),
            key(n, near),
          ]
        : [key(0, near, 'linear'), key(a, near), key(b, far, 'linear'), key(n - 1, far)]
      break
    }
  }
  return { fps, frameCount: n, loop, tracks }
}
