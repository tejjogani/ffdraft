/**
 * Round trips: every format is written from the kernel and parsed back — triangle counts,
 * manifoldness, names, units and bounding boxes — for an all-exact solitaire ring and for a
 * design with a mesh (sculpted) body.
 */
import {
  applyOps,
  buildDesign,
  type Design,
  designFrom,
  METALS,
  type Op,
  parseDesignDocument,
  TEMPLATES,
} from '@pave/schema'
import { unzipSync } from 'fflate'
import { importSTEP, measureVolume, type Shape3D } from 'replicad'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runtime } from '../core'
import { createKernel, type LocalKernel } from '../kernel'
import type { Bounds, ExportFormat, ExportResult } from '../types'
import { loadRhino3dm } from './rhino3dm'

let kernel: LocalKernel
beforeAll(() => {
  kernel = createKernel()
})
afterAll(() => kernel.dispose())

const solitaire = (): Design => buildDesign(TEMPLATES.find((t) => t.id === 'solitaire')!.spec)
const sculpted = (): Design =>
  designFrom('pendant', [
    {
      id: 'trophy',
      kind: 'meshBody',
      name: 'Trophy',
      source: { type: 'builtin', name: 'trophy' },
      height: 20,
    },
    {
      id: 'loop',
      kind: 'primitive',
      name: 'Loop',
      shape: 'torus',
      size: [6, 6, 1.2],
      tube: 1.2,
      transform: { position: [0, 0, 12], rotation: [90, 0, 0], scale: 1 },
    },
  ])

interface Triangles {
  positions: number[]
  indices: number[]
}

/** Every edge used exactly twice, in opposite directions: closed and consistently wound. */
function isClosedManifold({ positions, indices }: Triangles): boolean {
  const ids = new Map<string, number>()
  const vertex = (i: number) => {
    const key = `${positions[i * 3]},${positions[i * 3 + 1]},${positions[i * 3 + 2]}`
    if (!ids.has(key)) ids.set(key, ids.size)
    return ids.get(key)!
  }
  const edges = new Map<string, number>()
  for (let t = 0; t < indices.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = vertex(indices[t + e]!)
      const b = vertex(indices[t + ((e + 1) % 3)]!)
      edges.set(`${a}>${b}`, (edges.get(`${a}>${b}`) ?? 0) + 1)
    }
  for (const [key, n] of edges) {
    const [a, b] = key.split('>')
    if (n !== 1 || edges.get(`${b}>${a}`) !== 1) return false
  }
  return true
}

function boundsOf(positions: number[]): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, positions[i + k]!)
      max[k] = Math.max(max[k]!, positions[i + k]!)
    }
  return { min, max }
}

function expectBounds(actual: Bounds, expected: Bounds, tolerance = 0.05) {
  for (let k = 0; k < 3; k++) {
    expect(actual.min[k]).toBeCloseTo(expected.min[k]!, 1)
    expect(Math.abs(actual.max[k]! - expected.max[k]!)).toBeLessThan(tolerance)
  }
}

function parseStl(bytes: Uint8Array): { header: string; triangles: Triangles } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(80, true)
  expect(bytes.byteLength).toBe(84 + count * 50)
  const positions: number[] = []
  for (let t = 0; t < count; t++)
    for (let k = 0; k < 9; k++) positions.push(view.getFloat32(84 + t * 50 + 12 + k * 4, true))
  return {
    header: new TextDecoder().decode(bytes.subarray(0, 80)),
    triangles: { positions, indices: Array.from({ length: positions.length / 3 }, (_, i) => i) },
  }
}

/** Measures the STL where its triangles cross a plane between the rail vertices. */
function sectionBounds(
  { positions }: Triangles,
  axis: 0 | 1,
  at: number,
  half?: 'near' | 'far',
): Bounds {
  const cut: number[] = []
  for (let t = 0; t < positions.length; t += 9)
    for (let vertex = 0; vertex < 3; vertex++) {
      const a = t + 3 * vertex
      const b = t + 3 * ((vertex + 1) % 3)
      const da = positions[a + axis]! - at
      const db = positions[b + axis]! - at
      if (da * db > 0 || da === db) continue
      const f = da / (da - db)
      const point = [0, 1, 2].map((k) => positions[a + k]! * (1 - f) + positions[b + k]! * f)
      if (half === undefined || (half === 'near') === point[1 - axis]! < 5) cut.push(...point)
    }
  expect(cut.length).toBeGreaterThan(0)
  return boundsOf(cut)
}

