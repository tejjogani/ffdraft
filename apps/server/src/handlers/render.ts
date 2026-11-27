import {
  BROWSER_TAKE_SECONDS,
  DEFAULT_SHOTS,
  estimateTakeSeconds,
  rateFrom,
  shotChangeRefusal,
} from '@pave/render'
import {
  type PieceKind,
  type RenderJob,
  RenderSceneSchema,
  renderCost,
  type SavedScene,
} from '@pave/schema'
import { and, asc, desc, eq, gt, inArray, isNull, lt, max, type SQL } from 'drizzle-orm'
import { captureShots, suggestShots } from '../cinema'
import { type Ctx, publish } from '../context'
import * as t from '../db/schema'
import { BLENDER_INSTALL_UNAVAILABLE } from '../engines/render/blender'
import { badRequest, conflict, forbidden, notFound } from '../errors'
import { createId } from '../ids'
import { renderHandle, stopJob, submitJob, updateRender } from '../jobs'
import { ensure, ensureAll, getPiece, getRender, getScene } from '../lookups'
import { claim, renderKeys, settle } from '../plans'
import { noteShotChange, recordRenderFeedback, shotAgent, takeAgent } from '../render-feedback'
import { changeScene, patchScene, revertScene, sceneHistory } from '../scenes'
import { isTerminal, publishJob, serviceContext } from '../service-context'
import { toPiece } from './pieces'
import type { HandlerGroup } from './types'

function installer(ctx: Ctx, requireLocal: boolean) {
  if (
    ctx.actor.type !== 'user' ||
    ctx.localRenderInstall === undefined ||
    (requireLocal && (!ctx.localRenderInstall || ctx.authMode !== 'local'))
  )
    throw forbidden('Blender setup is only available to the owner in a local Pavé window.')
  return ctx.localRenderInstall ? ctx.services.optional('renderEngine') : null
}

type RenderRow = typeof t.renderJob.$inferSelect
type SceneRow = typeof t.renderScene.$inferSelect

export const toRenderJob = (r: RenderRow, pieceVersion: number): RenderJob => ({
  id: r.id,
  pieceId: r.pieceId,
  title: r.title,
  scene: r.scene,
  requestedScene: r.requestedScene ?? r.scene,
  sceneId: r.sceneId,
  groupId: r.groupId,
  variantLabel: r.variantLabel,
  purpose: r.purpose,
  engine: r.engine,
  autoTune: r.autoTune,
  status: r.status,
  progress: r.progress,
  sourceVersion: r.sourceVersion,
  sceneHash: r.sceneHash,
  stale: r.sourceVersion < pieceVersion,
  assetIds: r.assetIds,
  critique: r.critique ?? null,
  retryOf: r.retryOf,
  note: r.note,
  starred: r.starred,
  seconds: r.seconds,
  device: r.device,
  error: r.error,
  actor: r.actor,
  createdBy: r.createdBy,
  createdAt: r.createdAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
})

/** Render jobs with `stale` computed against their pieces' current versions. */
export async function toRenderJobs(ctx: Ctx, rows: RenderRow[]): Promise<RenderJob[]> {
  if (rows.length === 0) return []
  const versions = new Map(
    (
      await ctx.repo.pieces.select(
        { id: t.piece.id, version: t.piece.version },
        inArray(t.piece.id, [...new Set(rows.map((r) => r.pieceId))]),
      )
    ).map((p) => [p.id, p.version]),
  )
  return rows.map((r) => toRenderJob(r, versions.get(r.pieceId) ?? r.sourceVersion))
}

const one = async (ctx: Ctx, row: RenderRow) => (await toRenderJobs(ctx, [row]))[0]!

const toSavedScene = (r: SceneRow): SavedScene => ({
  id: r.id,
  pieceId: r.pieceId,
  title: r.title,
  scene: r.scene,
  position: r.position,
  takeId: r.takeId,
  updatedAt: r.updatedAt.toISOString(),
})

const announce = (ctx: Ctx, row: RenderRow) =>
  publishJob(ctx, { kind: 'render', id: row.id, pieceId: row.pieceId }, row)

const sceneScope = (pieceId: string | null): SQL =>
  pieceId === null ? isNull(t.renderScene.pieceId) : eq(t.renderScene.pieceId, pieceId)

const savedScenes = (ctx: Ctx, pieceId: string | null) =>
  ctx.repo.scenes.many({
    where: sceneScope(pieceId),
    orderBy: [asc(t.renderScene.position), asc(t.renderScene.createdAt)],
  })

