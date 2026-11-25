/**
 * The Design tab: feature list, viewport and inspector over one live design session.
 * Rendered full-bleed under the piece page's tab bar.
 *
 * Everything works without the 3D view (no WebGL, no kernel): the list, the inspector, the
 * facts and every command — editing by numbers is the fallback, not an afterthought.
 */
import type { Diagnostic, ExportFormat } from '@pave/kernel'
import type { Vec3 } from '@pave/render'
import {
  applyOps,
  type Design,
  isBodyKind,
  labelForOps,
  type NodeInput,
  type NodeKind,
  nodeTitle,
  type Piece,
  type PieceSpecInput,
} from '@pave/schema'
import {
  AiMark,
  Button,
  type ContextMenuHandle,
  cn,
  Dialog,
  IconButton,
  Sheet,
  Spinner,
} from '@pave/ui'
import { useNavigate } from '@tanstack/react-router'
import { PanelLeft, PanelRight, Plus } from 'lucide-react'
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Stage } from '../../components/stage/Stage'
import type { Viewer, ViewerState } from '../../components/stage/viewer'
import { assetUrl } from '../../lib/assets'
import { runCommand } from '../../lib/commands'
import { canRedo, canUndo } from '../../lib/design-session/core'
import { useDesignSession, useSessionState } from '../../lib/design-session/store'
import { evaluationScheduler, useKernelInfo } from '../../lib/kernel/client'
import { usePieceEvaluation } from '../../lib/kernel/usePieceEvaluation'
import { useRpc, useRpcMutation } from '../../lib/query'
import { rpc } from '../../lib/rpc'
import { activeOrg, useSession } from '../../lib/session'
import { useQuickIntent } from '../assistant/quick-intent-store'
import { type Subject, subjectFor } from '../assistant/quick-intents'
import { useViewportTools } from './capture-tool'
import { useCadCommands } from './commands'
import { captureCover } from './cover'
import { EmptyDesign } from './empty/EmptyDesign'
import { exportFormats, runExport } from './export'
import { ChangeChip } from './hud/ChangeChip'
import { Hud } from './hud/Hud'
import { toIssues } from './hud/issues'
import { useProductionCheck } from './hud/useProductionCheck'
import { useNodeEdit } from './inspector/edit'
import { Inspector } from './inspector/Inspector'
import { addNode, addPrepared, dependentsOf, remove } from './ops'
import { AddMenu } from './outliner/AddMenu'
import { Outliner } from './outliner/Outliner'
import { type NextStep, nextSteps } from './outliner/suggestions'
import { PiecePanel } from './PiecePanel'
import { useQuickIntentCommands } from './quick-commands'
import { useWorkspace } from './state/workspace'
import { Dimensions } from './viewport/Dimensions'
import { dockArea } from './viewport/dock-area'
import { Marker, type MarkerSpot } from './viewport/Marker'
import { FileToolbar, ViewToolbar } from './viewport/Toolbar'
import { ViewportMenu } from './viewport/ViewportMenu'

/** Workspace actions read the latest UI state without subscribing to it. */
const ws = useWorkspace.getState

const OUTLINER_PX = 248
const INSPECTOR_PX = 328
/**
 * Panels dock while the viewport keeps a usable width beside them, measured on the workspace
 * itself (the app's sidebar may be open or not): the feature list folds into a sheet first,
 * then the inspector. The narrowest view still fits both toolbars side by side (≈ 480 px with
 * the panel buttons and the software-graphics chip).
 */
const MIN_VIEW_PX = 480
const DOCK_OUTLINER_PX = OUTLINER_PX + INSPECTOR_PX + MIN_VIEW_PX
const DOCK_INSPECTOR_PX = INSPECTOR_PX + MIN_VIEW_PX
/** Below this viewport width the floating rows go icon-only and the next-step chips step aside. */
const COMPACT_VIEW_PX = 560

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(1440)
  // Measured before the first paint, so a narrow window never flashes docked panels.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}

