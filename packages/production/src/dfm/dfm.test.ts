import { describe, expect, it } from 'vitest'
import { createContext } from '../context'
import { exportCad } from '../exports'
import { TriangleBVH } from '../geometry/bvh'
import { mergeTris } from '../geometry/mesh'
import { evaluationOf, fixtureKernel, stoneAt, templateDesign } from '../testing/fixtures'
import { box, cone } from '../testing/shapes'
import type { BuildInput } from '../types'
import { runDfm } from './checks'
import { resolveProfile } from './profile'
import { wallThickness } from './thickness'

const fonts = {
  sans: { regular: new Uint8Array(), medium: new Uint8Array(), semibold: new Uint8Array() },
  serif: new Uint8Array(),
}

async function dfmFor(
  evaluation: BuildInput['evaluation'],
  opts: Partial<BuildInput['options']> = {},
  design = templateDesign('solitaire'),
) {
  const input: BuildInput = {
    piece: { id: 'p', title: 'T', kind: 'ring' },
    revision: 1,
    design,
    evaluation,
    kernel: fixtureKernel(evaluation),
    fonts,
    options: {
      quantity: 1,
      date: '2026-11-23',
      author: { name: 'a' },
      org: { name: 'o' },
      ...opts,
    },
  }
  const ctx = createContext(input)
  const cad = await exportCad(ctx)
  return runDfm(ctx, cad.stls)
}

describe('wall thickness', () => {
  it('finds a thin plate, at the plate, with the right thickness', () => {
    // A 4 mm block with a 0.3 mm fin standing on it at x ∈ [10, 20].
    const block = box([0, 0, 0], [10, 10, 4])
    const fin = box([10, 0, 1.85], [20, 10, 2.15])
    const tris = mergeTris([block, fin])
    const r = wallThickness(tris, new TriangleBVH(tris), { threshold: 0.8 })
    expect(r.minMm).toBeCloseTo(0.3, 2)
    expect(r.regions.length).toBeGreaterThan(0)
    for (const g of r.regions) {
      expect(g.thicknessMm).toBeCloseTo(0.3, 2)
      expect(g.at[0]).toBeGreaterThanOrEqual(10)
    }
    expect(r.medianMm).toBeGreaterThan(0.25)
  })

  it('passes a solid block', () => {
    const b = box([0, 0, 0], [5, 5, 5])
    const r = wallThickness(b, new TriangleBVH(b), { threshold: 0.8 })
    expect(r.regions).toEqual([])
    expect(r.minMm).toBeGreaterThan(0.8)
  })

  it('does not read a sharp rim as a wall', () => {
    // A solid 10 mm spike stud: its 45° rim is an edge, which casts; it is not a 0.00 mm wall.
    const spike = cone(5, 5)
    const r = wallThickness(spike, new TriangleBVH(spike), { threshold: 0.8 })
    expect(r.regions).toEqual([])
    expect(r.minMm).toBeGreaterThanOrEqual(0.8)
  })

  it('is deterministic', () => {
    const b = box([0, 0, 0], [3, 2, 1])
    const a = wallThickness(b, new TriangleBVH(b), { threshold: 2 })
    expect(wallThickness(b, new TriangleBVH(b), { threshold: 2 })).toEqual(a)
  })
})

