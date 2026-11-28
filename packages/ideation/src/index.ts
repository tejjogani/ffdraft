/**
 * The image provider family for the design board and on-model imaging: one shape
 * (`ImageProvider`), the three keyed providers and the test fake. The server picks one per board
 * and passes the key per call; nothing here reads the environment.
 */
import type { ImageProviderId } from '@pave/schema'
import { fakeProvider } from './fake'
import { geminiProvider } from './gemini'
import { higgsfieldProvider } from './higgsfield'
import { openaiProvider } from './openai'
import type { ImageProvider, ProviderOptions } from './types'

export * from './fake'
export * from './gemini'
export * from './higgsfield'
export * from './openai'
export * from './types'

/** Every provider, built with the same fetch and per-provider base addresses (tests, gateways). */
export function imageProviders(
  opts: { fetch?: typeof fetch; baseUrls?: Partial<Record<ImageProviderId, string>> } = {},
): Record<ImageProviderId, ImageProvider> {
  const o = (id: ImageProviderId): ProviderOptions => ({
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(opts.baseUrls?.[id] ? { baseUrl: opts.baseUrls[id] } : {}),
  })
  return {
    gemini: geminiProvider(o('gemini')),
    openai: openaiProvider(o('openai')),
    higgsfield: higgsfieldProvider(o('higgsfield')),
    fake: fakeProvider(),
  }
}
