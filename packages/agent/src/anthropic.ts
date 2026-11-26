/**
 * Claude over the official SDK: the request builder, the adapter from SDK stream events to run
 * events, stop-reason and error handling, cost, and the key check. Server-only (`./anthropic`
 * subpath): the API key is passed in by the caller, used only to construct the client, and never
 * logged, stored in a trace or returned.
 *
 * Project data lives in the append-only messages. The chosen focus selects instructions for
 * the turn, with a cache breakpoint on the final system block. Discovery has its own tool set.
 */
import Anthropic, {
  APIConnectionError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  OverloadedError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk'
import type {
  BetaContentBlock,
  BetaInputTransformation,
  BetaMessage,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
  BetaTextBlockParam,
  BetaTool,
  BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import {
  ASSISTANT_MODELS,
  type AssistantModelId,
  type Message,
  type RUN_ERROR_CODES,
  type RunEvent,
  type Tokens,
} from '@pave/schema'
import type { ModelClient, ModelStream } from './model'
import { type Effort, MODELS, type ResponseUsage, usageCost } from './pricing'
import type { PromptGuide } from './prompt/routing'
import { SYSTEM_BLOCKS } from './prompt/index'
import { fromApiName, toolDefs } from './tools'

/** Room for adaptive thinking plus a long answer; streaming keeps it clear of HTTP timeouts. */
export const MAX_TOKENS = 64_000
/** Set explicitly: some of the tier models default to `medium`. */
export const EFFORT: Effort = 'high'

export const BETA = {
  fallback: 'server-side-fallback-2026-07-01',
  binding: 'thinking-binding-controls-2026-08-01',
  compaction: 'compact-2026-01-12',
} as const

/** Optional request features, switchable so a run can retry without one the API rejects. */
export interface RequestFeatures {
  /** Server-side compaction when the conversation nears the context limit. */
  compaction: boolean
  /**
   * Thinking blocks that fail the API's conversation check are dropped (and reported in
   * `input_transformations`) instead of failing the request.
   */
  dropMismatchedThinking: boolean
}

export const DEFAULT_FEATURES: RequestFeatures = { compaction: true, dropMismatchedThinking: true }

// ── The frozen prefix ────────────────────────────────────────────────────────────────────────

let tools: BetaTool[] | null = null

/**
 * The tools as the API takes them: the registry's list with `eager_input_streaming`, so large
 * inputs (a design's ops) stream as they are written. The API then no longer validates them;
 * `parseToolCall` does, before anything runs.
 */
export function apiTools(): BetaTool[] {
  tools ??= toolDefs().map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as BetaTool['input_schema'],
    eager_input_streaming: true,
    ...(t.strict ? { strict: true } : {}),
  }))
  return tools
}

/** The system prompt blocks, the last one carrying the cache breakpoint for tools + system. */
export function systemBlocks(blocks: readonly string[] = SYSTEM_BLOCKS): BetaTextBlockParam[] {
  return blocks.map((text, i) =>
    i === blocks.length - 1
      ? { type: 'text', text, cache_control: { type: 'ephemeral' } }
      : { type: 'text', text },
  )
}

// ── Messages ─────────────────────────────────────────────────────────────────────────────────

/**
 * Stored messages to API messages. Content is stored exactly as the API returned it (assistant)
 * or as it was sent (user, tool results, context), and is passed back unchanged: thinking blocks
 * must reach the API byte for byte, and the prompt cache depends on the same bytes.
 */
export function toApiMessages(
  messages: readonly Pick<Message, 'role' | 'content'>[],
): BetaMessageParam[] {
  return messages.map((m) =>
    m.role === 'system'
      ? ({ role: 'system', content: m.content } as unknown as BetaMessageParam)
      : ({ role: m.role, content: m.content } as unknown as BetaMessageParam),
  )
}

/** The context message that follows a user's message: text only, as system messages must be. */
export const contextMessage = (text: string): Pick<Message, 'role' | 'content'> => ({
  role: 'system',
  content: [{ type: 'text', text }],
})

export interface BuildRequest {
  allowedTools?: ReadonlySet<string>
  guide?: PromptGuide
  model: AssistantModelId
  messages: BetaMessageParam[]
  features?: Partial<RequestFeatures>
}

/**
 * Whether a turn on this model asks for server-side fallbacks. Every turn carries the context
 * system message, and a fallback request must be valid on the model it falls back to; Haiku has
 * no fallback and Sonnet 5.5's (Claude Sonnet 5) takes no system messages, so a refusal there is
 * handled by the run.
 */
export const turnFallbacks = (model: AssistantModelId): boolean => {
  const info = MODELS[model]
  return info.fallbacks === 'default' && info.fallbackTakesSystemMessages
}