/** Splits STL triangle soup into connected shells by shared vertex coordinates. */
function shellCount({ positions, indices }: Triangles): number {
  const ids = new Map<string, number>()
  const parent: number[] = []
  const find = (x: number): number => {
    let root = x
    while (parent[root] !== root) root = parent[root]!
    return root
  }
  const vertex = (i: number) => {
    const key = `${positions[i * 3]},${positions[i * 3 + 1]},${positions[i * 3 + 2]}`
    let id = ids.get(key)
    if (id === undefined) {
      id = ids.size
      ids.set(key, id)
      parent.push(id)
    }
    return id
  }
  for (let t = 0; t < indices.length; t += 3) {
    const a = find(vertex(indices[t]!))
    for (const v of [indices[t + 1]!, indices[t + 2]!]) parent[find(vertex(v))] = a
  }
  return new Set(parent.map((_, i) => find(i))).size
}

const exportOf = (design: Design, format: ExportFormat, stones?: boolean): Promise<ExportResult> =>
  kernel.export(design, format, stones === undefined ? {} : { stones })

describe('revolve from a construction curve', () => {
  const outline = (outer: number) =>
    [
      [3, 2],
      [outer, 2],
      [outer, 6],
      [3, 6],
    ].map(([u, v], i) => ({ id: String(i), u: u!, v: v! }))
  const profile = (plane: 'front' | 'top' | 'right' = 'front') =>
    designFrom('other', [{ id: 'outline', kind: 'curve', plane, closed: true, points: outline(5) }])
  const spin = (patch: Record<string, unknown> = {}): Op => ({
    t: 'add',
    node: { id: 'lathe', kind: 'revolve', curve: 'outline', ...patch },
  })

  it('exports the measured annulus and rebuilds it after editing and reopening the profile', async () => {
    const first = applyOps(profile(), [spin()]).design
    const edit = applyOps(first, [{ t: 'update', id: 'outline', patch: { points: outline(7) } }])
    for (const [design, r] of [
      [first, 5],
      [edit.design, 7],
      [applyOps(edit.design, edit.inverse).design, 5],
    ] as const) {
      const reopened = parseDesignDocument(JSON.parse(JSON.stringify(design)))
      const { triangles } = parseStl((await exportOf(reopened, 'stl')).bytes)
      expect(isClosedManifold(triangles)).toBe(true)
      expectBounds(boundsOf(triangles.positions), { min: [-r, -r, 2], max: [r, r, 6] })
      const built = await kernel.evaluate(reopened)
      expect(built.parts[0]!.volumeMm3 / (Math.PI * (r ** 2 - 9) * 4)).toBeCloseTo(1, 2)
    }
  })

  it('resolves a horizontal offset axis in the drawing plane, including the negative side and partial angles', async () => {
    const design = applyOps(profile('right'), [
      spin({ axis: 'horizontal', axisOffset: 7, angle: 180 }),
    ]).design
    const built = await kernel.evaluate(design)
    expect(built.parts[0]!.volumeMm3 / (Math.PI * (25 - 1))).toBeCloseTo(1, 2)
    const { triangles } = parseStl((await exportOf(design, 'stl')).bytes)
    expect(isClosedManifold(triangles)).toBe(true)
    expectBounds(boundsOf(triangles.positions), { min: [-5, 3, 2], max: [0, 5, 12] })
  })

  it('rejects axis crossings, open outlines, intersecting outlines and ambiguous input before saving', () => {
    expect(() => applyOps(profile(), [spin({ axisOffset: 4 })])).toThrow(/axis/i)
    expect(() => applyOps(profile(), [spin({ profile: 'M0 0h1v1z' })])).toThrow(/either|one/i)
    const d = applyOps(profile(), [spin()]).design
    expect(() => applyOps(d, [{ t: 'update', id: 'outline', patch: { closed: false } }])).toThrow(
      /closed/i,
    )
    const pts = outline(5)
    expect(() =>
      applyOps(d, [
        { t: 'update', id: 'outline', patch: { points: [pts[0], pts[2], pts[1], pts[3]] } },
      ]),
    ).toThrow(/cross/i)
  })
})

