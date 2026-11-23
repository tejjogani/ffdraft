import { asc, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import * as t from '../db/schema'

/** What one signed-in user may see across organisations: their own record and memberships. */
export class AccountRepo {
  readonly #db: Db

  constructor(
    db: Db,
    readonly userId: string,
  ) {
    this.#db = db
  }

  async user() {
    const [row] = await this.#db.select().from(t.user).where(eq(t.user.id, this.userId))
    return row
  }

  /** Organisations the user belongs to, in the order they joined. */
  memberships() {
    return this.#db
      .select({ org: t.organization, role: t.member.role })
      .from(t.member)
      .innerJoin(t.organization, eq(t.organization.id, t.member.organizationId))
      .where(eq(t.member.userId, this.userId))
      .orderBy(asc(t.member.createdAt))
  }
}
