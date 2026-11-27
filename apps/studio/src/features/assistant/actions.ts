/**
 * Talking to the assistant: sending a message (or starting an AI job), answering an approval,
 * stopping, pausing and resuming. One place builds `threads.send` from the dock's state, so the
 * dock, the home composer, the stage buttons and Ask AI all send the same way.
 */
import type { AssistantTier, CommandInput, JobStage } from '@pave/schema'
import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { clientId } from '../../lib/events'
import { invalidateFor, queryClient, useRpcMutation } from '../../lib/query'
import { type RpcError, rpc } from '../../lib/rpc'
import { useCurrentView } from '../../lib/use-current-view'
import { type AssistantContext, useAssistant } from '../../stores/assistant'
import { resolveProjectThread } from './project-thread'
import { currentRenderShot } from './ui-tools'

/** A fresh id for a message, so a retried send stores it once. */
export const newMessageId = (): string =>
  `m${[...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, '0')).join('')}`

export interface SendOptions {
  /** Start an AI job for a stage of the piece. */
  job?: { stage: JobStage; goal?: string }
  /** Override the conversation: null starts a new one. */
  threadId?: string | null
  /** Override the piece the message is about. */
  pieceId?: string
  /** Override the tier (e.g. Retry on Standard). */
  tier?: AssistantTier
  /** Send without the composer's photos and selection (a starter, Retry, Continue). */
  bare?: boolean
  /** Photos to send instead of the composer's (a job started from a photo). */
  attachments?: string[]
  referenceIds?: string[]
  boardId?: string
  clientMessageId?: string
}

/** Sends from the dock's state: its conversation, chips, photos and tier. */
export function useSend(page: AssistantContext) {
  const router = useRouter()
  const isCurrent = useCurrentView()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<RpcError | null>(null)
  const send = async (text: string, opts: SendOptions = {}) => {
    const s = useAssistant.getState()
    const usePage = !s.dropPageContext
    const pieceId =
      opts.pieceId ?? page.pieceId ?? (opts.bare ? undefined : s.selection?.pieceId) ?? undefined
    const sceneId = usePage ? currentRenderShot(router.state.location, pieceId) : null
    const photos = opts.attachments ?? (opts.bare ? [] : s.attachments.map((a) => a.id))
    setPending(true)
    setError(null)
    try {
      const threadId =
        opts.threadId !== undefined
          ? opts.threadId
          : pieceId
            ? await resolveProjectThread(pieceId)
            : s.activeThreadId
      const tier = opts.tier ?? (threadId ? s.tierByThread[threadId] : s.draftTier) ?? undefined
      const boardId =
        opts.boardId ?? (usePage && pieceId === (page.pieceId ?? undefined) ? page.boardId : null)
      const input: CommandInput<'threads.send'> = {
        ...(threadId ? { threadId } : {}),
        text,
        attachments: photos,
        ...(opts.referenceIds ? { referenceIds: opts.referenceIds } : {}),
        context: {
          ...(pieceId ? { pieceId } : {}),
          ...(boardId ? { boardId } : {}),
          ...(sceneId ? { sceneId } : {}),
          selection:
            !opts.bare && s.selection && s.selection.pieceId === pieceId ? s.selection.nodeIds : [],
          ...(pieceId && page.stage ? { stage: page.stage } : {}),
        },
        ...(tier ? { tier } : {}),
        ...(opts.job ? { job: opts.job } : {}),
        clientId,
        clientMessageId: opts.clientMessageId ?? newMessageId(),
      }
      const out = await rpc.call('threads.send', input)
      invalidateFor(queryClient, 'runs')
      if (!isCurrent()) return out
      useAssistant.getState().setThreadPieceId(out.thread.context.pieceId ?? pieceId ?? null)
      if (opts.bare)
        // A starter, Retry or a stage's job: the person's draft in the composer stays.
        useAssistant.setState((st) => ({
          activeThreadId: out.thread.id,
          showThreads: false,
          tierByThread: tier ? { ...st.tierByThread, [out.thread.id]: tier } : st.tierByThread,
        }))
      else useAssistant.getState().sent(out.thread.id, out.run.id, photos, tier ?? null)
      return out
    } catch (e) {
      setError(e as RpcError)
      throw e
    } finally {
      setPending(false)
    }
  }
  return { send, pending, error, clearError: () => setError(null) }
}

/** Approve or decline what a run waits on; stop it; pause, resume or accept an AI job. */
export function useRunActions() {
  const isCurrent = useCurrentView()
  const silent = { meta: { silent: true } } as const
  const decide = useRpcMutation('runs.decide', silent)
  const cancel = useRpcMutation('runs.cancel', silent)
  const pause = useRpcMutation('runs.pause', silent)
  const accept = useRpcMutation('runs.accept', silent)
  const resume = useRpcMutation('runs.resume', {
    ...silent,
    onMutate: () => isCurrent,
    onSuccess: (out, _input, stillHere) => {
      if (stillHere?.()) useAssistant.getState().openThread(out.thread.id)
    },
  })
  return {
    decide,
    cancel,
    pause,
    accept,
    resume: (runId: string, redoStepId?: string) =>
      resume.mutateAsync({
        runId,
        ...(redoStepId ? { redoStepId } : {}),
        clientId,
        clientMessageId: newMessageId(),
      }),
    resuming: resume.isPending,
  }
}
