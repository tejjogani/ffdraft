import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLAN_NAMES, type PlanName } from '@pave/schema'
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
  /**
   * Extra host names a local install answers to, besides loopback, the public URL and `HOST`.
   * Names only, no port. Ignored with accounts, where a session is what proves the caller.
   */
  allowedHosts: string[]
  seed: boolean
  studioDist: string
  maxUploadBytes: number
  /** Validate handler outputs against the contract (dev and test). */
  validateOutputs: boolean
  logRequests: boolean
  /**
   * PAVE_PLAN: the plan to act as, for testing on a local install. Null in accounts mode, where
   * the plan belongs to the organisation, and when unset or not a plan's name.
   */
  plan: PlanName | null
  /** Signed-out Diaex Partner API base. Unset disables requests to Diaex. */
  diaexPartnerApiUrl: string | null
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
  PAVE_ALLOWED_HOSTS: z.string().optional(),
  PAVE_SEED: flag,
  PAVE_STUDIO_DIST: z.string().optional(),
  PAVE_MAX_UPLOAD_MB: z.coerce.number().positive().default(200),
  NODE_ENV: z.string().optional(),
  // Checked below rather than here: a mistyped plan is ignored with a warning, not a crash.
  PAVE_PLAN: z.string().optional(),
  PAVE_DIAEX_PARTNER_API_URL: z
    .url({ protocol: /^https?$/ })
    .refine((value) => {
      const url = URL.parse(value)
      return url !== null && !url.username && !url.password && !url.search && !url.hash
    })
    .optional(),
})

/** Reads configuration from the environment. Every variable is documented in `.env.example`. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  const e = EnvSchema.parse(env)
  const auth: AuthMode = e.PAVE_AUTH ?? (e.DATABASE_URL ? 'accounts' : 'local')
  const dataDir = e.PAVE_DATA_DIR ? resolve(e.PAVE_DATA_DIR) : join(REPO_ROOT, '.data')
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
    allowedHosts: (e.PAVE_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    seed: e.PAVE_SEED ?? true,
    studioDist: e.PAVE_STUDIO_DIST
      ? resolve(e.PAVE_STUDIO_DIST)
      : join(REPO_ROOT, 'apps', 'studio', 'dist'),
    maxUploadBytes: Math.round(e.PAVE_MAX_UPLOAD_MB * 1024 * 1024),
    validateOutputs: !production,
    logRequests: !production && e.NODE_ENV !== 'test',
    plan: auth === 'local' ? planFrom(e.PAVE_PLAN) : null,
    diaexPartnerApiUrl: e.PAVE_DIAEX_PARTNER_API_URL ?? null,
  }
}

const planFrom = (v: string | undefined): PlanName | null => {
  const name = v?.trim().toLowerCase()
  return (PLAN_NAMES as readonly string[]).includes(name ?? '') ? (name as PlanName) : null
}

/** Why PAVE_PLAN is not in force, for a warning at start-up; null when it is, or is unset. */
export function planWarning(config: Config, env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env.PAVE_PLAN?.trim()
  if (!v || config.plan !== null) return null
  return config.auth === 'accounts'
    ? 'PAVE_PLAN is ignored in accounts mode: each organisation has its own plan.'
    : `PAVE_PLAN="${v}" is not a plan (use ${PLAN_NAMES.join(' or ')}); it is ignored.`
}
