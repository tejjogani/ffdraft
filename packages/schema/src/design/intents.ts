/**
 * Targeted edits: one sentence a jeweler would say at the bench ("make the centre a 2 ct
 * oval", "all the melee in sapphire") turned into ordinary ops by a pure, deterministic
 * function. A person clicks it; the assistant calls the same function as a tool
 * (`design.replaceStone`), so the model never improvises the ops.
 *
 * `replaceStone` writes only stone fields (cut, size, length : width, material, quality,
 * sourcing). The mount follows by itself: the follow fields it leaves alone are filled from
 * the new stone by `resolveDesign` (./mount), and pinned ones are kept and reported. The ops
 * go through `applyOps` like any edit, so undo, history and traces come for free.
 * docs/plans/targeted-edits.md §2–§4.
 */
import { z } from 'zod'
import {
  GEM_CUT_IDS,
  GEM_CUTS,
  GEM_MATERIAL_IDS,
  GEM_MATERIALS,
  type GemCutId,
  type GemDims,
  type GemMaterialId,
  gemCarat,
  gemDims,
  gemDimsFromCarat,
  snapToMelee,
} from '../domain/gems'
import { nodeTitle } from './describe'
import type { Design, Op } from './design'
import { measuredUsable, migrateDesign, pinsOffRule, resolveDesign, stoneDims } from './mount'
import { type Node, type NodeOf, StoneQuality, StoneSourcing } from './nodes'

// ── Input ────────────────────────────────────────────────────────────────────────────────────

export const StoneTargetSchema = z.object({
  /** A gem, or a field of stones: a row, a halo, a pavé. */
  nodeId: z.string(),
  /** One stone inside a field, by its index in the evaluation (`StoneInstance.id` = `nodeId:index`). */
  instance: z.number().int().nonnegative().optional(),
  /** `alike`: every node whose cut, material and size equal the target's (both side stones). */
  scope: z.enum(['one', 'all', 'alike']).default('one'),
})
export type StoneTarget = z.input<typeof StoneTargetSchema>

/** A change of grade: StoneQuality's keys, each optional and with no default. */
const StoneQualityChange = StoneQuality.extend({
  origin: StoneQuality.shape.origin.unwrap().optional(),
}).partial()

export const StoneChangeSchema = z
  .object({
    cut: z.enum(GEM_CUT_IDS).optional(),
    /** Girdle width in mm (a field's stones are snapped to stock melee). */
    widthMm: z.number().positive().max(40).optional(),
    /** Weight of one stone. */
    carat: z.number().positive().max(100).optional(),
    lw: z.number().min(0.8).max(5).optional(),
    /** The material, which is the colour: `sapphire-blue`, `ruby`, `diamond-lab`. */
    stone: z.enum(GEM_MATERIAL_IDS).optional(),
    /**
     * Only the grade keys given change: a colour-only change keeps the stone's origin. (Parsed
     * without StoneQuality's defaults, which would write origin `any` over a lab stone.)
     */
    quality: StoneQualityChange.optional(),
    /** A real stone with its measured size: fit the mount to it (Sourcing's "fit to this stone"). */
    fit: StoneSourcing.optional(),
    /** Three-stone: keep the side stones' size (default) or resize them to keep the proportion. */
    sides: z.enum(['keep', 'proportion']).default('keep'),
  })
  .refine((c) => c.widthMm === undefined || c.carat === undefined, {
    message: 'Give the size as widthMm or as carat, not both',
  })
  .refine((c) => !c.fit || c.fit.measured, {
    message: 'A stone to fit must carry its measured size',
  })
export type StoneChange = z.input<typeof StoneChangeSchema>

export interface IntentWarning {
  code: string
  message: string
  nodeId?: string
  /** A ready edit that resolves it ("Reset to auto", "Resize side stones to 4.6 mm"). */
  suggestion?: { label: string; ops: Op[] }
}

export interface IntentResult {
  ops: Op[]
  label: string
  notes: string[]
  warnings: IntentWarning[]
}

/** The target cannot take this change: no such node, or a node that carries no stones. */
export class IntentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntentError'
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────

type Gem = NodeOf<'gem'>
type Field = NodeOf<'gemRow'> | NodeOf<'halo'> | NodeOf<'pave'>
type StoneNode = Gem | Field