/** One turn's request. Everything but `model` and `messages` is fixed for the model. */
export function buildRequest({
  model,
  messages,
  features,
  guide,
  allowedTools,
}: BuildRequest): BetaMessageStreamParams {
  const f = { ...DEFAULT_FEATURES, ...features }
  const fallbacks = turnFallbacks(model)
  const betas = [
    ...(fallbacks ? [BETA.fallback] : []),
    ...(f.dropMismatchedThinking ? [BETA.binding] : []),
    ...(f.compaction ? [BETA.compaction] : []),
  ]
  return {
    model,
    max_tokens: MAX_TOKENS,
    system: systemBlocks(guide?.blocks),
    tools: allowedTools
      ? apiTools().filter((t) => allowedTools.has(fromApiName(t.name) ?? ''))
      : apiTools(),
    // Forced tool choice is a 400 on these models; the prompt says when to use which tool.
    tool_choice: { type: 'auto' },
    messages,
    thinking: {
      type: 'adaptive',
      // Summaries stream to the designer as "thinking"; between tool calls they carry progress notes.
      display: 'summarized',
      ...(f.dropMismatchedThinking
        ? { block_binding: { prefix_mismatch_behavior: 'drop_block' as const } }
        : {}),
    },
    output_config: { effort: EFFORT },
    // Moves forward with the conversation: each turn reads what the previous one wrote.
    cache_control: { type: 'ephemeral' },
    ...(f.compaction
      ? { context_management: { edits: [{ type: 'compact_20260112' as const }] } }
      : {}),
    ...(fallbacks ? { fallbacks: 'default' as const } : {}),
    ...(betas.length ? { betas } : {}),
  }
}

// ── The stream ───────────────────────────────────────────────────────────────────────────────

/** A run event before the run assigns its id and sequence number. */
export type RunEventBody = RunEvent extends infer E
  ? E extends RunEvent
    ? Omit<E, 'runId' | 'seq'>
    : never
  : never

/**
 * Turns SDK stream events into the run events the studio shows. Tool calls are announced by the
 * loop after their input is validated, so only text and thinking stream from here.
 */
export class StreamAdapter {
  /** The model that is answering (a server-side fallback can change it mid-stream). */
  servedBy: string | null = null
  /** What the API did to replayed thinking blocks, for the step's trace. */
  inputTransformations: BetaInputTransformation[] = []
  /** The model the turn began on and the usage reported so far (message_start, then deltas). */
  #started: { model: string; usage: ResponseUsage } | null = null
  /** Characters of output streamed so far, for an estimate when no delta reported output yet. */
  #streamedChars = 0

