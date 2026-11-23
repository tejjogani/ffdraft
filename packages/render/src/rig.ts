/** Freezes a look's camera-relative rig into explicit world-space emitters. */
import type { RenderScene } from '@pave/schema'
import { kelvinToRgb, mulRgb, type Rgb } from './color'
import type { Look, RigPanel } from './looks'
import { add, lookAtQuat, orbitDirection, scale, type Vec3 } from './math'
import type { ResolvedPanel, ResolvedRig, ResolvedSparkle } from './types'

const WHITE: Rgb = [1, 1, 1]

interface CameraAngles {
  azimuth: number
  elevation: number
}
const tint = (kelvin: number | undefined): Rgb => (kelvin ? kelvinToRgb(kelvin) : WHITE)

/** Golden-ratio sequence: an even, deterministic spread of sparkle elevations. */
const PHI = 0.6180339887

function panel(p: RigPanel, target: Vec3, radius: number, camera: CameraAngles, intensity: number): ResolvedPanel {
  const azimuth = camera.azimuth + p.azimuth
  const elevation = Math.min(90, p.elevation + (p.followCamera ? camera.elevation : 0))
  const position = add(target, scale(orbitDirection(azimuth, elevation), p.distance * radius))
  // Overhead panels have no "up"; orient their height edge away from the camera.
  const up: Vec3 = elevation > 85 ? orbitDirection(camera.azimuth + 180, 0) : [0, 0, 1]
  return {
    id: p.id,
    position,
    quaternion: lookAtQuat(position, target, up),
    size: [p.size[0] * radius, p.size[1] * radius],
    radiance: mulRgb(tint(p.kelvin), p.radiance * intensity),
    gradient: p.gradient ?? [1, 1],
  }
}

function sparkles(look: Look, target: Vec3, radius: number, cameraAzimuth: number, amount: number): ResolvedSparkle[] {
  const s = look.sparkle
  if (amount <= 0) return []
  const r = s.radius * radius
  // A disk of radius r and radiance L has intensity L·πr² along its axis.
  const intensity = s.radiance * Math.PI * r * r * amount
  return Array.from({ length: s.count }, (_, i) => {
    const azimuth = cameraAzimuth - s.spread / 2 + (s.spread * (i + 0.5)) / s.count
    const elevation = s.elevation[0] + (s.elevation[1] - s.elevation[0]) * ((i * PHI) % 1)
    return {
      position: add(target, scale(orbitDirection(azimuth, elevation), s.distance * radius)),
      radius: r,
      intensity: [intensity, intensity, intensity] as Rgb,
    }
  })
}

export function resolveRig(
  look: Look,
  environment: RenderScene['environment'],
  sparkleAmount: number,
  target: Vec3,
  radius: number,
  camera: CameraAngles,
): ResolvedRig {
  const k = environment.intensity
  const ambient = tint(look.ambient.kelvin)
  return {
    pivot: target,
    rotation: environment.rotation,
    panels: look.panels.map((p) => panel(p, target, radius, camera, k)),
    sparkles: sparkles(look, target, radius, camera.azimuth, sparkleAmount * k),
    ambient: {
      zenith: mulRgb(ambient, look.ambient.zenith * k),
      horizon: mulRgb(ambient, look.ambient.horizon * k),
      nadir: mulRgb(ambient, look.ambient.nadir * k),
    },
  }
}
