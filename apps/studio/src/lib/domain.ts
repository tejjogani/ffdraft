/** Human labels for schema enums. The values themselves come from @pave/schema. */
import { METALS, type PieceKind, type PieceSummary, STAGES, type Stage } from '@pave/schema'
import { carats, grams, plural } from './format'

export const STAGE_LABEL: Record<Stage, string> = {
  idea: 'Idea',
  spec: 'Spec',
  design: 'CAD',
  render: 'Render',
  production: 'Production',
  done: 'Done',
}

export const stageStep = (s: Stage): number => STAGES.indexOf(s)
export const STAGE_STEPS = STAGES.length - 1

export const KIND_LABEL: Record<PieceKind, string> = {
  ring: 'Ring',
  pendant: 'Pendant',
  earrings: 'Earrings',
  bracelet: 'Bracelet',
  necklace: 'Necklace',
  chain: 'Chain',
  brooch: 'Brooch',
  other: 'Other',
}

export const metalLabel = (id: string): string =>
  id in METALS ? METALS[id as keyof typeof METALS].label : id
export const metalSwatch = (id: string): string | undefined =>
  id in METALS ? METALS[id as keyof typeof METALS].swatch : undefined

/** Whether a piece has been built far enough to have a weight worth showing. */
export function hasFacts(
  facts: PieceSummary['facts'] | undefined,
): facts is NonNullable<PieceSummary['facts']> {
  return !!facts && facts.metalMassG > 0
}

/** One muted line of facts for cards: "18k Yellow Gold · 3.2 g · 1.52 ct". */
export function factsLine(p: Pick<PieceSummary, 'facts' | 'kind'>): string {
  const f = p.facts
  // An empty design (an idea not built yet) weighs nothing: name the kind, not "0 g".
  if (!hasFacts(f)) return KIND_LABEL[p.kind]
  return [
    metalLabel(f.metal),
    grams(f.metalMassG),
    f.stoneCount ? (f.caratTotal ? carats(f.caratTotal) : plural(f.stoneCount, 'stone')) : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
