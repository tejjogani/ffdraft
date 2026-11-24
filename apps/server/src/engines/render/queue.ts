/**
 * `renderQueue`: Blender takes, `concurrency` at a time (one by default — Cycles uses every
 * core), served round-robin across organisations so one org's batch cannot starve another's.
 *
 * Cancel and shutdown abort the Blender process and wait for it to exit. A canceled job is
 * marked by the handler; a job cut off by shutdown is left live for boot recovery to resume.
 */
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { RESOLVED_SCENE_VERSION } from '@pave/render'
import type { Piece, RenderJob, RenderScene } from '@pave/schema'
import { AppError } from '../../errors'
import type {
  GeometryService,
  JobHandle,
  RenderJobPatch,
  RenderQueue,
  ServiceContext,
} from '../../services'
import type { BlenderSetup } from './blender'
import { renderTake } from './take'

export interface RenderQueueOptions {
  blender: BlenderSetup
  /** Resolved per job, so the queue uses whichever geometry engine is registered. */
  geometry: () => GeometryService
  concurrency?: number
  /** Where Blender writes; a fresh folder per job, removed afterwards. */
  workDir?: string
  timeoutMs?: (scene: RenderScene) => number
}

const MINUTE = 60_000
const TIMEOUT_BY_QUALITY: Record<RenderScene['output']['quality'], number> = {
  preview: 15 * MINUTE,
  standard: 60 * MINUTE,
  final: 180 * MINUTE,
}
const defaultTimeout = (scene: RenderScene) =>
  TIMEOUT_BY_QUALITY[scene.output.quality] * (scene.animation ? 4 : 1)

/** How long `cancel` waits for Blender to exit before letting the handler mark the job. */
const CANCEL_WAIT_MS = 15_000
const PROGRESS_EVERY_MS = 1_000

interface Entry {
  job: RenderJob
  piece: Piece
  handle: JobHandle<RenderJobPatch>
  sctx: ServiceContext
  controller: AbortController
  done?: Promise<void>
}

/** JSON with sorted keys, so equal scenes hash equally whatever order their keys arrived in. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

/** Same piece version, request, engine and runner → the same pixels. */
export function cacheKeyOf(job: RenderJob, blenderVersion: string | null): string {
  const key = canonical([
    job.pieceId,
    job.sourceVersion,
    job.requestedScene,
    'blender',
    job.autoTune,
    RESOLVED_SCENE_VERSION,
    blenderVersion,
  ])
  return `sha256:${createHash('sha256').update(key).digest('hex')}`
}

/** What a failed take shows: Blender's own words are useful to whoever runs this server. */
function failure(err: unknown): string {
  if (err instanceof AppError) return err.message
  if (err instanceof Error && err.message.startsWith('Blender render'))
    return err.message.slice(0, 2_000)
  return 'The render failed; try again.'
}

const slug = (title: string) =>
  title
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'render'

