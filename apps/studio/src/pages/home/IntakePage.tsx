import { type AssistantTier, METALS, type Piece, type Reference } from '@pave/schema'
import { Button, buttonClass, cn, InlineError, Markdown, Skeleton } from '@pave/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Check, FileBox } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { PageHeader } from '../../components/Page'
import { newMessageId } from '../../features/assistant/actions'
import { Composer } from '../../features/assistant/Composer'
import { Conversation } from '../../features/assistant/Conversation'
import { selectProjectThread } from '../../features/assistant/project-thread'
import { TierPicker } from '../../features/assistant/TierPicker'
import { takeToCadRefusal } from '../../features/ideate/board'
import { useReferencePanel } from '../../features/references/store'
import { assetUrl } from '../../lib/assets'
import { invalidateFor, queryClient, rpcKey, useRpc } from '../../lib/query'
import { rpc } from '../../lib/rpc'
import { useSession } from '../../lib/session'
import { useCurrentView } from '../../lib/use-current-view'
import { type Attachment, openAssistant } from '../../stores/assistant'
import {
  chainFromBrief,
  firstMessageId,
  type IntakeSearch,
  intakeFiles,
  isConcept,
  sendIntake,
} from './intake'
import { ManualIntake } from './ManualIntake'

export function IntakePage({ pieceId, search }: { pieceId: string; search: IntakeSearch }) {
  const piece = useRpc('pieces.get', { id: pieceId })
  const boards = useRpc('boards.list', { pieceId })
  const boardId = boards.data?.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.id
  const board = useRpc('boards.get', { id: boardId ?? '' }, { enabled: !!boardId })
  const thread = useRpc('threads.get', { id: search.thread ?? '' }, { enabled: !!search.thread })
  const threadId =
    thread.data?.thread.context.pieceId === pieceId ? thread.data.thread.id : undefined
  useLayoutEffect(() => {
    if (threadId) selectProjectThread(pieceId, threadId)
  }, [pieceId, threadId])
  const initialTitle = piece.data?.title || 'Design intake'
  const fault = piece.error ?? boards.error ?? board.error ?? thread.error
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Home', link: { to: '/', search: {} } }, { label: 'Design intake' }]}
        actions={
          <Link to="/" search={{}} className={buttonClass({ variant: 'ghost', size: 'sm' })}>
            New brief
          </Link>
        }
      />
      <div className="mx-auto flex min-h-0 w-full max-w-[900px] flex-1 flex-col px-4 sm:px-10">
        <h1 className="mt-4 mb-2 shrink-0 font-serif text-heading text-fg sm:mt-7 sm:text-title">
          {initialTitle}
        </h1>
        {fault ? (
          <InlineError message={fault.message} />
        ) : piece.data && board.data && (!search.thread || thread.data) ? (
          <IntakeConversation
            key={board.data.board.id}
            piece={piece.data}
            boardId={board.data.board.id}
            references={board.data.references}
            search={search}
            threadId={threadId}
            assistantBusy={
              thread.data?.run?.status === 'running' || thread.data?.run?.status === 'waiting'
            }
          />
        ) : boards.data?.length === 0 ? (
          <InlineError message="The Design board for this commission is no longer available." />
        ) : (
          <div
            className="flex flex-col gap-4 pt-4"
            role="status"
            aria-label="Loading design intake"
          >
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-12 w-3/4" />
          </div>
        )}
      </div>
    </>
  )
}

