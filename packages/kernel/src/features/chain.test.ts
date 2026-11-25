import { applyOps, designFrom, GEM_CUT_IDS, type NodeInput } from '@pave/schema'
import type { Manifold } from 'manifold-3d'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { QUALITY } from '../core'
import { createKernel, type LocalKernel } from '../kernel'
import { runtime } from '../runtime/index'
import { manifoldFromTriangles } from '../solid/solid'
import type { ChainData } from './chain'
import { wireChain } from './chain/links'
import { tennisLink } from './chain/tennis'

let kernel: LocalKernel
beforeAll(() => {
  kernel = createKernel()
})
afterAll(() => kernel.dispose())

const STYLES = ['cable', 'curb', 'cuban', 'figaro', 'rope', 'box', 'tennis'] as const
const WIRE_STYLES = ['cable', 'curb', 'cuban', 'figaro', 'rope', 'box'] as const

/** Splits a chain body into its links (in chain order) at production detail. */
async function linksOf(node: NodeInput, extra: NodeInput[] = []) {
  const scene = await kernel.scene(designFrom('chain', [...extra, node]), { detail: 'production' })
  const result = scene.nodes.get(node.id)!
  expect(result.status).toBe('ok')
  const links = result.bodies[0]!.solid.manifold(scene.quality).decompose()
  return { scene, result, links, data: result.data as ChainData }
}

/** Largest metal shared by link i and any of the next `reach` links, over the given links. */
function worstOverlap(links: readonly Manifold[], indices: readonly number[], reach: number) {
  let worst = 0
  for (const i of indices)
    for (let k = 1; k <= reach; k++) {
      const other = links[(i + k) % links.length]!
      const shared = links[i]!.intersect(other)
      worst = Math.max(worst, shared.volume())
      shared.delete()
    }
  return worst
}

