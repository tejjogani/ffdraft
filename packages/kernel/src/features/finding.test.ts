import { designFrom, type NodeInput } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectivityChecks } from '../dfm/connectivity'
import { DEFAULT_PROFILE } from '../dfm/profile'
import { createKernel, type LocalKernel } from '../kernel'

let kernel: LocalKernel
beforeAll(() => {
  kernel = createKernel()
})
afterAll(() => kernel.dispose())

const disc: NodeInput = {
  id: 'disc',
  kind: 'primitive',
  name: 'Disc',
  shape: 'cylinder',
  size: [10, 10, 1.5],
  transform: { position: [0, 0, 0], rotation: [90, 0, 0], scale: 1 },
}

describe('finding', () => {
  it('earring post: exact, notched, on the back centre of its host and fused to it', async () => {
    const scene = await kernel.scene(
      designFrom('earrings', [
        disc,
        { id: 'post', kind: 'finding', type: 'earringPost', host: 'disc' },
      ]),
      {
        detail: 'production',
      },
    )
    const post = scene.nodes.get('post')!
    const solid = post.bodies[0]!.solid
    expect(solid.exact).toBe(true)
    const box = solid.bounds()
    // Back of a piece facing −Y is +Y; the disc's back face is at y = 0.75.
    expect(box.min[1]).toBeCloseTo(0.75 - 0.3, 2)
    expect(box.max[1]).toBeCloseTo(0.75 + 10, 2)
    expect((box.min[0] + box.max[0]) / 2).toBeCloseTo(0, 4)
    // Less than a plain 0.8 mm rod: the notch and the domed tip take some away.
    expect(solid.volume()).toBeLessThan(Math.PI * 0.4 ** 2 * 10.3)
    expect(solid.volume()).toBeGreaterThan(Math.PI * 0.4 ** 2 * 9.8)
    expect(scene.evaluation.parts).toHaveLength(1)
    expect(connectivityChecks(scene, DEFAULT_PROFILE)).toEqual([])
  })

  it('butterfly: stock size, on the notch of the post it rides on', async () => {
    for (const length of [6, 14]) {
      const scene = await kernel.scene(
        designFrom('earrings', [
          disc,
          { id: 'post', kind: 'finding', type: 'earringPost', host: 'disc', length },
          // The schema's default length (10) gives a stock 5.5 mm back.
          { id: 'back', kind: 'finding', type: 'butterfly', host: 'post' },
        ]),
        { detail: 'production' },
      )
      const box = scene.nodes.get('back')!.bodies[0]!.solid.bounds()
      // The post's tip is `length` behind the disc's back (y = 0.75); its notch 2 mm short of it.
      expect(box.min[1]).toBeCloseTo(0.75 + length - 2, 1)
      expect(box.max[0] - box.min[0]).toBeCloseTo(5.5, 1)
      // A butterfly is a separate part by nature, not loose metal.
      expect(connectivityChecks(scene, DEFAULT_PROFILE)).toEqual([])
    }
    // On a piece with no post: where a stock 10 mm post's notch would be.
    const alone = await kernel.scene(
      designFrom('earrings', [
        disc,
        { id: 'back', kind: 'finding', type: 'butterfly', host: 'disc' },
      ]),
    )
    expect(alone.nodes.get('back')!.bodies[0]!.solid.bounds().min[1]).toBeCloseTo(0.75 + 8, 1)
  })

  it('butterfly: cast on its own, clear of a matching post, its span set by its length', async () => {
    // On a 0.8 mm post (the default butterfly's own wire): a separate casting, not fused on.
    const scene = await kernel.scene(
      designFrom('earrings', [
        disc,
        { id: 'post', kind: 'finding', type: 'earringPost', host: 'disc', wire: 0.8 },
        { id: 'back', kind: 'finding', type: 'butterfly', host: 'post' },
      ]),
      { detail: 'production' },
    )
    const post = scene.nodes.get('post')!.bodies[0]!.solid.manifold(scene.quality)
    const back = scene.nodes.get('back')!.bodies[0]!.solid.manifold(scene.quality)
    expect(post.minGap(back, 1)).toBeGreaterThan(0.02)
    expect(scene.evaluation.parts).toHaveLength(2)
    // Every length from 2 mm does something (2 to 7.3 mm used to give the same 4 mm back).
    const span = async (length: number) => {
      const s = await kernel.scene(
        designFrom('earrings', [{ id: 'f', kind: 'finding', type: 'butterfly', length }]),
      )
      const box = s.nodes.get('f')!.bodies[0]!.solid.bounds()
      return box.max[0] - box.min[0]
    }
    const [two, six, ten] = [await span(2), await span(6), await span(10)]
    expect(two).toBeLessThan(4.3)
    expect(six).toBeGreaterThan(two + 0.5)
    expect(ten).toBeGreaterThan(six + 0.5)
  })

  it('a clasp too short for its wire thins the wire and says so', async () => {
    const e = await kernel.evaluate(
      designFrom('pendant', [
        { id: 'clasp', kind: 'finding', type: 'lobsterClasp', length: 2, wire: 2 },
      ]),
      { detail: 'production' },
    )
    expect(e.parts).toHaveLength(1)
    expect(e.diagnostics.map((d) => d.code)).toContain('finding.wireThinned')
  })

  it('jump ring and lobster clasp stand on top of the host and publish their openings', async () => {
    const scene = await kernel.scene(
      designFrom('pendant', [
        disc,
        { id: 'ring', kind: 'finding', type: 'jumpRing', host: 'disc', length: 5, wire: 0.8 },
        { id: 'clasp', kind: 'finding', type: 'lobsterClasp', length: 12, wire: 0.8 },
      ]),
      { detail: 'production' },
    )
    const ring = scene.nodes.get('ring')!
    expect(ring.frames.opening!.z).toEqual([1, 0, 0])
    expect(ring.bodies[0]!.solid.bounds().min[2]).toBeCloseTo(5 - 0.3, 2)
    const clasp = scene.nodes.get('clasp')!.bodies[0]!.solid
    const box = clasp.bounds()
    expect(box.max[2] - box.min[2]).toBeCloseTo(12, 0)
    expect(clasp.volume()).toBeGreaterThan(20)
    expect(connectivityChecks(scene, DEFAULT_PROFILE)).toEqual([])
  })
})
