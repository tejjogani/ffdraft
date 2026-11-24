import type { Actor, CommandInput, CommandName, CommandOutput } from '@pave/schema'
import type { BlobStore } from './assets/blob-store'
import type { Auth } from './auth/auth'
import { effectiveRole } from './auth/roles'
import type { Config } from './config'
import type { Ctx } from './context'
import type { Database } from './db/client'
import { AppError, forbidden } from './errors'
import type { EventBus } from './events'
import { Repo } from './repo'
import { AccountRepo } from './repo/account'
import { recover, type Unfinished, unfinished } from './recovery'
import { execute } from './rpc/execute'
import type { ServiceRegistry } from './services'

export interface RuntimeDeps {
  config: Config
  database: Database
  auth: Auth
  blobs: BlobStore
  services: ServiceRegistry
  events: EventBus
  /** Local mode's single identity; null in accounts mode. */
  local: { userId: string; orgId: string } | null
}

type Membership = Awaited<ReturnType<AccountRepo['memberships']>>[number]

/**
 * The server's core, independent of HTTP: builds request contexts and runs commands. The
 * assistant runtime uses it directly —
 *
 *   const ctx = await runtime.context({ userId, orgId, actor: { type: 'agent', runId, toolCallId, model } })
 *   const { change } = await runtime.invoke('design.apply', { pieceId, label, ops }, ctx)
 *
 * — so agent calls get the same validation, permissions, audit and trace attribution as people.
 * A context carries no closure over itself: `{ ...ctx, actor }` acts as `actor` all the way down.
 */
export class Runtime {
  readonly config: Config
  readonly auth: Auth
  readonly blobs: BlobStore
  readonly services: ServiceRegistry
  readonly events: EventBus
  readonly local: RuntimeDeps['local']
  readonly #database: Database

  constructor(deps: RuntimeDeps) {
    this.config = deps.config
    this.auth = deps.auth
    this.blobs = deps.blobs
    this.services = deps.services
    this.events = deps.events
    this.local = deps.local
    this.#database = deps.database
  }

  /** Runs a command in-process. Input is validated exactly as over HTTP. */
  invoke<N extends CommandName>(
    name: N,
    input: CommandInput<N>,
    ctx: Ctx,
  ): Promise<CommandOutput<N>> {
    return this.execute(name, input, ctx) as Promise<CommandOutput<N>>
  }

  /** {@link invoke} for untyped input, e.g. a request body or a model's tool call. */
  execute(name: CommandName, input: unknown, ctx: Ctx): Promise<unknown> {
    return this.#execute(name, input, ctx)
  }

  // Bound once and shared by every context; it closes over the runtime, never over a context.
  readonly #execute = (name: CommandName, input: unknown, ctx: Ctx): Promise<unknown> =>
    execute(name, input, ctx, { validateOutputs: this.config.validateOutputs })

  /**
   * A context for `userId` acting in `orgId`, with their role there. Rejects with 403 if they are
   * not a member. `actor` defaults to the user themself.
   */
  context(opts: { userId: string; orgId: string; actor?: Actor }): Promise<Ctx> {
    return this.#build(opts.userId, (ms) => ms.find((m) => m.org.id === opts.orgId), opts.actor)
  }

  /**
   * Jobs and assistant runs left live across all orgs — system scope, for boot recovery only.
   * Each names the org and user it belongs to, so a context can be rebuilt for it.
   */
  unfinished(): Promise<Unfinished[]> {
    return unfinished(this.#database.db)
  }

  /**
   * Hands every unfinished job and run to its service's `resume`, as the user and actor it
   * belongs to; what no service can resume is failed as interrupted. `createApp` calls it once.
   */
  recover(): Promise<void> {
    return recover(this, this.#database.db)
  }

  /** The context for an HTTP request: the local identity, or the Better Auth session's user. */
  async contextForRequest(headers: Headers): Promise<Ctx> {
    if (this.local) return this.context(this.local)
    const session = await this.auth.api.getSession({ headers })
    if (!session) throw new AppError('unauthorized', 'Sign in to continue')
    const active = session.session.activeOrganizationId
    // A stale or missing active organisation falls back to the first one the user belongs to.
    return this.#build(session.user.id, (ms) => ms.find((m) => m.org.id === active) ?? ms[0])
  }

  async #build(
    userId: string,
    pick: (ms: Membership[]) => Membership | undefined,
    actor?: Actor,
  ): Promise<Ctx> {
    const db = this.#database.db
    const account = new AccountRepo(db, userId)
    const [user, memberships] = await Promise.all([account.user(), account.memberships()])
    if (!user) throw new AppError('unauthorized', 'Unknown user')
    const membership = pick(memberships)
    if (!membership) throw forbidden('You are not a member of this organisation')
    const ctx: Ctx = {
      user: { id: user.id, name: user.name, email: user.email, image: user.image },
      orgId: membership.org.id,
      role: effectiveRole(membership.role),
      actor: actor ?? { type: 'user', id: user.id },
      repo: new Repo(db, membership.org.id),
      account,
      services: this.services,
      blobs: this.blobs,
      events: this.events,
      authMode: this.config.auth,
      execute: this.#execute,
    }
    return ctx
  }
}
