import { and, count, eq, type SQL } from 'drizzle-orm'
import type { PgColumn, PgTable, SelectedFields } from 'drizzle-orm/pg-core'
import type { Db } from '../db/client'

type OrderBy = SQL | PgColumn | (SQL | PgColumn)[]

/**
 * One table seen through one organisation. Every statement it builds is filtered by — and every
 * row it inserts is stamped with — the org id it was constructed with; there is no method that
 * takes a different org or skips the filter. Callers pass only the rest of the condition.
 *
 * Drizzle cannot carry a generic table's row type through its builders, so results are cast to
 * the table's own `$inferSelect` here, in one place.
 */
export class ScopedTable<T extends PgTable, K extends keyof T['$inferInsert'] & string> {
  readonly #db: Db
  readonly #orgId: string

  constructor(
    db: Db,
    orgId: string,
    readonly table: T,
    private readonly orgKey: K,
    private readonly orgColumn: PgColumn,
  ) {
    this.#db = db
    this.#orgId = orgId
  }

  /** The org filter, optionally narrowed. Use it to scope joins that start from this table. */
  where(cond?: SQL): SQL {
    const own = eq(this.orgColumn, this.#orgId)
    return cond ? (and(own, cond) as SQL) : own
  }

  async first(cond?: SQL, orderBy?: OrderBy): Promise<T['$inferSelect'] | undefined> {
    const rows = await this.many({ where: cond, orderBy, limit: 1 })
    return rows[0]
  }

  async many(
    opts: { where?: SQL; orderBy?: OrderBy; limit?: number; offset?: number } = {},
  ): Promise<T['$inferSelect'][]> {
    const base = this.#db
      .select()
      .from(this.table as PgTable)
      .where(this.where(opts.where))
      .$dynamic()
    if (opts.orderBy) base.orderBy(...(Array.isArray(opts.orderBy) ? opts.orderBy : [opts.orderBy]))
    if (opts.limit !== undefined) base.limit(opts.limit)
    if (opts.offset !== undefined) base.offset(opts.offset)
    return (await base) as T['$inferSelect'][]
  }

  async count(cond?: SQL): Promise<number> {
    const [row] = await this.#db
      .select({ n: count() })
      .from(this.table as PgTable)
      .where(this.where(cond))
    return row?.n ?? 0
  }

  /** Grouped or computed selects (`select … where org = ? and … group by …`). */
  select<F extends SelectedFields>(fields: F, cond?: SQL) {
    return this.#db
      .select(fields)
      .from(this.table as PgTable)
      .where(this.where(cond))
      .$dynamic()
  }

  async insert(values: Omit<T['$inferInsert'], K>): Promise<T['$inferSelect']> {
    const [row] = await this.insertMany([values])
    return row!
  }

  async insertMany(values: Omit<T['$inferInsert'], K>[]): Promise<T['$inferSelect'][]> {
    if (values.length === 0) return []
    const rows = values.map((v) => ({ ...v, [this.orgKey]: this.#orgId }))
    return (await this.#db
      .insert(this.table)
      .values(rows as T['$inferInsert'][])
      .returning()) as T['$inferSelect'][]
  }

  /** Inserts unless a row with the same unique key exists; returns the row only when inserted. */
  async insertIfAbsent(values: Omit<T['$inferInsert'], K>): Promise<T['$inferSelect'] | undefined> {
    const [row] = (await this.#db
      .insert(this.table)
      .values({ ...values, [this.orgKey]: this.#orgId } as T['$inferInsert'])
      .onConflictDoNothing()
      .returning()) as T['$inferSelect'][]
    return row
  }

  async update(cond: SQL, set: Partial<Omit<T['$inferInsert'], K>>): Promise<T['$inferSelect'][]> {
    return (await this.#db
      .update(this.table)
      .set(set as Partial<T['$inferInsert']>)
      .where(this.where(cond))
      .returning()) as T['$inferSelect'][]
  }

  async delete(cond: SQL): Promise<T['$inferSelect'][]> {
    return (await this.#db
      .delete(this.table)
      .where(this.where(cond))
      .returning()) as T['$inferSelect'][]
  }
}
