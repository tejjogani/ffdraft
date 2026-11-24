/**
 * The Design tab: feature list, viewport and inspector over one live design session.
 * Rendered full-bleed under the piece page's tab bar.
 *
 * Everything works without the 3D view (no WebGL, no kernel): the list, the inspector, the
 * facts and every command — editing by numbers is the fallback, not an afterthought.
 */
import type { Diagnostic, ExportFormat } from '@pave/kernel'
import type { Vec3 } from '@pave/render'
import { type Design, type NodeInput, type NodeKind, nodeTitle, type Piece, type PieceSpecInput } from '@pave/schema'
import { AiMark, Button, cn, Dialog, IconButton, Sheet, Spinner } from '@pave/ui'
import { useNavigate } from '@tanstack/react-router'
import { PanelLeft, PanelRight, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Stage } from '../../components/stage/Stage'
import type { Viewer, ViewerState } from '../../components/stage/viewer'
import { assetUrl } from '../../lib/assets'
import { canRedo, canUndo } from '../../lib/design-session/core'
import { useDesignSession, useSessionState } from '../../lib/design-session/store'
import { useKernelInfo } from '../../lib/kernel/client'
import { usePieceEvaluation } from '../../lib/kernel/usePieceEvaluation'
import { useRpc, useRpcMutation } from '../../lib/query'
import { rpc } from '../../lib/rpc'
import { activeOrg, useSession } from '../../lib/session'
import { useCadCommands } from './commands'
import { captureCover } from './cover'
import { useViewportTools } from './capture-tool'
import { EmptyDesign } from './empty/EmptyDesign'
import { exportFormats, runExport } from './export'
import { ChangeChip } from './hud/ChangeChip'
import { Hud } from './hud/Hud'
import { useProductionCheck } from './hud/useProductionCheck'
import { Inspector } from './inspector/Inspector'
import { addNode, addPrepared, dependentsOf, remove } from './ops'
import { AddMenu } from './outliner/AddMenu'
import { Outliner } from './outliner/Outliner'
import { nextSteps } from './outliner/suggestions'
import { PiecePanel } from './PiecePanel'
import { useWorkspace } from './state/workspace'
import { FileToolbar, ViewToolbar } from './viewport/Toolbar'

const NARROW = '(max-width: 899px)'

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const m = matchMedia(query)
    const on = () => setMatch(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return match
}

export function PieceDesign({ pieceId }: { pieceId: string }) {
  const piece = useRpc('pieces.get', { id: pieceId })
  if (piece.isPending)
    return (
      <div className="stage absolute inset-0 flex items-center justify-center">
        <Spinner />
      </div>
    )
  if (!piece.data) return null
  return <Workspace piece={piece.data} />
}

