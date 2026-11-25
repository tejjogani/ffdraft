/**
 * Where the fake's answers come from:
 *  - `scriptedSource`: replies (or functions of the request) given up front, in order;
 *  - `replaySource`: a saved recording, served in order, with the live run's ids swapped in;
 *  - `agentSource`: Claude in the loop. Each request is written to a queue folder (the full body,
 *    a readable view and its images as files) and the fake waits, as long as it takes, for a reply
 *    file written by whoever plays the model.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describeMessages, align, type Recording, recordedMessages, remap, stripImages } from './recording'
import type { FakeReply } from './reply'
import type { ReplySource, SourceRequest } from './server'

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

export type ScriptedReply = FakeReply | ((req: SourceRequest) => FakeReply | Promise<FakeReply>)

export interface ScriptedSource extends ReplySource {
  push(...replies: ScriptedReply[]): void
  readonly remaining: number
}

export function scriptedSource(replies: readonly ScriptedReply[] = []): ScriptedSource {
  const queue = [...replies]
  return {
    push: (...r) => queue.push(...r),
    get remaining() {
      return queue.length
    },
    async next(req) {
      const r = queue.shift()
      if (!r) throw new Error(`scriptedSource: no reply left for request ${req.n}`)
      return typeof r === 'function' ? r(req) : r
    },
  }
}

export interface ReplayReport {
  served: number
  /** Requests whose shape differed from the recording (message count, roles, block types). */
  structural: { n: number; problems: string[] }[]
  /** Text that differed once ids were paired. */
  drift: { n: number; at: string; recorded: string; live: string }[]
  /** Model, structured flag or frozen-prefix changes against the recording. */
  mismatches: { n: number; problem: string }[]
}

export interface ReplaySource extends ReplySource {
  readonly report: ReplayReport
  readonly remaining: number
}

/** Serves a recording in order, rewriting its replies with the live ids. */
export function replaySource(rec: Recording): ReplaySource {
  const expected = recordedMessages(rec)
  const ids = new Map<string, string>()
  const report: ReplayReport = { served: 0, structural: [], drift: [], mismatches: [] }
  let i = 0
  return {
    report,
    get remaining() {
      return rec.exchanges.length - i
    },
    async next(req) {
      const e = rec.exchanges[i]
      if (!e) throw new Error(`replay ${rec.journey}: request ${req.n} is beyond the ${rec.exchanges.length} recorded`)
      const want = expected[i]!
      i++
      if (e.request.model !== req.model) report.mismatches.push({ n: req.n, problem: `model ${req.model}, recorded ${e.request.model}` })
      if (e.request.structured !== req.structured) report.mismatches.push({ n: req.n, problem: 'structured flag differs' })
      const live = Array.isArray(req.body.messages) ? req.body.messages : []
      const a = align(want, live, ids)
      if (a.structural.length) report.structural.push({ n: req.n, problems: a.structural })
      for (const d of a.drift) report.drift.push({ n: req.n, ...d })
      report.served++
      if (e.aborted) {
        // The recorded client went away mid-call; wait for the live one to do the same.
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`replay ${rec.journey}: request ${req.n} was aborted when recorded, but not now`)), 120_000)
          req.signal.addEventListener('abort', () => {
            clearTimeout(timer)
            resolve()
          }, { once: true })
        })
        throw new Error('the client went away (as recorded)')
      }
      return remap(e.reply, ids)
    },
  }
}

export interface AgentSourceOptions {
  /** The queue folder: req-NNNN.* are written here, res-NNNN.json is read from here. */
  dir: string
  /** How long to wait for each reply (default 2 hours: a person or model may take a while). */
  timeoutMs?: number
  pollMs?: number
}

const pad = (n: number) => String(n).padStart(4, '0')

/**
 * Claude in the loop. For request N it writes:
 *  - req-NNNN.txt: a readable view (model, the new messages since this conversation's previous
 *    request, one line per block; images listed with their files);
 *  - req-NNNN.json: the full request body, image bytes replaced by hashes;
 *  - req-NNNN-img-K.<ext>: each image of the new messages, to look at;
 * then waits for res-NNNN.json (a FakeReply). A request the client abandoned gets req-NNNN.aborted.
 */