function IntakeConversation({
  piece,
  boardId,
  references,
  search,
  threadId,
  assistantBusy,
}: {
  piece: Piece
  boardId: string
  references: Reference[]
  search: IntakeSearch
  threadId?: string
  assistantBusy: boolean
}) {
  const { capabilities } = useSession()
  const navigate = useNavigate()
  const isCurrent = useCurrentView()
  const [prompt, setPrompt] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tier, setTier] = useState<AssistantTier | null>(null)
  const [focus, setFocus] = useState(0)
  const sendRetry = useRef<{ key: string; id: string } | null>(null)
  const buildRetry = useRef<{ key: string; id: string } | null>(null)
  const models = references.filter(
    (r) => r.type === 'model' && r.assetId && intakeFiles.model(r.title),
  )
  const photos = references.filter((r) => !isConcept(r) && r.type !== 'note')
  const concepts = references.filter(isConcept)
  const selection = piece.intake?.selection
  const conceptId = piece.intake ? selection?.conceptId : search.concept
  const visualId = piece.intake ? selection?.visualId : search.visual
  const chosen = concepts.find((r) => r.id === conceptId)
  const visualChoices = photos.filter((r) => !takeToCadRefusal(r))
  const selectedVisual =
    chosen && !takeToCadRefusal(chosen) ? chosen : visualChoices.find((r) => r.id === visualId)
  const fixedChain = piece.kind === 'pendant' ? chainFromBrief(piece.brief) : null
  const ai = capabilities.assistant && !models.length
  const details = piece.intake?.details
  const confirmed = [
    details?.heightMm && `${details.heightMm} mm`,
    details?.metal ? METALS[details.metal].label : details?.metalDescription,
  ]
    .filter(Boolean)
    .join(' · ')
  const persistSelection = async (
    choice: { conceptId: string; visualId: string | null } | null,
  ) => {
    const intake = await rpc.call('pieces.confirmIntake', {
      pieceId: piece.id,
      boardId,
      selection: choice,
    })
    queryClient.setQueryData<Piece>(
      rpcKey('pieces.get', { id: piece.id }),
      (old) => old && { ...old, intake },
    )
    return intake
  }
  const refresh = () => {
    invalidateFor(queryClient, 'pieces')
    invalidateFor(queryClient, 'boards')
    invalidateFor(queryClient, 'references')
  }

  const onSend = async (text: string, media: Attachment[] = [], overrideTier?: AssistantTier) => {
    if (busy || assistantBusy || (!text.trim() && !media.length)) return
    setBusy(true)
    setError(null)
    const assetIds = media.map((a) => a.id)
    const key = JSON.stringify([threadId, text, assetIds, overrideTier ?? tier])
    if (sendRetry.current?.key !== key) sendRetry.current = { key, id: newMessageId() }
    try {
      const added = assetIds.length
        ? await rpc.call('pieces.addIntakeAssets', {
            pieceId: piece.id,
            boardId,
            assetIds,
          })
        : []
      refresh()
      if (!text.trim() && chosen && media.length) {
        const sketch = added.find((r) => !takeToCadRefusal(r))
        if (sketch) {
          await persistSelection({ conceptId: chosen.id, visualId: sketch.id })
          if (isCurrent())
            await navigate({
              to: '/',
              search: { ...search, concept: chosen.id, visual: sketch.id },
              replace: true,
            })
        }
      } else if (ai) {
        const originalAssets = piece.origin?.sourceAssetIds ?? []
        const out = await sendIntake({
          pieceId: piece.id,
          boardId,
          threadId,
          text: threadId
            ? text.trim() || 'I’ve added a style reference.'
            : text.trim() && text.trim() !== piece.brief
              ? `${piece.brief}\n\n${text.trim()}`
              : piece.brief,
          attachments: threadId ? assetIds : [...originalAssets, ...assetIds].slice(0, 8),
          referenceIds: added.map((r) => r.id).slice(0, 12),
          tier: overrideTier ?? tier,
          messageId: threadId ? sendRetry.current.id : firstMessageId(piece.id),
        })
        if (chosen) await persistSelection(null)
        if (!isCurrent()) return
        await navigate({
          to: '/',
          search: { intake: piece.id, thread: out.thread.id },
          replace: true,
        })
      } else if (text.trim()) {
        await rpc.call('references.save', {
          boardId,
          items: [{ title: 'Intake note', note: text.trim().slice(0, 4000) }],
        })
        refresh()
      }
      sendRetry.current = null
      setPrompt('')
      setAttachments([])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const select = async (concept: Reference, visual: string | null) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await persistSelection({ conceptId: concept.id, visualId: visual })
      if (isCurrent())
        await navigate({
          to: '/',
          search: { ...search, concept: concept.id, visual: visual ?? undefined },
          replace: true,
        })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const build = async (ref: Reference, target: 'design' | 'render' = 'design') => {
    if (busy || assistantBusy) return
    setBusy(true)
    setError(null)
    const handoffKey = `${ref.id}:${selectedVisual?.id ?? ''}`
    if (buildRetry.current?.key !== handoffKey)
      buildRetry.current = { key: handoffKey, id: newMessageId() }
    try {
      let handoffThread: string | undefined
      if (ref.type === 'model' && ref.assetId) {
        const imported = piece.design.order.some((id) => {
          const node = piece.design.nodes[id]
          return (
            node?.kind === 'meshBody' &&
            node.source.type === 'asset' &&
            node.source.assetId === ref.assetId
          )
        })
        if (!imported)
          await rpc.call('pieces.openAsCad', { pieceId: piece.id, assetId: ref.assetId })
      } else {
        if (!selectedVisual?.assetId)
          throw new Error('Choose the design image or sketch to use in CAD.')
        await persistSelection({ conceptId: ref.id, visualId: selectedVisual.id })
        const pin = await rpc.call('pieces.takeToCad', {
          pieceId: piece.id,
          referenceId: selectedVisual.id,
        })
        if (ai) {
          const logoAssets = piece.origin?.sourceAssetIds ?? []
          const out = await sendIntake({
            pieceId: piece.id,
            boardId,
            threadId,
            text: `Build the concept I selected from Design: ${ref.title} (reference ${ref.id}). Match the silhouette and logo placement in the selected visual “${selectedVisual.title}” (reference ${selectedVisual.id}, first attachment). Use the original artwork attachments to preserve the mark, and use the confirmed spec for measurements and materials.\n\nOriginal commission:\n${piece.brief}\n\nSelected concept and confirmed details:\n${ref.note || 'Use the selected design image and the confirmed decisions from our conversation.'}\n\nKeep confirmed choices. Ask about dimensions still needed for CAD before building. Do not substitute the outline of a generic recipe for the selected design.`,
            referenceIds: [
              ...new Set([
                selectedVisual.id,
                ref.id,
                ...references
                  .filter((r) => r.assetId && logoAssets.includes(r.assetId))
                  .map((r) => r.id),
              ]),
            ].slice(0, 12),
            attachments: [...new Set([pin.assetId, ...logoAssets])].slice(0, 8),
            tier,
            messageId: buildRetry.current.id,
            job: {
              stage: 'cad',
              goal: 'Build the selected visual Design concept, reading its image for the silhouette and using the confirmed spec for dimensions and materials.',
            },
          })
          handoffThread = out.thread.id
        } else {
          useReferencePanel
            .getState()
            .setPlaceRequest({ pieceId: piece.id, refId: pin.pin.id, view: 'front' })
        }
      }
      refresh()
      if (!isCurrent()) return
      if (handoffThread) openAssistant({ pieceId: piece.id, threadId: handoffThread, draft: '' })
      await navigate({
        to: target === 'render' ? '/pieces/$id/render' : '/pieces/$id/design',
        params: { id: piece.id },
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const footer = (
    <>
      {models.length > 0 && (
        <section
          aria-label="Open uploaded CAD"
          className="my-4 space-y-3 border-y border-line py-4"
        >
          {models.map((ref) => (
            <div key={ref.id} className="flex flex-wrap items-center gap-2">
              <span className="mr-auto min-w-0 break-all text-sm">{ref.title}</span>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void build(ref)}>
                Open in CAD
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void build(ref, 'render')}
              >
                Open in Render
              </Button>
            </div>
          ))}
        </section>
      )}
      {!ai && !models.length && (
        <ManualIntake piece={piece} boardId={boardId} references={references} />
      )}
      {concepts.length > 0 && (
        <section aria-label="Design concepts" className="my-5 border-t border-line pt-4">
          <h2 className="mb-2 text-base font-medium">Choose a concept</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {concepts.map((ref) => (
              <button
                key={ref.id}
                type="button"
                aria-pressed={ref.id === chosen?.id}
                aria-label={ref.title}
                disabled={busy || assistantBusy}
                onClick={() => void select(ref, takeToCadRefusal(ref) ? null : ref.id)}
                className={cn(
                  'flex min-w-0 flex-col overflow-hidden rounded-lg border text-left hover:bg-bg-hover',
                  ref.id === chosen?.id ? 'border-line-strong bg-bg-muted' : 'border-line',
                )}
              >
                {ref.assetId && (
                  <img
                    src={assetUrl(ref.assetId, 640)}
                    alt={ref.title}
                    className="aspect-[4/3] w-full object-contain"
                  />
                )}
                <span className="grid w-full gap-1.5 p-3">
                  <span className="flex items-center justify-between gap-2 text-sm font-medium">
                    {ref.title}{' '}
                    {ref.id === chosen?.id && <Check className="size-4 shrink-0" aria-hidden />}
                  </span>
                  {ref.note && (
                    <span className="whitespace-pre-wrap text-sm text-fg-muted">
                      {ref.note.split('\n\n', 1)[0]}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
          {chosen && (
            <div className="mt-4 grid gap-3">
              <p className="text-sm text-fg-muted">
                Selected <span className="font-medium text-fg">{chosen.title}</span>
              </p>
              {chosen.note.includes('\n\n') && (
                <p className="text-sm text-fg-muted">
                  {chosen.note.split('\n\n').slice(1).join('\n\n')}
                </p>
              )}
              {takeToCadRefusal(chosen) && (
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-medium">Visual to build from</legend>
                  <p className="text-sm text-fg-muted">
                    Choose an existing design image, or attach a sketch below.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {visualChoices.map((ref) => (
                      <button
                        type="button"
                        key={ref.id}
                        aria-pressed={selectedVisual?.id === ref.id}
                        disabled={busy || assistantBusy}
                        onClick={() => void select(chosen, ref.id)}
                        className={cn(
                          'flex max-w-56 items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs hover:bg-bg-hover',
                          selectedVisual?.id === ref.id
                            ? 'border-line-strong bg-bg-muted'
                            : 'border-line',
                        )}
                      >
                        <img
                          src={assetUrl(ref.assetId!, 160)}
                          alt=""
                          className="size-9 shrink-0 rounded-sm object-contain"
                        />
                        <span className="truncate">{ref.title}</span>
                        {selectedVisual?.id === ref.id && (
                          <Check className="size-4 shrink-0" aria-hidden />
                        )}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}
              <Button
                className="justify-self-start"
                size="sm"
                variant="primary"
                icon={ArrowRight}
                disabled={busy || assistantBusy || !selectedVisual}
                onClick={() => void build(chosen)}
              >
                {ai ? 'Build in CAD' : 'Open in CAD'}
              </Button>
            </div>
          )}
        </section>
      )}
    </>
  )
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line pb-3 text-sm">
        <span className="text-fg-muted">
          {ai ? 'Project brief saved' : 'Manual design intake'}
          {fixedChain && ` · ${fixedChain}`}
          {confirmed && ` · ${confirmed}`}
        </span>
        <Link
          to="/pieces/$id/directions"
          params={{ id: piece.id }}
          className={buttonClass({ variant: 'ghost', size: 'sm' })}
        >
          Open Design board
        </Link>
      </div>
      {photos.length > 0 && (
        <details className="shrink-0 border-b border-line py-2" open={!threadId}>
          <summary className="cursor-pointer text-sm text-fg-muted">
            {photos.length} {photos.length === 1 ? 'saved reference' : 'saved references'}
          </summary>
          <ul
            className="mt-2 flex max-h-28 flex-wrap gap-2 overflow-auto"
            aria-label="Saved references"
          >
            {photos.map((ref) => (
              <li
                key={ref.id}
                className="flex max-w-52 items-center gap-2 rounded-md border border-line px-2 py-1.5 text-xs"
              >
                {ref.type === 'image' && ref.assetId ? (
                  <img
                    src={assetUrl(ref.assetId, 160)}
                    alt={ref.title}
                    className="size-9 shrink-0 rounded-sm object-contain"
                  />
                ) : (
                  <FileBox className="size-4 shrink-0" aria-hidden />
                )}
                <span className="truncate" title={ref.title}>
                  {ref.title}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="min-h-0 flex-1">
        {threadId ? (
          <Conversation
            threadId={threadId}
            page={{ pieceId: piece.id, boardId, stage: 'design' }}
            inline={{
              after: footer,
              pending: busy,
              send: (text, tier) => void onSend(text, [], tier),
              rephrase: (text) => {
                setPrompt(text)
                setFocus((n) => n + 1)
              },
            }}
          />
        ) : (
          <div className="h-full overflow-y-auto py-4">
            <div className="whitespace-pre-wrap text-sm text-fg">{piece.brief}</div>
            {references
              .filter((r) => r.title === 'Intake note')
              .map((r) => (
                <div key={r.id} className="mt-2 rounded-md bg-bg-muted p-3">
                  <Markdown>{r.note}</Markdown>
                </div>
              ))}
            {ai && (
              <Button
                size="sm"
                className="mt-4"
                variant="secondary"
                disabled={busy}
                onClick={() => void onSend(piece.brief)}
              >
                Start conversation
              </Button>
            )}
            {footer}
          </div>
        )}
      </div>
      <div className="shrink-0 bg-bg pt-2 pb-4">
        {error && (
          <div className="mb-2">
            <InlineError message={error} />
          </div>
        )}
        <Composer
          value={prompt}
          onChange={setPrompt}
          attachments={attachments}
          onAttach={(a) => setAttachments((list) => [...list, ...a].slice(0, 8))}
          onRemoveAttachment={(id) => setAttachments((list) => list.filter((x) => x.id !== id))}
          onSubmit={() => void onSend(prompt, attachments)}
          sending={busy}
          disabled={busy || assistantBusy}
          placeholder={
            ai
              ? 'Reply, share a style reference, or ask for a revision…'
              : 'Save a note or attach a reference…'
          }
          label={ai ? 'Reply to the design assistant' : 'Project intake note'}
          submitLabel={ai ? 'Send reply' : 'Save to Design board'}
          focusNonce={focus}
          allowAttachmentOnly
          files={intakeFiles}
          tools={ai ? <TierPicker value={tier} onChange={setTier} /> : undefined}
        />
      </div>
    </>
  )
}
