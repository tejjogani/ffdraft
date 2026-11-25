/**
 * The live smoke test's journeys (`pnpm agent:smoke`, entry point `src/smoke-cli.ts`): the
 * founder's three stages, run by Claude on a real server in this process.
 *
 *   a. Design: a written brief becomes directions (an AI job); a person picks one, which becomes
 *      the piece's built design.
 *   b. Photo: a kernel-drawn photo of a ring becomes a parametric design.
 *   c. Edit: one change asked for by chat on the design from (a).
 *   d. Render: a Render job makes one low-sample Blender take and the model looks at it (skipped
 *      with a clear line when Blender is not found).
 *
 * Every run must finish, every design must evaluate, the second model call of a run must read
 * the prompt cache, and no thinking block may be dropped when it is passed back. Tokens and cost
 * are reported per run. The server is the real one (database in memory, kernel workers, Blender
 * if installed, the assistant with its real Claude client); only the person is played by this
 * file, approving whatever a run asks for.
 *
 * The key reaches the assistant through the environment it is built with and is never printed:
 * nothing here reads it, and run errors are the server's own sentences.
 */
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AgentToolName, describeCall } from '@pave/agent'
import {
  type AssistantTier,
  applyOps,
  buildDesign,
  type CommandOutput,
  type Run,
  type Step,
  TEMPLATES,
} from '@pave/schema'
import sharp from 'sharp'
import { createApp } from '../app'
import { configFromEnv } from '../config'
import { createEngines, enginesConfigFromEnv } from '../engines'
import { referenceServicesFromEnv } from '../references'
import { serviceContext } from '../service-context'
import { type Client, client } from '../test/harness'
import type { ModelFactory } from './host'
import { type AssistantParts, createAssistant } from './index'

export const JOURNEYS = ['design', 'photo', 'edit', 'render'] as const
export type JourneyName = (typeof JOURNEYS)[number]

/** The brief of journey (a); also the first example in the README. */
export const BRIEF =
  'An engagement ring for someone who works with her hands: about a 1 carat round diamond, ' +
  'nothing that catches on gloves, yellow gold, US size 6. Budget around $4,000.'

export interface SmokeOptions {
  /** The environment the server is built with: the key, tier overrides, PAVE_PYTHON… */
  env: Readonly<Record<string, string | undefined>>
  tier: AssistantTier
  only?: ReadonlySet<JourneyName>
  /** Replaces the Claude client (tests). */
  model?: ModelFactory
  log?: (line: string) => void
  /** Longest a run may take. The most capable models can think for minutes per call. */
  runTimeoutMs?: number
}

export interface RunReport {
  journey: JourneyName
  title: string
  runId: string | null
  model: string | null
  status: string
  modelCalls: number
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  costUsd: number
  failures: string[]
  notes: string[]
}

export interface SmokeReport {
  runs: RunReport[]
  skipped: string[]
  ok: boolean
  costUsd: number
}

type Detail = CommandOutput<'traces.run'>

const ENDED = new Set<Run['status']>(['done', 'failed', 'canceled', 'paused'])
const POLL_MS = 1_000

// ── Checks on a finished run (pure, unit-tested) ────────────────────────────────────────────

interface ModelOutput {
  servedBy?: string
  inputTransformations?: unknown[]
}

/**
 * What a finished run's trace shows: it ended well; its second model call read the prompt cache
 * (the frozen tools and system prompt, then the conversation, are the same bytes every call);
 * no replayed thinking block was dropped or changed by the API.
 */