export function agentSource(opts: AgentSourceOptions): ReplySource {
  mkdirSync(opts.dir, { recursive: true })
  const conversations: { first: string; messages: string[] }[] = []
  return {
    slow: true,
    async next(req) {
      const tag = pad(req.n)
      const messages = Array.isArray(req.body.messages) ? (req.body.messages as unknown[]) : []
      const json = messages.map((m) => JSON.stringify(stripImages(m)))
      let conv = conversations.find((c) => c.first === json[0])
      const isNew = !conv
      if (!conv) {
        conv = { first: json[0] ?? '', messages: [] }
        conversations.push(conv)
      }
      let from = 0
      while (from < conv.messages.length && from < json.length && conv.messages[from] === json[from]) from++
      conv.messages = json

      // Images of the new messages, as files to look at.
      const images: string[] = []
      messages.slice(from).forEach((m) => {
        const visit = (v: unknown) => {
          if (Array.isArray(v)) return v.forEach(visit)
          if (!isObj(v)) return
          if (v.type === 'image' && isObj(v.source) && typeof v.source.data === 'string') {
            const ext = String(v.source.media_type).split('/')[1] ?? 'bin'
            const file = join(opts.dir, `req-${tag}-img-${images.length + 1}.${ext === 'jpeg' ? 'jpg' : ext}`)
            writeFileSync(file, Buffer.from(v.source.data, 'base64'))
            images.push(file)
            return
          }
          Object.values(v).forEach(visit)
        }
        visit(m)
      })
      const tools = Array.isArray(req.body.tools) ? (req.body.tools as Json[]).map((t) => t.name) : []
      const format = isObj(req.body.output_config) ? req.body.output_config.format : undefined
      const view = [
        `#${req.n} ${req.model} ${req.structured ? 'STRUCTURED OUTPUT (answer with one text block of JSON matching the schema in req-' + tag + '.json output_config.format)' : 'turn'}`,
        `conversation: ${isNew ? 'NEW' : 'continues'}; ${messages.length} messages; ${tools.length} tools; showing from message ${from}`,
        format ? `schema keys: ${Object.keys(isObj(format) && isObj(format.schema) && isObj(format.schema.properties) ? format.schema.properties : {}).join(', ')}` : '',
        images.length ? `images: ${images.join(', ')}` : '',
        '',
        describeMessages(messages, from),
      ]
        .filter((l) => l !== '')
        .join('\n')
      writeFileSync(join(opts.dir, `req-${tag}.json`), JSON.stringify(stripImages(req.body), null, 1))
      writeFileSync(
        join(opts.dir, `req-${tag}.meta.json`),
        JSON.stringify({ n: req.n, model: req.model, betas: (req.headers['anthropic-beta'] ?? '').split(',').filter(Boolean) }),
      )
      writeFileSync(join(opts.dir, `req-${tag}.txt`), `${view}\n`)

      const reply = join(opts.dir, `res-${tag}.json`)
      const deadline = Date.now() + (opts.timeoutMs ?? 2 * 60 * 60 * 1000)
      for (;;) {
        if (req.signal.aborted) {
          writeFileSync(join(opts.dir, `req-${tag}.aborted`), 'The client went away before the reply.\n')
          throw new Error('the client went away')
        }
        if (existsSync(reply)) {
          try {
            const parsed = JSON.parse(readFileSync(reply, 'utf8')) as FakeReply
            renameSync(reply, join(opts.dir, `res-${tag}.served.json`))
            return parsed
          } catch (err) {
            // A half-written file: try again on the next poll; a broken one is reported once.
            if (Date.now() > deadline) throw err
          }
        }
        if (Date.now() > deadline) throw new Error(`no reply for request ${req.n} in time`)
        await new Promise((r) => setTimeout(r, opts.pollMs ?? 300))
      }
    },
  }
}