  push(event: BetaRawMessageStreamEvent): RunEventBody[] {
    switch (event.type) {
      case 'message_start':
        this.servedBy = event.message.model
        this.inputTransformations = event.message.input_transformations ?? []
        this.#started = { model: event.message.model, usage: { ...event.message.usage } }
        return []
      case 'message_delta': {
        if (event.input_transformations) this.inputTransformations = event.input_transformations
        // Delta usage is cumulative; a null field means "unchanged since message_start".
        const u = this.#started?.usage
        if (u) {
          u.output_tokens = event.usage.output_tokens
          if (event.usage.input_tokens != null) u.input_tokens = event.usage.input_tokens
          if (event.usage.cache_read_input_tokens != null)
            u.cache_read_input_tokens = event.usage.cache_read_input_tokens
          if (event.usage.cache_creation_input_tokens != null)
            u.cache_creation_input_tokens = event.usage.cache_creation_input_tokens
          if (event.usage.iterations) u.iterations = event.usage.iterations
        }
        return []
      }
      case 'content_block_start':
        if (event.content_block.type === 'fallback') this.servedBy = event.content_block.to.model
        return []
      case 'content_block_delta':
        if (event.delta.type === 'text_delta') {
          this.#streamedChars += event.delta.text.length
          return [{ type: 'text.delta', index: event.index, text: event.delta.text }]
        }
        if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
          this.#streamedChars += event.delta.thinking.length
          return [{ type: 'thinking.delta', index: event.index, text: event.delta.thinking }]
        }
        if (event.delta.type === 'input_json_delta')
          this.#streamedChars += event.delta.partial_json.length
        return []
      default:
        return []
    }
  }

  /**
   * What a stream that ended without its final message (dropped, stopped, shut down) had already
   * been billed for: the input the API reported in message_start and the output streamed so far.
   * The output is the larger of what a delta reported and a rough estimate from the characters
   * seen, so a budget is not under-counted. Null when the API never started answering.
   */
  partialUsage(): { model: string; tokens: Tokens; costUsd: number } | null {
    if (!this.#started) return null
    const { model, usage } = this.#started
    const estimate = Math.ceil(this.#streamedChars / 4)
    const u: ResponseUsage = usage.iterations?.length
      ? usage
      : { ...usage, output_tokens: Math.max(usage.output_tokens, estimate) }
    return { model, ...usageCost(model, u) }
  }
}

/**
 * The content to store and act on. After a refusal handed the turn to a fallback model, the
 * blocks before the last `fallback` block belong to the attempt that declined: its thinking and
 * tool calls must not be echoed back (the API rejects them) or run. Text and the fallback block
 * itself stay where they are.
 */
export function effectiveContent(content: readonly BetaContentBlock[]): BetaContentBlock[] {
  let last = -1
  content.forEach((b, i) => {
    if (b.type === 'fallback') last = i
  })
  if (last === -1) return [...content]
  const pairedServerTools = new Set(
    content.flatMap((b) =>
      'tool_use_id' in b && typeof b.tool_use_id === 'string' ? [b.tool_use_id] : [],
    ),
  )
  return content.filter((b, i) => {
    if (i >= last) return true
    if (b.type === 'thinking' || b.type === 'redacted_thinking' || b.type === 'tool_use')
      return false
    if (b.type === 'server_tool_use') return pairedServerTools.has(b.id)
    return true
  })
}

export type StopOutcome =
  /** The model is done for this turn. */
  | { kind: 'end' }
  /** Run these tools, then send their results. */
  | { kind: 'tools'; calls: BetaToolUseBlock[] }
  /** A safety decline (after any server-side fallback also declined). Never run tools. */
  | { kind: 'refusal'; category: string | null; explanation: string | null }
  /** Out of output tokens; a tool call in it may be cut short, so it must not run. */
  | { kind: 'max_tokens'; hasToolCall: boolean }
  /** The API paused the turn (server tools, compaction): send the turn back as it is. */
  | { kind: 'continue' }
  /** The conversation no longer fits the model's context. */
  | { kind: 'context_full' }

/** What to do after a turn. Checked before any tool runs. */
export function classifyStop(message: BetaMessage): StopOutcome {
  const content = effectiveContent(message.content)
  const calls = content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use')
  switch (message.stop_reason) {
    case 'refusal':
      return {
        kind: 'refusal',
        category: message.stop_details?.category ?? null,
        explanation: message.stop_details?.explanation ?? null,
      }
    case 'max_tokens':
      return { kind: 'max_tokens', hasToolCall: calls.length > 0 }
    case 'pause_turn':
    case 'compaction':
      return { kind: 'continue' }
    case 'model_context_window_exceeded':
      return { kind: 'context_full' }
    default:
      return calls.length ? { kind: 'tools', calls } : { kind: 'end' }
  }
}

/** Tokens and cost of one response, priced per attempt from the models that ran. */
export function messageUsage(message: BetaMessage): { tokens: Tokens; costUsd: number } {
  return usageCost(message.model, message.usage)
}

// ── Errors ───────────────────────────────────────────────────────────────────────────────────

export type RunErrorCode = (typeof RUN_ERROR_CODES)[number]

export interface MappedError {
  code: RunErrorCode
  /** For the designer, in plain words. Never contains the key. */
  message: string
  /** Worth trying again unchanged later (the SDK has already retried what it retries). */
  retryable: boolean
}

const modelLabel = (model: string) =>
  (ASSISTANT_MODELS as readonly string[]).includes(model)
    ? MODELS[model as AssistantModelId].label
    : model

/** The API's own error sentence (from the typed error's body), never the whole JSON body. */
function apiMessage(err: APIError): string {
  const body = err.error as { error?: { message?: unknown }; message?: unknown } | undefined
  const said = body?.error?.message ?? body?.message
  return typeof said === 'string' && said ? said.replace(/\.$/, '') : `HTTP ${err.status}`
}

/**
 * Maps an SDK error to a run error code and a sentence for the designer. Typed classes only:
 * the API's wording is not a contract.
 */
export function mapError(err: unknown, ctx: { model: string; aborted?: boolean }): MappedError {
  if (ctx.aborted || err instanceof APIUserAbortError)
    return { code: 'interrupted', message: 'Stopped.', retryable: false }
  if (err instanceof AuthenticationError)
    return {
      code: 'provider_auth',
      message:
        'Claude’s API did not accept the API key. Check it in Settings, AI (or ANTHROPIC_API_KEY in apps/server/.env).',
      retryable: false,
    }
  if (err instanceof PermissionDeniedError)
    return {
      code: 'provider_auth',
      message: `This API key is not allowed to use ${modelLabel(ctx.model)}. Check the key’s workspace in the Claude Console, or pick another tier.`,
      retryable: false,
    }
  if (err instanceof RateLimitError || err instanceof OverloadedError)
    return {
      code: 'rate_limited',
      message: 'Claude is busy or this key has hit its rate limit. Try again in a minute.',
      retryable: true,
    }
  if (err instanceof NotFoundError)
    return {
      code: 'model_unavailable',
      message: `${modelLabel(ctx.model)} is not available to this API key. Point the tier at another model in Settings, AI.`,
      retryable: false,
    }
  if (err instanceof BadRequestError) {
    const info = (ASSISTANT_MODELS as readonly string[]).includes(ctx.model)
      ? MODELS[ctx.model as AssistantModelId]
      : null
    const said = apiMessage(err)
    // A 400 does not say why in a form we may rely on: retention is named as a possible cause
    // only, after the API's own words, so a schema problem does not send the founder to his
    // data-retention settings.
    if (info?.needsRetention)
      return {
        code: 'model_unavailable',
        message: `Claude’s API rejected the request for ${info.label}: ${said}. ${info.label} needs 30-day data retention on your Anthropic organisation; if that may be the cause, switch this conversation to Standard, or point Power at another model in Settings, AI.`,
        retryable: false,
      }
    return {
      code: 'internal',
      message: `Claude’s API rejected the request: ${said}`,
      retryable: false,
    }
  }
  if (err instanceof APIConnectionError)
    return {
      code: 'provider_unreachable',
      message:
        'Could not reach Claude’s API. Check the internet connection (and any proxy), then try again.',
      retryable: true,
    }
  if (err instanceof InternalServerError || err instanceof APIError)
    return {
      code: 'provider_unreachable',
      message: 'Claude’s API had a problem answering. Try again in a moment.',
      retryable: true,
    }
  return {
    code: 'internal',
    message: err instanceof Error ? err.message : 'Something went wrong.',
    retryable: false,
  }
}

/** The API refused the request as malformed (400): a feature it does not take, or retention. */
export const isRequestRejected = (err: unknown): boolean => err instanceof BadRequestError

/**
 * A stream that broke off (the connection dropped mid-answer) or a tool input the SDK could not
 * parse: worth asking again. Errors the API answered with are not.
 */
export const isStreamBreak = (err: unknown): boolean =>
  !(err instanceof APIUserAbortError) &&
  (err instanceof APIConnectionError || !(err instanceof APIError))

// ── The client ───────────────────────────────────────────────────────────────────────────────

export interface ClientOptions {
  apiKey: string
  /** Tests point the SDK at an in-memory server. */
  baseURL?: string
  fetch?: typeof fetch
  maxRetries?: number
}

const newClient = (o: ClientOptions) =>
  new Anthropic({
    apiKey: o.apiKey,
    ...(o.baseURL ? { baseURL: o.baseURL } : {}),
    ...(o.fetch ? { fetch: o.fetch } : {}),
    maxRetries: o.maxRetries ?? 2,
  })

/** The real model client: the SDK's streaming helper, aborted through the run's signal. */
export function anthropicModel(o: ClientOptions): ModelClient {
  const client = newClient(o)
  return {
    stream(params, { signal }): ModelStream {
      return client.beta.messages.stream(params, signal ? { signal } : {})
    },
  }
}

export type KeyCheck =
  | {
      ok: true
      /** The tier models this key can use. */
      models: AssistantModelId[]
    }
  | {
      ok: false
      code: 'invalid' | 'forbidden' | 'unreachable' | 'rate_limited' | 'error'
      message: string
    }

/**
 * Tests a key with the Models API, which costs nothing. Says in plain words what is wrong, and
 * which of the tier models the key can use.
 */
export async function checkKey(o: ClientOptions): Promise<KeyCheck> {
  const client = newClient({ ...o, maxRetries: o.maxRetries ?? 1 })
  try {
    const seen = new Set<string>()
    for await (const m of client.models.list({ limit: 100 })) seen.add(m.id)
    return { ok: true, models: ASSISTANT_MODELS.filter((id) => seen.has(id)) }
  } catch (err) {
    if (err instanceof AuthenticationError)
      return {
        ok: false,
        code: 'invalid',
        message:
          'Claude’s API did not accept this key. Check that it was copied whole (it starts with sk-ant-).',
      }
    if (err instanceof PermissionDeniedError)
      return { ok: false, code: 'forbidden', message: 'This key is not allowed to use the API.' }
    if (err instanceof RateLimitError)
      return {
        ok: false,
        code: 'rate_limited',
        message: 'The key works, but it is rate-limited right now. Try again in a minute.',
      }
    if (err instanceof APIConnectionError)
      return {
        ok: false,
        code: 'unreachable',
        message: 'Could not reach Claude’s API. Check the internet connection (and any proxy).',
      }
    if (err instanceof APIError)
      return {
        ok: false,
        code: 'error',
        message: 'Claude’s API had a problem answering. Try again in a moment.',
      }
    throw err
  }
}
