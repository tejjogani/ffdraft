/**
 * Derived quantities rules lint instead of raw parameters (research 09, "Decisions": lint table
 * drop, halo outline, stone count, mass per ear, not the inputs that produce them). Each reads the
 * document, the subject's facts and, where it needs evaluated numbers, the kernel summary.
 */
import {
  type Design,
  type EvaluationSummary,
  GEM_CUTS,
  GEM_MATERIALS,
  type GemMaterialId,
  METALS,
  type MetalId,
  type Node,
  type NodeOf,
  type PlatingId,
} from '@pave/schema'
import { type FactKey, type Facts, heroGem, stoneDims } from './facts'
import { METAL_COLOUR, WEAR_CLASS } from './tables'

export interface MeasureContext {
  design: Design
  facts: Facts
  node?: Node
  summary?: EvaluationSummary
}
export type Measured = { value: number; nodeId?: string } | undefined
export type Measure = (c: MeasureContext) => Measured

const nodes = (d: Design): Node[] => d.order.flatMap((id) => (d.nodes[id] ? [d.nodes[id]] : []))
const ofKind = <K extends Node['kind']>(d: Design, kind: K) =>
  nodes(d).filter((n): n is NodeOf<K> => n.kind === kind)
const metalNodes = (d: Design) =>
  nodes(d).filter((n): n is Extract<Node, { material: MetalId }> => 'material' in n && n.visible)
/** The facts with these keys known, or undefined. */
const need = <K extends FactKey>(
  f: Facts,
  ...keys: K[]
): (Facts & Record<K, number>) | undefined =>
  keys.every((k) => f[k] !== undefined) ? (f as Facts & Record<K, number>) : undefined
const count = (items: { id: string }[]): Measured =>
  items.length ? { value: items.length, nodeId: items[0]!.id } : { value: 0 }

/** Colour as worn: plating changes what the eye sees. */
export function seenColour(material: MetalId, plating: PlatingId): string {
  if (plating === 'rhodium') return 'white'
  if (plating === 'black-rhodium') return 'black'
  if (plating === 'yellow-vermeil') return 'yellow'
  if (plating === 'rose-vermeil') return 'rose'
  return METAL_COLOUR[material]
}

const COLOURLESS: readonly GemMaterialId[] = [
  'diamond',
  'diamond-lab',
  'moissanite',
  'cz',
  'sapphire-white',
]
const GRADES = 'DEFGHIJKLMNOPQRSTUVWXYZ'
const grade = (c: string) => GRADES.indexOf(c.trim().toUpperCase()[0] ?? '')

/** Half the stone's extent along the band: its length when turned east-west. */
const alongBand = (g: NodeOf<'gem'>) => {
  const dims = stoneDims(g)
  const spin = g.placement.type === 'ringTop' ? Math.abs(g.placement.spin) : 0
  return (Math.abs(spin - 90) < 20 ? dims.length : dims.width) / 2
}

/** Plan-view girdle gap between two stones on the same band, the first at the top. */
function planGap(a: NodeOf<'gem'>, b: NodeOf<'gem'>, innerRadius: number): number | undefined {
  if (a.placement.type !== 'ringTop' || b.placement.type !== 'ringTop') return undefined
  const cut = GEM_CUTS[b.cut]
  const r = innerRadius + b.placement.elevation + (cut.pavilionPct + cut.girdlePct / 2) * b.width
  const theta = (Math.abs(b.placement.angle - a.placement.angle) * Math.PI) / 180
  return r * Math.sin(theta) - alongBand(b) * Math.cos(theta) - alongBand(a)
}

const faceArea = (g: NodeOf<'gem'>) => {
  const dims = stoneDims(g)
  return dims.width * dims.length
}

/** How far a vectorBody's field floor is recessed (kernel: vectorBody recessFor). */
const recess = (border: number, thickness: number) =>
  Math.min(Math.max(0.8 * border, 0.3), 0.6, thickness / 3)

/** The chain's mass from the kernel-calibrated coefficient of its style (tables.ts). */
function chainMass(f: Facts): number | undefined {
  const g = need(f, 'chainW', 'chainL', 'density', 'chainK')
  return g && (g.chainK * g.chainW * g.chainW * g.chainL * g.density) / 1000
}

/** Grams per mm of solid-equivalent thickness for a silhouette of about half H² (09 §2 Mass). */
const silhouetteMass = (H: number, density: number) => (0.5 * H * H * density) / 1000

/**
 * What hangs on the chain: the evaluated metal less the chain, or, before evaluation, an
 * estimate from the body (a relief's plate and half its relief; an outline at half H²).
 */
