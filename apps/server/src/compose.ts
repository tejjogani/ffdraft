/**
 * How this deployment is put together: the engines and extra routes `main.ts` starts the server
 * with. Each workstream fills in its own section, so no two teams edit `app.ts` or `main.ts`:
 *
 *  - assistant (docs/plans/assistant.md): `assistant`, built with the runtime; the run stream and
 *    `/mcp` routes; post-commit feedback detection through `runtime.events.subscribeAll`.
 *  - CAD workspace (docs/plans/cad-workspace.md): `geometry` (the kernel).
 *  - ideate and freeform (docs/plans/ideate-and-freeform.md): `search`, `capture`, `imageGen`,
 *    `freeform`, `mesh3d`, `embedding`, `depth`; the image provider family lives in
 *    `packages/ideation` and is shared with `onModel` (see the note in ./services).
 *  - render and models (docs/plans/render-and-models.md): `renderQueue`, `renderEngine`,
 *    `onModel`, `vision`.
 *
 * Until a section is filled in, its commands answer 501 and `session.get` reports them absent.
 */
import type { CreateAppOptions } from './app'
import type { Runtime } from './runtime'
import type { Services } from './services'

/** Engines configured from the environment (API keys, local binaries). */
export function servicesFromEnv(_env: NodeJS.ProcessEnv, _runtime: Runtime): Partial<Services> {
  return {}
}

/** The options `main.ts` passes to `createApp`. */
export function compose(env: NodeJS.ProcessEnv = process.env): CreateAppOptions {
  return { services: (runtime) => servicesFromEnv(env, runtime) }
}
