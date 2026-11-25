/**
 * Saved shots change through here: every change to a shot's scene is written together with a
 * history row (the scene before and after, and who changed it), so any change can be undone,
 * the assistant's included, and a locked camera stays where a person put it.
 *
 * Races: the history's (shot, seq) index is unique and every scene write adds a history row in
 * the same transaction, so of two writers on one shot one commits and the other rolls back,
 * reads the shot again and re-applies its change on top (at most `MAX_ATTEMPTS` times). Writes
 * that leave the scene alone (title, position, the take in the set) never write the scene.
 */
import { shotChangeRefusal, undoTarget } from '@pave/render'
import {
  diffPatch,
  mergePatch,
  type RenderScene,
  RenderSceneSchema,
  type SceneChange,
} from '@pave/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { Ctx } from './context'
import * as t from './db/schema'
import { AppError, badRequest, conflict, forbidden, notFound } from './errors'
import { createId } from './ids'
import { getScene } from './lookups'

type SceneRow = typeof t.renderScene.$inferSelect
type ChangeRow = typeof t.renderSceneChange.$inferSelect

const MAX_ATTEMPTS = 5

/** Another writer changed the shot between our read and our write. */
class StaleWrite extends Error {}

export const toSceneChange = (r: ChangeRow): SceneChange => ({
  id: r.id,
  sceneId: r.sceneId,
  seq: r.seq,
  before: r.before,
  after: r.after,
  actor: r.actor,
  reverts: r.reverts,
  revertedBy: r.revertedBy,
  at: r.at.toISOString(),
})

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Paths a merge patch writes that the parsed result does not have (stripped as unknown). */
function strippedKeys(patch: Record<string, unknown>, parsed: unknown, path = ''): string[] {
  if (!isObject(parsed)) return []
  return Object.entries(patch).flatMap(([k, v]) => {
    const at = path ? `${path}.${k}` : k
    if (v === null) return []
    if (!(k in parsed)) return [at]
    return isObject(v) ? strippedKeys(v, parsed[k], at) : []
  })
}

/** A merge patch applied to a scene and validated; a misspelt field fails rather than vanishing. */
export function patchScene(scene: RenderScene, patch: Record<string, unknown>): RenderScene {
  const parsed = RenderSceneSchema.safeParse(mergePatch(scene, patch))
  if (!parsed.success) throw badRequest(z.prettifyError(parsed.error), parsed.error.issues)
  const unknown = strippedKeys(patch, parsed.data)
  if (unknown.length)
    throw new AppError('bad_request', `Unknown scene fields: ${unknown.join(', ')}`, {
      paths: unknown,
    })
  return parsed.data as RenderScene
}

const byOf = (ctx: Ctx): 'person' | 'agent' => (ctx.actor.type === 'agent' ? 'agent' : 'person')

/** The leaf paths a merge patch writes, e.g. `camera.position`. */
function leafPaths(patch: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(patch).flatMap(([k, v]) => {
    const at = prefix ? `${prefix}.${k}` : k
    return isObject(v) ? leafPaths(v, at) : [at]
  })
}

const valueAt = (scene: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((v, k) => (isObject(v) ? v[k] : undefined), scene)

interface Planned {
  scene: RenderScene
  /** The change this one undoes. */
  reverts?: ChangeRow
  /** Title, position, take: written with the scene, not part of its history. */
  fields?: Partial<Pick<SceneRow, 'title' | 'position' | 'takeId'>>
}

/**
 * Writes what `plan` makes of the shot as it is now, with a history row when the scene changed.
 * `plan` runs again if another writer got there first.
 */
export async function changeScene(
  ctx: Ctx,
  id: string,
  plan: (row: SceneRow, tx: Ctx['repo']) => Promise<Planned>,
): Promise<{ row: SceneRow; change: SceneChange | null }> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await ctx.repo.transaction(async (tx) => {
        const current = await getScene({ ...ctx, repo: tx }, id)
        const next = await plan(current, tx)
        const moved = Object.keys(diffPatch(current.scene, next.scene)).length > 0
        if (moved) {
          const refusal = shotChangeRefusal(current.scene, next.scene, byOf(ctx))
          if (refusal)
            throw byOf(ctx) === 'agent' && refusal.startsWith('Only a person')
              ? forbidden(refusal)
              : conflict(refusal)
        }
        const [row] = await tx.scenes.update(eq(t.renderScene.id, id), {
          ...next.fields,
          ...(moved ? { scene: next.scene } : {}),
          updatedAt: new Date(),
        })
        if (!row) throw new StaleWrite()
        if (!moved) return { row, change: null }
        const [last] = await tx.sceneChanges.many({
          where: eq(t.renderSceneChange.sceneId, id),
          orderBy: desc(t.renderSceneChange.seq),
          limit: 1,
        })
        const change = await tx.sceneChanges.insert({
          id: createId('shc'),
          sceneId: id,
          seq: (last?.seq ?? 0) + 1,
          before: current.scene,
          after: next.scene,
          actor: ctx.actor,
          reverts: next.reverts?.id ?? null,
        })
        if (next.reverts) {
          const marked = await tx.sceneChanges.update(
            and(
              eq(t.renderSceneChange.id, next.reverts.id),
              // Two undos of the same change: the second finds it already undone.
              isNull(t.renderSceneChange.revertedBy),
            )!,
            { revertedBy: change.id },
          )
          if (marked.length === 0) throw new StaleWrite()
        }
        return { row, change: toSceneChange(change) }
      })
    } catch (err) {
      const raced =
        err instanceof StaleWrite ||
        (err instanceof Error && /render_scene_change_seq_idx|unique/i.test(err.message))
      if (!raced) throw err
      if (attempt >= MAX_ATTEMPTS)
        throw conflict('The shot was changed at the same time; reload and try again')
    }
  }
}

/** The history of a shot, newest first. */
export async function sceneHistory(ctx: Ctx, id: string, limit = 50): Promise<SceneChange[]> {
  await getScene(ctx, id)
  const rows = await ctx.repo.sceneChanges.many({
    where: eq(t.renderSceneChange.sceneId, id),
    orderBy: desc(t.renderSceneChange.seq),
    limit,
  })
  return rows.map(toSceneChange)
}

/**
 * Undoes one change: only the settings it changed go back, and only while no later change has
 * moved the same settings (that later change must be undone first).
 */
export async function revertScene(ctx: Ctx, id: string, changeId?: string) {
  return changeScene(ctx, id, async (current, tx) => {
    const rows = await tx.sceneChanges.many({
      where: eq(t.renderSceneChange.sceneId, id),
      orderBy: desc(t.renderSceneChange.seq),
      limit: 200,
    })
    const target = changeId
      ? rows.find((r) => r.id === changeId)
      : (() => {
          const pick = undoTarget(rows.map(toSceneChange))
          return pick ? rows.find((r) => r.id === pick.id) : undefined
        })()
    if (!target)
      throw changeId ? notFound('Shot change', changeId) : conflict('Nothing to undo on this shot')
    if (target.revertedBy) throw conflict('That change is already undone')
    const inverse = diffPatch(target.after, target.before)
    const moved = leafPaths(inverse).filter(
      (path) =>
        JSON.stringify(valueAt(current.scene, path)) !==
        JSON.stringify(valueAt(target.after, path)),
    )
    if (moved.length)
      throw conflict('A later change moved the same settings; undo that one first.', {
        paths: moved,
      })
    return { scene: patchScene(current.scene, inverse), reverts: target }
  })
}
