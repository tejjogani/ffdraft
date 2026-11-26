/**
 * The mount rules: what a head, a band and its neighbours should be for the stone they carry.
 *
 * A follow field (see `follows` in ./fields) left absent follows its rule here; a stored value
 * is the designer's pin and is never changed by a rule. `resolveDesign` fills every absent
 * follow field before the kernel evaluates, looking at the whole document, so a plain update
 * of a stone's cut or size already gives a mount that fits it: claws for the shape, wire for
 * the size, side stones packed beside the new girdle, shoulders rising to it, the shoulder row
 * stopping clear of the head. Ops and storage always hold the unresolved document.
 *
 * Everything here is pure and has no geometry kernel: the numbers come from the cut table
 * (`GEM_CUTS`) and the canon's research (09 §1), so the recipe, the resolver, the stone
 * intent and the kernel's fix suggestions all agree.
 */
import { culetDepth, GEM_CUTS, type GemCutId, type GemDims, gemDims } from '../domain/gems'
import { ringInnerDiameter } from '../domain/sizes'
import type { Design } from './design'
import type { Node, NodeOf } from './nodes'

type Gem = NodeOf<'gem'>
type Setting = NodeOf<'setting'>
type Band = NodeOf<'ringShank'>
type Row = NodeOf<'gemRow'>
type RingTop = Extract<Gem['placement'], { type: 'ringTop' }>

export const MOUNT = {
  /** Plan gap between a side stone's girdle and the girdle of the stone beside it, mm. */
  sideGap: 0.5,
  /** Cathedral arches stop this far under the girdle plane, mm; and their range. */
  shoulderUnder: 0.3,
  shoulderRise: { min: 0.5, max: 8, none: 3 },
  /**
   * Highest rise the rule gives: arms climbing further than this become long struts standing
   * away from the stone; above it the head's own legs and gallery carry the stone the rest of
   * the way (a pinned rise may still go to `shoulderRise.max`).
   */
  shoulderAutoMax: 4,
  /** Metal-free space between a shoulder row's stones and a head, its claws or halo, mm. */
  rowClearance: 0.4,
  /** A round this wide and wider takes six claws (canon `ring.head.prongCountRound`). */
  sixClawRound: 7.4,
  /** A baguette or emerald this long and longer takes a claw on each long side as well. */
  longStepClaws: 12,
  /** Least claw wire (canon `ring.head.prongWire`; kernel `RULES.prongDiameter.warn`). */
  prongMin: 0.8,
  /** Metal beyond the outermost halo stones (kernel halo BORDER), mm. */
  haloBorder: 0.45,
} as const

const round = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(4))
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const DEG = Math.PI / 180

// ── Stones ───────────────────────────────────────────────────────────────────────────────────

type Measured = NonNullable<NonNullable<Gem['sourcing']>['measured']>

/** A measured size the geometry can use: three finite, positive numbers. */
export const measuredUsable = (m: Measured | undefined): boolean =>
  m !== undefined && [m.length, m.width, m.depth].every((v) => Number.isFinite(v) && v > 0)

/**
 * A stone's real size: the measured stone when one has been sourced (and its record is
 * usable), else the cut's nominal size for its width and length : width.
 */
export function stoneDims(g: Pick<Gem, 'cut' | 'width' | 'lw' | 'sourcing'>): GemDims {
  const m = g.sourcing?.measured
  if (m && measuredUsable(m))
    // Length ≥ width by convention, whichever way round the lab reported them.
    return {
      length: Math.max(m.length, m.width),
      width: Math.min(m.length, m.width),
      depth: m.depth,
    }
  return gemDims(g.cut, g.width, g.lw)
}

/** The length : width a cut is built with when none is pinned: the cut's own. */
export const lwFor = (cut: GemCutId): number => GEM_CUTS[cut].lw.default

/** A cut without a pavilion (a cabochon) sits on the band, not at a clearance above the finger. */
export const flatBacked = (cut: GemCutId): boolean => GEM_CUTS[cut].pavilionPct === 0

// ── Heads ────────────────────────────────────────────────────────────────────────────────────

/**
 * Claws for a stone: the shape's usual count; a round of 7.4 mm and more takes six; a baguette
 * or emerald cut 12 mm long and more takes a pair more, one on each long side, since four
 * corner claws leave its long girdle unheld (kernel `stone.unheld`).
 */
