/**
 * A casino die with rounded edges and domed pip recesses, 5 toward the viewer (−Y), 3 on top,
 * opposite faces summing to seven like a real die. 16 mm; meshBody rescales it.
 */
import type { Manifold } from 'manifold-3d'
import type { Vec3 } from '../geometry/vec'
import { runtime } from '../runtime/index'

const SIZE = 16
/** Edge rounding radius and pip size as shares of the die. */
const ROUND = 0.12
const PIP = 0.09
const PIP_DEPTH = 0.45

/** Pip positions on a face, in face units −1…1. */
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
}

/** Faces: outward normal and the two in-face axes. */
const FACES: { value: number; n: Vec3; u: Vec3; v: Vec3 }[] = [
  { value: 5, n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { value: 2, n: [0, 1, 0], u: [-1, 0, 0], v: [0, 0, 1] },
  { value: 3, n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { value: 4, n: [0, 0, -1], u: [1, 0, 0], v: [0, -1, 0] },
  { value: 1, n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { value: 6, n: [-1, 0, 0], u: [0, -1, 0], v: [0, 0, 1] },
]

export function dice(): Manifold {
  const { manifold: mf } = runtime()
  const h = SIZE / 2
  const r = SIZE * ROUND
  // Rounded cube: the hull of eight corner spheres.
  const corner = mf.Manifold.sphere(r, 48)
  const corners: Manifold[] = []
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) corners.push(corner.translate([x * (h - r), y * (h - r), z * (h - r)]))
  const cube = mf.Manifold.hull(corners)
  const pipRadius = SIZE * PIP
  const pip = mf.Manifold.sphere(pipRadius, 32)
  const pips: Manifold[] = []
  const spread = SIZE * 0.26
  for (const face of FACES)
    for (const [a, b] of PIPS[face.value]!) {
      const centre: Vec3 = [0, 1, 2].map((k) => face.n[k]! * (h + pipRadius * (1 - 2 * PIP_DEPTH)) + face.u[k]! * a * spread + face.v[k]! * b * spread) as unknown as Vec3
      pips.push(pip.translate([centre[0], centre[1], centre[2]]))
    }
  const tool = mf.Manifold.union(pips)
  try {
    return cube.subtract(tool)
  } finally {
    for (const m of [corner, ...corners, cube, pip, ...pips, tool]) m.delete()
  }
}