export function checkRun(detail: Pick<Detail, 'run' | 'steps'>): {
  failures: string[]
  notes: string[]
  modelCalls: number
} {
  const failures: string[] = []
  const notes: string[] = []
  const { run } = detail
  if (run.status !== 'done')
    failures.push(
      `the run ended as ${run.status}${run.errorCode ? ` (${run.errorCode})` : ''}${run.error ? `: ${run.error}` : ''}`,
    )
  const models = detail.steps.filter((s) => s.kind === 'model').sort((a, b) => a.index - b.index)
  const second = models[1]
  if (second) {
    const read = second.usage?.cacheRead ?? 0
    if (read === 0) failures.push('the second model call read nothing from the prompt cache')
    else notes.push(`second call read ${read.toLocaleString('en-US')} tokens from the cache`)
  }
  for (const s of models) {
    const out = (s.output ?? {}) as ModelOutput
    if (out.inputTransformations?.length)
      failures.push(
        `model call ${s.index} had replayed thinking dropped or changed: ${JSON.stringify(out.inputTransformations)}`,
      )
    if (out.servedBy && out.servedBy !== run.model)
      notes.push(`model call ${s.index} was answered by ${out.servedBy} (a server-side fallback)`)
  }
  const toolErrors = detail.steps.filter((s) => s.kind === 'tool' && s.isError)
  if (toolErrors.length)
    notes.push(
      `${toolErrors.length} tool call${toolErrors.length === 1 ? '' : 's'} came back as errors the model then handled (${[...new Set(toolErrors.map((s) => s.name))].join(', ')})`,
    )
  return { failures, notes, modelCalls: models.length }
}

/** One line for a finished tool step, in the studio's own chip words. */
export function stepLine(s: Step): string {
  let words = s.name
  try {
    words = describeCall(s.name as AgentToolName, (s.input ?? null) as never, 'done').text
  } catch {
    // A tool the chip table does not know reads as its name.
  }
  const state = s.isError ? 'error' : s.status === 'done' ? '' : s.status
  return `${words}${state ? ` (${state})` : ''} · ${(s.ms / 1000).toFixed(1)} s`
}

// ── The server ──────────────────────────────────────────────────────────────────────────────

export interface SmokeServer {
  api: Client
  parts: AssistantParts
  server: Awaited<ReturnType<typeof createApp>>
  dispose(): Promise<void>
}

/**
 * The real server, assembled as `compose.ts` does, with its database in memory and files in a
 * temporary folder, so the smoke test never touches the founder's own data.
 */
export async function bootSmoke(opts: Pick<SmokeOptions, 'env' | 'model'>): Promise<SmokeServer> {
  const dir = await mkdtemp(join(tmpdir(), 'pave-smoke-'))
  // The test script mode would replace Claude with canned turns: never in a smoke test.
  const env = { ...opts.env, PAVE_ASSISTANT: undefined }
  // A Blender chosen in the Render tab's engine dialog is saved in the founder's data folder; the
  // smoke test uses a copy, so it finds the same Blender and never writes there.
  const ownData = configFromEnv(env as NodeJS.ProcessEnv).dataDir
  const engineFile = join(dir, 'engine.json')
  if (ownData) await copyFile(join(ownData, 'engine.json'), engineFile).catch(() => {})
  let parts: AssistantParts | null = null
  try {
    const server = await createApp({
      config: {
        ...configFromEnv({ ...(env as NodeJS.ProcessEnv), NODE_ENV: 'development' }),
        auth: 'local',
        databaseUrl: null,
        dataDir: null,
        blobDir: join(dir, 'blobs'),
        authSecret: `smoke-${crypto.randomUUID()}`,
        seed: false,
        studioDist: join(dir, 'no-studio'),
        logRequests: false,
      },
      services: (runtime) => {
        parts = createAssistant(runtime, { env, ...(opts.model ? { model: opts.model } : {}) })
        // As compose.ts's servicesFromEnv, with the engine choice read from the copy above.
        return {
          ...createEngines(runtime, {
            ...enginesConfigFromEnv(env as NodeJS.ProcessEnv, runtime.config),
            engineFile,
          }),
          ...referenceServicesFromEnv(env as NodeJS.ProcessEnv),
          ...parts.services,
        }
      },
      routes: (app, _runtime, withCtx) => parts?.routes(app, withCtx),
    })
    return {
      api: client(server),
      parts: parts!,
      server,
      dispose: async () => {
        await server.close()
        await rm(dir, { recursive: true, force: true })
      },
    }
  } catch (err) {
    await rm(dir, { recursive: true, force: true })
    throw err
  }
}

// ── Following a run ─────────────────────────────────────────────────────────────────────────

/**
 * Waits for a run to end, printing each tool call as it finishes and approving whatever the run
 * asks a person to approve (the smoke test plays the designer). Returns the final trace.
 */