describe('chain', () => {
  it.each(STYLES)('%s: links interlock without intersecting, laid straight', async (style) => {
    const { links, data } = await linksOf({
      id: 'c',
      kind: 'chain',
      style,
      layout: 'straight',
      length: 100,
      linkWidth: 4,
      wire: 0.8,
    })
    try {
      expect(links).toHaveLength(data.links)
      // Each link against the next few — rope links thread four ahead, Cuban links reach two.
      const indices = Array.from({ length: Math.min(links.length - 5, 12) }, (_, i) => i)
      expect(worstOverlap(links, indices, style === 'rope' ? 5 : 3)).toBeLessThan(1e-6)
    } finally {
      for (const l of links) l.delete()
    }
  })

  it('Cuban: fused together, the links stay one shell each (no link runs into the next but one)', async () => {
    for (const [width, wire] of [
      [10, 2.6],
      [5, 1.3],
      [3, 0.8],
    ] as const) {
      const { links, data } = await linksOf({
        id: 'c',
        kind: 'chain',
        style: 'cuban',
        layout: 'straight',
        length: 100,
        linkWidth: width,
        wire,
      })
      const { manifold: mf } = runtime()
      const fused = mf.Manifold.union(links)
      const shells = fused.decompose()
      try {
        expect(shells).toHaveLength(data.links)
      } finally {
        for (const m of [fused, ...shells, ...links]) m.delete()
      }
    }
  })

  it.each(WIRE_STYLES.flatMap((style) => [5, 10].map((width) => [style, width] as const)))(
    '%s %d mm: neighbours stay clear on the drape’s tightest bend',
    async (style, width) => {
      const { links, data, result } = await linksOf({
        id: 'c',
        kind: 'chain',
        style,
        layout: 'drape',
        // Long enough that the drape is never tighter than the links can bend.
        length: width === 10 ? 900 : 420,
        linkWidth: width,
        wire: 0.26 * width,
      })
      expect(result.diagnostics.map((d) => d.code)).not.toContain('chain.tight')
      try {
        // Link 0 hangs at the low point, on the tightest bend; check the links either side of it.
        const n = data.links
        const around = [n - 4, n - 3, n - 2, n - 1, 0, 1, 2, 3]
        expect(worstOverlap(links, around, style === 'rope' ? 5 : 2)).toBeLessThan(1e-6)
      } finally {
        for (const l of links) l.delete()
      }
    },
    // A rope's overlap check runs about 5 s on a loaded machine, past vitest's default.
    30_000,
  )

  it.each<[string, NodeInput]>([
    [
      'cable 1.2 mm, lobster',
      {
        id: 'c',
        kind: 'chain',
        style: 'cable',
        linkWidth: 1.2,
        wire: 0.3,
        length: 457,
        clasp: 'lobster',
      },
    ],
    [
      'Cuban 10 mm, lobster',
      {
        id: 'c',
        kind: 'chain',
        style: 'cuban',
        linkWidth: 10,
        wire: 2.6,
        length: 559,
        clasp: 'lobster',
      },
    ],
    [
      'tennis 3.4 mm, box',
      {
        id: 'c',
        kind: 'chain',
        style: 'tennis',
        linkWidth: 3.4,
        wire: 0.88,
        length: 180,
        clasp: 'box',
      },
    ],
    [
      'tennis 2 mm, box',
      {
        id: 'c',
        kind: 'chain',
        style: 'tennis',
        linkWidth: 2,
        wire: 0.6,
        length: 400,
        clasp: 'box',
      },
    ],
  ])(
    'opens a draped %s clasp at the back, so it can be put on',
    async (_, node) => {
      const scene = await kernel.scene(designFrom('chain', [node]))
      const result = scene.nodes.get('c')!
      const data = result.data as ChainData
      expect(data.closed).toBe(false)
      expect(data.clasp?.style).toBe(
        (node as { style: string }).style === 'tennis' ? 'box' : 'lobster',
      )
      // A clasp no shorter than a stock one: a fine tennis line's box got 3 mm at first.
      expect(data.clasp!.length).toBeGreaterThanOrEqual(data.clasp!.style === 'box' ? 5 : 10)
      // The clasp is part of the chain's one body: its pieces (the lobster and its ring, the box
      // and its tongue) and the end links are separate shells that never touch, as links are.
      expect(result.bodies).toHaveLength(1)
      const { end0, end1 } = result.frames
      const near = (b: { min: number[]; max: number[] }) =>
        [0, 0.25, 0.5, 0.75, 1].some((t) =>
          [0, 1, 2].every((k) => {
            const p = end0!.origin[k]! + t * (end1!.origin[k]! - end0!.origin[k]!)
            return p >= b.min[k]! - 1 && p <= b.max[k]! + 1
          }),
        )
      const shells = result.bodies[0]!.solid.manifold(scene.quality).decompose()
      try {
        const here = shells.filter((m) => near(m.boundingBox() as never))
        expect(here.length).toBeGreaterThanOrEqual(4)
        for (let i = 0; i < here.length; i++)
          for (let j = i + 1; j < here.length; j++) {
            const shared = here[i]!.intersect(here[j]!)
            expect(shared.volume()).toBeLessThan(1e-6)
            shared.delete()
          }
      } finally {
        for (const m of shells) m.delete()
      }
      // Its ends are published at the back of the loop, above everything else.
      const top = result.bodies[0]!.solid.bounds().max[2]
      for (const end of [result.frames.end0!, result.frames.end1!])
        expect(end.origin[2]).toBeGreaterThan(
          top - 0.2 * (top - result.bodies[0]!.solid.bounds().min[2]),
        )
      const production = await kernel.evaluate(designFrom('chain', [node]), {
        detail: 'production',
      })
      expect(production.diagnostics.filter((d) => d.level !== 'info')).toEqual([])
    },
    120_000,
  )

  it.each([
    [3.4, 0.88, 180],
    [3, 0.9, 508],
    [2, 0.6, 400],
  ])(
    'hinges a %d mm tennis line\'s box clasp onto its end links: neither piece pulls off its link',
    async (linkWidth, wire, length) => {
      // Loose, the end link's tongue stood out into the gap with nothing to pass through, and
      // each clasp piece stood beside its link, held by nothing until a jeweler soldered it.
      const scene = await kernel.scene(
        designFrom('chain', [
          { id: 'c', kind: 'chain', style: 'tennis', linkWidth, wire, length, clasp: 'box' },
        ]),
      )
      const result = scene.nodes.get('c')!
      const { end0, end1 } = result.frames
      const o = end0!.origin
      const d = [0, 1, 2].map((k) => end1!.origin[k]! - o[k]!)
      const span = Math.hypot(...d)
      const x = d.map((v) => v / span)
      const shells = result.bodies[0]!.solid.manifold(scene.quality).decompose()
      try {
        // Each shell's reach along the clasp's chord, for those near it.
        const reach = shells
          .map((m) => {
            const { min, max } = m.boundingBox()
            const c = [0, 1, 2].map((k) => (min[k]! + max[k]!) / 2 - o[k]!)
            const along = c[0]! * x[0]! + c[1]! * x[1]! + c[2]! * x[2]!
            const off = Math.hypot(...c.map((v, k) => v - along * x[k]!))
            const ends = [0, 1, 2].map((k) => [min[k]!, max[k]!])
            const corners = ends[0]!.flatMap((a) =>
              ends[1]!.flatMap((b) =>
                ends[2]!.map(
                  (z) => (a - o[0]!) * x[0]! + (b - o[1]!) * x[1]! + (z - o[2]!) * x[2]!,
                ),
              ),
            )
            return { m, along, off, lo: Math.min(...corners), hi: Math.max(...corners) }
          })
          .filter((r) => r.off < 2 * linkWidth && r.along > -3 * linkWidth)
          .filter((r) => r.along < span + 3 * linkWidth)
        const pieces = reach.filter((r) => r.along > 0 && r.along < span)
        const box = pieces.reduce((a, b) => (b.lo < a.lo ? b : a))
        const plate = pieces.reduce((a, b) => (b.hi > a.hi ? b : a))
        expect(box).not.toBe(plate)
        const before = reach.filter((r) => r.along < 0).reduce((a, b) => (b.along > a.along ? b : a))
        const after = reach
          .filter((r) => r.along > span)
          .reduce((a, b) => (b.along < a.along ? b : a))
        /** Whether `piece`, pulled `sign` along the chord up to 2 mm, runs into `link`. */
        const caught = (piece: Manifold, link: Manifold, sign: number) => {
          for (let t = 0.05; t <= 2; t += 0.05) {
            const moved = piece.translate(x.map((v) => sign * t * v) as never)
            const shared = moved.intersect(link)
            const hit = shared.volume() > 1e-6
            for (const m of [moved, shared]) m.delete()
            if (hit) return true
          }
          return false
        }
        expect(caught(box.m, before.m, 1), 'the box pulled off the link before it').toBe(true)
        expect(caught(plate.m, after.m, -1), 'the end piece pulled off the link after it').toBe(
          true,
        )
      } finally {
        for (const m of shells) m.delete()
      }
    },
    120_000,
  )

  it.each<[string, NodeInput]>([
    [
      'cable 1.2 mm',
      { id: 'c', kind: 'chain', style: 'cable', linkWidth: 1.2, wire: 0.3, length: 457 },
    ],
    [
      'Cuban 10 mm',
      { id: 'c', kind: 'chain', style: 'cuban', linkWidth: 10, wire: 2.6, length: 559 },
    ],
    ['curb 4 mm', { id: 'c', kind: 'chain', style: 'curb', linkWidth: 4, wire: 0.88, length: 457 }],
  ])(
    'joins a %s chain\'s lobster and its ring to the end links: neither pulls off',
    async (_, node) => {
      // The lobster's eye stood 0.1 mm beside the last link, threaded through nothing, and the
      // ring it catches beside the first link on the other side.
      const scene = await kernel.scene(designFrom('chain', [{ ...node, clasp: 'lobster' }]))
      const result = scene.nodes.get('c')!
      expect((result.data as ChainData).clasp?.style).toBe('lobster')
      const { end0, end1 } = result.frames
      const o = end0!.origin
      const d = [0, 1, 2].map((k) => end1!.origin[k]! - o[k]!)
      const span = Math.hypot(...d)
      const x = d.map((v) => v / span)
      const at = (t: number) => [0, 1, 2].map((k) => o[k]! + t * x[k]!)
      const holds = (m: Manifold, p: number[]) => {
        const { min, max } = m.boundingBox()
        return [0, 1, 2].every((k) => p[k]! >= min[k]! && p[k]! <= max[k]!)
      }
      const shells = result.bodies[0]!.solid.manifold(scene.quality).decompose()
      try {
        const lobster = shells.find((m) => holds(m, at(0.3)))!
        const ring = shells.find((m) => m !== lobster && holds(m, at(span - 0.3)))!
        expect(lobster).toBeDefined()
        expect(ring).toBeDefined()
        // The links near the clasp, which a piece pulled off along the chord would run into.
        const reach = 3 * (node as { linkWidth: number }).linkWidth + 5
        const near = shells.filter((m) => {
          if (m === lobster || m === ring) return false
          const { min, max } = m.boundingBox()
          const c = [0, 1, 2].map((k) => (min[k]! + max[k]!) / 2 - o[k]!)
          const along = c[0]! * x[0]! + c[1]! * x[1]! + c[2]! * x[2]!
          return along > -reach && along < span + reach && Math.hypot(...c) < span + reach
        })
        /** Whether `piece`, pulled `sign` along the chord up to 3 mm, runs into a link. */
        const caught = (piece: Manifold, sign: number) => {
          for (let t = 0.05; t <= 3; t += 0.05) {
            const moved = piece.translate(x.map((v) => sign * t * v) as never)
            const hit = near.some((link) => {
              const shared = moved.intersect(link)
              const v = shared.volume()
              shared.delete()
              return v > 1e-6
            })
            moved.delete()
            if (hit) return true
          }
          return false
        }
        expect(caught(lobster, 1), 'the lobster pulled off its link').toBe(true)
        expect(caught(ring, -1), 'the ring pulled off its link').toBe(true)
      } finally {
        for (const m of shells) m.delete()
      }
    },
    120_000,
  )

  it('threads every link through its neighbour (pitch solver)', () => {
    for (const style of WIRE_STYLES) {
      const chain = wireChain(style, 3, 0.7)
      for (const pitch of chain.pitches) expect(pitch).toBeGreaterThan(0)
      expect(chain.wire).toBeLessThanOrEqual(0.7)
      expect(chain.minBend).toBeGreaterThanOrEqual(2 * chain.linkLength)
    }
  })

  it('takes its link count from the length: a 10 mm × 20 in Cuban has about 65 links', async () => {
    const { data } = await linksOf({
      id: 'c',
      kind: 'chain',
      style: 'cuban',
      layout: 'drape',
      length: 508,
      linkWidth: 10,
      wire: 3,
    })
    // 06-freeform.md §6: pitch ≈ L − 2·wire, so 65–70 links; the bend clearance shortens it a little.
    expect(data.links).toBeGreaterThan(55)
    expect(data.links).toBeLessThan(75)
    expect(Math.abs(data.length - 508)).toBeLessThan(10)
  })

  it('warns when a short chain closes tighter than its links can bend', async () => {
    const e = await kernel.evaluate(
      designFrom('chain', [
        { id: 'c', kind: 'chain', style: 'cuban', length: 180, linkWidth: 12, wire: 3 },
      ]),
    )
    expect(e.diagnostics.map((d) => d.code)).toContain('chain.tight')
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

  it('tennis: every cut and size makes a one-piece link that clears the next', () => {
    for (const cut of GEM_CUT_IDS)
      for (const [width, wire] of [
        [2, 0.5],
        [3.4, 0.6],
        [5, 1.3],
        [8, 2.08],
      ] as const) {
        const link = tennisLink(width, wire, cut)
        const m = manifoldFromTriangles(link.template.mesh(QUALITY.draft))
        const pieces = m.decompose()
        const next = m.translate([link.pitch, 0, 0])
        const shared = m.intersect(next)
        try {
          expect(pieces, `${cut} ${width}/${wire}`).toHaveLength(1)
          expect(shared.volume(), `${cut} ${width}/${wire}`).toBeLessThan(1e-6)
        } finally {
          for (const x of [m, next, shared, ...pieces]) x.delete()
        }
      }
  })

  it('tennis: never stones without metal, at the extremes of width and wire', async () => {
    for (const linkWidth of [0.8, 25])
      for (const wire of [0.3, 6]) {
        const e = await kernel.evaluate(
          designFrom('chain', [
            { id: 't', kind: 'chain', style: 'tennis', length: 200, linkWidth, wire },
          ]),
        )
        const label = `${linkWidth}/${wire}`
        if (e.stones.length > 0) expect(e.parts.length, label).toBe(1)
        else
          expect(e.diagnostics.find((d) => d.code === 'feature.failed')?.message, label).toMatch(
            /wider links/,
          )
      }
  })

  it('tennis: links too narrow for their hinge build at the narrowest that carries it', async () => {
    const design = designFrom('chain', [
      {
        id: 't',
        kind: 'chain',
        style: 'tennis',
        layout: 'straight',
        length: 100,
        linkWidth: 0.8,
        wire: 0.8,
      },
    ])
    const e = await kernel.evaluate(design)
    expect(e.diagnostics.map((d) => d.code)).not.toContain('feature.failed')
    expect(e.parts).toHaveLength(1)
    expect(e.stones.length).toBeGreaterThan(0)
    const raised = e.diagnostics.find((d) => d.code === 'chain.widthRaised')!
    expect(raised.level).toBe('warning')
    // The one-click fix asks for what was built; with it the warning goes.
    const fixed = await kernel.evaluate(applyOps(design, raised.fix!.ops).design)
    expect(fixed.diagnostics.map((d) => d.code)).not.toContain('chain.widthRaised')
    expect(fixed.report.metalMassG).toBeCloseTo(e.report.metalMassG, 6)
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

  it.each([0, 90])(
    'passes clear through a loop bail turned %d° once the bail check’s fix is applied',
    async (turn) => {
      let design = designFrom('pendant', [
        {
          id: 'disc',
          kind: 'primitive',
          shape: 'cylinder',
          size: [14, 14, 1.6],
          transform: { position: [0, 0, 0], rotation: [90, 0, 0], scale: 1 },
        },
        {
          id: 'bail',
          kind: 'bail',
          host: 'disc',
          style: 'loop',
          opening: 12,
          width: 3,
          transform: { position: [0, 0, 0], rotation: [0, 0, turn], scale: 1 },
        },
        {
          id: 'c',
          kind: 'chain',
          style: 'cuban',
          length: 457,
          linkWidth: 10,
          wire: 2.6,
          through: 'bail',
        },
      ])
      const codes = async () => {
        const e = await kernel.evaluate(design, { detail: 'production' })
        return { e, codes: e.diagnostics.map((d) => d.code) }
      }
      const first = await codes()
      // The recipe-sized loop is too narrow for the chain: the check says so and offers the fix.
      const small = first.e.diagnostics.find((d) => d.code === 'bail.small')
      expect(small?.fix).toBeDefined()
      design = applyOps(design, small!.fix!.ops).design
      const fixed = await codes()
      expect(fixed.codes).not.toContain('bail.small')
      expect(fixed.codes).not.toContain('chain.clash')
      // The chain threads the opening along the opening frame's x.
      const scene = await kernel.scene(design, { detail: 'draft' })
      const along = scene.nodes.get('bail')!.frames.opening!.x
      const path = (scene.nodes.get('c')!.data as ChainData).path
      const run = [0, 1, 2].map((k) => path[1]![k]! - path[0]![k]!)
      const dot = Math.abs(run[0]! * along[0] + run[1]! * along[1] + run[2]! * along[2])
      expect(dot / Math.hypot(...run)).toBeGreaterThan(0.95)
    },
  )

  it('stays cheap: hundreds of links as one body within the triangle budgets', async () => {
    const node: NodeInput = {
      id: 'c',
      kind: 'chain',
      style: 'rope',
      length: 600,
      linkWidth: 2,
      wire: 0.3,
    }
    const started = performance.now()
    const draft = await kernel.evaluate(designFrom('chain', [node]))
    expect(draft.parts).toHaveLength(1)
    expect(draft.parts[0]!.mesh.indices.length / 3).toBeLessThan(260_000)
    expect(performance.now() - started).toBeLessThan(8000)
    const production = await kernel.evaluate(designFrom('chain', [node]), { detail: 'production' })
    expect(production.parts[0]!.mesh.indices.length / 3).toBeLessThan(800_000)
    expect(production.diagnostics.map((d) => d.code)).toContain('chain.simplified')
    // Coarser copies, same metal.
    expect(production.report.metalMassG).toBeCloseTo(draft.report.metalMassG, 2)
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