export function prongCountFor(cut: GemCutId, dims: GemDims): number {
  if (cut === 'round' && dims.width >= MOUNT.sixClawRound - 1e-9) return 6
  if ((cut === 'baguette' || cut === 'emerald') && dims.length >= MOUNT.longStepClaws - 1e-9)
    return GEM_CUTS[cut].prongs.typical + 2
  return GEM_CUTS[cut].prongs.typical
}

/**
 * Claw rotation that is mirror-symmetric about the band for a claw count (canon
 * `ring.head.clawPosition`): four at 45°, an odd count with one claw on the finger axis
 * (90/n), other even counts with a claw along the band (0). Shapes with points or corners
 * put their claws there instead and ignore it.
 */
export const prongSpinFor = (count: number): number =>
  count === 4 ? 45 : count % 2 === 1 ? round(90 / count, 0.01) : 0

/** The effective numbering layout, before applying any per-prong changes. */
export function prongLayout(head: Setting, gem: Node | undefined) {
  if ((head.style !== 'prong' && head.style !== 'basket') || gem?.kind !== 'gem') return null
  const dims = stoneDims(gem)
  const count = head.prongCount ?? prongCountFor(gem.cut, dims)
  return {
    gem: gem.id,
    cut: gem.cut,
    ratio: dims.length / dims.width,
    count,
    spin: head.prongSpin ?? prongSpinFor(count),
  }
}

/**
 * Claw wire for a stone (canon `ring.head.prongWire`, before the alloy allowance): 0.1·W +
 * 0.35 mm (0.85 on 5 mm, 1.0 on 6.5, 1.15 on 8), × 0.88 when six or more claws share the load,
 * 0.1 less inside a halo, never under 0.8 mm; in 0.05 mm steps.
 */
export function prongDiameterFor(width: number, count: number, inHalo: boolean): number {
  const raw = (0.1 * width + 0.35) * (count > 5 ? 0.88 : 1) - (inHalo ? 0.1 : 0)
  return round(Math.max(MOUNT.prongMin, raw), 0.05)
}

/** Wire below which claws look and wear thin for the stone (canon lint floor; kernel `prong.light`). */
export const prongLightFor = (width: number, count: number, inHalo: boolean): number =>
  Math.max(MOUNT.prongMin, (0.08 * width + 0.3) * (count > 5 ? 0.88 : 1) - (inHalo ? 0.1 : 0))

/** Wire above which claws overwhelm the stone (canon `heavyWire` without the alloy allowance). */
export const prongHeavyFor = (width: number): number => Math.max(0.18 * width, 1.0)

/** How far the claw's outside stands beyond the girdle (axis at radius − overlap), mm. */
export const clawReach = (d: number) => d - Math.max(0.15, d * 0.15)

// ── Bands ────────────────────────────────────────────────────────────────────────────────────

/**
 * Where cathedral arches peak for a rise above the band: `reach` (mm along the band from the
 * head's axis) and the angle of the peak. A stone whose girdle sits `rise` above the band is
 * about (rise + 0.6) / 0.43 wide; the peaks stand just outside its girdle. The kernel's band
 * builds its arches from this, so the rule for the rise and the shape agree.
 */
export function cathedralPeak(rise: number, outerRadius: number): { reach: number; peak: number } {
  const reach = (rise + 0.6) / 0.86 + 0.3
  return { reach, peak: Math.asin(clamp(reach / (outerRadius + rise), 0.1, 0.75)) }
}

const bandOuter = (b: Band) => ringInnerDiameter(b.size) / 2 + b.thicknessTop

/** Radius of a ring-top stone's girdle plane from the finger's axis (as the kernel places it). */
export function girdleRadius(g: Gem, b: Band): number {
  const p = g.placement as RingTop
  const dims = stoneDims(g)
  const fromFinger = ringInnerDiameter(b.size) / 2 + p.elevation + culetDepth(g.cut, dims)
  // A flat back has no culet to keep off the finger: it rests on the band.
  return flatBacked(g.cut)
    ? Math.max(fromFinger, bandOuter(b) + culetDepth(g.cut, dims))
    : fromFinger
}

