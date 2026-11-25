/**
 * Where the Claude API key comes from, and the one place that reads it.
 *
 *  1. ANTHROPIC_API_KEY in apps/server/.env (or the environment) wins, for every organisation.
 *  2. Otherwise the key an owner or admin saved in Settings, AI, stored in the database per
 *     organisation, sealed with AES-256-GCM.
 *
 * Why the database, not a file: in accounts mode a key belongs to one organisation of many, and
 * the database is where per-organisation data lives (PGlite and Postgres alike, so it also works
 * with an in-memory test database). The sealing key is derived from the server's auth secret,
 * which is kept outside the database (a 0600 file under PAVE_DATA_DIR, or BETTER_AUTH_SECRET), so
 * a copied database, dump or backup does not give the key away.
 *
 * The plain key is returned only to the assistant's own model client; it is never logged, put in
 * an error, a trace, a usage row, an event or a command's output (only its last four characters).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Ctx } from '../context'
import * as t from '../db/schema'
import type { Runtime } from '../runtime'

export type KeySource = 'env' | 'settings' | 'none'

export interface KeyInfo {
  source: KeySource
  last4: string | null
  updatedAt: string | null
}

const purpose = (orgId: string) => `assistant-key:${orgId}`

/**
 * Seals a secret for one organisation under a key derived for `purposeOf` (each kind of key has
 * its own). Exported for the image providers' keys, which follow the same rules.
 */
export function seal(runtime: Runtime, orgId: string, plain: string, purposeOf = purpose): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', runtime.deriveKey(purposeOf(orgId)), iv)
  // The org id is bound in as associated data, so a sealed key moved to another org fails to open.
  cipher.setAAD(Buffer.from(orgId))
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
}

export function unseal(
  runtime: Runtime,
  orgId: string,
  sealed: string,
  purposeOf = purpose,
): string | null {
  try {
    const raw = Buffer.from(sealed, 'base64')
    const decipher = createDecipheriv(
      'aes-256-gcm',
      runtime.deriveKey(purposeOf(orgId)),
      raw.subarray(0, 12),
    )
    decipher.setAAD(Buffer.from(orgId))
    decipher.setAuthTag(raw.subarray(12, 28))
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
  } catch {
    // The auth secret changed (a new PAVE_DATA_DIR secret): the saved key cannot be opened.
    return null
  }
}

export const last4 = (key: string) => key.slice(-4)

export class KeyStore {
  readonly #runtime: Runtime
  readonly #envKey: string | null

  constructor(runtime: Runtime, envKey: string | null) {
    this.#runtime = runtime
    this.#envKey = envKey?.trim() || null
  }

  get hasEnvKey(): boolean {
    return this.#envKey !== null
  }

  /** The key a run of this organisation uses, or null. */
  async key(ctx: Ctx): Promise<string | null> {
    if (this.#envKey) return this.#envKey
    const row = await ctx.repo.assistantKeys.first()
    return row ? unseal(this.#runtime, ctx.orgId, row.sealed) : null
  }

  async info(ctx: Ctx): Promise<KeyInfo> {
    if (this.#envKey) return { source: 'env', last4: last4(this.#envKey), updatedAt: null }
    const row = await ctx.repo.assistantKeys.first()
    if (!row || unseal(this.#runtime, ctx.orgId, row.sealed) === null)
      return { source: 'none', last4: null, updatedAt: null }
    return { source: 'settings', last4: row.last4, updatedAt: row.updatedAt.toISOString() }
  }

  async save(ctx: Ctx, key: string): Promise<void> {
    const values = {
      sealed: seal(this.#runtime, ctx.orgId, key),
      last4: last4(key),
      updatedBy: ctx.user.id,
      updatedAt: new Date(),
    }
    // One row per org (its primary key decides a race of two saves): insert, else replace.
    const inserted = await ctx.repo.assistantKeys.insertIfAbsent(values)
    if (!inserted) await ctx.repo.assistantKeys.update(eq(t.assistantKey.orgId, ctx.orgId), values)
  }

  async remove(ctx: Ctx): Promise<void> {
    await ctx.repo.assistantKeys.delete(eq(t.assistantKey.orgId, ctx.orgId))
  }
}
