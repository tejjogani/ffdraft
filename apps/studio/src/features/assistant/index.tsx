/**
 * Feature folder owned by the assistant workstream. Contract: `AssistantPanel`, the conversation
 * UI inside the dock (the dock, its header, resize and mod+j live in app/), and `openAssistant`
 * in stores/assistant.ts for anything that hands the assistant a piece and a selection.
 *
 * The panel shows the no-key form until the organisation has a key; then the conversation (or
 * the thread list, or the empty state's starters) above the one composer.
 */
import type { JobStage } from '@pave/schema'
import { AiMark } from '@pave/ui'
import { useEffect } from 'react'
import { useRegisterCommands } from '../../lib/commands'
import { useRpc } from '../../lib/query'
import { useSession } from '../../lib/session'
import { type AssistantContext, useAssistant } from '../../stores/assistant'
import { useRunActions, useSend } from './actions'
import { Composer } from './Composer'
import { ContextChips } from './ContextChips'
import { Conversation } from './Conversation'
import { NoKey } from './NoKey'
import { ThreadList } from './ThreadList'
import { TierPicker } from './TierPicker'

export { openAssistant } from '../../stores/assistant'

interface Starter {
  label: string
  job?: JobStage
}

/** Three starters that fit where the person is. */
function starters(page: AssistantContext, piece: { hasDesign: boolean; hasSpec: boolean } | null) {
  if (!page.pieceId || !piece)
    return [
      { label: '1.5 ct oval, hidden halo, 18k yellow' },
      { label: 'Turn a logo into an iced pendant' },
      { label: 'Men’s signet with a family crest' },
    ] satisfies Starter[]
  if (!piece.hasDesign)
    return [
      { label: 'Make the CAD with AI', job: 'cad' },
      {
        label: piece.hasSpec
          ? 'What would you change in the spec?'
          : 'Write the spec from the brief',
      },
      { label: 'Propose directions with AI', job: 'design' },
    ] satisfies Starter[]
  return [
    { label: 'Check it for production' },
    { label: 'Make the band 0.2 mm thinner' },
    { label: 'Render with AI', job: 'render' },
  ] satisfies Starter[]
}

export function AssistantPanel({ context }: { context: AssistantContext }) {
  const { capabilities } = useSession()
  if (!capabilities.assistant) return <NoKey />
  return <Panel context={context} />
}

function Panel({ context }: { context: AssistantContext }) {
  const threadId = useAssistant((s) => s.activeThreadId)
  const showThreads = useAssistant((s) => s.showThreads)
  const draft = useAssistant((s) => s.draft)
  const attachments = useAssistant((s) => s.attachments)
  const focusNonce = useAssistant((s) => s.focusNonce)
  const tierByThread = useAssistant((s) => s.tierByThread)
  const draftTier = useAssistant((s) => s.draftTier)
  const st = useAssistant.getState
  const { send, pending, error, clearError } = useSend(context)
  const actions = useRunActions()

  const thread = useRpc('threads.get', { id: threadId ?? '' }, { enabled: !!threadId })
  const run = thread.data?.run ?? null
  const running = run?.status === 'running'
  // A conversation that no longer exists (deleted elsewhere) gives way to a new one.
  useEffect(() => {
    if (thread.error?.status === 404) useAssistant.getState().openThread(null)
  }, [thread.error])

  useRegisterCommands(
    running && run
      ? [
          {
            id: 'assistant.stop',
            title: 'Stop the assistant',
            group: 'Assistant',
            shortcut: 'escape',
            inEditable: true,
            run: () => actions.cancel.mutate({ runId: run.id }),
          },
        ]
      : [],
  )

  const piece = useRpc('pieces.get', { id: context.pieceId ?? '' }, { enabled: !!context.pieceId })
  const submit = () => {
    const text = draft.trim()
    if (!text) return
    clearError()
    void send(text).catch(() => {})
  }

  const tier = threadId ? (tierByThread[threadId] ?? run?.tier ?? null) : draftTier
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        {showThreads ? (
          <ThreadList />
        ) : threadId ? (
          <Conversation threadId={threadId} page={context} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <AiMark className="size-5" />
            <p className="font-serif text-[22px] leading-7">How can I help?</p>
            <p className="text-sm text-fg-muted">
              Describe a piece or drop a photo of one; edit the CAD by asking; select a part and ask
              about it.
            </p>
            <div className="mt-2 flex w-full flex-col gap-1.5">
              {starters(
                context,
                piece.data
                  ? { hasDesign: piece.data.design.order.length > 0, hasSpec: !!piece.data.spec }
                  : null,
              ).map((s: Starter) => (
                <button
                  key={s.label}
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    void send(s.label, {
                      bare: true,
                      ...(s.job ? { job: { stage: s.job } } : {}),
                    }).catch(() => {})
                  }
                  className="flex h-8 items-center gap-2 rounded-md px-3 text-left text-sm text-fg-muted shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-bg-hover hover:text-fg"
                >
                  {s.job && <AiMark className="size-3" />}
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="p-3 pt-0">
        {error && (
          <p role="alert" className="mb-2 text-xs text-danger">
            {error.message}
          </p>
        )}
        <Composer
          value={draft}
          onChange={(v) => st().setDraft(v)}
          attachments={attachments}
          onAttach={(a) => st().addAttachments(a)}
          onRemoveAttachment={(id) => st().removeAttachment(id)}
          onSubmit={submit}
          sending={pending}
          focusNonce={focusNonce}
          placeholder={threadId ? 'Reply…' : 'Ask anything, or drop a photo…'}
          chips={<ContextChips page={context} />}
          tools={<TierPicker value={tier} onChange={(t) => st().setTier(threadId, t)} />}
        />
      </div>
    </div>
  )
}
