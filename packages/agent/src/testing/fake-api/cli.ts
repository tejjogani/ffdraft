/**
 * The fake Claude API from a terminal, for recording journeys with Claude in the loop:
 *
 *   tsx packages/agent/src/testing/fake-api/cli.ts serve --port 4801 --queue <dir> \
 *       --record <recording.json> --journey <name> [--description <text>]
 *     Serves the fake on 127.0.0.1:<port> in agent mode: every request lands in <dir> and waits
 *     for a reply file. Each served exchange is saved to <recording.json> as it happens, so the
 *     recording is a replay fixture even if the session is cut short. Point the Pavé server at it
 *     with ANTHROPIC_BASE_URL=http://127.0.0.1:<port> (and any key: the fake accepts
 *     sk-ant-fake-key, or --key).
 *
 *   tsx …/cli.ts next <dir> [--timeout <seconds>]
 *     Waits for the next request without a reply and prints its readable view.
 *
 *   tsx …/cli.ts reply <dir> <n> [--then-next] < reply.json
 *     Writes the reply for request <n> (a FakeReply: {"content": [...]}), then optionally waits for
 *     and prints the next request: one command per turn.
 */
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PromptCache } from './cache'
import { Recorder } from './recording'
import { type FakeReply, outputTokensOf } from './reply'
import { DEFAULT_FAKE_KEY, startFakeApi } from './server'
import { agentSource } from './sources'

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const pad = (n: number) => String(n).padStart(4, '0')
const pickUsage = (u: NonNullable<FakeReply['usage']>): NonNullable<FakeReply['usage']> => ({
  input_tokens: u.input_tokens,
  output_tokens: u.output_tokens,
  cache_read_input_tokens: u.cache_read_input_tokens,
  cache_creation_input_tokens: u.cache_creation_input_tokens,
})

function pending(dir: string): number | null {
  const reqs = readdirSync(dir)
    .map((f) => /^req-(\d{4})\.txt$/.exec(f)?.[1])
    .filter((x): x is string => !!x)
    .map(Number)
    .sort((a, b) => a - b)
  for (const n of reqs)
    if (
      !existsSync(join(dir, `res-${pad(n)}.json`)) &&
      !existsSync(join(dir, `res-${pad(n)}.served.json`)) &&
      !existsSync(join(dir, `req-${pad(n)}.aborted`))
    )
      return n
  return null
}

async function next(dir: string, timeoutS: number): Promise<void> {
  const deadline = Date.now() + timeoutS * 1000
  for (;;) {
    const n = pending(dir)
    if (n !== null) {
      process.stdout.write(readFileSync(join(dir, `req-${pad(n)}.txt`), 'utf8'))
      return
    }
    if (Date.now() > deadline) {
      console.log(`(no request waiting after ${timeoutS} s)`)
      return
    }
    await new Promise((r) => setTimeout(r, 250))
  }
}

async function main() {
  const cmd = args[0]
  if (cmd === 'serve') {
    const dir = flag('queue')
    const file = flag('record')
    if (!dir || !file) throw new Error('serve needs --queue <dir> and --record <file>')
    const recorder = new Recorder()
    const journey = flag('journey') ?? 'journey'
    const description = flag('description') ?? ''
    const api = await startFakeApi({
      source: agentSource({ dir }),
      port: Number(flag('port') ?? 4801),
      apiKey: flag('key') ?? DEFAULT_FAKE_KEY,
      keepBodies: true,
      onExchange: (e) => {
        const line = e.violation
          ? `REFUSED ${e.violation.rule}: ${e.violation.message}`
          : e.sourceError
            ? `SOURCE ERROR: ${e.sourceError}`
            : `${e.path} ${e.n ?? ''} ${e.model ?? ''} ${e.fault ?? ''}`
        console.log(`[fake] ${e.at} ${line}`)
        if (e.body && e.n !== null && ((e.reply && !e.sourceError) || e.aborted)) {
          // The usage as served, so a replay costs exactly what the recording cost.
          const served = e.message?.usage as FakeReply['usage'] | undefined
          recorder.add(
            e.n,
            e.body,
            e.betas,
            e.aborted || !e.reply
              ? null
              : { ...e.reply, ...(served ? { usage: pickUsage(served) } : {}) },
          )
          const tmp = `${file}.tmp`
          writeFileSync(
            tmp,
            `${JSON.stringify(recorder.recording(journey, description), null, 1)}\n`,
          )
          renameSync(tmp, file)
        }
        // Keep memory flat: bodies are needed only until recorded.
        delete e.body
      },
    })
    console.log(`[fake] listening on ${api.url} (agent mode, queue ${dir}, recording ${file})`)
    const stop = () => void api.close().then(() => process.exit(0))
    process.on('SIGTERM', stop)
    process.on('SIGINT', stop)
    return
  }
  if (cmd === 'next') return next(args[1]!, Number(flag('timeout') ?? 540))
  if (cmd === 'reply') {
    const dir = args[1]!
    const n = Number(args[2])
    const body = readFileSync(0, 'utf8')
    JSON.parse(body) // refuse a broken reply before the fake sees it
    const tmp = join(dir, `res-${pad(n)}.tmp`)
    writeFileSync(tmp, body)
    renameSync(tmp, join(dir, `res-${pad(n)}.json`))
    console.log(`replied to #${n}`)
    if (args.includes('--then-next')) {
      // Give the fake a moment to take the reply before looking for the next request.
      await new Promise((r) => setTimeout(r, 600))
      return next(dir, Number(flag('timeout') ?? 540))
    }
    return
  }
  if (cmd === 'rebuild') {
    // Rebuilds a recording from a queue folder (requests, served replies, aborted requests).
    const dir = args[1]!
    const file = args[2]!
    const recorder = new Recorder()
    // The usage each reply was served with, worked out again: the fake's prompt cache is a pure
    // function of the requests in order (a fresh cache per session), so replaying them through a
    // fresh cache gives the same reads and writes it reported.
    const cache = new PromptCache()
    const ns = readdirSync(dir)
      .map((f) => /^req-(\d{4})\.json$/.exec(f)?.[1])
      .filter((x): x is string => !!x)
      .map(Number)
      .sort((a, b) => a - b)
    for (const n of ns) {
      const body = JSON.parse(readFileSync(join(dir, `req-${pad(n)}.json`), 'utf8'))
      const meta = existsSync(join(dir, `req-${pad(n)}.meta.json`))
        ? JSON.parse(readFileSync(join(dir, `req-${pad(n)}.meta.json`), 'utf8'))
        : { betas: [] }
      const served = join(dir, `res-${pad(n)}.served.json`)
      const usage = cache.use(String(body.model), body)
      if (existsSync(served)) {
        const reply = JSON.parse(readFileSync(served, 'utf8')) as FakeReply
        recorder.add(n, body, meta.betas, {
          ...reply,
          usage: reply.usage ?? {
            input_tokens: usage.input_tokens,
            cache_read_input_tokens: usage.cache_read_input_tokens,
            cache_creation_input_tokens: usage.cache_creation_input_tokens,
            output_tokens: outputTokensOf(reply.content),
          },
        })
      } else if (existsSync(join(dir, `req-${pad(n)}.aborted`)))
        recorder.add(n, body, meta.betas, null)
    }
    writeFileSync(
      file,
      `${JSON.stringify(recorder.recording(flag('journey') ?? 'journey', flag('description') ?? ''), null, 1)}\n`,
    )
    console.log(`rebuilt ${recorder.exchanges.length} exchanges into ${file}`)
    return
  }
  throw new Error('usage: cli.ts serve|next|reply|rebuild …')
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
