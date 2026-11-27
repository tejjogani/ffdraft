import { describe, expect, it } from 'vitest'
import { boundsOfPositions } from '../solid/meshing'
import type { Bounds, Evaluation, Part } from '../types'
import { circularBandLayout, poseCircularBand } from './circular-band'

function fixture(axis: 0 | 1): Evaluation {
  const parts = Array.from({ length: 16 }, (_, i) => {
    const point = (along: number, side: number, z: number): [number, number, number] =>
      axis === 0 ? [along, side, z] : [side, along, z]
    const bounds: Bounds = { min: point(4 * i, -1, -1), max: point(4 * i + 4, 1, 1) }
    const positions = new Float32Array([...bounds.min, ...bounds.max, ...point(4 * i, 1, 1)])
    return {
      id: 'link' + i,
      nodeId: 'link' + i,
      rev: 'r',
      bounds,
      edges: new Float32Array(),
      mesh: {
        positions,
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
      },
    } as Part
  })
  return {
    parts,
    stones: [],
    gemMeshes: {},
    report: { bounds: { min: parts[0]!.bounds.min, max: parts.at(-1)!.bounds.max } },
  } as Evaluation
}
describe('circular band render pose', () => {
  it.each([0, 1] as const)(
    'closes a straight multipart run along axis %i while preserving all rigid link geometry and IDs',
    (axis) => {
      const source = fixture(axis)
      const plan = circularBandLayout(source)!
      expect(plan.diameterMm).toBeCloseTo(64 / Math.PI)
      const before = source.parts[0]!.mesh.positions.slice()
      const posed = poseCircularBand(source, null)
      const span = posed.report.bounds.max.map((v, i) => v - posed.report.bounds.min[i]!)
      expect(span[0]).toBeCloseTo(span[1]!, 3)
      expect(span[2]).toBeCloseTo(2)
      expect(posed.parts.map((p) => p.id)).toEqual(source.parts.map((p) => p.id))
      for (const part of posed.parts) {
        const [x, y, z, a, b, c] = Array.from(part.mesh.positions) as [
          number,
          number,
          number,
          number,
          number,
          number,
        ]
        expect(Math.hypot(x - a, y - b, z - c)).toBeCloseTo(Math.sqrt(24), 4)
        expect(part.mesh.indices).toBe(source.parts.find((p) => p.id === part.id)!.mesh.indices)
      }
      expect(source.parts[0]!.mesh.positions).toEqual(before)
      expect(circularBandLayout(posed)).toBeNull()
    },
  )
  it('recognizes a row laid diagonally on the CAD workplane without stretching its circumference', () => {
    const source = fixture(0)
    const cos = Math.SQRT1_2
    const parts = source.parts.map((part) => {
      const positions = part.mesh.positions.slice()
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i]!
        const y = positions[i + 1]!
        positions[i] = cos * (x - y)
        positions[i + 1] = cos * (x + y)
      }
      return { ...part, mesh: { ...part.mesh, positions }, bounds: boundsOfPositions(positions) }
    })
    expect(circularBandLayout({ parts, stones: [] })?.length).toBeCloseTo(64, 3)
    const circle = poseCircularBand({ ...source, parts }, null).report.bounds
    expect(circle.max[0] - circle.min[0]).toBeCloseTo(circle.max[1] - circle.min[1], 3)
  })
  it('does not pose a single solid or an already circular assembly', () => {
    const e = fixture(0)
    const single = { ...e, parts: e.parts.slice(0, 1) }
    expect(circularBandLayout(single)).toBeNull()
    expect(poseCircularBand(single, null)).toBe(single)
  })
})
