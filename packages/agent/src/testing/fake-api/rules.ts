/**
 * The fake Claude API's request validator. Every rule names the document it comes from, so a
 * reviewer can check the rule against its source:
 *  - `skill:<path> § <section>` is a file of the claude-api skill (paths relative to its base
 *    directory), the reference this build was written against;
 *  - `live:<url> § <section>` is a page of platform.claude.com/docs, fetched for the details the
 *    skill files do not spell out (image limits, tool-result ordering, schema limits).
 *
 * A violation is answered with the real error shape (`{type:'error', error:{type, message},
 * request_id}`) and status. The fake is deliberately at least as strict as the docs: where two
 * documents differ, the stricter reading is enforced and the rule says so.
 */
// biome-ignore-all lint/suspicious/useIterableCallbackReturn: each check reports through c.fail and returns early; nothing reads the callbacks' values
import { createHash } from 'node:crypto'
import {
  EFFORTS,
  type FakeModel,
  IMAGE_LIMITS,
  isFakeModel,
  KNOWN_BETAS,
  MODEL_SPECS,
} from './spec'

export interface RuleInfo {
  id: string
  /** Where the rule is written down. */
  doc: string
  summary: string
}

export interface Violation {
  rule: string
  status: number
  type: string
  message: string
  /** Where in the request (`messages.3.content.0`), when the rule points at one place. */
  path?: string
}

const SKILL = 'skill:'
const LIVE = 'live:https://platform.claude.com/docs/en/'

