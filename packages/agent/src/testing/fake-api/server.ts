/**
 * A strict, local stand-in for the Claude API: `POST /v1/messages` (streamed or not), `GET
 * /v1/models` and `GET /v1/models/{id}`. The real SDK reaches it through `ANTHROPIC_BASE_URL` (or
 * `baseURL`) with any key the fake is told to accept.
 *
 * Each request is validated as the real API would (./rules, ./binding), answered by a response
 * source (a fixture, a recording, or Claude writing reply files: ./sources), and streamed exactly
 * as the streaming docs describe: message_start, ping, content_block_start, text / thinking /
 * signature / input_json deltas in chunks, content_block_stop, message_delta with the stop reason
 * and usage (cache reads and writes included), message_stop (skill: typescript/claude-api/
 * streaming.md § Stream Event Types and § Raw SSE Format; live: build-with-claude/streaming).
 *
 * Every exchange is kept (and handed to `onExchange`), so a test can assert that the harness never
 * sent a request the fake rejected, and a recorder can save the conversation as a replay fixture.
 */
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { checkBinding, prefixHash, signThinking, type Transformation } from './binding'
import { PromptCache } from './cache'
import { conformError } from './conform'
import { type FakeReply, outputTokensOf, type ReplyBlock } from './reply'
import {
  betasOf,
  errorBody,
  type IncomingRequest,
  type Violation,
  validateHeaders,
  validateMessages,
} from './rules'
import { FAKE_MODELS, isFakeModel, MODEL_SPECS } from './spec'

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

export interface SourceRequest {
  /** 1-based number of the request among those that passed validation. */
  n: number
  model: string
  body: Json
  /** A structured-output request (output_config.format), such as the photo read. */
  structured: boolean
  /** Lower-cased request headers (a test can tag requests with its own header). */
  headers: Readonly<Record<string, string | undefined>>
  signal: AbortSignal
}

export interface ReplySource {
  next(req: SourceRequest): Promise<FakeReply>
  /** Sources that can take minutes (Claude in the loop) get the stream opened and kept alive with pings. */
  readonly slow?: boolean
}

export interface Exchange {
  n: number | null
  at: string
  path: string
  model: string | null
  structured: boolean
  /** The request body as received (kept only with `keepBodies`; images stay in). */
  body?: Json
  betas: string[]
  /** Set when the fake refused the request. */
  violation?: Violation
  /** Set when the source's reply broke a guarantee the real API gives. */
  sourceError?: string
  reply?: FakeReply
  /** The message as sent (final form). */
  message?: Json
  /** A fault that was injected instead of (or into) a normal answer. */
  fault?: string
  dropped?: Transformation[]
  /** The client went away before the reply (a run stopped or paused mid-call). */
  aborted?: boolean
}

export interface FakeApiOptions {
  source: ReplySource
  /** The key the fake accepts (default `sk-ant-fake-key`). */
  apiKey?: string
  port?: number
  /** Keep each request body on its exchange (tests that inspect requests). */
  keepBodies?: boolean
  onExchange?: (e: Exchange) => void
  /** Chunk size for streamed text and tool input (default 24 characters). */
  chunk?: number
}

export interface FakeApi {
  url: string
  apiKey: string
  readonly exchanges: Exchange[]
  /** Exchanges the fake refused or where the source broke a guarantee. */
  problems(): Exchange[]
  close(): Promise<void>
}

export const DEFAULT_FAKE_KEY = 'sk-ant-fake-key'

const requestId = () => `req_fake_${randomBytes(9).toString('base64url')}`

function sendError(
  res: ServerResponse,
  status: number,
  type: string,
  message: string,
  headers: Record<string, string> = {},
) {
  const id = requestId()
  res.writeHead(status, { 'content-type': 'application/json', 'request-id': id, ...headers })
  res.end(JSON.stringify(errorBody({ type, message }, id)))
}