const isStoneNode = (n: Node): n is StoneNode =>
  n.kind === 'gem' || n.kind === 'gemRow' || n.kind === 'halo' || n.kind === 'pave'

const mm2 = (v: number) => Number(v.toFixed(2))
const fmt = (v: number, digits = 2) => (Number.isInteger(v) ? String(v) : v.toFixed(digits))
const ct = (v: number) => `${v.toFixed(2)} ct`

/** "7.37 mm round" or "9.20 × 6.57 mm oval". */
function sizeText(cut: GemCutId, dims: GemDims): string {
  const label = GEM_CUTS[cut].label.toLowerCase()
  return Math.abs(dims.length - dims.width) < 0.005
    ? `${fmt(dims.width)} mm ${label}`
    : `${fmt(dims.length)} × ${fmt(dims.width)} mm ${label}`
}

const materialLabel = (m: GemMaterialId) => GEM_MATERIALS[m].label.toLowerCase()

/** The size field of a field of stones and its declared range. */
function fieldSize(n: Field): { key: 'stoneWidth' | 'sizeMax'; value: number; max: number } {
  if (n.kind === 'pave') return { key: 'sizeMax', value: n.sizeMax, max: 4 }
  return { key: 'stoneWidth', value: n.stoneWidth, max: n.kind === 'halo' ? 3.5 : 6 }
}

/** Nodes that a change of this stone moves through the mount rules, for notes and pin checks. */
function relatedTo(design: Design, ids: ReadonlySet<string>): Set<string> {
  const out = new Set(ids)
  const bands = new Set<string>()
  for (const id of ids) {
    const n = design.nodes[id]
    if (n?.kind === 'gem' && n.placement.type === 'ringTop') bands.add(n.placement.shank)
  }
  for (const n of Object.values(design.nodes)) {
    if (n.kind === 'setting' && ids.has(n.gem)) out.add(n.id)
    if (n.kind === 'halo' && ids.has(n.around)) out.add(n.id)
    if (bands.has(n.id)) out.add(n.id)
    if (n.kind === 'gemRow' && bands.has(n.host)) out.add(n.id)
    if (n.kind === 'gem' && n.placement.type === 'ringTop' && bands.has(n.placement.shank))
      out.add(n.id)
  }
  return out
}

// ── What follows, in words ───────────────────────────────────────────────────────────────────

const FOLLOWED: {
  kind: Node['kind']
  path: string
  say: (a: number, b: number, n: Node) => string
}[] = [
  { kind: 'setting', path: 'prongCount', say: (a, b) => `Claws ${a} → ${b}` },
  {
    kind: 'setting',
    path: 'prongDiameter',
    say: (a, b) => `Claw wire ${a.toFixed(2)} → ${b.toFixed(2)} mm`,
  },
  { kind: 'setting', path: 'prongSpin', say: (a, b) => `Claws turn ${fmt(a, 0)}° → ${fmt(b, 0)}°` },
  {
    kind: 'gem',
    path: 'placement.angle',
    say: (a, b, n) => `${nodeTitle(n)} moves ${fmt(a, 1)}° → ${fmt(b, 1)}° around the band`,
  },
  {
    kind: 'ringShank',
    path: 'shoulderHeight',
    say: (a, b) => `Cathedral rise ${a.toFixed(2)} → ${b.toFixed(2)} mm`,
  },
  {
    kind: 'gemRow',
    path: 'skipCenter',
    say: (a, b, n) =>
      `${nodeTitle(n)} ${b < a ? 'reach' : 'stop'} ${fmt(Math.abs(a - b) / 2, 1)}° ${b < a ? 'closer to' : 'further from'} the head`,
  },
]

const read = (n: Node, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as never)[k] : undefined), n)

function followNotes(before: Design, after: Design, related: ReadonlySet<string>): string[] {
  const a = resolveDesign(before)
  const b = resolveDesign(after)
  const notes: string[] = []
  for (const id of after.order) {
    if (!related.has(id)) continue
    const was = a.nodes[id]
    const now = b.nodes[id]
    if (!was || !now) continue
    for (const f of FOLLOWED) {
      if (now.kind !== f.kind) continue
      // A plain band has no arches to rise.
      if (now.kind === 'ringShank' && now.shoulder !== 'cathedral') continue
      const x = read(was, f.path)
      const y = read(now, f.path)
      if (typeof x === 'number' && typeof y === 'number' && Math.abs(x - y) > 1e-6)
        notes.push(f.say(x, y, now))
    }
    // A halo follows the new outline at the same gap; how many stones fit is the kernel's.
    if (now.kind === 'halo' && related.has(now.around) && now.around !== id)
      notes.push(`${nodeTitle(now)} follows the new outline and recounts its stones`)
  }
  return [...new Set(notes)]
}