describe('wire from a construction curve', () => {
  const source = designFrom('other', [
    {
      id: 'path',
      kind: 'curve',
      plane: 'front',
      points: [
        { id: 'a', u: 0, v: 0 },
        { id: 'b', u: 12, v: 0 },
      ],
    },
  ])
  const addWire: Op = {
    t: 'add',
    node: {
      id: 'wire',
      kind: 'pipe',
      curve: 'path',
      width: 2,
      thickness: 1,
      transform: { position: [3, 5, 7], rotation: [0, 0, 90], scale: 1.5 },
    },
  }

  const coordinates = (vertices: [number, number][]) =>
    vertices.map(([u, v], i) => ({ id: `p${i}`, u, v }))

  const linked = (points: [number, number][], closed = false, taper = 0): Design =>
    designFrom('other', [
      { id: 'path', kind: 'curve', plane: 'top', points: coordinates(points), closed },
      { id: 'wire', kind: 'pipe', curve: 'path', width: 2, thickness: 1, taper },
    ])

  it('honors the source plane and wire transform in the solid and exported STL', async () => {
    const change = applyOps(source, [addWire])
    const saved = parseDesignDocument(JSON.parse(JSON.stringify(change.design)))
    expect(saved.nodes.path).toEqual(source.nodes.path)
    const e = await kernel.evaluate(saved, { detail: 'production' })
    expect(e.parts).toHaveLength(1)
    expect(e.diagnostics.some((d) => d.level === 'error')).toBe(false)
    expect(e.parts[0]!.volumeMm3).toBeCloseTo(Math.PI * 0.5 * 12 * 1.5 ** 3, 1)
    const expected = { min: [1.5, 5, 6.25], max: [4.5, 23, 7.75] } satisfies Bounds
    expectBounds(e.parts[0]!.bounds, expected)
    const { triangles } = parseStl((await exportOf(saved, 'stl')).bytes)
    expect(isClosedManifold(triangles)).toBe(true)
    expect(shellCount(triangles)).toBe(1)
    expectBounds(boundsOf(triangles.positions), expected)
    expect(applyOps(saved, change.inverse).design).toEqual(source)
  })

  it('rebuilds the linked wire when the path changes, including closure', async () => {
    const initial = applyOps(source, [addWire]).design
    const open = await kernel.evaluate(initial)
    const extended = applyOps(initial, [
      {
        t: 'update',
        id: 'path',
        patch: {
          points: [
            { id: 'a', u: 0, v: 0 },
            { id: 'b', u: 16, v: 0 },
            { id: 'c', u: 16, v: 12 },
            { id: 'd', u: 0, v: 12 },
          ],
        },
      },
    ]).design
    const bend = await kernel.evaluate(extended)
    expect(bend.parts[0]!.bounds.max[1]).toBeGreaterThan(open.parts[0]!.bounds.max[1])
    const loop = await kernel.evaluate(
      applyOps(extended, [{ t: 'update', id: 'path', patch: { closed: true } }]).design,
    )
    expect(loop.parts[0]!.volumeMm3).toBeGreaterThan(bend.parts[0]!.volumeMm3)
  })

  it('keeps the right-angle rail centred and mitred through STL export, edit, reopen, and undo', async () => {
    const initial = linked([
      [0, 0],
      [10, 0],
      [10, 10],
    ])
    const measure = async (design: Design, x: number) => {
      const { parts, diagnostics } = await kernel.evaluate(design, { detail: 'production' })
      expect(diagnostics.some((d) => d.level === 'error')).toBe(false)
      expect(parts[0]!.volumeMm3).toBeCloseTo(Math.PI * 0.5 * (x + 10), 1)
      const { triangles } = parseStl((await exportOf(design, 'stl')).bytes)
      expect(isClosedManifold(triangles)).toBe(true)
      expect(shellCount(triangles)).toBe(1)
      const bounds = boundsOf(triangles.positions)
      expectBounds(bounds, { min: [0, -0.5, -1], max: [x + 0.5, 10, 1] })
      for (const station of [2.5, 5, 7.5]) {
        expectBounds(sectionBounds(triangles, 0, station), {
          min: [station, -0.5, -1],
          max: [station, 0.5, 1],
        })
        expectBounds(sectionBounds(triangles, 1, station), {
          min: [x - 0.5, station, -1],
          max: [x + 0.5, station, 1],
        })
      }
      // The outside generator on both legs meets at the miter, half a thickness past the vertex.
      expect(
        triangles.positions.some(
          (value, i) =>
            i % 3 === 0 &&
            value === x + 0.5 &&
            triangles.positions[i + 1] === -0.5 &&
            Math.abs(triangles.positions[i + 2]!) < 1e-6,
        ),
      ).toBe(true)
    }
    await measure(initial, 10)
    const change = applyOps(initial, [
      {
        t: 'update',
        id: 'path',
        patch: {
          points: coordinates([
            [0, 0],
            [14, 0],
            [14, 10],
          ]),
        },
      },
    ])
    const reopened = parseDesignDocument(JSON.parse(JSON.stringify(change.design)))
    await measure(reopened, 14)
    await measure(applyOps(reopened, change.inverse).design, 10)
  })

  it('keeps a closed rail square at every miter, including the closure seam', async () => {
    const design = linked(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      true,
    )
    const { parts, diagnostics } = await kernel.evaluate(design, { detail: 'production' })
    expect(diagnostics.some((d) => d.level === 'error')).toBe(false)
    expect(parts[0]!.volumeMm3).toBeCloseTo(Math.PI * 0.5 * 40, 1)
    const { triangles } = parseStl((await exportOf(design, 'stl')).bytes)
    expect(isClosedManifold(triangles)).toBe(true)
    expect(shellCount(triangles)).toBe(1)
    expectBounds(boundsOf(triangles.positions), { min: [-0.5, -0.5, -1], max: [10.5, 10.5, 1] })
    for (const axis of [0, 1] as const) {
      for (const leg of [0, 10]) {
        const min: [number, number, number] = [leg - 0.5, leg - 0.5, -1]
        const max: [number, number, number] = [leg + 0.5, leg + 0.5, 1]
        min[axis] = max[axis] = 5
        expectBounds(sectionBounds(triangles, axis, 5, leg === 0 ? 'near' : 'far'), { min, max })
      }
    }
  })

  it.each<[string, [number, number][], boolean]>([
    [
      'a direction reversal',
      [
        [0, 0],
        [10, 0],
        [4, 0],
      ],
      false,
    ],
    [
      'a nearly zero-length leg',
      [
        [0, 0],
        [0.0000001, 0],
        [0, 10],
      ],
      false,
    ],
    [
      'overlapping miters on a short leg',
      [
        [0, 0],
        [10, 0],
        [10, 0.3],
        [0, 0.3],
      ],
      false,
    ],
    [
      'a crossing rail',
      [
        [0, 0],
        [10, 10],
        [0, 10],
        [10, 0],
      ],
      false,
    ],
  ])('reports invalid linked wire geometry for %s', async (_, points, closed) => {
    const { parts, diagnostics } = await kernel.evaluate(linked(points, closed), {
      detail: 'production',
    })
    expect(parts).toHaveLength(0)
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'feature.failed', nodeId: 'wire' }),
    )
  })

  it('still interpolates an inline path smoothly through the same right-angle points', async () => {
    const design = designFrom('other', [
      {
        id: 'wire',
        kind: 'pipe',
        points: [
          [0, 0, 0],
          [10, 0, 0],
          [10, 10, 0],
        ],
        width: 2,
        thickness: 1,
      },
    ])
    const { triangles } = parseStl((await exportOf(design, 'stl')).bytes)
    const { min, max } = sectionBounds(triangles, 0, 5)
    expect((min[1] + max[1]) / 2).toBeLessThan(-0.5)
  })

  it('tapers along straight linked legs and supports pointed ends', async () => {
    const design = linked(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      false,
      1,
    )
    const { triangles } = parseStl((await exportOf(design, 'stl')).bytes)
    expect(isClosedManifold(triangles)).toBe(true)
    const { min, max } = sectionBounds(triangles, 0, 5)
    // Slicing perpendicular to a leg also cuts across the taper as the sections skew into the miter.
    expect(Math.abs((min[1] + max[1]) / 2)).toBeLessThan(0.02)
    expect(max[2] - min[2]).toBeCloseTo(1.5, 1)
    expect(boundsOf(triangles.positions).min[0]).toBeCloseTo(0, 2)
  })

  it('rejects ambiguous or incompatible sources and still accepts inline points', async () => {
    const addPipe = (patch: Record<string, unknown>) =>
      applyOps(source, [{ t: 'add', node: { id: 'wire', kind: 'pipe', ...patch } }])
    expect(() => addPipe({})).toThrow(/path points|construction curve/i)
    expect(() =>
      addPipe({
        curve: 'path',
        points: [
          [0, 0, 0],
          [5, 0, 0],
        ],
      }),
    ).toThrow()
    expect(() => addPipe({ curve: 'not-found' })).toThrow(/missing node/)
    expect(() => addPipe({ curve: 'path', width: 0.2 })).toThrow(/width/)
    expect(() => addPipe({ curve: 'path', thickness: 21 })).toThrow(/thickness/)
    expect(() =>
      applyOps(source, [
        { t: 'add', node: { kind: 'primitive', id: 'box' } },
        { t: 'add', node: { kind: 'pipe', id: 'wire', curve: 'box' } },
      ]),
    ).toThrow(/construction curve/i)
    const inline = addPipe({
      points: [
        [0, 0, 0],
        [5, 0, 0],
      ],
    }).design
    expect((await kernel.evaluate(inline)).parts).toHaveLength(1)
  })
})

