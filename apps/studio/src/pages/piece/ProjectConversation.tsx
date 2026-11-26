import type { AssistantTier, Piece, Reference } from '@pave/schema'
import {
  Button,
  buttonClass,
  Chip,
  Field,
  IconButton,
  InlineError,
  Skeleton,
  Textarea,
  toast,
} from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { useState } from 'react'
import { newMessageId } from '../../features/assistant/actions'
import { Composer } from '../../features/assistant/Composer'
import { Conversation } from '../../features/assistant/Conversation'
import {
  latestProjectThread,
  resolveProjectThread,
  selectProjectThread,
} from '../../features/assistant/project-thread'
import { addNote, type BoardTarget } from '../../features/ideate/actions'
import { clientId } from '../../lib/events'
import { invalidateFor, queryClient, useRpc } from '../../lib/query'
import { rpc } from '../../lib/rpc'
import { activeOrg, useSession } from '../../lib/session'
import { useCurrentView } from '../../lib/use-current-view'
import { type Attachment, useAssistant } from '../../stores/assistant'

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Try again in a moment.'

type ProjectConversationProps = {
  piece: Piece
  boardId?: string
  reference?: Reference
  onClearReference?: () => void
}

export function ProjectConversation({ piece, ...props }: ProjectConversationProps) {
  const session = useSession()
  const scope = `${session.activeOrgId}:${session.user.id}:${piece.id}`
  return <DesignConversation key={scope} pieceId={piece.id} {...props} />
}

function DesignConversation({
  pieceId,
  boardId,
  reference,
  onClearReference,
}: Omit<ProjectConversationProps, 'piece'> & { pieceId: string }) {
  const session = useSession()
  const role = activeOrg(session)?.role
  const canWrite = role !== undefined && role !== 'viewer' && role !== 'guest'
  const canChat = canWrite && session.capabilities.assistant
  const isCurrent = useCurrentView()
  const selected = useAssistant((state) =>
    state.threadPieceId === pieceId ? state.activeThreadId : null,
  )
  const recent = useRpc('threads.list', latestProjectThread(pieceId))
  const threadId = selected ?? recent.data?.[0]?.id ?? null
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [focus, setFocus] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const thread = useRpc(
    'threads.get',
    { id: threadId ?? '' },
    { enabled: Boolean(threadId), retry: false },
  )
  const activeThread =
    thread.data?.thread.context.pieceId === pieceId ? thread.data.thread.id : null
  const checking = Boolean(threadId ? thread.isPending : recent.isPending)
  const page = { pieceId, boardId, stage: 'design' as const }

  async function send(text: string, tier?: AssistantTier) {
    const message = text.trim()
    if (!canChat || pending || checking || !message) return
    setPending(true)
    setError('')
    try {
      const verified = await resolveProjectThread(pieceId)
      const photos = [
        ...(reference?.assetId ? [reference.assetId] : []),
        ...(tier ? [] : attachments.map(({ id }) => id)),
      ]
      const out = await rpc.call('threads.send', {
        ...(verified ? { threadId: verified } : {}),
        text: message,
        attachments: [...new Set(photos)].slice(0, 8),
        ...(reference ? { referenceIds: [reference.id] } : {}),
        context: { ...page, selection: [], brainstorm: true },
        ...(tier ? { tier } : {}),
        clientId,
        clientMessageId: newMessageId(),
      })
      if (isCurrent()) selectProjectThread(pieceId, out.thread.id)
      setDraft('')
      setAttachments([])
      invalidateFor(queryClient, 'threads')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <section
      id="design-conversation"
      aria-labelledby="design-conversation-heading"
      className="min-w-0 border-b border-line pb-6"
    >
      <h2 id="design-conversation-heading" className="text-lg font-semibold tracking-tight">
        Design conversation
      </h2>
      {checking && <Skeleton className="my-3 h-16 w-full" />}
      {activeThread && (
        <div className="my-3 rounded-lg border border-line bg-bg-subtle">
          <Conversation
            key={activeThread}
            threadId={activeThread}
            page={page}
            inline={{
              transcriptClassName: 'max-h-[min(44vh,24rem)] px-4',
              pending: pending || !canChat,
              send: (text, tier) => void send(text, tier),
              rephrase: (text) => {
                setDraft(text)
                setFocus((n) => n + 1)
              },
            }}
          />
        </div>
      )}
      {!threadId && recent.isError && (
        <InlineError message={recent.error.message} onRetry={() => void recent.refetch()} />
      )}
      {thread.isError && thread.error.status !== 404 && (
        <InlineError message={thread.error.message} onRetry={() => void thread.refetch()} />
      )}
      {canChat ? (
        <div className="mt-3">
          <Composer
            variant="home"
            label="Message about this design"
            submitLabel="Send design message"
            value={draft}
            onChange={setDraft}
            attachments={attachments}
            onAttach={(photos) =>
              setAttachments((previous) => [...previous, ...photos].slice(0, 8))
            }
            onRemoveAttachment={(id) =>
              setAttachments((previous) => previous.filter((photo) => photo.id !== id))
            }
            onSubmit={() => void send(draft)}
            placeholder={
              activeThread
                ? 'Continue the design conversation…'
                : 'Explore a shape, setting, or finish…'
            }
            chips={
              reference && (
                <Chip outline className="max-w-full gap-2">
                  <span className="truncate">{reference.title}</span>
                  <IconButton
                    icon={X}
                    size="sm"
                    label="Remove reference from message"
                    onClick={onClearReference}
                  />
                </Chip>
              )
            }
            sending={pending}
            disabled={checking || thread.data?.run?.status === 'running'}
            focusNonce={focus}
          />
          {error && <InlineError message={error} />}
        </div>
      ) : canWrite ? (
        <div className="mt-3 space-y-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="text-sm text-fg-muted">Connect Claude to chat about this design.</p>
            <Link to="/settings/ai" className={buttonClass({ size: 'sm', variant: 'primary' })}>
              Connect Claude
            </Link>
          </div>
          <details className="border-t border-line pt-3">
            <summary className="w-fit cursor-pointer text-sm font-medium hover:text-fg-muted">
              Write a board note
            </summary>
            <DesignNote key={boardId ?? pieceId} target={boardId ? { boardId } : { pieceId }} />
          </details>
        </div>
      ) : (
        <p className="mt-2 text-sm text-fg-muted">Designers can add to this conversation.</p>
      )}
    </section>
  )
}

function DesignNote({ target }: { target: BoardTarget }) {
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!note.trim() || pending) return
        setPending(true)
        setError('')
        void addNote(target, note.trim())
          .then(() => {
            setNote('')
            toast.success('Note saved to the design board')
          })
          .catch((err: unknown) => setError(errorMessage(err)))
          .finally(() => setPending(false))
      }}
    >
      <p className="text-xs text-fg-muted">This note is saved to the design board.</p>
      <Field label="Design note">
        {(id) => (
          <Textarea
            id={id}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Save a thought or a question to your board…"
            maxLength={4000}
            minRows={2}
          />
        )}
      </Field>
      <Button type="submit" variant="secondary" disabled={!note.trim() || pending}>
        {pending ? 'Saving…' : 'Save to design board'}
      </Button>
      {error && <InlineError message={error} />}
    </form>
  )
}