// ── The intent ───────────────────────────────────────────────────────────────────────────────

interface Patched {
  node: StoneNode
  patch: Record<string, unknown>
}

/**
 * Replace or resize a stone (or every stone of a row, halo or pavé field) and let the mount
 * follow. Returns ordinary ops, a history label, notes for the designer, and warnings (each
 * with a ready fix where there is one). Returns `ops: []` when nothing would change; applying
 * the same change twice is a no-op. Throws {@link IntentError} for a target that does not
 * exist or carries no stones.
 */
export function replaceStone(
  input: Design,
  targetInput: StoneTarget,
  changeInput: StoneChange,
): IntentResult {
  return plan(input, targetInput, changeInput, true)
}

/** `pair`: check a lone side stone against its partner (off when planning that partner's twin). */
function plan(
  input: Design,
  targetInput: StoneTarget,
  changeInput: StoneChange,
  pair: boolean,
): IntentResult {
  const target = StoneTargetSchema.parse(targetInput)
  const parsed = StoneChangeSchema.safeParse(changeInput)
  if (!parsed.success) throw new IntentError(z.prettifyError(parsed.error))
  const change = parsed.data
  // Ops are applied to the migrated document (applyOps migrates first), so plan on it.
  const design = migrateDesign(input)
  const resolved = resolveDesign(design)
  const first = design.nodes[target.nodeId]
  if (!first) throw new IntentError(`No node "${target.nodeId}"`)
  if (!isStoneNode(first))
    throw new IntentError(`“${nodeTitle(first)}” (${first.kind}) carries no stones to replace`)

  const warnings: IntentWarning[] = []
  const notes: string[] = []

  // One stone inside a field shares seats, beads and spacing with the rest: its cut and size
  // cannot change alone. Offer the whole field instead.
  if (target.instance !== undefined && first.kind !== 'gem') {
    const whole = replaceStone(design, { nodeId: first.id }, changeInput)
    warnings.push({
      code: 'instance.fixed',
      nodeId: first.id,
      message: `One stone of “${nodeTitle(first)}” cannot be changed on its own: its seat, beads and spacing are shared with the others.`,
      ...(whole.ops.length
        ? { suggestion: { label: `Change every stone in “${nodeTitle(first)}”`, ops: whole.ops } }
        : {}),
    })
    return { ops: [], label: 'Replace stone', notes, warnings }
  }

  // The nodes to change.
  const sizeOf = (n: StoneNode) => (n.kind === 'gem' ? stoneDims(n).width : fieldSize(n).value)
  const alike = (n: StoneNode) =>
    (n.kind === 'gem') === (first.kind === 'gem') &&
    n.cut === first.cut &&
    n.stone === first.stone &&
    Math.abs(sizeOf(n) - sizeOf(first)) < 0.005
  const targets: StoneNode[] =
    target.scope === 'alike'
      ? design.order
          .map((id) => design.nodes[id]!)
          .filter((n): n is StoneNode => isStoneNode(n) && alike(n))
      : [first]
  if (target.scope === 'alike' && targets.length > 1)
    notes.push(
      `Changed ${targets.length} alike: ${targets.map((n) => `“${nodeTitle(n)}”`).join(', ')}`,
    )

  const patched: Patched[] = targets.map((node) => ({
    node,
    patch:
      node.kind === 'gem'
        ? gemPatch(node, resolved.nodes[node.id] as Gem, change, notes, warnings)
        : fieldPatch(node, change, notes, warnings),
  }))

  // Sourcing: the kernel sizes a linked stone from its measured size, so a link that no
  // longer describes the stone must go in the same change; a grade change keeps it.
  for (const { node, patch } of patched) {
    const link = node.sourcing
    if (!link || change.fit) continue
    const moved = ['cut', 'width', 'lw', 'stone', 'stoneWidth', 'sizeMax', 'graduateTo'].some(
      (k) => k in patch,
    )
    const label = `${link.provider} ${link.sku}${link.priceUsd !== undefined ? ` ($${link.priceUsd})` : ''}${link.url ? ` ${link.url}` : ''}`
    if (moved) {
      patch.sourcing = null
      warnings.push({
        code: 'sourcing.unlinked',
        nodeId: node.id,
        message: `“${nodeTitle(node)}” was linked to ${label}; that stone no longer matches, so the link was removed. Undo restores it.`,
      })
    } else if ('quality' in patch)
      warnings.push({
        code: 'sourcing.grade',
        nodeId: node.id,
        message: `“${nodeTitle(node)}” is linked to ${label}, a bought stone with one grade; the new grade does not change it.`,
      })
  }

  const ops: Op[] = []
  for (const { node, patch } of patched) {
    const changed = Object.fromEntries(
      Object.entries(patch).filter(([k, v]) => {
        const current = (node as Record<string, unknown>)[k]
        return v === null ? current !== undefined : JSON.stringify(current) !== JSON.stringify(v)
      }),
    )
    if (Object.keys(changed).length) ops.push({ t: 'update', id: node.id, patch: changed })
  }

  // Three-stone: the side stones move to the new centre girdle by rule; their size stays.
  const centre = first.kind === 'gem' && targets.length === 1 ? first : null
  if (centre?.placement.type === 'ringTop' && !centre.placement.side && ops.length) {
    const shank = centre.placement.shank
    const sides = design.order
      .map((id) => design.nodes[id]!)
      .filter(
        (n): n is Gem =>
          n.kind === 'gem' &&
          n.id !== centre.id &&
          n.placement.type === 'ringTop' &&
          n.placement.shank === shank,
      )
    const after = applyPatches(design, ops)
    const newWidth = stoneDims(after.nodes[centre.id] as Gem).width
    for (const side of sides) {
      const p = side.placement as Extract<Gem['placement'], { type: 'ringTop' }>
      if (!p.side) {
        // A side stone from before follow fields: its angle is a pinned position.
        const sideOf = (p.angle ?? 0) < 0 ? 'left' : 'right'
        warnings.push({
          code: 'side.pinned',
          nodeId: side.id,
          message: `“${nodeTitle(side)}” is fixed at ${fmt(p.angle ?? 0, 1)}° around the band and will not move with the new centre stone.`,
          suggestion: {
            label: `Let “${nodeTitle(side)}” sit beside the centre stone`,
            ops: [
              { t: 'update', id: side.id, patch: { placement: { side: sideOf, angle: null } } },
            ],
          },
        })
      }
    }
    const ratioOf = (n: Gem) => stoneDims(n).width / newWidth
    const off = sides.filter((n) => ratioOf(n) < 0.45 || ratioOf(n) > 0.75)
    if (off.length) {
      const width = mm2(newWidth * 0.62)
      const resize: Op[] = off.map((n) => ({
        t: 'update',
        id: n.id,
        patch: { width, ...(n.sourcing ? { sourcing: null } : {}) },
      }))
      if (change.sides === 'proportion') {
        ops.push(...resize)
        notes.push(`Side stones resized to ${fmt(width)} mm to keep the proportion`)
        for (const n of off)
          if (n.sourcing)
            warnings.push({
              code: 'sourcing.unlinked',
              nodeId: n.id,
              message: `“${nodeTitle(n)}” was linked to ${n.sourcing.provider} ${n.sourcing.sku}; resized, so the link was removed.`,
            })
      } else
        warnings.push({
          code: 'side.proportion',
          message: `The side stones are ${off.map((n) => fmt(ratioOf(n))).join(' and ')} of the new centre stone's width (0.45 to 0.75 looks balanced). They keep their size: they are bought as a pair.`,
          suggestion: { label: `Resize side stones to ${fmt(width)} mm`, ops: resize },
        })
    } else if (sides.length)
      notes.push('Side stones keep their size and move to sit 0.5 mm from the new girdle')
  }

  // One side stone changed alone: its partner keeps the old stone, so the pair no longer
  // matches, and nothing else would say so.
  const side =
    first.kind === 'gem' && targets.length === 1 && first.placement.type === 'ringTop'
      ? first.placement.side
      : undefined
  if (first.kind === 'gem' && side && ops.length && pair) {
    const shank = (first.placement as Extract<Gem['placement'], { type: 'ringTop' }>).shank
    const onBand = design.order
      .map((id) => design.nodes[id]!)
      .filter(
        (n): n is Gem =>
          n.kind === 'gem' && n.placement.type === 'ringTop' && n.placement.shank === shank,
      )
    const partner = onBand.find(
      (n) =>
        n.id !== first.id &&
        (n.placement as Extract<Gem['placement'], { type: 'ringTop' }>).side ===
          (side === 'left' ? 'right' : 'left') &&
        alike(n),
    )
    if (partner) {
      const twin = plan(design, { nodeId: partner.id }, changeInput, false)
      warnings.push({
        code: 'side.pair',
        nodeId: first.id,
        message: `Only “${nodeTitle(first)}” changes; its partner “${nodeTitle(partner)}” keeps the old stone, so the two sides no longer match.`,
        ...(twin.ops.length
          ? {
              suggestion: {
                label: `Make the same change to “${nodeTitle(partner)}”`,
                ops: twin.ops,
              },
            }
          : {}),
      })
    }
    // Against the centre stone (the ring-top stone without a side nearest the top).
    const centreGem = onBand.find(
      (n) => !(n.placement as Extract<Gem['placement'], { type: 'ringTop' }>).side,
    )
    if (centreGem) {
      const after = applyPatches(design, ops)
      const centreWidth = stoneDims(resolved.nodes[centreGem.id] as Gem).width
      const ratio = stoneDims(after.nodes[first.id] as Gem).width / centreWidth
      if (ratio < 0.45 || ratio > 0.75)
        warnings.push({
          code: 'side.proportion',
          nodeId: first.id,
          message: `“${nodeTitle(first)}” would be ${fmt(ratio)} of the centre stone's width (0.45 to 0.75 looks balanced)${ratio >= 1 ? ', larger than the centre stone itself' : ''}.`,
        })
    }
  }

  const after = applyPatches(design, ops)
  const ids = new Set(targets.map((n) => n.id))
  const related = relatedTo(after, ids)
  if (ops.length) notes.push(...followNotes(design, after, related))

  // Pins: a follow field the designer fixed is kept, and named when it now breaks its rule.
  // Not the fields this change writes itself (a fitted stone's measured ratio is not a hand
  // pin), and not the nominal ratio of a stone sized from its measurement, which the
  // measured stone overrides.
  const written = new Map(patched.map(({ node, patch }) => [node.id, new Set(Object.keys(patch))]))
  for (const pin of pinsOffRule(after)) {
    if (!related.has(pin.nodeId)) continue
    if (written.get(pin.nodeId)?.has(pin.path.split('.')[0]!)) continue
    const n = after.nodes[pin.nodeId]!
    if (pin.path === 'lw' && n.kind === 'gem' && measuredUsable(n.sourcing?.measured)) continue
    const [head, tail] = pin.path.split('.') as [string, string | undefined]
    warnings.push({
      code: 'pin.offRule',
      nodeId: pin.nodeId,
      message: `“${nodeTitle(n)}” keeps its ${pin.path} of ${fmt(pin.value)} (set by hand); for the new stone the rule gives ${fmt(pin.rule)}.`,
      suggestion: {
        label: `Reset ${pin.path} to auto (${fmt(pin.rule)})`,
        ops: [
          {
            t: 'update',
            id: pin.nodeId,
            patch: tail ? { [head]: { [tail]: null } } : { [head]: null },
          },
        ],
      },
    })
  }

  return {
    ops,
    label: labelFor(first, targets.length, change, after),
    notes: [...new Set(notes)],
    warnings,
  }
}

