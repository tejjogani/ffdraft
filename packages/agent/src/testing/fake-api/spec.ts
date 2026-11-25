/**
 * What the fake Claude API knows about each model, taken from the claude-api skill docs (paths are
 * relative to the skill's base directory) and the live Vision page. Only the facts the validator
 * and the stream need: which models exist, what they accept, who reads whose thinking blocks.
 *
 * The real API is the authority. Anything the docs do not state is not enforced here, and the
 * founder's `pnpm agent:smoke` is what checks it against the real thing.
 */

export const FAKE_MODELS = [
  'claude-fable-5-2',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
] as const
export type FakeModel = (typeof FAKE_MODELS)[number]

export interface ModelSpec {
  id: FakeModel
  displayName: string
  maxOutput: number
  contextTokens: number
  /** Server-side fallback by refusal category; null = no server-side fallback (Haiku). */
  fallbackTo: string | null
  /** Refusal categories `fallbacks: "default"` retries on another model. */
  retriedCategories: readonly string[]
  /**
   * Models whose thinking blocks this model reads, besides its own. A block this model cannot
   * read is dropped before it sees the request (and reported with the binding beta).
   */
  reads: readonly FakeModel[]
}

export const MODEL_SPECS: Record<FakeModel, ModelSpec> = {
  // SKILL.md § Current Models; shared/model-migration.md § Migrating to Claude Fable 5.2
  // (breaking change 2: Fable 5.2 reads Opus/Sonnet/Haiku 5.5 blocks; no earlier model reads its;
  // fallback targets claude-opus-4-8 and claude-opus-5).
  'claude-fable-5-2': {
    id: 'claude-fable-5-2',
    displayName: 'Claude Fable 5.2',
    maxOutput: 128_000,
    contextTokens: 1_000_000,
    fallbackTo: 'claude-opus-5',
    retriedCategories: ['cyber', 'bio', 'frontier_llm', 'general_harms'],
    reads: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  },
  // shared/model-migration.md § Migrating to Claude Opus 5.5 (breaking change 3: reads Sonnet 5.5
  // and Haiku 5.5 on the Claude API, not Fable; fallback targets Opus 5 / Opus 4.8;
  // reasoning_extraction is not retried).
  'claude-opus-5-5': {
    id: 'claude-opus-5-5',
    displayName: 'Claude Opus 5.5',
    maxOutput: 128_000,
    contextTokens: 1_000_000,
    fallbackTo: 'claude-opus-5',
    retriedCategories: ['cyber', 'bio', 'frontier_llm', 'general_harms'],
    reads: ['claude-sonnet-5-5', 'claude-haiku-5-5'],
  },
  // shared/model-migration.md § Migrating to Claude Sonnet 5.5 (breaking change 3: reads Haiku 5.5,
  // not Opus 5.5 or Fable; § Safeguards and fallback: only cyber and frontier_llm are retried, on
  // Claude Sonnet 5).
  'claude-sonnet-5-5': {
    id: 'claude-sonnet-5-5',
    displayName: 'Claude Sonnet 5.5',
    maxOutput: 128_000,
    contextTokens: 1_000_000,
    fallbackTo: 'claude-sonnet-5',
    retriedCategories: ['cyber', 'frontier_llm'],
    reads: ['claude-haiku-5-5'],
  },
  // shared/model-migration.md § Migrating to Claude Haiku 5.5 (no server-side fallback; reads no
  // 5.5 or Fable blocks).
  'claude-haiku-5-5': {
    id: 'claude-haiku-5-5',
    displayName: 'Claude Haiku 5.5',
    maxOutput: 128_000,
    contextTokens: 1_000_000,
    fallbackTo: null,
    retriedCategories: [],
    reads: [],
  },
}

export const isFakeModel = (m: unknown): m is FakeModel =>
  typeof m === 'string' && (FAKE_MODELS as readonly string[]).includes(m)

/** Whether `reader` can read a thinking block `writer` produced. */
export const canRead = (reader: string, writer: string): boolean =>
  reader === writer || (isFakeModel(reader) && MODEL_SPECS[reader].reads.includes(writer as never))

/**
 * Beta header values the fake accepts. Any other value is a 400, as the real API answers an
 * unknown or not-enabled beta (shared/error-codes.md § 400 Bad Request).
 */
export const KNOWN_BETAS = new Set([
  'server-side-fallback-2026-07-01',
  'server-side-fallback-2026-06-01',
  'thinking-binding-controls-2026-08-01',
  'compact-2026-01-12',
  'compact-2026-09-04',
  'thinking-display-updates-2026-08-18',
  'mid-conversation-output-config-2026-07-01',
  'mid-conversation-system-clear-at-2026-08-21',
  'mid-conversation-tool-changes-2026-07-01',
  'task-budgets-2026-03-13',
  'context-management-2025-06-27',
  'cache-diagnosis-2026-04-07',
  // Added by the SDK's own parse helper (resources/beta/messages/messages.js).
  'structured-outputs-2025-12-15',
])

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/** shared/prompt-caching.md § API reference: minimum cacheable prefix on the newest models. */
export const MIN_CACHEABLE_TOKENS = 512

/** Vision page (platform.claude.com/docs/en/build-with-claude/vision) § Image limits and costs. */
export const IMAGE_LIMITS = {
  mediaTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  maxPerRequest: 600,
  maxBase64Bytes: 10 * 1024 * 1024,
  maxSide: 8000,
  /** Above 20 images in a request, every image must stay within this (the page's safe bound). */
  manyImagesSide: 3000,
  manyImagesThreshold: 20,
}
