/**
 * Live smoke test, for a person with an API key: `pnpm agent:smoke [--tier=power|standard|light]`.
 *
 * Sends the assistant's real request (all tools, the frozen system prompt, context messages,
 * thinking passed back) to each tier's model, three turns each, and checks what only the live
 * API can show: the request shape is accepted, a tool call comes back valid, the second turn
 * reads the cache, and no replayed thinking block is dropped. Spends a little money (it prints
 * the cost); never prints the key. Reads ANTHROPIC_API_KEY from the environment or
 * apps/server/.env.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type {
  BetaMessage,
  BetaMessageParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { ASSISTANT_TIERS, type AssistantModelId, type AssistantTier } from '@pave/schema'
import {
  anthropicModel,
  buildRequest,
  checkKey,
  classifyStop,
  contextMessage,
  mapError,
  messageUsage,
  StreamAdapter,
  toApiMessages,
} from './anthropic'
import { MODELS, resolveTiers } from './pricing'
import { renderContext } from './prompt/index'
import { parseToolCall } from './tools'

const envFile = fileURLToPath(new URL('../../../apps/server/.env', import.meta.url))
if (!process.env.ANTHROPIC_API_KEY && existsSync(envFile)) process.loadEnvFile(envFile)
const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
if (!apiKey) {
  console.log(
    'No ANTHROPIC_API_KEY in the environment or apps/server/.env: nothing to test. Create a key on the Claude Console’s API keys page and put it in apps/server/.env.',
  )
  process.exit(0)
}

const only = process.argv.find((a) => a.startsWith('--tier='))?.slice(7) as
  | AssistantTier
  | undefined
const resolved = resolveTiers(null, process.env)
for (const w of resolved.warnings) console.log(`warning: ${w}`)
const tiers = only ? [only] : [...ASSISTANT_TIERS]

const context = () =>
  contextMessage(
    renderContext({
      date: new Date().toISOString().slice(0, 10),
      piece: null,
      selection: [],
      board: null,
      attachments: [],
      references: [],
      designerEdits: [],
      canon: null,
    }),
  )

interface Result {
  tier: AssistantTier
  model: AssistantModelId
  ok: boolean
  notes: string[]
  costUsd: number
}

async function turn(model: AssistantModelId, messages: BetaMessageParam[]) {
  const client = anthropicModel({ apiKey: apiKey!, maxRetries: 2 })
  const stream = client.stream(buildRequest({ model, messages }), {})
  const adapter = new StreamAdapter()
  let streamed = 0
  for await (const e of stream) streamed += adapter.push(e).length
  const message: BetaMessage = await stream.finalMessage()
  return { message, adapter, streamed }
}

async function smoke(tier: AssistantTier): Promise<Result> {
  const model = resolved.tiers[tier].model
  const r: Result = { tier, model, ok: true, notes: [], costUsd: 0 }
  const fail = (why: string) => {
    r.ok = false
    r.notes.push(`FAIL ${why}`)
  }
  const history: { role: 'user' | 'assistant' | 'system'; content: Record<string, unknown>[] }[] =
    []
  const say = (text: string) => {
    history.push({ role: 'user', content: [{ type: 'text', text }] }, context())
  }
  try {
    // 1. A question: the request shape is accepted and streams.
    say('In one sentence: what does a cathedral shoulder do on a solitaire ring?')
    const a = await turn(model, toApiMessages(history))
    r.costUsd += messageUsage(a.message).costUsd
    if (classifyStop(a.message).kind !== 'end') fail(`turn 1 stopped with ${a.message.stop_reason}`)
    if (a.streamed === 0) fail('turn 1 streamed no text or thinking')
    history.push({ role: 'assistant', content: JSON.parse(JSON.stringify(a.message.content)) })

    // 2. A tool call: valid input for a real tool, then an error result to recover from.
    say('Read the piece with id pc_smoke using the tool, then tell me its title in one line.')
    const b = await turn(model, toApiMessages(history))
    r.costUsd += messageUsage(b.message).costUsd
    const cache = b.message.usage.cache_read_input_tokens ?? 0
    if (cache === 0) fail('turn 2 read nothing from the prompt cache')
    else r.notes.push(`cache read ${cache} tokens`)
    if (b.adapter.inputTransformations.length)
      fail(
        `turn 2: the API changed replayed thinking: ${JSON.stringify(b.adapter.inputTransformations)}`,
      )
    const stop = classifyStop(b.message)
    if (stop.kind !== 'tools') fail(`turn 2 did not call a tool (${b.message.stop_reason})`)
    history.push({ role: 'assistant', content: JSON.parse(JSON.stringify(b.message.content)) })
    if (stop.kind === 'tools') {
      for (const call of stop.calls) {
        const parsed = parseToolCall(call.name, call.input)
        if (!parsed.ok) fail(`tool input did not validate: ${parsed.error}`)
        else r.notes.push(`called ${call.name}`)
      }
      history.push({
        role: 'user',
        content: stop.calls.map((c) => ({
          type: 'tool_result',
          tool_use_id: c.id,
          is_error: true,
          content: [{ type: 'text', text: 'Not found: there is no piece pc_smoke.' }],
        })),
      })
      // 3. The answer after a tool result, with every earlier thinking block passed back.
      const c = await turn(model, toApiMessages(history))
      r.costUsd += messageUsage(c.message).costUsd
      if (c.adapter.inputTransformations.length)
        fail(
          `turn 3: the API changed replayed thinking: ${JSON.stringify(c.adapter.inputTransformations)}`,
        )
      if (classifyStop(c.message).kind !== 'end')
        fail(`turn 3 stopped with ${c.message.stop_reason}`)
    }
  } catch (err) {
    fail(mapError(err, { model }).message)
  }
  return r
}

console.log('Checking the key with the Models API…')
const check = await checkKey({ apiKey })
if (!check.ok) {
  console.log(`FAIL ${check.message}`)
  process.exit(1)
}
console.log(
  `The key can use: ${check.models.map((m) => MODELS[m].label).join(', ') || 'none of the tier models'}`,
)
const results: Result[] = []
for (const tier of tiers) {
  const model = resolved.tiers[tier].model
  if (!check.models.includes(model)) {
    results.push({
      tier,
      model,
      ok: false,
      notes: ['FAIL this key cannot use the model'],
      costUsd: 0,
    })
    continue
  }
  console.log(`${tier}: ${MODELS[model].label}…`)
  results.push(await smoke(tier))
}
let spent = 0
for (const r of results) {
  spent += r.costUsd
  console.log(
    `${r.ok ? 'ok  ' : 'FAIL'} ${r.tier.padEnd(8)} ${MODELS[r.model].label.padEnd(18)} $${r.costUsd.toFixed(4)}  ${r.notes.join('; ')}`,
  )
}
console.log(`Spent about $${spent.toFixed(4)}.`)
process.exit(results.every((r) => r.ok) ? 0 : 1)