/** The rule list, in the order the checks run. Exported for docs and the coverage test. */
export const RULES: readonly RuleInfo[] = [
  {
    id: 'auth.key',
    doc: `${SKILL}shared/error-codes.md § 401 Unauthorized`,
    summary: 'An x-api-key or Authorization: Bearer header carrying a valid key.',
  },
  {
    id: 'headers.version',
    doc: `${SKILL}shared/api-version-migration.md (the anthropic-version request header)`,
    summary: 'anthropic-version is 2023-06-01 or 2026-10-21.',
  },
  {
    id: 'headers.beta',
    doc: `${SKILL}shared/error-codes.md § 400 Bad Request (unknown anthropic-beta value)`,
    summary: 'Every anthropic-beta value is one the API knows.',
  },
  {
    id: 'body.required',
    doc: `${SKILL}shared/error-codes.md § 400 Bad Request`,
    summary: 'model, max_tokens and a non-empty messages array are present.',
  },
  {
    id: 'model.allowed',
    doc: `${SKILL}shared/error-codes.md § 404 Not Found; SKILL.md § Current Models`,
    summary: 'The model is one of the four the harness may use (404 `model: <id>` otherwise).',
  },
  {
    id: 'max_tokens.range',
    doc: `${SKILL}shared/error-codes.md § 400 Validation Errors; SKILL.md § Common Pitfalls (128K output tokens)`,
    summary: 'max_tokens is a positive integer no larger than the model’s 128K output limit.',
  },
  {
    id: 'sampling.removed',
    doc: `${SKILL}shared/error-codes.md § 400 Validation Errors (API version 2026-10-21; model-specific 400s)`,
    summary: 'No temperature, top_p or top_k.',
  },
  {
    id: 'thinking.shape',
    doc: `${SKILL}SKILL.md § Thinking & Effort (per-model table); shared/error-codes.md § Model-specific 400s`,
    summary:
      'thinking is omitted or {type:"adaptive"}; enabled/budget_tokens is a 400 on all four models; disabled is a 400 on Fable 5.2, Opus 5.5 and Sonnet 5.5 and on Haiku 5.5 above effort high; between_tools only on Sonnet 5.5 at high or below with no other field.',
  },
  {
    id: 'thinking.display',
    doc: `${SKILL}SKILL.md § Thinking & Effort (display); shared/model-migration.md § Migrating to Claude Opus 5.5 (display "updates" beta)`,
    summary:
      'display is summarized or omitted, or updates with thinking-display-updates-2026-08-18.',
  },
  {
    id: 'thinking.block_binding',
    doc: `${SKILL}shared/error-codes.md (thinking.block_binding without thinking-binding-controls-2026-08-01; block_binding only with adaptive thinking)`,
    summary:
      'block_binding needs the thinking-binding-controls beta, adaptive thinking, and prefix_mismatch_behavior error|drop_block.',
  },
  {
    id: 'effort.values',
    doc: `${SKILL}SKILL.md § Thinking & Effort (Effort is inside output_config)`,
    summary: 'output_config.effort is low|medium|high|xhigh|max; there is no top-level effort.',
  },
  {
    id: 'tool_choice.forced',
    doc: `${SKILL}shared/tool-use-concepts.md § Tool Choice Options; shared/error-codes.md § Model-specific 400s`,
    summary: 'tool_choice any/tool is a 400 on Fable 5.2, Opus 5.5 and Sonnet 5.5.',
  },
  {
    id: 'prefill.removed',
    doc: `${SKILL}SKILL.md § Common Pitfalls (Prefill removed); ${LIVE}api/messages/create (messages)`,
    summary: 'The conversation does not end with an assistant turn.',
  },
  {
    id: 'fallbacks.shape',
    doc: `${SKILL}typescript/claude-api/README.md § Refusal Fallbacks; shared/model-migration.md § Haiku 5.5 Safeguards, § Sonnet 5.5 Safeguards and fallback, § Fable 5.2 Structured outputs, safeguards and fallback`,
    summary:
      'fallbacks needs server-side-fallback-2026-07-01 ("default" form) or -06-01/-07-01 (list form); Haiku 5.5 takes no fallbacks in any form; a list names only the model’s permitted targets.',
  },
  {
    id: 'fallbacks.target',
    doc: `${SKILL}shared/model-migration.md § refusal stop reason (the request with an entry's overrides merged in must be valid as a direct request to that entry's model); shared/prompt-caching.md § Mid-conversation system messages (not available on Claude Sonnet 5)`,
    summary:
      'A request with fallbacks must be valid on each fallback model: role "system" messages with a Claude Sonnet 5 fallback are refused.',
  },
  {
    id: 'compaction.beta',
    doc: `${SKILL}SKILL.md § Compaction (requires compact-2026-01-12); § Context Editing`,
    summary:
      'compact_20260112 needs compact-2026-01-12; clear_* edits need context-management-2025-06-27.',
  },
  {
    id: 'cache.breakpoints',
    doc: `${SKILL}shared/prompt-caching.md § API reference (max 4 breakpoints) and § Automatic vs explicit breakpoints`,
    summary:
      'At most 4 cache_control breakpoints, the top-level automatic one included; no longer TTL after a shorter one.',
  },
  {
    id: 'tools.definition',
    doc: `${LIVE}agents-and-tools/tool-use/define-tools § Specifying client tools; ${LIVE}agents-and-tools/tool-use/tool-reference § Tool definition properties`,
    summary:
      'Each tool has a name matching ^[a-zA-Z0-9_-]{1,128}$ (unique), a description and an object input_schema, and only the documented optional properties.',
  },
  {
    id: 'tools.eager_input_streaming',
    doc: `${SKILL}shared/tool-use-concepts.md § Eager input streaming; ${LIVE}agents-and-tools/tool-use/tool-reference (eager_input_streaming: user-defined tools only)`,
    summary:
      'eager_input_streaming is a boolean on the tool definition itself, on user-defined tools only.',
  },
  {
    id: 'strict.schema',
    doc: `${LIVE}build-with-claude/structured-outputs § JSON Schema limitations; ${SKILL}shared/tool-use-concepts.md § JSON Schema Limitations`,
    summary:
      'Strict tool schemas and output formats use only the supported subset: additionalProperties false on every object, no oneOf/not, no numeric or string length constraints, minItems 0 or 1 only, anyOf not beside type/properties, supported string formats and regex features.',
  },
  {
    id: 'strict.limits',
    doc: `${LIVE}build-with-claude/structured-outputs § Schema complexity limits`,
    summary:
      'At most 20 strict tools, 24 optional parameters and 16 union-typed parameters across all strict schemas in one request.',
  },
  {
    id: 'messages.roles',
    doc: `${SKILL}typescript/claude-api/README.md § Multi-Turn Conversations (first message user; consecutive same-role turns are combined)`,
    summary:
      'Roles are user, assistant or system; the first message is a user message. (shared/error-codes.md lists consecutive same-role messages as a 400; the README, written later, says they are combined, which is what is enforced.)',
  },
  {
    id: 'messages.system_placement',
    doc: `${SKILL}shared/prompt-caching.md § Mid-conversation system messages`,
    summary:
      'A role:"system" message follows a user message, is last or followed by an assistant turn, is never messages[0], and is text only.',
  },
  {
    id: 'messages.content_types',
    doc: `${LIVE}api/messages/create (content block params); ${LIVE}agents-and-tools/tool-use/handle-tool-calls (tool_result content)`,
    summary:
      'User turns carry text, image, document, tool_result and search_result blocks; assistant turns carry the blocks the API returned; tool_result content is text, image, document or search_result.',
  },
  {
    id: 'messages.tool_pairing',
    doc: `${LIVE}agents-and-tools/tool-use/handle-tool-calls § Important formatting requirements; ${LIVE}agents-and-tools/tool-use/parallel-tool-use; ${SKILL}shared/tool-use-concepts.md § Handling Tool Results`,
    summary:
      'Every tool_use is answered by a tool_result in the very next message, which is a user message; all results of a turn in that one message, before any text; no result without its call.',
  },
  {
    id: 'images.limits',
    doc: `${LIVE}build-with-claude/vision § Image limits and costs (Supported formats; Request limits)`,
    summary:
      'image/jpeg|png|gif|webp, base64 that decodes, at most 10 MB base64 and 8000 px a side, at most 600 per request, and at most 3000 px a side when a request carries more than 20.',
  },
  {
    id: 'thinking.binding',
    doc: `${SKILL}shared/model-migration.md § Migrating to Claude Opus 5.5 (breaking change 3), § Migrating to Claude Fable 5.2 (breaking changes 1-2); shared/error-codes.md (history-editing check)`,
    summary:
      'A replayed thinking block must be unchanged (else always 400), and the system, tools and earlier messages must be byte-identical to when it was produced (400, or dropped with prefix_mismatch_behavior drop_block). A block the model cannot read is dropped and, with the binding beta, reported in input_transformations.',
  },
  {
    id: 'context.window',
    doc: `${SKILL}shared/error-codes.md § 413 Request Too Large (input over the context window is a 400 "prompt is too long")`,
    summary: 'The estimated prompt fits the model’s 1M-token context window.',
  },
]

const RULE_IDS = new Set(RULES.map((r) => r.id))

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

