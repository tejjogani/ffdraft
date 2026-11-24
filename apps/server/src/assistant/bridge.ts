/**
 * Client tools: calls only a studio window can answer (look through its viewport, read or change
 * what is on screen). The server asks the run's user with a targeted `client.request` event: the
 * window that sent the message when it is still connected, else every window of theirs. The first
 * window that succeeds answers; a window that cannot (that piece is not open there) says so, and
 * only when every window asked has said so does the call fail. No window, or no answer in time,
 * is a typed {@link NoWindow} error the caller can fall back from (a capture is then drawn on the
 * server) or show the model.
 */
import { type ClientToolName, clientTools } from '@pave/schema'
import { z } from 'zod'
import { type Ctx, publish } from '../context'
import { AppError, notFound } from '../errors'
import { createId } from '../ids'

/** How long a window has to answer (a capture waits for the kernel and renders). */
export const CLIENT_TIMEOUT_MS = 60_000

/** No window could answer: none open, every one said it cannot, or none answered in time. */
export class NoWindow extends AppError {
  constructor(message: string) {
    super('conflict', message)
    this.name = 'NoWindow'
  }
}

interface Pending {
  orgId: string
  userId: string
  tool: ClientToolName
  /** Windows the request reached; when all of them answered with an error, it fails. */
  expected: number
  errors: string[]
  resolve(output: unknown): void
  reject(err: unknown): void
}

export class ClientBridge {
  readonly #pending = new Map<string, Pending>()

  async request(
    ctx: Ctx,
    call: {
      runId: string
      clientId: string | null
      tool: ClientToolName
      input: unknown
      signal: AbortSignal
      /** For a capture: the committed design version the window must show first. */
      atVersion?: number | null
      timeoutMs?: number
    },
  ): Promise<unknown> {
    const to = { userId: ctx.user.id, ...(call.clientId ? { clientId: call.clientId } : {}) }
    if (!ctx.events.isConnected(ctx.orgId, { userId: ctx.user.id }))
      throw new NoWindow(
        `${call.tool} needs an open Pavé window, and the designer has none open right now. Go on without it, or ask them to open Pavé.`,
      )
    call.signal.throwIfAborted()
    const requestId = createId('req')
    const answer = new Promise<unknown>((resolve, reject) => {
      this.#pending.set(requestId, {
        orgId: ctx.orgId,
        userId: ctx.user.id,
        tool: call.tool,
        expected: Number.POSITIVE_INFINITY,
        errors: [],
        resolve,
        reject,
      })
    })
    const timer = setTimeout(
      () =>
        this.#settle(requestId, (p) =>
          p.reject(
            new NoWindow(
              `The Pavé window did not answer ${call.tool} in time${p.errors.length ? ` (${p.errors.join('; ')})` : ''}. Go on without it.`,
            ),
          ),
        ),
      call.timeoutMs ?? CLIENT_TIMEOUT_MS,
    )
    const onAbort = () => this.#settle(requestId, (p) => p.reject(call.signal.reason))
    call.signal.addEventListener('abort', onAbort, { once: true })
    try {
      const reached = publish(
        ctx,
        {
          type: 'client.request',
          requestId,
          runId: call.runId,
          tool: call.tool,
          input: call.input,
          ...(call.atVersion !== undefined ? { atVersion: call.atVersion } : {}),
        },
        to,
      )
      const p = this.#pending.get(requestId)
      if (p) {
        // Windows answer on later turns of the event loop, so the count is in place before any.
        p.expected = reached
        if (reached === 0)
          this.#settle(requestId, (q) =>
            q.reject(
              new NoWindow(`${call.tool} needs an open Pavé window, and none is connected.`),
            ),
          )
      }
      return await answer
    } finally {
      clearTimeout(timer)
      call.signal.removeEventListener('abort', onAbort)
      this.#pending.delete(requestId)
    }
  }

  /** A window's answer. Only the user the request was for can answer it; the first success wins. */
  respond(
    who: { orgId: string; userId: string },
    answer: { requestId: string; output?: unknown; error?: string },
  ): void {
    const p = this.#pending.get(answer.requestId)
    if (!p || p.orgId !== who.orgId || p.userId !== who.userId)
      throw notFound('Client request', answer.requestId)
    if (answer.error !== undefined) {
      p.errors.push(answer.error)
      if (p.errors.length >= p.expected)
        this.#settle(answer.requestId, (q) =>
          q.reject(
            new NoWindow(
              `No Pavé window could do ${q.tool}: ${[...new Set(q.errors)].join('; ')}.`,
            ),
          ),
        )
      return
    }
    this.#settle(answer.requestId, (q) => {
      const checked = clientTools[q.tool].output.safeParse(answer.output)
      if (!checked.success)
        return q.reject(
          new AppError(
            'internal',
            `The Pavé window answered ${q.tool} with something unexpected: ${z.prettifyError(checked.error)}`,
          ),
        )
      q.resolve(checked.data)
    })
  }

  #settle(requestId: string, fn: (p: Pending) => void): void {
    const p = this.#pending.get(requestId)
    if (!p) return
    this.#pending.delete(requestId)
    fn(p)
  }
}
