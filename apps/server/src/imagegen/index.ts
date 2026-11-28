/**
 * Image generation, put together: the provider family from `@pave/ideation`, the keys (.env or
 * Settings, AI) and the setup service that registers `imageGen` while a key exists. The pipeline
 * itself (brief, generate, check) is ./pipeline, called by the `references.*` handlers.
 * On-model concepts share this provider configuration, with reference-capable models only.
 *
 *   const images = createImageGen(runtime, { env })   // compose.ts
 *   createImageGen(runtime, { env: { PAVE_IMAGE_GEN: 'fake' } })   // tests: the fake provider
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakeProvider, type ImageProvider, imageProviders } from '@pave/ideation'
import { type ImageProviderId, KEYED_IMAGE_PROVIDERS, type KeyedImageProvider } from '@pave/schema'
import { OnModelImpl } from '../on-model'
import type { Runtime } from '../runtime'
import type { Services } from '../services'
import { ImageKeyStore } from './keys'
import { ImageGenImpl } from './setup'

export interface ImageGenOptions {
  /** apps/server/.env and the environment: provider keys, PAVE_IMAGE_GEN=fake for tests. */
  env?: Readonly<Record<string, string | undefined>>
  /** Replaces the providers (tests: adapters over a fake fetch). */
  providers?: Partial<Record<ImageProviderId, ImageProvider>>
}

/** Whether the fake test provider stands in; refused in production, like the scripted assistant. */
export function fakeImagesFromEnv(env: Readonly<Record<string, string | undefined>>): boolean {
  if (env.PAVE_IMAGE_GEN?.trim() !== 'fake') return false
  if (env.NODE_ENV === 'production')
    throw new Error(
      'PAVE_IMAGE_GEN=fake is a test provider and is refused with NODE_ENV=production.',
    )
  return true
}

export function createImageGen(
  runtime: Runtime,
  opts: ImageGenOptions = {},
): { services: Pick<Services, 'imageSetup' | 'onModel'>; impl: ImageGenImpl } {
  const env = opts.env ?? process.env
  const fake = fakeImagesFromEnv(env)
  if (fake)
    console.warn(
      '\n!!! PAVE_IMAGE_GEN=fake — generated images are TEST PICTURES, not a real image model. Unset it for real use. !!!\n',
    )
  const providers = {
    ...imageProviders({
      baseUrls: {
        ...(env.PAVE_GEMINI_BASE_URL ? { gemini: env.PAVE_GEMINI_BASE_URL } : {}),
        ...(env.PAVE_OPENAI_BASE_URL ? { openai: env.PAVE_OPENAI_BASE_URL } : {}),
        ...(env.PAVE_HIGGSFIELD_BASE_URL ? { higgsfield: env.PAVE_HIGGSFIELD_BASE_URL } : {}),
      },
    }),
    // PAVE_FAKE_IMAGES=<folder>: the test provider hands out those pictures in turn (screenshots).
    ...(fake && env.PAVE_FAKE_IMAGES
      ? { fake: fakeProvider({ pictures: picturesIn(env.PAVE_FAKE_IMAGES) }) }
      : {}),
    ...opts.providers,
  } as Record<ImageProviderId, ImageProvider>
  const envNames = Object.fromEntries(
    KEYED_IMAGE_PROVIDERS.map((p) => [p, providers[p].envNames]),
  ) as Record<KeyedImageProvider, readonly string[]>
  const keys = new ImageKeyStore(runtime, envNames, env)
  const impl = new ImageGenImpl({ runtime, keys, providers, fake })
  return { services: { imageSetup: impl, onModel: new OnModelImpl(runtime, impl) }, impl }
}

function picturesIn(dir: string): { bytes: Uint8Array; mime: string }[] {
  return readdirSync(dir)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .sort()
    .map((f) => ({
      bytes: new Uint8Array(readFileSync(join(dir, f))),
      mime: /\.png$/i.test(f) ? 'image/png' : 'image/jpeg',
    }))
}