function Workspace({ piece }: { piece: Piece }) {
  const pieceId = piece.id
  const session = useDesignSession(piece)
  const auth = useSession()
  const role = activeOrg(auth)?.role ?? 'viewer'
  const readOnly = role === 'viewer' || role === 'guest'
  const navigate = useNavigate()
  const kernel = useKernelInfo()
  const ws = useWorkspace.getState
  const selection = useWorkspace((s) => s.selection)
  const stone = useWorkspace((s) => s.stone)
  const hover = useWorkspace((s) => s.hover)
  const hidden = useWorkspace((s) => s.hidden)
  const display = useWorkspace((s) => s.display)
  const xray = useWorkspace((s) => s.xray)
  const simplified = useWorkspace((s) => s.simplified)
  useEffect(() => ws().open(pieceId), [pieceId, ws])

  const view = useSessionState(session, (s) => s.view) ?? piece.design
  const settled = useSessionState(session, (s) => s.settled) ?? piece.design
  const save = useSessionState(session, (s) => s.save) ?? null
  const runs = useSessionState(session, (s) => s.runs)
  const undoable = useSessionState(session, canUndo) ?? false
  const redoable = useSessionState(session, canRedo) ?? false
  const version = useSessionState(session, (s) => s.version) ?? piece.version
  const { evaluation, status } = usePieceEvaluation(pieceId)
  const check = useProductionCheck(pieceId, settled, kernel.status === 'ready' && view.order.length > 0)

  const viewer = useRef<Viewer | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [confirm, setConfirm] = useState<{ ids: string[]; dependents: string[] } | null>(null)
  const narrow = useMedia(NARROW)
  const [sheet, setSheet] = useState<'outliner' | 'inspector' | null>(null)
  const formats = exportFormats(kernel.formats)
  const mountedVersion = useRef(version)

  useViewportTools(pieceId, session)

  // ── Assistant edits ──────────────────────────────────────────────────────────────────────
  const latestRun = runs?.at(-1) ?? null
  const [dismissed, setDismissed] = useState<string | null>(null)
  const run = latestRun && latestRun.runId !== dismissed ? latestRun : null
  const [sweep, setSweep] = useState(0)
  const landed = latestRun?.changeIds.length ?? 0
  useEffect(() => {
    if (landed) setSweep((n) => n + 1)
  }, [landed])
  const revertRun = useRpcMutation('design.revert', {
    onSuccess: () => {
      setDismissed(latestRun?.runId ?? null)
      void session?.resync()
    },
  })
  const aiTouched = useMemo(
    () => new Set(run ? [...Object.keys(run.prior), ...run.added] : []),
    [run],
  )

  // ── Actions ──────────────────────────────────────────────────────────────────────────────
  const requestDelete = useCallback(
    (ids: string[]) => {
      if (!ids.length) return
      const dependents = [...new Set(ids.flatMap((id) => dependentsOf(view, id)))].filter((d) => !ids.includes(d))
      if (dependents.length) setConfirm({ ids, dependents })
      else {
        session?.commit(remove(ids))
        ws().select([])
      }
    },
    [view, session, ws],
  )

  const add = (kind: NodeKind, target = selection[0]) => {
    const { ops, id } = addNode(view, kind, { target })
    if (!ops.length || !session) return
    session.commit(ops)
    if (id) ws().select([id])
  }

  const importNode = (node: NodeInput, kind: Design['kind']) => {
    session?.commit(addPrepared(view, node, kind))
    ws().select([node.id])
  }

  const buildFromSpec = async (spec: PieceSpecInput) => {
    await rpc.call('pieces.setSpec', { id: pieceId, spec: spec as never })
    await rpc.call('pieces.buildFromSpec', { id: pieceId })
    await session?.resync()
  }

  const show = (d: Diagnostic) => {
    if (d.nodeId) ws().select([d.nodeId])
    if (d.at) viewer.current?.frameAt(d.at as Vec3)
    else if (d.nodeId) viewer.current?.frameAll(true, [d.nodeId])
  }
  const fix = (d: Diagnostic) => d.fix && session?.commit(d.fix.ops, { label: d.fix.label })

  useCadCommands({
    session,
    viewer,
    readOnly,
    canUndo: undoable,
    canRedo: redoable,
    crashed: kernel.status === 'crashed',
    formats,
    openAddMenu: () => setAddOpen(true),
    requestDelete,
    exportAs: (f: ExportFormat) => void runExport(piece, view, f),
  })

  const viewerState = useMemo<ViewerState>(
    () => ({ display, selection, stone, hover, hidden, xray }),
    [display, selection, stone, hover, hidden, xray],
  )

  const empty = view.order.length === 0
  const steps = useMemo(() => (readOnly ? [] : nextSteps(view, kernel.kinds)), [view, kernel.kinds, readOnly])
  const selectedTitle = selection.length
    ? selection.map((id) => (view.nodes[id] ? nodeTitle(view.nodes[id]!) : id)).join(', ')
    : 'Nothing'

  const outliner = (
    <Outliner
      design={view}
      diagnostics={evaluation?.diagnostics ?? []}
      session={session}
      aiTouched={aiTouched}
      readOnly={readOnly}
      onDelete={requestDelete}
      header={
        <div className="flex h-11 shrink-0 items-center justify-between pr-2 pl-4">
          <h2 className="text-xs font-medium text-fg-muted">Features</h2>
          {!readOnly && (
            <AddMenu
              design={view}
              kinds={kernel.kinds}
              target={selection[0]}
              onAdd={(k) => add(k)}
              open={addOpen}
              onOpenChange={setAddOpen}
            />
          )}
        </div>
      }
    />
  )
  const inspector = (
    <Inspector
      design={view}
      session={session}
      evaluation={evaluation}
      prior={run?.prior ?? null}
      readOnly={readOnly}
      onDelete={requestDelete}
      empty={<PiecePanel piece={piece} design={view} evaluation={evaluation} session={session} readOnly={readOnly} />}
    />
  )

  return (
    <div className="absolute inset-0 flex min-h-[520px]">
      {!narrow && (
        <aside data-region="outliner" aria-label="Feature list" className="w-[248px] shrink-0 border-r border-line bg-bg">
          {outliner}
        </aside>
      )}
      <main data-region="viewport" aria-label="Viewport" className="relative min-w-0 flex-1">
        <Stage
          evaluation={evaluation}
          state={viewerState}
          label="3D view of the piece. Drag to orbit, right-drag or Shift-drag to pan, scroll to zoom; arrow keys orbit, F fits, 1 to 4 pick a view."
          onViewer={(v, tier) => {
            viewer.current = v
            if (tier === 'software') {
              ws().setSimplified(true)
              if (!ws().displayChosen) ws().setDisplay('clay', false)
            }
          }}
          onBeforeDispose={(v) => captureCover(v, piece, session?.get().version !== mountedVersion.current, !readOnly)}
          onPick={(p, { additive }) => ws().pick(p, additive)}
          onHover={(p) => ws().setHover(p)}
        >
          {sweep > 0 && <Sweep key={sweep} />}
          <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex items-start justify-between gap-3 [&>*]:pointer-events-auto">
            <div className="flex items-center gap-2">
              {narrow && <IconButton icon={PanelLeft} label="Features" onClick={() => setSheet('outliner')} className="glass size-9 rounded-lg" />}
              <ViewToolbar canUndo={undoable} canRedo={redoable} />
            </div>
            <div className="flex items-center gap-2">
              <FileToolbar save={save} formats={empty ? [] : formats} simplified={simplified} />
              {narrow && <IconButton icon={PanelRight} label="Inspector" onClick={() => setSheet('inspector')} className="glass size-9 rounded-lg" />}
            </div>
          </div>
          {run && (
            <div className="absolute inset-x-0 top-16 z-20 flex justify-center">
              <ChangeChip
                run={run}
                undoing={revertRun.isPending}
                onUndo={() => revertRun.mutate({ pieceId, runId: run.runId })}
                onReview={() => void navigate({ to: '/pieces/$id/history', params: { id: pieceId } })}
                onDismiss={() => setDismissed(run.runId)}
              />
            </div>
          )}
          {empty ? (
            <EmptyDesign
              pieceId={pieceId}
              design={view}
              assistantAvailable={auth.capabilities.assistant}
              onBuild={buildFromSpec}
              onImport={importNode}
            />
          ) : (
            <StageStatus status={status} coverAssetId={piece.coverAssetId} error={kernel.error} hasEvaluation={!!evaluation} />
          )}
          {!empty && (
            <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex items-end justify-between gap-3 [&>*]:pointer-events-auto">
              <div className="flex flex-wrap gap-1.5">
                {steps.map((s) => (
                  <Button
                    key={s.label}
                    size="sm"
                    variant="secondary"
                    icon={Plus}
                    className="glass shadow-sm"
                    onClick={() => add(s.kind, s.target)}
                  >
                    {s.label}
                  </Button>
                ))}
              </div>
              <Hud
                design={view}
                evaluation={evaluation}
                check={check}
                evaluating={status === 'evaluating'}
                readOnly={readOnly}
                onShow={show}
                onFix={fix}
              />
            </div>
          )}
        </Stage>
        <p className="sr-only" aria-live="polite">
          Selected: {selectedTitle}
        </p>
      </main>
      {!narrow && (
        <aside data-region="inspector" aria-label="Inspector" className="w-[312px] shrink-0 border-l border-line bg-bg">
          {inspector}
        </aside>
      )}
      {narrow && (
        <>
          <Sheet open={sheet === 'outliner'} onOpenChange={(o) => setSheet(o ? 'outliner' : null)} title="Features" side="left">
            <div data-region="outliner" className="h-full">{outliner}</div>
          </Sheet>
          <Sheet open={sheet === 'inspector'} onOpenChange={(o) => setSheet(o ? 'inspector' : null)} title="Inspector" side="right">
            <div data-region="inspector" className="h-full">{inspector}</div>
          </Sheet>
        </>
      )}
      <Dialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete with what depends on it?"
        description={
          confirm &&
          `${confirm.dependents.map((id) => (view.nodes[id] ? nodeTitle(view.nodes[id]!) : id)).join(', ')} ${
            confirm.dependents.length === 1 ? 'is' : 'are'
          } attached and will be deleted too. Undo brings everything back.`
        }
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirm) session?.commit(remove(confirm.ids))
                ws().select([])
                setConfirm(null)
              }}
            >
              Delete all
            </Button>
          </>
        }
      />
    </div>
  )
}

