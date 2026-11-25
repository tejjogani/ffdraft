/**
 * Test mode: `PAVE_ASSISTANT=scripted:<fixture>` makes the assistant play canned turns from
 * `fixtures/<fixture>.json` instead of calling Claude, so the studio and Playwright can drive a
 * whole conversation with no key and no network. It refuses to start in production, prints a loud
 * line when on, and names its fixture in `assistant.setup.get` (`scripted: true`).
 *
 * A fixture is `{ "runs": [[turn, …], …] }`: the n-th run started in this process plays
 * `runs[n % runs.length]`, one turn per model call, and a resumed run continues where it was.
 * `{{pieceId}}` anywhere in a turn is replaced by the piece the run is working on at that moment,
 * `{{attachment}}` by the first photo attached to the latest message (from its context
 * message), so a fixture can read and fit "the photo the designer just sent". `{{take1}}`,
 * `{{take2}}` and `{{scene1}}`, `{{scene2}}` are the takes and saved shots named in the latest
 * tool results, in order, so a fixture can adjust and re-render "the take it just looked at".
 * `{{shot1}}` … `{{shot9}}` are the saved shots in the order they first appear in any tool result
 * of the conversation (the shots a run created, in creation order). `"{{suggest:<key>}}"` (a
 * JSON string) becomes the camera object the latest `scenes.suggest` placed for that shot, and
 * `"{{questions}}"` its default questions, so a fixture "places" cameras as a model would: from
 * the numbers the server measured on this very piece. `"{{readQuestions}}"` and `"{{readSpec}}"`
 * are the spec questions and the spec draft of the latest `references.read`, so a fixture asks
 * and builds from the picture it just read (Take to CAD).
 *
 * Two extras for watching the studio (screenshots, demos), neither part of the API:
 *  - `"paceMs": 40` streams the turn's text a word at a time, waiting that long between events;
 *  - `"error": {"status": 429, "type": "rate_limit_error", "message": "…"}` fails the call with
 *    the SDK's own typed error for that status, and `"error": {"connection": true}` with a
 *    connection error, so each error state can be seen as a person would meet it.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APIConnectionError, APIError } from '@anthropic-ai/sdk'
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { type ModelClient, type ModelStream, type ScriptedTurn, scriptedModel } from '@pave/agent'
import type { ModelFactory } from './host'

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/

type FixtureError = { status: number; type: string; message: string } | { connection: true }

export type FixtureTurn = Omit<ScriptedTurn, 'error'> & {
  paceMs?: number
  error?: FixtureError
}

export interface Fixture {
  runs: FixtureTurn[][]
}

/** The SDK error a fixture names, built the way the SDK builds it from a response. */
function sdkError(e: FixtureError): Error {
  if ('connection' in e) return new APIConnectionError({ message: 'Connection error.' })
  return APIError.generate(
    e.status,
    { type: 'error', error: { type: e.type, message: e.message } },
    e.message,
    new Headers(),
  )
}

const wait = (ms: number, signal: AbortSignal | undefined) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })

/** Replays a stream slowly: text a few words per event, `ms` apart. The final message is unchanged. */
function paced(inner: ModelStream, ms: number, signal: AbortSignal | undefined): ModelStream {
  async function* events(): AsyncGenerator<BetaRawMessageStreamEvent> {
    for await (const event of inner) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const words = event.delta.text.match(/\S+\s*|\s+/g) ?? [event.delta.text]
        for (let i = 0; i < words.length; i += 2) {
          await wait(ms, signal)
          yield { ...event, delta: { ...event.delta, text: words.slice(i, i + 2).join('') } }
        }
        continue
      }
      await wait(ms, signal)
      yield event
    }
  }
  const it = events()
  return { [Symbol.asyncIterator]: () => it, finalMessage: () => inner.finalMessage() }
}

export const FIXTURES_DIR = join(import.meta.dirname, 'fixtures')

/**
 * The fixture named by PAVE_ASSISTANT, or null when the variable is unset. Throws on anything
 * else, so a typo cannot quietly fall back to a mode nobody asked for.
 */
