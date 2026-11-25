/**
 * Image generation's setup: each provider's key (entered in Settings, AI or in apps/server/.env),
 * the default provider, quality and models, and keeping the `imageGen` service registered exactly
 * while some organisation can generate (a key, or the test provider). Saving a key turns image
 * generation on at once and removing the last turns it off, with no restart. Keys belong to one
 * organisation in accounts mode, so availability is also answered per organisation.
 */
import type { ImageProvider } from '@pave/ideation'
import {
  type CommandOutput,
  type CommandParsedInput,
  IMAGE_QUALITIES,
  type ImageProviderId,
  type ImageQuality,
  type ImageSetup,
  KEYED_IMAGE_PROVIDERS,
  type KeyedImageProvider,
} from '@pave/schema'
import { and, eq, gte, sum } from 'drizzle-orm'
import type { Ctx } from '../context'
import * as t from '../db/schema'
import { conflict, NotConfiguredError } from '../errors'
import type { Runtime } from '../runtime'
import type {
  ImageGenService,
  ImageSetupService,
  ResolvedImageProvider,
  ServiceContext,
} from '../services'
import { fromMicros } from '../usage'
import type { ImageKeyStore } from './keys'

const keyed = (p: ImageProviderId): p is KeyedImageProvider =>
  (KEYED_IMAGE_PROVIDERS as readonly string[]).includes(p)

export class ImageGenImpl implements ImageGenService, ImageSetupService {
  readonly #runtime: Runtime
  readonly #keys: ImageKeyStore
  readonly #providers: Record<ImageProviderId, ImageProvider>
  /** The fake test provider stands in (PAVE_IMAGE_GEN=fake). */
  readonly #fake: boolean
  /** Saved keys: organisation → providers. */
  readonly #saved = new Map<string, Set<KeyedImageProvider>>()

  constructor(init: {
    runtime: Runtime
    keys: ImageKeyStore
    providers: Record<ImageProviderId, ImageProvider>
    fake: boolean
  }) {
    this.#runtime = init.runtime
    this.#keys = init.keys
    this.#providers = init.providers
    this.#fake = init.fake
  }

  get capabilities() {
    return { imageGeneration: this.#everAvailable() }
  }

  async ready(): Promise<void> {
    for (const { orgId, provider } of await this.#runtime.imageKeyOrgs()) {
      if (!keyed(provider as ImageProviderId)) continue
      const set = this.#saved.get(orgId) ?? new Set()
      set.add(provider as KeyedImageProvider)
      this.#saved.set(orgId, set)
    }
    this.#sync()
  }

  /** Providers some organisation can use; what `session.get` reports before asking per org. */
  #everAvailable(): ImageProviderId[] {
    const all = new Set<ImageProviderId>(this.#keys.envProviders())
    for (const set of this.#saved.values()) for (const p of set) all.add(p)
    if (this.#fake) all.add('fake')
    return [...all]
  }

  #sync(): void {
    const on = this.#everAvailable().length > 0
    const services = this.#runtime.services
    if (on && services.optional('imageGen') !== this) services.register('imageGen', this)
    else if (!on && services.isConfigured('imageGen')) services.unregister('imageGen')
  }

  available(orgId: string): ImageProviderId[] {
    const out: ImageProviderId[] = []
    for (const p of KEYED_IMAGE_PROVIDERS)
      if (this.#keys.hasEnvKey(p) || this.#saved.get(orgId)?.has(p)) out.push(p)
    if (this.#fake) out.push('fake')
    return out
  }

  #ctx(sctx: ServiceContext): Promise<Ctx> {
    return this.#runtime.context({ userId: sctx.userId, orgId: sctx.orgId })
  }

  async #settings(ctx: Ctx) {
    const s = await ctx.repo.settings.first()
    return {
      defaultProvider: s?.imageProvider ?? null,
      quality: (s?.imageQuality ?? 'standard') as ImageQuality,
      models: s?.imageModels ?? {},
    }
  }

  #modelFor(p: ImageProviderId, models: Partial<Record<KeyedImageProvider, string | null>>) {
    const provider = this.#providers[p]
    const chosen = keyed(p) ? models[p] : null
    return chosen && provider.models.some((m) => m.id === chosen) ? chosen : provider.defaultModel
  }

  /** The organisation's default: the chosen one when it can be used, else the first that can. */
  #defaultOf(orgId: string, chosen: ImageProviderId | null): ImageProviderId | null {
    const can = this.available(orgId)
    return chosen && can.includes(chosen) ? chosen : (can[0] ?? null)
  }