class Check {
  readonly out: Violation[] = []
  fail(rule: string, message: string, status = 400, path?: string): void {
    if (!RULE_IDS.has(rule)) throw new Error(`fake-api: unknown rule ${rule}`)
    const type =
      status === 401
        ? 'authentication_error'
        : status === 404
          ? 'not_found_error'
          : status === 413
            ? 'request_too_large'
            : 'invalid_request_error'
    this.out.push({ rule, status, type, message, ...(path ? { path } : {}) })
  }
}

export interface IncomingRequest {
  /** Lower-cased header names. */
  headers: Readonly<Record<string, string | undefined>>
  body: unknown
}

export interface ValidateOptions {
  /** The key the fake accepts; any other key is a 401. */
  apiKey: string
}

/** The key the request carries, from x-api-key or Authorization: Bearer. */
export function keyOf(headers: IncomingRequest['headers']): string | null {
  const x = headers['x-api-key']
  if (x) return x
  const auth = headers.authorization
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
  return null
}

export function betasOf(headers: IncomingRequest['headers']): string[] {
  return (headers['anthropic-beta'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Header checks shared by every endpoint (Messages and Models). */
export function validateHeaders(req: IncomingRequest, opts: ValidateOptions): Violation[] {
  const c = new Check()
  const key = keyOf(req.headers)
  if (!key) c.fail('auth.key', 'x-api-key header is required', 401)
  else if (key !== opts.apiKey) c.fail('auth.key', 'invalid x-api-key', 401)
  const version = req.headers['anthropic-version']
  if (version !== '2023-06-01' && version !== '2026-10-21')
    c.fail('headers.version', `anthropic-version: unsupported or missing value ${String(version)}`)
  for (const b of betasOf(req.headers))
    if (!KNOWN_BETAS.has(b))
      c.fail('headers.beta', `Unexpected value(s) \`${b}\` for the \`anthropic-beta\` header.`)
  return c.out
}

/** Validates a POST /v1/messages request. Returns every violation found (the server answers the first). */
export function validateMessages(req: IncomingRequest, opts: ValidateOptions): Violation[] {
  const head = validateHeaders(req, opts)
  if (head.some((v) => v.status === 401)) return head
  const c = new Check()
  c.out.push(...head)
  const body = req.body
  const betas = new Set(betasOf(req.headers))
  if (!isObj(body)) {
    c.fail('body.required', 'The request body is not a JSON object.')
    return c.out
  }
  if (typeof body.model !== 'string') c.fail('body.required', 'model: Field required')
  if (body.max_tokens === undefined) c.fail('body.required', 'max_tokens: Field required')
  if (!Array.isArray(body.messages) || body.messages.length === 0)
    c.fail('body.required', 'messages: at least one message is required')
  if (c.out.length) return c.out
  const model = body.model as string
  if (!isFakeModel(model)) {
    c.fail('model.allowed', `model: ${model}`, 404)
    return c.out
  }
  const spec = MODEL_SPECS[model]

  // max_tokens
  const mt = body.max_tokens
  if (typeof mt !== 'number' || !Number.isInteger(mt) || mt < 1)
    c.fail('max_tokens.range', 'max_tokens: must be a positive integer')
  else if (mt > spec.maxOutput)
    c.fail(
      'max_tokens.range',
      `max_tokens: ${mt} > ${spec.maxOutput}, which is the maximum allowed number of output tokens for ${model}`,
    )

  for (const k of ['temperature', 'top_p', 'top_k'])
    if (k in body) c.fail('sampling.removed', `${k}: Extra inputs are not permitted`)

  // effort
  if ('effort' in body) c.fail('effort.values', 'effort: Extra inputs are not permitted')
  const oc = body.output_config
  let effort: string | null = null
  if (oc !== undefined) {
    if (!isObj(oc)) c.fail('effort.values', 'output_config: must be an object')
    else if (oc.effort !== undefined) {
      if (!(EFFORTS as readonly string[]).includes(oc.effort as string))
        c.fail('effort.values', `output_config.effort: Input should be ${EFFORTS.join(', ')}`)
      else effort = oc.effort as string
    }
  }
  const effectiveEffort =
    effort ?? (model === 'claude-opus-5-5' || model === 'claude-haiku-5-5' ? 'medium' : 'high')

  checkThinking(c, model, body.thinking, effectiveEffort, betas)

  // tool_choice
  const tc = body.tool_choice
  if (isObj(tc) && (tc.type === 'any' || tc.type === 'tool') && model !== 'claude-haiku-5-5')
    c.fail(
      'tool_choice.forced',
      'tool_choice: type "tool" and "any" are not supported for this model.',
    )

  checkFallbacks(c, model, body, betas)

  // context management / compaction
  const cm = body.context_management
  if (isObj(cm) && Array.isArray(cm.edits))
    for (const e of cm.edits as Json[]) {
      if (e.type === 'compact_20260112' && !betas.has('compact-2026-01-12'))
        c.fail(
          'compaction.beta',
          'context_management.edits: compact_20260112 requires the compact-2026-01-12 beta',
        )
      if (
        typeof e.type === 'string' &&
        e.type.startsWith('clear_') &&
        !betas.has('context-management-2025-06-27')
      )
        c.fail(
          'compaction.beta',
          `context_management.edits: ${e.type} requires the context-management-2025-06-27 beta`,
        )
    }

  const tools = Array.isArray(body.tools) ? (body.tools as unknown[]) : []
  if (body.tools !== undefined && !Array.isArray(body.tools))
    c.fail('tools.definition', 'tools: must be an array')
  checkTools(c, tools)
  checkStrictLimits(c, tools, isObj(oc) && isObj(oc.format) ? (oc.format as Json) : null)
  checkCache(c, body, tools)
  checkMessages(c, body.messages as unknown[])
  checkImages(c, body.messages as unknown[], body.system)

  // Output format with prefill is checked by prefill.removed already; the schema subset here.
  if (isObj(oc) && oc.format !== undefined) {
    const f = oc.format
    if (!isObj(f) || f.type !== 'json_schema' || !isObj(f.schema))
      c.fail('strict.schema', 'output_config.format: expected {type:"json_schema", schema:{...}}')
    else checkSchemaSubset(c, f.schema, 'output_config.format.schema')
  }
  return c.out
}

function checkThinking(
  c: Check,
  model: FakeModel,
  thinking: unknown,
  effort: string,
  betas: Set<string>,
) {
  if (thinking === undefined) return
  if (!isObj(thinking)) return c.fail('thinking.shape', 'thinking: must be an object')
  const type = thinking.type
  if (type === 'enabled' || 'budget_tokens' in thinking)
    return c.fail(
      'thinking.shape',
      `"thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.`,
    )
  if (type === 'disabled') {
    if (model === 'claude-haiku-5-5' && (effort === 'xhigh' || effort === 'max'))
      return c.fail(
        'thinking.shape',
        `output_config.effort '${effort}' is not supported when thinking is disabled on this model.`,
      )
    if (model === 'claude-sonnet-5-5')
      return c.fail(
        'thinking.shape',
        'To turn thinking off on this model, send "thinking": {"type": "between_tools"} instead of {"type": "disabled"}.',
      )
    if (model !== 'claude-haiku-5-5')
      return c.fail('thinking.shape', `"thinking.type.disabled" is not supported for this model.`)
  } else if (type === 'between_tools') {
    if (model !== 'claude-sonnet-5-5')
      return c.fail(
        'thinking.shape',
        '"thinking.type.between_tools" is not supported for this model.',
      )
    if (effort === 'xhigh' || effort === 'max')
      return c.fail(
        'thinking.shape',
        `output_config.effort '${effort}' is not supported when thinking is disabled on this model.`,
      )
    const extra = Object.keys(thinking).filter((k) => k !== 'type')
    if (extra.length)
      return c.fail('thinking.shape', `thinking.${extra[0]}: not allowed with between_tools`)
  } else if (type !== 'adaptive') {
    return c.fail('thinking.shape', `thinking.type: unknown value ${String(type)}`)
  }
  for (const k of Object.keys(thinking))
    if (!['type', 'display', 'block_binding'].includes(k))
      c.fail('thinking.shape', `thinking.${k}: Extra inputs are not permitted`)
  if (thinking.display !== undefined) {
    if (thinking.display === 'updates') {
      if (!betas.has('thinking-display-updates-2026-08-18'))
        c.fail(
          'thinking.display',
          'thinking.display "updates" requires the thinking-display-updates-2026-08-18 beta',
        )
    } else if (thinking.display !== 'summarized' && thinking.display !== 'omitted')
      c.fail('thinking.display', `thinking.display: unknown value ${String(thinking.display)}`)
  }
  if (thinking.block_binding !== undefined) {
    if (!betas.has('thinking-binding-controls-2026-08-01'))
      c.fail('thinking.block_binding', 'thinking.block_binding: Extra inputs are not permitted')
    if (type !== 'adaptive')
      c.fail(
        'thinking.block_binding',
        'thinking.block_binding is accepted only with adaptive thinking',
      )
    const bb = thinking.block_binding
    if (
      !isObj(bb) ||
      (bb.prefix_mismatch_behavior !== 'error' && bb.prefix_mismatch_behavior !== 'drop_block')
    )
      c.fail(
        'thinking.block_binding',
        'thinking.block_binding.prefix_mismatch_behavior: must be "error" or "drop_block"',
      )
  }
}

/** The models an explicit `fallbacks` list may name, per source model. */
const FALLBACK_TARGETS: Record<FakeModel, readonly string[]> = {
  'claude-fable-5-2': ['claude-opus-4-8', 'claude-opus-5'],
  'claude-opus-5-5': ['claude-opus-5', 'claude-opus-4-8'],
  'claude-sonnet-5-5': ['claude-sonnet-5'],
  'claude-haiku-5-5': [],
}

/**
 * Fallback models that do not take mid-conversation `role: "system"` messages
 * (shared/prompt-caching.md § Mid-conversation system messages: "Not available on Claude Sonnet 5
 * ... treat it as unsupported and catch the 400").
 */
const NO_SYSTEM_MESSAGES = new Set(['claude-sonnet-5'])

/**
 * The request as it would run on a fallback model must be valid there too
 * (shared/model-migration.md, refusal section: "The request with an entry's overrides merged in
 * must be valid as a direct request to that entry's model"). Checked up front, as the docs say
 * the API does for a request a fallback entry could not serve.
 */
function checkFallbackTargets(c: Check, targets: readonly string[], body: Json) {
  const messages = Array.isArray(body.messages) ? (body.messages as unknown[]) : []
  const hasSystem = messages.some((m) => isObj(m) && m.role === 'system')
  for (const target of targets)
    if (hasSystem && NO_SYSTEM_MESSAGES.has(target))
      c.fail(
        'fallbacks.target',
        `fallbacks: the request is not valid on ${target}: role 'system' is not supported on this model`,
      )
}

function checkFallbacks(c: Check, model: FakeModel, body: Json, betas: Set<string>) {
  if (body.fallbacks === undefined) return
  const f = body.fallbacks
  // shared/model-migration.md § Migrating to Claude Haiku 5.5: no server-side fallback, in any form.
  if (MODEL_SPECS[model].fallbackTo === null)
    return c.fail('fallbacks.shape', 'fallbacks: this model has no server-side fallback')
  if (f === 'default') {
    if (!betas.has('server-side-fallback-2026-07-01'))
      c.fail(
        'fallbacks.shape',
        'fallbacks: "default" requires the server-side-fallback-2026-07-01 beta',
      )
    return checkFallbackTargets(c, [MODEL_SPECS[model].fallbackTo!], body)
  }
  if (!Array.isArray(f)) return c.fail('fallbacks.shape', 'fallbacks: must be "default" or a list')
  if (
    !betas.has('server-side-fallback-2026-07-01') &&
    !betas.has('server-side-fallback-2026-06-01')
  )
    c.fail('fallbacks.shape', 'fallbacks requires a server-side-fallback beta')
  for (const e of f as unknown[])
    if (!isObj(e) || !FALLBACK_TARGETS[model].includes(e.model as string))
      c.fail(
        'fallbacks.shape',
        `fallbacks: ${JSON.stringify(e)} is not a permitted fallback for ${model}`,
      )
  checkFallbackTargets(
    c,
    (f as unknown[]).flatMap((e) => (isObj(e) && typeof e.model === 'string' ? [e.model] : [])),
    body,
  )
}

const TOOL_KEYS = new Set([
  'name',
  'description',
  'input_schema',
  'cache_control',
  'strict',
  'eager_input_streaming',
  'defer_loading',
  'allowed_callers',
  'input_examples',
  'type',
])
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,128}$/

function checkTools(c: Check, tools: unknown[]): void {
  const names = new Set<string>()
  tools.forEach((t, i) => {
    const path = `tools.${i}`
    if (!isObj(t)) return c.fail('tools.definition', `${path}: must be an object`, 400, path)
    // Server tools and toolsets carry a dated type; the harness sends user-defined tools only.
    const userDefined = t.type === undefined || t.type === 'custom'
    if (!userDefined) {
      if ('eager_input_streaming' in t)
        c.fail(
          'tools.eager_input_streaming',
          `${path}.eager_input_streaming: not valid on ${String(t.type)}`,
          400,
          path,
        )
      return
    }
    for (const k of Object.keys(t))
      if (!TOOL_KEYS.has(k))
        c.fail('tools.definition', `${path}.${k}: Extra inputs are not permitted`, 400, path)
    if (typeof t.name !== 'string' || !TOOL_NAME.test(t.name))
      c.fail(
        'tools.definition',
        `${path}.name: String should match pattern '^[a-zA-Z0-9_-]{1,128}$'`,
        400,
        path,
      )
    else if (names.has(t.name))
      c.fail('tools.definition', `${path}.name: tool names must be unique (${t.name})`, 400, path)
    else names.add(t.name)
    if (t.description !== undefined && typeof t.description !== 'string')
      c.fail('tools.definition', `${path}.description: must be a string`, 400, path)
    if (!isObj(t.input_schema) || t.input_schema.type !== 'object')
      c.fail(
        'tools.definition',
        `${path}.input_schema: the root must be a JSON Schema of type "object"`,
        400,
        path,
      )
    if ('eager_input_streaming' in t && typeof t.eager_input_streaming !== 'boolean')
      c.fail(
        'tools.eager_input_streaming',
        `${path}.eager_input_streaming: must be a boolean`,
        400,
        path,
      )
    if ('strict' in t && typeof t.strict !== 'boolean')
      c.fail('tools.definition', `${path}.strict: must be a boolean`, 400, path)
    if (t.strict === true && isObj(t.input_schema))
      checkSchemaSubset(c, t.input_schema, `${path}.input_schema`)
  })
}

const STRING_FORMATS = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
])
const UNSUPPORTED_KEYWORDS = [
  'oneOf',
  'not',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'maxItems',
  'uniqueItems',
  'contains',
  'prefixItems',
  'patternProperties',
  'propertyNames',
  'minProperties',
  'maxProperties',
  'if',
  'then',
  'else',
  'dependentRequired',
  'dependentSchemas',
]

