import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createMiddleware } from 'hono/factory'
import { logger } from 'hono/logger'
import { type BlobStore, FsBlobStore } from './assets/blob-store'
import { createAuth } from './auth/auth'
import { ensureLocalWorkspace, loadOrCreateSecret } from './auth/workspace'
import { type Config, configFromEnv } from './config'
import { openDatabase } from './db/client'
import { AppError, notFound } from './errors'
import { EventBus } from './events'
import { mountAssets } from './http/assets'
import { mountEvents } from './http/events'
import { mountRpc } from './http/rpc'
import { mountStudio } from './http/static'
import type { App, Env } from './http/types'
import { Runtime } from './runtime'
import { seedIfEmpty } from './seed'
import { ServiceRegistry, type Services } from './services'

export interface CreateAppOptions {
  /** Overrides on top of the environment (see `.env.example`). */
  config?: Partial<Config>
  /** Engine implementations; anything omitted answers 501 until registered. */
  services?: Partial<Services>
  blobs?: BlobStore
}

export interface PaveServer {
  app: App
  runtime: Runtime
  close(): Promise<void>
}

async function authSecret(config: Config): Promise<string> {
  if (config.authSecret) return config.authSecret
  if (config.auth === 'accounts')
    throw new Error('BETTER_AUTH_SECRET (32+ characters) is required when PAVE_AUTH=accounts')
  return loadOrCreateSecret(config.dataDir)
}

/** Opens the database (migrating it), wires auth, services and routes, and returns the app. */
export async function createApp(options: CreateAppOptions = {}): Promise<PaveServer> {
  const config: Config = { ...configFromEnv(), ...options.config }
  const secret = await authSecret(config)
  const database = await openDatabase({ url: config.databaseUrl, dataDir: config.dataDir })
  try {
    const auth = createAuth(database.db, config, secret)
    const local = config.auth === 'local' ? await ensureLocalWorkspace(database.db) : null
    const runtime = new Runtime({
      config,
      database,
      auth,
      blobs: options.blobs ?? new FsBlobStore(config.blobDir),
      services: new ServiceRegistry(options.services),
      events: new EventBus(),
      local,
    })
    if (local && config.seed)
      await seedIfEmpty(runtime, await runtime.context({ ...local, actor: { type: 'system' } }))

    return { app: buildRoutes(runtime), runtime, close: () => database.close() }
  } catch (err) {
    await database.close()
    throw err
  }
}

function buildRoutes(runtime: Runtime): App {
  const { config } = runtime
  const app = new Hono<Env>()

  if (config.logRequests) app.use('/api/*', logger())
  app.use('/api/*', cors({ origin: config.corsOrigins, credentials: true }))

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json(err.toJSON(), err.status)
    console.error(err)
    return c.json(
      { error: { code: 'internal', message: 'Something went wrong on the server' } },
      500,
    )
  })

  app.on(['GET', 'POST'], '/api/auth/*', (c) => runtime.auth.handler(c.req.raw))

  const withCtx = createMiddleware<Env>(async (c, next) => {
    c.set('ctx', await runtime.contextForRequest(c.req.raw.headers))
    await next()
  })
  for (const path of ['/api/rpc/*', '/api/assets', '/api/assets/*', '/api/events'])
    app.use(path, withCtx)

  mountRpc(app, runtime)
  mountAssets(app, runtime)
  mountEvents(app)
  app.all('/api/*', (c) => {
    throw notFound('Route', `${c.req.method} ${c.req.path}`)
  })

  mountStudio(app, config.studioDist)
  return app
}
