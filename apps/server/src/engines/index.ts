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
  /** Where Blender works. Default: `<dataDir>/render-work`, or a private temporary folder. */
  renderWorkRoot?: string
  /** Where the Blender choice is saved; null keeps it in memory. */
  engineFile: string | null
  /**
   * Where `PAVE_PYTHON` and `PAVE_BLENDER` are read when no Blender was chosen: the server's
   * environment (default, the process's own), so a server built from another environment (the
   * smoke test's) finds the Blender that environment names, not the one this machine has.
   */
  blenderEnv?: NodeJS.ProcessEnv
}

const EnvSchema = z.object({
  PAVE_KERNEL_WORKERS: z.coerce.number().int().min(1).max(64).optional(),
  PAVE_KERNEL_MEMORY_MB: z.coerce.number().int().min(256).optional(),
  PAVE_KERNEL_PIECES_PER_WORKER: z.coerce.number().int().min(1).max(64).optional(),
  PAVE_PRODUCTION_CONCURRENCY: z.coerce.number().int().min(1).max(16).optional(),
  PAVE_RENDER_CONCURRENCY: z.coerce.number().int().min(1).max(16).optional(),
})

export function enginesConfigFromEnv(env: NodeJS.ProcessEnv, config: Config): EnginesConfig {
  const e = EnvSchema.parse(env)
  const pool: KernelPoolOptions = {
    ...(e.PAVE_KERNEL_WORKERS === undefined ? {} : { size: e.PAVE_KERNEL_WORKERS }),
    ...(e.PAVE_KERNEL_MEMORY_MB === undefined ? {} : { memoryBudgetMb: e.PAVE_KERNEL_MEMORY_MB }),
    ...(e.PAVE_KERNEL_PIECES_PER_WORKER === undefined
      ? {}
      : { kernelsPerWorker: e.PAVE_KERNEL_PIECES_PER_WORKER }),
  }
  return {
    pool,
    ...(e.PAVE_PRODUCTION_CONCURRENCY === undefined
      ? {}
      : { productionConcurrency: e.PAVE_PRODUCTION_CONCURRENCY }),
    ...(e.PAVE_RENDER_CONCURRENCY === undefined
      ? {}
      : { renderConcurrency: e.PAVE_RENDER_CONCURRENCY }),
    engineFile: config.dataDir === null ? null : join(config.dataDir, 'engine.json'),
    blenderEnv: env,
  }
}

export function createEngines(
  runtime: Runtime,
  config: EnginesConfig,
): Pick<Services, 'geometry' | 'production' | 'renderQueue' | 'renderEngine'> {
  const pool = new KernelPool(config.pool)
  const { dataDir } = runtime.config
  const workRoot = config.renderWorkRoot ?? (dataDir && join(dataDir, 'render-work'))
  const blender = new BlenderSetup({
    file: config.engineFile,
    dataDir: runtime.config.auth === 'local' ? dataDir : null,
    ...(config.blenderEnv ? { env: config.blenderEnv } : {}),
  })
  const renderEngine: RenderEngineService = {
    status: async () => {
      await blender.ready
      return blender.status()
    },
    configure: (blenderPath) => blender.configure(blenderPath),
    installStatus: () => blender.installStatus(),
    install: () => blender.install(),
    cancelInstall: () => blender.cancelInstall(),
    dispose: () => blender.dispose(),
  }
  return {
    geometry: createGeometry(pool),
    production: createProduction(pool, { concurrency: config.productionConcurrency ?? 1 }),
    renderQueue: createRenderQueue({
      blender,
      geometry: () => runtime.services.get('geometry'),
      concurrency: config.renderConcurrency ?? 1,
      ...(config.renderTimeoutMs ? { timeoutMs: config.renderTimeoutMs } : {}),
      ...(workRoot ? { workRoot } : {}),
      engineOutput: runtime.config.auth === 'local',
    }),
    renderEngine,
  }
}
