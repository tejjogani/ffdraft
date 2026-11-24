/**
 * Facts: the numbers rules are written in. One flat record per subject, so a rule reads
 * `0.10·W + 0.35` without knowing where W came from.
 *
 * W is the stone the subject is about: a setting's or halo's own stone, a gem itself, otherwise
 * the hero (largest) stone. The hero is always available as cW / ce / cDepth. Flags are 1 or 0.
 */
import {
  buildDesign,
  type Design,
  GEM_CUTS,
  gemDims,
  METALS,
  type Node,
  type NodeOf,
  type PieceSpecInput,
  ringInnerDiameter,
} from '@pave/schema'
import { ALLOY_CLASS, CHAIN_MASS_K, LW_BY_CUT, POINTS_BY_CUT, PRONGS_BY_CUT } from './tables'
import { FLAG_PHRASES, hasAny } from './words'

/** Every fact a rule may use, with the meaning printed in the prompt's index. */
export const FACTS = {
  W: 'girdle width of the stone in question (mm)',
  L: 'its length (mm)',
  depthPct: 'its total depth / width',
  pavPct: 'its pavilion depth / width',
  points: 'sharp points on its outline',
  round: 'round outline (1/0)',
  stepLike: 'step cut or cushion (1/0)',
  pear: 'pear-shaped (1/0)',
  pointed: 'pear, marquise or heart (1/0)',
  along: 'its extent along the band: length when turned east-west (mm)',
  cAlong: 'hero extent along the band (mm)',
  baguette: 'baguette (1/0)',
  prongsMin: 'fewest claws for its shape',
  prongsTyp: 'usual claws for its shape',
  prongsMax: 'most claws for its shape',
  lwMin: 'shortest preferred L:W for its cut',
  lwTyp: 'usual L:W for its cut',
  lwMax: 'longest preferred L:W for its cut',
  e: 'its culet clearance above the finger (mm)',
  angle: 'its angle round the band (deg)',
  hero: 'it is the largest stone (1/0)',
  cW: 'hero stone width (mm)',
  cL: 'hero stone length (mm)',
  ce: 'hero culet clearance (mm)',
  cDepth: 'hero total depth / width',
  alloy: 'alloy class: 0 pt/14k, 1 18k, 2 sterling, 3 22k+/fine silver, 4 titanium',
  density: 'metal density (g/cm³)',
  ID: 'ring inner diameter (mm)',
  bandW: 'band width at the top (mm)',
  bandWB: 'band width at the base (mm)',
  bandT: 'band thickness at the top (mm)',
  bandTB: 'band thickness at the base (mm)',
  cathedral: 'cathedral shoulders (1/0)',
  split: 'split shoulders (1/0)',
  knife: 'knife-edge profile (1/0)',
  claw: 'claw head: prong or basket (1/0)',
  basket: 'basket head (1/0)',
  bezel: 'bezel or half-bezel head (1/0)',
  wire: 'claw wire (mm)',
  prongs: 'claw count',
  taper: 'head taper',
  rails: 'gallery rails',
  wall: 'bezel wall (mm)',
  doubleTip: 'double claw tips (1/0)',
  free: 'unsupported claw length: e + pavilion + 0.4 − bandT (mm)',
  headTaper: 'taper of the head outline (0 for a bezel)',
  headWire: 'claw wire, or the bezel wall (mm)',
  halo: 'the stone has a halo (1/0)',
  haloD: 'halo melee (mm)',
  haloRows: 'halo rows',
  haloOffset: 'halo gap to the centre (mm)',
  haloGap: 'halo gap between stones (mm)',
  rowD: 'row stone size (mm)',
  rowRows: 'row count across the band',
  rowGap: 'row gap between stones (mm)',
  rowCov: 'row coverage (deg)',
  channel: 'channel-set row (1/0)',
  shared: 'shared-prong row (1/0)',
  bar: 'bar-set row (1/0)',
  head: 'the ring has a head (1/0)',
  H: 'body height (mm)',
  T: 'body thickness (mm)',
  border: 'raised border (mm)',
  paveMax: 'largest pavé stone (mm)',
  beads: 'pavé bead-set (1/0)',
  chainW: 'chain link width (mm)',
  chainWire: 'chain wire (mm)',
  chainL: 'chain length (mm)',
  cuban: 'Cuban or curb chain (1/0)',
  tennis: 'tennis chain (1/0)',
  roundChain: 'rope, box or tennis chain (1/0)',
  figaro: 'Figaro chain (1/0)',
  box: 'box chain (1/0)',
  flatLink: 'flat links: Cuban, curb or Figaro (1/0)',
  chainK: 'chain mass coefficient: mass ≈ chainK·w²·L·density/1000',
  tennisStone: 'tennis stone size: link − 0.4 (mm)',
  pendant: 'something hangs on the chain (1/0)',
  opening: 'bail opening (mm)',
  bailWire: 'bail wire (mm)',
  icedBail: 'the bail carries pavé (1/0)',
  loopBail: 'loop or hidden bail, not a ring or tube (1/0)',
  hasBody: 'the bail hangs from a body with a height (1/0)',
  sculpt: 'the main body is a sculpted mesh (1/0)',
  hollow: 'sculpt hollowed to this wall (mm, 0 solid)',
  flatBack: 'fraction sliced off the back of a sculpt',
  reliefW: 'relief width, across the finger on a signet (mm)',
  reliefH: 'relief height, along the finger on a signet (mm)',
  reliefDepth: 'relief depth (mm)',
  reliefBase: 'relief base plate (mm)',
  invert: 'relief cut in, a seal (1/0)',
  outside: 'engraving on an outer face (1/0)',
  hoopID: 'inner diameter of a closed wire (mm)',
  pipeW: 'width of the swept wire (mm)',
  bracelet: 'the piece is a bracelet (1/0)',
  earrings: 'the piece is a pair of earrings (1/0)',
  toi: 'toi-et-moi brief (1/0)',
  mens: "men's brief (1/0)",
  eastWest: 'east-west brief (1/0)',
  champion: 'championship-ring brief (1/0)',
  flushFit: 'a straight wedding band must sit flush beside it (1/0)',
  pairW: 'width of the engagement shank this band pairs with (mm)',
  pairT: 'thickness of the engagement shank this band pairs with (mm)',
  flush: 'flush-set head (1/0)',
  graduated: 'row graduates toward its ends (1/0)',
  main: 'the body is the tallest in the piece (1/0)',
} as const

