/**
 * Client tools: calls only a studio window can answer (look through its viewport, read or change
 * what is on screen). The server asks one window of the run's user with a targeted
 * `client.request` event — the window that sent the message first, else any of theirs — and the
 * window answers with `client.respond`. The first answer wins; no window, or no answer in time,
 * is a typed error the model reads.
 */
import { type ClientToolName, clientTools } from '@pave/schema'
import { z } from 'zod'
import { type Ctx, publish } from '../context'
import { AppError, notFound } from '../errors'
import { createId } from '../ids'

/** How long a window has to answer (a capture waits for the kernel and renders). */
export const CLIENT_TIMEOUT_MS = 60_000

interface Pending {
  orgId: string
  userId: string
  tool: ClientToolName
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
      timeoutMs?: number
    },
  ): Promise<unknown> {
    const to = { userId: ctx.user.id, ...(call.clientId ? { clientId: call.clientId } : {}) }
    if (!ctx.events.isConnected(ctx.orgId, { userId: ctx.user.id }))
      throw new AppError(
        'conflict',
        `${call.tool} needs an open Pavé window, and the designer has none open right now. Go on without it, or ask them to open Pavé.`,
      )
    const requestId = createId('req')
    const answer = new Promise<unknown>((resolve, reject) => {
      this.#pending.set(requestId, {
        orgId: ctx.orgId,
        userId: ctx.user.id,
        tool: call.tool,
        resolve,
        reject,
      })
    })
    const timer = setTimeout(
      () =>
        this.#settle(requestId, (p) =>
          p.reject(
            new AppError(
              'conflict',
              `The Pavé window did not answer ${call.tool} in time. Go on without it.`,
            ),
          ),
        ),
      call.timeoutMs ?? CLIENT_TIMEOUT_MS,
    )
    const onAbort = () => this.#settle(requestId, (p) => p.reject(call.signal.reason))
    call.signal.addEventListener('abort', onAbort, { once: true })
    try {
      publish(
        ctx,
        {
          type: 'client.request',
          requestId,
          runId: call.runId,
          tool: call.tool,
          input: call.input,
        },
        to,
      )
      return await answer
    } finally {
      clearTimeout(timer)
      call.signal.removeEventListener('abort', onAbort)
      this.#pending.delete(requestId)
    }
  }

  /** A window's answer. Only the user the request was for can answer it; the first answer wins. */
  respond(
    who: { orgId: string; userId: string },
    answer: { requestId: string; output?: unknown; error?: string },
  ): void {
    const p = this.#pending.get(answer.requestId)
    if (!p || p.orgId !== who.orgId || p.userId !== who.userId)
      throw notFound('Client request', answer.requestId)
    this.#settle(answer.requestId, (q) => {
      if (answer.error !== undefined)
        return q.reject(new AppError('conflict', `The Pavé window said: ${answer.error}`))
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