/**
 * Cathedral rise that brings the arches' peaks `MOUNT.shoulderUnder` under the girdle plane of
 * a stone whose girdle is `girdle` mm from the finger's axis (solved on the band's own peak
 * shape), within the field's range and no higher than `MOUNT.shoulderAutoMax`.
 */
export function shoulderHeightFor(girdle: number, outerRadius: number): number {
  const min: number = MOUNT.shoulderRise.min
  const max: number = MOUNT.shoulderAutoMax
  const target = girdle - MOUNT.shoulderUnder
  const peakZ = (rise: number) => {
    const { peak } = cathedralPeak(rise, outerRadius)
    return (outerRadius + rise) * Math.cos(peak)
  }
  if (peakZ(min) >= target) return min
  if (peakZ(max) <= target) return max
  let lo = min
  let hi = max
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (peakZ(mid) < target) lo = mid
    else hi = mid
  }
  return round(lo, 0.05)
}

/** Half the stone's extent along the band (its frame turned by `spin`), mm. */
function halfAlongBand(g: Gem, dims: GemDims): number {
  const spin = ((g.placement as RingTop).spin ?? 0) * DEG
  return (Math.abs(Math.cos(spin)) * dims.width + Math.abs(Math.sin(spin)) * dims.length) / 2
}

// ── Resolving a document ─────────────────────────────────────────────────────────────────────

/** Everything on one band that the rules look at. */
interface BandView {
  band: Band
  /** Ring-top stones on this band, with what holds and surrounds each. */
  tops: { gem: Gem; head?: Setting; halos: NodeOf<'halo'>[] }[]
}

function bandViews(design: Design): Map<string, BandView> {
  const views = new Map<string, BandView>()
  const nodes = Object.values(design.nodes)
  for (const n of nodes) if (n.kind === 'ringShank') views.set(n.id, { band: n, tops: [] })
  for (const n of nodes) {
    if (n.kind !== 'gem' || n.placement.type !== 'ringTop') continue
    const view = views.get(n.placement.shank)
    if (!view) continue
    view.tops.push({
      gem: n,
      head: nodes.find((s): s is Setting => s.kind === 'setting' && s.gem === n.id),
      halos: nodes.filter((h): h is NodeOf<'halo'> => h.kind === 'halo' && h.around === n.id),
    })
  }
  return views
}

/**
 * Angles of the ring-top stones on one band, filled where they follow: a stone with no side
 * stays where it is pinned (or at the top); side stones pack outward, in document order, each
 * `MOUNT.sideGap` from the girdle of the stone inside it, measured in plan on that stone.
 */
function topAngles(view: BandView, order: readonly string[]): Map<string, number> {
  const angles = new Map<string, number>()
  const tops = view.tops.toSorted((a, b) => order.indexOf(a.gem.id) - order.indexOf(b.gem.id))
  const placement = (g: Gem) => g.placement as RingTop
  for (const { gem } of tops)
    if (!placement(gem).side) angles.set(gem.id, placement(gem).angle ?? 0)
  for (const side of ['left', 'right'] as const) {
    const sign = side === 'left' ? -1 : 1
    // The stone the first side stone sits beside: the outermost centre stone on that side.
    const centres = tops.filter((t) => !placement(t.gem).side)
    let inner = centres.reduce<{ angle: number; half: number; gem: Gem | null }>(
      (best, t) => {
        const angle = angles.get(t.gem.id)!
        // A flat-backed stone rests low on the band, so its head's claws stand beside the side
        // stone's girdle, not above it: pack against the claws too.
        const half =
          halfAlongBand(t.gem, stoneDims(t.gem)) + (flatBacked(t.gem.cut) ? headReach(t) : 0)
        return sign * angle > sign * best.angle || best.gem === null
          ? { angle, half, gem: t.gem }
          : best
      },
      { angle: 0, half: 0, gem: null },
    )
    for (const { gem } of tops) {
      if (placement(gem).side !== side) continue
      const dims = stoneDims(gem)
      const half = halfAlongBand(gem, dims)
      let angle = placement(gem).angle
      if (angle === undefined) {
        // In the inner stone's frame, this girdle's near edge is at R·sin Δ − h·cos Δ; set it
        // `sideGap` beyond the inner girdle and solve for Δ.
        const r = girdleRadius(gem, view.band)
        const delta =
          Math.asin(clamp((inner.half + MOUNT.sideGap) / Math.hypot(r, half), -1, 1)) +
          Math.atan2(half, r)
        angle = round(inner.angle + (sign * delta) / DEG, 0.01)
      }
      angles.set(gem.id, angle)
      inner = { angle, half, gem }
    }
  }
  return angles
}