/** First writes serialize at the piece, even before it has a shot row to lock. */
function withShotList<R>(
  ctx: Ctx,
  pieceId: string,
  work: (tx: Ctx, kind: PieceKind) => Promise<R>,
) {
  return ctx.repo.transaction(async (repo) => {
    const [piece] = await repo.pieces
      .select({ kind: t.piece.kind }, eq(t.piece.id, pieceId))
      .for('update')
    if (!piece) throw notFound('Piece', pieceId)
    return work({ ...ctx, repo }, piece.kind)
  })
}

const announceScene = (ctx: Ctx, row: SceneRow) =>
  publish(ctx, { type: 'scene.updated', sceneId: row.id, pieceId: row.pieceId })

function canSetupBlender(ctx: Ctx): boolean {
  return (
    ctx.localRenderInstall === true &&
    ctx.authMode === 'local' &&
    ctx.role === 'owner' &&
    ctx.actor.type !== 'system' &&
    ctx.services.optional('renderEngine')?.installStatus?.().supported === true
  )
}

/** Auto uses Blender when available or when this local owner can install it. */
export function engineFor(
  ctx: Ctx,
  asked: 'auto' | 'blender' | 'browser',
  purpose: RenderJob['purpose'] = 'take',
): 'blender' | 'browser' {
  if (asked !== 'auto') return asked
  return ctx.services.isConfigured('renderQueue') &&
    (ctx.services.capabilities().blender || (purpose === 'take' && canSetupBlender(ctx)))
    ? 'blender'
    : 'browser'
}

/** This machine's recent finished Blender takes (not cache hits), for the time estimate. */
async function renderHistory(ctx: Ctx) {
  const rows = await ctx.repo.renders.many({
    where: and(
      eq(t.renderJob.engine, 'blender'),
      eq(t.renderJob.status, 'done'),
      gt(t.renderJob.seconds, 0),
    ),
    orderBy: desc(t.renderJob.finishedAt),
    limit: 20,
  })
  return rows.map((r) => ({
    scene: r.requestedScene ?? r.scene,
    autoTune: r.autoTune,
    seconds: r.seconds ?? 0,
    device: r.device,
  }))
}

/**
 * A take put in a shot's place in the set: kept, if the assistant rendered it; otherwise the
 * assistant's take it replaced (the shot's newest, or the one swapped in before) was swapped out.
 */
async function noteSwap(ctx: Ctx, shot: SceneRow, take: RenderRow): Promise<void> {
  if (ctx.actor.type !== 'user') return
  const mine = takeAgent(take)
  if (mine) {
    await recordRenderFeedback(ctx, {
      agent: mine,
      kind: 'kept',
      target: `render:${take.id}`,
      detail: `Swapped the take “${take.title}”, which the assistant rendered, into the set for “${shot.title}”.`,
    })
    return
  }
  const others = await ctx.repo.renders.many({
    where: and(eq(t.renderJob.sceneId, shot.id), eq(t.renderJob.status, 'done')),
    orderBy: desc(t.renderJob.createdAt),
    limit: 10,
  })
  const replaced = others.find((r) => r.id !== take.id && takeAgent(r))
  const agent = replaced && takeAgent(replaced)
  if (agent)
    await recordRenderFeedback(ctx, {
      agent,
      kind: 'swapped',
      target: `render:${replaced.id}`,
      detail: `Put another take in the set for “${shot.title}” instead of the assistant’s.`,
    })
}

/** A person rendered again what the assistant rendered (`retryOf`) or set up (the shot). */
async function noteRerender(ctx: Ctx, row: RenderRow, shot: SceneRow | null): Promise<void> {
  if (ctx.actor.type !== 'user') return
  const original = row.retryOf
    ? await ctx.repo.renders.first(eq(t.renderJob.id, row.retryOf))
    : null
  const fromTake = original ? takeAgent(original) : null
  if (original && fromTake) {
    await recordRenderFeedback(ctx, {
      agent: fromTake,
      kind: 'rerendered',
      target: `render:${original.id}`,
      detail: `Rendered “${original.title}” again by hand${row.note ? ` (${row.note})` : ''}.`,
    })
    return
  }
  const fromShot = shot ? await shotAgent(ctx, shot) : null
  if (shot && fromShot)
    await recordRenderFeedback(ctx, {
      agent: fromShot,
      kind: 'rerendered',
      target: `scene:${shot.id}`,
      detail: `Rendered the shot “${shot.title}”, which the assistant set up, by hand.`,
    })
}

