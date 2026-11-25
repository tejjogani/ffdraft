/**
 * One conversation: the stored messages from `threads.get` with the live tail of its latest run
 * folded in, tool chips with Undo, approvals, how the run stands, and the run's footer.
 *
 * The finished part is a `role="log"`, so a screen reader announces each completed block and
 * approval as it lands; the text still streaming sits outside it, so it is not read out word by
 * word.
 */
import { type Op, planLimitAllowanceOf, type Run, type StoredChange } from '@pave/schema'
import { Skeleton, toast } from '@pave/ui'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useRpc, useRpcMutation } from '../../lib/query'
import { type AssistantContext, useAssistant } from '../../stores/assistant'
import { DirectionCards } from '../directions/DirectionCards'
import { PlanLimitNotice } from '../plans/PlanLimitCard'
import { ApprovalCard } from './ApprovalCard'
import { useRunActions, useSend } from './actions'
import { JobStrip } from './jobs/JobStrip'
import { AssistantText, UserMessage } from './MessageView'
import {
  type CallItem,
  changeOfCall,
  conversationItems,
  type Item,
  newerRun,
  runHasLiveChanges,
  splitQuiet,
} from './model'
import { QuestionsCard } from './QuestionsCard'
import { RenderBatchApproval, TakeCard } from './RenderCalls'
import { CapPill, RunError, RunFooter, Thinking, WorkingPill } from './RunStates'
import { useRunStream } from './run-stream'
import { ShotReferences } from './ShotReferences'
import { QuietCalls, ToolChip } from './ToolChip'

/** Node ids an edit's ops touch, for the CAD workspace's tint. */
function touched(name: string, input: unknown): string[] {
  // A stone change names its stone; the mount that follows it is that stone's.
  if (name === 'design.replaceStone') {
    const i = input as { target?: { nodeId?: string }; dryRun?: boolean } | null
    return i?.target?.nodeId && !i.dryRun ? [i.target.nodeId] : []
  }
  const ops = (input as { ops?: Op[] } | null)?.ops ?? []
  return ops.flatMap((op) => {
    if (op.t === 'add') return [(op.node as { id: string }).id]
    return 'id' in op && typeof op.id === 'string' ? [op.id] : []
  })
}

/**
 * Tells the CAD workspace what the assistant is doing to its piece (the "working" pill, and the
 * nodes to tint), for as long as this run is live.
 */
/** The allowance a failed call ran out of, read from the sentence the model was given. */
const limitOf = (c: CallItem) =>
  c.status === 'error' && c.errorText ? planLimitAllowanceOf(c.errorText) : null

export function usePublishActivity(
  run: Run | null,
  items: readonly Item[],
  pieceId: string | null,
) {
  const setActivity = useAssistant((s) => s.setActivity)
  const live = run?.status === 'running'
  const calls = items.flatMap((i) => (i.kind === 'calls' && i.runId === run?.id ? i.calls : []))
  const running = calls.findLast((c) => c.status === 'running')
  const nodeIds = calls
    .filter(
      (c) => c.status === 'done' && (c.name === 'design.apply' || c.name === 'design.replaceStone'),
    )
    .flatMap((c) => touched(c.name, c.input))
  const key = `${nodeIds.join(',')}|${running?.label ?? ''}`
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for nodeIds and the label
  useEffect(() => {
    if (!run || !live || !pieceId) return
    setActivity({
      pieceId,
      runId: run.id,
      nodeIds,
      label: running ? running.label : 'Assistant is working',
    })
    return () => {
      if (useAssistant.getState().activity?.runId === run.id) setActivity(null)
    }
  }, [run?.id, live, pieceId, key, setActivity])
}

