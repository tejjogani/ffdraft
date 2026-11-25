/**
 * The one typed client for the server's command API. Every call site gets its input and output
 * types from the command registry in @pave/schema; nothing else in the studio calls fetch for
 * JSON (auth goes through `postJson` too).
 */
import type { CommandInput, CommandName, CommandOutput } from '@pave/schema'

export class RpcError extends Error {
  override readonly name = 'RpcError'
  constructor(
    readonly code: string,
    message: string,
    /** HTTP status; 0 when the server could not be reached. */
    readonly status: number,
    /** The rest of the error body, e.g. what a `plan_limit` was about. */
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message)
  }
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
  } catch {
    throw new RpcError('network', 'Can’t reach the Pavé server.', 0)
  }
  const text = await res.text()
  const json = text ? safeParse(text) : null
  if (!res.ok) {
    const err =
      (json as {
        error?: { code?: string; message?: string; [k: string]: unknown }
        message?: string
      } | null) ?? {}
    const { code, message, ...details } = err.error ?? {}
    throw new RpcError(
      code ?? (res.status === 401 ? 'unauthorized' : 'http_error'),
      message ?? err.message ?? res.statusText ?? 'Request failed',
      res.status,
      details,
    )
  }
  return json as T
}

const safeParse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export const rpc = {
  call: <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> =>
    postJson<CommandOutput<N>>(`/api/rpc/${name}`, input),
}

/**
 * Read-only commands. `CommandDef.kind` is typed as the union, so this can't be derived from
 * types alone; `rpc.test.ts` checks it against the registry's runtime `kind`.
 */
export const QUERY_NAMES = [
  'session.get',
  'org.members',
  'org.settings.get',
  'collections.list',
  'pieces.list',
  'pieces.get',
  'design.history',
  'design.evaluate',
  'boards.list',
  'boards.get',
  'references.search',
  'references.pins',
  'references.lineage',
  'references.similar',
  'references.estimate',
  'mesh3d.estimate',
  'mesh3d.list',
  'mesh3d.get',
  'scenes.list',
  'scenes.suggest',
  'scenes.capture',
  'chat.ask',
  'scenes.history',
  'renders.engine',
  'models.estimatePortraits',
  'shots.get',
  'shots.estimate',
  'renders.list',
  'renders.get',
  'renders.estimate',
  'models.list',
  'shots.list',
  'production.list',
  'threads.list',
  'threads.get',
  'traces.runs',
  'traces.run',
  'usage.summary',
  'assistant.setup.get',
  'assistant.key.test',
  'plan.get',
] as const satisfies readonly CommandName[]

export type QueryName = (typeof QUERY_NAMES)[number]
export type MutationName = Exclude<CommandName, QueryName>

export const isUnauthorized = (e: unknown): boolean => e instanceof RpcError && e.status === 401