export const render: HandlerGroup<'renders' | 'scenes'> = {
  'scenes.list': async (ctx, { pieceId }) => {
    await ensure(getPiece, ctx, pieceId)
    return (await savedScenes(ctx, pieceId)).map(toSavedScene)
  },

  'scenes.create': async (ctx, input) => {
    const create = async ({ repo }: Ctx) => {
      const [last] = await repo.scenes.select(
        { position: max(t.renderScene.position) },
        sceneScope(input.pieceId),
      )
      return repo.scenes.insert({
        id: createId('scn'),
        pieceId: input.pieceId,
        title: input.title,
        scene: input.scene,
        position: input.position ?? (last?.position ?? 0) + 1,
        createdBy: ctx.user.id,
        actor: ctx.actor,
      })
    }
    const row =
      input.pieceId === null ? await create(ctx) : await withShotList(ctx, input.pieceId, create)
    announceScene(ctx, row)
    return toSavedScene(row)
  },

  'scenes.ensureDefaults': async (ctx, { pieceId, edit }) => {
    const result = await withShotList(ctx, pieceId, async (tx, kind) => {
      const existing = await savedScenes(tx, pieceId)
      if (existing.length) return { rows: existing, created: false, editedId: null }

      const presets = DEFAULT_SHOTS(kind)
      const index = edit ? presets.findIndex(({ key }) => key === edit.key) : -1
      if (edit && index < 0) throw badRequest('That default shot is no longer available.')
      const rows = await tx.repo.scenes.insertMany(
        presets.map((preset, i) => ({
          id: createId('scn'),
          pieceId,
          title: preset.title,
          scene: RenderSceneSchema.parse(preset.scene),
          position: i + 1,
          createdBy: ctx.user.id,
          actor: ctx.actor,
        })),
      )
      rows.sort((a, b) => a.position - b.position)
      if (edit) {
        const { row } = await changeScene(tx, rows[index]!.id, async (current) => ({
          scene: patchScene(current.scene, edit.patch),
        }))
        rows[index] = row
      }
      return { rows, created: true, editedId: rows[index]?.id ?? null }
    })
    if (result.created) for (const row of result.rows) announceScene(ctx, row)
    return { shots: result.rows.map(toSavedScene), editedId: result.editedId }
  },

  'scenes.update': async (ctx, { id, patch, takeId, ...rest }) => {
    let swappedIn: RenderRow | null = null
    if (takeId) {
      const current = await getScene(ctx, id)
      const take = await getRender(ctx, takeId)
      if (take.pieceId !== current.pieceId) throw badRequest('That take is of another piece')
      if (take.status !== 'done') throw conflict('Only a finished take can go in the set')
      swappedIn = take
    }
    let before: SceneRow | null = null
    const { row } = await changeScene(ctx, id, async (current) => {
      before = current
      return {
        scene: patch ? patchScene(current.scene, patch) : current.scene,
        fields: { ...rest, ...(takeId === undefined ? {} : { takeId }) },
      }
    })
    announceScene(ctx, row)
    if (before) await noteShotChange(ctx, row, (before as SceneRow).scene, row.scene)
    if (swappedIn) await noteSwap(ctx, row, swappedIn)
    return toSavedScene(row)
  },

  'scenes.suggest': (ctx, input) => suggestShots(ctx, input, ctx.signal),

  'scenes.capture': (ctx, input) => captureShots(ctx, input, ctx.signal),

  'scenes.history': (ctx, { id, limit }) => sceneHistory(ctx, id, limit),

  'scenes.revert': async (ctx, { id, changeId }) => {
    const { row, change } = await revertScene(ctx, id, changeId)
    announceScene(ctx, row)
    return { scene: toSavedScene(row), change: change! }
  },

  'scenes.delete': async (ctx, { id }) => {
    const row = await getScene(ctx, id)
    // Read before the delete: the shot's history goes with it.
    const agent = ctx.actor.type === 'user' ? await shotAgent(ctx, row) : null
    await ctx.repo.scenes.delete(eq(t.renderScene.id, id))
    announceScene(ctx, row)
    if (agent)
      await recordRenderFeedback(ctx, {
        agent,
        kind: 'removed',
        target: `scene:${row.id}`,
        detail: `Deleted the shot “${row.title}”, which the assistant set up.`,
      })
    return { ok: true }
  },

  'renders.list': async (ctx, input) => {
    const before = input.before === undefined ? undefined : new Date(input.before)
    if (before && Number.isNaN(before.getTime())) throw badRequest('`before` must be a date')
    const rows = await ctx.repo.renders.many({
      where: and(
        eq(t.renderJob.purpose, input.purpose),
        input.pieceId ? eq(t.renderJob.pieceId, input.pieceId) : undefined,
        input.status ? inArray(t.renderJob.status, input.status) : undefined,
        before ? lt(t.renderJob.createdAt, before) : undefined,
      ),
      orderBy: desc(t.renderJob.createdAt),
      limit: input.limit,
    })
    return toRenderJobs(ctx, rows)
  },

  'renders.get': async (ctx, { id }) => one(ctx, await getRender(ctx, id)),

  'renders.estimate': async (ctx, input) => {
    const piece = await getPiece(ctx, input.pieceId)
    const scenes = await Promise.all(
      input.takes.map(async (take) => {
        if (take.scene) return take.scene
        const saved = await getScene(ctx, take.sceneId!)
        if (saved.pieceId !== null && saved.pieceId !== piece.id)
          throw badRequest('That shot belongs to another piece')
        return saved.scene
      }),
    )
    const engine = engineFor(ctx, input.engine)
    if (engine === 'browser')
      return {
        engine,
        seconds: scenes.length * BROWSER_TAKE_SECONDS,
        takes: scenes.map(() => BROWSER_TAKE_SECONDS),
        basis: 'browser' as const,
        device: null,
      }
    // The device Cycles reported last: the estimate learns from that device's takes.
    const device =
      (await ctx.services.optional('renderEngine')?.status(serviceContext(ctx)))?.device ?? null
    const rate = rateFrom(await renderHistory(ctx), device)
    const takes = scenes.map((s) => Math.round(estimateTakeSeconds(s, input.autoTune, rate)))
    return {
      engine,
      seconds: takes.reduce((a, b) => a + b, 0),
      takes,
      basis: rate.basis,
      device,
    }
  },

  // Blender jobs go to the render queue; browser jobs wait for the user's studio to render them
  // and deliver the result with renders.complete.
  'renders.create': async (ctx, input) => {
    const piece = await getPiece(ctx, input.pieceId)
    if (input.baseVersion !== undefined && piece.version !== input.baseVersion)
      throw conflict('The saved design changed. Review the latest version and render again.')
    const saved = input.sceneId ? await getScene(ctx, input.sceneId) : null
    if (saved && saved.pieceId !== null && saved.pieceId !== piece.id)
      throw badRequest('That shot belongs to another piece')
    await ensure(getRender, ctx, input.retryOf)
    // Asking for Blender without a render queue is refused up front (501), before any row exists.
    if (input.engine === 'blender') ctx.services.require('renderQueue')
    const engine = engineFor(ctx, input.engine, input.purpose)
    const setupBlender =
      engine === 'blender' &&
      input.purpose === 'take' &&
      !ctx.services.capabilities().blender &&
      canSetupBlender(ctx)
    const scene = input.scene ?? saved!.scene
    // A locked shot is rendered as it is framed: the assistant cannot re-frame it in passing.
    if (saved && input.scene && ctx.actor.type === 'agent') {
      const refusal = shotChangeRefusal(saved.scene, input.scene, 'agent')
      if (refusal) throw conflict(refusal)
    }
    const id = createId('rnd')
    // A Blender take claims its render before anything is queued; the take settling settles
    // the claim (updateRender). Browser takes are previews and never count.
    // An animation counts as more than one render: one claim per render it counts as, all or none.
    const keys = renderKeys(id, renderCost(scene))
    if (engine === 'blender') {
      const taken: string[] = []
      try {
        for (const key of keys) {
          await claim(ctx, { allowance: 'render', key, subject: 'render', pieceId: piece.id })
          taken.push(key)
        }
      } catch (err) {
        for (const key of taken) await settle(ctx, key, 'released')
        throw err
      }
    }
    const row = await ctx.repo.renders
      .insert({
        id,
        pieceId: piece.id,
        title: input.title ?? saved?.title ?? piece.title,
        scene,
        requestedScene: scene,
        sceneId: saved?.id ?? null,
        groupId: input.groupId ?? null,
        variantLabel: input.variantLabel ?? null,
        purpose: input.purpose,
        engine,
        autoTune: input.autoTune,
        status: 'queued',
        sourceVersion: piece.version,
        retryOf: input.retryOf ?? null,
        note: input.note ?? null,
        actor: ctx.actor,
        createdBy: ctx.user.id,
      })
      .catch(async (err: unknown) => {
        if (engine === 'blender') for (const key of keys) await settle(ctx, key, 'released')
        throw err
      })
    const job = await one(ctx, row)
    announce(ctx, row)
    await noteRerender(ctx, row, saved)
    if (engine === 'blender') {
      const handle = renderHandle(ctx, job)
      const subject = await toPiece(ctx, piece)
      await submitJob(handle, () =>
        ctx.services
          .get('renderQueue')
          .submit(job, subject, handle, serviceContext(ctx), setupBlender),
      )
      if (setupBlender) publish(ctx, { type: 'render.installRequested' }, { userId: ctx.user.id })
    }
    return job
  },

  'renders.complete': async (ctx, { id, assetIds, error, seconds, device, sceneHash }) => {
    const job = await getRender(ctx, id)
    if (job.engine !== 'browser') throw conflict('Only browser renders are completed this way')
    if (job.createdBy !== ctx.user.id)
      throw forbidden('Only the person who queued this render can deliver it')
    await ensureAll(
      assetIds,
      (ids) => ctx.repo.assets.many({ where: inArray(t.asset.id, ids) }),
      'Asset',
    )
    const row = await updateRender(ctx, id, {
      status: error === undefined ? 'done' : 'failed',
      progress: error === undefined ? 1 : job.progress,
      assetIds,
      error: error ?? null,
      seconds: seconds ?? null,
      device: device ?? null,
      sceneHash: error === undefined ? (sceneHash ?? null) : null,
    })
    // First write wins: a second delivery, or one after a cancel, is refused.
    if (!row) throw conflict(`This render is already ${job.status}`)
    announce(ctx, row)
    return one(ctx, row)
  },

  'renders.update': async (ctx, { id, ...patch }) => {
    const before = await getRender(ctx, id)
    const [row] = await ctx.repo.renders.update(eq(t.renderJob.id, id), patch)
    announce(ctx, row!)
    const agent = takeAgent(before)
    if (agent && patch.starred !== undefined && patch.starred !== before.starred)
      await recordRenderFeedback(ctx, {
        agent,
        kind: patch.starred ? 'starred' : 'unstarred',
        target: `render:${id}`,
        detail: `${patch.starred ? 'Starred' : 'Unstarred'} the take “${before.title}”, which the assistant rendered.`,
      })
    return one(ctx, row!)
  },

  'renders.cancel': async (ctx, { id }) => {
    const current = await getRender(ctx, id)
    if (isTerminal(current.status)) throw conflict(`This render is already ${current.status}`)
    if (current.engine === 'blender' && ctx.services.isConfigured('renderQueue'))
      await stopJob(id, () => ctx.services.get('renderQueue').cancel(id, serviceContext(ctx)))
    const row = await updateRender(ctx, id, { status: 'canceled' })
    if (!row) throw conflict('This render finished before it could be canceled')
    announce(ctx, row)
    return one(ctx, row)
  },

  'renders.delete': async (ctx, { id }) => {
    const job = await getRender(ctx, id)
    if (!isTerminal(job.status)) throw conflict('Cancel this render before deleting it')
    await ctx.repo.renders.delete(eq(t.renderJob.id, id))
    const agent = takeAgent(job)
    if (agent)
      await recordRenderFeedback(ctx, {
        agent,
        kind: 'deleted',
        target: `render:${id}`,
        detail: `Deleted the take “${job.title}”, which the assistant rendered.`,
      })
    return { ok: true }
  },

  // Answered even without an engine service: "not available" is the status, not an error.
  'renders.engine': async (ctx) => {
    const engine = ctx.services.optional('renderEngine')
    if (engine) return engine.status(serviceContext(ctx))
    return {
      available: ctx.services.capabilities().blender,
      version: null,
      device: null,
      path: null,
      reason: ctx.services.capabilities().blender
        ? null
        : 'This server has no Blender set up; renders use the browser (preview quality).',
    }
  },

  'renders.configureEngine': async (ctx, { blenderPath }) => {
    if (ctx.authMode !== 'local')
      throw forbidden('The render engine can only be configured on a local install')
    return ctx.services.require('renderEngine').configure(blenderPath, serviceContext(ctx))
  },

  'renders.installStatus': async (ctx) =>
    installer(ctx, false)?.installStatus?.() ?? BLENDER_INSTALL_UNAVAILABLE,
  'renders.installEngine': async (ctx) =>
    installer(ctx, true)?.install?.() ?? BLENDER_INSTALL_UNAVAILABLE,
  'renders.cancelInstall': async (ctx) =>
    (await installer(ctx, true)?.cancelInstall?.()) ?? BLENDER_INSTALL_UNAVAILABLE,
}
