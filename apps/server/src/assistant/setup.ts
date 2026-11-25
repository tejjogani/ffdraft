/**
 * The assistant's setup: the Claude API key (entered in the app or in apps/server/.env) and the
 * tiers, and keeping the `assistant` service registered exactly while some key is available —
 * saving a key turns the assistant on at once and removing the last one turns it off, with no
 * restart. In accounts mode a key belongs to one organisation: the service is shared, so it also
 * answers per organisation (`available`), and `session.get` follows that.
 */
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MODELS, resolveTiers, TIER_ENV, TIERS, typicalRunUsd } from '@pave/agent'
import type { KeyCheck } from '@pave/agent/anthropic'
import {
  ASSISTANT_MODELS,
  ASSISTANT_TIERS,
  type AssistantModelId,
  type AssistantSetup,
  type CommandOutput,
} from '@pave/schema'
import { and, eq, gte, sum } from 'drizzle-orm'
import type { Ctx } from '../context'
import * as t from '../db/schema'
import { conflict } from '../errors'
import type { Runtime } from '../runtime'
import type { AssistantSetupService, ServiceContext } from '../services'
import { fromMicros } from '../usage'
import type { KeyStore } from './keys'
import type { Assistant } from './service'

export type KeyChecker = (apiKey: string) => Promise<KeyCheck>

/**
 * A note under PAVE_DATA_DIR saying whether any organisation has a key saved in Settings, AI, so
 * `node scripts/install.mjs --check` can report it without opening the database (which the
 * running server holds). It says only yes or no: never the key, nor its last characters.
 */
export const KEY_NOTE_FILE = 'assistant-key.json'

const price = (id: AssistantModelId) => {
  const r = MODELS[id].rates
  return { input: r.input, output: r.output, cacheRead: r.cacheRead, cacheWrite: r.cacheWrite5m }
}

export class AssistantSetupImpl implements AssistantSetupService {
  readonly #runtime: Runtime
  readonly #keys: KeyStore
  readonly #assistant: Assistant
  readonly #check: KeyChecker
  readonly #env: Readonly<Record<string, string | undefined>>
  readonly #scripted: boolean
  /** Organisations with a saved key; with the .env key or scripted mode, every one has a key. */
  readonly #orgs = new Set<string>()
  readonly #dispose: () => Promise<void>
  #noteChain: Promise<void> = Promise.resolve()

  constructor(init: {
    runtime: Runtime
    keys: KeyStore
    assistant: Assistant
    check: KeyChecker
    env: Readonly<Record<string, string | undefined>>
    scripted: boolean
    dispose: () => Promise<void>
  }) {
    this.#runtime = init.runtime
    this.#keys = init.keys
    this.#assistant = init.assistant
    this.#check = init.check
    this.#env = init.env
    this.#scripted = init.scripted
    this.#dispose = init.dispose
  }

  /** Whether runs can start for this organisation. */
  hasKey(orgId: string): boolean {
    return this.#scripted || this.#keys.hasEnvKey || this.#orgs.has(orgId)
  }

