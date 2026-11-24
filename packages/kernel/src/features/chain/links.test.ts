import { designFrom } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { QUALITY } from '../../core'
import { createKernel, type LocalKernel } from '../../kernel'
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
})
