import type { ModelClient } from '@pave/agent'
import type {
  Actor,
  AssistantModelId,
  CommandInput,
  CommandName,
  CommandOutput,
  PlanName,
  Role,
  Tokens,
  User,
} from '@pave/schema'
import type { BlobStore } from './assets/blob-store'
import type { AuthMode } from './config'
import type { EventAudience, EventBus, ServerEvent } from './events'
import type { Repo } from './repo'
import type { AccountRepo } from './repo/account'
import type { ServiceRegistry } from './services'

/**
 * Everything a command handler may touch, bound to one user acting in one organisation.
 * There is deliberately no raw database handle here: domain data is reached through `repo`
 * (scoped to `orgId`) and the user's own memberships through `account`.
 *
 * A Ctx is plain data with no closure over itself, so a copy with another actor is a context
 * for that actor: the assistant builds one per run and uses `{ ...ctx, actor }` per tool call,
 * and everything it runs — including nested commands through {@link invoke} or
 * `ServiceContext.invoke` — is attributed to and permitted as that actor.
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
  /** `local` (single-user desktop/self-host, no sign-in) or `accounts`. */
  readonly authMode: AuthMode
  readonly diaexPartnerApiUrl: string | null
  /**
   * This organisation on this install, as a fingerprint (an HMAC of its id under a key derived
   * from the auth secret): a .pave file says where it was saved without carrying the org's id.
   */
  readonly orgFingerprint: string
  /** PAVE_PLAN on a local install (testing): wins over the organisation's plan. */
  readonly planOverride: PlanName | null
  /** The command pipeline (role, validation, audit) for an explicit context; see {@link invoke}. */
  readonly execute: Execute
  /**
   * Aborted when whoever asked gives up, e.g. an assistant run is stopped mid-call. Long work
   * (a fit, a render on the server) passes it on; most commands are short and ignore it.
   */
  readonly signal?: AbortSignal
  /**
   * Inside an assistant run: the run's own Claude client and tier, for commands that make a
   * separate Claude call (an image brief, the check of generated images), so the call is billed
   * to the run. Outside a run, those commands use the organisation's default tier.
   */
  readonly claude?: ClaudeCall
}

/** A Claude client a command may use for a structured call, and where its spend goes. */
export interface ClaudeCall {
  readonly client: ModelClient
  readonly model: AssistantModelId
  /** Ledger key prefix: each call appends its own suffix, so a retry is metered once. */
  readonly key: string
  readonly runId: string | null
  /** Adds a call's tokens and cost to the run's totals (a no-op outside a run). */
  spent(tokens: Tokens, costUsd: number): Promise<void>
}

export type Execute = (name: CommandName, input: unknown, ctx: Ctx) => Promise<unknown>

/** Runs a command as the context's actor, e.g. `invoke(ctx, 'design.apply', …)`. */
export const invoke = <N extends CommandName>(
  ctx: Ctx,
  name: N,
  input: CommandInput<N>,
): Promise<CommandOutput<N>> => ctx.execute(name, input, ctx) as Promise<CommandOutput<N>>

/** A command runner already bound to one context, as services receive it. */
export type Invoke = <N extends CommandName>(
  name: N,
  input: CommandInput<N>,
) => Promise<CommandOutput<N>>

/** Publishes to the org, or with `to` only to one user (preferably one of their windows). */
export const publish = (ctx: Ctx, event: ServerEvent, to?: EventAudience): number =>
  ctx.events.publish(ctx.orgId, event, to)

/** The run an agent actor belongs to, for attributing usage and generated content. */
export const actorRunId = (actor: Actor): string | null =>
  actor.type === 'agent' ? actor.runId : null