export function scriptedFromEnv(env: Readonly<Record<string, string | undefined>>): {
  name: string
  fixture: Fixture
} | null {
  const raw = env.PAVE_ASSISTANT?.trim()
  if (!raw) return null
  const name = raw.startsWith('scripted:') ? raw.slice('scripted:'.length) : null
  if (!name || !NAME.test(name))
    throw new Error(
      `PAVE_ASSISTANT=${raw} is not understood; the only value is scripted:<fixture>.`,
    )
  if (env.NODE_ENV === 'production')
    throw new Error(
      'PAVE_ASSISTANT=scripted:… is a test mode and cannot run with NODE_ENV=production.',
    )
  const file = join(FIXTURES_DIR, `${name}.json`)
  if (!existsSync(file)) throw new Error(`PAVE_ASSISTANT: no fixture ${file}`)
  const fixture = JSON.parse(readFileSync(file, 'utf8')) as Fixture
  if (!Array.isArray(fixture.runs) || fixture.runs.length === 0)
    throw new Error(`PAVE_ASSISTANT: ${file} has no runs`)
  return { name, fixture }
}

/**
 * Replaces `{{pieceId}}` in a turn (through its JSON, so nested inputs are covered) and gives
 * tool calls without an id one unique in the run, as the API's own ids are.
 */
function fill(
  turn: FixtureTurn,
  pieceId: string | null,
  tag: string,
  attachment: string | null,
  named: { takes: string[]; scenes: string[]; shots: string[] },
  suggestion: Suggestion | null,
  read: PhotoReadOut | null = null,
): ScriptedTurn {
  const json = JSON.stringify(turn)
    .replaceAll('{{pieceId}}', pieceId ?? 'no-piece')
    .replaceAll('{{attachment}}', attachment ?? 'no-attachment')
    .replace(/\{\{(take|scene)([12])\}\}/g, (_, kind: string, n: string) => {
      const list = kind === 'take' ? named.takes : named.scenes
      return list[Number(n) - 1] ?? `no-${kind}`
    })
    .replace(/\{\{shot([1-9])\}\}/g, (_, n: string) => named.shots[Number(n) - 1] ?? 'no-shot')
    .replace(/"\{\{suggest:([a-z-]+)\}\}"/g, (_, key: string) =>
      JSON.stringify(suggestion?.cameras[key] ?? { preset: 'hero', focalLength: 90 }),
    )
    .replaceAll('"{{questions}}"', JSON.stringify(suggestion?.questions ?? []))
    .replaceAll('"{{readQuestions}}"', JSON.stringify(read?.questions ?? []))
    .replaceAll('"{{readSpec}}"', JSON.stringify(read?.specDraft ?? null))
  const { paceMs: _pace, error, ...filled } = JSON.parse(json) as FixtureTurn
  return {
    ...filled,
    ...(error ? { error: sdkError(error) } : {}),
    content: filled.content.map((b, i) =>
      b.type === 'tool_use' && !b.id ? { ...b, id: `toolu_${tag}_${i}` } : b,
    ),
  }
}

