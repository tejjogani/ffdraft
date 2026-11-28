/** Ground and background resolution. */
import type { RenderScene } from '@pave/schema'
import { hexToRgb } from './color'
import {
  ACRYLIC_IOR,
  type Background,
  DEFAULT_GROUNDS,
  type GroundKind,
  type Look,
  WHITE_GLOSS_IOR,
} from './looks'
import { orbitDirection, type Vec3 } from './math'
import type { ResolvedGround } from './types'

/** Sweep proportions in piece radii: floor toward the camera, a cove, then the wall. */
const SWEEP = { front: 40, wallAt: 6, cove: 6, height: 50, width: 90, coveSegments: 16 }

function sweepProfile(radius: number): [number, number][] {
  const r = SWEEP.cove * radius
  const start = SWEEP.wallAt * radius
  const profile: [number, number][] = [[-SWEEP.front * radius, 0]]
  for (let i = 0; i <= SWEEP.coveSegments; i++) {
    const t = (i / SWEEP.coveSegments) * (Math.PI / 2)
    profile.push([start + r * Math.sin(t), r - r * Math.cos(t)])
  }
  profile.push([start + r, SWEEP.height * radius])
  return profile
}

export function resolveGround(
  choice: RenderScene['ground'],
  look: Look,
  floorZ: number,
  target: Vec3,
  radius: number,
  cameraAzimuth: number,
): ResolvedGround {
  const graded = choice === 'white-gloss-graded'
  const kind: GroundKind = graded ? 'white-gloss' : choice === 'look' ? look.ground.kind : choice
  const spec = look.ground.kind === kind ? look.ground : DEFAULT_GROUNDS[kind]
  switch (kind) {
    case 'none':
      return { kind }
    case 'shadow':
      return { kind, z: floorZ, size: radius * 30 }
    case 'sweep':
      return {
        kind,
        z: floorZ,
        azimuth: cameraAzimuth,
        center: [target[0], target[1], floorZ],
        profile: sweepProfile(radius),
        width: SWEEP.width * radius,
        color: spec.color,
        roughness: spec.roughness,
      }
    case 'reflective':
    case 'white-gloss': {
      const [x, y] = orbitDirection(cameraAzimuth + 90, 0)
      return {
        kind,
        z: floorZ,
        size: radius * 120,
        color: spec.color,
        roughness: spec.roughness,
        ior: kind === 'white-gloss' ? WHITE_GLOSS_IOR : ACRYLIC_IOR,
        ...(graded && {
          reflectionGrade: { axis: [x, y], halfWidth: radius * 0.22, low: 0.08, high: 1.14 },
        }),
      }
    }
  }
}

export function resolveBackground(env: RenderScene['environment'], look: Look): Background {
  switch (env.background) {
    case 'look':
      return look.background
    case 'transparent':
      return { kind: 'transparent' }
    case 'white':
      return { kind: 'solid', color: [1, 1, 1] }
    case 'black':
      return { kind: 'solid', color: [0, 0, 0] }
    case 'color':
      return env.color ? { kind: 'solid', color: hexToRgb(env.color) } : look.background
  }
}
