/**
 * Where an image provider's key comes from, and the one place that reads it. The rules are the
 * Claude key's (see ../assistant/keys): a key in apps/server/.env wins for every organisation;
 * otherwise the key an owner or admin saved in Settings, AI, sealed in the database per
 * organisation and provider under a key derived from the auth secret.
 *
 * The plain key goes only to the provider adapter for one call; it is never logged, put in an
 * error, a trace, a usage row, an event or a command's output (only its last four characters).
 */
import type { KeyedImageProvider } from '@pave/schema'
import { and, eq } from 'drizzle-orm'
import { type KeyInfo, last4, seal, unseal } from '../assistant/keys'
import type { Ctx } from '../context'
import * as t from '../db/schema'
import type { Runtime } from '../runtime'

const purposeFor = (provider: KeyedImageProvider) => (orgId: string) =>
  `image-key:${provider}:${orgId}`

export class ImageKeyStore {
  readonly #runtime: Runtime
  readonly #env: Partial<Record<KeyedImageProvider, { name: string; key: string }>>

  /** `env`: per provider, the first of its variable names that holds a value. */
  constructor(
    runtime: Runtime,
    envNames: Record<KeyedImageProvider, readonly string[]>,
    env: Readonly<Record<string, string | undefined>>,
  ) {
    this.#runtime = runtime
    this.#env = {}
    for (const [provider, names] of Object.entries(envNames) as [
      KeyedImageProvider,
      readonly string[],
    ][]) {
      const name = names.find((n) => env[n]?.trim())
      if (name) this.#env[provider] = { name, key: env[name]!.trim() }
    }
  }

  /** The .env variable that supplies this provider's key, if one does. */
  envName(provider: KeyedImageProvider): string | null {
    return this.#env[provider]?.name ?? null
  }

  hasEnvKey(provider: KeyedImageProvider): boolean {
    return !!this.#env[provider]
  }

  envProviders(): KeyedImageProvider[] {
    return Object.keys(this.#env) as KeyedImageProvider[]
  }

  #where(ctx: Ctx, provider: KeyedImageProvider) {
    return and(eq(t.imageKey.orgId, ctx.orgId), eq(t.imageKey.provider, provider))!
  }

  async key(ctx: Ctx, provider: KeyedImageProvider): Promise<string | null> {
    const fromEnv = this.#env[provider]
    if (fromEnv) return fromEnv.key
    const row = await ctx.repo.imageKeys.first(this.#where(ctx, provider))
    return row ? unseal(this.#runtime, ctx.orgId, row.sealed, purposeFor(provider)) : null
  }

  async info(ctx: Ctx, provider: KeyedImageProvider): Promise<KeyInfo> {
    const fromEnv = this.#env[provider]
    if (fromEnv) return { source: 'env', last4: last4(fromEnv.key), updatedAt: null }
    const row = await ctx.repo.imageKeys.first(this.#where(ctx, provider))
    if (!row || unseal(this.#runtime, ctx.orgId, row.sealed, purposeFor(provider)) === null)
      return { source: 'none', last4: null, updatedAt: null }
    return { source: 'settings', last4: row.last4, updatedAt: row.updatedAt.toISOString() }
  }

  async save(ctx: Ctx, provider: KeyedImageProvider, key: string): Promise<void> {
    const values = {
      provider,
      sealed: seal(this.#runtime, ctx.orgId, key, purposeFor(provider)),
      last4: last4(key),
      updatedBy: ctx.user.id,
      updatedAt: new Date(),
    }
    // The (org, provider) primary key decides a race of two saves: insert, else replace.
    const inserted = await ctx.repo.imageKeys.insertIfAbsent(values)
    if (!inserted) await ctx.repo.imageKeys.update(this.#where(ctx, provider), values)
  }

  async remove(ctx: Ctx, provider: KeyedImageProvider): Promise<void> {
    await ctx.repo.imageKeys.delete(this.#where(ctx, provider))
  }
}