/** The structured-outputs schema subset (strict tools and output formats share it). */
function checkSchemaSubset(c: Check, schema: unknown, path: string): void {
  const visit = (s: unknown, p: string): void => {
    if (Array.isArray(s)) {
      for (const [i, x] of s.entries()) visit(x, `${p}.${i}`)
      return
    }
    if (!isObj(s)) return
    for (const k of UNSUPPORTED_KEYWORDS)
      if (k in s) c.fail('strict.schema', `${p}: '${k}' is not supported in strict schemas`, 400, p)
    if ('$ref' in s && typeof s.$ref === 'string' && !s.$ref.startsWith('#'))
      c.fail('strict.schema', `${p}: external $ref is not supported`, 400, p)
    if ('minItems' in s && s.minItems !== 0 && s.minItems !== 1)
      c.fail(
        'strict.schema',
        `${p}: minItems ${String(s.minItems)} is not supported (only 0 or 1)`,
        400,
        p,
      )
    const objectLike = s.type === 'object' || (Array.isArray(s.type) && s.type.includes('object'))
    if (objectLike && s.additionalProperties !== false)
      c.fail('strict.schema', `${p}: additionalProperties must be set to false for objects`, 400, p)
    if ('additionalProperties' in s && s.additionalProperties !== false)
      c.fail('strict.schema', `${p}: additionalProperties may only be false`, 400, p)
    if ('anyOf' in s && ('type' in s || 'properties' in s))
      c.fail('strict.schema', `${p}: anyOf cannot sit beside type or properties`, 400, p)
    if (typeof s.format === 'string' && !STRING_FORMATS.has(s.format))
      c.fail('strict.schema', `${p}: string format '${s.format}' is not supported`, 400, p)
    if (typeof s.pattern === 'string' && /\\[1-9bB]|\(\?[=!<]/.test(s.pattern))
      c.fail('strict.schema', `${p}: the pattern uses an unsupported regex feature`, 400, p)
    if (Array.isArray(s.enum) && s.enum.some((v) => typeof v === 'object' && v !== null))
      c.fail(
        'strict.schema',
        `${p}: enum values must be strings, numbers, booleans or null`,
        400,
        p,
      )
    for (const [k, v] of Object.entries(s)) {
      if (k === 'enum' || k === 'const' || k === 'required' || k === 'default') continue
      if (k === 'properties' && isObj(v)) {
        for (const [name, sub] of Object.entries(v)) visit(sub, `${p}.properties.${name}`)
      } else if (typeof v === 'object') visit(v, `${p}.${k}`)
    }
  }
  visit(schema, path)
}

/** Counts optional and union-typed parameters across a schema (every nested object counts). */
function countParams(schema: unknown): { optional: number; union: number } {
  let optional = 0
  let union = 0
  const visit = (s: unknown): void => {
    if (Array.isArray(s)) {
      for (const x of s) visit(x)
      return
    }
    if (!isObj(s)) return
    if (isObj(s.properties)) {
      const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : [])
      for (const [name, sub] of Object.entries(s.properties)) {
        if (!required.has(name)) optional++
        if (isObj(sub) && (Array.isArray(sub.anyOf) || Array.isArray(sub.type))) union++
      }
    }
    for (const [k, v] of Object.entries(s))
      if (
        k !== 'enum' &&
        k !== 'const' &&
        k !== 'required' &&
        k !== 'default' &&
        typeof v === 'object'
      )
        visit(v)
  }
  visit(schema)
  return { optional, union }
}