export type FactKey = keyof typeof FACTS
export type Facts = Partial<Record<FactKey, number>>

type Gem = NodeOf<'gem'>
type Setting = NodeOf<'setting'>

const flag = (b: boolean): number => (b ? 1 : 0)
const nodesOf = <K extends Node['kind']>(d: Design, kind: K): NodeOf<K>[] =>
  d.order.map((id) => d.nodes[id]).filter((n): n is NodeOf<K> => n?.kind === kind)

/** The largest stone: the one a design is "about". Ties go to the first in outliner order. */
export function heroGem(d: Design): Gem | undefined {
  let best: Gem | undefined
  for (const g of nodesOf(d, 'gem')) if (!best || g.width > best.width + 1e-9) best = g
  return best
}

const settingOf = (d: Design, gemId: string) => nodesOf(d, 'setting').find((s) => s.gem === gemId)

/**
 * A stone's dimensions as the kernel builds them: an lw of exactly 1 on a cut that cannot be
 * square (the schema default) means "the cut's default", not 1 (kernel gems/index gemRatio).
 */
export function stoneDims(g: Pick<Gem, 'cut' | 'width' | 'lw'>) {
  const c = GEM_CUTS[g.cut]
  return gemDims(
    g.cut,
    g.width,
    g.lw === undefined || (g.lw === 1 && c.lw.min > 1) ? c.lw.default : g.lw,
  )
}

function stoneFacts(g: Gem): Facts {
  const cut = GEM_CUTS[g.cut]
  const dims = stoneDims(g)
  const [pMin, pTyp, pMax] = PRONGS_BY_CUT[g.cut]
  const lwBand = LW_BY_CUT[g.cut]
  const p = g.placement
  return {
    W: g.width,
    L: dims.length,
    depthPct: cut.depthPct,
    pavPct: cut.pavilionPct + cut.girdlePct / 2,
    points: POINTS_BY_CUT[g.cut],
    round: flag(cut.outline === 'round'),
    stepLike: flag(cut.style === 'step' || cut.outline === 'cushion'),
    pear: flag(g.cut === 'pear'),
    pointed: flag(g.cut === 'pear' || g.cut === 'marquise' || g.cut === 'heart'),
    along: p.type === 'ringTop' && Math.abs(Math.abs(p.spin) - 90) < 20 ? dims.length : dims.width,
    baguette: flag(g.cut === 'baguette'),
    prongsMin: pMin,
    prongsTyp: pTyp,
    prongsMax: pMax,
    // Every key is set, even to undefined, so a subject never inherits the hero's values.
    lwMin: lwBand?.[0],
    lwTyp: lwBand?.[1],
    lwMax: lwBand?.[2],
    e: p.type === 'ringTop' ? p.elevation : undefined,
    angle: p.type === 'ringTop' ? p.angle : undefined,
  }
}

