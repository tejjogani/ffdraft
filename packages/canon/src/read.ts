/**
 * Design reads (research 09 §6): what a piece is, in ratios and categoricals, so a reference and
 * a design can be compared field by field. `readDesign` reads the document itself (no vision).
 */
import {
  type Archetype,
  type Design,
  type EvaluationSummary,
  GEM_CUTS,
  type Node,
  type NodeOf,
} from '@pave/schema'
import { bandFor, whenHolds } from './engine'
import { type Facts, heroGem, nodeFacts, pieceFacts } from './facts'
import { MEASURES, seenColour } from './measures'
import { type DesignRead, RATIO_KEYS, type RatioKey, VARIANTS, type Variant, VIEWS } from './model'
import { RULES_BY_ID } from './rules/index'

const all = (d: Design): Node[] => d.order.flatMap((id) => (d.nodes[id] ? [d.nodes[id]] : []))
const ofKind = <K extends Node['kind']>(d: Design, kind: K) =>
  all(d).filter((n): n is NodeOf<K> => n.kind === kind)

/** The closest archetype for a design with no spec: the construction, not the style. */
export function inferArchetype(d: Design): Archetype {
  const gems = ofKind(d, 'gem')
  const has = (k: Node['kind']) => all(d).some((n) => n.kind === k)
  const row = ofKind(d, 'gemRow')[0]
  const flushOnly = ofKind(d, 'setting').every((s) => s.style === 'flush')
  switch (d.kind) {
    case 'ring':
      if (has('relief')) return 'signet'
      if (gems.length === 0) return row && row.coverage >= 299 ? 'eternity' : 'band'
      if (flushOnly) return 'band'
      if (has('halo')) return 'halo'
      if (gems.filter((g) => g.placement.type === 'ringTop').length === 3) return 'threeStone'
      return gems.length === 1 ? 'solitaire' : 'custom'
    case 'earrings':
      return has('pipe') ? 'custom' : 'studs'
    case 'chain':
    case 'bracelet':
    case 'necklace': {
      if (has('vectorBody') || has('meshBody') || has('relief')) break
      const chain = ofKind(d, 'chain')[0]
      if (chain?.style === 'tennis') return 'tennis'
      if (chain?.style === 'cuban' || chain?.style === 'curb') return 'cuban'
      return 'custom'
    }
  }
  if (has('pave')) return 'icedPendant'
  if (has('relief')) return 'medallion'
  // An un-iced outline body (a name, logo or tag) is built like a name pendant.
  if (has('vectorBody')) return 'namePendant'
  if (gems.length && has('setting')) return 'pendantSolitaire'
  return 'custom'
}

/** The rule whose variants classify each archetype's scale (research 09 §1–3 variant tables). */
const VARIANT_RULE: Partial<Record<Archetype, string>> = {
  solitaire: 'ring.solitaire.bandWidth',
  halo: 'ring.solitaire.bandWidth',
  threeStone: 'threeStone.sideSize',
  eternity: 'rows.eternityScale',
  band: 'band.plain.width',
  icedPendant: 'iced.height',
  studs: 'earring.stud.size',
  tennis: 'chain.tennis.link',
  cuban: 'chain.cuban.width',
}

const mensBand = 'band.mens.width'

/** The variant whose band holds the design's defining number; nearest typical otherwise. */
function variantOf(d: Design, archetype: Archetype, facts: Facts): Variant {
  const id = archetype === 'band' && facts.mens ? mensBand : VARIANT_RULE[archetype]
  const rule = id ? RULES_BY_ID.get(id) : undefined
  if (!rule?.variants) return 'classic'
  const subject =
    rule.applies.nodeKind === 'gem' && archetype === 'threeStone'
      ? ofKind(d, 'gem').find((g) => g.id !== heroGem(d)?.id)
      : rule.applies.nodeKind
        ? all(d).find((n) => n.kind === rule.applies.nodeKind)
        : undefined
  const f = subject ? nodeFacts(d, subject.id, facts) : facts
  if (!whenHolds(rule, f)) return 'classic'
  const value = rule.measure
    ? MEASURES[rule.measure]?.({ design: d, facts: f, node: subject })?.value
    : subject && rule.paths[0]
      ? (() => {
          const field = rule.paths[0]!.split('.').slice(1)
          let v: unknown = subject
          for (const f of field)
            v = v && typeof v === 'object' ? (v as Record<string, unknown>)[f] : undefined
          return typeof v === 'number' ? v : undefined
        })()
      : undefined
  if (value === undefined) return 'classic'
  let best: { v: Variant; inside: boolean; dist: number } | undefined
  for (const variant of VARIANTS) {
    const b = bandFor(rule, f, variant)
    if (!b) continue
    const inside = value >= b.min - 1e-6 && value <= b.max + 1e-6
    const dist = Math.abs(value - b.typical)
    if (!best || (inside && !best.inside) || (inside === best.inside && dist < best.dist))
      best = { v: variant, inside, dist }
  }
  return best?.v ?? 'classic'
}

