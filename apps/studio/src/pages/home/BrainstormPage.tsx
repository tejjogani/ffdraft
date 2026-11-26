import { Button, buttonClass, InlineError, Textarea } from '@pave/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { useId, useRef, useState } from 'react'
import { PageHeader } from '../../components/Page'
import { newMessageId } from '../../features/assistant/actions'
import { Composer } from '../../features/assistant/Composer'
import { Conversation } from '../../features/assistant/Conversation'
import { clientId } from '../../lib/events'
import { invalidateFor, queryClient, useRpc } from '../../lib/query'
import { rpc } from '../../lib/rpc'
import { useSession } from '../../lib/session'
import { useCurrentView } from '../../lib/use-current-view'
import { type Attachment, useAssistant } from '../../stores/assistant'

interface BrainstormDraft {
  notes: string[]
  files: Attachment[]
}

function readDraft(key: string): BrainstormDraft {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null') ?? { notes: [], files: [] }
  } catch {
    return { notes: [], files: [] }
  }
}

export function BrainstormPage({ id, threadId }: { id: string; threadId?: string }) {
  const { capabilities, user, activeOrgId } = useSession()
  const navigate = useNavigate()
  const isCurrent = useCurrentView()
  const sessionKey = `pave:brainstorm:${activeOrgId}:${user.id}:${id}`
  const [saved, setSaved] = useState(() => readDraft(sessionKey))
  const [draft, setDraft] = useState('')
  const [files, setFiles] = useState<Attachment[]>([])
  const briefId = useId()
  const [brief, setBrief] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focus, setFocus] = useState(0)
  const retry = useRef<{ key: string; id: string } | null>(null)
  const thread = useRpc('threads.get', { id: threadId ?? '' }, { enabled: !!threadId })
  const active = thread.data?.thread.context.pieceId === null ? thread.data.thread.id : undefined
  const running = thread.data?.run?.status === 'running'
  const store = (next: BrainstormDraft) => {
    setSaved(next)
    try {
      sessionStorage.setItem(sessionKey, JSON.stringify(next))
    } catch {
      /* This tab keeps the draft in memory. */
    }
  }

  const send = async (text: string, attachments: Attachment[] = []) => {
    if (busy || running || !text.trim()) return
    setBusy(true)
    setError(null)
    const key = JSON.stringify([active, text, attachments])
    if (retry.current?.key !== key) retry.current = { key, id: newMessageId() }
    try {
      const notes = [...saved.notes, text.trim()]
      const kept = [...new Map([...saved.files, ...attachments].map((a) => [a.id, a])).values()]
      if (capabilities.assistant) {
        const photoIds = attachments.map((a) => a.id)
        const out = await rpc.call('threads.send', {
          threadId: active,
          text: text.trim(),
          attachments: photoIds,
          context: { brainstorm: true },
          clientId,
          clientMessageId: retry.current.id,
        })
        invalidateFor(queryClient, 'runs')
        if (photoIds.length)
          useAssistant.setState((s) => ({
            sentPhotos: { ...s.sentPhotos, [out.run.id]: photoIds },
          }))
        if (!isCurrent()) return
        await navigate({
          to: '/',
          search: { brainstorm: id, thread: out.thread.id },
          replace: true,
        })
      }
      store({ notes, files: kept })
      retry.current = null
      setDraft('')
      setFiles([])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const startProject = async () => {
    if (!brief?.trim() || busy) return
    setError(null)
    setBusy(true)
    try {
      const assetIds = [...new Set([...saved.files, ...files].map((a) => a.id))]
      const project = await rpc.call('pieces.startIntake', {
        requestId: id,
        brief: brief.trim(),
        assetIds: assetIds.slice(0, 8),
      })
      for (let i = 8; i < assetIds.length; i += 8) {
        await rpc.call('pieces.addIntakeAssets', { ...project, assetIds: assetIds.slice(i, i + 8) })
      }
      invalidateFor(queryClient, 'pieces')
      invalidateFor(queryClient, 'boards')
      if (isCurrent()) await navigate({ to: '/', search: { intake: project.pieceId } })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const draftBrief = () => {
    const words =
      thread.data?.messages.flatMap((m) =>
        m.role === 'user'
          ? m.content.flatMap((block) =>
              block.type === 'text' && typeof block.text === 'string' ? [block.text] : [],
            )
          : [],
      ) ?? saved.notes
    setBrief([...words, draft.trim()].filter(Boolean).join('\n\n').slice(0, 20_000))
  }
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Home', link: { to: '/', search: {} } }, { label: 'Brainstorm' }]}
        actions={
          <Link to="/" search={{}} className={buttonClass({ variant: 'ghost', size: 'sm' })}>
            Home
          </Link>
        }
      />
      <div className="mx-auto flex min-h-0 w-full max-w-[900px] flex-1 flex-col px-4 sm:px-10">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line pt-5 pb-3">
          <h1 className="font-serif text-title text-fg">Brainstorm</h1>
          {brief === null && (
            <Button
              size="sm"
              variant="secondary"
              onClick={draftBrief}
              disabled={busy || running || (!active && !draft.trim() && saved.notes.length === 0)}
            >
              Start a project
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1">
          {thread.error && <InlineError message={thread.error.message} />}
          {active ? (
            <Conversation
              threadId={active}
              page={{}}
              inline={{
                pending: busy,
                send: (text) => void send(text),
                rephrase: (text) => {
                  setDraft(text)
                  setFocus((n) => n + 1)
                },
              }}
            />
          ) : (
            <div className="h-full space-y-3 overflow-y-auto py-4">
              <p className="text-sm text-fg-muted">
                {capabilities.assistant
                  ? 'Talk through materials, proportions, or a rough idea. Start a project when you’re ready.'
                  : 'Keep rough ideas here in this tab. Choose Start a project when you want to save a brief and references.'}
              </p>
              {saved.notes.map((note, i) => (
                <div key={i} className="whitespace-pre-wrap rounded-lg bg-bg-muted p-3 text-sm">
                  {note}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 bg-bg pt-2 pb-4">
          {error && (
            <div className="mb-2">
              <InlineError message={error} />
            </div>
          )}
          {brief !== null ? (
            <form
              className="space-y-2 border-t border-line pt-3"
              onSubmit={(e) => {
                e.preventDefault()
                void startProject()
              }}
            >
              <label className="grid gap-1.5 text-sm font-medium" htmlFor={briefId}>
                Project brief
                <Textarea
                  id={briefId}
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  minRows={3}
                  maxLength={20_000}
                />
              </label>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setBrief(null)}>
                  Back to brainstorm
                </Button>
                <Button size="sm" variant="primary" type="submit" disabled={busy || !brief.trim()}>
                  Create project
                </Button>
              </div>
            </form>
          ) : (
            <Composer
              value={draft}
              onChange={setDraft}
              attachments={files}
              onAttach={(list) => setFiles((before) => [...before, ...list].slice(0, 8))}
              onRemoveAttachment={(id) => setFiles((list) => list.filter((a) => a.id !== id))}
              onSubmit={() => void send(draft, files)}
              label={capabilities.assistant ? 'Brainstorm with the assistant' : 'Brainstorm note'}
              submitLabel={capabilities.assistant ? 'Send brainstorm message' : 'Keep note'}
              placeholder={
                capabilities.assistant
                  ? 'What are you thinking about?'
                  : 'Write an idea to keep with this brainstorm…'
              }
              sending={busy}
              disabled={busy || running || (!!threadId && !active)}
              focusNonce={focus}
            />
          )}
        </div>
      </div>
    </>
  )
}
