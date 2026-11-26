import type { AssistantTier, Piece } from '@pave/schema'
import {
  Button,
  buttonClass,
  Field,
  InlineError,
  readStored,
  Skeleton,
  Textarea,
  toast,
  writeStored,
} from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { newMessageId } from '../../features/assistant/actions'
import { Composer } from '../../features/assistant/Composer'
import { Conversation } from '../../features/assistant/Conversation'
import { addNote, type BoardTarget } from '../../features/ideate/actions'
import { clientId } from '../../lib/events'
import { invalidateFor, queryClient, useRpc } from '../../lib/query'
import { rpc } from '../../lib/rpc'
import { activeOrg, useSession } from '../../lib/session'
import type { Attachment } from '../../stores/assistant'

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Try again in a moment.'

/** A project thread is independent of the floating assistant, its draft and its CAD selection. */
export function ProjectConversation({ piece, boardId }: { piece: Piece; boardId?: string }) {
  const session = useSession()
  const scope = `pave:design-conversation:${session.activeOrgId}:${session.user.id}:${piece.id}`
  return <DesignConversation key={scope} scope={scope} pieceId={piece.id} boardId={boardId} />
}

function DesignConversation({
  scope,
  pieceId,
  boardId,
}: {
  scope: string
  pieceId: string
  boardId?: string
}) {
  const session = useSession()
  const role = activeOrg(session)?.role
  const canWrite = role !== undefined && role !== 'viewer' && role !== 'guest'
  const canChat = canWrite && session.capabilities.assistant
  const [threadId, setThreadId] = useState(() => readStored<string | null>(scope, null))
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
  const checking = Boolean(threadId && thread.isPending)
  const page = { pieceId, boardId, stage: 'design' as const }

  async function send(text: string, tier?: AssistantTier) {
    const message = text.trim()
    if (!canChat || pending || checking || !message) return
    setPending(true)
    setError('')
    try {
      const out = await rpc.call('threads.send', {
        ...(activeThread ? { threadId: activeThread } : {}),
        text: message,
        attachments: tier ? [] : attachments.map(({ id }) => id),
        context: { ...page, selection: [], brainstorm: true },
        ...(tier ? { tier } : {}),
        clientId,
        clientMessageId: newMessageId(),
      })
      writeStored(scope, out.thread.id)
      setThreadId(out.thread.id)
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
        <div className="my-3 h-[min(48vh,26rem)] min-h-40 rounded-lg border border-line bg-bg-subtle">
          <Conversation
            key={activeThread}
            threadId={activeThread}
            page={page}
            inline={{
              pending,
              send: (text, tier) => void send(text, tier),
              rephrase: (text) => {
                setDraft(text)
                setFocus((n) => n + 1)
              },
            }}
          />
        </div>
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
            sending={pending}
            disabled={checking || thread.data?.run?.status === 'running'}
            focusNonce={focus}
          />
          {error && <InlineError message={error} />}
        </div>
      ) : canWrite ? (
        <DesignNote key={boardId ?? pieceId} target={boardId ? { boardId } : { pieceId }} />
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
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={!note.trim() || pending}>
          {pending ? 'Saving…' : 'Save to design board'}
        </Button>
        <Link to="/settings/ai" className={buttonClass({ variant: 'ghost' })}>
          Connect Claude
        </Link>
      </div>
      {error && <InlineError message={error} />}
    </form>
  )
}