/** The first attachment named in the latest context message (`name (asset as_…, mime)`). */
function latestAttachment(params: Parameters<ModelClient['stream']>[0]): string | null {
  for (let i = params.messages.length - 1; i >= 0; i--) {
    const m = params.messages[i]!
    if ((m.role as string) !== 'system') continue
    const found = /\(asset ([A-Za-z0-9_-]+),/.exec(JSON.stringify(m.content))
    if (found) return found[1]!
  }
  return null
}

/** Takes and saved shots named in the latest message of tool results, in the order named. */
function latestNamed(params: Parameters<ModelClient['stream']>[0]) {
  for (let i = params.messages.length - 1; i >= 0; i--) {
    const m = params.messages[i]!
    const text = JSON.stringify(m.content)
    if (m.role !== 'user' || !text.includes('tool_result')) continue
    const all = (re: RegExp) => [...new Set([...text.matchAll(re)].map((x) => x[1]!))]
    return { takes: all(/(rnd_[A-Za-z0-9_-]{16})/g), scenes: all(/(scn_[A-Za-z0-9_-]{16})/g) }
  }
  return { takes: [], scenes: [] }
}

/** Every saved shot named in the conversation's tool results, in order of first appearance. */
function allShots(params: Parameters<ModelClient['stream']>[0]): string[] {
  const seen = new Set<string>()
  for (const m of params.messages) {
    if (m.role !== 'user') continue
    const text = JSON.stringify(m.content)
    if (!text.includes('tool_result')) continue
    for (const x of text.matchAll(/(scn_[A-Za-z0-9_-]{16})/g)) seen.add(x[1]!)
  }
  return [...seen]
}

interface Suggestion {
  cameras: Record<string, unknown>
  questions: unknown[]
}

interface PhotoReadOut {
  questions: unknown[]
  specDraft: unknown
}

/** The spec questions and draft of the latest `references.read` result in the conversation. */
function latestRead(params: Parameters<ModelClient['stream']>[0]): PhotoReadOut | null {
  for (let i = params.messages.length - 1; i >= 0; i--) {
    const m = params.messages[i]!
    if (m.role !== 'user' || !Array.isArray(m.content)) continue
    for (const block of m.content as { type: string; content?: unknown }[]) {
      if (block.type !== 'tool_result' || !Array.isArray(block.content)) continue
      for (const part of block.content as { type: string; text?: string }[]) {
        if (part.type !== 'text' || !part.text?.startsWith('{')) continue
        try {
          const out = JSON.parse(part.text) as Partial<PhotoReadOut>
          if (out.specDraft && Array.isArray(out.questions))
            return { questions: out.questions, specDraft: out.specDraft }
        } catch {
          // Not JSON: another tool's text.
        }
      }
    }
  }
  return null
}

/** The cameras and questions of the latest `scenes.suggest` result in the conversation. */
function latestSuggestion(params: Parameters<ModelClient['stream']>[0]): Suggestion | null {
  for (let i = params.messages.length - 1; i >= 0; i--) {
    const m = params.messages[i]!
    if (m.role !== 'user' || !Array.isArray(m.content)) continue
    for (const block of m.content as { type: string; content?: unknown }[]) {
      if (block.type !== 'tool_result' || !Array.isArray(block.content)) continue
      for (const part of block.content as { type: string; text?: string }[]) {
        if (part.type !== 'text' || !part.text?.startsWith('{')) continue
        try {
          const out = JSON.parse(part.text) as {
            shots?: { key: string; camera: unknown; why?: string }[]
            questions?: unknown[]
          }
          if (!out.shots?.length || !out.questions || out.shots[0]?.why === undefined) continue
          return {
            cameras: Object.fromEntries(out.shots.map((s) => [s.key, s.camera])),
            questions: out.questions,
          }
        } catch {
          // Not a JSON result: keep looking.
        }
      }
    }
  }
  return null
}

/** A model factory playing the fixture: one queue of turns per run, kept across its sessions. */
export function scriptedFactory(fixture: Fixture): ModelFactory {
  const queues = new Map<string, FixtureTurn[]>()
  let started = 0
  return (run) => {
    let queue = queues.get(run.runId)
    if (!queue) {
      queue = [...fixture.runs[started++ % fixture.runs.length]!]
      queues.set(run.runId, queue)
    }
    const q = queue
    const client: ModelClient = {
      stream(params, options) {
        const turn = q.shift()
        const tag = `${run.runId.slice(-8)}${q.length}`
        const stream = scriptedModel(
          turn
            ? [
                fill(
                  turn,
                  run.pieceId(),
                  tag,
                  latestAttachment(params),
                  { ...latestNamed(params), shots: allShots(params) },
                  latestSuggestion(params),
                  latestRead(params),
                ),
              ]
            : [],
        ).stream(params, options)
        return turn?.paceMs ? paced(stream, turn.paceMs, options.signal) : stream
      },
    }
    return client
  }
}
