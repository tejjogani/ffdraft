/**
 * Models, tiers and cost.
 *
 * A person picks a tier (Power, Standard, Light); settings point each tier at one model of the
 * allow-list; `.env` overrides win over settings. Prices are USD per million tokens, as published
 * for the Claude API. Cost is computed from a response's `usage`, attempt by attempt when the
 * response reports `usage.iterations` (a server-side fallback or a compaction ran), at the rates
 * of the model that ran each attempt.
 */
import {
  ASSISTANT_MODELS,
  ASSISTANT_TIERS,
  type AssistantModelId,
  type AssistantTier,
  type Tokens,
} from '@pave/schema'

/** USD per million tokens. */
export interface Rates {
  input: number
  output: number
  cacheRead: number
  /** A cache write with the default 5-minute lifetime. */
  cacheWrite5m: number
  cacheWrite1h: number
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface ModelInfo {
  id: AssistantModelId
  label: string
  rates: Rates
  /** A second rate card for long prompts (input + cache read + cache write tokens above this). */
  longPrompt?: { aboveTokens: number; rates: Rates }
  /**
   * How a refusal is retried on another model by the API itself. `default` = the API picks the
   * model by refusal category; `none` = this model has no server-side fallback, so the request
   * must not carry the parameter and a refusal is handled by the run.
   */
  fallbacks: 'default' | 'none'
  /** The organisation must keep 30-day data retention to use it (otherwise every request 400s). */
  needsRetention: boolean
  /** The API's default effort; requests always set effort explicitly, this is for the record. */
  defaultEffort: Effort
  contextTokens: number
  maxOutputTokens: number
}

/** Rates for a model: input, output, cache read, and writes at 1.25× and 2× input. */
const rates = (input: number, output: number, cacheRead: number): Rates => ({
  input,
  output,
  cacheRead,
  cacheWrite5m: input * 1.25,
  cacheWrite1h: input * 2,
})

export const MODELS = {
  'claude-fable-5-2': {
    id: 'claude-fable-5-2',
    label: 'Claude Fable 5.2',
    rates: rates(8, 40, 0.2),
    fallbacks: 'default',
    needsRetention: true,
    defaultEffort: 'high',
    contextTokens: 1_000_000,
    maxOutputTokens: 128_000,
  },
  'claude-opus-5-5': {
    id: 'claude-opus-5-5',
    label: 'Claude Opus 5.5',
    rates: rates(4, 20, 0.2),
    fallbacks: 'default',
    needsRetention: false,
    defaultEffort: 'medium',
    contextTokens: 1_000_000,
    maxOutputTokens: 128_000,
  },
  'claude-sonnet-5-5': {
    id: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5',
    rates: rates(2, 10, 0.1),
    fallbacks: 'default',
    needsRetention: false,
    defaultEffort: 'high',
    contextTokens: 1_000_000,
    maxOutputTokens: 128_000,
  },
  'claude-haiku-5-5': {
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    rates: rates(0.1, 0.5, 0.01),
    longPrompt: { aboveTokens: 100_000, rates: rates(0.5, 2.5, 0.05) },
    fallbacks: 'none',
    needsRetention: false,
    defaultEffort: 'medium',
    contextTokens: 1_000_000,
    maxOutputTokens: 128_000,
  },
} as const satisfies Record<AssistantModelId, ModelInfo>

/**
 * Models a server-side fallback may hand a refused request to. They are never chosen as a tier,
 * but an attempt they serve is billed at their rates, so cost must know them.
 */
const FALLBACK_RATES: Record<string, Rates> = {
  'claude-opus-5': rates(5, 25, 0.5),
  'claude-opus-4-8': rates(5, 25, 0.5),
  'claude-sonnet-5': rates(2, 10, 0.2),
}

export const isAssistantModel = (id: string): id is AssistantModelId =>
  (ASSISTANT_MODELS as readonly string[]).includes(id)

export const isAssistantTier = (id: string): id is AssistantTier =>
  (ASSISTANT_TIERS as readonly string[]).includes(id)

export interface TierInfo {
  tier: AssistantTier
  label: string
  /** One line for the picker. */
  blurb: string
  defaultModel: AssistantModelId
}

export const TIERS = {
  power: {
    tier: 'power',
    label: 'Power',
    blurb: 'Most capable, for hard pieces and photo matching. Slowest and dearest.',
    defaultModel: 'claude-fable-5-2',
  },
  standard: {
    tier: 'standard',
    label: 'Standard',
    blurb: 'Strong designer for everyday work.',
    defaultModel: 'claude-opus-5-5',
  },
  light: {
    tier: 'light',
    label: 'Light',
    blurb: 'Quick answers and small edits, at a fraction of the cost.',
    defaultModel: 'claude-sonnet-5-5',
  },
} as const satisfies Record<AssistantTier, TierInfo>

export const DEFAULT_TIER: AssistantTier = 'standard'

// ── Which model a tier runs on ───────────────────────────────────────────────────────────────

export type TierSource = 'env' | 'settings' | 'default'

/** The organisation's saved choices (`org.settings.get`). */
export interface TierSettings {
  assistantTier: AssistantTier | null
  assistantModels: Partial<Record<AssistantTier, AssistantModelId | null>>
}

/**
 * Optional overrides in `apps/server/.env`. They win over the settings, so a founder testing
 * locally can pin models without opening the app; the settings screen says so.
 */
export const TIER_ENV = {
  tier: 'PAVE_ASSISTANT_TIER',
  power: 'PAVE_ASSISTANT_MODEL_POWER',
  standard: 'PAVE_ASSISTANT_MODEL_STANDARD',
  light: 'PAVE_ASSISTANT_MODEL_LIGHT',
} as const

export interface ResolvedTiers {
  defaultTier: { tier: AssistantTier; source: TierSource }
  tiers: Record<AssistantTier, { model: AssistantModelId; source: TierSource }>
  /** Overrides that were set but not understood, in plain words; they are ignored. */
  warnings: string[]
}

export function resolveTiers(
  settings: TierSettings | null,
  env: Readonly<Record<string, string | undefined>> = {},
): ResolvedTiers {
  const warnings: string[] = []
  const fromEnv = <T extends string>(key: string, ok: (v: string) => v is T, what: string) => {
    const raw = env[key]?.trim()
    if (!raw) return undefined
    if (ok(raw)) return raw
    warnings.push(`${key}=${raw} is not ${what}; it is ignored.`)
    return undefined
  }
  const envTier = fromEnv(TIER_ENV.tier, isAssistantTier, `a tier (${ASSISTANT_TIERS.join(', ')})`)
  const defaultTier = envTier
    ? { tier: envTier, source: 'env' as const }
    : settings?.assistantTier
      ? { tier: settings.assistantTier, source: 'settings' as const }
      : { tier: DEFAULT_TIER, source: 'default' as const }
  const tiers = {} as ResolvedTiers['tiers']
  for (const tier of ASSISTANT_TIERS) {
    const e = fromEnv(TIER_ENV[tier], isAssistantModel, `one of ${ASSISTANT_MODELS.join(', ')}`)
    const s = settings?.assistantModels[tier]
    tiers[tier] = e
      ? { model: e, source: 'env' }
      : s
        ? { model: s, source: 'settings' }
        : { model: TIERS[tier].defaultModel, source: 'default' }
  }
  return { defaultTier, tiers, warnings }
}

/** The tier and model one run uses: the one asked for, else the organisation's default tier. */
export function modelForRun(
  resolved: ResolvedTiers,
  requested?: AssistantTier,
): { tier: AssistantTier; model: AssistantModelId } {
  const tier = requested ?? resolved.defaultTier.tier
  return { tier, model: resolved.tiers[tier].model }
}

// ── Cost ─────────────────────────────────────────────────────────────────────────────────────

/** The usage fields cost needs, as the SDK reports them (top level or one iteration). */
export interface UsageLike {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_creation?: {
    ephemeral_5m_input_tokens: number
    ephemeral_1h_input_tokens: number
  } | null
}

export interface IterationLike extends UsageLike {
  type: string
  model?: string | null
}

export interface ResponseUsage extends UsageLike {
  iterations?: readonly IterationLike[] | null
}

function ratesFor(model: string, promptTokens: number): Rates | null {
  if (isAssistantModel(model)) {
    const info: ModelInfo = MODELS[model]
    return info.longPrompt && promptTokens > info.longPrompt.aboveTokens
      ? info.longPrompt.rates
      : info.rates
  }
  return FALLBACK_RATES[model] ?? null
}

function costOf(model: string, u: UsageLike): number {
  const read = u.cache_read_input_tokens ?? 0
  const write = u.cache_creation_input_tokens ?? 0
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const r = ratesFor(model, u.input_tokens + read + write)
  // An unknown model is priced as the dearest one, so a budget is never under-counted.
  const p = r ?? MODELS['claude-fable-5-2'].rates
  return (
    (u.input_tokens * p.input +
      u.output_tokens * p.output +
      read * p.cacheRead +
      (write - write1h) * p.cacheWrite5m +
      write1h * p.cacheWrite1h) /
    1_000_000
  )
}

const tokensOf = (u: UsageLike): Tokens => ({
  input: u.input_tokens,
  output: u.output_tokens,
  cacheRead: u.cache_read_input_tokens ?? 0,
  cacheWrite: u.cache_creation_input_tokens ?? 0,
})

/**
 * Tokens and cost of one response. With `iterations`, each attempt is priced at its own model's
 * rates and the top-level usage (which covers only the attempt that answered) is not added again.
 */
export function usageCost(
  model: string,
  usage: ResponseUsage,
): { tokens: Tokens; costUsd: number } {
  const parts = usage.iterations?.length
    ? usage.iterations.map((it) => ({ model: it.model ?? model, u: it }))
    : [{ model, u: usage }]
  const tokens: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  let costUsd = 0
  for (const { model: m, u } of parts) {
    const t = tokensOf(u)
    tokens.input += t.input
    tokens.output += t.output
    tokens.cacheRead += t.cacheRead
    tokens.cacheWrite += t.cacheWrite
    costUsd += costOf(m, u)
  }
  return { tokens, costUsd }
}

/**
 * What a typical design run costs on a model, for the settings screen: six model calls over a
 * 25K-token frozen prefix, each adding 4K tokens of tool results and writing 2.5K tokens
 * (thinking, text and tool calls). Everything sent before is read from the cache; what each call
 * adds is written to it. A rough guide: real runs vary with the piece, the photos and the effort.
 */
export function typicalRunUsd(model: AssistantModelId): number {
  const calls = 6
  const prefix = 25_000
  const added = 4_000
  const output = 2_500
  let usd = 0
  for (let i = 0; i < calls; i++)
    usd += costOf(model, {
      input_tokens: 0,
      output_tokens: output,
      cache_read_input_tokens: i === 0 ? 0 : prefix + added + (i - 1) * (added + output),
      cache_creation_input_tokens: i === 0 ? prefix + added : added + output,
    })
  return usd
}