function pendantMass({ design, facts, summary }: MeasureContext): number | undefined {
  if (summary) {
    const chain = chainMass(facts) ?? 0
    const m = summary.metalMassG - chain
    return m > 0 ? m : undefined
  }
  const body = ofKind(design, 'relief')[0] ?? ofKind(design, 'vectorBody')[0]
  if (!body) return undefined
  const density = METALS[body.material].density
  if (body.kind === 'relief')
    return (
      ((Math.PI / 4) * body.width * body.height * (body.baseThickness + 0.5 * body.depth) * density) /
      1000
    )
  return silhouetteMass(body.height, density) * body.thickness * 0.9
}

export const MEASURES: Record<string, Measure> = {
  tableHeight: ({ facts }) => {
    const f = need(facts, 'e', 'depthPct', 'W')
    return f && { value: f.e + f.depthPct * f.W }
  },

  prongCoverage: ({ facts }) => {
    const f = need(facts, 'prongs', 'wire', 'W', 'L')
    return f && { value: (f.prongs * f.wire) / ((Math.PI * (f.W + f.L)) / 2) }
  },

  clawOffset: ({ node }) => {
    if (node?.kind !== 'setting') return undefined
    const step = 180 / node.prongCount
    const base = node.prongCount % 2 === 0 ? 0 : 90 % step
    const off = (((node.prongSpin - base) % step) + step) % step
    return { value: Math.min(off, step - off) }
  },

  freeRatio: ({ facts }) => {
    const f = need(facts, 'free', 'wire')
    return f && { value: f.free / f.wire }
  },

  euroBase: ({ node }) =>
    node?.kind === 'ringShank' ? { value: node.baseShape === 'euro' ? 1 : 0 } : undefined,

  stoneToFinger: ({ facts }) => {
    const f = need(facts, 'cW', 'ID')
    return f && { value: f.cW / f.ID }
  },

  headToFinger: ({ facts }) => {
    const f = need(facts, 'cW', 'ID')
    if (!f) return undefined
    const h = f.halo ? need(f, 'haloOffset', 'haloRows', 'haloD') : undefined
    const across = h
      ? f.cW + 2 * (h.haloOffset + h.haloRows * h.haloD + 0.25)
      : f.cW + 2 * (f.headWire ?? 0)
    return { value: across / f.ID }
  },

  haloOutline: ({ facts }) => {
    const f = need(facts, 'W', 'haloOffset', 'haloRows', 'haloD', 'haloGap')
    return (
      f && {
        value:
          (f.W + 2 * (f.haloOffset + f.haloRows * f.haloD + (f.haloRows - 1) * f.haloGap + 0.25)) /
          f.W,
      }
    )
  },

  meleeStep: ({ design }) => {
    const halo = ofKind(design, 'halo')[0]
    const row = ofKind(design, 'gemRow')[0]
    if (!halo || !row) return undefined
    const step = Math.abs(halo.stoneWidth - row.stoneWidth)
    return { value: step > 0.1 + 1e-9 && step < 0.4 - 1e-9 ? 1 : 0, nodeId: row.id }
  },

  tableDrop: ({ facts }) => {
    const f = need(facts, 'ID', 'ce', 'cDepth', 'cW', 'e', 'depthPct', 'W', 'angle')
    if (!f) return undefined
    const r = f.ID / 2
    const centre = r + f.ce + f.cDepth * f.cW
    const side = (r + f.e + f.depthPct * f.W) * Math.cos((f.angle * Math.PI) / 180)
    return { value: centre - side }
  },

  sideGap: ({ design, node, facts }) => {
    const hero = heroGem(design)
    const f = need(facts, 'ID')
    if (node?.kind !== 'gem' || !hero || !f) return undefined
    const gap = planGap(hero, node, f.ID / 2)
    return gap === undefined ? undefined : { value: gap }
  },

  heroGap: ({ design, facts }) => {
    const hero = heroGem(design)
    const f = need(facts, 'ID')
    if (!hero || !f) return undefined
    let best: Measured
    for (const g of ofKind(design, 'gem')) {
      if (g.id === hero.id) continue
      const gap = planGap(hero, g, f.ID / 2)
      if (gap !== undefined && (!best || gap < best.value)) best = { value: gap, nodeId: g.id }
    }
    return best
  },

  facetMismatch: ({ design, node }) => {
    const hero = heroGem(design)
    if (node?.kind !== 'gem' || !hero) return undefined
    const family = (cut: NodeOf<'gem'>['cut']) =>
      GEM_CUTS[cut].style === 'step' ? 'step' : 'bright'
    const excepted = node.cut === 'baguette' && family(hero.cut) === 'bright'
    return { value: !excepted && family(node.cut) !== family(hero.cut) ? 1 : 0 }
  },

  rowExcess: ({ facts }) => {
    const f = need(facts, 'rowRows', 'rowD', 'rowGap', 'bandW')
    return f && { value: f.rowRows * f.rowD + (f.rowRows - 1) * f.rowGap + 1.0 - f.bandW }
  },

  flatProfile: ({ node }) =>
    node?.kind === 'ringShank'
      ? { value: node.profile === 'flat' || node.profile === 'flatCourt' ? 1 : 0 }
      : undefined,

  wideFlatInterior: ({ design }) => {
    const r = ofKind(design, 'ringShank')[0]
    if (!r) return undefined
    return { value: (r.profile === 'dShape' || r.profile === 'flat') && r.widthTop >= 6 ? 1 : 0 }
  },

  massG: ({ summary }) => (summary ? { value: summary.metalMassG } : undefined),

  poorOpenHead: ({ design }) =>
    count(
      ofKind(design, 'setting').filter((s) => {
        const g = design.nodes[s.gem]
        return (
          (s.style === 'prong' || s.style === 'basket') &&
          g?.kind === 'gem' &&
          WEAR_CLASS[g.stone] === 2
        )
      }),
    ),

  softestInPave: ({ design }) => {
    const flushGems = ofKind(design, 'setting')
      .filter((s) => s.style === 'flush')
      .map((s) => design.nodes[s.gem])
      .filter((g): g is NodeOf<'gem'> => g?.kind === 'gem')
    const set = [
      ...ofKind(design, 'pave'),
      ...ofKind(design, 'gemRow'),
      ...ofKind(design, 'halo'),
      ...flushGems,
    ]
    let best: Measured
    for (const n of set) {
      const mohs = GEM_MATERIALS[n.stone].mohs
      if (!best || mohs < best.value) best = { value: mohs, nodeId: n.id }
    }
    return best
  },

  pearlNotCup: ({ design }) =>
    count(
      ofKind(design, 'setting').filter((s) => {
        const g = design.nodes[s.gem]
        return g?.kind === 'gem' && g.stone === 'pearl' && s.style !== 'bezel'
      }),
    ),

  secondStone: ({ design }) => {
    // Cluster petals (a polar pattern's sources, 09 §5 Victorian and Celestial) are one motif
    // round the hero, not rivals to it.
    const petals = new Set(
      ofKind(design, 'pattern')
        .filter((p) => p.type === 'polar')
        .flatMap((p) => p.sources),
    )
    const gems = ofKind(design, 'gem')
      .filter((g) => !petals.has(g.id))
      .sort((a, b) => b.width - a.width)
    const second = gems[1]
    return second ? { value: second.width, nodeId: second.id } : undefined
  },

  meleeColourGap: ({ design }) => {
    const hero = heroGem(design)
    const heroColours = hero?.quality?.colors?.map(grade).filter((g) => g >= 0) ?? []
    if (!heroColours.length) return undefined
    const best = Math.min(...heroColours)
    let worst: Measured
    for (const n of [
      ...ofKind(design, 'halo'),
      ...ofKind(design, 'gemRow'),
      ...ofKind(design, 'pave'),
    ]) {
      for (const g of n.quality?.colors?.map(grade).filter((x) => x >= 0) ?? [])
        if (!worst || g - best > worst.value) worst = { value: g - best, nodeId: n.id }
    }
    return worst
  },

  colourlessInYellowHead: ({ design }) =>
    count(
      ofKind(design, 'setting').filter((s) => {
        const g = design.nodes[s.gem]
        return (
          g?.kind === 'gem' &&
          COLOURLESS.includes(g.stone) &&
          seenColour(s.material, s.plating) === 'yellow'
        )
      }),
    ),

  softMicroSetting: ({ design }) => {
    const soft = (id: string) => {
      const n = design.nodes[id]
      return (
        !!n &&
        'material' in n &&
        ['au22k-yellow', 'au24k-yellow', 'ag999-fine'].includes(n.material)
      )
    }
    return count([
      ...ofKind(design, 'gemRow').filter(
        (r) => soft(r.host) && (r.setting === 'sharedProng' || r.stoneWidth < 1.3),
      ),
      ...ofKind(design, 'pave').filter((p) => soft(p.host) && p.sizeMax < 1.3),
      ...ofKind(design, 'halo').filter((h) => soft(h.id)),
    ])
  },

  titaniumRing: ({ design }) =>
    count(ofKind(design, 'ringShank').filter((r) => r.material === 'ti-grade5')),

  metalColours: ({ design }) => ({
    value: new Set(metalNodes(design).map((n) => seenColour(n.material, n.plating))).size,
  }),

  finishCount: ({ design }) => ({ value: new Set(metalNodes(design).map((n) => n.finish)).size }),

  tipFamilies: ({ design }) => ({
    value: new Set(
      ofKind(design, 'setting')
        .filter((s) => s.style === 'prong' || s.style === 'basket')
        .map((s) => s.prongTip),
    ).size,
  }),

  motifTwice: ({ design }) =>
    count(ofKind(design, 'pattern').filter((p) => p.type !== 'mirror' && p.count === 2)),

  mixedToneUnion: ({ design }) =>
    count(
      ofKind(design, 'boolean').filter((b) => {
        if (b.op !== 'union') return false
        const tones = new Set(
          [b.target, ...b.tools].flatMap((id) => {
            const n = design.nodes[id]
            return n && 'material' in n ? [seenColour(n.material, n.plating)] : []
          }),
        )
        return tones.size > 1
      }),
    ),

  whiteGoldBare: ({ design }) =>
    count(
      metalNodes(design).filter(
        (n) =>
          METALS[n.material].family === 'gold' &&
          METAL_COLOUR[n.material] === 'white' &&
          n.plating === 'none',
      ),
    ),

  czOnPrecious: ({ design }) => {
    const precious = metalNodes(design).some((n) =>
      ['gold', 'platinum', 'palladium'].includes(METALS[n.material].family),
    )
    const stones = nodes(design).filter(
      (n): n is Extract<Node, { stone: GemMaterialId }> => 'stone' in n && n.stone === 'cz',
    )
    return precious ? count(stones) : { value: 0 }
  },

  bailRatio: ({ node, facts }) => {
    const f = need(facts, 'H')
    return node?.kind === 'bail' && f ? { value: (node.opening + 2 * node.wire) / f.H } : undefined
  },

  bailToStone: ({ node, facts }) => {
    const f = need(facts, 'cW')
    return node?.kind === 'bail' && f ? { value: (node.opening + 2 * node.wire) / f.cW } : undefined
  },

  loopOnChain: ({ node }) =>
    node?.kind === 'bail'
      ? { value: node.style === 'loop' ? 1 : 0 }
      : undefined,

  chainToPendantMass: ({ facts, summary }) => {
    const chain = chainMass(facts)
    if (!summary || chain === undefined) return undefined
    const pendant = summary.metalMassG - chain
    return pendant > 0 ? { value: chain / pendant } : undefined
  },

  pendantMass: (c) => {
    const m = pendantMass(c)
    return m === undefined ? undefined : { value: m }
  },

  pendantDepth: ({ summary, facts }) =>
    // Pendants face −Y and the chain drapes in XZ, so the summary's Y extent is the body depth.
    summary && facts.H !== undefined ? { value: summary.boundsMm.y } : undefined,

  solidEquivalent: (c) => {
    const m = pendantMass(c)
    const f = need(c.facts, 'H', 'density')
    if (m === undefined || !f || !c.summary) return undefined
    return { value: m / silhouetteMass(f.H, f.density) }
  },

  pendantHeight: ({ facts }) => (facts.H === undefined ? undefined : { value: facts.H }),

  metalUnderPave: ({ design, node }) => {
    if (node?.kind !== 'pave') return undefined
    const host = design.nodes[node.host]
    if (host?.kind !== 'vectorBody') return undefined
    return { value: host.thickness - recess(host.border, host.thickness), nodeId: host.id }
  },

  paveEdge: ({ design, node }) => {
    if (node?.kind !== 'pave') return undefined
    const host = design.nodes[node.host]
    return host?.kind === 'vectorBody' ? { value: host.border + node.margin } : undefined
  },

  bodyHeight: ({ facts }) => (facts.H === undefined ? undefined : { value: facts.H }),

  levelStep: ({ design }) => {
    const bodies = ofKind(design, 'vectorBody').filter((b) => b.visible)
    if (bodies.length < 2) return undefined
    // Outline bodies face −Y with their back on y = 0: the front lies at y − thickness.
    const fronts = [
      ...new Set(
        bodies.map((b) => {
          const t = b.transform
          return Number(((t?.position[1] ?? 0) - b.thickness * (t?.scale ?? 1)).toFixed(2))
        }),
      ),
    ].sort((a, b) => a - b)
    if (fronts.length < 2) return undefined
    let step = Number.POSITIVE_INFINITY
    for (let i = 1; i < fronts.length; i++) step = Math.min(step, fronts[i]! - fronts[i - 1]!)
    return { value: step }
  },

  eastWestSpan: ({ node }) => (node?.kind === 'gem' ? { value: alongBand(node) * 2 } : undefined),

  areaBalance: ({ design }) => {
    const gems = ofKind(design, 'gem').sort((a, b) => faceArea(b) - faceArea(a))
    const [a, b] = gems
    return a && b ? { value: faceArea(b) / faceArea(a), nodeId: b.id } : undefined
  },

  martiniStone: ({ facts }) => (facts.W === undefined ? undefined : { value: facts.W }),

  massPerEar: ({ summary }) =>
    summary ? { value: (summary.metalMassG + 0.2 * summary.caratTotal) / 2 } : undefined,

  hoopDiameter: ({ facts }) => (facts.hoopID === undefined ? undefined : { value: facts.hoopID }),
}