function checkStrictLimits(c: Check, tools: unknown[], format: Json | null): void {
  const strict = tools.filter((t) => isObj(t) && t.strict === true) as Json[]
  if (strict.length > 20)
    c.fail('strict.limits', `Too many strict tools: ${strict.length} (the limit is 20)`)
  let optional = 0
  let union = 0
  for (const s of [...strict.map((t) => t.input_schema), ...(format ? [format.schema] : [])]) {
    const n = countParams(s)
    optional += n.optional
    union += n.union
  }
  if (optional > 24)
    c.fail('strict.limits', `Schemas contain too many optional parameters (${optional}, limit 24)`)
  if (union > 16)
    c.fail(
      'strict.limits',
      `Schemas contain too many parameters with union types (${union}, limit 16)`,
    )
}

/** Every explicit cache_control in the request, in render order (tools → system → messages). */
export function breakpointsOf(body: Json, tools: unknown[]): { path: string; ttl: string }[] {
  const out: { path: string; ttl: string }[] = []
  const take = (b: unknown, path: string) => {
    if (isObj(b) && isObj(b.cache_control))
      out.push({ path, ttl: (b.cache_control.ttl as string | undefined) ?? '5m' })
  }
  tools.forEach((t, i) => take(t, `tools.${i}`))
  if (Array.isArray(body.system)) body.system.forEach((b, i) => take(b, `system.${i}`))
  ;(body.messages as unknown[]).forEach((m, i) => {
    if (isObj(m) && Array.isArray(m.content))
      m.content.forEach((b, j) => {
        take(b, `messages.${i}.content.${j}`)
        if (isObj(b) && b.type === 'tool_result' && Array.isArray(b.content))
          b.content.forEach((x, k) => take(x, `messages.${i}.content.${j}.content.${k}`))
      })
  })
  return out
}