/** How far beyond the girdle a head's metal reaches along the band, mm. */
function headReach(top: BandView['tops'][number]): number {
  const head = top.head
  let reach = 0
  if (head?.style === 'prong' || head?.style === 'basket') {
    // Before heads are resolved (side stones are packed first) the wire follows its rule.
    const dims = stoneDims(top.gem)
    const count = head.prongCount ?? prongCountFor(top.gem.cut, dims)
    reach = clawReach(
      head.prongDiameter ?? prongDiameterFor(dims.width, count, top.halos.length > 0),
    )
  } else if (head?.style === 'bezel' || head?.style === 'halfBezel') reach = head.wall
  const metal = reach
  // Claws on a stone's points or corners (a princess, pear, marquise, heart, trillion) push
  // the halo out round them, and on a convex stone the straight runs between them too.
  const cut = GEM_CUTS[top.gem.cut]
  const pointed =
    ['pear', 'marquise', 'heart', 'trillion'].includes(cut.outline) ||
    (['square', 'rect'].includes(cut.outline) && cut.cornerCut === 0)
  const clawed = head?.style === 'prong' || head?.style === 'basket'
  for (const h of top.halos) {
    const melee = gemDims(h.cut, h.stoneWidth)
    const size = Math.max(melee.width, melee.length)
    // The kernel starts a halo at its gap to the stone, with claws along a side standing in
    // notches between its stones, and beyond a bezel's wall. Where claws stand on points, take
    // the halo as clearing the claws all round (it does no more than that).
    const inner =
      h.clearClaws === false || (clawed && !pointed) ? h.offset : Math.max(h.offset, metal + 0.05)
    reach = Math.max(reach, inner + h.rows * (size + h.gap) - h.gap + MOUNT.haloBorder)
  }
  return reach
}

/**
 * Arc (degrees) a shoulder row leaves clear at its centre: every head on the band within the
 * row's coverage, with its claws, bezel or halo, plus `MOUNT.rowClearance` each side, measured
 * on the band's outer surface (conservative: the head stands above it); 0 with no head.
 */
function skipCenterFor(row: Row, view: BandView, angles: Map<string, number>): number {
  const radius = bandOuter(view.band)
  let half = 0
  for (const top of view.tops) {
    const off = Math.abs((angles.get(top.gem.id) ?? 0) - row.center)
    if (off > row.coverage / 2) continue
    const along = halfAlongBand(top.gem, stoneDims(top.gem)) + headReach(top)
    half = Math.max(half, off + (along + MOUNT.rowClearance) / radius / DEG)
  }
  return half === 0 ? 0 : clamp(round(2 * half, 0.1), 0, 180)
}

/**
 * The document with every absent follow field filled from its rule. Pinned values are kept.
 * Pure: the input is not mutated, and nodes with nothing to fill are returned as they are
 * (so the kernel's per-node cache sees the same node). Designs from before follow fields
 * (schema version 1) are migrated first, so their stored values keep their meaning.
 */
