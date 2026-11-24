import type { Rule } from '../model'
import { BAND_RULES } from './band'
import { BEZEL_RULES } from './bezel'
import { BRACELET_RULES } from './bracelet'
import { CHAIN_RULES } from './chain'
import { EARRING_RULES } from './earring'
import { HALO_RULES } from './halo'
import { ICED_RULES } from './iced'
import { METAL_RULES } from './metals'
import { PENDANT_RULES } from './pendant'
import { RING_RULES } from './ring'
import { ROW_RULES } from './rows'
import { SIGNET_RULES } from './signet'
import { STONE_RULES } from './stones'
import { THREE_STONE_RULES } from './threeStone'

/** Rules by family, in the order the prompt index lists them. */
export const RULE_FAMILIES = {
  solitaire: RING_RULES,
  halo: HALO_RULES,
  threeStone: THREE_STONE_RULES,
  rows: ROW_RULES,
  bands: BAND_RULES,
  signet: SIGNET_RULES,
  bezel: BEZEL_RULES,
  stones: STONE_RULES,
  metals: METAL_RULES,
  pendant: PENDANT_RULES,
  iced: ICED_RULES,
  chain: CHAIN_RULES,
  earrings: EARRING_RULES,
  bracelets: BRACELET_RULES,
} as const satisfies Record<string, readonly Rule[]>

export const RULES: readonly Rule[] = Object.values(RULE_FAMILIES).flat()

export const RULES_BY_ID: ReadonlyMap<string, Rule> = new Map(RULES.map((r) => [r.id, r]))
