import type { JobStatus } from '@pave/schema'
import { eq } from 'drizzle-orm'
import { putAsset, readAsset } from './assets/assets'
import type { Ctx } from './context'
import * as t from './db/schema'
import { notFound } from './errors'
import type { JobKind } from './events'
import type { JobHandle, ServiceContext, TerminalStatus } from './services'
import { recordUsage } from './usage'

export const isTerminal = (status: string | undefined): status is TerminalStatus =>
  status === 'done' || status === 'failed' || status === 'canceled'

/** Job statuses that may still change; updates are conditioned on these so terminal states stick. */
export const LIVE_STATUSES: JobStatus[] = ['queued', 'running']

async function jobStatus(ctx: Ctx, kind: JobKind, id: string): Promise<JobStatus> {
  const row =
    kind === 'render'
      ? await ctx.repo.renders.first(eq(t.renderJob.id, id))
      : kind === 'shot'
        ? await ctx.repo.shots.first(eq(t.modelShot.id, id))
        : kind === 'production'
          ? await ctx.repo.packages.first(eq(t.productionPackage.id, id))
          : await ctx.repo.meshJobs.first(eq(t.meshJob.id, id))
  if (!row) throw notFound('Job', id)
  return row.status
}

/** The narrow view of a request context that engines receive. */
export function serviceContext(ctx: Ctx): ServiceContext {
  return {
    orgId: ctx.orgId,
    userId: ctx.user.id,
    actor: ctx.actor,
    recordUsage: async (event) => {
      await recordUsage(ctx, event)
    },
    putAsset: (file) => putAsset(ctx, file),
    readAsset: async (id) => {
      const { asset, bytes } = await readAsset(ctx, id)
      return { bytes, name: asset.name, mime: asset.mime }
    },
    invoke: ctx.invoke,
    jobSettled: (kind, id, signal) =>
      new Promise<TerminalStatus>((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason)
        let settled = false
        const finish = (fn: () => void) => {
          if (settled) return
          settled = true
          off()
          signal?.removeEventListener('abort', onAbort)
          fn()
        }
        const onAbort = () => finish(() => reject(signal?.reason))
        // Listen first, then read, so a settle between the two cannot be missed.
        const off = ctx.events.subscribe(ctx.orgId, (e) => {
          if (e.type === 'job.updated' && e.kind === kind && e.id === id && isTerminal(e.status)) {
            const status = e.status
            finish(() => resolve(status))
          }
        })
        signal?.addEventListener('abort', onAbort, { once: true })
        jobStatus(ctx, kind, id).then(
          (status) => {
            if (isTerminal(status)) finish(() => resolve(status))
          },
          (err: unknown) => finish(() => reject(err)),
        )
      }),
  }
}

/** Status and progress as `job.updated` reports them. */
export interface JobState {
  status: JobStatus
  progress: number
}

/** Publishes `job.updated` for a job row. */
export function publishJob(
  ctx: Ctx,
  job: { kind: JobKind; id: string; pieceId: string },
  state: JobState,
): void {
  ctx.events.publish(ctx.orgId, { type: 'job.updated', ...job, ...state })
}

/**
 * A handle through which an engine reports on a job. `persist` writes the patch and returns the
 * job's new state, or undefined when the write was ignored (the job had already settled); every
 * accepted update is published as `job.updated`.
 */
export function jobHandle<Patch>(
  ctx: Ctx,
  job: { kind: JobKind; id: string; pieceId: string },
  persist: (patch: Patch) => Promise<JobState | undefined>,
): JobHandle<Patch> {
  return {
    id: job.id,
    update: async (patch) => {
      const state = await persist(patch)
      if (state) publishJob(ctx, job, state)
    },
  }
}

/** Progress for jobs that do not report it: 1 when done, else 0. */
export const stepProgress = (status: JobStatus): number => (status === 'done' ? 1 : 0)