export function resolveDesign(input: Design): Design {
  const design = migrateDesign(input)
  const resolved = new Map<string, Node>()
  const set = (n: Node, patch: Record<string, unknown>) => {
    const filled = Object.entries(patch).filter(
      ([k, v]) => v !== undefined && (n as never)[k] === undefined,
    )
    if (filled.length)
      resolved.set(n.id, { ...(resolved.get(n.id) ?? n), ...Object.fromEntries(filled) } as Node)
  }
  const nodes = Object.values(design.nodes)
  const halo = (gemId: string) => nodes.some((n) => n.kind === 'halo' && n.around === gemId)

  // Stones first: everything else reads their size.
  for (const n of nodes) if (n.kind === 'gem') set(n, { lw: lwFor(n.cut) })
  const gem = (id: string) => (resolved.get(id) ?? design.nodes[id]) as Gem | undefined
  // The document as filled so far, for the rules that read other nodes.
  const current = (): Design => ({
    ...design,
    nodes: Object.fromEntries(nodes.map((n) => [n.id, resolved.get(n.id) ?? n])),
  })
  // Side stones on their bands.
  const views = bandViews(current())
  const angles = new Map<string, number>()
  for (const view of views.values())
    for (const [id, angle] of topAngles(view, design.order)) {
      angles.set(id, angle)
      const g = gem(id)!
      if ((g.placement as RingTop).angle === undefined)
        resolved.set(id, { ...g, placement: { ...(g.placement as RingTop), angle } })
    }
  // Heads.
  for (const n of nodes) {
    if (n.kind !== 'setting') continue
    const held = gem(n.gem)
    if (held?.kind !== 'gem') continue
    const dims = stoneDims(held)
    const count = n.prongCount ?? prongCountFor(held.cut, dims)
    set(n, {
      prongCount: count,
      prongDiameter: prongDiameterFor(dims.width, count, halo(held.id)),
      prongSpin: prongSpinFor(count),
    })
  }
  // A halo makes room for the head on its stone.
  for (const n of nodes)
    if (n.kind === 'halo')
      set(n, { head: nodes.find((s) => s.kind === 'setting' && s.gem === n.around)?.id })
  // Bands and rows, which read the heads.
  for (const view of bandViews(current()).values()) {
    const outer = bandOuter(view.band)
    const top = view.tops
      .filter((t) => Math.abs(angles.get(t.gem.id) ?? 0) < 30)
      .toSorted(
        (a, b) => Math.abs(angles.get(a.gem.id) ?? 0) - Math.abs(angles.get(b.gem.id) ?? 0),
      )[0]
    set(view.band, {
      shoulderHeight: top
        ? shoulderHeightFor(girdleRadius(top.gem, view.band), outer)
        : MOUNT.shoulderRise.none,
    })
    for (const n of nodes)
      if (n.kind === 'gemRow' && n.host === view.band.id)
        set(n, { skipCenter: skipCenterFor(n, view, angles) })
  }
  for (const n of nodes) if (n.kind === 'gemRow' && !views.has(n.host)) set(n, { skipCenter: 0 })

  if (resolved.size === 0 && design === input) return design
  return {
    ...design,
    nodes: Object.fromEntries(
      Object.entries(design.nodes).map(([id, n]) => [id, resolved.get(id) ?? n]),
    ),
  }
}

// ── Pins ─────────────────────────────────────────────────────────────────────────────────────

/** A pinned follow field: where it is, its value, and what the rule would give instead. */
export interface Pin {
  nodeId: string
  /** Field path in the node: `prongCount`, `placement.angle`. */
  path: string
  value: number
  rule: number
}

/**
 * Two values of a follow field that build the same thing (within the field's step), or with
 * `exact`, that are the same value (within float noise): only those may be unpinned without
 * changing what is built.
 */
function sameValue(path: string, a: number, b: number, node: Node, exact = false): boolean {
  if (path === 'prongSpin' && node.kind === 'setting') {
    // The claws repeat every 360/n degrees.
    const period = 360 / (node.prongCount ?? 4)
    const d = (((a - b) % period) + period) % period
    return Math.min(d, period - d) < (exact ? 1e-6 : 0.5)
  }
  if (exact) return Math.abs(a - b) < 1e-6
  const tolerance: Record<string, number> = {
    lw: 0.005,
    prongCount: 0.5,
    prongDiameter: 0.025,
    'placement.angle': 0.05,
    shoulderHeight: 0.025,
    skipCenter: 0.05,
  }
  return Math.abs(a - b) < (tolerance[path] ?? 1e-6)
}

const FOLLOWS: Partial<Record<Node['kind'], readonly string[]>> = {
  gem: ['lw', 'placement.angle'],
  setting: ['prongCount', 'prongDiameter', 'prongSpin'],
  ringShank: ['shoulderHeight'],
  gemRow: ['skipCenter'],
}

const read = (n: Node, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as never)[k] : undefined), n)