function headFacts(s: Setting | undefined, g: Gem | undefined, band: Facts): Facts {
  if (!s) return {}
  const claw = s.style === 'prong' || s.style === 'basket'
  const bezel = s.style === 'bezel' || s.style === 'halfBezel'
  const out: Facts = {
    claw: flag(claw),
    basket: flag(s.style === 'basket'),
    bezel: flag(bezel),
    flush: flag(s.style === 'flush'),
    wire: s.prongDiameter,
    prongs: s.prongCount,
    taper: s.taper,
    rails: s.rails,
    wall: s.wall,
    doubleTip: flag(s.prongTip === 'double'),
    headTaper: claw ? s.taper : 0,
    headWire: claw ? s.prongDiameter : bezel ? s.wall : 0,
  }
  if (g?.placement.type === 'ringTop' && band.bandT !== undefined) {
    const cut = GEM_CUTS[g.cut]
    out.free =
      g.placement.elevation + (cut.pavilionPct + cut.girdlePct / 2) * g.width + 0.4 - band.bandT
  }
  return out
}

function bandFacts(r: NodeOf<'ringShank'> | undefined): Facts {
  if (!r) return {}
  return {
    ID: ringInnerDiameter(r.size),
    bandW: r.widthTop,
    bandWB: r.widthBottom,
    bandT: r.thicknessTop,
    bandTB: r.thicknessBottom,
    cathedral: flag(r.shoulder === 'cathedral'),
    split: flag(r.shoulder === 'split'),
    knife: flag(r.profile === 'knifeEdge'),
  }
}

function haloFacts(h: NodeOf<'halo'> | undefined): Facts {
  if (!h) return { halo: 0 }
  return {
    halo: 1,
    haloD: h.stoneWidth,
    haloRows: h.rows,
    haloOffset: h.offset,
    haloGap: h.gap,
  }
}

function rowFacts(r: NodeOf<'gemRow'> | undefined): Facts {
  if (!r) return {}
  return {
    rowD: r.stoneWidth,
    rowRows: r.rows,
    rowGap: r.gap,
    rowCov: r.coverage,
    channel: flag(r.setting === 'channel'),
    shared: flag(r.setting === 'sharedProng'),
    bar: flag(r.setting === 'bar'),
    // The kernel reads a graduateTo of exactly 1.5 (the schema default) as unset (09 §1).
    graduated: flag(
      r.graduateTo !== undefined &&
        r.graduateTo !== 1.5 &&
        Math.abs(r.graduateTo - r.stoneWidth) > 1e-9,
    ),
  }
}

function bodyFacts(n: Node | undefined): Facts {
  switch (n?.kind) {
    case 'vectorBody':
      return {
        H: n.height,
        T: n.thickness,
        border: n.border,
      }
    case 'meshBody':
      return { H: n.height, sculpt: 1, hollow: n.hollow, flatBack: n.flatBack }
    case 'relief':
      return {
        H: n.height,
        reliefW: n.width,
        reliefH: n.height,
        reliefDepth: n.depth,
        reliefBase: n.baseThickness,
        invert: flag(n.invert),
      }
    default:
      return {}
  }
}

function paveFacts(p: NodeOf<'pave'> | undefined): Facts {
  if (!p) return {}
  return {
    paveMax: p.sizeMax,
    beads: flag(p.beads),
  }
}

function chainFacts(c: NodeOf<'chain'> | undefined): Facts {
  if (!c) return {}
  return {
    chainW: c.linkWidth,
    chainWire: c.wire,
    chainL: c.length,
    cuban: flag(c.style === 'cuban' || c.style === 'curb'),
    tennis: flag(c.style === 'tennis'),
    roundChain: flag(c.style === 'rope' || c.style === 'box' || c.style === 'tennis'),
    figaro: flag(c.style === 'figaro'),
    chainK: CHAIN_MASS_K[c.style],
    box: flag(c.style === 'box'),
    flatLink: flag(c.style === 'cuban' || c.style === 'curb' || c.style === 'figaro'),
    tennisStone: c.linkWidth - 0.4,
    pendant: flag(c.through !== undefined),
  }
}

