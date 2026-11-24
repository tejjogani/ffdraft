/** Test helpers for suites that run the real engines (kernel workers, Blender). */
import type { Asset } from '@pave/schema'
import type { CreateAppOptions } from '../app'
import { createEngines, type EnginesConfig } from '../engines'
import { type Client, type TestServer, testServer } from './harness'

/** A test server with the real engines; the kernel pool is kept small for shared CI machines. */
export function engineServer(
  opts: { auth?: 'local' | 'accounts'; engines?: Partial<EnginesConfig> } & Omit<
    CreateAppOptions,
    'services'
  > = {},
): Promise<TestServer> {
  const { engines, ...rest } = opts
  return testServer({
    ...rest,
    services: (runtime) =>
      createEngines(runtime, { engineFile: null, pool: { size: 2 }, ...engines }),
  })
}

/** The bytes behind an asset, fetched through the asset route as `api`. */
export async function assetBytes(api: Client, asset: Pick<Asset, 'url'>): Promise<Uint8Array> {
  const res = await api.request(asset.url)
  if (!res.ok) throw new Error(`GET ${asset.url} → ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/** Polls `read` until `done` holds, for jobs that settle in the background. */
export async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  { timeoutMs = 120_000, everyMs = 250 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > deadline) throw new Error(`Timed out waiting: ${JSON.stringify(value)}`)
    await new Promise((r) => setTimeout(r, everyMs))
  }
}