function checkCache(c: Check, body: Json, tools: unknown[]): void {
  const explicit = breakpointsOf(body, tools)
  const auto = isObj(body.cache_control)
    ? [(body.cache_control.ttl as string | undefined) ?? '5m']
    : []
  const total = explicit.length + auto.length
  if (total > 4)
    c.fail(
      'cache.breakpoints',
      `A maximum of 4 blocks with cache_control may be provided. Found ${total}.`,
    )
  const ttls = [...explicit.map((b) => b.ttl), ...auto]
  let seenShort = false
  for (const t of ttls) {
    if (t === '5m') seenShort = true
    else if (t === '1h' && seenShort)
      c.fail('cache.breakpoints', 'A cache_control with ttl 1h cannot come after one with ttl 5m.')
  }
}

const USER_BLOCKS = new Set(['text', 'image', 'document', 'tool_result', 'search_result'])
const ASSISTANT_BLOCKS = new Set([
  'text',
  'thinking',
  'redacted_thinking',
  'tool_use',
  'server_tool_use',
  'web_search_tool_result',
  'web_fetch_tool_result',
  'fallback',
  'compaction',
])
const RESULT_BLOCKS = new Set(['text', 'image', 'document', 'search_result'])

function checkMessages(c: Check, messages: unknown[]): void {
  const roleOf = (m: unknown) => (isObj(m) ? m.role : undefined)
  messages.forEach((m, i) => {
    const path = `messages.${i}`
    if (!isObj(m)) return c.fail('messages.roles', `${path}: must be an object`, 400, path)
    if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system')
      return c.fail('messages.roles', `${path}.role: must be user, assistant or system`, 400, path)
    const content = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content
    if (!Array.isArray(content))
      return c.fail(
        'messages.content_types',
        `${path}.content: must be a string or a list`,
        400,
        path,
      )
    if (m.role === 'system') {
      if (i === 0)
        c.fail(
          'messages.system_placement',
          `${path}: a system message cannot be messages[0]`,
          400,
          path,
        )
      const prev = messages[i - 1]
      const prevServerTool =
        isObj(prev) &&
        prev.role === 'assistant' &&
        Array.isArray(prev.content) &&
        isObj(prev.content.at(-1)) &&
        (prev.content.at(-1) as Json).type === 'server_tool_use'
      if (i > 0 && roleOf(prev) !== 'user' && !prevServerTool)
        c.fail(
          'messages.system_placement',
          `${path}: a system message must follow a user message (it follows ${String(roleOf(prev))})`,
          400,
          path,
        )
      if (i < messages.length - 1 && roleOf(messages[i + 1]) !== 'assistant')
        c.fail(
          'messages.system_placement',
          `${path}: a system message must be last or followed by an assistant message (next is ${String(roleOf(messages[i + 1]))})`,
          400,
          path,
        )
      content.forEach((b, j) => {
        if (!isObj(b) || b.type !== 'text')
          c.fail(
            'messages.system_placement',
            `${path}.content.${j}: system messages are text only`,
            400,
            path,
          )
      })
      return
    }
    const allowed = m.role === 'user' ? USER_BLOCKS : ASSISTANT_BLOCKS
    content.forEach((b, j) => {
      const bp = `${path}.content.${j}`
      if (!isObj(b) || typeof b.type !== 'string' || !allowed.has(b.type))
        return c.fail(
          'messages.content_types',
          `${bp}: block type ${isObj(b) ? String(b.type) : typeof b} is not allowed in a ${String(m.role)} message`,
          400,
          bp,
        )
      if (b.type === 'text' && typeof b.text !== 'string')
        c.fail('messages.content_types', `${bp}.text: must be a string`, 400, bp)
      if (b.type === 'text' && b.text === '')
        c.fail('messages.content_types', `${bp}: text content blocks must be non-empty`, 400, bp)
      if (b.type === 'tool_result' && Array.isArray(b.content))
        b.content.forEach((x, k) => {
          if (!isObj(x) || !RESULT_BLOCKS.has(x.type as string))
            c.fail(
              'messages.content_types',
              `${bp}.content.${k}: not allowed in a tool_result`,
              400,
              bp,
            )
          if (isObj(x) && x.type === 'text' && x.text === '')
            c.fail(
              'messages.content_types',
              `${bp}.content.${k}: text content blocks must be non-empty`,
              400,
              bp,
            )
        })
    })
  })

  // The first message must be from the user.
  if (roleOf(messages[0]) !== 'user')
    c.fail(
      'messages.roles',
      `messages.0: the first message must use the "user" role`,
      400,
      'messages.0',
    )

  // Prefill: the last turn (system messages aside) must not be the assistant's.
  let last = messages.length - 1
  while (last >= 0 && roleOf(messages[last]) === 'system') last--
  if (last >= 0 && roleOf(messages[last]) === 'assistant')
    c.fail(
      'prefill.removed',
      'This model does not support assistant message prefill. The conversation must end with a user message.',
    )

  // Tool pairing.
  const answered = new Set<string>()
  messages.forEach((m, i) => {
    if (!isObj(m) || !Array.isArray(m.content)) return
    if (m.role === 'assistant') {
      const ids = (m.content as Json[])
        .filter((b) => b?.type === 'tool_use')
        .map((b) => b.id as string)
      if (!ids.length) return
      const next = messages[i + 1]
      const path = `messages.${i + 1}`
      if (!isObj(next) || next.role !== 'user' || !Array.isArray(next.content)) {
        // The conversation may end on the tool calls only if nothing follows (a prefill, caught above).
        if (next !== undefined)
          c.fail(
            'messages.tool_pairing',
            `messages.${i}: \`tool_use\` ids were found without \`tool_result\` blocks immediately after: ${ids.join(', ')}. Each \`tool_use\` block must have a corresponding \`tool_result\` block in the next message.`,
            400,
            path,
          )
        return
      }
      const blocks = next.content as Json[]
      const results = blocks
        .filter((b) => b?.type === 'tool_result')
        .map((b) => b.tool_use_id as string)
      const missing = ids.filter((id) => !results.includes(id))
      if (missing.length)
        c.fail(
          'messages.tool_pairing',
          `messages.${i}: \`tool_use\` ids were found without \`tool_result\` blocks immediately after: ${missing.join(', ')}.`,
          400,
          path,
        )
      const firstOther = blocks.findIndex((b) => b?.type !== 'tool_result')
      const lastResult = blocks.map((b) => b?.type).lastIndexOf('tool_result')
      if (firstOther !== -1 && firstOther < lastResult)
        c.fail(
          'messages.tool_pairing',
          `${path}: tool_result blocks must come first in the content, before any text`,
          400,
          path,
        )
      for (const id of results) {
        if (!ids.includes(id))
          c.fail(
            'messages.tool_pairing',
            `${path}: unexpected \`tool_use_id\` found in \`tool_result\` blocks: ${id}. Each \`tool_result\` block must have a corresponding \`tool_use\` block in the previous message.`,
            400,
            path,
          )
        if (answered.has(id))
          c.fail(
            'messages.tool_pairing',
            `${path}: tool_use_id ${id} was answered twice`,
            400,
            path,
          )
        answered.add(id)
      }
    } else if (m.role === 'user') {
      const prev = messages[i - 1]
      const prevIds = new Set(
        isObj(prev) && prev.role === 'assistant' && Array.isArray(prev.content)
          ? (prev.content as Json[])
              .filter((b) => b?.type === 'tool_use')
              .map((b) => b.id as string)
          : [],
      )
      for (const b of m.content as Json[])
        if (b?.type === 'tool_result' && !prevIds.has(b.tool_use_id as string))
          c.fail(
            'messages.tool_pairing',
            `messages.${i}: unexpected \`tool_use_id\` found in \`tool_result\` blocks: ${String(b.tool_use_id)}. Each \`tool_result\` block must have a corresponding \`tool_use\` block in the previous message.`,
            400,
            `messages.${i}`,
          )
    }
  })
}

