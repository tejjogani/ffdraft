import { asc, eq } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { Db } from '../db/client'
import * as t from '../db/schema'
import { ScopedTable } from './scoped'

type OrgScoped = PgTable & { orgId: PgColumn; $inferInsert: { orgId: string } }

/**
 * All data access for one organisation. Constructed with an org id and holding the database
 * privately, it is the only thing handlers can reach: there is no way to read or write a domain
 * row of another org through it.
 */
export class Repo {
  readonly #db: Db

  constructor(
    db: Db,
    readonly orgId: string,
  ) {
    this.#db = db
  }

  #scope<T extends OrgScoped>(table: T) {
    return new ScopedTable(this.#db, this.orgId, table, 'orgId', table.orgId)
  }

  readonly settings = this.#scope(t.orgSettings)
  readonly collections = this.#scope(t.collection)
  readonly pieces = this.#scope(t.piece)
  readonly changes = this.#scope(t.designChange)
  readonly blobs = this.#scope(t.blob)
  readonly assets = this.#scope(t.asset)
  readonly assetVariants = this.#scope(t.assetVariant)
  readonly boards = this.#scope(t.board)
  readonly references = this.#scope(t.reference)
  readonly renders = this.#scope(t.renderJob)
  readonly models = this.#scope(t.brandModel)
  readonly shots = this.#scope(t.modelShot)
  readonly packages = this.#scope(t.productionPackage)
  readonly threads = this.#scope(t.thread)
  readonly runs = this.#scope(t.agentRun)
  readonly steps = this.#scope(t.agentStep)
  readonly messages = this.#scope(t.agentMessage)
  readonly feedback = this.#scope(t.runFeedback)
  readonly usage = this.#scope(t.usageEvent)
  readonly audit = this.#scope(t.auditLog)
  readonly invitations = new ScopedTable(
    this.#db,
    this.orgId,
    t.invitation,
    'organizationId',
    t.invitation.organizationId,
  )
  readonly memberships = new ScopedTable(this.#db, this.orgId, t.member, 'organizationId', t.member.organizationId)

  /** Runs `fn` atomically against a repo bound to the same org. */
  transaction<R>(fn: (tx: Repo) => Promise<R>): Promise<R> {
    return this.#db.transaction((tx) => fn(new Repo(tx, this.orgId)))
  }

  /** Members of this org with their user records, oldest first. */
  members() {
    return this.#db
      .select({ member: t.member, user: t.user })
      .from(t.member)
      .innerJoin(t.user, eq(t.user.id, t.member.userId))
      .where(this.memberships.where())
      .orderBy(asc(t.member.createdAt))
  }

}
