import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import type { Ctx } from '../context'
import * as t from '../db/schema'

const MAX_CONTEXT_REFERENCES = 20

/** Imported copies are looked up on the project board selected by the caller. */
export async function importedReferences(ctx: Ctx, boardId: string, prioritized: string[] = []) {
  const where = and(eq(t.reference.boardId, boardId), isNotNull(t.reference.importedFrom))!
  const orderBy = [asc(t.reference.position), asc(t.reference.id)]
  if (prioritized.length) orderBy.unshift(desc(inArray(t.reference.id, prioritized)))
  const [rows, count] = await Promise.all([
    ctx.repo.references.many({ where, orderBy, limit: MAX_CONTEXT_REFERENCES }),
    ctx.repo.references.count(where),
  ])
  return { rows, count }
}
