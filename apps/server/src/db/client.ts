import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres'
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import pg from 'pg'
import * as schema from './schema'

export type Schema = typeof schema
/** A database or a transaction on it; both drivers share this surface. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>

export interface Database {
  db: Db
  driver: 'pg' | 'pglite'
  close(): Promise<void>
}

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url))

/**
 * Opens the database and applies pending migrations. With a URL it uses Postgres; otherwise
 * embedded PGlite persisted under `dataDir`, or in memory when `dataDir` is null.
 */
export async function openDatabase(opts: {
  url: string | null
  dataDir: string | null
}): Promise<Database> {
  if (opts.url) {
    const pool = new pg.Pool({ connectionString: opts.url })
    const db = drizzleNodePg(pool, { schema })
    await migrateNodePg(db, { migrationsFolder: MIGRATIONS })
    return { db, driver: 'pg', close: () => pool.end() }
  }
  const dir = opts.dataDir === null ? undefined : join(opts.dataDir, 'pg')
  if (dir) mkdirSync(dir, { recursive: true })
  const client = new PGlite(dir)
  const db = drizzlePglite(client, { schema })
  await migratePglite(db, { migrationsFolder: MIGRATIONS })
  return { db, driver: 'pglite', close: () => client.close() }
}
