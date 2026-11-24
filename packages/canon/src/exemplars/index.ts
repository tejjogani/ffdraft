/**
 * The curated exemplars: canon-built pieces with an anti-twin each. Sources are plain data; the
 * built designs, their reads and key parameters are derived once, on first use.
 */
import { applyOps, type Design, designFrom } from '@pave/schema'
import { pieceFacts } from '../facts'
import type { Exemplar, ExemplarSource } from '../model'
import { readDesign } from '../read'
import { suggestDesign } from '../suggest'
import { BANDS } from './band'
import { CHAINS } from './chain'
import { CUSTOM_RINGS } from './custom'
import { EARRINGS } from './earring'
import { ETERNITIES } from './eternity'
import { HALOS } from './halo'
import { ICED } from './iced'
import { PENDANTS } from './pendant'
import { SIGNETS } from './signet'
import { SOLITAIRES } from './solitaire'
import { THREE_STONES } from './threeStone'

export const EXEMPLAR_SOURCES: readonly ExemplarSource[] = [
  ...SOLITAIRES,
  ...HALOS,
  ...THREE_STONES,
  ...ETERNITIES,
  ...BANDS,
  ...SIGNETS,
  ...PENDANTS,
  ...ICED,
  ...EARRINGS,
  ...CHAINS,
  ...CUSTOM_RINGS,
]

/** Builds an exemplar exactly as the assistant would: recipe plus canon, then its own edits. */
export function buildExemplar(e: ExemplarSource): Design {
  if ('nodes' in e.build) return designFrom(e.build.kind, e.build.nodes)
  const { design } = suggestDesign(e.build.spec, { variant: e.variant })
  return e.build.ops?.length ? applyOps(design, e.build.ops).design : design
}

/** The facts shown on an exemplar's prompt card, per archetype. */
const CARD_FACTS: Record<Exemplar['archetype'], readonly string[]> = {
  solitaire: ['W', 'bandW', 'bandT', 'e', 'wire', 'wall', 'prongs'],
  halo: ['W', 'haloD', 'haloOffset', 'bandW', 'e', 'wire'],
  threeStone: ['W', 'bandW', 'e', 'wire'],
  eternity: ['bandW', 'bandT', 'rowD', 'rowCov'],
  band: ['bandW', 'bandT', 'ID', 'W'],
  signet: ['reliefW', 'reliefH', 'bandW', 'bandWB', 'bandT', 'W'],
  pendantSolitaire: ['W', 'wire', 'wall', 'chainW', 'opening'],
  namePendant: ['H', 'T', 'chainW', 'opening'],
  icedPendant: ['H', 'T', 'paveMax', 'border', 'chainW', 'opening'],
  medallion: ['H', 'reliefDepth', 'reliefBase', 'chainW'],
  studs: ['W', 'wire', 'wall'],
  tennis: ['chainW', 'chainWire', 'chainL'],
  cuban: ['chainW', 'chainWire', 'chainL'],
  custom: ['W', 'bandW', 'hoopID', 'pipeW', 'wire', 'wall'],
}

function keyParams(e: ExemplarSource, d: Design): Exemplar['keyParams'] {
  const f = pieceFacts(d, { styles: e.styles })
  const out: Exemplar['keyParams'] = {}
  const metal = d.order.map((id) => d.nodes[id]).find((n) => n && 'material' in n)
  if (metal && 'material' in metal) out.metal = metal.material
  const gem = d.order.map((id) => d.nodes[id]).find((n) => n?.kind === 'gem')
  if (gem?.kind === 'gem') out.cut = gem.cut
  const head = d.order.map((id) => d.nodes[id]).find((n) => n?.kind === 'setting')
  if (head?.kind === 'setting') out.head = head.style
  for (const k of CARD_FACTS[e.archetype]) {
    const v = f[k as keyof typeof f]
    if (v === undefined) continue
    if (
      (k === 'wire' || k === 'prongs') &&
      head?.kind === 'setting' &&
      head.style !== 'prong' &&
      head.style !== 'basket'
    )
      continue
    if (
      k === 'wall' &&
      head?.kind === 'setting' &&
      head.style !== 'bezel' &&
      head.style !== 'halfBezel'
    )
      continue
    out[k] = Number(v.toFixed(2))
  }
  return out
}

let built: readonly Exemplar[] | undefined

/** Every exemplar with its derived read and key parameters (built once, deterministic). */
export function getExemplars(): readonly Exemplar[] {
  built ??= EXEMPLAR_SOURCES.map((e) => {
    const d = buildExemplar(e)
    return {
      ...e,
      read: readDesign(d, undefined, {
        source: 'exemplar',
        archetype: e.archetype,
        styles: e.styles,
      }),
      keyParams: keyParams(e, d),
    }
  })
  return built
}
