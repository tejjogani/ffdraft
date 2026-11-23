/**
 * Fetch-or-404 for ids that arrive in input. Because they go through the org-scoped repo, an id
 * belonging to another organisation is indistinguishable from one that does not exist — which
 * is also what keeps foreign keys in new rows pointing inside the caller's org.
 */
import { eq } from 'drizzle-orm'
import type { Ctx } from './context'
import * as t from './db/schema'
import { notFound } from './errors'

async function must<R>(row: Promise<R | undefined>, what: string, id: string): Promise<R> {
  const r = await row
  if (r === undefined) throw notFound(what, id)
  return r
}

export const getCollection = (ctx: Ctx, id: string) =>
  must(ctx.repo.collections.first(eq(t.collection.id, id)), 'Collection', id)
export const getPiece = (ctx: Ctx, id: string) =>
  must(ctx.repo.pieces.first(eq(t.piece.id, id)), 'Piece', id)
export const getBoard = (ctx: Ctx, id: string) =>
  must(ctx.repo.boards.first(eq(t.board.id, id)), 'Board', id)
export const getReference = (ctx: Ctx, id: string) =>
  must(ctx.repo.references.first(eq(t.reference.id, id)), 'Reference', id)
export const getRender = (ctx: Ctx, id: string) =>
  must(ctx.repo.renders.first(eq(t.renderJob.id, id)), 'Render', id)
export const getScene = (ctx: Ctx, id: string) =>
  must(ctx.repo.scenes.first(eq(t.renderScene.id, id)), 'Shot', id)
export const getShot = (ctx: Ctx, id: string) =>
  must(ctx.repo.shots.first(eq(t.modelShot.id, id)), 'On-model image', id)
export const getMeshJob = (ctx: Ctx, id: string) =>
  must(ctx.repo.meshJobs.first(eq(t.meshJob.id, id)), 'Image-to-3D job', id)
export const getModel = (ctx: Ctx, id: string) =>
  must(ctx.repo.models.first(eq(t.brandModel.id, id)), 'Brand model', id)
export const getThread = (ctx: Ctx, id: string) =>
  must(ctx.repo.threads.first(eq(t.thread.id, id)), 'Thread', id)
export const getRun = (ctx: Ctx, id: string) =>
  must(ctx.repo.runs.first(eq(t.agentRun.id, id)), 'Run', id)

/** Checks that every id names a row of the caller's org (404 naming the first that does not). */
export async function ensureAll(
  ids: readonly string[],
  load: (ids: string[]) => Promise<{ id: string }[]>,
  what: string,
): Promise<void> {
  if (ids.length === 0) return
  const unique = [...new Set(ids)]
  const found = new Set((await load(unique)).map((r) => r.id))
  const absent = unique.find((id) => !found.has(id))
  if (absent) throw notFound(what, absent)
}

/** Checks an optional reference to another row; `null`/`undefined` pass through. */
export async function ensure(
  get: (ctx: Ctx, id: string) => Promise<unknown>,
  ctx: Ctx,
  id: string | null | undefined,
): Promise<void> {
  if (id) await get(ctx, id)
}