export async function follow(
  api: Client,
  runId: string,
  opts: { timeoutMs: number; log: (line: string) => void },
): Promise<Detail> {
  const deadline = Date.now() + opts.timeoutMs
  const printed = new Set<string>()
  const approved = new Set<string>()
  for (;;) {
    const detail = await api.call('traces.run', { id: runId })
    for (const s of [...detail.steps].sort((a, b) => a.index - b.index)) {
      if (s.kind !== 'tool' || printed.has(s.id)) continue
      if (s.status === 'running' || s.status === 'waiting' || s.status === 'awaiting-approval')
        continue
      printed.add(s.id)
      opts.log(`    · ${stepLine(s)}`)
    }
    if (detail.run.status === 'awaiting-approval') {
      for (const s of detail.steps) {
        if (s.status !== 'awaiting-approval' || !s.toolCallId || approved.has(s.toolCallId))
          continue
        approved.add(s.toolCallId)
        opts.log(`    · approved ${s.name} (the smoke test approves what a run asks for)`)
        await api.call('runs.decide', { runId, toolCallId: s.toolCallId, decision: 'approve' })
      }
    }
    if (ENDED.has(detail.run.status)) return detail
    if (Date.now() > deadline) {
      await api.call('runs.cancel', { runId }).catch(() => {})
      throw new Error(`the run did not finish within ${Math.round(opts.timeoutMs / 60_000)} min`)
    }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}

// ── The journeys ────────────────────────────────────────────────────────────────────────────

/** The last thing the assistant said in a thread, as plain text. */
async function lastWords(api: Client, threadId: string): Promise<string> {
  const { messages } = await api.call('threads.get', { id: threadId })
  const last = messages.filter((m) => m.role === 'assistant').at(-1)
  return (last?.content ?? [])
    .flatMap((b) => (b.type === 'text' && typeof b.text === 'string' ? [b.text] : []))
    .join('\n')
    .trim()
}

/** Evaluates a piece's design; a failure here fails the run that made it. */
async function evaluate(api: Client, pieceId: string, r: RunReport): Promise<void> {
  try {
    const e = await api.call('design.evaluate', { pieceId, detail: 'draft' })
    const warnings = e.diagnostics.filter((d) => d.level !== 'info').length
    r.notes.push(
      `the design evaluates: ${e.metalMassG.toFixed(2)} g of metal, ${e.stoneCount} stone${e.stoneCount === 1 ? '' : 's'}, ${e.caratTotal.toFixed(2)} ct, ${warnings} thing${warnings === 1 ? '' : 's'} to check`,
    )
  } catch (err) {
    r.failures.push(`the design does not evaluate: ${err instanceof Error ? err.message : err}`)
  }
}

/** A photo of a solitaire with six claws, drawn by the kernel worker: the truth is known. */
async function ringPhoto(s: SmokeServer): Promise<string> {
  const base = buildDesign({
    ...TEMPLATES.find((x) => x.id === 'solitaire')!.spec,
    stones: [{ role: 'center', cut: 'round', carat: 1, setting: 'prong', prongs: 6 }],
  })
  const band = (base.nodes.band as { widthTop: number }).widthTop * 1.3
  const truth = applyOps(base, [
    { t: 'update', id: 'band', patch: { widthTop: band, widthBottom: band } },
  ] as never).design
  const ctx = await s.server.runtime.context(s.server.runtime.local!)
  const geometry = ctx.services.get('geometry')
  if (!geometry.picture) throw new Error('the kernel cannot draw pictures')
  const size = 640
  const { images } = await geometry.picture(
    truth,
    { views: ['three-quarter'], size, focus: [] },
    serviceContext(ctx),
  )
  const jpeg = await sharp(images[0]!, { raw: { width: size, height: size, channels: 4 } })
    .jpeg({ quality: 92 })
    .toBuffer()
  const form = new FormData()
  form.set('file', new File([new Uint8Array(jpeg)], 'ring-photo.jpg', { type: 'image/jpeg' }))
  const res = await s.api.request('/api/assets', { method: 'POST', body: form })
  if (!res.ok) throw new Error(`uploading the photo failed: ${res.status}`)
  return ((await res.json()) as { id: string }).id
}

/** Runs the journeys in order; a journey that needs an earlier one's piece is skipped without it. */
export async function runSmoke(opts: SmokeOptions): Promise<SmokeReport> {
  const log = opts.log ?? (() => {})
  const only = opts.only ?? new Set(JOURNEYS)
  const timeoutMs = opts.runTimeoutMs ?? 20 * 60_000
  const runs: RunReport[] = []
  const skipped: string[] = []
  const s = await bootSmoke(opts)
  let n = 0

  const blank = (journey: JourneyName, title: string): RunReport => ({
    journey,
    title,
    runId: null,
    model: null,
    status: 'not started',
    modelCalls: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    costUsd: 0,
    failures: [],
    notes: [],
  })

  /** Sends one message, follows its run to the end and fills the report from its trace. */
  async function run(
    r: RunReport,
    input: {
      text: string
      threadId?: string
      pieceId?: string
      attachments?: string[]
      job?: { stage: 'design' | 'cad' | 'render'; goal?: string }
    },
  ): Promise<{ detail: Detail; threadId: string } | null> {
    log(`\n${r.title}`)
    try {
      const sent = await s.api.call('threads.send', {
        text: input.text,
        ...(input.threadId ? { threadId: input.threadId } : {}),
        attachments: input.attachments ?? [],
        referenceIds: [],
        context: { ...(input.pieceId ? { pieceId: input.pieceId } : {}), selection: [] },
        tier: opts.tier,
        ...(input.job ? { job: input.job } : {}),
        clientId: 'smoke',
        clientMessageId: `smoke-${++n}`,
      })
      r.runId = sent.run.id
      const detail = await follow(s.api, sent.run.id, { timeoutMs, log })
      const checked = checkRun(detail)
      r.model = detail.run.model
      r.status = detail.run.status
      r.modelCalls = checked.modelCalls
      r.tokens = detail.run.tokens
      r.costUsd = detail.run.costUsd
      r.failures.push(...checked.failures)
      r.notes.push(...checked.notes)
      return { detail, threadId: sent.thread.id }
    } catch (err) {
      r.failures.push(err instanceof Error ? err.message : String(err))
      // A run that timed out still spent: report what its trace says.
      if (r.runId) {
        const t = await s.api.call('traces.run', { id: r.runId }).catch(() => null)
        if (t) {
          r.model = t.run.model
          r.status = t.run.status
          r.tokens = t.run.tokens
          r.costUsd = t.run.costUsd
        }
      }
      return null
    }
  }

  /**
   * One journey, reported once. Anything that goes wrong around its run (making the photo, a
   * command failing) is a failure of that journey, not a crash that hides what was spent.
   */
  async function journey(r: RunReport, body: () => Promise<void>): Promise<void> {
    try {
      await body()
    } catch (err) {
      r.failures.push(err instanceof Error ? err.message : String(err))
    }
    if (r.runId || r.failures.length) runs.push(r)
  }

  try {
    let pieceId: string | null = null
    let threadId: string | null = null

    // a. Design: brief → directions (an AI job) → a person picks one → a built design.
    if (only.has('design')) {
      const r = blank('design', 'a. Design: a brief becomes directions, and one becomes the design')
      await journey(r, async () => {
        const piece = await s.api.call('pieces.create', { title: 'Smoke test ring', brief: BRIEF })
        const done = await run(r, {
          text: 'Propose directions for this brief.',
          pieceId: piece.id,
          job: { stage: 'design' },
        })
        if (done) {
          threadId = done.threadId
          const after = await s.api.call('pieces.get', { id: piece.id })
          const built = after.directions.filter((d) => d.facts)
          if (after.directions.length < 2)
            r.failures.push(`expected two or more directions, got ${after.directions.length}`)
          else if (built.length < after.directions.length)
            r.failures.push(
              `${after.directions.length - built.length} direction(s) were not built and evaluated`,
            )
          for (const d of after.directions)
            r.notes.push(
              `direction ${d.letter} "${d.name}": ${d.facts ? `${d.facts.metalMassG.toFixed(1)} g, ${d.facts.stoneCount} stone(s)${d.facts.costUsd === null ? '' : `, about $${Math.round(d.facts.costUsd)}`}` : 'not built'}`,
            )
          const first = after.directions[0]
          if (first) {
            // The person's step of the Design job: they choose, then accept the job's outputs.
            await s.api.call('pieces.chooseDirection', { pieceId: piece.id, directionId: first.id })
            if (done.detail.run.job?.review === 'pending')
              await s.api.call('runs.accept', { runId: done.detail.run.id })
            r.notes.push(`chose direction ${first.letter}, as a designer would`)
            pieceId = piece.id
            await evaluate(s.api, piece.id, r)
          }
        }
      })
    }

    // b. Photo: a kernel-drawn photo of a six-claw solitaire → a parametric design.
    if (only.has('photo')) {
      const r = blank('photo', 'b. Photo: a photo of a ring becomes a parametric design')
      await journey(r, async () => {
        const photo = await ringPhoto(s)
        const done = await run(r, {
          text: 'Make this ring as a parametric design.',
          attachments: [photo],
        })
        const made = done?.detail.run.pieceId
        if (done && !made) r.failures.push('the run did not make or open a piece')
        if (made) {
          const piece = await s.api.call('pieces.get', { id: made })
          // The centre stone's setting: the claw count is one thing a photo read must get right.
          const setting = Object.values(piece.design.nodes).find(
            (x) => x.kind === 'setting' && 'prongCount' in x,
          ) as { style: string; prongCount: number } | undefined
          if (setting)
            r.notes.push(
              setting.style === 'prong' || setting.style === 'basket'
                ? `the design has ${setting.prongCount} claws (the photo shows 6)`
                : `the design has a ${setting.style} setting (the photo shows 6 claws)`,
            )
          await evaluate(s.api, made, r)
        }
      })
    }

    // c. Edit: one change by chat on the chosen direction.
    if (only.has('edit')) {
      const r = blank('edit', 'c. Edit: one change asked for by chat')
      const id = pieceId
      if (!id) skipped.push('c. Edit: needs the design from (a)')
      else
        await journey(r, async () => {
          const before = await s.api.call('pieces.get', { id })
          const done = await run(r, {
            text: 'Make the band 0.3 mm wider. Keep everything else as it is.',
            pieceId: id,
            ...(threadId ? { threadId } : {}),
          })
          if (done) {
            const after = await s.api.call('pieces.get', { id })
            const changed = done.detail.steps.some((x) => x.changeIds.length > 0)
            if (!changed || after.version === before.version)
              r.failures.push('the run made no change to the design')
            else r.notes.push(`design version ${before.version} → ${after.version}`)
            await evaluate(s.api, id, r)
          }
        })
    }

    // d. Render: a Render job makes one low-sample Blender take, and the model looks at it.
    if (only.has('render')) {
      const r = blank('render', 'd. Render: one Blender take, and the assistant’s critique')
      const id = pieceId
      const engine = await s.api.call('renders.engine', {})
      if (!id) skipped.push('d. Render: needs the design from (a)')
      else if (!engine.available)
        skipped.push(
          `d. Render: skipped, Blender was not found (${engine.reason ?? 'no reason given'}). Install it with: node scripts/install.mjs --render`,
        )
      else
        await journey(r, async () => {
          const done = await run(r, {
            text: 'Render one Hero shot at Draft quality, 640 px square, then tell me in a few sentences what you see in the take and one thing you would change.',
            pieceId: id,
            ...(threadId ? { threadId } : {}),
            job: {
              stage: 'render',
              goal: 'One Hero shot at Draft quality, 640 px, then a critique',
            },
          })
          if (done) {
            const takes = (await s.api.call('renders.list', { pieceId: id, limit: 20 })).filter(
              (t) => t.engine === 'blender',
            )
            const ok = takes.filter((t) => t.status === 'done')
            if (!ok.length)
              r.failures.push(
                `no Blender take finished (${takes.map((t) => t.status).join(', ') || 'none started'})`,
              )
            for (const t of ok)
              r.notes.push(
                `take "${t.title}": ${t.scene.output.quality} quality, ${t.scene.output.width}×${t.scene.output.height} px`,
              )
            const critique = await lastWords(s.api, done.threadId)
            if (!critique) r.failures.push('the assistant said nothing about the take')
            else r.notes.push(`critique: ${critique.replace(/\s+/g, ' ').slice(0, 280)}`)
          }
        })
    }
  } finally {
    await s.dispose()
  }
  const costUsd = runs.reduce((a, r) => a + r.costUsd, 0)
  return { runs, skipped, ok: runs.every((r) => r.failures.length === 0), costUsd }
}
