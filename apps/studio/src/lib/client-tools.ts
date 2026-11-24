/**
 * Handlers for client tools (`@pave/schema` `clientTools`): operations only a studio window can
 * perform, such as looking through its viewport. Screens register handlers while they can serve
 * them; whatever relays the assistant's requests calls `runClientTool`, which validates the
 * input against the shared schema first.
 */
import {
  type ClientToolName,
  type ClientToolOutput,
  type ClientToolParsedInput,
  clientTools,
} from '@pave/schema'

type Handler<N extends ClientToolName> = (
  input: ClientToolParsedInput<N>,
) => Promise<ClientToolOutput<N>>

const handlers = new Map<ClientToolName, Handler<never>>()

/** Serves `name` until the returned function is called. A later registration takes over. */
export function registerClientTool<N extends ClientToolName>(
  name: N,
  handler: Handler<N>,
): () => void {
  handlers.set(name, handler as unknown as Handler<never>)
  return () => {
    if (handlers.get(name) === (handler as unknown)) handlers.delete(name)
  }
}

export const canRunClientTool = (name: ClientToolName): boolean => handlers.has(name)

/** Runs a client tool with untrusted input; rejects when the input is invalid or nothing serves it. */
export async function runClientTool<N extends ClientToolName>(
  name: N,
  input: unknown,
): Promise<ClientToolOutput<N>> {
  const handler = handlers.get(name) as Handler<N> | undefined
  if (!handler) throw new Error(`No open screen can run ${name}`)
  const parsed = clientTools[name].input.parse(input) as ClientToolParsedInput<N>
  return handler(parsed)
}

// Development and e2e hook: lets a test call a client tool the way the assistant's relay will.
if (import.meta.env.DEV)
  (window as { paveClientTools?: unknown }).paveClientTools = { run: runClientTool }