function applyPatches(design: Design, ops: readonly Op[]): Design {
  const nodes = { ...design.nodes }
  for (const op of ops) {
    if (op.t !== 'update') continue
    const n = { ...(nodes[op.id] as Record<string, unknown>) }
    for (const [k, v] of Object.entries(op.patch)) {
      if (v === null) delete n[k]
      else if (v && typeof v === 'object' && !Array.isArray(v)) {
        const inner = { ...(n[k] as Record<string, unknown>) }
        for (const [ik, iv] of Object.entries(v)) {
          if (iv === null) delete inner[ik]
          else inner[ik] = iv
        }
        n[k] = inner
      } else n[k] = v
    }
    nodes[op.id] = n as unknown as Node
  }
  return { ...design, nodes }
}

type Change = z.output<typeof StoneChangeSchema>

/**
 * The grade keys a change sets that differ from the stone's, or nothing. Ops merge objects key
 * by key, so the keys left out (origin, certification) are kept.
 */
function qualityPatch(
  current: StoneQuality | undefined,
  change: Change['quality'],
): Record<string, unknown> | undefined {
  if (!change) return undefined
  const changed = Object.fromEntries(
    Object.entries(change).filter(
      ([k, v]) =>
        v !== undefined &&
        JSON.stringify((current as Record<string, unknown> | undefined)?.[k]) !== JSON.stringify(v),
    ),
  )
  return Object.keys(changed).length ? changed : undefined
}

