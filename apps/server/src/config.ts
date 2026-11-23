import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

export type AuthMode = 'local' | 'accounts'

export interface Config {
  port: number
  host: string
  /** Absent → embedded PGlite under `dataDir` (or in memory when `dataDir` is null). */
  databaseUrl: string | null
  /** Null keeps the database in memory (tests); blobs then need an explicit `blobDir`. */
  dataDir: string | null
  blobDir: string
  auth: AuthMode
  authSecret: string | null
  publicUrl: string
  corsOrigins: string[]
  seed: boolean
  studioDist: string
  maxUploadBytes: number
  /** Validate handler outputs against the contract (dev and test). */
  validateOutputs: boolean
  logRequests: boolean
}

const flag = z
  .enum(['0', '1', 'true', 'false'])
  .transform((v) => v === '1' || v === 'true')
  .optional()

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().optional(),
  DATABASE_URL: z.string().min(1).optional(),
  PAVE_DATA_DIR: z.string().min(1).optional(),
  PAVE_AUTH: z.enum(['local', 'accounts']).optional(),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  PAVE_PUBLIC_URL: z.url().optional(),
  PAVE_CORS_ORIGINS: z.string().optional(),
  PAVE_SEED: flag,
  PAVE_STUDIO_DIST: z.string().optional(),
  PAVE_MAX_UPLOAD_MB: z.coerce.number().positive().default(200),
  NODE_ENV: z.string().optional(),
})

/** Reads configuration from the environment. Every variable is documented in `.env.example`. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  const e = EnvSchema.parse(env)
  const auth: AuthMode = e.PAVE_AUTH ?? (e.DATABASE_URL ? 'accounts' : 'local')
  const dataDir = e.PAVE_DATA_DIR ?? join(REPO_ROOT, '.data')
  const production = e.NODE_ENV === 'production'
  return {
    port: e.PORT,
    // Local mode has no sign-in, so it must never listen beyond loopback unless asked to.
    host: e.HOST ?? (auth === 'local' ? '127.0.0.1' : '0.0.0.0'),
    databaseUrl: e.DATABASE_URL ?? null,
    dataDir,
    blobDir: join(dataDir, 'blobs'),
    auth,
    authSecret: e.BETTER_AUTH_SECRET ?? null,
    publicUrl: e.PAVE_PUBLIC_URL ?? `http://localhost:${e.PORT}`,
    corsOrigins: (e.PAVE_CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    seed: e.PAVE_SEED ?? true,
    studioDist: e.PAVE_STUDIO_DIST ?? join(REPO_ROOT, 'apps', 'studio', 'dist'),
    maxUploadBytes: Math.round(e.PAVE_MAX_UPLOAD_MB * 1024 * 1024),
    validateOutputs: !production,
    logRequests: !production && e.NODE_ENV !== 'test',
  }
}
