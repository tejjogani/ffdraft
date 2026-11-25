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
import { useEffect } from 'react'
import { onServerEvent } from './events'
import { rpc } from './rpc'

/** What the server adds to a request besides the tool's input. */
export interface ClientToolCall {
  /** For a capture: the design version the server committed, to wait for before drawing. */
  atVersion: number | null
}

type Handler<N extends ClientToolName> = (
  input: ClientToolParsedInput<N>,
  call: ClientToolCall,
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
  call: ClientToolCall = { atVersion: null },
): Promise<ClientToolOutput<N>> {
  const handler = handlers.get(name) as Handler<N> | undefined
  if (!handler) throw new Error(`No open screen in this window can run ${name}`)
  const parsed = clientTools[name].input.parse(input) as ClientToolParsedInput<N>
  return handler(parsed, call)
}

/**
 * Answers the assistant's client-tool requests addressed to this window (`client.request`),
 * with `client.respond`. A window that cannot run the tool says so, so the server can wait for
 * another window or draw a capture itself. Mount once, in the authenticated shell.
 */
export function useClientToolRelay(): void {
  useEffect(
    () =>
      onServerEvent('client.request', (e) => {
        void (async () => {
          try {
            const output = await runClientTool(e.tool, e.input, { atVersion: e.atVersion ?? null })
            await rpc.call('client.respond', { requestId: e.requestId, output })
          } catch (err) {
            const error = (err instanceof Error ? err.message : String(err)).slice(0, 2000)
            // Another window may already have answered; then this answer is not wanted.
            await rpc.call('client.respond', { requestId: e.requestId, error }).catch(() => {})
          }
        })()
      }),
    [],
  )
}

// Development and e2e hook: lets a test call a client tool the way the assistant's relay will.
if (import.meta.env.DEV)
  (window as { paveClientTools?: unknown }).paveClientTools = { run: runClientTool }