describe.each([
  ['solitaire ring', solitaire],
  ['design with a mesh body', sculpted],
])('exports round-trip: %s', (_, make) => {
  it('STL: watertight metal shells matching the production parts', async () => {
    const design = make()
    const evaluation = await kernel.evaluate(design, { detail: 'production' })
    const result = await exportOf(design, 'stl')
    expect(result.extension).toBe('stl')
    const { header, triangles } = parseStl(result.bytes)
    expect(header).toContain('millimetres')
    const expected = evaluation.parts.reduce((n, p) => n + p.mesh.indices.length / 3, 0)
    expect(triangles.indices.length / 3).toBeGreaterThan(0.5 * expected)
    expect(isClosedManifold(triangles)).toBe(true)
    expect(shellCount(triangles)).toBe(evaluation.parts.length)
    expectBounds(boundsOf(triangles.positions), {
      min: [0, 1, 2].map((k) =>
        Math.min(...evaluation.parts.map((p) => p.bounds.min[k]!)),
      ) as Bounds['min'],
      max: [0, 1, 2].map((k) =>
        Math.max(...evaluation.parts.map((p) => p.bounds.max[k]!)),
      ) as Bounds['max'],
    })
    const withStones = parseStl((await exportOf(design, 'stl', true)).bytes)
    expect(shellCount(withStones.triangles)).toBe(
      evaluation.parts.length + evaluation.stones.length,
    )
  })

  it('3MF: millimetre model with one named, coloured object per part', async () => {
    const design = make()
    const evaluation = await kernel.evaluate(design, { detail: 'production' })
    const files = unzipSync((await exportOf(design, '3mf')).bytes)
    expect(Object.keys(files).sort()).toEqual([
      '3D/3dmodel.model',
      '[Content_Types].xml',
      '_rels/.rels',
    ])
    const xml = new TextDecoder().decode(files['3D/3dmodel.model'])
    expect(xml).toContain('unit="millimeter"')
    const objects = [
      ...xml.matchAll(
        /<object id="(\d+)" type="model" name="([^"]+)"[^>]*><mesh><vertices>([\s\S]*?)<\/vertices><triangles>([\s\S]*?)<\/triangles>/g,
      ),
    ]
    expect(objects).toHaveLength(evaluation.parts.length)
    expect(objects.map((o) => o[2])).toEqual(evaluation.parts.map((p) => p.name))
    expect(xml).toMatch(/<base name="[^"]+" displaycolor="#[0-9A-F]{8}"\/>/)
    for (const [, , vertices, tris] of objects) {
      const positions = [...vertices!.matchAll(/x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].flatMap(
        (m) => [m[1], m[2], m[3]].map(Number),
      )
      const indices = [...tris!.matchAll(/v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].flatMap((m) =>
        [m[1], m[2], m[3]].map(Number),
      )
      expect(isClosedManifold({ positions, indices })).toBe(true)
    }
  })

  it('OBJ: a named group per part and per stone, same triangles as the STL', async () => {
    const design = make()
    const evaluation = await kernel.evaluate(design, { detail: 'production' })
    const text = new TextDecoder().decode((await exportOf(design, 'obj')).bytes)
    expect(text).toContain('units: millimetres')
    const groups = [...text.matchAll(/^g (.+)$/gm)].map((m) => m[1])
    expect(groups).toHaveLength(evaluation.parts.length + evaluation.stones.length)
    const faces = (text.match(/^f /gm) ?? []).length
    const metal = parseStl((await exportOf(design, 'stl')).bytes).triangles.indices.length / 3
    const stones =
      parseStl((await exportOf(design, 'stl', true)).bytes).triangles.indices.length / 3 - metal
    expect(faces).toBe(metal + stones)
  })

  it('3DM: millimetre document with layers, named meshes and user strings', async () => {
    const design = make()
    const evaluation = await kernel.evaluate(design, { detail: 'production' })
    const result = await exportOf(design, '3dm')
    expect(result.notes.join(' ')).toMatch(/meshes and curves only.*STEP/)
    const rhino = await loadRhino3dm()
    const doc = rhino.File3dm.fromByteArray(result.bytes)
    expect(doc.settings().modelUnitSystem).toBe(rhino.UnitSystem.Millimeters)
    const layerNames = Array.from(
      { length: doc.layers().count },
      (_, i) => doc.layers().get(i).name,
    )
    expect(layerNames).toContain('Metal')
    for (const p of evaluation.parts) expect(layerNames).toContain(METALS[p.material].label)
    if (evaluation.stones.length > 0) expect(layerNames).toContain('Stones')
    const objects = doc.objects()
    const meshes = Array.from({ length: objects.count }, (_, i) => objects.get(i)).filter(
      (o) => o.geometry().objectType === rhino.ObjectType.Mesh,
    )
    expect(meshes).toHaveLength(evaluation.parts.length + evaluation.stones.length)
    const metal = meshes.filter((o) => o.attributes().getUserString('alloy'))
    expect(metal.map((o) => o.attributes().name)).toEqual(evaluation.parts.map((p) => p.name))
    expect(metal[0]!.attributes().getUserString('alloy')).toBe(evaluation.parts[0]!.material)
    const stones = meshes.filter((o) => o.attributes().getUserString('carat'))
    expect(stones).toHaveLength(evaluation.stones.length)
    for (const o of metal)
      expect((o.geometry() as unknown as { isClosed: boolean }).isClosed).toBe(true)
  })

  it('GLB is wired through the exporter registry', async () => {
    const result = await exportOf(make(), 'glb')
    expect(new TextDecoder().decode(result.bytes.subarray(0, 4))).toBe('glTF')
  })
})

