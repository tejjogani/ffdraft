import { applyOps, type Design, emptyDesign, type RhinoContext } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { boundsOfPositions } from '../solid/meshing'
import type { Bounds, Evaluation, Part } from '../types'
import { circularBandLayout, poseCircularBand } from './circular-band'

function fixture(axis: 0 | 1): Evaluation {
  const parts = Array.from({ length: 16 }, (_, i): Part => {
    const point = (along: number, side: number, z: number): [number, number, number] =>
      axis === 0 ? [along, side, z] : [side, along, z]
    const bounds: Bounds = { min: point(4 * i, -1, -1), max: point(4 * i + 4, 1, 1) }
    const positions = new Float32Array([...bounds.min, ...bounds.max, ...point(4 * i, 1, 1)])
    return {
      id: `link${i}`,
      nodeId: `link${i}`,
      rev: 'r',
      bounds,
      name: `Link ${i}`,
      material: 'au18k-white',
      finish: 'polished',
      plating: 'none',
      volumeMm3: 4,
      areaMm2: 16,
      exact: false,
      edges: new Float32Array(),
      mesh: {
        positions,
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
      },
    }
  })
  return {
    detail: 'production',
    parts,
    stones: [],
    gemMeshes: {},
    report: {
      bounds: { min: parts[0]!.bounds.min, max: parts.at(-1)!.bounds.max },
      metals: [],
      metalMassG: 0,
      lots: [],
      stoneCount: 0,
      caratTotal: 0,
    },
    diagnostics: [],
    ms: 0,
    timings: {},
  }
}

function importedFixture() {
  const source = fixture(0)
  const body = (id: string, x: number, width: number, y = 0): Part => {
    const positions = new Float32Array([
      x - width / 2,
      y - 0.3,
      -1,
      x + width / 2,
      y + 0.3,
      1,
      x,
      y + 0.3,
      1,
    ])
    return {
      ...source.parts[0]!,
      id,
      nodeId: id,
      bounds: boundsOfPositions(positions),
      mesh: { ...source.parts[0]!.mesh, positions },
      sourceAppearance: { kind: 'metal', metal: 'au18k-white' },
      importRole: 'unassigned',
    }
  }
  const parts: Part[] = [
    { ...body('stone', 21, 6.35), sourceAppearance: { kind: 'gem', stone: 'diamond' } },
    body('claw', 23.4, 1.4),
    body('other-archive', 23.4, 1.4),
    body('clasp-rod', 23.4, 7),
    body('clasp-side', 23.4, 1.4, 2),
    body('explicit-assembly', 23.4, 1.4),
  ]
  const context = (id: string): RhinoContext => ({
    archiveId: id === 'other-archive' ? 'different-import' : 'bracelet-import',
    groups: id === 'explicit-assembly' ? [{ id: 'clasp', name: 'Clasp' }] : [],
    placements: id === 'stone' ? [{ id: 'stone-block', definitionId: 'round' }] : [],
  })
  const base = emptyDesign('bracelet')
  const design: Design = applyOps(
    base,
    parts.map(({ id }) => ({
      t: 'add' as const,
      node: {
        id,
        kind: 'meshBody',
        importRole: 'unassigned',
        keepSourcePlacement: true,
        source: { type: 'asset', assetId: id, rhinoContext: context(id) },
      },
    })),
  ).design
  return { source: { ...source, parts: [...source.parts, ...parts] }, design }
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
  it('keeps an ungrouped clasp-end claw rigid with its original stone', () => {
    const { source, design } = importedFixture()
    const circular = poseCircularBand(source, design)
    const before = source.parts.slice(-6)
    const after = circular.parts.slice(-6)
    const clearance = ([stone, claw]: Part[]) =>
      Math.hypot(...[0, 1, 2].map((i) => stone!.mesh.positions[i]! - claw!.mesh.positions[i]!))
    expect(clearance(after)).toBeCloseTo(clearance(before), 4)
    expect(after[1]!.mesh.normals).toEqual(after[0]!.mesh.normals)
    for (const independent of after.slice(2))
      expect(independent.mesh.normals, independent.id).not.toEqual(after[0]!.mesh.normals)
  })
  it('does not pose a single solid or an already circular assembly', () => {
    const e = fixture(0)
    const single = { ...e, parts: e.parts.slice(0, 1) }
    expect(circularBandLayout(single)).toBeNull()
    expect(poseCircularBand(single, null)).toBe(single)
  })
})