function bailFacts(d: Design, b: NodeOf<'bail'> | undefined): Facts {
  if (!b) return {}
  return {
    opening: b.opening,
    bailWire: b.wire,
    icedBail: flag(nodesOf(d, 'pave').some((p) => p.host === b.id)),
    loopBail: flag(b.style === 'loop' || b.style === 'hidden'),
  }
}

/** Inner diameter of a closed wire loop (hoops, bangles) from its path points. */
function hoopDiameter(p: NodeOf<'pipe'>): number | undefined {
  if (!p.closed || p.points.length < 3) return undefined
  const n = p.points.length
  const c = [0, 1, 2].map((k) => p.points.reduce((s, q) => s + q[k]!, 0) / n)
  const r =
    p.points.reduce((s, q) => s + Math.hypot(q[0] - c[0]!, q[1] - c[1]!, q[2] - c[2]!), 0) / n
  return 2 * r - p.width
}

function pipeFacts(p: NodeOf<'pipe'> | undefined): Facts {
  if (!p) return {}
  const id = hoopDiameter(p)
  return { pipeW: p.width, ...(id !== undefined ? { hoopID: id } : {}) }
}

/** The body a design is built around: the tallest outline, sculpt or relief. */
function mainBody(d: Design): Node | undefined {
  let best: Node | undefined
  let h = -1
  for (const id of d.order) {
    const n = d.nodes[id]
    if (
      (n?.kind === 'vectorBody' || n?.kind === 'meshBody' || n?.kind === 'relief') &&
      n.height > h
    ) {
      best = n
      h = n.height
    }
  }
  return best
}

/** Flags read from the brief's style words (PieceSpec.style or the intent's tags). */
export function styleFacts(styles: readonly string[] = []): Facts {
  return {
    toi: flag(hasAny(styles, FLAG_PHRASES.toi)),
    mens: flag(hasAny(styles, FLAG_PHRASES.mens)),
    eastWest: flag(hasAny(styles, FLAG_PHRASES.eastWest)),
    champion: flag(hasAny(styles, FLAG_PHRASES.champion)),
    flushFit: flag(hasAny(styles, FLAG_PHRASES.flushFit)),
  }
}

/** The engagement shank a wedding band is made to sit beside (09 §1 "Fit, pair"). */
export interface PairWith {
  widthMm: number
  thicknessMm: number
}

export interface FactsOptions {
  styles?: readonly string[]
  pairWith?: PairWith
}

/** Facts about the whole piece: band, hero stone and its head, halo, first row, body, chain. */
export function pieceFacts(d: Design, o: FactsOptions = {}): Facts {
  const band = bandFacts(nodesOf(d, 'ringShank')[0])
  const hero = heroGem(d)
  const heroFacts = hero ? stoneFacts(hero) : {}
  const body = mainBody(d)
  const pave = nodesOf(d, 'pave')[0]
  const metalNode = d.order.map((id) => d.nodes[id]).find((n) => n && 'material' in n)
  const material = metalNode && 'material' in metalNode ? metalNode.material : undefined
  return {
    ...band,
    ...heroFacts,
    ...(hero
      ? {
          hero: 1,
          cW: hero.width,
          cL: heroFacts.L,
          cAlong: heroFacts.along,
          cDepth: heroFacts.depthPct,
          ...(heroFacts.e !== undefined ? { ce: heroFacts.e } : {}),
        }
      : {}),
    ...headFacts(hero && settingOf(d, hero.id), hero, band),
    ...haloFacts(hero && nodesOf(d, 'halo').find((h) => h.around === hero.id)),
    ...rowFacts(nodesOf(d, 'gemRow')[0]),
    ...bodyFacts(body),
    ...paveFacts(pave),
    ...chainFacts(nodesOf(d, 'chain')[0]),
    ...bailFacts(d, nodesOf(d, 'bail')[0]),
    ...pipeFacts(nodesOf(d, 'pipe')[0]),
    head: flag(nodesOf(d, 'setting').length > 0 && d.kind === 'ring'),
    bracelet: flag(d.kind === 'bracelet'),
    earrings: flag(d.kind === 'earrings'),
    ...(material ? { alloy: ALLOY_CLASS[material], density: METALS[material].density } : {}),
    ...styleFacts(o.styles),
    ...(o.pairWith ? { pairW: o.pairWith.widthMm, pairT: o.pairWith.thicknessMm } : {}),
  }
}

