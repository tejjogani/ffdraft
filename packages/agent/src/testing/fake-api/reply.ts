/**
 * What a response source hands the fake: the content Claude answers with, plus optional faults.
 * Ids, signatures, usage and the stream are the fake's job, so a source (a fixture, a recording or
 * Claude itself writing a reply file) only says what the model says.
 */

export type ReplyBlock =
  | { type: 'text'; text: string }
  /** A summarised thinking block (the harness asks for display "summarized"). */
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; name: string; input: unknown; id?: string }

export type RefusalCategory =
  | 'cyber'
  | 'bio'
  | 'frontier_llm'
  | 'reasoning_extraction'
  | 'general_harms'
  | null

export type Fault =
  /**
   * Answer with an HTTP error instead, `times` requests in a row (default 1), so the SDK's own
   * retries can be exercised. 429 and 529 carry `retry-after` (seconds) when given.
   */
  | {
      type: 'http'
      status: 400 | 401 | 403 | 404 | 413 | 429 | 500 | 529
      message?: string
      retryAfter?: number
      times?: number
    }
  /** Stream the first `afterBlocks` content blocks (default 1), then drop the connection. */
  | { type: 'drop'; afterBlocks?: number }
  /**
   * Stream the first `afterBlocks` content blocks (default all), then keep the stream open with
   * nothing more until the client closes it: a long answer the designer stops.
   */
  | { type: 'stall'; afterBlocks?: number }
  /** Close the connection before any response (the SDK sees a connection error). */
  | { type: 'reset' }
  /**
   * A safety decline after streaming `content` so far. With `fallbacks: "default"` and a category
   * the model's fallback retries, the API itself hands the turn to the fallback model, which then
   * answers with `fallback` (the reply's blocks after the switch).
   */
  | { type: 'refusal'; category: RefusalCategory; explanation?: string; fallback?: ReplyBlock[] }
  /** Out of output tokens in the middle of the last tool call's input. */
  | { type: 'max_tokens_in_tool' }
  /** The API paused the turn (stop_reason pause_turn) after the content. */
  | { type: 'pause_turn' }

export interface FakeReply {
  content: ReplyBlock[]
  /**
   * Defaults: tool_use when a tool is called, else end_turn. Other stop reasons the API sends
   * (compaction, model_context_window_exceeded, refusal without details) pass through as given.
   */
  stop_reason?: string
  /** The model the message reports, when a test needs another one than the request's. */
  servedBy?: string
  /** Usage to report instead of the fake's estimate (a replay keeps the recorded numbers). */
  usage?: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens: number
    cache_creation_input_tokens: number
  }
  fault?: Fault
  /** A note for the recording (why this reply, what it tests). Never sent. */
  note?: string
}

/** Rough output tokens for a reply: a quarter of its JSON. */
export const outputTokensOf = (blocks: readonly ReplyBlock[]): number =>
  Math.max(1, Math.ceil(JSON.stringify(blocks).length / 4))