/** Width and height from an image's header bytes (PNG, JPEG, GIF, WebP), or null. */
export function imageSize(buf: Buffer, mediaType: string): { w: number; h: number } | null {
  try {
    if (mediaType === 'image/png' && buf.readUInt32BE(12) === 0x49484452)
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
    if (mediaType === 'image/gif' && buf.toString('ascii', 0, 3) === 'GIF')
      return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) }
    if (mediaType === 'image/webp' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const chunk = buf.toString('ascii', 12, 16)
      if (chunk === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) }
      if (chunk === 'VP8L') {
        const b = buf.readUInt32LE(21)
        return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }
      }
      if (chunk === 'VP8 ')
        return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
    }
    if (mediaType === 'image/jpeg' && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2
      while (i < buf.length) {
        if (buf[i] !== 0xff) return null
        const marker = buf[i + 1]!
        const len = buf.readUInt16BE(i + 2)
        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc
        )
          return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
        i += 2 + len
      }
    }
  } catch {
    return null
  }
  return null
}

/** Every image block in the request (tool_result content included), with its path. */
export function imagesOf(messages: unknown[]): { path: string; block: Json }[] {
  const out: { path: string; block: Json }[] = []
  messages.forEach((m, i) => {
    if (!isObj(m) || !Array.isArray(m.content)) return
    m.content.forEach((b, j) => {
      if (!isObj(b)) return
      if (b.type === 'image') out.push({ path: `messages.${i}.content.${j}`, block: b })
      if (b.type === 'tool_result' && Array.isArray(b.content))
        b.content.forEach((x, k) => {
          if (isObj(x) && x.type === 'image')
            out.push({ path: `messages.${i}.content.${j}.content.${k}`, block: x })
        })
    })
  })
  return out
}

