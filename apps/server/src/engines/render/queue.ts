/**
 * `renderQueue`: Blender takes, `concurrency` at a time (one by default — Cycles uses every
 * core), served round-robin across organisations so one org's batch cannot starve another's.
 *
 * Cancel and shutdown abort the Blender process and wait (bounded) for it to exit, killing it
 * outright if it ignores the request. A canceled job is marked by the handler; a job cut off by
 * shutdown is left live for boot recovery to resume. Each job works in `<workRoot>/<jobId>/`, so
 * a process a crashed server left behind is found by its path and killed at the next boot.
 */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { canonicalJson, RESOLVED_SCENE_VERSION } from '@pave/render'
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
import { killRenderProcessesIn } from './processes'
import { renderTake } from './take'

export interface RenderQueueOptions {
  blender: BlenderSetup
  /** Resolved per job, so the queue uses whichever geometry engine is registered. */
  geometry: () => GeometryService
  concurrency?: number
  /**
   * Where Blender writes, one folder per job, removed afterwards. Owned by this server alone:
   * whatever is in it at boot is left from a crash, and is killed and deleted. Unset: a private
   * temporary folder, removed on dispose.
   */
  workRoot?: string
  timeoutMs?: (scene: RenderScene) => number
  /** Show Blender's own output in a failed job; only for a local server, whose user runs it. */
  engineOutput?: boolean
}

const MINUTE = 60_000
const TIMEOUT_BY_QUALITY: Record<RenderScene['output']['quality'], number> = {
  preview: 15 * MINUTE,
  standard: 60 * MINUTE,
  final: 180 * MINUTE,
}
const defaultTimeout = (scene: RenderScene) =>
  TIMEOUT_BY_QUALITY[scene.output.quality] * (scene.animation ? 4 : 1)

/** How long `cancel` and shutdown wait for Blender to exit before letting go of the job. */
const STOP_WAIT_MS = 15_000
/** How long Blender has to act on the abort before it is killed outright. */
const KILL_AFTER_MS = 5_000
const PROGRESS_EVERY_MS = 1_000

interface Entry {
  job: RenderJob
  piece: Piece
  handle: JobHandle<RenderJobPatch>
  sctx: ServiceContext
  controller: AbortController
  done?: Promise<void>
  /** Set once the job has a folder to work in. */
  workDir?: string
}

/** Same piece version, request, engine and runner → the same pixels. */
export function cacheKeyOf(job: RenderJob, blenderVersion: string | null): string {
  const key = canonicalJson([
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

/**
 * What a failed take shows. Blender's own words (with this server's paths) help whoever runs a
 * local server; tenants of a shared one get a plain message, and the log keeps the rest.
 */
function failure(err: unknown, engineOutput: boolean): string {
  if (err instanceof AppError) return err.message
  if (engineOutput && err instanceof Error && err.message.startsWith('Blender render'))
    return err.message.slice(0, 2_000)
  return 'The render failed; try again.'
}

const settlesWithin = async (done: Promise<void> | undefined, ms: number): Promise<boolean> => {
  let timer: NodeJS.Timeout | undefined
  const settled = await Promise.race([
    (done ?? Promise.resolve()).then(() => true),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), ms)
    }),
  ])
  clearTimeout(timer)
  return settled
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
  let privateRoot: Promise<string> | null = null
  const workRoot = (): Promise<string> => {
    if (o.workRoot) return Promise.resolve(o.workRoot)
    privateRoot ??= mkdtemp(join(tmpdir(), 'pave-render-'))
    return privateRoot
  }

  /** Kills and deletes whatever a previous run of this server left in its work root. */
  async function sweep(root: string): Promise<void> {
    const left = await readdir(root).catch(() => [])
    if (left.length === 0) return
    const killed = await killRenderProcessesIn(root)
    if (killed.length)
      console.error(`Killed render processes left by a crash: ${killed.join(', ')}`)
    await Promise.all(left.map((name) => rm(join(root, name), { recursive: true, force: true })))
  }

  /** Aborts a running take; kills Blender if it ignores that; waits at most `STOP_WAIT_MS`. */
  async function stop(entry: Entry, reason: string): Promise<void> {
    entry.controller.abort(new DOMException(reason, 'AbortError'))
    if (await settlesWithin(entry.done, KILL_AFTER_MS)) return
    // `@pave/render` sends one SIGTERM and nothing more; a hung Blender would hold the slot.
    if (entry.workDir) await killRenderProcessesIn(entry.workDir)
    await settlesWithin(entry.done, STOP_WAIT_MS - KILL_AFTER_MS)
  }

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
    try {
      await o.blender.probed
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
          sceneHash: cached.sceneHash,
          cacheKey,
        })
        return
      }

      await handle.update({ status: 'running', progress: 0.01, cacheKey })
      const workDir = join(await workRoot(), job.id)
      // A folder left by an attempt before a restart is stale.
      await rm(workDir, { recursive: true, force: true })
      await mkdir(workDir, { recursive: true })
      entry.workDir = workDir
      const { glb, subject } = await o
        .geometry()
        .renderInput(piece.design, sctx, { pieceId: piece.id, signal })
      if (subject.parts.length === 0 && subject.stones.length === 0)
        throw new AppError('conflict', 'Nothing to render: the piece has no metal or stones.')
      let reported = 0
      const result = await renderTake({
        scene: job.requestedScene,
        autoTune: job.autoTune,
        glb: glb.bytes,
        subject,
        design: { pieceId: job.pieceId, version: job.sourceVersion },
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
        sceneHash: result.sceneHash,
      })
    } catch (err) {
      // Canceled: the handler marks it. Shutting down: it stays live for boot recovery.
      if (signal.aborted || closing) return
      console.error(`Render ${job.id} failed:`, err)
      await handle.update({ status: 'failed', error: failure(err, o.engineOutput ?? false) })
    } finally {
      if (entry.workDir) await rm(entry.workDir, { recursive: true, force: true })
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
    async ready() {
      if (o.workRoot) await sweep(o.workRoot)
      await o.blender.ready
    },
    submit: accept,
    // Back to `queued` until it really starts: the progress it had belongs to a process that is gone.
    async resume(job, piece, handle, sctx) {
      await handle.update({ status: 'queued', progress: 0 })
      await accept(job, piece, handle, sctx)
    },
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
      await stop(entry, 'The render was canceled')
    },
    async dispose() {
      closing = true
      waiting.clear()
      await Promise.all([...active.values()].map((e) => stop(e, 'The server is shutting down')))
      if (privateRoot) await rm(await privateRoot, { recursive: true, force: true })
    },
  } satisfies RenderQueue
}
