/**
 * Boot recovery: the one place that reads across organisations. Jobs and assistant runs left
 * unfinished by a restart are handed back to their services in the context of the user they
 * belong to; work nobody can resume is failed as interrupted rather than left live for ever.
 */
import { type Actor, ANIMATION_RENDER_COST, type JobStatus, type Run } from '@pave/schema'
import { and, eq, inArray } from 'drizzle-orm'
import type { Ctx } from './context'
import type { Db } from './db/client'
import * as t from './db/schema'
import { toMeshJob } from './handlers/mesh3d'
import { toBrandModel, toShots } from './handlers/models'
import { toPiece } from './handlers/pieces'
import { toPackage } from './handlers/production'
import { toRenderJobs } from './handlers/render'
import { engineError, meshHandle, packageHandle, renderHandle, shotHandle } from './jobs'
import { getModel, getPiece } from './lookups'
import { packageKey, releaseOrphan, renderKeys } from './plans'
import type { Runtime } from './runtime'
import { LIVE_STATUSES, serviceContext } from './service-context'
import { finishRun, toRun } from './traces'

/** A job or run that was live when the server stopped, with whose it is and when it began. */
export type Unfinished = { createdAt: Date } & (
  | { kind: 'render'; id: string; orgId: string; userId: string | null; actor: Actor }
  | {
      kind: 'mesh3d'
      id: string
      orgId: string
      userId: string
      actor: Actor
      providerJobId: string | null
    }
  | { kind: 'shot'; id: string; orgId: string; userId: string | null; actor: Actor | null }
  | { kind: 'production'; id: string; orgId: string; userId: string; actor: null }
  | { kind: 'run'; id: string; orgId: string; userId: string; status: Run['status'] }
)

const INTERRUPTED = 'Interrupted by a server restart; run it again.'
const LIVE_RUNS: Run['status'][] = ['running', 'awaiting-approval', 'waiting']

/**
 * Live work across all orgs: Blender renders, image-to-3D jobs, on-model shots and production
 * packages that are queued or running, and runs that are running or awaiting approval. Browser renders are not
 * listed: the studio window that queued one may still deliver it.
 */