export interface ReadOptions {
  source?: DesignRead['source']
  archetype?: Archetype
  styles?: readonly string[]
}

const r2 = (x: number) => Number(x.toFixed(3))
const ratio = (value: number | undefined) =>
  value === undefined || !Number.isFinite(value) ? undefined : { value: r2(value), confidence: 1 }

/** Reads a design from its document: exact ratios, categoricals, what it is made of. */
export function readDesign(
  d: Design,
  summary?: EvaluationSummary,
  o: ReadOptions = {},
): DesignRead {
  const f = pieceFacts(d, { styles: o.styles })
  const archetype = o.archetype ?? inferArchetype(d)
  const hero = heroGem(d)
  const head = hero && ofKind(d, 'setting').find((s) => s.gem === hero.id)
  const shank = ofKind(d, 'ringShank')[0]
  const row = ofKind(d, 'gemRow')[0]
  const second = ofKind(d, 'gem').sort((a, b) => b.width - a.width)[1]
  const metals = all(d).filter(
    (n): n is Extract<Node, { material: unknown }> & Node => 'material' in n,
  )
  const colours = [
    ...new Set(metals.map((n) => ('material' in n ? seenColour(n.material, n.plating) : ''))),
  ]
  const finishes = [...new Set(metals.map((n) => ('finish' in n ? n.finish : '')))]
  const halo = MEASURES.haloOutline?.({ design: d, facts: { ...f } })?.value
  const ratios: Partial<Record<RatioKey, { value: number; confidence: number }>> = {}
  const set = (k: RatioKey, v: number | undefined) => {
    const r = ratio(v)
    if (r) ratios[k] = r
  }
  if (f.cW !== undefined) {
    set('stoneToFinger', f.ID && f.cW / f.ID)
    set('bandToStone', f.bandW && f.bandW / f.cW)
    set(
      'tableHeightToStone',
      f.ce !== undefined && f.cDepth !== undefined ? (f.ce + f.cDepth * f.cW) / f.cW : undefined,
    )
    set('haloToStone', f.halo ? halo : undefined)
    set('sideToCenter', second && second.width / f.cW)
    set(
      'prongToStone',
      head && (head.style === 'prong' || head.style === 'basket')
        ? head.prongDiameter / f.cW
        : undefined,
    )
  }
  set('taperTopToBottom', f.bandW && f.bandWB ? f.bandW / f.bandWB : undefined)
  if (f.H) {
    set('chainToPendant', f.chainW && f.pendant ? f.chainW / f.H : undefined)
    set(
      'bailToPendant',
      f.opening !== undefined && f.bailWire !== undefined
        ? (f.opening + 2 * f.bailWire) / f.H
        : undefined,
    )
    set('thicknessToHeight', f.T && f.T / f.H)
  }
  const profile: DesignRead['silhouette']['profile'] =
    f.ce === undefined || f.bandT === undefined
      ? 'classic'
      : f.ce < f.bandT + 0.2
        ? 'low'
        : f.ce > f.bandT + 1.2
          ? 'high'
          : 'classic'
  const outline = hero
    ? GEM_CUTS[hero.cut].outline
    : (ofKind(d, 'vectorBody')[0]?.source.type ??
      ofKind(d, 'chain')[0]?.style ??
      ofKind(d, 'relief')[0]?.outline ??
      d.kind)
  const mirrored = ofKind(d, 'pattern').some((p) => p.type === 'mirror')
  const words = (o.styles ?? []).map((s) => s.toLowerCase())
  const symmetry: DesignRead['silhouette']['symmetry'] = words.some(
    (w) => w.includes('nouveau') || w.includes('toi'),
  )
    ? 'asymmetric'
    : hero && GEM_CUTS[hero.cut].outline === 'round' && !second && !mirrored
      ? 'radial'
      : 'bilateral'
  // Each stone with the kernel lots that are its own, in the kernel's vocabulary (gems: any
  // role; halos and rows: accent; pavé: melee; tennis: four-prong), matched on cut and size.
  const near = (a: number, b: number) => Math.abs(a - b) < 0.011
  type Lot = EvaluationSummary['lots'][number]
  const read: (DesignRead['stones'][number] & { mine: (l: Lot) => boolean })[] = [
    ...ofKind(d, 'gem').map((g) => ({
      role: g.id === hero?.id ? 'center' : 'side',
      cut: g.cut,
      setting: ofKind(d, 'setting').find((s) => s.gem === g.id)?.style ?? 'loose',
      mine: (l: Lot) => l.cut === g.cut && near(l.width, g.width) && l.role !== 'melee',
    })),
    ...ofKind(d, 'halo').map((h) => ({
      role: 'halo',
      cut: h.cut,
      setting: 'halo',
      mine: (l: Lot) => l.cut === h.cut && l.role === 'accent' && near(l.width, h.stoneWidth),
    })),
    ...ofKind(d, 'gemRow').map((r) => ({
      role: 'accent',
      cut: r.cut,
      setting: r.setting,
      mine: (l: Lot) =>
        l.cut === r.cut &&
        l.role === 'accent' &&
        l.setting === r.setting &&
        l.width <= r.stoneWidth + 0.011 &&
        l.width >= Math.min(r.stoneWidth, r.graduateTo ?? r.stoneWidth) - 0.011,
    })),
    ...ofKind(d, 'pave').map((p) => ({
      role: 'pave',
      cut: p.cut,
      setting: 'pave',
      mine: (l: Lot) =>
        l.cut === p.cut &&
        l.role === 'melee' &&
        l.width >= p.sizeMin - 0.011 &&
        l.width <= p.sizeMax + 0.011,
    })),
    ...ofKind(d, 'chain')
      .filter((c) => c.style === 'tennis')
      .map((c) => ({
        role: 'accent',
        cut: c.cut,
        setting: 'tennis',
        mine: (l: Lot) => l.cut === c.cut && l.setting === 'four-prong',
      })),
  ]
  // A lot two stones could own (a halo and a row of one size) is counted for neither.
  const owners = (l: Lot) => read.filter((r) => r.mine(l)).length
  const stones: DesignRead['stones'] = read.map(({ mine, ...s }) => {
    const lots = summary?.lots.filter((l) => mine(l) && owners(l) === 1) ?? []
    return lots.length ? { ...s, count: lots.reduce((n, l) => n + l.count, 0) } : s
  })
  const motifs = [
    f.halo ? (f.haloRows && f.haloRows > 1 ? 'double halo' : 'halo') : undefined,
    row ? (row.coverage >= 299 ? 'eternity row' : 'stone shoulders') : undefined,
    shank && shank.shoulder !== 'plain' ? `${shank.shoulder} shoulders` : undefined,
    archetype === 'threeStone' ? 'three stones' : undefined,
    ofKind(d, 'vectorBody').length > 1 ? 'stacked levels' : undefined,
  ].filter((m): m is string => !!m)
  const distinctive = [
    head && (head.style === 'prong' || head.style === 'basket')
      ? `${head.prongCount} ${head.prongTip} claws`
      : head
        ? `${head.style} head`
        : undefined,
    f.eastWest ? 'east-west' : undefined,
    colours.length > 1 ? 'two-tone' : undefined,
  ].filter((m): m is string => !!m)
  return {
    source: o.source ?? 'ownDesign',
    viewsSeen: VIEWS.filter((v) => v !== 'onBody'),
    scaleAnchor: shank ? 'ringSize' : hero ? 'stoneMm' : 'none',
    kind: d.kind,
    archetype,
    variant: variantOf(d, archetype, f),
    silhouette: { topOutline: outline, profile, symmetry },
    ratios,
    ...(hero
      ? {
          centre: {
            cut: hero.cut,
            lw: r2(f.cL && f.cW ? f.cL / f.cW : 1),
            setting: head?.style ?? 'loose',
            ...(head && (head.style === 'prong' || head.style === 'basket')
              ? { prongCount: head.prongCount, prongTip: head.prongTip }
              : {}),
            orientation:
              f.eastWest ||
              (hero.placement.type === 'ringTop' &&
                Math.abs(Math.abs(hero.placement.spin) - 90) < 20)
                ? 'EW'
                : 'NS',
          },
        }
      : {}),
    stones,
    ...(shank
      ? {
          shank: {
            profile: shank.profile,
            shoulder: shank.shoulder,
            split: shank.shoulder === 'split',
            ...(row ? { coverageDeg: row.coverage } : {}),
          },
        }
      : {}),
    metal: { colours, finishes, twoTone: colours.length > 1 },
    motifs: motifs.slice(0, 3),
    styleTags: [...(o.styles ?? [])],
    mood: [],
    distinctive: distinctive.slice(0, 3),
    notVisible: [],
    uncertain: [],
  }
}

