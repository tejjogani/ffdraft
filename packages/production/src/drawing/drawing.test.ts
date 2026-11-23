import { formatRingSize, ringSizeFromDiameter } from '@pave/schema'
import { describe, expect, it } from 'vitest'
import { pieceFacts } from '../facts'
import { evaluationOf, solitaireRing, templateDesign } from '../testing/fixtures'
import { box, sphere, torus } from '../testing/shapes'
import { extractAnnotations } from './dimensions'
import { hiddenLines, type SceneBody } from './hlr'
import { hatch, polylineLength, simplify } from './polyline'
import { sceneBodies } from './scene'
import { sliceBodies } from './section'
import { buildDrawingSet } from './sheet'
import { VIEWS } from './views'

const bodiesOf = (...meshes: ReturnType<typeof box>[]) =>
  sceneBodies(evaluationOf(meshes.map((mesh, i) => ({ id: `p${i}`, mesh }))))
const total = (lines: Float32Array[]) => lines.reduce((t, l) => t + polylineLength(l), 0)
/** Total length of segments whose both ends satisfy `keep`. */
const lengthWhere = (lines: Float32Array[], keep: (x: number, y: number) => boolean) => {
  let len = 0
  for (const l of lines)
    for (let i = 2; i < l.length; i += 2)
      if (keep(l[i - 2]!, l[i - 1]!) && keep(l[i]!, l[i + 1]!))
        len += Math.hypot(l[i]! - l[i - 2]!, l[i + 1]! - l[i - 1]!)
  return len
}
const allPoints = (lines: Float32Array[]) =>
  lines.flatMap((l) =>
    Array.from({ length: l.length / 2 }, (_, i): [number, number] => [l[i * 2]!, l[i * 2 + 1]!]),
  )

describe('hidden-line removal', () => {
  it('draws a box seen face-on as its square outline, with the back edges hidden', () => {
    const v = hiddenLines(bodiesOf(box([-5, -2, -5], [5, 2, 5])), VIEWS.front, { hidden: true })
    expect(total(v.metal)).toBeCloseTo(40, 0)
    // The back face's edges coincide with the front outline in projection, so they are hidden
    // behind it rather than drawn twice.
    for (const [x, y] of allPoints(v.metal))
      expect(Math.max(Math.abs(x), Math.abs(y))).toBeCloseTo(5, 2)
    expect(v.bounds).toMatchObject({ minX: -5, maxX: 5, minY: -5, maxY: 5 })
  })

  it('hides exactly the part of a rear box that the front box covers', () => {
    // Front box covers x ∈ [-2, 2]; rear box spans x ∈ [0, 6] behind it (front view looks +Y).
    const front = box([-2, -1, -2], [2, 1, 2])
    const rear = box([0, 3, -1], [6, 5, 1])
    const v = hiddenLines(bodiesOf(front, rear), VIEWS.front, { hidden: true })
    const hiddenPts = allPoints(v.hidden)
    expect(hiddenPts.length).toBeGreaterThan(0)
    // Hidden rear edges lie inside the front box's silhouette, visible ones outside it.
    for (const [x, _y] of hiddenPts) expect(x).toBeLessThanOrEqual(2.02)
    for (const [_x, y] of hiddenPts) expect(Math.abs(y)).toBeLessThanOrEqual(1.02)
    // The rear box's top edge (z = 1) is visible from x = 2 to 6 and drawn once.
    expect(lengthWhere(v.metal, (x, y) => Math.abs(y - 1) < 1e-3 && x >= 1.99)).toBeCloseTo(4, 1)
  })

  it('traces a sphere’s smooth contour as one circle', () => {
    // From above the contour is the equator, clear of the UV sphere's degenerate poles.
    const v = hiddenLines(bodiesOf(sphere(3)), VIEWS.top)
    expect(v.metal.length).toBeLessThanOrEqual(2)
    for (const [x, y] of allPoints(v.metal)) expect(Math.hypot(x, y)).toBeCloseTo(3, 1)
    expect(total(v.metal)).toBeCloseTo(2 * Math.PI * 3, 0)
  })

  it('shows a ring band from the front as two concentric circles', () => {
    const v = hiddenLines(bodiesOf(torus(9, 1)), VIEWS.front)
    const radii = allPoints(v.metal).map(([x, y]) => Math.hypot(x, y))
    expect(Math.min(...radii)).toBeCloseTo(8, 1)
    expect(Math.max(...radii)).toBeCloseTo(10, 1)
    expect(total(v.metal)).toBeCloseTo(2 * Math.PI * 18, -1)
  })

  it('cuts sections: a box sliced at x = 0 gives a closed rectangle', () => {
    const bodies: SceneBody[] = bodiesOf(box([-3, -1, -2], [3, 1, 2]))
    const cut = sliceBodies(bodies, VIEWS.section)
    expect(cut.loops).toHaveLength(1)
    expect(polylineLength(cut.loops[0]!)).toBeCloseTo(12, 1)
    const v = hiddenLines(bodies, VIEWS.section, { extra: cut.world })
    for (const [y, z] of allPoints(v.metal))
      expect(Math.abs(y) > 0.99 || Math.abs(z) > 1.99).toBe(true)
  })

  it('handles a million-triangle part in seconds', () => {
    const big = torus(9, 1, 2048, 256)
    expect(big.indices.length / 3).toBeGreaterThan(1_000_000)
    const bodies = bodiesOf(big)
    const t0 = performance.now()
    for (const id of ['front', 'side', 'top', 'iso'] as const)
      hiddenLines(bodies, VIEWS[id], { hidden: true })
    const ms = performance.now() - t0
    console.info(
      `HLR, 4 views of a ${(big.indices.length / 3 / 1e6).toFixed(2)}M-triangle part: ${ms.toFixed(0)} ms`,
    )
    expect(ms).toBeLessThan(20_000)
  })
})