/**
 * Tells the Replace stone dialog where to dock on this tab (kept current as the window
 * resizes), and while it is open over the view, has the view frame the piece beside it.
 */
function useReplaceDock(
  pieceId: string,
  root: RefObject<HTMLElement | null>,
  viewport: RefObject<HTMLElement | null>,
  dockInspector: boolean,
  viewer: Viewer | null,
) {
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const measure = () => {
      const view = viewport.current
      if (!view) return
      const inspector = dockInspector
        ? el.querySelector<HTMLElement>(':scope > [data-region="inspector"]')
        : null
      const area = dockArea(
        {
          inspector: inspector?.getBoundingClientRect() ?? null,
          viewport: view.getBoundingClientRect(),
        },
        document.documentElement.clientWidth,
      )
      useQuickIntent.getState().setDock({ pieceId, ...area })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      if (useQuickIntent.getState().dock?.pieceId === pieceId)
        useQuickIntent.getState().setDock(null)
    }
  }, [pieceId, root, viewport, dockInspector])

  const inset = useQuickIntent((s) =>
    s.replacing?.pieceId === pieceId && s.dock?.pieceId === pieceId ? s.dock.viewInset : 0,
  )
  useEffect(() => viewer?.setInsetRight(inset), [viewer, inset])
}

/** Toasts rise above the facts strip at the bottom of the view while the Design tab is open. */
function useToastOffset(px: number) {
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--toast-offset', `${px}px`)
    return () => {
      root.removeProperty('--toast-offset')
    }
  }, [px])
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
  const selection = useWorkspace((s) => s.selection)
  const stone = useWorkspace((s) => s.stone)
  const hover = useWorkspace((s) => s.hover)
  const hidden = useWorkspace((s) => s.hidden)
  const display = useWorkspace((s) => s.display)
  const xray = useWorkspace((s) => s.xray)
  const simplified = useWorkspace((s) => s.simplified)
  const wheel = useWorkspace((s) => s.wheel)
  useEffect(() => ws().open(pieceId), [pieceId])
  useToastOffset(48)

  const view = useSessionState(session, (s) => s.view) ?? piece.design
  const settled = useSessionState(session, (s) => s.settled) ?? piece.design
  const save = useSessionState(session, (s) => s.save) ?? null
  const runs = useSessionState(session, (s) => s.runs)
  const undoable = useSessionState(session, canUndo) ?? false
  const redoable = useSessionState(session, canRedo) ?? false
  const version = useSessionState(session, (s) => s.version) ?? piece.version
  // A feature that left the design (an undo, a teammate's or the assistant's delete) is no longer
  // selected: commands and the inspector would otherwise act on something that is not there.
  useEffect(() => ws().retain((id) => Object.hasOwn(view.nodes, id)), [view])
  const { evaluation, status } = usePieceEvaluation(pieceId)
  const check = useProductionCheck(
    pieceId,
    settled,
    kernel.status === 'ready' && view.order.length > 0,
  )

  const viewer = useRef<Viewer | null>(null)
  const viewport = useRef<HTMLElement>(null)
  const menu = useRef<ContextMenuHandle>(null)
  const [menuSubject, setMenuSubject] = useState<Subject>({ type: 'piece', pieceId })
  const [addOpen, setAddOpen] = useState(false)
  const [confirm, setConfirm] = useState<{ ids: string[]; dependents: string[] } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const width = useWidth(root)
  const dockOutliner = width >= DOCK_OUTLINER_PX
  const dockInspector = width >= DOCK_INSPECTOR_PX
  const compact =
    width - (dockOutliner ? OUTLINER_PX : 0) - (dockInspector ? INSPECTOR_PX : 0) < COMPACT_VIEW_PX
  const [sheet, setSheet] = useState<'outliner' | 'inspector' | null>(null)
  const [marker, setMarker] = useState<MarkerSpot | null>(null)
  const [stepping, setStepping] = useState<string | null>(null)
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
    (selected: string[]) => {
      // The selection can outlive a feature (an undo, someone else's delete).
      const ids = selected.filter((id) => Object.hasOwn(view.nodes, id))
      if (!ids.length) return
      const dependents = [...new Set(ids.flatMap((id) => dependentsOf(view, id)))].filter(
        (d) => !ids.includes(d),
      )
      if (dependents.length) setConfirm({ ids, dependents })
      else {
        session?.commit(remove(view, ids))
        ws().select([])
      }
    },
    [view, session],
  )

  // Without a selection, a new feature attaches to the piece's main body (a stone to the band).
  const defaultTarget = () =>
    selection[0] ?? view.order.toReversed().find((id) => isBodyKind(view.nodes[id]!.kind))

  const add = (kind: NodeKind, target = defaultTarget()) => {
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
    await rpc.call('pieces.setSpec', { id: pieceId, spec })
    await rpc.call('pieces.buildFromSpec', { id: pieceId })
    await session?.resync()
  }

  const show = (d: Diagnostic) => {
    if (d.nodeId) ws().select([d.nodeId])
    if (d.at) {
      viewer.current?.frameAt(d.at as Vec3, d.nodeId)
      setMarker({ at: d.at, level: d.level, key: Date.now() })
    } else if (d.nodeId) viewer.current?.frameAll(true, [d.nodeId])
  }
  const fix = (d: Diagnostic) => d.fix && session?.commit(d.fix.ops, { label: d.fix.label })

  /**
   * A next step is a guided path for someone new to CAD, so it must not end in red: the
   * addition is evaluated first, and a one-click repair the kernel offers for it (a bail too
   * small for its new chain, say) goes into the same change.
   */
  const addStep = async (step: NextStep) => {
    if (!session || stepping) return
    const { ops, id } = addNode(view, step.kind, {
      target: step.target,
      values: step.name ? { name: step.name } : {},
    })
    if (!id) return
    setStepping(step.label)
    let repairs: Diagnostic[] = []
    try {
      const candidate = applyOps(view, ops).design
      const evaluation = await evaluationScheduler('draft').request(`${pieceId}:step`, candidate)
      repairs = (evaluation?.diagnostics ?? []).filter(
        (d) => d.level === 'error' && d.fix && (d.nodeId === id || d.nodeId === step.target),
      )
    } catch {
      // No kernel: add it as it is; the checks will say what is wrong.
    } finally {
      setStepping(null)
    }
    const label = labelForOps(ops, view)
    try {
      session.commit([...ops, ...repairs.flatMap((d) => d.fix!.ops)], { label })
    } catch {
      session.commit(ops, { label })
    }
    ws().select([id])
  }

  const issues = useMemo(
    () => toIssues(check.state === 'done' ? check.diagnostics : (evaluation?.diagnostics ?? [])),
    [check, evaluation],
  )
  const steps = useMemo(
    () => (readOnly ? [] : nextSteps(view, kernel.kinds)),
    [view, kernel.kinds, readOnly],
  )

  useCadCommands({
    session,
    viewer,
    design: view,
    readOnly,
    canUndo: undoable,
    canRedo: redoable,
    crashed: kernel.status === 'crashed',
    formats,
    issues,
    steps,
    hasRun: !!run,
    openAddMenu: () => setAddOpen(true),
    requestDelete,
    exportAs: (f: ExportFormat) =>
      void runExport(piece, view, f, {
        problems: issues.filter((i) => i.d.level === 'error').length,
        review: () => runCommand('design.showNextIssue'),
      }),
    show,
    fix,
    addStep: (s) => void addStep(s),
    undoRun: () => run && revertRun.mutate({ pieceId, runId: run.runId }),
  })

  useQuickIntentCommands(pieceId, view, evaluation, readOnly)

  const subjectOf = (nodeId: string) => subjectFor(pieceId, view, { nodeId }, evaluation)

  /**
   * The view's context menu. A right-click selects what it is on, as in every CAD tool, so the
   * menu and the highlight agree; from the keyboard it is about the selection and opens where
   * the selection is on screen.
   */
  const openViewportMenu = (
    p: { nodeId: string; stoneId?: string } | null,
    at: { x: number; y: number },
    source: 'pointer' | 'keyboard',
  ) => {
    let pick = p
    let anchor = at
    if (source === 'keyboard') {
      const { selection: ids, stone: picked } = ws()
      const id = ids.length === 1 ? ids[0]! : null
      pick = id ? { nodeId: id, ...(picked ? { stoneId: picked } : {}) } : null
      const box = id ? viewer.current?.screenBounds([id]) : null
      const rect = viewport.current?.getBoundingClientRect()
      if (box && rect)
        anchor = { x: rect.left + (box.x0 + box.x1) / 2, y: rect.top + (box.y0 + box.y1) / 2 }
    } else ws().selectForMenu(p?.nodeId ?? null)
    setMenuSubject(subjectFor(pieceId, view, pick, evaluation))
    menu.current?.openAt(anchor.x, anchor.y)
  }

  const viewerState = useMemo<ViewerState>(
    () => ({ display, selection, stone, hover, hidden, xray }),
    [display, selection, stone, hover, hidden, xray],
  )

  const empty = view.order.length === 0
  // A pendant is framed without its chain, which would otherwise shrink it to a speck.
  const frameNodeIds = useMemo(() => {
    const ids = view.order.filter((id) => view.nodes[id]!.kind !== 'chain')
    return ids.length && ids.length < view.order.length ? ids : undefined
  }, [view])
  const selectedEdit = useNodeEdit(
    selection.length === 1 ? view.nodes[selection[0]!] : undefined,
    view,
    session,
    readOnly,
    run?.prior ?? null,
  )
  const [viewerHandle, setViewerHandle] = useState<Viewer | null>(null)
  useReplaceDock(pieceId, root, viewport, dockInspector, viewerHandle)
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
      subjectOf={subjectOf}
      header={
        <div className="flex h-11 shrink-0 items-center justify-between pr-2 pl-4">
          <h2 className="text-xs font-medium text-fg-muted">Features</h2>
          {!readOnly && (
            <AddMenu
              design={view}
              kinds={kernel.kinds}
              target={defaultTarget()}
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
      empty={
        <PiecePanel
          piece={piece}
          design={view}
          evaluation={evaluation}
          session={session}
          readOnly={readOnly}
        />
      }
    />
  )

  return (
    <div ref={root} className="absolute inset-0 flex min-h-[520px]">
      {dockOutliner && (
        <aside
          data-region="outliner"
          aria-label="Feature list"
          className="w-[248px] shrink-0 border-r border-line bg-bg"
        >
          {outliner}
        </aside>
      )}
      <main
        ref={viewport}
        data-region="viewport"
        aria-label="Viewport"
        className="relative min-w-0 flex-1 overflow-clip"
      >
        <Stage
          evaluation={evaluation}
          state={viewerState}
          frameNodeIds={frameNodeIds}
          wheel={wheel}
          label="3D view of the piece. Drag to orbit, right-drag or Shift-drag to pan, scroll to zoom, right-click for actions; arrow keys orbit, F fits, 1 to 4 pick a view, Shift+F10 opens actions for the selection."
          onViewer={(v, tier) => {
            viewer.current = v
            setViewerHandle(v)
            if (tier === 'software') {
              ws().setSimplified(true)
              if (!ws().displayChosen) ws().setDisplay('clay', false)
            }
          }}
          onBeforeDispose={(v) =>
            captureCover(v, piece, session?.get().version !== mountedVersion.current, !readOnly)
          }
          onPick={(p, { additive }) => ws().pick(p, additive)}
          onHover={(p) => ws().setHover(p)}
          onContextMenu={openViewportMenu}
        >
          {!empty && (
            <ViewportMenu
              handle={menu}
              subject={menuSubject}
              design={view}
              readOnly={readOnly}
              onDelete={requestDelete}
            />
          )}
          {sweep > 0 && <Sweep key={sweep} />}
          {!empty && (
            <Dimensions viewer={viewerHandle} evaluation={evaluation} edit={selectedEdit} />
          )}
          {marker && (
            <Marker
              key={marker.key}
              viewer={viewerHandle}
              spot={marker}
              onDone={() => setMarker(null)}
            />
          )}
          <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex items-start justify-between gap-2 [&>*]:pointer-events-auto">
            <div className="flex min-w-0 items-center gap-2">
              {!dockOutliner && (
                <IconButton
                  icon={PanelLeft}
                  label="Features"
                  onClick={() => setSheet('outliner')}
                  className="glass size-9 shrink-0 rounded-lg shadow-sm"
                />
              )}
              <ViewToolbar canUndo={undoable} canRedo={redoable} />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <FileToolbar
                save={save}
                formats={empty ? [] : formats}
                simplified={simplified}
                compact={compact}
              />
              {!dockInspector && (
                <IconButton
                  icon={PanelRight}
                  label="Inspector"
                  onClick={() => setSheet('inspector')}
                  className="glass size-9 shrink-0 rounded-lg shadow-sm"
                />
              )}
            </div>
          </div>
          {run && (
            <div className="absolute inset-x-0 top-16 z-20 flex justify-center">
              <ChangeChip
                run={run}
                undoing={revertRun.isPending}
                onUndo={() => runCommand('assistant.undoRun')}
                onReview={() =>
                  void navigate({ to: '/pieces/$id/history', params: { id: pieceId } })
                }
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
            <StageStatus
              status={status}
              coverAssetId={piece.coverAssetId}
              error={kernel.error}
              hasEvaluation={!!evaluation}
            />
          )}
          {!empty && (
            <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex items-end justify-between gap-3 [&>*]:pointer-events-auto">
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {!compact &&
                  steps.map((s, i) => (
                    <Button
                      key={s.label}
                      size="sm"
                      variant="secondary"
                      icon={stepping === s.label ? undefined : Plus}
                      disabled={!!stepping}
                      className="glass shadow-sm"
                      onClick={() => runCommand(`design.next.${i}`)}
                    >
                      {stepping === s.label && <Spinner className="size-3" />}
                      {s.label}
                    </Button>
                  ))}
              </div>
              <Hud
                design={view}
                evaluation={evaluation}
                issues={issues}
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
      {dockInspector && (
        <aside
          data-region="inspector"
          aria-label="Inspector"
          className="w-[328px] shrink-0 border-l border-line bg-bg"
        >
          {inspector}
        </aside>
      )}
      {!dockOutliner && (
        <Sheet
          open={sheet === 'outliner'}
          onOpenChange={(o) => setSheet(o ? 'outliner' : null)}
          title="Features"
          side="left"
        >
          <div data-region="outliner" className="h-full">
            {outliner}
          </div>
        </Sheet>
      )}
      {!dockInspector && (
        <Sheet
          open={sheet === 'inspector'}
          onOpenChange={(o) => setSheet(o ? 'inspector' : null)}
          title="Inspector"
          side="right"
        >
          <div data-region="inspector" className="h-full">
            {inspector}
          </div>
        </Sheet>
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
                if (confirm) session?.commit(remove(view, confirm.ids))
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
      {/* AiMark sets its own display, so the reduced-motion switch lives on a wrapper. */}
      <span className="absolute top-4 left-1/2 hidden -translate-x-1/2 motion-reduce:block">
        <AiMark className="size-4" />
      </span>
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
        <img
          src={assetUrl(coverAssetId, 480)}
          alt=""
          className="max-h-[40%] max-w-[40%] object-contain opacity-60"
        />
      )}
      <p className={cn('flex items-center gap-2 text-sm text-fg-muted')}>
        <Spinner className="size-3.5" /> Preparing the workbench…
      </p>
    </div>
  )
}
