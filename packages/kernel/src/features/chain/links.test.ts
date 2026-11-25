import { designFrom } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { QUALITY } from '../../core'
import { multiply, translation } from '../../geometry/vec'
import { createKernel, type LocalKernel } from '../../kernel'
import { manifoldFromTriangles } from '../../solid/solid'
import { alongArc, clearance, linking, moveLoop } from './contact'
import { tennisLink } from './tennis'

let kernel: LocalKernel
beforeAll(() => {
  kernel = createKernel()
})
afterAll(() => kernel.dispose())

describe('box chain', () => {
  it.each([
    [3, 0.3],
    [5, 0.3],
    [8, 0.32],
    [25, 1],
  ])(
    'builds %d mm links of %d mm strip, as box chain is made, without stalling',
    async (w, wire) => {
      const started = performance.now()
      const scene = await kernel.scene(
        designFrom('chain', [
          {
            id: 'c',
            kind: 'chain',
            style: 'box',
            layout: 'straight',
            length: 100,
            linkWidth: w,
            wire,
          },
        ]),
        { detail: 'production' },
      )
      expect(performance.now() - started).toBeLessThan(5000)
      const result = scene.nodes.get('c')!
      expect(result.status).toBe('ok')
      // Neighbouring links never share metal.
      const links = result.bodies[0]!.solid.manifold(scene.quality).decompose()
      try {
        for (let i = 0; i + 1 < Math.min(links.length, 6); i++) {
          const shared = links[i]!.intersect(links[i + 1]!)
          expect(shared.volume()).toBeLessThan(1e-4)
          shared.delete()
        }
      } finally {
        for (const l of links) l.delete()
      }
    },
  )
})

describe('tennis link', () => {
  it('opens the gap between boxes with the link, so a 6 mm line drapes round a neck', () => {
    const small = tennisLink(3.4, 0.9, 'round')
    const large = tennisLink(6, 1.6, 'round')
    expect(large.minBend / 6).toBeLessThan(12)
    expect(small.minBend).toBeLessThan(40)
  })

  it.each([
    [3.4, 0.9],
    [2, 0.64],
    [6, 1.6],
  ])(
    'has no facets that collapse when written as float32 (STL), even 200 mm along a chain: %d mm',
    (width, wire) => {
      const m = tennisLink(width, wire, 'round').template.mesh(QUALITY.production)
      // Was 30 per link where prong wires ended on their tip balls and walls met the plate, then
      // about 5 per link of edges just over the slivers simplifying removes.
      for (const along of [0, 200]) {
        const p = new Float32Array(m.positions.length)
        for (let i = 0; i < p.length; i++) p[i] = m.positions[i]! + (i % 3 === 0 ? along : 0)
        const key = (i: number) => `${p[i * 3]},${p[i * 3 + 1]},${p[i * 3 + 2]}`
        let collapsed = 0
        for (let t = 0; t < m.indices.length; t += 3) {
          const [a, b, c] = [0, 1, 2].map((k) => key(m.indices[t + k]!))
          if (a === b || b === c || a === c) collapsed++
        }
        expect(collapsed, `${along} mm along`).toBe(0)
      }
    },
  )

  /** The next link round a wrist of radius r (stones outward), turning about height `pivot`. */
  const wrist = (pitch: number, r: number, pivot: number) => {
    const a = pitch / r
    const [c, n] = [Math.cos(a), Math.sin(a)]
    const arc = [c, 0, -n, 0, 0, 1, 0, 0, n, 0, c, 0, r * n, 0, r * (c - 1), 1]
    return multiply(translation([0, 0, pivot]), multiply(arc, translation([0, 0, -pivot])))
  }

  it.each<[number, number, string]>([
    [3.4, 0.88, 'round'],
    [4, 1, 'oval'],
    [5, 1.3, 'emerald'],
    [8, 2.08, 'round'],
  ])(
    'hinges a %d mm %s line flat under its boxes, threaded and clear straight, on the drape and round a wrist',
    (width, wire, cut) => {
      const link = tennisLink(width, wire, cut as never)
      expect(link.hinge.flat).toBe(true)
      const m = manifoldFromTriangles(link.template.mesh(QUALITY.draft))
      try {
        // The rings this replaces hung their own diameter under the boxes: a 3.4 mm line stood
        // 4.3 mm deep. Flat, the line is about as deep as it is wide.
        const box = m.boundingBox()
        expect(box.max[2] - box.min[2]).toBeLessThan(1.12 * (box.max[1] - box.min[1]))
        const poses = {
          straight: alongArc(link.pitch, Infinity),
          'drape, tightest bend': alongArc(link.pitch, link.minBend),
          'drape, other way': alongArc(link.pitch, -link.minBend),
          'round a 22 mm wrist': wrist(link.pitch, 22, link.hinge.pivot),
          'round a 30 mm wrist': wrist(link.pitch, 30, link.hinge.pivot),
        }
        for (const [name, pose] of Object.entries(poses)) {
          // Every staple of the next link holds the tongue (linking number ±1) without touching it.
          for (const loop of link.hinge.behind) {
            const staple = moveLoop(loop, pose)
            const [tongue] = link.hinge.ahead
            expect(Math.abs(linking(tongue!, staple)), name).toBeCloseTo(1, 1)
            expect(clearance(tongue!, staple), name).toBeGreaterThan(0.02)
          }
          // The hinge's metal never runs into the next link (round cuts: their boxes clear too).
          if (cut !== 'round' && name.startsWith('drape')) continue
          const next = m.transform(pose as never)
          const shared = m.intersect(next)
          try {
            expect(shared.volume(), name).toBeLessThan(1e-4)
          } finally {
            for (const x of [next, shared]) x.delete()
          }
        }
      } finally {
        m.delete()
      }
    },
  )

  it('keeps the ring hinge on links too narrow to carry staples beside the light hole', () => {
    const link = tennisLink(2, 0.64, 'round')
    expect(link.hinge.flat).toBe(false)
    const [ring] = link.hinge.ahead
    for (const pose of [alongArc(link.pitch, Infinity), alongArc(link.pitch, link.minBend)])
      expect(Math.abs(linking(ring!, moveLoop(link.hinge.behind[0]!, pose)))).toBeCloseTo(1, 1)
  })
})