export interface ReadDiff {
  field: string
  target: unknown
  actual: unknown
  relErr?: number
  /** A difference the client did not ask for: 25 % on a ratio, any categorical mismatch. */
  finding: boolean
}

/** Field-by-field difference between a target read (a reference) and an actual one. */
export function diffReads(target: DesignRead, actual: DesignRead): ReadDiff[] {
  const out: ReadDiff[] = []
  const cat = (field: string, t: unknown, a: unknown) => {
    if (t === undefined || a === undefined) return
    const same = JSON.stringify(t) === JSON.stringify(a)
    if (!same) out.push({ field, target: t, actual: a, finding: true })
  }
  cat('kind', target.kind, actual.kind)
  cat('archetype', target.archetype, actual.archetype)
  cat('variant', target.variant, actual.variant)
  cat('silhouette.profile', target.silhouette.profile, actual.silhouette.profile)
  cat('centre.cut', target.centre?.cut, actual.centre?.cut)
  cat('centre.setting', target.centre?.setting, actual.centre?.setting)
  cat('centre.prongCount', target.centre?.prongCount, actual.centre?.prongCount)
  cat('centre.orientation', target.centre?.orientation, actual.centre?.orientation)
  cat('shank.shoulder', target.shank?.shoulder, actual.shank?.shoulder)
  cat('metal.colours', [...target.metal.colours].sort(), [...actual.metal.colours].sort())
  for (const k of RATIO_KEYS) {
    const t = target.ratios[k]
    const a = actual.ratios[k]
    if (!t || !a || t.value === 0) continue
    const relErr = r2(Math.abs(a.value - t.value) / Math.abs(t.value))
    out.push({
      field: `ratios.${k}`,
      target: t.value,
      actual: a.value,
      relErr,
      finding: relErr > 0.25,
    })
  }
  return out
}

