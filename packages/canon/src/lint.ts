/**
 * Canon lint: every applicable rule checked against the design, as kernel-shaped diagnostics
 * (`style.<ruleId>`). Warnings and notes only: the kernel owns errors. A finding carries a fix
 * only where one clamp of one parameter resolves it.
 */
import type { Archetype, Design, EvaluationSummary, Node, PieceSpecInput } from '@pave/schema'
import {
  bandFor,
  effectiveRules,
  hullFor,
  lintRange,
  matchStyles,
  ruleApplies,
  whenHolds,
} from './engine'
import { nodeFacts, type PairWith, pieceFacts } from './facts'
import { MEASURES } from './measures'
import type { CanonFinding, DesignRead } from './model'
import { fieldInfo, patchFor, readPath, roundFor } from './paths'
import { inferArchetype } from './read'

export interface LintOptions {
  spec?: PieceSpecInput
  /** The design intent: its synthesis gives archetype and style tags; its waivers are honoured. */
  intent?: {
    synthesis?: Pick<DesignRead, 'archetype' | 'styleTags'>
    waivers?: { ruleId: string }[]
  }
  archetype?: Archetype
  styles?: readonly string[]
  /** The engagement shank a wedding band is made for (band.pair.*). */
  pairWith?: PairWith
  waived?: readonly string[]
}

const fmt = (x: number) => String(Number(x.toFixed(2)))

export function lintDesign(
  design: Design,
  summary?: EvaluationSummary,
  o: LintOptions = {},
): CanonFinding[] {
  // A parsed spec always carries `style: []`, so the spec's words and the intent's tags merge.
  const words =
    o.styles ?? [...new Set([...(o.spec?.style ?? []), ...(o.intent?.synthesis?.styleTags ?? [])])]
  const archetype =
    o.archetype ?? o.spec?.archetype ?? o.intent?.synthesis?.archetype ?? inferArchetype(design)
  const waived = new Set([...(o.waived ?? []), ...(o.intent?.waivers ?? []).map((w) => w.ruleId)])
  const ctx = { kind: design.kind, archetype, words }
  const piece = pieceFacts(design, { styles: words, ...(o.pairWith ? { pairWith: o.pairWith } : {}) })
  const out: CanonFinding[] = []

  const rules = effectiveRules(matchStyles(words))
  /**
   * Where a fix may land: inside the rule's own hull and every other applicable lint range on
   * the same path, so applying it cannot raise another finding. Undefined when they disagree.
   */
  const fixRange = (node: Node, path: string, own: { min: number; max: number }) => {
    const facts = nodeFacts(design, node.id, piece)
    let lo = own.min
    let hi = own.max
    for (const r of rules) {
      if (r.severity === 'default' || r.measure || !r.paths.includes(path)) continue
      if (r.applies.nodeKind && r.applies.nodeKind !== node.kind) continue
      if (!ruleApplies(r, ctx) || !whenHolds(r, facts)) continue
      const range = lintRange(r, facts)
      if (range) {
        lo = Math.max(lo, range.lo)
        hi = Math.min(hi, range.hi)
      }
    }
    const info = fieldInfo(path)
    lo = Math.max(lo, info?.minimum ?? -Infinity)
    hi = Math.min(hi, info?.maximum ?? Infinity)
    return lo <= hi + 1e-9 ? { lo, hi } : undefined
  }

  for (const rule of rules) {
    if (rule.severity === 'default' || waived.has(rule.id)) continue
    if (!ruleApplies(rule, ctx)) continue
    const subjects: (Node | undefined)[] = rule.applies.nodeKind
      ? design.order
          .map((id) => design.nodes[id])
          .filter((n): n is Node => !!n && n.kind === rule.applies.nodeKind && n.visible)
      : [undefined]
    for (const node of subjects) {
      const facts = node ? nodeFacts(design, node.id, piece) : piece
      if (!whenHolds(rule, facts)) continue
      const path = rule.paths[0]!
      const measured = rule.measure
        ? MEASURES[rule.measure]?.({ design, facts, node, summary })
        : node && { value: readPath(node, path) }
      const value = measured?.value
      const range = lintRange(rule, facts)
      const hull = hullFor(rule, facts)
      if (value === undefined || !range || !hull) continue
      const below = value < range.lo - 1e-6
      if (!below && !(value > range.hi + 1e-6)) continue
      const limit = below ? range.lo : range.hi
      const nodeId =
        measured && 'nodeId' in measured && measured.nodeId ? measured.nodeId : node?.id
      const where =
        rule.fix && !rule.measure && node && rule.paths.length === 1
          ? fixRange(node, path, hull)
          : undefined
      const wanted =
        where && (rule.fix === 'setTypical' ? (bandFor(rule, facts)?.typical ?? value) : value)
      const fixed =
        where && wanted !== undefined
          ? roundFor(path, Math.min(where.hi, Math.max(where.lo, wanted)), where.lo, where.hi)
          : undefined
      out.push({
        level: rule.severity,
        code: `style.${rule.id}`,
        message: `${rule.title}: ${fmt(value)} is ${below ? 'below' : 'above'} ${fmt(limit)} (canon ${fmt(hull.min)}–${fmt(hull.max)}). ${rule.rationale}`,
        ...(nodeId ? { nodeId } : {}),
        value,
        limit,
        ruleId: rule.id,
        param: rule.measure ?? path,
        band: [hull.min, hull.max],
        ...(fixed !== undefined && node
          ? {
              fix: {
                label: `Set ${path.split('.').slice(1).join('.')} to ${fmt(fixed)}`,
                ops: [{ t: 'update' as const, id: node.id, patch: patchFor(node, path, fixed) }],
              },
            }
          : {}),
      })
    }
  }
  return out
}