describe('STEP round trip', () => {
  it('writes exact, named solids that re-import with the same volume', async () => {
    const design = designFrom('other', [
      { id: 'box', kind: 'primitive', name: 'Block', shape: 'box', size: [4, 5, 6] },
      {
        id: 'ball',
        kind: 'primitive',
        name: 'Ball',
        material: 'pt950',
        shape: 'sphere',
        size: [4, 4, 4],
        transform: { position: [10, 0, 0], rotation: [0, 0, 0], scale: 1 },
      },
    ])
    const result = await exportOf(design, 'step')
    const text = new TextDecoder().decode(result.bytes)
    expect(text.startsWith('ISO-10303-21;')).toBe(true)
    expect(text).toMatch(/FILE_SCHEMA/)
    expect(text).toMatch(/SI_UNIT\(\.MILLI\.,\.METRE\.\)/)
    expect((text.match(/MANIFOLD_SOLID_BREP/g) ?? []).length).toBe(2)
    expect(text).toContain('Block — 18k Yellow Gold')
    expect(text).toContain('Ball — Platinum 950')
    const shape = (await importSTEP(new Blob([result.bytes.slice()]))) as Shape3D
    expect(measureVolume(shape)).toBeCloseTo(120 + (4 / 3) * Math.PI * 8, 2)
    shape.delete()
  })

  it('exports the solitaire exactly and says what it left out of a mesh design', async () => {
    const ring = await exportOf(solitaire(), 'step', true)
    const text = new TextDecoder().decode(ring.bytes)
    const evaluation = await kernel.evaluate(solitaire(), { detail: 'production' })
    expect((text.match(/MANIFOLD_SOLID_BREP/g) ?? []).length).toBeGreaterThanOrEqual(
      evaluation.stones.length + 2,
    )
    const shape = (await importSTEP(new Blob([ring.bytes.slice()]))) as Shape3D
    // Bodies overlap where claws meet the band, so the solids sum to at least the fused metal.
    expect(measureVolume(shape)).toBeGreaterThan(evaluation.report.metals[0]!.volumeMm3 * 0.98)
    shape.delete()

    const mesh = await exportOf(sculpted(), 'step')
    expect(mesh.notes.join(' ')).toMatch(/Mesh bodies have no exact form and are omitted: Trophy/)
    expect(new TextDecoder().decode(mesh.bytes)).toContain('Loop')
  })
})