/** The one AI sweep across the viewport when an assistant edit lands (a static mark under reduced motion). */
function Sweep() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <div className="cad-sweep ai-gradient absolute inset-y-0 -left-1/3 w-1/3 opacity-25 blur-2xl motion-reduce:hidden" />
      <AiMark className="absolute top-4 left-1/2 hidden size-4 -translate-x-1/2 motion-reduce:block" />
    </div>
  )
}

function StageStatus({
  status,
  coverAssetId,
  error,
  hasEvaluation,
}: {
  status: string
  coverAssetId: string | null
  error?: string
  hasEvaluation: boolean
}) {
  if (status === 'unavailable')
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="font-serif text-[24px] leading-8 text-fg">The 3D view isn’t available here</p>
        <p className="max-w-sm text-sm text-fg-muted">
          You can keep editing by numbers in the list and the inspector; every change is saved.
          {error ? ` (${error})` : ''}
        </p>
      </div>
    )
  if (hasEvaluation) return null
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
      {coverAssetId && (
        <img src={assetUrl(coverAssetId, 480)} alt="" className="max-h-[40%] max-w-[40%] object-contain opacity-60" />
      )}
      <p className={cn('flex items-center gap-2 text-sm text-fg-muted')}>
        <Spinner className="size-3.5" /> Preparing the workbench…
      </p>
    </div>
  )
}