/** The stone fields of one gem. */
function gemPatch(
  node: Gem,
  resolved: Gem,
  change: Change,
  notes: string[],
  warnings: IntentWarning[],
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const cut = change.cut ?? node.cut
  const stone = change.stone ?? node.stone
  const before = stoneDims(resolved)
  const caratBefore = gemCarat(node.cut, before, node.stone)
  const cutRange = GEM_CUTS[cut].lw

  if (change.fit?.measured) {
    // Fit the mount to a real stone: the link with its measured size, and nominal fields that
    // agree with it, so the inspector, the stone list and a later unlink all say the same.
    const m = change.fit.measured
    const width = Math.min(m.length, m.width)
    const ratio = Math.max(m.length, m.width) / width
    patch.sourcing = change.fit
    patch.cut = cut
    patch.width = mm2(width)
    patch.lw = cut === 'round' ? null : Number(ratio.toFixed(3))
    if (ratio < cutRange.min - 0.005 || ratio > cutRange.max + 0.005)
      warnings.push({
        code: 'stone.ratio',
        nodeId: node.id,
        message: `The stone measures ${fmt(ratio)} length : width, outside what a ${GEM_CUTS[cut].label.toLowerCase()} is usually cut to (${cutRange.min}–${cutRange.max}); the seat follows the measured stone.`,
      })
    notes.push(
      `Fitted to ${change.fit.provider} ${change.fit.sku}: ${fmt(m.length)} × ${fmt(m.width)} × ${fmt(m.depth)} mm`,
    )
    if (change.stone) patch.stone = change.stone
    const grade = qualityPatch(node.quality, change.quality)
    if (grade) patch.quality = grade
    return patch
  }

  if (change.cut && change.cut !== node.cut) patch.cut = change.cut
  if (change.stone && change.stone !== node.stone) patch.stone = change.stone
  const grade = qualityPatch(node.quality, change.quality)
  if (grade) patch.quality = grade

  // Length : width: given (clamped to the cut), or reset to follow a new cut.
  let lw: number | undefined = cut === node.cut ? node.lw : undefined
  if (change.lw !== undefined) {
    const clamped = Math.min(cutRange.max, Math.max(cutRange.min, change.lw))
    if (Math.abs(clamped - change.lw) > 1e-9)
      warnings.push({
        code: 'stone.ratio',
        nodeId: node.id,
        message: `A ${GEM_CUTS[cut].label.toLowerCase()} is cut between ${cutRange.min} and ${cutRange.max} length : width; ${clamped} was used.`,
      })
    lw = cut === 'round' ? undefined : clamped
    patch.lw = lw ?? null
  } else if (patch.cut && node.lw !== undefined) patch.lw = null

  // Size: as given; else a new cut keeps the carat (how a single stone is bought and talked
  // about); else a new material keeps the millimetres, so the mount does not move.
  let width = node.width
  if (change.widthMm !== undefined) width = change.widthMm
  else if (change.carat !== undefined) width = gemDimsFromCarat(cut, change.carat, stone, lw).width
  else if (patch.cut || patch.lw !== undefined)
    width = gemDimsFromCarat(cut, caratBefore, stone, lw).width
  width = mm2(width)
  if (width < 0.6 || width > 40) {
    const clamped = Math.min(40, Math.max(0.6, width))
    warnings.push({
      code: 'stone.size',
      nodeId: node.id,
      message: `A ${fmt(width)} mm stone is outside 0.6–40 mm; ${fmt(clamped)} mm was used.`,
    })
    width = clamped
  }
  if (Math.abs(width - node.width) > 1e-9) patch.width = width

  const after = gemDims(cut, width, lw)
  const caratAfter = gemCarat(cut, after, stone)
  if (patch.cut && change.widthMm === undefined && change.carat === undefined)
    notes.push(
      `Kept ${ct(caratBefore)}: ${sizeText(node.cut, before)} is now ${sizeText(cut, after)}`,
    )
  else if (patch.width !== undefined || patch.cut)
    notes.push(
      `${sizeText(node.cut, before)} (${ct(caratBefore)}) is now ${sizeText(cut, after)} (${ct(caratAfter)})`,
    )
  else if (patch.stone)
    notes.push(`${sizeText(cut, after)} ${materialLabel(stone)} weighs ${ct(caratAfter)}`)
  return patch
}