const errorType = (status: number): string =>
  ({
    400: 'invalid_request_error',
    401: 'authentication_error',
    403: 'permission_error',
    404: 'not_found_error',
    413: 'request_too_large',
    429: 'rate_limit_error',
    500: 'api_error',
    529: 'overloaded_error',
  })[status] ?? 'api_error'

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > limit) return null
    chunks.push(c as Buffer)
  }
  return Buffer.concat(chunks)
}

function modelEntry(id: (typeof FAKE_MODELS)[number]) {
  const s = MODEL_SPECS[id]
  return {
    type: 'model',
    id,
    display_name: s.displayName,
    created_at: '2026-11-01T00:00:00Z',
    max_input_tokens: s.contextTokens,
    max_tokens: s.maxOutput,
  }
}

/** The content blocks of the final message, with ids and signatures. */
function materialise(
  blocks: readonly ReplyBlock[],
  model: string,
  prefix: string,
  n: number,
): Json[] {
  return blocks.map((b, i) => {
    if (b.type === 'text') return { type: 'text', text: b.text, citations: null }
    if (b.type === 'thinking')
      return {
        type: 'thinking',
        thinking: b.thinking,
        signature: signThinking(model, prefix, b.thinking),
      }
    return {
      type: 'tool_use',
      id: b.id ?? `toolu_fake${n}_${i}_${randomBytes(4).toString('hex')}`,
      name: b.name,
      input: b.input,
    }
  })
}

const split = (s: string, size: number): string[] => {
  const out: string[] = []
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size))
  return out.length ? out : ['']
}

/** The SSE frames of a message's content blocks, in order. */
function blockEvents(content: Json[], chunk: number, cutLastTool: boolean): Json[][] {
  const lastTool = content.map((b) => b.type).lastIndexOf('tool_use')
  return content.map((b, index) => {
    const ev: Json[] = []
    if (b.type === 'text') {
      ev.push({
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '', citations: null },
      })
      for (const t of split(b.text as string, chunk))
        if (t)
          ev.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: t } })
    } else if (b.type === 'thinking') {
      ev.push({
        type: 'content_block_start',
        index,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      })
      for (const t of split(b.thinking as string, chunk))
        if (t)
          ev.push({
            type: 'content_block_delta',
            index,
            delta: { type: 'thinking_delta', thinking: t },
          })
      ev.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'signature_delta', signature: b.signature },
      })
    } else if (b.type === 'tool_use') {
      ev.push({
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} },
      })
      let json = JSON.stringify(b.input)
      if (cutLastTool && index === lastTool)
        json = json.slice(0, Math.max(1, Math.floor(json.length / 2)))
      for (const t of split(json, chunk))
        ev.push({
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: t },
        })
    } else {
      ev.push({ type: 'content_block_start', index, content_block: b })
    }
    ev.push({ type: 'content_block_stop', index })
    return ev
  })
}

const frame = (e: Json) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`

/** Checks a reply against the guarantees the real API gives; returns what it broke. */
function sourceProblem(reply: FakeReply, body: Json, structured: boolean): string | null {
  if (!reply || !Array.isArray(reply.content)) return 'the reply has no content array'
  const tools = new Map<string, Json>()
  for (const t of Array.isArray(body.tools) ? (body.tools as Json[]) : [])
    if (typeof t.name === 'string') tools.set(t.name, t)
  const ids = new Set<string>()
  for (const b of reply.content) {
    if (b.type === 'tool_use') {
      const def = tools.get(b.name)
      if (!def) return `tool_use names ${b.name}, which is not in the request's tools`
      if (b.id) {
        if (ids.has(b.id)) return `duplicate tool_use id ${b.id}`
        ids.add(b.id)
      }
      if (def.strict === true) {
        const e = conformError(b.input, def.input_schema)
        if (e) return `strict tool ${b.name}: input does not match its schema (${e})`
      }
    } else if (b.type === 'text') {
      if (typeof b.text !== 'string' || b.text === '') return 'a text block is empty'
    } else if (b.type !== 'thinking') return `unknown reply block ${(b as { type: string }).type}`
  }
  if (structured && !reply.fault) {
    const texts = reply.content.filter((b) => b.type === 'text')
    if (texts.length !== 1 || reply.content.some((b) => b.type === 'tool_use'))
      return 'a structured-output reply must be exactly one text block of JSON'
    let parsed: unknown
    try {
      parsed = JSON.parse((texts[0] as { text: string }).text)
    } catch {
      return 'the structured-output text is not JSON'
    }
    const format = (body.output_config as Json).format as Json
    const e = conformError(parsed, format.schema)
    if (e) return `the structured output does not match the request's schema: ${e}`
  }
  return null
}

