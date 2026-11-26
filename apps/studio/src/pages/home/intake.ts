import type { AssistantTier, CommandInput, Reference } from '@pave/schema'
import { newMessageId } from '../../features/assistant/actions'
import { classifyBoardFile, MODEL_EXTENSIONS } from '../../features/ideate/board'
import { clientId } from '../../lib/events'
import { invalidateFor, queryClient } from '../../lib/query'
import { rpc } from '../../lib/rpc'
import { useAssistant } from '../../stores/assistant'

export interface IntakeSearch {
  intake?: string
  thread?: string
  concept?: string
  visual?: string
  brainstorm?: string
}

const string = (value: unknown) =>
  typeof value === 'string' && value.length > 0 ? value : undefined
export const intakeSearch = (search: Record<string, unknown>): IntakeSearch =>
  string(search.intake)
    ? {
        intake: string(search.intake),
        thread: string(search.thread),
        concept: string(search.concept),
        visual: string(search.visual),
      }
    : string(search.brainstorm)
      ? { brainstorm: string(search.brainstorm), thread: string(search.thread) }
      : {}

export const intakeFiles = {
  accept: ['image/*', ...MODEL_EXTENSIONS.map((ext) => `.${ext}`)].join(','),
  model: (name: string) => classifyBoardFile(name) === 'model',
}

export const isConcept = (ref: Reference) =>
  ref.type === 'generated' || ref.tags.includes('Design concept')

export function chainFromBrief(brief: string): string | null {
  if (/\b(?:no|without(?: a)?)\s+chain\b/i.test(brief)) return 'No chain'
  const match = brief.match(/\b(cuban|cable|curb|figaro|rope|box|tennis)\s+(?:link\s+)?chain\b/i)
  return match ? `${match[1]![0]!.toUpperCase()}${match[1]!.slice(1).toLowerCase()} chain` : null
}

interface SendIntake {
  pieceId: string
  boardId: string
  threadId?: string
  text: string
  attachments?: string[]
  referenceIds?: string[]
  tier?: AssistantTier | null
  messageId?: string
  job?: CommandInput<'threads.send'>['job']
}

export async function sendIntake({
  pieceId,
  boardId,
  threadId,
  text,
  attachments,
  referenceIds,
  tier,
  messageId,
  job,
}: SendIntake) {
  const out = await rpc.call('threads.send', {
    threadId,
    text,
    attachments,
    referenceIds,
    tier: tier ?? undefined,
    context: { pieceId, boardId, ...(job ? {} : { intake: true }) },
    job,
    clientId,
    clientMessageId: messageId ?? newMessageId(),
  })
  if (attachments?.length) {
    useAssistant.setState((state) => ({
      sentPhotos: { ...state.sentPhotos, [out.run.id]: attachments },
    }))
  }
  invalidateFor(queryClient, 'runs')
  return out
}

export const firstMessageId = (pieceId: string) => `intake:${pieceId}`
