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
import { nodeFacts, pieceFacts } from './facts'
import { MEASURES } from './measures'
import type { CanonFinding, DesignRead } from './model'
import { patchFor, readPath, roundFor } from './paths'
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
  waived?: readonly string[]
}

const fmt = (x: number) => String(Number(x.toFixed(2)))

export function lintDesign(
  design: Design,
  summary?: EvaluationSummary,
  o: LintOptions = {},
): CanonFinding[] {
  const words = o.styles ?? o.spec?.style ?? o.intent?.synthesis?.styleTags ?? []
  const archetype =
    o.archetype ?? o.spec?.archetype ?? o.intent?.synthesis?.archetype ?? inferArchetype(design)
  const waived = new Set([...(o.waived ?? []), ...(o.intent?.waivers ?? []).map((w) => w.ruleId)])
  const ctx = { kind: design.kind, archetype, words }
  const piece = pieceFacts(design, { styles: words })
  const out: CanonFinding[] = []

  for (const rule of effectiveRules(matchStyles(words))) {
    if (rule.severity === 'default' || rule.expressible === false || waived.has(rule.id)) continue
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
      const target =
        rule.fix && !rule.measure && node && rule.paths.length === 1
          ? rule.fix === 'setTypical'
            ? bandFor(rule, facts)?.typical
            : Math.min(hull.max, Math.max(hull.min, value))
          : undefined
      const fixed =
        target === undefined
          ? undefined
          : roundFor(path, target, Math.max(hull.min, range.lo), Math.min(hull.max, range.hi))
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