export function createRenderQueue(o: RenderQueueOptions) {
  const concurrency = Math.max(1, Math.floor(o.concurrency ?? 1))
  const timeoutMs = o.timeoutMs ?? defaultTimeout
  /** Waiting jobs per org; the map's order is the round-robin order. */
  const waiting = new Map<string, Entry[]>()
  const active = new Map<string, Entry>()
  let closing = false

  function next(): Entry | undefined {
    for (const [org, queue] of waiting) {
      const entry = queue.shift()
      // Re-inserting moves the org to the back of the line.
      waiting.delete(org)
      if (queue.length) waiting.set(org, queue)
      if (entry) return entry
    }
    return undefined
  }

  function pump(): void {
    while (!closing && active.size < concurrency) {
      const entry = next()
      if (!entry) return
      active.set(entry.job.id, entry)
      entry.done = run(entry).finally(() => {
        active.delete(entry.job.id)
        pump()
      })
    }
  }

  async function run(entry: Entry): Promise<void> {
    const { job, piece, handle, sctx } = entry
    const { signal } = entry.controller
    let workDir: string | null = null
    try {
      await o.blender.ready
      const engine = o.blender.status()
      if (!engine.available)
        throw new AppError('not_configured', `Blender is not available: ${engine.reason}`)
      // A job resumed after a restart must render the version it was queued for.
      if (piece.version !== job.sourceVersion)
        throw new AppError('conflict', 'The piece changed since this render was queued.')

      const cacheKey = cacheKeyOf(job, engine.version)
      const cached = job.retryOf ? null : await sctx.cachedRender(cacheKey)
      if (cached && cached.id !== job.id && cached.assetIds.length > 0) {
        await handle.update({
          status: 'done',
          progress: 1,
          assetIds: cached.assetIds,
          scene: cached.scene,
          critique: cached.critique,
          seconds: 0,
          device: cached.device,
          cacheKey,
        })
        return
      }

      await handle.update({ status: 'running', progress: 0.01, cacheKey })
      workDir = await mkdtemp(join(o.workDir ?? tmpdir(), `pave-render-${job.id}-`))
      const { glb, subject } = await o
        .geometry()
        .renderInput(piece.design, sctx, { pieceId: piece.id, signal })
      let reported = 0
      const result = await renderTake({
        scene: job.requestedScene,
        autoTune: job.autoTune,
        glb: glb.bytes,
        subject,
        workDir,
        runtime: o.blender.runtime(),
        signal,
        timeoutMs,
        onProgress: (p) => {
          const now = Date.now()
          if (now - reported < PROGRESS_EVERY_MS) return
          reported = now
          handle
            .update({ progress: 0.05 + 0.9 * p })
            .catch((err: unknown) => console.error(`Render ${job.id} progress:`, err))
        },
        onPass: (pass, r) =>
          sctx.recordUsage({
            meter: 'render',
            provider: 'blender',
            model: engine.version,
            quantity: Math.round(r.seconds * 100) / 100,
            unit: 'second',
            costUsd: 0,
            idempotencyKey: `render:${job.id}:${pass}`,
            pieceId: job.pieceId,
          }),
        store: async (path, role) => {
          const ext = extname(path)
          const asset = await sctx.putAsset({
            bytes: await readFile(path),
            name: `${slug(job.title)}${role === 'draft' ? '-draft' : ''}${ext}`,
            kind: ext === '.mp4' || ext === '.webm' ? 'video' : 'render',
          })
          return asset.id
        },
      })
      o.blender.noteDevice(result.device)
      await handle.update({
        status: 'done',
        progress: 1,
        assetIds: result.assetIds,
        scene: result.scene,
        critique: result.critique,
        seconds: Math.round(result.seconds * 100) / 100,
        device: result.device,
      })
    } catch (err) {
      // Canceled: the handler marks it. Shutting down: it stays live for boot recovery.
      if (signal.aborted || closing) return
      if (!(err instanceof AppError)) console.error(`Render ${job.id} failed:`, err)
      await handle.update({ status: 'failed', error: failure(err) })
    } finally {
      if (workDir) await rm(workDir, { recursive: true, force: true })
    }
  }

  const accept: RenderQueue['submit'] = async (job, piece, handle, sctx) => {
    if (closing) throw new AppError('internal', 'The server is shutting down; try again shortly.')
    const queue = waiting.get(sctx.orgId) ?? []
    queue.push({ job, piece, handle, sctx, controller: new AbortController() })
    waiting.set(sctx.orgId, queue)
    pump()
  }

  return {
    /** Read on every `session.get`, so it follows Blender being found or configured. */
    get capabilities() {
      return { blender: o.blender.available }
    },
    submit: accept,
    resume: accept,
    async cancel(jobId: string, sctx: ServiceContext) {
      const queue = waiting.get(sctx.orgId)
      const at = queue?.findIndex((e) => e.job.id === jobId) ?? -1
      if (queue && at >= 0) {
        queue.splice(at, 1)
        if (queue.length === 0) waiting.delete(sctx.orgId)
        return
      }
      const entry = active.get(jobId)
      if (!entry || entry.sctx.orgId !== sctx.orgId) return
      entry.controller.abort(new DOMException('The render was canceled', 'AbortError'))
      let timer: NodeJS.Timeout | undefined
      await Promise.race([
        entry.done,
        new Promise((resolve) => {
          timer = setTimeout(resolve, CANCEL_WAIT_MS)
        }),
      ])
      clearTimeout(timer)
    },
    async dispose() {
      closing = true
      waiting.clear()
      for (const entry of active.values())
        entry.controller.abort(new DOMException('The server is shutting down', 'AbortError'))
      await Promise.allSettled([...active.values()].map((e) => e.done))
    },
  } satisfies RenderQueue
}
