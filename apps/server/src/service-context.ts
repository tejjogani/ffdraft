import { putAsset, readAsset } from './assets/assets'
import type { Ctx } from './context'
import type { JobKind } from './events'
import type { JobHandle, ServiceContext } from './services'
import { recordUsage } from './usage'

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
  }
}

/** A handle through which an engine reports on a job; every update is published as `job.updated`. */
export function jobHandle<Patch>(
  ctx: Ctx,
  job: { kind: JobKind; id: string; pieceId: string },
  persist: (patch: Patch) => Promise<unknown>,
): JobHandle<Patch> {
  return {
    id: job.id,
    update: async (patch) => {
      await persist(patch)
      ctx.events.publish(ctx.orgId, {
        type: 'job.updated',
        kind: job.kind,
        id: job.id,
        pieceId: job.pieceId,
      })
    },
  }
}

export const isTerminal = (status: string | undefined) =>
  status === 'done' || status === 'failed' || status === 'canceled'
