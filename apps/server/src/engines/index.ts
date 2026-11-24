/**
 * The core engines, local to this server: `geometry` and `production` on a pool of kernel
 * worker threads, and `renderQueue` / `renderEngine` on Blender. `compose.ts` registers them.
 */
import { join } from 'node:path'
import { z } from 'zod'
import type { Config } from '../config'
import type { Runtime } from '../runtime'
import type { RenderEngineService, Services } from '../services'
import { createGeometry } from './geometry'
import { KernelPool, type KernelPoolOptions } from './kernel/pool'
import { createProduction } from './production'
import { BlenderSetup } from './render/blender'
import { createRenderQueue, type RenderQueueOptions } from './render/queue'

export interface EnginesConfig {
  pool?: KernelPoolOptions
  /** Package builds at once. */
  productionConcurrency?: number
  /** Blender takes at once. */
  renderConcurrency?: number
  renderTimeoutMs?: RenderQueueOptions['timeoutMs']
  /** Where the Blender choice is saved; null keeps it in memory. */
  engineFile: string | null
}

const EnvSchema = z.object({
  PAVE_KERNEL_WORKERS: z.coerce.number().int().min(1).max(64).optional(),
  PAVE_PRODUCTION_CONCURRENCY: z.coerce.number().int().min(1).max(16).optional(),
  PAVE_RENDER_CONCURRENCY: z.coerce.number().int().min(1).max(16).optional(),
})

export function enginesConfigFromEnv(env: NodeJS.ProcessEnv, config: Config): EnginesConfig {
  const e = EnvSchema.parse(env)
  return {
    ...(e.PAVE_KERNEL_WORKERS === undefined ? {} : { pool: { size: e.PAVE_KERNEL_WORKERS } }),
    ...(e.PAVE_PRODUCTION_CONCURRENCY === undefined
      ? {}
      : { productionConcurrency: e.PAVE_PRODUCTION_CONCURRENCY }),
    ...(e.PAVE_RENDER_CONCURRENCY === undefined
      ? {}
      : { renderConcurrency: e.PAVE_RENDER_CONCURRENCY }),
    engineFile: config.dataDir === null ? null : join(config.dataDir, 'engine.json'),
  }
}

export function createEngines(
  runtime: Runtime,
  config: EnginesConfig,
): Pick<Services, 'geometry' | 'production' | 'renderQueue' | 'renderEngine'> {
  const pool = new KernelPool(config.pool)
  const blender = new BlenderSetup({ file: config.engineFile })
  const renderEngine: RenderEngineService = {
    status: async () => {
      await blender.ready
      return blender.status()
    },
    configure: (blenderPath) => blender.configure(blenderPath),
  }
  return {
    geometry: createGeometry(pool),
    production: createProduction(pool, { concurrency: config.productionConcurrency ?? 1 }),
    renderQueue: createRenderQueue({
      blender,
      geometry: () => runtime.services.get('geometry'),
      concurrency: config.renderConcurrency ?? 1,
      ...(config.renderTimeoutMs ? { timeoutMs: config.renderTimeoutMs } : {}),
    }),
    renderEngine,
  }
}
