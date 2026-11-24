/**
 * The assistant, put together: the run loop and driver, the key and tier setup, the run event
 * stream, client tools and the feedback hook. `compose.ts` builds it from the environment;
 * tests build it with a scripted model and a fake key check.
 *
 *   const assistant = createAssistant(runtime, { env })
 *   createApp({ services: (rt) => assistant(rt).services, routes: … })
 */
import { resolveTiers } from '@pave/agent'
import { anthropicModel, checkKey } from '@pave/agent/anthropic'
import type { MiddlewareHandler } from 'hono'
import { NotConfiguredError } from '../errors'
import type { App, Env } from '../http/types'
import type { Runtime } from '../runtime'
import type { Services } from '../services'
import { ClientBridge } from './bridge'
import { Driver } from './driver'
import { FeedbackHook } from './feedback'
import type { AssistantDeps, ModelFactory } from './host'
import { KeyStore } from './keys'
import { mountRunEvents } from './routes'
import { scriptedFactory, scriptedFromEnv } from './scripted'
import { Assistant } from './service'
import { AssistantSetupImpl, type KeyChecker } from './setup'

export interface AssistantOptions {
  /** apps/server/.env and the environment: the key, tier overrides, PAVE_ASSISTANT. */
  env?: Readonly<Record<string, string | undefined>>
  /** Replaces the Claude client (tests); it receives the key the run would use. */
  model?: ModelFactory
  /** Replaces the key check against the Models API (tests). */
  checkKey?: KeyChecker
}

export interface AssistantParts {
  services: Pick<Services, 'assistantSetup'>
  /** Mounts `GET /api/runs/:id/events`. */
  routes(app: App, withCtx: MiddlewareHandler<Env>): void
  driver: Driver
  feedback: FeedbackHook
}

const realModel: ModelFactory = ({ apiKey }) => {
  if (!apiKey)
    throw new NotConfiguredError(
      'assistant',
      'The assistant needs a Claude API key. An owner or admin can add one in Settings, AI.',
    )
  return anthropicModel({ apiKey })
}

export function createAssistant(runtime: Runtime, opts: AssistantOptions = {}): AssistantParts {
  const env = opts.env ?? process.env
  const scripted = scriptedFromEnv(env)
  if (scripted)
    console.warn(
      `\n!!! PAVE_ASSISTANT=scripted:${scripted.name} — the assistant is a TEST SCRIPT, not Claude. ` +
        'Every answer is canned. Unset PAVE_ASSISTANT for real use. !!!\n',
    )
  for (const w of resolveTiers(null, env).warnings) console.warn(`Assistant settings: ${w}`)

  const keys = new KeyStore(runtime, env.ANTHROPIC_API_KEY ?? null)
  const driver = new Driver()
  const deps: AssistantDeps = {
    runtime,
    driver,
    bridge: new ClientBridge(),
    keys,
    model: opts.model ?? (scripted ? scriptedFactory(scripted.fixture) : realModel),
    scripted: scripted !== null,
    env,
    clients: new Map(),
  }
  const feedback = new FeedbackHook(runtime)
  // `setup` decides availability; the assistant asks it, and it registers the assistant.
  let setup: AssistantSetupImpl | null = null
  const assistant = new Assistant(deps, (orgId) => setup?.hasKey(orgId) ?? false)
  setup = new AssistantSetupImpl({
    runtime,
    keys,
    assistant,
    check: opts.checkKey ?? ((apiKey) => checkKey({ apiKey })),
    env,
    scripted: scripted !== null,
    dispose: async () => {
      await driver.dispose()
      await feedback.dispose()
    },
  })
  return {
    // `assistant` is registered by `setup` once it knows a key exists (see AssistantSetupImpl).
    services: { assistantSetup: setup },
    routes: (app, withCtx) => mountRunEvents(app, driver, withCtx),
    driver,
    feedback,
  }
}