describe('DFM report', () => {
  it('fails a thin plate with its location, and passes the clean checks', async () => {
    const plate = box([-5, -5, 0], [5, 5, 0.3])
    const report = await dfmFor(evaluationOf([{ id: 'band', name: 'Plate', mesh: plate }]))
    const wall = report.checks.find((c) => c.code === 'wall')!
    expect(wall.status).toBe('error')
    const f = wall.findings.find((x) => x.code === 'wall.thin')!
    expect(f).toMatchObject({ severity: 'error', limit: 0.5, partId: 'band', unit: 'mm' })
    expect(f.value).toBeCloseTo(0.3, 2)
    expect(Math.abs(f.location![0])).toBeLessThanOrEqual(5)
    expect(f.location![2]).toBeGreaterThanOrEqual(-1e-6)
    expect(f.location![2]).toBeLessThanOrEqual(0.3 + 1e-6)
    expect(report.checks.find((c) => c.code === 'mesh')!.status).toBe('pass')
    expect(report.checks.find((c) => c.code === 'envelope')!.findings.map((x) => x.code)).toEqual([
      'envelope.small',
    ])
  })

  it('flags open meshes, extra shells and oversized parts', async () => {
    const open = box([0, 0, 0], [5, 5, 5])
    const holed = { ...open, indices: open.indices.slice(0, 30) }
    const twoShells = mergeTris([box([0, 0, 0], [5, 5, 5]), box([8, 0, 0], [13, 5, 5])])
    const huge = box([0, 0, 0], [40, 60, 80])
    const report = await dfmFor(
      evaluationOf([
        { id: 'a', mesh: holed },
        { id: 'b', mesh: { ...twoShells, normals: new Float32Array(0) } },
        { id: 'c', mesh: huge },
      ]),
    )
    const codes = report.checks.find((c) => c.code === 'mesh')!.findings.map((f) => f.code)
    expect(codes).toContain('mesh.open')
    expect(codes).toContain('mesh.shells')
    expect(report.checks.find((c) => c.code === 'envelope')!.findings.map((f) => f.code)).toContain(
      'envelope.exceeded',
    )
  })

  it('checks prongs, engraving and plating claims from parameters', async () => {
    const design = templateDesign('solitaire')
    const head = design.nodes.head!
    if (head.kind !== 'setting') throw new Error()
    const edited = {
      ...design,
      nodes: {
        ...design.nodes,
        head: { ...head, prongDiameter: 0.42 },
        engraving: {
          id: 'engraving',
          kind: 'engraving' as const,
          visible: true,
          host: 'band',
          text: 'tiny',
          font: 'serif' as const,
          size: 1.2,
          depth: 0.6,
          mode: 'engrave' as const,
          where: 'insideBand' as const,
          angle: 180,
        },
      },
      order: [...design.order, 'engraving'],
    }
    const ev = evaluationOf([
      { id: 'band', material: 'au14k-yellow', mesh: box([0, 0, 0], [10, 10, 10]) },
    ])
    ev.parts[0]!.plating = 'yellow-vermeil'
    const report = await dfmFor(ev, {}, edited)
    const by = (code: string) => report.checks.find((c) => c.code === code)!
    expect(by('prong').findings[0]).toMatchObject({
      severity: 'error',
      code: 'prong.thin',
      value: 0.42,
      limit: 0.45,
    })
    expect(
      by('text')
        .findings.map((f) => f.code)
        .sort(),
    ).toEqual(['text.recessed.depth', 'text.recessed.width'])
    expect(
      by('plating')
        .findings.map((f) => f.code)
        .sort(),
    ).toEqual(['plating.thickness', 'plating.vermeil.base'])
  })

  it('catches a stone sitting inside metal and merges kernel diagnostics', async () => {
    const ev = evaluationOf(
      [{ id: 'band', mesh: box([0, 0, 0], [10, 10, 10]) }],
      [stoneAt('center:0', 'center', 3, [5, 5, 5])],
      [{ level: 'warning', code: 'bead.small', message: 'Beads 0.35 mm', value: 0.35, limit: 0.4 }],
    )
    const report = await dfmFor(ev)
    expect(report.checks.find((c) => c.code === 'seat')!.findings[0]!.code).toBe('seat.collision')
    expect(report.checks.find((c) => c.code === 'bead')!.findings[0]).toMatchObject({
      source: 'kernel',
      value: 0.35,
    })
  })

  it('uses the manufacturer profile', async () => {
    const ev = evaluationOf([{ id: 'band', mesh: box([0, 0, 0], [6, 6, 0.9]) }])
    const strict = await dfmFor(ev, { manufacturerProfile: { wall: { warnMm: 1.2 } } })
    expect(strict.checks.find((c) => c.code === 'wall')!.status).toBe('warning')
    expect((await dfmFor(ev)).checks.find((c) => c.code === 'wall')!.status).toBe('pass')
    expect(resolveProfile({ wall: { warnMm: 1.2 } }).wall).toEqual({
      errorMm: 0.5,
      warnMm: 1.2,
      ringShankWarnMm: 1,
    })
  })

  it('treats identical bodies of one node as N castings of one file', async () => {
    const link = (x: number) => box([x, 0, 0], [x + 3, 3, 3])
    const ev = evaluationOf(
      [0, 5, 10].map((x, i) => ({ id: `chain:${i}`, name: 'Link', mesh: link(x) })),
    )
    for (const p of ev.parts) p.nodeId = 'chain'
    const input: BuildInput = {
      piece: { id: 'p', title: 'T', kind: 'chain' },
      revision: 1,
      design: templateDesign('cuban'),
      evaluation: ev,
      kernel: fixtureKernel(ev),
      fonts,
      options: { quantity: 1, date: '2026-11-23', author: { name: 'a' }, org: { name: 'o' } },
    }
    const ctx = createContext(input)
    expect(ctx.groups).toHaveLength(1)
    expect(ctx.groups[0]).toMatchObject({ count: 3, identical: true })
    const cad = await exportCad(ctx)
    expect(cad.stls.map((s) => s.path)).toEqual(['cad/p_Link_au18k-yellow_x3.stl'])
    const report = runDfm(ctx, cad.stls)
    expect(report.checks.find((c) => c.code === 'mesh')!.status).toBe('pass')
  })
})
