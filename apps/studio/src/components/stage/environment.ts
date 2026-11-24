/**
 * The viewport's version of the studio look. A photograph is taken from one known camera, so
 * its rig can use black cards for edge definition and a flag on the lens axis. An orbiting
 * viewport looks from everywhere: a pure black card then reads as black enamel on any flat,
 * polished face that happens to mirror it (a halo's top, a signet's face). Here no reflection
 * direction is darker than a soft grey, and the camera-following flag is dropped because it
 * would be fixed in the world while the camera moves.
 */
import type { ResolvedScene, Rgb } from '@pave/render'

/** Flags become this fraction of the brightest panel: dark enough to draw an edge, never black. */
const FLAG_FLOOR = 0.08
/** The dome never falls below this fraction of the brightest panel. */
const AMBIENT_FLOOR = 0.12

const peak = (c: Rgb) => Math.max(c[0], c[1], c[2])
const lift = (c: Rgb, min: number): Rgb => {
  const p = peak(c)
  if (p >= min) return c
  // Keep the panel's tint where it has one; a black flag becomes neutral grey.
  return p > 0 ? (c.map((v) => (v / p) * min) as Rgb) : [min, min, min]
}

export function viewportScene(resolved: ResolvedScene): ResolvedScene {
  const { rig } = resolved
  const key = Math.max(...rig.panels.map((p) => peak(p.radiance)), 1e-6)
  const flag = key * FLAG_FLOOR
  const dome = key * AMBIENT_FLOOR
  return {
    ...resolved,
    rig: {
      ...rig,
      panels: rig.panels
        .filter((p) => p.id !== 'lens-flag')
        .map((p) => ({ ...p, radiance: lift(p.radiance, flag) })),
      ambient: {
        zenith: lift(rig.ambient.zenith, dome),
        horizon: lift(rig.ambient.horizon, dome),
        nadir: lift(rig.ambient.nadir, dome),
      },
    },
  }
}