describe('export edge cases', () => {
  it('writes the same bytes for the same design (STL, 3MF, OBJ)', async () => {
    const design = solitaire()
    const first = createKernel()
    const second = createKernel()
    try {
      for (const format of ['stl', '3mf', 'obj'] as const) {
        const a = await first.export(design, format, { stones: true })
        // Zip times have two-second resolution: a clock-stamped archive would differ by now.
        await new Promise((resolve) => setTimeout(resolve, 2100))
        const b = await second.export(design, format, { stones: true })
        expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes)), format).toBe(true)
      }
    } finally {
      first.dispose()
      second.dispose()
    }
  }, 60_000)

  it('refuses to write an empty file', async () => {
    for (const format of ['stl', '3mf', 'obj', '3dm'] as const)
      await expect(kernel.export(solitaire(), format, { only: ['nope'] }), format).rejects.toThrow(
        /Nothing to export/,
      )
  })

  it('3MF: stones are resources, never build items', async () => {
    const files = unzipSync((await exportOf(solitaire(), '3mf', true)).bytes)
    const xml = new TextDecoder().decode(files['3D/3dmodel.model'])
    const others = [...xml.matchAll(/<object id="(\d+)" type="other"/g)].map((m) => m[1])
    expect(others.length).toBeGreaterThan(0)
    const items = [...xml.matchAll(/<item objectid="(\d+)"/g)].map((m) => m[1])
    expect(items.length).toBeGreaterThan(0)
    for (const id of others) expect(items).not.toContain(id)
  })

  it('counts the shells it writes and says when a chain is included', async () => {
    const design = designFrom('chain', [
      {
        id: 'c',
        kind: 'chain',
        style: 'cable',
        layout: 'straight',
        length: 100,
        linkWidth: 3,
        wire: 0.8,
      },
    ])
    const scene = await kernel.scene(design, { detail: 'production' })
    const links = (scene.nodes.get('c')!.data as { links: number }).links
    const notes = (await exportOf(design, 'stl')).notes.join(' ')
    expect(notes).toContain(`1 metal part in ${links} watertight shells`)
    expect(notes).toMatch(/Chain links are separate shells/)
  })
})

