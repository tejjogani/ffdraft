import { applyOps, type Design, designFrom, parseDesignDocument } from '@pave/schema'
import { afterAll, expect, it } from 'vitest'
import { readRhino3dm } from '../import/rhino'
import { createKernel } from '../kernel'
import type { StoneInstance } from '../types'

const kernel = createKernel()
afterAll(() => kernel.dispose())

const rowDesign = () =>
  designFrom('ring', [
    { id: 'band', kind: 'ringShank', widthTop: 4, widthBottom: 4 },
    { id: 'row', kind: 'gemRow', host: 'band', coverage: 50, stoneWidth: 1.3, skipCenter: 0 },
  ])
const haloDesign = () =>
  designFrom('ring', [
    { id: 'center', kind: 'gem', width: 5 },
    { id: 'row', kind: 'halo', around: 'center' },
  ])
const paveDesign = () =>
  designFrom('pendant', [
    {
      id: 'bar',
      kind: 'vectorBody',
      source: { type: 'svg', d: 'M0 0 H3 V9 H0 Z' },
      height: 9,
      thickness: 2.5,
      bevel: 'flat',
      bevelSize: 0,
    },
    { id: 'row', kind: 'pave', host: 'bar', sizeMax: 1.8, sizeMin: 1.8 },
  ])

const patchRow = (design: Design, patch: Record<string, unknown>) =>
  applyOps(design, [{ t: 'update', id: 'row', patch }], { checkRequestedFields: true })
const displacementMm = [0.125, -0.2, 0.35]
const moveStone = (design: Design, key: string, offset: number[] | null = displacementMm) =>
  patchRow(design, { stoneOffsetsMm: { [key]: offset } })

function translated(before: StoneInstance, after: StoneInstance) {
  expect(after.id).toBe(before.id)
  expect(after.placementId).toBe(before.placementId)
  expect(after.matrix.slice(0, 12)).toEqual(before.matrix.slice(0, 12))
  const delta = displacementMm.map((_, i) => after.matrix[i + 12]! - before.matrix[i + 12]!)
  for (const [i, mm] of displacementMm.entries()) expect(delta[i]).toBeCloseTo(mm, 8)
}

function glbNodes(bytes: Uint8Array): { name: string; matrix?: number[] }[] {
  const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true)
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))).nodes
}

it.each([
  ['stone row', rowDesign],
  ['halo', haloDesign],
  ['pavé', paveDesign],
] as const)(
  'translates a single %s stone in CAD and in the GLB export',
  async (_, makeDesign) => {
    const base = makeDesign()
    const before = await kernel.evaluate(base)
    const picked = before.stones.filter((stone) => stone.nodeId === 'row')[1]!
    expect(picked?.placementId).toMatch(/^s[0-9a-z]{1,11}$/)
    const moved = moveStone(base, picked.placementId!)
    const reloaded = parseDesignDocument(JSON.parse(JSON.stringify(moved.design)))
    const after = await kernel.evaluate(reloaded)
    translated(picked, after.stones.find((stone) => stone.id === picked.id)!)
    expect(after.stones.filter((stone) => stone.id !== picked.id)).toEqual(
      before.stones.filter((stone) => stone.id !== picked.id),
    )
    expect(after.report.caratTotal).toBe(before.report.caratTotal)
    expect((await kernel.evaluate(applyOps(reloaded, moved.inverse).design)).stones).toEqual(
      before.stones,
    )
    expect(
      (await kernel.evaluate(moveStone(reloaded, picked.placementId!, null).design)).stones,
    ).toEqual(before.stones)

    const production = async (design: Design) => {
      const { evaluation, nodes } = await kernel.scene(design, { detail: 'production' })
      const row = nodes.get('row')!
      const metal = [...row.cuts, ...row.additions, ...row.bodies].map(({ solid }) =>
        solid.triangles(),
      )
      return { evaluation, metal }
    }
    const ref = await production(base)
    const prod = await production(reloaded)
    expect(ref.metal.length).toBeGreaterThan(0)
    expect(prod.metal).toEqual(ref.metal)
    expect(prod.evaluation.report.metalMassG).toBeCloseTo(ref.evaluation.report.metalMassG, 8)
    expect(prod.evaluation.diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: 'row', code: 'stone.offsetSeating', level: 'warning' }),
    )
    translated(
      ref.evaluation.stones.find((stone) => stone.id === picked.id)!,
      prod.evaluation.stones.find((stone) => stone.id === picked.id)!,
    )
    const glb = await kernel.export(reloaded, 'glb')
    expect(
      glbNodes(glb.bytes)
        .find((node) => node.name === picked.id)
        ?.matrix?.slice(12, 15),
    ).toEqual(prod.evaluation.stones.find((stone) => stone.id === picked.id)!.matrix.slice(12, 15))
    expect(glb.notes).toEqual(expect.arrayContaining([expect.stringMatching(/shared metal stay/)]))
  },
  30_000,
)

it('keeps a missing row placement dormant and restores it when that slot returns', async () => {
  const base = rowDesign()
  const before = await kernel.evaluate(base)
  const removed = before.stones[0]!
  expect(removed.placementId).toMatch(/^s[0-9a-z]{1,11}$/)
  const moved = moveStone(base, removed.placementId!).design
  const smaller = patchRow(moved, { coverage: 10 })
  const regenerated = await kernel.evaluate(smaller.design)
  expect(regenerated.stones).toHaveLength(1)
  expect(regenerated.stones[0]?.id).toBe(removed.id)
  expect(regenerated.stones[0]?.placementId).not.toBe(removed.placementId)
  expect(regenerated.stones).toEqual(
    (await kernel.evaluate(patchRow(base, { coverage: 10 }).design)).stones,
  )
  expect(regenerated.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'stone.offsetDormant', nodeId: 'row' }),
  )
  const restored = await kernel.evaluate(applyOps(smaller.design, smaller.inverse).design)
  translated(removed, restored.stones[0]!)
})

it('uses model axes and millimetres after applying the array node transform', async () => {
  const base = rowDesign()
  const before = await kernel.evaluate(base)
  const picked = before.stones[0]!
  expect(picked.placementId).toMatch(/^s[0-9a-z]{1,11}$/)
  const transform = { position: [1, 2, 3], rotation: [30, 40, 15], scale: 1.5 }
  const nominal = await kernel.evaluate(patchRow(base, { transform }).design)
  const moved = await kernel.evaluate(
    patchRow(moveStone(base, picked.placementId!).design, { transform }).design,
  )
  translated(nominal.stones[0]!, moved.stones[0]!)
})

it('writes the displaced stone in Rhino model millimetres', async () => {
  const base = rowDesign()
  const [picked] = (await kernel.evaluate(base)).stones
  const bounds = async (design: Design) => {
    const result = await kernel.export(design, '3dm', { stones: true })
    const read = await readRhino3dm(result.bytes)
    return read.objects.find((obj) => obj.objectName === `Diamond ${picked!.id}`)?.bounds
  }
  const before = await bounds(base)
  const after = await bounds(moveStone(base, picked!.placementId!).design)
  expect(before).toBeDefined()
  expect(after).toBeDefined()
  for (const [i, mm] of displacementMm.entries()) {
    expect(after!.min[i]! - before!.min[i]!).toBeCloseTo(mm, 5)
    expect(after!.max[i]! - before!.max[i]!).toBeCloseTo(mm, 5)
  }
}, 30_000)
