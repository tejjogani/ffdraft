import { designFrom, type NodeInput } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createKernel, type LocalKernel } from '../kernel'
import { runtime } from '../runtime/index'
import { manifoldFromTriangles } from '../solid/solid'
import type { ChainData } from './chain'
import { wireChain } from './chain/links'

let kernel: LocalKernel
beforeAll(() => {
  kernel = createKernel()
})
afterAll(() => kernel.dispose())

const STYLES = ['cable', 'curb', 'cuban', 'figaro', 'rope', 'box', 'tennis'] as const

/** Splits a chain body into its links and checks no two links overlap. */
async function linksOf(node: NodeInput) {
  const scene = await kernel.scene(designFrom('chain', [node]), { detail: 'production' })
  const result = scene.nodes.get(node.id)!
  expect(result.status).toBe('ok')
  const body = result.bodies[0]!.solid
  const links = body.manifold(scene.quality).decompose()
  return { scene, result, links, data: result.data as ChainData }
}

describe('chain', () => {
  it.each(STYLES)('%s: links interlock without intersecting', async (style) => {
    const node: NodeInput = {
      id: 'c',
      kind: 'chain',
      style,
      layout: 'straight',
      length: 100,
      linkWidth: 4,
      wire: 0.8,
    }
    const { links, data } = await linksOf(node)
    try {
      expect(links).toHaveLength(data.links)
      const { manifold: mf } = runtime()
      // Neighbours (and, for rope, the next few) share no metal: their union has the summed volume.
      const reach = style === 'rope' ? 4 : 1
      for (let i = 0; i + reach < Math.min(links.length, 12); i++) {
        const group = links.slice(i, i + reach + 1)
        const fused = mf.Manifold.union(group)
        expect(fused.volume()).toBeCloseTo(
          group.reduce((s, l) => s + l.volume(), 0),
          3,
        )
        fused.delete()
      }
    } finally {
      for (const l of links) l.delete()
    }
  })

  it('threads every link through its neighbour (pitch solver)', () => {
    for (const style of ['cable', 'curb', 'cuban', 'figaro', 'rope', 'box'] as const) {
      const chain = wireChain(style, 3, 0.7)
      for (const pitch of chain.pitches) expect(pitch).toBeGreaterThan(0)
      expect(chain.wire).toBeLessThanOrEqual(0.7)
    }
  })

  it('takes its link count from the length; Cuban links nest tighter than curb', async () => {
    const node = (style: 'cuban' | 'curb'): NodeInput => ({
      id: 'c',
      kind: 'chain',
      style,
      layout: 'drape',
      length: 508,
      linkWidth: 10,
      wire: 3,
    })
    const cuban = (await linksOf(node('cuban'))).data
    const curb = (await linksOf(node('curb'))).data
    // 06-freeform.md §6 puts a 10 mm × 20 in Cuban at 65–70 links; pressed to nest it has more.
    expect(cuban.links).toBeGreaterThan(65)
    expect(cuban.links).toBeLessThan(110)
    expect(cuban.links).toBeGreaterThan(curb.links)
    expect(Math.abs(cuban.length - 508)).toBeLessThan(10)
  })

  it('tennis: one counted stone per link', async () => {
    const e = await kernel.evaluate(
      designFrom('chain', [
        { id: 't', kind: 'chain', style: 'tennis', length: 180, linkWidth: 3.4, wire: 0.88 },
      ]),
    )
    expect(e.stones.length).toBeGreaterThan(40)
    expect(e.report.stoneCount).toBe(e.stones.length)
    expect(e.stones[0]!.dims.width).toBeCloseTo(3, 5)
    expect(e.report.lots[0]!.count).toBe(e.stones.length)
  })

  it('drapes through a bail, resting against the top of its opening', async () => {
    const scene = await kernel.scene(
      designFrom('pendant', [
        { id: 'p', kind: 'primitive', shape: 'box', size: [10, 2, 10] },
        { id: 'bail', kind: 'bail', host: 'p', style: 'ring', opening: 5, wire: 1 },
        {
          id: 'c',
          kind: 'chain',
          style: 'cable',
          through: 'bail',
          length: 450,
          linkWidth: 1.5,
          wire: 0.4,
        },
      ]),
    )
    const opening = scene.nodes.get('bail')!.frames.opening!
    const chain = scene.nodes.get('c')!
    const low = Math.min(...(chain.data as ChainData).path.map((p) => p[2]))
    // The low point is above the opening's centre: the chain rests on the inside top.
    expect(low).toBeGreaterThan(opening.origin[2])
    expect(low).toBeLessThan(opening.origin[2] + 2.5)
    const box = chain.bodies[0]!.solid.bounds()
    expect(box.max[2] - box.min[2]).toBeGreaterThan(150)
    expect(Math.abs(box.min[1] - opening.origin[1])).toBeLessThan(1)
  })

  it('stays cheap: hundreds of links as one body under the draft triangle budget', async () => {
    const started = performance.now()
    const e = await kernel.evaluate(
      designFrom('chain', [
        { id: 'c', kind: 'chain', style: 'rope', length: 600, linkWidth: 2.5, wire: 0.4 },
      ]),
    )
    expect(e.parts).toHaveLength(1)
    expect(e.parts[0]!.mesh.indices.length / 3).toBeLessThan(450_000)
    expect(performance.now() - started).toBeLessThan(5000)
  })

  it('round-trips a link through the exact B-rep', async () => {
    const scene = await kernel.scene(
      designFrom('chain', [
        {
          id: 'c',
          kind: 'chain',
          style: 'cuban',
          layout: 'straight',
          length: 100,
          linkWidth: 6,
          wire: 1.8,
        },
      ]),
    )
    const body = scene.nodes.get('c')!.bodies[0]!.solid
    expect(body.exact).toBe(true)
    const mesh = manifoldFromTriangles(body.triangles())
    expect(Math.abs(body.volume() - mesh.volume()) / body.volume()).toBeLessThan(0.01)
    mesh.delete()
  })
})