export async function startFakeApi(opts: FakeApiOptions): Promise<FakeApi> {
  const apiKey = opts.apiKey ?? DEFAULT_FAKE_KEY
  const chunk = opts.chunk ?? 24
  const cache = new PromptCache()
  const exchanges: Exchange[] = []
  let n = 0
  /** An HTTP fault still owed to the next requests, and the reply to give after it. */
  let owed: {
    status: number
    message: string
    retryAfter?: number
    left: number
    then: FakeReply | null
  } | null = null

  const log = (e: Exchange) => {
    exchanges.push(e)
    opts.onExchange?.(e)
  }

  async function messages(req: IncomingMessage, res: ServerResponse) {
    const at = new Date().toISOString()
    const raw = await readBody(req, 128 * 1024 * 1024)
    const headers = req.headers as Record<string, string | undefined>
    const betas = betasOf(headers)
    if (!raw) {
      log({
        n: null,
        at,
        path: '/v1/messages',
        model: null,
        structured: false,
        betas,
        violation: {
          rule: 'body.required',
          status: 413,
          type: 'request_too_large',
          message: 'Request exceeds the maximum allowed number of bytes.',
        },
      })
      return sendError(
        res,
        413,
        'request_too_large',
        'Request exceeds the maximum allowed number of bytes.',
      )
    }
    let body: unknown
    try {
      body = JSON.parse(raw.toString('utf8'))
    } catch {
      const v: Violation = {
        rule: 'body.required',
        status: 400,
        type: 'invalid_request_error',
        message: 'The request body is not valid JSON.',
      }
      log({
        n: null,
        at,
        path: '/v1/messages',
        model: null,
        structured: false,
        betas,
        violation: v,
      })
      return sendError(res, 400, v.type, v.message)
    }
    const incoming: IncomingRequest = { headers, body }
    const b = (isObj(body) ? body : {}) as Json
    const model = typeof b.model === 'string' ? b.model : null
    const structured = isObj(b.output_config) && b.output_config.format !== undefined
    const base = {
      at,
      path: '/v1/messages',
      model,
      structured,
      betas,
      ...(opts.keepBodies ? { body: b } : {}),
    }
    const violations = validateMessages(incoming, { apiKey })
    if (violations.length) {
      const v = violations[0]!
      log({ ...base, n: null, violation: v })
      return sendError(res, v.status, v.type, v.message)
    }
    const binding = checkBinding(b, model!)
    if (binding.error) {
      const v: Violation = {
        rule: 'thinking.binding',
        status: 400,
        type: 'invalid_request_error',
        message: binding.error,
      }
      log({ ...base, n: null, violation: v })
      return sendError(res, 400, v.type, v.message)
    }
    const usage = cache.use(model!, b)
    if (usage.total > MODEL_SPECS[model as keyof typeof MODEL_SPECS].contextTokens) {
      const v: Violation = {
        rule: 'context.window',
        status: 400,
        type: 'invalid_request_error',
        message: `prompt is too long: ${usage.total} tokens > ${MODEL_SPECS[model as keyof typeof MODEL_SPECS].contextTokens} maximum`,
      }
      log({ ...base, n: null, violation: v })
      return sendError(res, 400, v.type, v.message)
    }

    // An HTTP fault owed from an earlier reply answers this attempt (the SDK retrying).
    if (owed && owed.left > 0) {
      const o = owed
      o.left--
      if (o.left <= 0 && !o.then) owed = null
      log({ ...base, n: null, fault: `http ${o.status}` })
      return sendError(
        res,
        o.status,
        errorType(o.status),
        o.message,
        o.retryAfter !== undefined ? { 'retry-after': String(o.retryAfter) } : {},
      )
    }

    const index = ++n
    const ac = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) ac.abort()
    })
    const stream = b.stream === true
    const bindingBeta = betas.includes('thinking-binding-controls-2026-08-01')
    const messageId = `msg_fake_${index}_${randomBytes(6).toString('hex')}`
    // The input usage message_start reports: the reply's own numbers once it is known (a test
    // or a replay sets them), else the fake's estimate (a slow source opens the stream early).
    let reported: FakeReply['usage'] | null = null
    const startUsage = () => ({
      input_tokens: reported?.input_tokens ?? usage.input_tokens,
      cache_read_input_tokens: reported?.cache_read_input_tokens ?? usage.cache_read_input_tokens,
      cache_creation_input_tokens:
        reported?.cache_creation_input_tokens ?? usage.cache_creation_input_tokens,
      output_tokens: 1,
    })
    const startMessage = (m: string) => ({
      id: messageId,
      type: 'message',
      role: 'assistant',
      model: m,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      stop_details: null,
      usage: {
        ...startUsage(),
        cache_creation: null,
        inference_geo: null,
        iterations: null,
        server_tool_use: null,
        service_tier: 'standard',
        fallback_credit: null,
      },
      container: null,
      context_management: null,
      ...(bindingBeta ? { input_transformations: binding.dropped } : {}),
    })

    // A slow source (Claude in the loop) gets the stream opened now and kept alive.
    let opened = false
    let ping: NodeJS.Timeout | null = null
    const open = (as: string = model!) => {
      if (opened || !stream) return
      opened = true
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'request-id': requestId(),
      })
      res.write(frame({ type: 'message_start', message: startMessage(as) }))
      ping = setInterval(() => res.write(frame({ type: 'ping' })), 10_000)
    }
    let early: NodeJS.Timeout | null = null
    if (opts.source.slow && stream) early = setTimeout(() => open(), 1500)

    let reply: FakeReply
    // After an owed fault ran out, the reply that came with it answers (the SDK's retry succeeds).
    const queued = owed?.then ?? null
    owed = null
    try {
      reply =
        queued ??
        (await opts.source.next({
          n: index,
          model: model!,
          body: b,
          structured,
          headers,
          signal: ac.signal,
        }))
    } catch (err) {
      if (early) clearTimeout(early)
      if (ping) clearInterval(ping)
      const message = err instanceof Error ? err.message : String(err)
      if (ac.signal.aborted) log({ ...base, n: index, aborted: true })
      else log({ ...base, n: index, sourceError: `the source failed: ${message}` })
      if (res.destroyed) return
      if (opened) {
        res.end(
          frame({
            type: 'error',
            error: { type: 'api_error', message: `fake source failed: ${message}` },
          }),
        )
        return
      }
      return sendError(res, 500, 'api_error', `fake source failed: ${message}`, {
        'x-should-retry': 'false',
      })
    } finally {
      if (early) clearTimeout(early)
    }
    if (ping) clearInterval(ping)
    if (res.destroyed) {
      log({ ...base, n: index, reply, fault: 'client went away' })
      return
    }

    const problem = sourceProblem(reply, b, structured)
    if (problem) {
      log({ ...base, n: index, reply, sourceError: problem })
      if (opened)
        return res.end(
          frame({
            type: 'error',
            error: { type: 'api_error', message: `fake source error: ${problem}` },
          }),
        )
      return sendError(res, 500, 'api_error', `fake source error: ${problem}`, {
        'x-should-retry': 'false',
      })
    }

    reported = reply.usage ?? null
    const fault = reply.fault
    if (fault?.type === 'reset') {
      log({ ...base, n: index, reply, fault: 'reset' })
      req.socket.destroy()
      return
    }
    if (fault?.type === 'http') {
      const message = fault.message ?? `fake ${fault.status}`
      const times = fault.times ?? 1
      const rest = reply.content.length ? { ...reply, fault: undefined } : null
      if (times > 1 || rest)
        owed = {
          status: fault.status,
          message,
          retryAfter: fault.retryAfter,
          left: times - 1,
          then: rest,
        }
      log({ ...base, n: index, reply, fault: `http ${fault.status}` })
      if (opened)
        return res.end(frame({ type: 'error', error: { type: errorType(fault.status), message } }))
      return sendError(
        res,
        fault.status,
        errorType(fault.status),
        message,
        fault.retryAfter !== undefined ? { 'retry-after': String(fault.retryAfter) } : {},
      )
    }

    // The answer. A refusal with a fallback model switches models mid-turn.
    const prefix = prefixHash(b, Array.isArray(b.messages) ? b.messages.length : 0)
    const spec = MODEL_SPECS[model as keyof typeof MODEL_SPECS]
    let content: Json[]
    let servedBy = reply.servedBy ?? model!
    let stopReason: string =
      reply.stop_reason ??
      (reply.content.some((x) => x.type === 'tool_use') ? 'tool_use' : 'end_turn')
    let stopDetails: Json | null = null
    let iterations: Json[] | null = null
    const outTokens = outputTokensOf(reply.content)
    if (fault?.type === 'refusal') {
      const retried =
        b.fallbacks === 'default' &&
        spec.fallbackTo !== null &&
        spec.retriedCategories.includes(fault.category ?? '')
      if (retried && fault.fallback) {
        servedBy = spec.fallbackTo!
        const after = materialise(fault.fallback, servedBy, prefix, index)
        content = [
          ...materialise(reply.content, model!, prefix, index),
          {
            type: 'fallback',
            from: { model },
            to: { model: servedBy },
            trigger: { type: 'refusal', category: fault.category },
          },
          ...after,
        ]
        stopReason = fault.fallback.some((x) => x.type === 'tool_use') ? 'tool_use' : 'end_turn'
        const fbOut = outputTokensOf(fault.fallback)
        iterations = [
          {
            type: 'message',
            model,
            input_tokens: usage.input_tokens,
            output_tokens: outTokens,
            cache_read_input_tokens: usage.cache_read_input_tokens,
            cache_creation_input_tokens: usage.cache_creation_input_tokens,
            cache_creation: null,
          },
          {
            type: 'fallback_message',
            model: servedBy,
            input_tokens: usage.total,
            output_tokens: fbOut,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_creation: null,
          },
        ]
      } else {
        content = materialise(reply.content, model!, prefix, index)
        stopReason = 'refusal'
        stopDetails = {
          type: 'refusal',
          category: fault.category,
          explanation: fault.explanation ?? null,
        }
      }
    } else {
      content = materialise(reply.content, model!, prefix, index)
      if (fault?.type === 'max_tokens_in_tool') stopReason = 'max_tokens'
      if (fault?.type === 'pause_turn') stopReason = 'pause_turn'
    }
    const finalUsage = reply.usage
      ? { ...reply.usage }
      : {
          input_tokens: usage.input_tokens,
          cache_read_input_tokens: usage.cache_read_input_tokens,
          cache_creation_input_tokens: usage.cache_creation_input_tokens,
          output_tokens: iterations
            ? iterations.reduce((s, it) => s + (it.output_tokens as number), 0)
            : outTokens,
        }
    const message: Json = {
      ...startMessage(servedBy),
      content,
      stop_reason: stopReason,
      stop_details: stopDetails,
      usage: {
        ...finalUsage,
        cache_creation: null,
        inference_geo: null,
        iterations,
        server_tool_use: null,
        service_tier: 'standard',
        fallback_credit: null,
      },
    }
    log({
      ...base,
      n: index,
      reply,
      message,
      ...(fault ? { fault: fault.type } : {}),
      ...(binding.dropped.length ? { dropped: binding.dropped } : {}),
    })

    if (!stream) {
      res.writeHead(200, { 'content-type': 'application/json', 'request-id': requestId() })
      return res.end(JSON.stringify(message))
    }
    // A server-side fallback keeps the request's model in message_start, as the turn began there.
    open(fault?.type === 'refusal' ? model! : servedBy)
    const perBlock = blockEvents(content, chunk, fault?.type === 'max_tokens_in_tool')
    const dropAfter =
      fault?.type === 'drop' || fault?.type === 'stall'
        ? (fault.afterBlocks ?? 1)
        : Number.POSITIVE_INFINITY
    for (let i = 0; i < perBlock.length; i++) {
      if (i >= dropAfter && fault?.type === 'stall') break
      if (i >= dropAfter) {
        // A connection dropped mid-stream: no message_stop, the socket just closes.
        res.destroy()
        return
      }
      for (const e of perBlock[i]!) res.write(frame(e))
      // Yield so the client sees the stream arrive in pieces.
      await new Promise((r) => setImmediate(r))
    }
    if (fault?.type === 'stall') {
      // Keeps the stream open until the client gives up (Stop, shutdown): never finishes.
      await new Promise<void>((r) => res.once('close', () => r()))
      return
    }
    if (dropAfter <= perBlock.length) {
      res.destroy()
      return
    }
    res.write(
      frame({
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null, stop_details: stopDetails },
        usage: { ...finalUsage, iterations },
        ...(bindingBeta ? { input_transformations: binding.dropped } : {}),
      }),
    )
    res.end(frame({ type: 'message_stop' }))
  }

  function models(req: IncomingMessage, res: ServerResponse, id: string | null) {
    const headers = req.headers as Record<string, string | undefined>
    const at = new Date().toISOString()
    const v = validateHeaders({ headers, body: null }, { apiKey })
    const path = id ? `/v1/models/${id}` : '/v1/models'
    if (v.length) {
      log({
        n: null,
        at,
        path,
        model: null,
        structured: false,
        betas: betasOf(headers),
        violation: v[0]!,
      })
      return sendError(res, v[0]!.status, v[0]!.type, v[0]!.message)
    }
    log({ n: null, at, path, model: id, structured: false, betas: betasOf(headers) })
    res.setHeader('content-type', 'application/json')
    res.setHeader('request-id', requestId())
    if (id) {
      if (!isFakeModel(id)) return sendError(res, 404, 'not_found_error', `model: ${id}`)
      return res.end(JSON.stringify(modelEntry(id)))
    }
    const data = FAKE_MODELS.map(modelEntry)
    res.end(
      JSON.stringify({ data, has_more: false, first_id: data[0]!.id, last_id: data.at(-1)!.id }),
    )
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake')
    const done = (p: Promise<unknown> | unknown) =>
      Promise.resolve(p).catch((err) => {
        if (!res.headersSent) sendError(res, 500, 'api_error', `fake api crashed: ${String(err)}`)
        else res.destroy()
      })
    if (req.method === 'POST' && url.pathname === '/v1/messages') return done(messages(req, res))
    if (req.method === 'GET' && url.pathname === '/v1/models') return done(models(req, res, null))
    const m = /^\/v1\/models\/([^/]+)$/.exec(url.pathname)
    if (req.method === 'GET' && m) return done(models(req, res, decodeURIComponent(m[1]!)))
    sendError(res, 404, 'not_found_error', `Not found: ${req.method} ${url.pathname}`)
  })
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    apiKey,
    exchanges,
    problems: () => exchanges.filter((e) => e.violation || e.sourceError),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