describe('export fidelity', () => {
  const pair = () =>
    designFrom('other', [
      { id: 'a', kind: 'primitive', name: 'Block', shape: 'box', size: [4, 4, 4] },
      {
        id: 'b',
        kind: 'primitive',
        name: 'Block',
        material: 'pt950',
        shape: 'box',
        size: [4, 4, 4],
        transform: { position: [10, 0, 0], rotation: [0, 0, 0], scale: 1 },
      },
    ])

  it('STEP: colours as the swatch shows them, repeated names numbered, no clock in the header', async () => {
    const text = new TextDecoder().decode((await exportOf(pair(), 'step')).bytes)
    expect(text).toContain("'Block — 18k Yellow Gold'")
    expect(text).toContain("'Block — Platinum 950'")
    const twins = designFrom('other', [
      { id: 'a', kind: 'primitive', name: 'Claw', shape: 'box', size: [1, 1, 1] },
      {
        id: 'b',
        kind: 'primitive',
        name: 'Claw',
        shape: 'box',
        size: [1, 1, 1],
        transform: { position: [5, 0, 0], rotation: [0, 0, 0], scale: 1 },
      },
    ])
    const named = new TextDecoder().decode((await exportOf(twins, 'step')).bytes)
    expect(named).toContain("'Claw — 18k Yellow Gold'")
    expect(named).toContain("'Claw — 18k Yellow Gold 2'")
    // 18k yellow #E6BE6A: OpenCascade gamma-encodes what it is given, so it must get linear RGB.
    const [r, g, b] = (METALS['au18k-yellow'].swatch.match(/[0-9a-f]{2}/gi) ?? []).map(
      (h) => Number.parseInt(h, 16) / 255,
    )
    const colours = [...text.matchAll(/COLOUR_RGB\('[^']*',([\d.E+-]+),([\d.E+-]+),([\d.E+-]+)\)/g)]
    expect(
      colours.some(
        (c) =>
          Math.abs(Number(c[1]) - r!) < 0.02 &&
          Math.abs(Number(c[2]) - g!) < 0.02 &&
          Math.abs(Number(c[3]) - b!) < 0.02,
      ),
    ).toBe(true)
    expect(text).toMatch(/FILE_NAME\('[^']*','2000-01-01T00:00:00'/)
  })

  it('STEP: cuts the same seats on every export, and cuts them once', async () => {
    const design = buildDesign(TEMPLATES.find((t) => t.id === 'solitaire')!.spec)
    const first = await kernel.export(design, 'step')
    const started = performance.now()
    const second = await kernel.export(design, 'step', { stones: true })
    const third = await kernel.export(design, 'step')
    // The second and third reuse the first export's cut bodies instead of cutting again.
    expect(performance.now() - started).toBeLessThan(3_000)
    for (const r of [first, second, third])
      expect(r.notes.join(' ')).not.toMatch(/without seats cut/)
    expect(third.bytes).toEqual(first.bytes)
  }, 120_000)

  it('STEP: a heavily seated band goes out uncut quickly, and the note says so', async () => {
    const design = buildDesign(TEMPLATES.find((t) => t.id === 'eternity')!.spec)
    const started = performance.now()
    const result = await kernel.export(design, 'step')
    // Cutting its 58 seats exactly took 90 s; the STL carries them.
    expect(performance.now() - started).toBeLessThan(30_000)
    expect(result.notes.join(' ')).toMatch(/without seats cut .*Band/)
  }, 120_000)

  it('says in every format when a node could not be built', async () => {
    const design = designFrom('ring', [
      { id: 'band', kind: 'ringShank' },
      { id: 'logo', kind: 'revolve', name: 'Logo', profile: 'M 0 0 L 0 5 Z' },
    ])
    for (const format of ['stl', 'step', 'obj', '3mf', 'glb'] as const) {
      const notes = (await exportOf(design, format)).notes.join(' ')
      expect(notes, format).toMatch(/Not in this file: “Logo” \(revolve\)/)
    }
  })

  it('OBJ: coordinates read back as the same float32 values', async () => {
    const text = new TextDecoder().decode((await exportOf(solitaire(), 'obj')).bytes)
    const values = [...text.matchAll(/^v (\S+) (\S+) (\S+)$/gm)].flatMap((m) =>
      m.slice(1).map(Number),
    )
    expect(values.length).toBeGreaterThan(0)
    // The STL holds the same welded vertices as raw float32: every OBJ vertex, read back as
    // float32, must be one of them bit for bit, and none may be missing.
    const stl = parseStl((await exportOf(solitaire(), 'stl', true)).bytes).triangles.positions
    const corners = (p: readonly number[]) => {
      const set = new Set<string>()
      for (let i = 0; i < p.length; i += 3) set.add(`${p[i]},${p[i + 1]},${p[i + 2]}`)
      return set
    }
    const written = corners(values.map(Math.fround))
    const expected = corners(stl)
    expect(written.size).toBe(expected.size)
    expect([...written].filter((c) => !expected.has(c))).toEqual([])
    // Finer than the old 0.1 µm grid somewhere: slivers keep their vertices apart.
    expect(values.some((v) => Math.abs(v * 1e4 - Math.round(v * 1e4)) > 1e-3)).toBe(true)
  })

  it('GLB: each alloy in its own colour', async () => {
    const bytes = (await exportOf(pair(), 'glb')).bytes
    const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true)
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as {
      materials: { name: string; pbrMetallicRoughness: { baseColorFactor: number[] } }[]
    }
    const colour = (name: string) =>
      json.materials.find((m) => m.name === name)!.pbrMetallicRoughness.baseColorFactor.join()
    expect(colour('au18k-yellow')).not.toBe(colour('pt950'))
  })
})

describe('STEP memory', () => {
  it('frees what an export allocates: a faceted stone does not grow the OpenCascade heap each time', async () => {
    const design = designFrom('other', [
      { id: 'box', kind: 'primitive', shape: 'box', size: [4, 5, 6] },
      {
        id: 'g',
        kind: 'gem',
        width: 6.5,
        transform: { position: [20, 0, 0], rotation: [0, 0, 0], scale: 1 },
      },
    ])
    const heap = () => runtime().oc.wasmMemory.buffer.byteLength
    await kernel.export(design, 'step', { stones: true })
    const before = heap()
    for (let i = 0; i < 40; i++) await kernel.export(design, 'step', { stones: true })
    // Left to the garbage collector (which cannot see WASM memory and so did not run), each
    // export kept about 4 MB: 150–200 MB over these forty. The heap grows in 20 MB steps.
    expect(heap() - before).toBeLessThan(30e6)
  }, 120_000)
})