/** Facts for one node: the piece facts with the node's own context laid over them. */
export function nodeFacts(d: Design, nodeId: string, piece: Facts = pieceFacts(d)): Facts {
  const n = d.nodes[nodeId]
  if (!n) return piece
  const hero = heroGem(d)
  const band = (id: string) => {
    const host = d.nodes[id]
    return bandFacts(host?.kind === 'ringShank' ? host : undefined)
  }
  const material = 'material' in n ? n.material : undefined
  const alloy = material ? { alloy: ALLOY_CLASS[material], density: METALS[material].density } : {}
  switch (n.kind) {
    case 'gem': {
      const s = settingOf(d, n.id)
      return {
        ...piece,
        ...stoneFacts(n),
        hero: flag(n.id === hero?.id),
        ...headFacts(s, n, piece),
        ...haloFacts(nodesOf(d, 'halo').find((h) => h.around === n.id)),
        ...(s ? { alloy: ALLOY_CLASS[s.material], density: METALS[s.material].density } : {}),
      }
    }
    case 'setting': {
      const g = d.nodes[n.gem]
      const gem = g?.kind === 'gem' ? g : undefined
      return {
        ...piece,
        ...(gem ? stoneFacts(gem) : {}),
        hero: flag(n.gem === hero?.id),
        ...headFacts(n, gem, piece),
        ...haloFacts(nodesOf(d, 'halo').find((h) => h.around === n.gem)),
        ...alloy,
      }
    }
    case 'halo': {
      const g = d.nodes[n.around]
      const gem = g?.kind === 'gem' ? g : undefined
      return {
        ...piece,
        ...(gem ? stoneFacts(gem) : {}),
        ...headFacts(gem && settingOf(d, gem.id), gem, piece),
        ...haloFacts(n),
        ...alloy,
      }
    }
    case 'gemRow':
      return { ...piece, ...band(n.host), ...rowFacts(n) }
    case 'ringShank':
      return { ...piece, ...bandFacts(n), ...alloy }
    case 'pave': {
      const host = d.nodes[n.host]
      return { ...piece, ...bodyFacts(host), ...paveFacts(n) }
    }
    case 'vectorBody':
    case 'meshBody':
    case 'relief': {
      const pave = nodesOf(d, 'pave').find((p) => p.host === n.id)
      return {
        ...piece,
        ...bodyFacts(n),
        // A bare body has no stones to seat: 0, not the first pavé elsewhere in the piece.
        ...(pave ? paveFacts(pave) : { paveMax: 0 }),
        main: flag(mainBody(d)?.id === n.id),
        ...alloy,
      }
    }
    case 'bail': {
      const chain = nodesOf(d, 'chain').find((c) => c.through === n.id)
      const host = n.host ? d.nodes[n.host] : undefined
      const body = bodyFacts(host)
      return {
        ...piece,
        ...body,
        hasBody: flag(body.H !== undefined),
        ...chainFacts(chain),
        ...bailFacts(d, n),
        ...alloy,
      }
    }
    case 'chain': {
      const bail = n.through ? d.nodes[n.through] : undefined
      const host = bail?.kind === 'bail' && bail.host ? d.nodes[bail.host] : undefined
      return {
        ...piece,
        ...bodyFacts(host),
        ...chainFacts(n),
        ...(bail?.kind === 'bail' ? bailFacts(d, bail) : {}),
        ...alloy,
      }
    }
    case 'engraving':
      return { ...piece, outside: flag(n.where !== 'insideBand') }
    case 'pipe':
      return { ...piece, hoopID: undefined, ...pipeFacts(n), ...alloy }
    default:
      return { ...piece, ...alloy }
  }
}

const isDesign = (x: Design | PieceSpecInput): x is Design => 'nodes' in x

/**
 * Facts of a spec (built with the plain recipe) or of a design. With `nodeId`, the facts of that
 * node's context; otherwise the piece's.
 */
export function factsOf(
  input: Design | PieceSpecInput,
  o: FactsOptions & { nodeId?: string } = {},
): Facts {
  const design = isDesign(input) ? input : buildDesign(input)
  const styles = o.styles ?? (isDesign(input) ? [] : (input.style ?? []))
  const piece = pieceFacts(design, { ...o, styles })
  return o.nodeId ? nodeFacts(design, o.nodeId, piece) : piece
}