  async resolve(
    sctx: ServiceContext,
    want: ImageProviderId | null,
  ): Promise<ResolvedImageProvider> {
    const ctx = await this.#ctx(sctx)
    const s = await this.#settings(ctx)
    const can = this.available(ctx.orgId)
    if (want && !can.includes(want))
      throw new NotConfiguredError(
        'imageGen',
        `${this.#providers[want].label} has no API key. An owner or admin can add one in Settings, AI, or pick another provider for this board.`,
      )
    const id = want ?? this.#defaultOf(ctx.orgId, s.defaultProvider)
    if (!id)
      throw new NotConfiguredError(
        'imageGen',
        'Generating images needs an image provider’s API key (Google Gemini, OpenAI or Higgsfield). An owner or admin can add one in Settings, AI.',
      )
    const provider = this.#providers[id]
    const apiKey = keyed(id) ? await this.#keys.key(ctx, id) : 'fake'
    if (!apiKey)
      throw new NotConfiguredError(
        'imageGen',
        `The saved ${provider.label} key cannot be opened (the server’s secret changed). Save it again in Settings, AI.`,
      )
    return { provider, model: this.#modelFor(id, s.models), quality: s.quality, apiKey }
  }

  /** The price per image and provider without opening a key (for estimates and Settings). */
  async price(
    sctx: ServiceContext,
    want: ImageProviderId | null,
  ): Promise<{ provider: ImageProvider; model: string; perImageUsd: number }> {
    const ctx = await this.#ctx(sctx)
    const s = await this.#settings(ctx)
    const id = want ?? this.#defaultOf(ctx.orgId, s.defaultProvider)
    if (!id) throw new NotConfiguredError('imageGen', 'No image provider has a key yet.')
    const provider = this.#providers[id]
    const model = this.#modelFor(id, s.models)
    return { provider, model, perImageUsd: provider.perImageUsd(model, s.quality) }
  }

  // ── Settings, AI ─────────────────────────────────────────────────────────────────────────

  async get(sctx: ServiceContext, opts: { admin: boolean }): Promise<ImageSetup> {
    const ctx = await this.#ctx(sctx)
    const s = await this.#settings(ctx)
    const assistant = this.#runtime.services.optional('assistant')
    const claudeReady = !!assistant && ((await assistant.available?.(ctx.orgId)) ?? true)
    const ids: ImageProviderId[] = [
      ...KEYED_IMAGE_PROVIDERS,
      ...(this.#fake ? ['fake' as const] : []),
    ]
    const providers = await Promise.all(
      ids.map(async (id) => {
        const p = this.#providers[id]
        const info = keyed(id)
          ? await this.#keys.info(ctx, id)
          : { source: 'env' as const, last4: null, updatedAt: null }
        const model = this.#modelFor(id, s.models)
        return {
          id,
          label: p.label,
          keyHelp: p.keyHelp,
          key: {
            source: info.source,
            last4: opts.admin ? info.last4 : null,
            editable: keyed(id) && !this.#keys.hasEnvKey(id),
            envName: keyed(id) ? (this.#keys.envName(id) ?? p.envNames[0] ?? null) : null,
            updatedAt: info.updatedAt,
          },
          configured: info.source !== 'none',
          model,
          models: p.models.map((m) => ({
            id: m.id,
            label: m.label,
            perImageUsd: p.perImageUsd(m.id, s.quality),
            takesReferences: m.takesReferences,
          })),
          priceNote: p.priceNote,
          notes: p.models.find((m) => m.id === model)?.takesReferences
            ? []
            : [`${p.label}’s model takes no reference pictures: references shape the prompt only.`],
        }
      }),
    )
    return {
      providers,
      defaultProvider: this.#defaultOf(ctx.orgId, s.defaultProvider),
      quality: s.quality,
      claudeReady,
      testMode: this.#fake,
      monthSpendUsd: opts.admin ? await monthImageUsd(ctx) : null,
    }
  }

  async setKey(provider: KeyedImageProvider, apiKey: string, sctx: ServiceContext) {
    this.#assertEditable(provider)
    const ctx = await this.#ctx(sctx)
    await this.#keys.save(ctx, provider, apiKey.trim())
    const set = this.#saved.get(ctx.orgId) ?? new Set()
    set.add(provider)
    this.#saved.set(ctx.orgId, set)
    this.#sync()
    return this.get(sctx, { admin: true })
  }

  async testKey(
    provider: KeyedImageProvider,
    apiKey: string | null,
    sctx: ServiceContext,
  ): Promise<CommandOutput<'images.key.test'>> {
    const key = apiKey?.trim() || (await this.#keys.key(await this.#ctx(sctx), provider))
    if (!key)
      return {
        ok: false,
        code: 'invalid',
        message: 'There is no key to test yet. Paste one first.',
      }
    const r = await this.#providers[provider].check(key)
    return r.ok
      ? { ok: true, code: null, message: r.message }
      : { ok: false, code: r.code, message: r.message }
  }

  async removeKey(provider: KeyedImageProvider, sctx: ServiceContext) {
    this.#assertEditable(provider)
    const ctx = await this.#ctx(sctx)
    await this.#keys.remove(ctx, provider)
    this.#saved.get(ctx.orgId)?.delete(provider)
    this.#sync()
    return this.get(sctx, { admin: true })
  }

  async update(input: CommandParsedInput<'images.settings.update'>, sctx: ServiceContext) {
    const ctx = await this.#ctx(sctx)
    await ctx.repo.settings.insertIfAbsent({})
    // Read-then-write without a lock, like org.settings.update: two admins saving at the same
    // instant is the only race, and the later save wins whole.
    const current = await ctx.repo.settings.first()
    const models = { ...(current?.imageModels ?? {}) }
    for (const [p, model] of Object.entries(input.models ?? {}) as [
      KeyedImageProvider,
      string | null,
    ][]) {
      if (model !== null && !this.#providers[p].models.some((m) => m.id === model))
        throw conflict(`${this.#providers[p].label} has no model “${model}”.`)
      models[p] = model
    }
    const patch = {
      ...(input.defaultProvider !== undefined ? { imageProvider: input.defaultProvider } : {}),
      ...(input.quality && (IMAGE_QUALITIES as readonly string[]).includes(input.quality)
        ? { imageQuality: input.quality }
        : {}),
      imageModels: models,
      updatedAt: new Date(),
    }
    await ctx.repo.settings.update(eq(t.orgSettings.orgId, ctx.orgId), patch)
    return this.get(sctx, { admin: true })
  }

  #assertEditable(provider: KeyedImageProvider): void {
    const name = this.#keys.envName(provider)
    if (name)
      throw conflict(
        `The ${this.#providers[provider].label} key comes from ${name} in apps/server/.env, which takes precedence. Change or remove it there and restart the server.`,
      )
  }
}

/** This calendar month's image spend (UTC). */
async function monthImageUsd(ctx: Ctx): Promise<number> {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const [row] = await ctx.repo.usage.select(
    { micros: sum(t.usageEvent.costMicros).mapWith(Number) },
    and(gte(t.usageEvent.occurredAt, start), eq(t.usageEvent.meter, 'image'))!,
  )
  return fromMicros(row?.micros ?? 0)
}
