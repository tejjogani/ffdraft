/**
 * The one typed client for the server's command API. Every call site gets its input and output
 * types from the command registry in @pave/schema; nothing else in the studio calls fetch for
 * JSON (auth goes through `postJson` too).
 */
import type { CommandInput, CommandName, CommandOutput, commands } from '@pave/schema'

export class RpcError extends Error {
  override readonly name = 'RpcError'
  constructor(
    readonly code: string,
    message: string,
    /** HTTP status; 0 when the server could not be reached. */
    readonly status: number,
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
    const err = (json as { error?: { code?: string; message?: string }; message?: string } | null) ?? {}
    throw new RpcError(
      err.error?.code ?? (res.status === 401 ? 'unauthorized' : 'http_error'),
      err.error?.message ?? err.message ?? res.statusText ?? 'Request failed',
      res.status,
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

type Kind<N extends CommandName> = (typeof commands)[N]['kind']
export type QueryName = { [N in CommandName]: Kind<N> extends 'query' ? N : never }[CommandName]
export type MutationName = { [N in CommandName]: Kind<N> extends 'mutation' ? N : never }[CommandName]

export const isUnauthorized = (e: unknown): boolean => e instanceof RpcError && e.status === 401