function without(n: Node, path: string): Node {
  const [head, tail] = path.split('.') as [string, string | undefined]
  const copy = { ...n } as Record<string, unknown>
  if (tail === undefined) delete copy[head]
  else {
    const inner = { ...(copy[head] as Record<string, unknown>) }
    delete inner[tail]
    copy[head] = inner
  }
  return copy as unknown as Node
}

/**
 * Every follow field that is pinned in the document, with what its rule would give with the
 * pin removed. `placement.angle` counts only on a side stone (its rule is a packing; on any
 * other stone the angle is a plain position).
 */
export function pins(design: Design): Pin[] {
  const out: Pin[] = []
  for (const id of design.order) {
    const n = design.nodes[id]
    if (!n) continue
    for (const path of FOLLOWS[n.kind] ?? []) {
      const value = read(n, path)
      if (typeof value !== 'number') continue
      if (
        path === 'placement.angle' &&
        !(n.kind === 'gem' && n.placement.type === 'ringTop' && n.placement.side)
      )
        continue
      const free = resolveDesign({ ...design, nodes: { ...design.nodes, [id]: without(n, path) } })
      const rule = read(free.nodes[id]!, path)
      if (typeof rule === 'number') out.push({ nodeId: id, path, value, rule })
    }
  }
  return out
}

/** The pins that build something other than the rule would (the "pinned, not auto" ones). */
export const pinsOffRule = (design: Design): Pin[] =>
  pins(design).filter((p) => !sameValue(p.path, p.value, p.rule, design.nodes[p.nodeId]!))

/**
 * Removes every pin whose value equals what its rule gives (exactly, not within the field's
 * step: a stored 0.99 mm wire stays pinned beside a rule of 1.0, or a later stone change would
 * move it), so it follows from now on. The resolved document is unchanged by construction.
 * Recipes run their output through this, and designs from before follow fields are migrated
 * with it.
 */
export function unpinAtRule(design: Design): Design {
  let out = design
  // One field at a time: a rule may read another follow field (the row reads the claws).
  for (const pin of pins(design)) {
    if (!sameValue(pin.path, pin.value, pin.rule, design.nodes[pin.nodeId]!, true)) continue
    const current = out.nodes[pin.nodeId]!
    const next = without(current, pin.path)
    // Removing it must not move anything: check against the document as it now stands.
    const before = resolveDesign(out).nodes[pin.nodeId]
    const after = resolveDesign({ ...out, nodes: { ...out.nodes, [pin.nodeId]: next } }).nodes[
      pin.nodeId
    ]
    if (
      before &&
      after &&
      sameValue(
        pin.path,
        read(before, pin.path) as number,
        read(after, pin.path) as number,
        before,
        true,
      )
    )
      out = { ...out, nodes: { ...out.nodes, [pin.nodeId]: next } }
  }
  return out
}

// ── Version 1 documents ──────────────────────────────────────────────────────────────────────

/** The document version that has follow fields. */
export const DESIGN_VERSION = 2

/**
 * A design written before follow fields, read with the meaning it had. Version 1 filled every
 * field with its default and the kernel read two of those defaults as "not set": a row's
 * `graduateTo` of 1.5 (no graduation) and a stone's `lw` of 1 on a cut that cannot be square
 * (the cut's own ratio). Those are removed; then every value that equals its rule is unpinned,
 * which by construction builds the same piece. Every other stored value stays pinned, so an
 * old piece looks exactly as it did. A halo is marked to keep its old layout (`clearClaws`).
 */
export function migrateDesign(design: Design): Design {
  if (design.schemaVersion === DESIGN_VERSION) return design
  const nodes: Record<string, Node> = {}
  for (const [id, n] of Object.entries(design.nodes)) {
    let node = n
    if (node.kind === 'gemRow' && node.graduateTo === 1.5) node = without(node, 'graduateTo')
    if (node.kind === 'gem' && node.lw === 1 && GEM_CUTS[node.cut].lw.min > 1)
      node = without(node, 'lw')
    // A halo keeps its stones where they were (and so its stone list, carat and quote); the
    // kernel offers the claw-clear layout as a fix.
    if (node.kind === 'halo') node = { ...node, clearClaws: false }
    nodes[id] = node
  }
  return unpinAtRule({ ...design, schemaVersion: DESIGN_VERSION, nodes })
}