/** Where each ratio of a read lands as a parameter, given the piece's facts. */
const TARGETS: Partial<Record<RatioKey, (r: number, f: Facts) => [string, number] | undefined>> = {
  stoneToFinger: (r, f) => (f.ID ? ['center.width', r * f.ID] : undefined),
  bandToStone: (r, f) => (f.cW ? ['band.widthTop', r * f.cW] : undefined),
  taperTopToBottom: (r, f) => (f.bandW ? ['band.widthBottom', f.bandW / r] : undefined),
  tableHeightToStone: (r, f) =>
    f.cW && f.cDepth !== undefined ? ['center.elevation', (r - f.cDepth) * f.cW] : undefined,
  haloToStone: (r, f) =>
    f.cW && f.haloOffset !== undefined && f.haloRows
      ? ['halo.stoneWidth', ((r - 1) * f.cW - 2 * (f.haloOffset + 0.25)) / (2 * f.haloRows)]
      : undefined,
  sideToCenter: (r, f) => (f.cW ? ['side1.width', r * f.cW] : undefined),
  prongToStone: (r, f) => (f.cW ? ['head.prongDiameter', r * f.cW] : undefined),
  chainToPendant: (r, f) => (f.H ? ['chain.linkWidth', r * f.H] : undefined),
  bailToPendant: (r, f) =>
    f.H && f.bailWire !== undefined ? ['bail.opening', r * f.H - 2 * f.bailWire] : undefined,
  thicknessToHeight: (r, f) => (f.H ? ['body.thickness', r * f.H] : undefined),
}

/** Parameter targets from a read: ±10 % at full confidence, widening as confidence drops. */
export function targetsFrom(
  read: DesignRead,
  facts: Facts,
): { param: string; band: [number, number]; variant: Variant }[] {
  const out: { param: string; band: [number, number]; variant: Variant }[] = []
  for (const k of RATIO_KEYS) {
    const r = read.ratios[k]
    const t = r && TARGETS[k]?.(r.value, facts)
    if (!r || !t) continue
    const tol = 0.1 + 0.15 * (1 - r.confidence)
    out.push({
      param: t[0],
      band: [r2(t[1] * (1 - tol)), r2(t[1] * (1 + tol))],
      variant: read.variant,
    })
  }
  return out
}
