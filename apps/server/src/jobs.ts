/**
 * Job rows written by engines: the sticky updaters (terminal states stick) and the handles
 * through which a render queue, image-to-3D provider or on-model pipeline reports on a job —
 * when it is submitted, and again when it is resumed after a restart (see `Runtime.recover`).
 */
import { COUNTED_EXPORT_FORMATS } from '@pave/schema'
import { and, eq, inArray } from 'drizzle-orm'
import type { Ctx } from './context'
import * as t from './db/schema'
import { AppError } from './errors'
import { packageKey, renderKey, settle } from './plans'
import { isTerminal, jobHandle, LIVE_STATUSES, stepProgress } from './service-context'
import type {
  JobHandle,
  MeshJobPatch,
  ModelShotPatch,
  ProductionPackagePatch,
  RenderJobPatch,
} from './services'
import { toMicros } from './usage'

type JobRef = { id: string; pieceId: string }

/**
 * Writes a render update unless the job has already settled. The update that settles a Blender
 * take also settles its plan claim (browser takes never claim one): a finished take is counted;
 * a failed or canceled one, or one served from the render cache (no Blender time: the queue
 * writes it as done in 0 seconds), gives its render back.
 */
export async function updateRender(ctx: Ctx, id: string, patch: RenderJobPatch) {
  const [row] = await ctx.repo.renders.update(
    and(eq(t.renderJob.id, id), inArray(t.renderJob.status, LIVE_STATUSES))!,
    { ...patch, ...(isTerminal(patch.status) ? { finishedAt: new Date() } : {}) },
  )
  if (row && row.engine === 'blender' && isTerminal(row.status)) {
    const delivered = row.status === 'done' && row.seconds !== 0
    await settle(ctx, renderKey(row.id), delivered ? 'used' : 'released')
  }
  return row
}

/** Writes an image-to-3D update unless the job has already settled. */
export async function updateMeshJob(ctx: Ctx, id: string, { costUsd, ...patch }: MeshJobPatch) {
  const [row] = await ctx.repo.meshJobs.update(
    and(eq(t.meshJob.id, id), inArray(t.meshJob.status, LIVE_STATUSES))!,
    {
      ...patch,
      ...(costUsd === undefined ? {} : { costMicros: costUsd === null ? null : toMicros(costUsd) }),
      ...(isTerminal(patch.status) ? { finishedAt: new Date() } : {}),
    },
  )
  return row
}

/** Writes an on-model shot update unless the shot has already settled. */
export async function updateShot(ctx: Ctx, id: string, patch: ModelShotPatch) {
  const [row] = await ctx.repo.shots.update(
    and(eq(t.modelShot.id, id), inArray(t.modelShot.status, LIVE_STATUSES))!,
    patch,
  )
  return row
}

/** Writes a production package update unless the build has already settled. */
export async function updatePackage(ctx: Ctx, id: string, patch: ProductionPackagePatch) {
  const { progress: _published, ...stored } = patch
  const live = and(
    eq(t.productionPackage.id, id),
    inArray(t.productionPackage.status, LIVE_STATUSES),
  )!
  // A progress-only update writes nothing; it is still refused once the build has settled.
  if (Object.keys(stored).length === 0) return ctx.repo.packages.first(live)
  const [row] = await ctx.repo.packages.update(live, stored)
  // A package counts as one export only if it was delivered with a Rhino or STEP file in it.
  if (row && isTerminal(row.status))
    await settle(
      ctx,
      packageKey(row.id),
      row.status === 'done' && hasCadFile(row.manifest) ? 'used' : 'released',
    )
  return row
}

/** Whether a package manifest lists a Rhino (.3dm) or STEP file. */
function hasCadFile(manifest: Record<string, unknown> | null): boolean {
  const files = (manifest as { files?: { path?: unknown }[] } | null)?.files ?? []
  return files.some(
    (f) =>
      typeof f.path === 'string' &&
      COUNTED_EXPORT_FORMATS.some((ext) => (f.path as string).toLowerCase().endsWith(`.${ext}`)),
  )
}

/** The handle for render job `job`; each accepted update is published as `job.updated`. */
export const renderHandle = (ctx: Ctx, job: JobRef): JobHandle<RenderJobPatch> =>
  jobHandle(ctx, { kind: 'render', ...job }, (patch) => updateRender(ctx, job.id, patch))

/** The handle for image-to-3D job `job`. */
export const meshHandle = (ctx: Ctx, job: JobRef): JobHandle<MeshJobPatch> =>
  jobHandle(ctx, { kind: 'mesh3d', ...job }, (patch) => updateMeshJob(ctx, job.id, patch))

/** The handle for production package `job`; progress is published, never stored. */
export const packageHandle = (ctx: Ctx, job: JobRef): JobHandle<ProductionPackagePatch> =>
  jobHandle(ctx, { kind: 'production', ...job }, async (patch) => {
    const row = await updatePackage(ctx, job.id, patch)
    return row && { status: row.status, progress: patch.progress ?? stepProgress(row.status) }
  })

/** The handle for on-model shot `job` (progress is 0 until done). */
export const shotHandle = (ctx: Ctx, job: JobRef): JobHandle<ModelShotPatch> =>
  jobHandle(ctx, { kind: 'shot', ...job }, async (patch) => {
    const row = await updateShot(ctx, job.id, patch)
    return row && { status: row.status, progress: stepProgress(row.status) }
  })

/** What a job shows when its engine threw: the message of a safe error, else a generic one. */
export const engineError = (err: unknown): string =>
  err instanceof AppError ? err.message : 'The engine could not take this job; try again later.'

/**
 * Hands a queued job to its engine. If the engine rejects, the job is marked `failed` (so it
 * never sits queued for ever) and the error is rethrown to the caller.
 */
export async function submitJob(
  handle: JobHandle<{ status?: 'failed'; error?: string | null }>,
  submit: () => Promise<void>,
): Promise<void> {
  try {
    await submit()
  } catch (err) {
    if (!(err instanceof AppError)) console.error(`Submitting job ${handle.id} failed:`, err)
    await handle.update({ status: 'failed', error: engineError(err) })
    throw err
  }
}

/**
 * Asks an engine to stop a job before the row is marked canceled. A cancel the engine cannot
 * carry out (it never accepted the job, or is down) is logged and does not block the cancel.
 */
export async function stopJob(id: string, cancel: () => Promise<void>): Promise<void> {
  try {
    await cancel()
  } catch (err) {
    console.error(`Canceling job ${id} with its engine failed; marking it canceled anyway:`, err)
  }
}
