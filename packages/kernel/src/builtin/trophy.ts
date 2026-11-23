/**
 * The classic two-handled loving cup on a stepped plinth — the founder's test case. Proportions
 * follow trade trophies: a cup about half the height, handles reaching ~1.4× the cup radius,
 * a plinth a little wider than the mouth. Built at ~39 mm tall; meshBody rescales it.
 */
import type { Manifold } from 'manifold-3d'
import { runtime } from '../runtime/index'
import { bezierTube, chamferedBlock, lathe } from './lathe'

/** Foot, stem with knop and collar, bowl with a raised band, rolled lip, dished top: (r, z) in mm. */
const CUP_PROFILE = `
  M 0 7.4 L 6.6 7.4 L 6.6 8.3
  C 6.6 8.8 6.2 9.0 5.6 9.2
  C 3.6 9.9 1.8 11.1 1.8 12.8
  L 1.8 13.3 C 3.3 13.5 3.3 16.1 1.8 16.3
  L 1.8 16.8 L 2.7 16.9 L 2.7 17.5 L 2.1 17.6
  C 4.6 17.8 9.0 20.4 9.2 25.4
  L 9.25 26.5 L 9.8 26.7 L 9.8 27.9 L 9.3 28.1
  C 9.55 32.0 10.1 35.0 10.6 37.0
  C 11.5 37.0 11.6 38.5 10.9 38.7
  L 10.1 38.7 C 7.0 38.3 3.0 38.1 0 38.1 Z`

/** Stepped plinth: [width, height, top chamfer] from the bottom up. */
const PLINTH: readonly [number, number, number][] = [
  [23, 3.6, 0.5],
  [19, 2.9, 0.4],
  [15.5, 0.9, 0.25],
]

export function trophy(): Manifold {
  const { manifold: mf } = runtime()
  const parts: Manifold[] = [lathe(CUP_PROFILE, 160)]
  let z = 0
  for (const [w, h, c] of PLINTH) {
    parts.push(chamferedBlock([w, w, h], z, c))
    z += h
  }
  // Ear handles: rooted inside the wall under the lip, swelling out past the bowl and returning
  // into its lower belly, slightly heavier at the top where they are held.
  for (const side of [-1, 1]) {
    const x = (v: number) => side * v
    parts.push(
      bezierTube(
        [
          [x(9.6), 0, 34.6],
          [x(17.2), 0, 37.4],
          [x(17.6), 0, 24.6],
          [x(8.6), 0, 22.4],
        ],
        1.2,
        0.85,
      ),
    )
  }
  try {
    return mf.Manifold.union(parts)
  } finally {
    for (const p of parts) p.delete()
  }
}
