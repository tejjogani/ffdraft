/**
 * Test mode: `PAVE_ASSISTANT=scripted:<fixture>` makes the assistant play canned turns from
 * `fixtures/<fixture>.json` instead of calling Claude, so the studio and Playwright can drive a
 * whole conversation with no key and no network. It refuses to start in production, prints a loud
 * line when on, and names its fixture in `assistant.setup.get` (`scripted: true`).
 *
 * A fixture is `{ "runs": [[turn, …], …] }`: the n-th run started in this process plays
 * `runs[n % runs.length]`, one turn per model call, and a resumed run continues where it was.
 * `{{pieceId}}` anywhere in a turn is replaced by the piece the run is working on at that moment.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type ModelClient, type ScriptedTurn, scriptedModel } from '@pave/agent'
import type { ModelFactory } from './host'

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/

export interface Fixture {
  runs: ScriptedTurn[][]
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
function fill(turn: ScriptedTurn, pieceId: string | null, tag: string): ScriptedTurn {
  const json = JSON.stringify(turn).replaceAll('{{pieceId}}', pieceId ?? 'no-piece')
  const filled = JSON.parse(json) as ScriptedTurn
  return {
    ...filled,
    content: filled.content.map((b, i) =>
      b.type === 'tool_use' && !b.id ? { ...b, id: `toolu_${tag}_${i}` } : b,
    ),
  }
}

/** A model factory playing the fixture: one queue of turns per run, kept across its sessions. */
export function scriptedFactory(fixture: Fixture): ModelFactory {
  const queues = new Map<string, ScriptedTurn[]>()
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
        return scriptedModel(turn ? [fill(turn, run.pieceId(), tag)] : []).stream(params, options)
      },
    }
    return client
  }
}