export function Conversation({ threadId, page }: { threadId: string; page: AssistantContext }) {
  const q = useRpc('threads.get', { id: threadId })
  const setThreadPieceId = useAssistant((s) => s.setThreadPieceId)
  const sentPhotos = useAssistant((s) => s.sentPhotos)
  const stored = q.data
  const latest = stored?.run ?? null
  const view = useRunStream(latest?.id ?? null, latest?.status === 'running')
  const run = newerRun(latest, view?.run ?? null)
  const pieceId = stored?.thread.context.pieceId ?? run?.pieceId ?? null
  useEffect(() => setThreadPieceId(pieceId), [pieceId, setThreadPieceId])
  // Started from Home: go to the piece the run made, unless the person has moved on since.
  const navigate = useNavigate()
  const path = useRouterState({ select: (r) => r.location.pathname })
  useEffect(() => {
    const follow = useAssistant.getState().follow
    if (!pieceId || follow?.threadId !== threadId) return
    useAssistant.setState({ follow: null })
    if (path === follow.path) void navigate({ to: '/pieces/$id', params: { id: pieceId } })
  }, [pieceId, threadId, path, navigate])
  const onPiece = path.startsWith(`/pieces/${pieceId}`)

  // After a reload, which calls wait (for a person, or for their take) is in the run's steps.
  const waiting = run?.status === 'awaiting-approval' || run?.status === 'waiting' ? run.id : null
  const trace = useRpc('traces.run', { id: waiting ?? '' }, { enabled: !!waiting })
  const piece = useRpc('pieces.get', { id: pieceId ?? '' }, { enabled: !!pieceId })
  const history = useRpc(
    'design.history',
    { pieceId: pieceId ?? '', limit: 200 },
    { enabled: !!pieceId },
  )

  const items = useMemo(() => {
    const all = conversationItems(stored?.messages ?? [], view)
    if (!trace.data) return all
    const steps = new Map(trace.data.steps.map((s) => [s.toolCallId, s]))
    return all.map((item) =>
      item.kind === 'calls'
        ? {
            ...item,
            calls: item.calls.map((c): CallItem => {
              const step = steps.get(c.toolCallId)
              if (!step || c.status !== 'running') return c
              if (step.status === 'awaiting-approval') return { ...c, status: 'awaiting' }
              if (step.status === 'waiting') return { ...c, status: 'waiting' }
              if (step.status === 'done') return { ...c, status: 'done' }
              if (step.status === 'failed') return { ...c, status: 'error' }
              return c
            }),
          }
        : item,
    )
  }, [stored?.messages, view, trace.data])
  usePublishActivity(run, items, pieceId)

  const actions = useRunActions()
  const { send, pending } = useSend(page)
  const revert = useRpcMutation('design.revert', { meta: { silent: true } })
  const undo = (change: StoredChange) =>
    revert.mutate(
      { pieceId: change.pieceId, seq: change.seq },
      { onError: (e) => toast.error('Couldn’t undo that', e.message) },
    )
  const lastUserText = items.findLast((i) => i.kind === 'user')?.text ?? ''

  // Stay at the bottom while new things land (and while cards grow as their data loads),
  // unless the person scrolled up to read.
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  // biome-ignore lint/correctness/useExhaustiveDependencies: items and run state are the trigger
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [items, run?.status])
  // The content mounts after the skeleton; observe it once it is there.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `q.isPending` is the trigger
  useEffect(() => {
    const el = scroller.current
    const inner = content.current
    if (!el || !inner) return
    const observer = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(inner)
    return () => observer.disconnect()
  }, [q.isPending])

  if (q.isPending)
    return (
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="ml-auto h-10 w-2/3" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-8 w-1/2" />
      </div>
    )
  if (q.isError) return <p className="p-4 text-sm text-danger">{q.error.message}</p>

  const finished = items.filter((i) => !('live' in i && i.live))
  const tail = items.filter((i) => 'live' in i && i.live)

  const renderItem = (item: Item) => {
    switch (item.kind) {
      case 'user':
        return (
          <UserMessage
            key={item.key}
            text={item.text}
            photos={item.photos}
            photoIds={item.runId ? sentPhotos[item.runId] : undefined}
          />
        )
      case 'text':
        return <AssistantText key={item.key} text={item.text} />
      case 'thinking':
        return <Thinking key={item.key} text={item.text} live={item.live} />
      case 'note':
        return (
          <p key={item.key} className="text-xs text-fg-subtle italic">
            No answer: {item.text}
          </p>
        )
      case 'calls': {
        const { quiet, loud } = splitQuiet(item.calls)
        // Renders asked for in one turn are approved together.
        const batch = loud.filter((c) => c.status === 'awaiting' && c.name === 'renders.create')
        const decideAll = async (decision: 'approve' | 'deny', note?: string) => {
          try {
            for (const c of batch)
              if (c.runId)
                await actions.decide.mutateAsync({
                  runId: c.runId,
                  toolCallId: c.toolCallId,
                  decision,
                  ...(note ? { note } : {}),
                })
          } catch (e) {
            toast.error('Couldn’t send that', e instanceof Error ? e.message : undefined)
          }
        }
        return (
          <div key={item.key} className="flex flex-col gap-1.5">
            {quiet.length > 0 && <QuietCalls calls={quiet} />}
            {/* A framing check that copied shot references shows each beside its capture. */}
            {quiet.map((c) =>
              c.name === 'scenes.capture' ? <ShotReferences key={c.toolCallId} call={c} /> : null,
            )}
            {batch.length > 1 && (
              <RenderBatchApproval
                calls={batch}
                busy={actions.decide.isPending}
                onDecide={(d, note) => void decideAll(d, note)}
              />
            )}
            {loud.map((c) =>
              batch.length > 1 && batch.includes(c) ? null : c.status === 'awaiting' &&
                c.name === 'chat.ask' ? (
                <QuestionsCard
                  key={c.toolCallId}
                  call={c}
                  busy={actions.decide.isPending}
                  onGo={(answers) =>
                    c.runId &&
                    actions.decide.mutate(
                      { runId: c.runId, toolCallId: c.toolCallId, decision: 'approve', answers },
                      { onError: (e) => toast.error('Couldn’t send that', e.message) },
                    )
                  }
                />
              ) : c.status === 'awaiting' ? (
                <ApprovalCard
                  key={c.toolCallId}
                  call={c}
                  piece={piece.data ?? null}
                  busy={actions.decide.isPending}
                  onDecide={(decision, note) =>
                    c.runId &&
                    actions.decide.mutate(
                      {
                        runId: c.runId,
                        toolCallId: c.toolCallId,
                        decision,
                        ...(note ? { note } : {}),
                      },
                      { onError: (e) => toast.error('Couldn’t send that', e.message) },
                    )
                  }
                />
              ) : (
                <Fragment key={c.toolCallId}>
                  {/* A render or export past the plan's allowance is not a failure: the calm
                      card stands in for the error chip. */}
                  {limitOf(c) ? (
                    <PlanLimitNotice allowance={limitOf(c)!} message={c.errorText!} />
                  ) : (
                    <ToolChip
                      call={c}
                      pieceId={pieceId}
                      change={changeOfCall(history.data, c.runId, c.toolCallId)}
                      onUndo={undo}
                      undoing={revert.isPending}
                    />
                  )}
                  {/* A take shows where it was asked for: progress, then the picture. */}
                  {c.name === 'renders.create' && pieceId && (
                    <TakeCard call={c} pieceId={pieceId} />
                  )}
                  {/* A round of directions reads side by side, right where it was proposed. */}
                  {c.name === 'pieces.proposeDirections' && c.status === 'done' && piece.data && (
                    <DirectionCards
                      piece={piece.data}
                      directions={piece.data.directions.filter(
                        (d) => d.toolCallId === c.toolCallId,
                      )}
                      variant="inline"
                    />
                  )}
                </Fragment>
              ),
            )}
          </div>
        )
      }
    }
  }

  const ended =
    run &&
    run.status !== 'running' &&
    run.status !== 'awaiting-approval' &&
    run.status !== 'waiting'
  return (
    <div className="flex h-full flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4"
      >
        <div ref={content}>
          {pieceId && !onPiece && piece.data && (
            <Link
              to="/pieces/$id"
              params={{ id: pieceId }}
              className="mb-3 inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs text-fg-muted shadow-[inset_0_0_0_1px_var(--line)] hover:bg-bg-hover hover:text-fg"
            >
              Open {piece.data.title || 'the piece'} <ArrowRight className="size-3" aria-hidden />
            </Link>
          )}
          <div role="log" aria-label="Conversation" className="flex flex-col gap-3.5">
            {finished.map(renderItem)}
          </div>
          {tail.length > 0 && (
            <div aria-hidden className="mt-3.5 flex flex-col gap-3.5">
              {tail.map((item, i) =>
                item.kind === 'text' ? (
                  <AssistantText key={item.key} text={item.text} live />
                ) : item.kind === 'thinking' ? (
                  <Thinking key={item.key} text={item.text} live={i === tail.length - 1} />
                ) : null,
              )}
            </div>
          )}
          {run && (
            <div className="mt-3.5 flex flex-col gap-2">
              {run.status === 'failed' && run.errorCode === 'run_cap' && (
                <CapPill busy={pending} onContinue={() => void send('Continue', { bare: true })} />
              )}
              {run.status === 'failed' && run.errorCode !== 'run_cap' && (
                <RunError
                  run={run}
                  actions={{
                    busy: pending,
                    retry: () => void send(lastUserText || 'Try again', { bare: true }),
                    retryOn: (tier) => void send(lastUserText || 'Try again', { bare: true, tier }),
                    rephrase: () => {
                      useAssistant.getState().setDraft(lastUserText)
                      useAssistant.getState().focusComposer()
                    },
                  }}
                />
              )}
              {ended && (run.costUsd > 0 || runHasLiveChanges(history.data, run.id)) && (
                <RunFooter
                  run={run}
                  canUndo={!!pieceId && runHasLiveChanges(history.data, run.id)}
                  undoing={revert.isPending}
                  onUndoAll={() =>
                    pieceId &&
                    revert.mutate(
                      { pieceId, runId: run.id },
                      { onError: (e) => toast.error('Couldn’t undo the run', e.message) },
                    )
                  }
                />
              )}
            </div>
          )}
        </div>
      </div>
      {run && (run.job || run.status === 'running' || run.status === 'waiting') && (
        <div className="flex flex-col gap-2 px-3 pb-2">
          {run.job && <JobStrip run={run} />}
          {run.status === 'running' && !run.job && (
            <WorkingPill
              label={workingLabel(items, run.id)}
              onStop={() => actions.cancel.mutate({ runId: run.id })}
            />
          )}
          {run.status === 'waiting' && !run.job && (
            <WorkingPill
              label="Waiting for the takes to render…"
              onStop={() => actions.cancel.mutate({ runId: run.id })}
            />
          )}
        </div>
      )}
    </div>
  )
}

/** What the run is doing now, for the working pill. */
function workingLabel(items: readonly Item[], runId: string): string {
  const calls = items.flatMap((i) => (i.kind === 'calls' && i.runId === runId ? i.calls : []))
  const running = calls.findLast((c) => c.status === 'running')
  if (running) return `${running.label}…`
  const live = items.filter((i) => 'live' in i && i.live).at(-1)
  if (live?.kind === 'text') return 'Writing…'
  if (live?.kind === 'thinking') return 'Thinking…'
  return 'Assistant is working'
}
