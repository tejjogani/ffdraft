/** Test helpers: an in-memory server and a typed RPC client over its real HTTP routes. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CommandInput, CommandName, CommandOutput } from '@pave/schema'
import { type CreateAppOptions, createApp, type PaveServer } from '../app'
import { configFromEnv } from '../config'

/**
 * For `beforeAll` hooks that boot a server: PGlite plus every migration can take far longer than
 * vitest's 10 s hook default on a busy machine (several suites running at once).
 */
export const BOOT_TIMEOUT = 60_000

export interface TestServer extends PaveServer {
  dispose(): Promise<void>
}

export async function testServer(
  opts: { auth?: 'local' | 'accounts' } & CreateAppOptions = {},
): Promise<TestServer> {
  const dir = await mkdtemp(join(tmpdir(), 'pave-test-'))
  const server = await createApp({
    ...opts,
    config: {
      ...configFromEnv({ NODE_ENV: 'test' }),
      auth: opts.auth ?? 'local',
      dataDir: null,
      blobDir: join(dir, 'blobs'),
      authSecret: 'test-secret-test-secret-test-secret-0123',
      publicUrl: 'http://localhost:8787',
      seed: false,
      studioDist: join(dir, 'no-studio'),
      ...opts.config,
    },
  })
  return {
    ...server,
    dispose: async () => {
      await server.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

export interface RpcError {
  status: number
  error: { code: string; message: string; issues?: unknown[]; [k: string]: unknown }
}

/** A client bound to one server and, in accounts mode, one session cookie. */
export function client(server: PaveServer, cookie?: string) {
  const headers = (extra: Record<string, string> = {}) => ({
    ...(cookie ? { cookie } : {}),
    ...extra,
  })

  async function raw(name: string, input: unknown) {
    return server.app.request(`/api/rpc/${name}`, {
      method: 'POST',
      headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(input ?? {}),
    })
  }

  return {
    headers,
    request: (path: string, init: RequestInit = {}) =>
      server.app.request(path, {
        ...init,
        headers: { ...headers(), ...(init.headers as Record<string, string>) },
      }),
    /** Calls a command and returns its output; throws with the error body on failure. */
    async call<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> {
      const res = await raw(name, input)
      const body = await res.json()
      if (!res.ok)
        throw Object.assign(new Error(`${name} → ${res.status} ${JSON.stringify(body)}`), body)
      return body as CommandOutput<N>
    },
    /** Calls a command expecting failure; returns status and error body. */
    async fail(name: CommandName, input: unknown): Promise<RpcError> {
      const res = await raw(name, input)
      const body = (await res.json()) as { error: RpcError['error'] }
      if (res.ok) throw new Error(`${name} unexpectedly succeeded: ${JSON.stringify(body)}`)
      return { status: res.status, error: body.error }
    },
  }
}

export type Client = ReturnType<typeof client>

/** Signs up through Better Auth and returns a client carrying the session cookie. */
export async function signUp(server: PaveServer, name: string, email: string): Promise<Client> {
  const res = await server.app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:8787' },
    body: JSON.stringify({ name, email, password: 'correct horse battery staple' }),
  })
  if (!res.ok) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`)
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  return client(server, cookie)
}

/** Posts to a Better Auth endpoint as the given client. */
export async function authPost(c: Client, path: string, body: unknown) {
  const res = await c.request(`/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:8787' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`)
  return res.json() as Promise<unknown>
}

/**
 * Invites `email` into `owner`'s active org with `role`, accepts as `who` and makes that org
 * their active one; returns the org id. Accounts mode only.
 */
export async function joinOrg(
  server: PaveServer,
  owner: Client,
  who: Client,
  email: string,
  role: 'viewer' | 'designer' | 'admin',
): Promise<string> {
  const { activeOrgId, user } = await owner.call('session.get', {})
  await owner.call('org.invite', { email, role })
  const ctx = await server.runtime.context({ userId: user.id, orgId: activeOrgId })
  const invitation = (await ctx.repo.invitations.many()).find(
    (i) => i.email === email && i.status === 'pending',
  )!
  await authPost(who, '/organization/accept-invitation', { invitationId: invitation.id })
  await authPost(who, '/organization/set-active', { organizationId: activeOrgId })
  return activeOrgId
}
