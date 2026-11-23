import { designFrom, type NodeInput } from '@pave/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createKernel, type LocalKernel } from '../kernel'
import { manufacturabilityDiagnostics, profileWith } from './index'

let kernel: LocalKernel
beforeAll(() => {
  kernel = createKernel()
})
afterAll(() => kernel.dispose())

const at = (x: number, y: number, z: number) => ({
  position: [x, y, z] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  scale: 1,
})
const codesOf = async (nodes: NodeInput[], profile = profileWith({})) => {
  const scene = await kernel.scene(designFrom('other', nodes), { detail: 'production' })
  return manufacturabilityDiagnostics(scene, profile).map((d) => d.code)
}
const plate: NodeInput = {
  id: 'plate',
  kind: 'primitive',
  name: 'Plate',
  shape: 'box',
  size: [16, 2, 16],
}

describe('manufacturability checks', () => {
  it('flags wires below the profile minimums from node parameters', async () => {
    const codes = await codesOf([
      plate,
      { id: 'post', kind: 'finding', type: 'earringPost', host: 'plate', wire: 0.5 },
      {
        id: 'chain',
        kind: 'chain',
        style: 'cable',
        layout: 'straight',
        length: 100,
        linkWidth: 1.2,
        wire: 0.3,
      },
    ])
    expect(codes).toContain('post.thin')
    expect(codes).toContain('chain.fine')
  })

  it('checks the bail against the chain passing through it', async () => {
    const pendant = (opening: number, width: number) => [
      plate,
      { id: 'bail', kind: 'bail', host: 'plate', style: 'ring', opening, wire: 1.2 } as NodeInput,
      {
        id: 'chain',
        kind: 'chain',
        style: 'cuban',
        through: 'bail',
        linkWidth: width,
        wire: width * 0.28,
      } as NodeInput,
    ]
    const tight = await codesOf(pendant(5, 6))
    expect(tight).toContain('bail.small')
    expect(tight).toContain('chain.clash')
    const roomy = await codesOf(pendant(12, 4))
    expect(roomy).not.toContain('bail.small')
    expect(roomy).not.toContain('chain.clash')
  })

  it('finds a finding that does not touch its host', async () => {
    const codes = await codesOf([
      plate,
      {
        id: 'ring',
        kind: 'finding',
        type: 'jumpRing',
        host: 'plate',
        length: 4,
        wire: 0.8,
        transform: at(0, 0, 6),
      },
    ])
    expect(codes).toContain('metal.disconnected')
    expect(
      await codesOf([
        plate,
        { id: 'ring', kind: 'finding', type: 'jumpRing', host: 'plate', length: 4, wire: 0.8 },
      ]),
    ).not.toContain('metal.disconnected')
  })

  it('finds stones that collide or sit in metal without a seat', async () => {
    const codes = await codesOf([
      { id: 'a', kind: 'gem', width: 3, transform: at(0, 0, 20) },
      { id: 'b', kind: 'gem', width: 3, transform: at(2, 0, 20) },
      plate,
      { id: 'sunk', kind: 'gem', width: 2, transform: at(4, 0, 0) },
    ])
    expect(codes).toContain('stone.collision')
    expect(codes).toContain('stone.inMetal')
  })

  it('applies the profile’s casting limits', async () => {
    const codes = await codesOf([plate], profileWith({ maxTriangles: 4, envelope: [1, 1, 1] }))
    expect(codes).toContain('mesh.dense')
    expect(codes).toContain('piece.large')
    expect(await codesOf([plate])).toEqual([])
  })
})