function checkImages(c: Check, messages: unknown[], _system: unknown): void {
  const images = imagesOf(messages)
  if (images.length > IMAGE_LIMITS.maxPerRequest)
    c.fail(
      'images.limits',
      `Too many images: ${images.length} (the limit is ${IMAGE_LIMITS.maxPerRequest})`,
    )
  const many = images.length > IMAGE_LIMITS.manyImagesThreshold
  for (const { path, block } of images) {
    const src = block.source
    if (!isObj(src)) {
      c.fail('images.limits', `${path}.source: required`, 400, path)
      continue
    }
    if (src.type !== 'base64') continue // url and file sources are fetched by the API
    if (!IMAGE_LIMITS.mediaTypes.includes(src.media_type as string)) {
      c.fail(
        'images.limits',
        `${path}.source.media_type: Input should be ${IMAGE_LIMITS.mediaTypes.join(', ')}`,
        400,
        path,
      )
      continue
    }
    const data = src.data
    if (typeof data !== 'string' || data.length === 0 || !/^[A-Za-z0-9+/]+=*$/.test(data)) {
      c.fail('images.limits', `${path}.source.data: not valid base64 image data`, 400, path)
      continue
    }
    if (data.length > IMAGE_LIMITS.maxBase64Bytes) {
      c.fail(
        'images.limits',
        `${path}: image exceeds 10 MB maximum: ${data.length} bytes`,
        400,
        path,
      )
      continue
    }
    const size = imageSize(Buffer.from(data, 'base64'), src.media_type as string)
    if (!size) {
      c.fail(
        'images.limits',
        `${path}: Could not process image (the data is not a ${String(src.media_type)})`,
        400,
        path,
      )
      continue
    }
    const side = Math.max(size.w, size.h)
    if (side > IMAGE_LIMITS.maxSide)
      c.fail(
        'images.limits',
        `${path}: image dimensions exceed max allowed size: ${IMAGE_LIMITS.maxSide} pixels`,
        400,
        path,
      )
    else if (many && side > IMAGE_LIMITS.manyImagesSide)
      c.fail(
        'images.limits',
        `${path}: image dimensions exceed max allowed size for many-image requests: ${IMAGE_LIMITS.manyImagesSide} pixels`,
        400,
        path,
      )
  }
}

/** A short stable hash, for logs and recordings. */
export const shortHash = (s: string | Buffer): string =>
  createHash('sha256').update(s).digest('hex').slice(0, 16)

export const errorBody = (v: Pick<Violation, 'type' | 'message'>, requestId: string) => ({
  type: 'error',
  error: { type: v.type, message: v.message },
  request_id: requestId,
})
