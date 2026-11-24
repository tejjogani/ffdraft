/**
 * Prompt text. UNIVERSAL_PRINCIPLES and CANON_INDEX go in the cached core prompt (their bytes
 * depend only on CANON_VERSION); renderCanonForPrompt prints a per-piece slice. Deterministic.
 */
import { ARCHETYPES } from '@pave/schema'
import { EXEMPLAR_SOURCES } from './exemplars/index'
import { printExpr } from './expr'
import type { CanonSlice, SliceRule } from './model'
import { PRINCIPLES } from './rubric'
import { RULE_FAMILIES } from './rules/index'
import { STYLES } from './styles/index'
import { CANON_VERSION } from './version'

const n = (x: number) => String(Number(x.toFixed(2)))

/** Research 09 §6 principles, briefing and directions, and §7 practice, as standing instructions. */
export const UNIVERSAL_PRINCIPLES = [
  `Design principles (canon ${CANON_VERSION}):`,
  ...PRINCIPLES.map((l) => `- ${l}`),
].join('\n')

const short = (id: string) => id.split('.').slice(1).join('.')

/** Every family's rule ids, the style guides and the exemplars: what canon.get can return. */
export const CANON_INDEX = [
  `Canon index (${CANON_VERSION}). Ask canon.get for a slice; lint codes are style.<rule id>.`,
  'Rules:',
  ...Object.entries(RULE_FAMILIES).map(
    ([family, rules]) => `- ${family}: ${rules.map((r) => short(r.id)).join(', ')}`,
  ),
  'Style guides:',
  ...STYLES.map((g) => `- ${g.id}: ${g.label} (${g.aliases.slice(0, 3).join(', ')})`),
  'Exemplars:',
  ...ARCHETYPES.map((a) => {
    const ids = EXEMPLAR_SOURCES.filter((e) => e.archetype === a).map((e) => e.id)
    return `- ${a}: ${ids.join(', ')}`
  }),
].join('\n')

function ruleLine(s: SliceRule): string {
  const r = s.rule
  const where = r.measure ?? r.paths.join(', ')
  const nums = s.band
    ? `${n(s.band.typical)} [${n(s.band.min)}–${n(s.band.max)}]`
    : `${printExpr(r.band.typical)} [${printExpr(r.band.min)}–${printExpr(r.band.max)}]`
  // Warnings carry their reason; notes and suggestions print their title to save the budget.
  return r.severity === 'warning'
    ? `- ${r.id} (${where}) ${nums}: ${r.rationale}`
    : `- ${r.id} (${where}) ${nums}: ${r.title}`
}

/** Prints a slice: `pack` with evaluated bands and cards, `index` as one line per item. */
export function renderCanonForPrompt(
  slice: CanonSlice,
  o: { format?: 'pack' | 'index' } = {},
): string {
  if (o.format === 'index')
    return [
      `Canon ${slice.version} · ${slice.key}`,
      `Rules: ${slice.rules.map((r) => r.rule.id).join(', ')}`,
      `Styles: ${slice.styles.map((g) => g.id).join(', ') || 'none'}`,
      `Exemplars: ${slice.exemplars.map((e) => e.id).join(', ')}`,
    ].join('\n')
  const out = [
    `# Canon ${slice.version} · ${slice.key}`,
    '## Rules (typical [band]; warnings give the reason)',
  ]
  out.push(...slice.rules.map(ruleLine))
  for (const g of slice.styles) {
    out.push(`## Style: ${g.label}`)
    out.push(`Reads right: ${g.reads.join(' ')}`)
    if (g.do.length) out.push(`Do: ${g.do.join(' ')}`)
    if (g.dont.length) out.push(`Don't: ${g.dont.join(' ')}`)
    for (const r of g.recipes)
      out.push(
        `- ${r.path} ${printExpr(r.band.typical)} [${printExpr(r.band.min)}–${printExpr(r.band.max)}]${r.note ? `: ${r.note}` : ''}`,
      )
  }
  out.push('## Exemplars')
  for (const e of slice.exemplars) {
    const params = Object.entries(e.keyParams)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')
    out.push(
      `- ${e.id}, ${e.title} (${e.archetype}, ${e.variant}; ${e.styles.join(', ')}): ${params}`,
    )
    out.push(`  Why: ${e.why.join(' ')} Bad twin: ${e.antiTwin}.`)
  }
  if (slice.caveats.length) {
    out.push('## Cannot build: say so, offer the stand-in')
    out.push(...slice.caveats.map((c) => `- ${c.feature} → ${c.fallback}`))
  }
  if (slice.failureModes.length)
    out.push(`## Watch for\n${slice.failureModes.map((f) => `- ${f}`).join('\n')}`)
  if (slice.questions.length)
    out.push(`## Ask (at most three)\n${slice.questions.map((q) => `- ${q}`).join('\n')}`)
  return out.join('\n')
}
