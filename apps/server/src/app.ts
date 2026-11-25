import type { MiddlewareHandler } from 'hono'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createMiddleware } from 'hono/factory'
import { logger } from 'hono/logger'
import { type BlobStore, FsBlobStore } from './assets/blob-store'
import { createAuth } from './auth/auth'
import { ensureLocalWorkspace, loadOrCreateSecret } from './auth/workspace'
import { type Config, configFromEnv } from './config'
import { openDatabase } from './db/client'
import { AppError, forbidden, notFound } from './errors'
import { EventBus } from './events'
import { mountAssets } from './http/assets'
import { mountEvents } from './http/events'
import { mountRpc } from './http/rpc'
import { mountStudio } from './http/static'
import type { App, Env } from './http/types'
import { Runtime } from './runtime'
import { seedIfEmpty } from './seed'
import { type ServiceName, ServiceRegistry, type Services } from './services'

export interface CreateAppOptions {
  /** Overrides on top of the environment (see `.env.example`). */
  config?: Partial<Config>
  /**
   * Engine implementations; anything omitted answers 501 until registered. A function receives
   * the runtime, for engines that run commands or build contexts themselves (the assistant host,
   * the render queue's boot recovery).
   */
  services?: Partial<Services> | ((runtime: Runtime) => Partial<Services>)
  /**
   * Extra HTTP routes (the assistant's run stream, `/mcp`), mounted before the `/api/*` catch-all.
   * `withCtx` resolves the caller's context into `c.var.ctx`; apply it to routes that need one.
   */
  routes?: (app: App, runtime: Runtime, withCtx: MiddlewareHandler<Env>) => void
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

/**
 * Opens the database (migrating it), wires auth, services and routes, hands work left unfinished
 * by a restart back to its services (`Runtime.recover`), and returns the app.
 */
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
      services: new ServiceRegistry(typeof options.services === 'function' ? {} : options.services),
      events: new EventBus(),
      local,
    })
    if (typeof options.services === 'function')
      for (const [name, impl] of Object.entries(options.services(runtime)) as [
        ServiceName,
        Services[ServiceName],
      ][])
        runtime.services.register(name, impl)
    await runtime.services.ready()
    if (local && config.seed)
      await seedIfEmpty(runtime, await runtime.context({ ...local, actor: { type: 'system' } }))
    await runtime.recover()

    const close = async () => {
      // Engines first: their last writes need the database.
      await runtime.services.dispose()
      await database.close()
    }
    return { app: buildRoutes(runtime, options.routes), runtime, close }
  } catch (err) {
    await database.close()
    throw err
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const parsed = (url: string): URL | null => (URL.canParse(url) ? new URL(url) : null)

/**
 * Refuses a write that a browser sent from a page of another website. A POST with no body, or a
 * multipart upload, needs no CORS preflight, and local mode has no session cookie whose SameSite
 * rule would stop it; the Origin header a browser attaches is what tells such a request apart.
 * Trusted: the public URL, the CORS origins, and the host the request itself was sent to (the
 * studio this server serves, whatever scheme a proxy terminates). Callers that are not browsers
 * send no Origin and are not affected.
 */
function refuseForeignWrites(config: Config): MiddlewareHandler<Env> {
  const trusted = new Set(
    [config.publicUrl, ...config.corsOrigins].map((url) => parsed(url)?.origin ?? url),
  )
  return async (c, next) => {
    const origin = c.req.header('origin')
    if (
      origin !== undefined &&
      !SAFE_METHODS.has(c.req.method) &&
      !trusted.has(origin) &&
      parsed(origin)?.host !== new URL(c.req.url).host
    )
      throw forbidden('This request comes from a website this server does not trust')
    await next()
  }
}

function buildRoutes(runtime: Runtime, routes: CreateAppOptions['routes']): App {
  const { config } = runtime
  const app = new Hono<Env>()

  if (config.logRequests) app.use('/api/*', logger())
  app.use('/api/*', cors({ origin: config.corsOrigins, credentials: true }))
  app.use('/api/*', refuseForeignWrites(config))

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
  routes?.(app, runtime, withCtx)
  app.all('/api/*', (c) => {
    throw notFound('Route', `${c.req.method} ${c.req.path}`)
  })

  mountStudio(app, config.studioDist)
  return app
}