describe('polylines', () => {
  it('simplifies without collapsing a polyline that doubles back', () => {
    const pts = [0, 0, 0, 1, 0, 2, 0, 3, 0, 2, 0, 1.5]
    const s = simplify(pts, 0.01)
    expect(Math.max(...Array.from(s).filter((_, i) => i % 2 === 1))).toBe(3)
  })

  it('hatches the inside of a loop only', () => {
    const square = [0, 0, 10, 0, 10, 10, 0, 10]
    const h = hatch([square], 1, 45)
    for (let i = 0; i < h.length; i += 2) {
      expect(h[i]!).toBeGreaterThanOrEqual(-1e-6)
      expect(h[i]!).toBeLessThanOrEqual(10 + 1e-6)
    }
    let len = 0
    for (let i = 0; i < h.length; i += 4)
      len += Math.hypot(h[i + 2]! - h[i]!, h[i + 3]! - h[i + 1]!)
    expect(len).toBeCloseTo(100, -1)
  })
})

describe('dimensions', () => {
  const { design, evaluation } = solitaireRing(0.2)
  const facts = pieceFacts(design, evaluation)
  const set = buildDrawingSet(evaluation, facts, {
    units: 'mm',
    stampLocation: 'inside shank',
    resolution: 1024,
  })
  const anns = set.annotations
  const linear = (view: string, caption?: string) =>
    anns.filter(
      (a) =>
        a.kind === 'linear' && a.view === view && (caption === undefined || a.caption === caption),
    )

  it('reads the ring size and band from the design', () => {
    const ring = facts.ring!
    expect(ring.innerDiameter).toBeCloseTo(16.51, 2)
    const nearest = (system: 'uk' | 'eu') =>
      formatRingSize(ringSizeFromDiameter(ring.innerDiameter, system))
    expect(ring.sizes).toEqual({ us: 'US 6', uk: nearest('uk'), eu: nearest('eu') })
    const id = anns.find((a) => a.kind === 'note' && a.lines[0]!.includes('inside'))
    expect(id?.kind === 'note' && id.lines).toEqual([
      'Ø16.51 inside',
      `US 6 · ${nearest('uk')} · ${nearest('eu')}`,
    ])
    expect(linear('section', 'band width').map((a) => a.kind === 'linear' && a.text)).toEqual([
      '2.00',
    ])
    expect(linear('section', 'base').map((a) => a.kind === 'linear' && a.text)).toEqual(['1.50'])
    expect(linear('section', 'top').map((a) => a.kind === 'linear' && a.text)).toEqual(['1.70'])
  })

  it('measures the overall envelope and head height from geometry', () => {
    const [w] = linear('front').filter((a) => a.kind === 'linear' && a.axis === 'h')
    expect(w?.kind === 'linear' && Number(w.text)).toBeCloseTo(facts.extent[0], 1)
    const head = linear('front', 'head above finger')[0]
    expect(head?.kind === 'linear' && Number(head.text)).toBeCloseTo(
      facts.bounds.max[2] - 16.507 / 2,
      1,
    )
  })

  it('keys the centre stone callout to stones.csv', () => {
    const s1 = anns.find((a) => a.kind === 'note' && a.badge === 'S1')
    expect(s1?.kind === 'note' && s1.view).toBe('top')
    expect(s1?.kind === 'note' && s1.lines[0]).toMatch(/^Ø6\.4\d$/)
  })

  it('dimensions a pendant with its bail', () => {
    const design = templateDesign('iced-initial')
    const body = box([-10, -2, -15], [10, 2, 15])
    const bail = torus(3, 0.6)
    const ev = evaluationOf([
      { id: 'body', mesh: body },
      {
        id: 'bail',
        mesh: { ...bail, positions: bail.positions.map((v, i) => (i % 3 === 2 ? v + 17 : v)) },
      },
    ])
    const f = pieceFacts(design, ev)
    const s = buildDrawingSet(ev, f, { units: 'mm', stampLocation: 'back', resolution: 512 })
    const notes = s.annotations
      .filter((a) => a.kind === 'note')
      .map((a) => (a.kind === 'note' ? a.lines[0] : ''))
    expect(notes).toContain('Bail opening 5.00')
    const bodyH = s.annotations.find((a) => a.kind === 'linear' && a.caption === 'body')
    expect(bodyH?.kind === 'linear' && bodyH.text).toBe('30.00')
    const overall = s.annotations.find(
      (a) => a.kind === 'linear' && a.caption === 'overall incl. bail',
    )
    expect(overall?.kind === 'linear' && Number(overall.text)).toBeCloseTo(35.6, 1)
  })

  it('stays consistent with extractAnnotations for inches', () => {
    const inch = extractAnnotations({
      facts,
      evaluation,
      views: set.views,
      units: 'in',
      stampLocation: 'x',
    })
    const band = inch.find((a) => a.kind === 'linear' && a.caption === 'band width')
    expect(band?.kind === 'linear' && band.text).toBe('0.079 [2.00]')
  })
})
