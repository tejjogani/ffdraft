import type { Actor, Role, User } from '@pave/schema'
import type { BlobStore } from './assets/blob-store'
import type { EventBus, ServerEvent } from './events'
import type { Repo } from './repo'
import type { AccountRepo } from './repo/account'
import type { ServiceRegistry } from './services'

/**
 * Everything a command handler may touch, bound to one user acting in one organisation.
 * There is deliberately no raw database handle here: domain data is reached through `repo`
 * (scoped to `orgId`) and the user's own memberships through `account`.
 */
export interface Ctx {
  readonly user: User
  readonly orgId: string
  readonly role: Role
  /** Who the change is attributed to: the user, an assistant run acting for them, or the system. */
  readonly actor: Actor
  readonly repo: Repo
  readonly account: AccountRepo
  readonly services: ServiceRegistry
  readonly blobs: BlobStore
  readonly events: EventBus
}

export const publish = (ctx: Ctx, event: ServerEvent): void => ctx.events.publish(ctx.orgId, event)

/** The run an agent actor belongs to, for attributing usage and generated content. */
export const actorRunId = (actor: Actor): string | null =>
  actor.type === 'agent' ? actor.runId : null
