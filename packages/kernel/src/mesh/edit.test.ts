import { readEditableMesh } from '@pave/kernel/mesh-edit'
import { applyOps, designFrom, parseDesignDocument } from '@pave/schema'
import { afterAll, describe, expect, it } from 'vitest'
import { createKernel } from '../kernel'
import { boundsOfPositions, meshVolume } from '../solid/meshing'
import { parseMesh } from './parse/index'
import { writeStl } from './stl'
import { edgeTopology } from './topology'

const kernel = createKernel()
afterAll(() => kernel.dispose())

// 2 mm cube offset from the origin. STL repeats its eight source vertices across 12 triangles.
const cube = {
  positions: new Float32Array([
    3, 4, 5, 5, 4, 5, 5, 6, 5, 3, 6, 5, 3, 4, 7, 5, 4, 7, 5, 6, 7, 3, 6, 7,
  ]),
  indices: new Uint32Array([
    0, 3, 2, 0, 2, 1, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0,
    4, 3, 4, 7,
  ]),
}
const bytes = writeStl([cube], 'Measured cube fixture')
const assetId = 'cube'
const assets = async () => bytes
const top: Record<string, [number, number, number]> = {
  4: [3, 4, 7.75],
  5: [5, 4, 7.75],
  6: [5, 6, 7.75],
  7: [3, 6, 7.75],
}

describe('measured source edits through the kernel', () => {
  const original = designFrom('other', [
    {
      id: 'mount',
      kind: 'meshBody',
      source: { type: 'asset', assetId },
      keepSourcePlacement: true,
    },
  ])

  it('moves both top faces and all incident side triangles with no cracks or source byte changes', async () => {
    const savedBytes = bytes.slice()
    const { design, inverse } = applyOps(original, [
      { t: 'update', id: 'mount', patch: { meshEdits: { assetId, vertices: top } } },
    ])
    const reopened = parseDesignDocument(JSON.parse(JSON.stringify(design)))
    const edited = await kernel.evaluate(reopened, { assets })
    expect(edited.report.bounds).toEqual({ min: [3, 4, 5], max: [5, 6, 7.75] })
    expect(edited.report.metals[0]?.volumeMm3).toBeCloseTo(11, 6)
    expect(edited.diagnostics.some((d) => d.code === 'mesh.resurfaced')).toBe(false)

    const exported = await kernel.export(reopened, 'stl', { assets })
    const output = readEditableMesh(exported.bytes)
    expect(boundsOfPositions(output.positions)).toEqual({ min: [3, 4, 5], max: [5, 6, 7.75] })
    const vertices = (positions: Float32Array) =>
      Array.from({ length: positions.length / 3 }, (_, id) =>
        positions.slice(id * 3, id * 3 + 3).join(','),
      ).sort()
    expect(vertices(output.positions)).toEqual([
      '3,4,5',
      '3,4,7.75',
      '3,6,5',
      '3,6,7.75',
      '5,4,5',
      '5,4,7.75',
      '5,6,5',
      '5,6,7.75',
    ])
    expect(meshVolume(output)).toBeCloseTo(11, 6)
    expect(edgeTopology(output)).toMatchObject({ open: 0, nonManifold: 0, inconsistent: 0 })
    expect(bytes).toEqual(savedBytes)

    const restored = applyOps(reopened, inverse).design
    expect(restored).toEqual(original)
    const undo = await kernel.evaluate(restored, { assets })
    expect(undo.report.bounds).toEqual({ min: [3, 4, 5], max: [5, 6, 7] })
    expect(undo.report.metals[0]?.volumeMm3).toBeCloseTo(8, 6)
  })

  it('reports nonexistent source ids as a failed node instead of ignoring the edit', async () => {
    const { design } = applyOps(original, [
      {
        t: 'update',
        id: 'mount',
        patch: { meshEdits: { assetId, vertices: { 100000: [5, 6, 7] } } },
      },
    ])
    const evaluation = await kernel.evaluate(design, { assets })
    expect(evaluation.parts).toHaveLength(0)
    expect(evaluation.diagnostics).toContainEqual(
      expect.objectContaining({
        nodeId: 'mount',
        level: 'error',
        message: expect.stringMatching(/100000/),
      }),
    )
  })
})

describe('editable mesh model', () => {
  it('assigns ids at first triangle occurrence and leaves connectivity stable through edge edits', () => {
    const raw = readEditableMesh(bytes)
    expect(Array.from(raw.positions)).toEqual([
      3, 4, 5, 3, 6, 5, 5, 6, 5, 5, 4, 5, 3, 4, 7, 5, 4, 7, 5, 6, 7, 3, 6, 7,
    ])
    expect(Array.from(raw.indices.slice(0, 12))).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
    const edited = readEditableMesh(bytes, { 4: top[4]!, 5: top[5]! })
    expect(Array.from(edited.positions.slice(12, 18))).toEqual([3, 4, 7.75, 5, 4, 7.75])
    expect(edited.indices).toEqual(raw.indices)
    expect(edgeTopology(edited)).toMatchObject({ open: 0, nonManifold: 0, inconsistent: 0 })
    expect(parseMesh(bytes).mesh.positions.length).toBe(108)
  })

  it('rejects a move that collapses a touched triangle', () => {
    expect(() => readEditableMesh(bytes, { 4: [4, 4, 7], 5: [4, 4, 7] })).toThrow(
      /collaps|degenerat/,
    )
  })

  it('rejects a triangle flipped through zero area', () => {
    const triangle = writeStl(
      [
        {
          positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 1, 0]),
          indices: new Uint32Array([0, 1, 2]),
        },
      ],
      'Triangle fixture',
    )
    expect(() => readEditableMesh(triangle, { 2: [0, -1, 0] })).toThrow(/invert|flip/)
    expect(() => readEditableMesh(triangle, { 1: [-2, 0, 0], 2: [0, -1, 0] })).toThrow(
      /invert|flip/,
    )
    // This normal also rotates more than 90 degrees, but the triangle retains area as it moves.
    expect(() => readEditableMesh(triangle, { 2: [0, -1, 1] })).not.toThrow()
  })

  it('leaves untouched legacy degenerate triangles readable', () => {
    const badFace = {
      positions: new Float32Array([20, 20, 20, 21, 20, 20, 22, 20, 20]),
      indices: new Uint32Array([0, 1, 2]),
    }
    const legacy = writeStl([cube, badFace], 'Legacy STL fixture')
    expect(readEditableMesh(legacy, top).indices.length).toBe(39)
  })
})