export async function unfinished(db: Db): Promise<Unfinished[]> {
  const [renders, meshJobs, shots, packages, runs] = await Promise.all([
    db
      .select({
        id: t.renderJob.id,
        orgId: t.renderJob.orgId,
        createdAt: t.renderJob.createdAt,
        userId: t.renderJob.createdBy,
        actor: t.renderJob.actor,
      })
      .from(t.renderJob)
      .where(and(inArray(t.renderJob.status, LIVE_STATUSES), eq(t.renderJob.engine, 'blender')))
      .orderBy(t.renderJob.createdAt),
    db
      .select({
        id: t.meshJob.id,
        orgId: t.meshJob.orgId,
        createdAt: t.meshJob.createdAt,
        userId: t.meshJob.createdBy,
        actor: t.meshJob.actor,
        providerJobId: t.meshJob.providerJobId,
      })
      .from(t.meshJob)
      .where(inArray(t.meshJob.status, LIVE_STATUSES))
      .orderBy(t.meshJob.createdAt),
    db
      .select({
        id: t.modelShot.id,
        orgId: t.modelShot.orgId,
        createdAt: t.modelShot.createdAt,
        userId: t.modelShot.createdBy,
        actor: t.modelShot.actor,
      })
      .from(t.modelShot)
      .where(inArray(t.modelShot.status, LIVE_STATUSES))
      .orderBy(t.modelShot.createdAt),
    db
      .select({
        id: t.productionPackage.id,
        orgId: t.productionPackage.orgId,
        createdAt: t.productionPackage.createdAt,
        userId: t.productionPackage.createdBy,
      })
      .from(t.productionPackage)
      .where(inArray(t.productionPackage.status, LIVE_STATUSES))
      .orderBy(t.productionPackage.createdAt),
    db
      .select({
        id: t.agentRun.id,
        orgId: t.agentRun.orgId,
        createdAt: t.agentRun.startedAt,
        userId: t.agentRun.userId,
        status: t.agentRun.status,
      })
      .from(t.agentRun)
      .where(inArray(t.agentRun.status, LIVE_RUNS))
      .orderBy(t.agentRun.startedAt),
  ])
  // Oldest first, so queues fill again in the order the work was asked for.
  return [
    ...renders.map((r) => ({ kind: 'render' as const, ...r })),
    ...meshJobs.map((r) => ({ kind: 'mesh3d' as const, ...r })),
    ...shots.map((r) => ({ kind: 'shot' as const, ...r })),
    ...packages.map((r) => ({ kind: 'production' as const, actor: null, ...r })),
    ...runs.map((r) => ({ kind: 'run' as const, ...r })),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
}

/** Fails a job or run without a user context (its user is unknown or no longer a member). */
async function failOrphan(db: Db, item: Unfinished): Promise<void> {
  const failed = { status: 'failed' as JobStatus, error: INTERRUPTED }
  const finishedAt = new Date()
  switch (item.kind) {
    case 'render':
      await db
        .update(t.renderJob)
        .set({ ...failed, finishedAt })
        .where(and(eq(t.renderJob.id, item.id), inArray(t.renderJob.status, LIVE_STATUSES)))
      // Its scene is not read here: give back every key a take of either kind may hold.
      for (const key of renderKeys(item.id, ANIMATION_RENDER_COST))
        await releaseOrphan(db, item.orgId, key)
      return
    case 'mesh3d':
      await db
        .update(t.meshJob)
        .set({ ...failed, finishedAt })
        .where(and(eq(t.meshJob.id, item.id), inArray(t.meshJob.status, LIVE_STATUSES)))
      return
    case 'shot':
      await db
        .update(t.modelShot)
        .set(failed)
        .where(and(eq(t.modelShot.id, item.id), inArray(t.modelShot.status, LIVE_STATUSES)))
      return
    case 'production':
      await db
        .update(t.productionPackage)
        .set({ status: 'failed' })
        .where(
          and(
            eq(t.productionPackage.id, item.id),
            inArray(t.productionPackage.status, LIVE_STATUSES),
          ),
        )
      await releaseOrphan(db, item.orgId, packageKey(item.id))
      return
    case 'run':
      await db
        .update(t.agentRun)
        .set({
          status: 'failed',
          errorCode: 'interrupted',
          error: INTERRUPTED,
          endedAt: finishedAt,
        })
        .where(and(eq(t.agentRun.id, item.id), inArray(t.agentRun.status, LIVE_RUNS)))
      return
  }
}

/** Hands one item to its service, or fails it when no service can take it up again. */
async function resumeOne(ctx: Ctx, item: Unfinished): Promise<void> {
  const sctx = serviceContext(ctx)
  const { services } = ctx
  switch (item.kind) {
    case 'render': {
      const row = await ctx.repo.renders.first(eq(t.renderJob.id, item.id))
      if (!row) return
      const [job] = await toRenderJobs(ctx, [row])
      const handle = renderHandle(ctx, job!)
      const queue = services.optional('renderQueue')
      if (!queue?.resume) return handle.update({ status: 'failed', error: INTERRUPTED })
      const piece = await toPiece(ctx, await getPiece(ctx, row.pieceId))
      return queue.resume(job!, piece, handle, sctx).catch((err: unknown) => {
        console.error(`Resuming render ${item.id} failed:`, err)
        return handle.update({ status: 'failed', error: engineError(err) })
      })
    }
    case 'mesh3d': {
      const row = await ctx.repo.meshJobs.first(eq(t.meshJob.id, item.id))
      if (!row) return
      const job = toMeshJob(row)
      const handle = meshHandle(ctx, job)
      const mesh3d = services.optional('mesh3d')
      if (!mesh3d?.resume) return handle.update({ status: 'failed', error: INTERRUPTED })
      return mesh3d
        .resume(job, handle, sctx, { providerJobId: row.providerJobId })
        .catch((err: unknown) => {
          console.error(`Resuming image-to-3D job ${item.id} failed:`, err)
          return handle.update({ status: 'failed', error: engineError(err) })
        })
    }
    case 'shot': {
      const row = await ctx.repo.shots.first(eq(t.modelShot.id, item.id))
      if (!row) return
      const [shot] = await toShots(ctx, [row])
      const handle = shotHandle(ctx, shot!)
      const onModel = services.optional('onModel')
      if (!onModel?.resumeShot) return handle.update({ status: 'failed', error: INTERRUPTED })
      const subject = {
        model: toBrandModel(await getModel(ctx, row.modelId)),
        piece: await toPiece(ctx, await getPiece(ctx, row.pieceId)),
      }
      return onModel.resumeShot(shot!, subject, handle, sctx).catch((err: unknown) => {
        console.error(`Resuming on-model image ${item.id} failed:`, err)
        return handle.update({ status: 'failed', error: engineError(err) })
      })
    }
    case 'production': {
      const row = await ctx.repo.packages.first(eq(t.productionPackage.id, item.id))
      if (!row) return
      const pkg = toPackage(row)
      const handle = packageHandle(ctx, pkg)
      const packager = services.optional('production')
      // Packages from before the request was stored cannot be rebuilt as asked.
      if (!packager?.resume || !row.request) return handle.update({ status: 'failed' })
      const request = {
        ...row.request,
        piece: await toPiece(ctx, await getPiece(ctx, row.pieceId)),
      }
      return packager.resume(pkg, request, handle, sctx).catch((err: unknown) => {
        console.error(`Resuming production package ${item.id} failed:`, err)
        return handle.update({
          status: 'failed',
          manifest: { error: { message: engineError(err) } },
        })
      })
    }
    case 'run': {
      const assistant = services.optional('assistant')
      const row = await ctx.repo.runs.first(eq(t.agentRun.id, item.id))
      if (!row) return
      // A runtime that cannot take the run up again leaves it as no runtime would: a run still
      // cut off mid-step is failed, and one awaiting approval keeps waiting.
      const resumed = assistant?.resume
        ? await assistant.resume(toRun(row), sctx).then(
            () => true,
            (err: unknown) => {
              console.error(`Resuming run ${item.id} failed:`, err)
              return false
            },
          )
        : false
      if (resumed) return
      const now = assistant?.resume ? await ctx.repo.runs.first(eq(t.agentRun.id, item.id)) : row
      if (now?.status === 'running')
        await finishRun(ctx, row.id, {
          status: 'failed',
          errorCode: 'interrupted',
          error: INTERRUPTED,
        })
    }
  }
}

/**
 * Takes up every unfinished job and run once, at boot. Each is resumed as the user it belongs
 * to (and, for jobs, the actor that queued it), so metering and attribution are unchanged.
 */
export async function recover(runtime: Runtime, db: Db): Promise<void> {
  for (const item of await unfinished(db)) {
    try {
      if (item.userId === null) {
        await failOrphan(db, item)
        continue
      }
      const actor = item.kind === 'run' ? undefined : (item.actor ?? undefined)
      const ctx = await runtime
        .context({ userId: item.userId, orgId: item.orgId, actor })
        .catch(() => null)
      if (ctx) await resumeOne(ctx, item)
      else await failOrphan(db, item)
    } catch (err) {
      console.error(`Recovering ${item.kind} ${item.id} failed:`, err)
    }
  }
}