  /** Learns which organisations saved keys, then registers the assistant if any did. */
  async ready(): Promise<void> {
    for (const orgId of await this.#runtime.assistantKeyOrgs()) this.#orgs.add(orgId)
    this.#sync()
    await this.#writeNote()
  }

  dispose(): Promise<void> {
    return this.#dispose()
  }

  #sync(): void {
    const on = this.#scripted || this.#keys.hasEnvKey || this.#orgs.size > 0
    const services = this.#runtime.services
    if (on && services.optional('assistant') !== this.#assistant)
      services.register('assistant', this.#assistant)
    else if (!on && services.isConfigured('assistant')) services.unregister('assistant')
  }

  /**
   * Best effort: the note is a hint for the installer, never a reason for a save to fail. Writes
   * are queued one after another, each reading the state when it runs, so two saves at once
   * cannot leave the older answer on disk.
   */
  #writeNote(): Promise<void> {
    const dir = this.#runtime.config.dataDir
    if (!dir) return Promise.resolve()
    const file = join(dir, KEY_NOTE_FILE)
    // Written whole, then renamed over the old note, so a reader never sees half a file.
    const tmp = `${file}.${process.pid}.tmp`
    this.#noteChain = this.#noteChain.then(async () => {
      try {
        await writeFile(tmp, `${JSON.stringify({ keySavedInApp: this.#orgs.size > 0 })}\n`)
        await rename(tmp, file)
      } catch {
        // A read-only data folder: --check then says it cannot tell.
      }
    })
    return this.#noteChain
  }

  #ctx(sctx: ServiceContext): Promise<Ctx> {
    return this.#runtime.context({ userId: sctx.userId, orgId: sctx.orgId })
  }

  async get(sctx: ServiceContext, opts: { admin: boolean }): Promise<AssistantSetup> {
    const ctx = await this.#ctx(sctx)
    const [info, settings] = await Promise.all([this.#keys.info(ctx), ctx.repo.settings.first()])
    const resolved = resolveTiers(
      settings
        ? { assistantTier: settings.assistantTier, assistantModels: settings.assistantModels }
        : null,
      this.#env,
    )
    const envNames = ['ANTHROPIC_API_KEY', ...Object.values(TIER_ENV)].filter((k) =>
      this.#env[k]?.trim(),
    )
    return {
      configured: this.#scripted || info.source !== 'none',
      key: {
        source: info.source,
        last4: opts.admin ? info.last4 : null,
        editable: !this.#keys.hasEnvKey && !this.#scripted,
        updatedAt: info.updatedAt,
      },
      scripted: this.#scripted,
      defaultTier: resolved.defaultTier,
      tiers: ASSISTANT_TIERS.map((tier) => {
        const { model, source } = resolved.tiers[tier]
        return {
          tier,
          label: TIERS[tier].label,
          blurb: TIERS[tier].blurb,
          model,
          modelLabel: MODELS[model].label,
          source,
          price: price(model),
          typicalRunUsd: typicalRunUsd(model),
        }
      }),
      models: ASSISTANT_MODELS.map((id) => ({
        id,
        label: MODELS[id].label,
        price: price(id),
        needsRetention: MODELS[id].needsRetention,
      })),
      envOverrides: envNames,
      warnings: resolved.warnings,
      monthSpendUsd: opts.admin ? await monthLlmUsd(ctx) : null,
    }
  }

  async setKey(apiKey: string, sctx: ServiceContext): Promise<AssistantSetup> {
    this.#assertEditable()
    const ctx = await this.#ctx(sctx)
    await this.#keys.save(ctx, apiKey.trim())
    this.#orgs.add(ctx.orgId)
    this.#sync()
    await this.#writeNote()
    return this.get(sctx, { admin: true })
  }

  async testKey(
    apiKey: string | null,
    sctx: ServiceContext,
  ): Promise<CommandOutput<'assistant.key.test'>> {
    const key = apiKey?.trim() || (await this.#keys.key(await this.#ctx(sctx)))
    if (!key)
      return {
        ok: false,
        code: 'invalid',
        message: 'There is no key to test yet. Paste one first.',
        models: [],
      }
    const r = await this.#check(key)
    if (!r.ok) return { ok: false, code: r.code, message: r.message, models: [] }
    const missing = ASSISTANT_MODELS.filter((m) => !r.models.includes(m))
    return {
      ok: true,
      code: null,
      message: missing.length
        ? `The key works. It cannot use ${missing.map((m) => MODELS[m].label).join(', ')}; point tiers at the others.`
        : 'The key works with every tier model.',
      models: r.models,
    }
  }

  async removeKey(sctx: ServiceContext): Promise<AssistantSetup> {
    this.#assertEditable()
    const ctx = await this.#ctx(sctx)
    await this.#keys.remove(ctx)
    this.#orgs.delete(ctx.orgId)
    this.#sync()
    await this.#writeNote()
    return this.get(sctx, { admin: true })
  }

  #assertEditable(): void {
    if (this.#keys.hasEnvKey)
      throw conflict(
        'The API key comes from ANTHROPIC_API_KEY in apps/server/.env, which takes precedence. Change or remove it there and restart the server.',
      )
    if (this.#scripted)
      throw conflict('The assistant is in test mode (PAVE_ASSISTANT=scripted:…) and uses no key.')
  }
}

/** This calendar month's spend on the model (UTC). */
async function monthLlmUsd(ctx: Ctx): Promise<number> {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const [row] = await ctx.repo.usage.select(
    { micros: sum(t.usageEvent.costMicros).mapWith(Number) },
    and(gte(t.usageEvent.occurredAt, start), eq(t.usageEvent.meter, 'llm'))!,
  )
  return fromMicros(row?.micros ?? 0)
}