/** The stone fields of a row, halo or pavé field. */
function fieldPatch(
  node: Field,
  change: Change,
  notes: string[],
  warnings: IntentWarning[],
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (change.cut && change.cut !== node.cut) patch.cut = change.cut
  if (change.stone && change.stone !== node.stone) patch.stone = change.stone
  const grade = qualityPatch(node.quality, change.quality)
  if (grade) patch.quality = grade
  if (change.fit)
    warnings.push({
      code: 'fit.field',
      nodeId: node.id,
      message: `“${nodeTitle(node)}” holds many stones bought as a parcel: fit one real stone with a single stone, not a field.`,
    })
  const size = fieldSize(node)
  const cut = change.cut ?? node.cut
  const stone = change.stone ?? node.stone
  let asked: number | undefined
  if (change.widthMm !== undefined) asked = change.widthMm
  else if (change.carat !== undefined) asked = gemDimsFromCarat(cut, change.carat, stone).width
  if (asked !== undefined) {
    // Melee is calibrated by diameter: snap to a stock size within the field's range.
    let next = snapToMelee(asked)
    if (next > size.max) {
      warnings.push({
        code: 'stone.size',
        nodeId: node.id,
        message: `${fmt(asked)} mm is larger than “${nodeTitle(node)}” takes (${size.max} mm); ${size.max} mm was used.`,
      })
      next = size.max
    }
    if (Math.abs(next - asked) > 0.005 && next <= size.max)
      notes.push(`${fmt(asked)} mm snapped to the stock size ${fmt(next)} mm`)
    if (Math.abs(next - size.value) > 1e-9) {
      patch[size.key] = next
      const scale = next / size.value
      // A graduated row keeps its graduation; a pavé keeps its spread of sizes.
      if (node.kind === 'gemRow' && node.graduateTo !== undefined)
        patch.graduateTo = Math.min(6, snapToMelee(node.graduateTo * scale))
      if (node.kind === 'pave') patch.sizeMin = Math.min(next, snapToMelee(node.sizeMin * scale))
      notes.push(
        `“${nodeTitle(node)}”: ${fmt(size.value)} → ${fmt(next)} mm stones; the count follows on evaluation`,
      )
    }
  } else if (patch.stone) {
    const dims = gemDims(cut, size.value)
    notes.push(
      `“${nodeTitle(node)}”: ${sizeText(cut, dims)} ${materialLabel(stone)}, ${ct(gemCarat(cut, dims, stone))} each`,
    )
  }
  return patch
}

function labelFor(first: StoneNode, count: number, change: Change, after: Design): string {
  const n = after.nodes[first.id] as StoneNode
  const what = count > 1 ? `${count} alike stones` : `“${nodeTitle(first)}”`
  if (change.fit) return `Fit ${what} to ${change.fit.provider} ${change.fit.sku}`
  const parts: string[] = []
  if (n.kind === 'gem') {
    const dims = stoneDims(n)
    if (change.cut || change.widthMm !== undefined || change.carat !== undefined)
      parts.push(`${ct(gemCarat(n.cut, dims, n.stone))} ${GEM_CUTS[n.cut].label.toLowerCase()}`)
  } else if (change.cut || change.widthMm !== undefined || change.carat !== undefined)
    parts.push(`${fmt(fieldSize(n).value)} mm ${GEM_CUTS[n.cut].label.toLowerCase()}`)
  if (change.stone) parts.push(materialLabel(change.stone))
  if (change.quality && parts.length === 0) parts.push('new grade')
  return `Replace ${what}${parts.length ? `: ${parts.join(', ')}` : ''}`.slice(0, 200)
}
