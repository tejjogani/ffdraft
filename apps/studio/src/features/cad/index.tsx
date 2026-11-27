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
  customMountPartIssue,
  type Design,
  type DrawnProfile,
  type ImportedRoleChoice,
  importRoleOf,
  isBodyKind,
  isRhinoRoleBody,
  labelForOps,
  type NodeInput,
  type NodeKind,
  type NodeOf,
  newId,
  nodeTitle,
  type Op,
  type Piece,
  type PieceSpecInput,
  reviewRhinoRoles,
  rhinoRoleLinks,
  ringBandProfileError,
  sameJson,
} from '@pave/schema'
import {
  AiMark,
  Button,
  type ContextMenuHandle,
  Dialog,
  Sheet,
  Skeleton,
  Spinner,
  toast,
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
import { displayBounds } from '../../components/stage/display-evaluation'
import { QualityIndicator } from '../../components/stage/QualityIndicator'
import { Stage } from '../../components/stage/Stage'
import type { Viewer, ViewerState } from '../../components/stage/viewer'
import { createViewVisibility, metalShellOf } from '../../components/stage/visibility'
import { runCommand } from '../../lib/commands'
import { canRedo, canUndo, hasGap } from '../../lib/design-session/core'
import { useDesignSession, useSessionState } from '../../lib/design-session/store'
import { evaluationScheduler, useKernelInfo } from '../../lib/kernel/client'
import { usePieceEvaluation } from '../../lib/kernel/usePieceEvaluation'
import { useRpc, useRpcMutation } from '../../lib/query'
import { rpc } from '../../lib/rpc'
import { activeOrg, useSession } from '../../lib/session'
import { useCurrentView } from '../../lib/use-current-view'
import { useAssistant } from '../../stores/assistant'
import { planProgress } from '../assistant/jobs/status'
import { useLiveRun } from '../assistant/jobs/useJob'
import { useQuickIntent } from '../assistant/quick-intent-store'
import { type Subject, subjectFor } from '../assistant/quick-intents'
import { reportPlanLimit } from '../plans/plan-limit'
import { ImagePlanes } from '../references/ImagePlanes'
import { renderAvailability } from '../render/availability'
import { queueCadRender, renderThisView, selectShotNext } from '../render/shot-actions'
import { useViewportTools } from './capture-tool'
import { useCadCommands } from './commands'
import { captureCover } from './cover'
import { CurveEditor } from './curves/CurveEditor'
import { CurveOverlay } from './curves/CurveOverlay'
import { RevolveDialog } from './curves/RevolveDialog'
import { SectionFeatureDialog } from './curves/SectionFeatureDialog'
import {
  initialSectionDraft,
  type SectionDraft,
  type SectionFeature,
  type SectionTool,
  sectionToolFor,
} from './curves/section-model'
import { EmptyDesign } from './empty/EmptyDesign'
import { exportFormats, runExport } from './export'
import { ChangeChip } from './hud/ChangeChip'
import { pieceFigures } from './hud/figures'
import { Hud } from './hud/Hud'
import { toIssues } from './hud/issues'
import { useProductionCheck } from './hud/useProductionCheck'
import { useNodeEdit } from './inspector/edit'
import { Inspector } from './inspector/Inspector'
import { MeshEditor } from './mesh-edit/MeshEditor'
import {
  type ComponentKind,
  type ImportedMesh,
  isImportedMesh,
  type VertexPositions,
} from './mesh-edit/model'
import { ModelImport } from './model-import/ModelImport'
import { MountEditor, mountSessionBusy } from './mount-editor/MountEditor'
import { addNode, addPrepared, dependentsOf, remove, saveSectionFeature, setField } from './ops'
import { AddMenu } from './outliner/AddMenu'
import { Outliner } from './outliner/Outliner'
import { type NextStep, nextSteps } from './outliner/suggestions'
import { PiecePanel } from './PiecePanel'
import { ProfileEditor } from './profiles/ProfileEditor'
import { isProfileNode, type ProfileNode, profileNode } from './profiles/profile'
import { useQuickIntentCommands } from './quick-commands'
import { RhinoRoleReview } from './rhino/RhinoRoleReview'
import { type NodePick, selectedTargets, targetHidden, useWorkspace } from './state/workspace'
import { Dimensions } from './viewport/Dimensions'
import { dockArea } from './viewport/dock-area'
import { Marker, type MarkerSpot } from './viewport/Marker'
import { StageStatus } from './viewport/StageStatus'
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

export function PieceDesign({
  pieceId,
  openRoleReview = false,
}: {
  pieceId: string
  openRoleReview?: boolean
}) {
  const piece = useRpc('pieces.get', { id: pieceId })
  if (piece.isPending)
    return (
      // The workspace's own shape while the piece loads: toolbar and tree, then the model.
      <div
        className="stage absolute inset-0"
        role="status"
        aria-busy="true"
        aria-label="Opening the design"
      >
        <Skeleton className="absolute top-3 left-1/2 h-9 w-72 -translate-x-1/2 rounded-lg" />
        <div className="absolute top-3 left-3 flex w-52 flex-col gap-2 max-md:hidden">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-32" />
        </div>
      </div>
    )
  if (!piece.data) return null
  return <Workspace key={piece.data.id} piece={piece.data} openRoleReview={openRoleReview} />
}

function Workspace({ piece, openRoleReview }: { piece: Piece; openRoleReview: boolean }) {
  const pieceId = piece.id
  const session = useDesignSession(piece)
  const auth = useSession()
  const org = activeOrg(auth)
  const role = org?.role ?? 'viewer'
  const readOnly = role === 'viewer' || role === 'guest'
  const [modelImport, setModelImport] = useState<{ pieceId: string; file: File | null } | null>(
    null,
  )
  const openModelImport = (file: File | null = null) => setModelImport({ pieceId, file })
  const [rhinoReview, setRhinoReview] = useState<{
    pieceId: string
    orgId?: string
    design: Design
    initialId?: string
  } | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: drop a review draft after leaving its project or access level
  useEffect(() => setRhinoReview(null), [pieceId, org?.id, readOnly])
  const [meshEditor, setMeshEditor] = useState<{
    pieceId: string
    node: ImportedMesh
    version: number
  } | null>(null)
  // A draft can only be used in the project and access level where it was opened.
  // biome-ignore lint/correctness/useExhaustiveDependencies: each transition clears the editor
  useEffect(() => setMeshEditor(null), [pieceId, readOnly])
  const [mountEditor, setMountEditor] = useState<{
    pieceId: string
    orgId?: string
    design: Design
    ids: string[]
    version: number
  } | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear drafts at project and permission transitions
  useEffect(() => setMountEditor(null), [pieceId, org?.id, readOnly])
  const navigate = useNavigate()
  const isCurrent = useCurrentView()
  const kernel = useKernelInfo()
  const selection = useWorkspace((s) => s.selection)
  const stone = useWorkspace((s) => s.stone)
  const hover = useWorkspace((s) => s.hover)
  const hidden = useWorkspace((s) => s.hidden)
  const hiddenStones = useWorkspace((s) => s.hiddenStones)
  const hiddenParts = useWorkspace((s) => s.hiddenParts)
  const isolated = useWorkspace((s) => s.isolated)
  const part = useWorkspace((s) => s.part)
  const backdrop = useWorkspace((s) => s.backdrop)
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
  const syncing = useSessionState(session, hasGap) ?? false
  const version = useSessionState(session, (s) => s.version) ?? piece.version
  // A feature that left the design (an undo, a teammate's or the assistant's delete) is no longer
  // selected: commands and the inspector would otherwise act on something that is not there.
  useEffect(() => ws().retain((id) => Object.hasOwn(view.nodes, id)), [view])
  const { evaluation, status, stale, error: failure, retry } = usePieceEvaluation(pieceId)
  const [queuingRender, setQueuingRender] = useState(false)
  const availability = renderAvailability({ design: view, evaluation, status, stale })
  const renderBlocked = queuingRender
    ? 'Queueing render…'
    : save?.status === 'offline'
      ? 'Reconnect to save the design before rendering.'
      : !session || save?.status !== 'saved' || syncing
        ? 'Wait for the design to save before rendering.'
        : {
            ready: null,
            pending: 'Wait for the geometry to finish updating.',
            failed: 'Retry the geometry engine before rendering.',
            'review-roles': 'Assign metal or stone roles to the imported geometry.',
            references: 'Add a solid body or stone to render.',
            sheets: 'Use Thicken surface in Add feature to give the sheet a wall.',
            empty: 'Add a solid body or stone to render.',
          }[availability]
  const partRevisions = useRef(new Map<string, string>())
  useEffect(() => {
    if (!evaluation || stale) return
    const stones = new Set(evaluation.stones.map((s) => s.id))
    const parts = [...evaluation.parts, ...(evaluation.referenceParts ?? [])]
    const revisions = new Map(parts.map((part) => [part.id, part.rev]))
    const previous = partRevisions.current
    partRevisions.current = revisions
    ws().retain(
      (id) => Object.hasOwn(view.nodes, id),
      stones,
      (id) => {
        const shell = metalShellOf(id)
        if (!shell) return revisions.has(id)
        // Remeshing can assign a shell's former ordinal to a different physical component.
        return (
          revisions.has(shell.partId) && revisions.get(shell.partId) === previous.get(shell.partId)
        )
      },
    )
  }, [view, evaluation, stale])
  const check = useProductionCheck(
    pieceId,
    settled,
    kernel.status === 'ready' && view.order.length > 0,
  )
  // One set of figures for the readout and the Facts panel.
  const figures = pieceFigures(evaluation, check, view === settled)

  const viewer = useRef<Viewer | null>(null)
  const viewport = useRef<HTMLElement>(null)
  const menu = useRef<ContextMenuHandle>(null)
  const [menuSubject, setMenuSubject] = useState<Subject>({ type: 'piece', pieceId })
  const [addOpen, setAddOpen] = useState(false)
  const [profile, setProfile] = useState<{ original?: ProfileNode } | null>(null)
  const [revolveSource, setRevolveSource] = useState<{ pieceId: string; id: string } | null>(null)
  const [sectionEditor, setSectionEditor] = useState<{
    pieceId: string
    tool: SectionTool
    initial: SectionDraft
    original?: SectionFeature
  } | null>(null)
  const [curve, setCurve] = useState<{ original?: NodeOf<'curve'> } | null>(null)
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
  const hasRhinoBodies = view.order.some((id) => isRhinoRoleBody(view.nodes[id]))
  useEffect(() => {
    if (!hasRhinoBodies) return
    ws().startCurveVisibility(
      view.order.filter((id) => {
        const n = view.nodes[id]
        return n?.kind === 'nurbsCurve' && !!(n.sourceObjectId || n.rhinoLayer || n.rhinoContext)
      }),
    )
  }, [hasRhinoBodies, view])
  const hasBodyFeature = view.order.some(
    (id) => !['curve', 'nurbsCurve'].includes(view.nodes[id]?.kind ?? ''),
  )
  const formats = exportFormats(kernel.formats).filter(
    (f) =>
      hasBodyFeature ||
      (f === '3dm' && view.order.some((id) => view.nodes[id]?.kind === 'nurbsCurve')),
  )
  const visible = useMemo(
    () => createViewVisibility({ hidden, hiddenStones, hiddenParts, isolated }),
    [hidden, hiddenStones, hiddenParts, isolated],
  )
  const curves = useMemo(
    () =>
      (evaluation?.curves ?? []).filter(
        (c) =>
          c.nodeId !== curve?.original?.id &&
          view.nodes[c.nodeId]?.visible &&
          visible({ nodeId: c.nodeId }),
      ),
    [evaluation?.curves, view, visible, curve],
  )
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
  // The parts an assistant edit just touched glow once in the AI colour (not under reduced
  // motion, where the feature list's AI badge says the same without movement).
  const [aiTint, setAiTint] = useState<string[]>([])
  // biome-ignore lint/correctness/useExhaustiveDependencies: a landed change is the trigger
  useEffect(() => {
    if (!landed || !latestRun) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    setAiTint([...Object.keys(latestRun.prior), ...latestRun.added])
    const t = setTimeout(() => setAiTint([]), 1800)
    return () => clearTimeout(t)
  }, [landed])

  // ── The assistant at work on this piece ──────────────────────────────────────────────────
  const activity = useAssistant((s) => (s.activity?.pieceId === pieceId ? s.activity : null))
  // Any live run on this piece, whether or not the dock that started it is open.
  const pieceRuns = useRpc('traces.runs', { pieceId, limit: 10 })
  const liveRun = useLiveRun(pieceRuns.data?.find((r) => r.status === 'running') ?? null).run
  const working = liveRun?.status === 'running' ? liveRun : null
  const workingRunId = working?.id ?? activity?.runId ?? null
  const workingLabel =
    (activity?.runId === workingRunId ? activity?.label : undefined) ??
    (working?.job ? planProgress(working.job).current?.label : undefined) ??
    'Assistant is working'
  const stopRun = useRpcMutation('runs.cancel', { meta: { silent: true } })
  // What is selected here goes along when the assistant is opened with mod+j.
  useEffect(() => {
    const set = useAssistant.getState().setLiveSelection
    set(selection.length ? { pieceId, nodeIds: [...selection] } : null)
  }, [selection, pieceId])
  useEffect(() => () => useAssistant.getState().setLiveSelection(null), [])

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

  const openSectionTool = (tool: SectionTool, original?: SectionFeature) => {
    if (!session || readOnly || curve || profile || !kernel.kinds.includes(tool.kind)) return
    setAddOpen(false)
    setSheet(null)
    setSectionEditor({
      pieceId,
      tool,
      initial: initialSectionDraft(session.get().view, tool, ws().selection, original),
      original,
    })
  }

  const add = (kind: NodeKind, target = defaultTarget()) => {
    const { ops, id } = addNode(view, kind, { target })
    if (!ops.length || !session) return
    if (
      ops[0]?.t === 'add' &&
      ops[0].node.kind === 'revolve' &&
      typeof ops[0].node.curve === 'string'
    ) {
      setRevolveSource({ pieceId, id: ops[0].node.curve })
      return
    }
    session.commit(ops)
    if (id) ws().select([id])
  }

  const importNode = (node: NodeInput, kind: Design['kind']) => {
    session?.commit(addPrepared(view, node, kind))
    ws().select([node.id])
  }

  const importModel = (nodes: NodeInput[], label: string) => {
    if (!session || readOnly) throw new Error('This design is read-only.')
    const design = session.get().view
    session.commit(
      nodes.flatMap((node) => addPrepared(design, node)),
      { label },
    )
    ws().select(nodes.map((node) => node.id))
  }

  const openRhinoRoleReview = useCallback(
    (id?: string) => {
      if (!session || readOnly) return
      const design = session.get().view
      const { selection } = ws()
      const selected = id
        ? design.nodes[id]
        : selection.length === 1
          ? design.nodes[selection[0]!]
          : undefined
      const initialId =
        selected?.kind === 'gem' || selected?.kind === 'setting'
          ? selected.importSourceId
          : selected?.id
      setSheet(null)
      setRhinoReview({ pieceId, orgId: org?.id, design, initialId })
    },
    [org?.id, pieceId, readOnly, session],
  )

  useEffect(() => {
    if (!openRoleReview || !session || readOnly || !hasRhinoBodies) return
    const firstUnassigned = view.order.find((id) => {
      const node = view.nodes[id]
      return isRhinoRoleBody(node) && node.visible !== false && importRoleOf(node) === 'unassigned'
    })
    openRhinoRoleReview(firstUnassigned)
    void navigate({
      to: '/pieces/$id/design',
      params: { id: pieceId },
      search: ({ board }: { board?: string }) => ({ board }),
      replace: true,
    })
  }, [
    hasRhinoBodies,
    navigate,
    openRhinoRoleReview,
    openRoleReview,
    pieceId,
    readOnly,
    session,
    view,
  ])

  const selectRhinoRoleBody = (id: string, design: Design) => {
    const body = design.nodes[id]
    if (!isRhinoRoleBody(body) || ws().pieceId !== pieceId) return
    const links = rhinoRoleLinks(design, id)
    const linked = importRoleOf(body) === 'setting' ? links.setting : links.gem
    ws().select([linked?.id ?? id])
  }

  const currentRhinoReview = () => {
    if (
      !session ||
      readOnly ||
      !isCurrent() ||
      rhinoReview?.pieceId !== pieceId ||
      rhinoReview.orgId !== org?.id
    )
      throw new Error('Open the review in the current design.')
    const latest = session.get()
    if (latest.pieceId !== pieceId || hasGap(latest) || !sameJson(rhinoReview.design, latest.view))
      throw new Error(
        'The design changed during review. Reopen the review to see the current bodies.',
      )
    if (latest.pending.length || latest.gesture)
      throw new Error('Wait for the design to finish saving before you apply the review.')
    return { session, latest }
  }

  const confirmRhinoRoles = (choices: ImportedRoleChoice[]) => {
    const { session, latest } = currentRhinoReview()
    const ops = reviewRhinoRoles(latest.view, choices)
    session.commit(ops, { label: 'Confirmed Rhino roles', baseVersion: latest.version })
    if (choices[0]) selectRhinoRoleBody(choices[0].sourceId, session.get().view)
    setRhinoReview(null)
  }

  const recoverRhinoLabels = (ops: Op[]) => {
    const { session, latest } = currentRhinoReview()
    session.commit(ops, { label: 'Recovered Rhino source labels', baseVersion: latest.version })
    setRhinoReview(null)
  }

  const editMesh = (node: ImportedMesh) => {
    if (!session || readOnly || profile || curve) return
    const state = session.get()
    if (state.pending.length || state.gesture || hasGap(state)) {
      toast({ title: 'Wait for the design to finish saving, then open Edit mesh.' })
      return
    }
    const current = state.confirmed.nodes[node.id]
    if (!isImportedMesh(current) || current.source.assetId !== node.source.assetId) {
      toast({ title: 'The part changed. Select it again to edit its mesh.' })
      return
    }
    setSheet(null)
    setMeshEditor({ pieceId, node: current, version: state.version })
  }

  const editMount = (ids: string[]) => {
    if (!session || readOnly || profile || curve || !isCurrent()) return
    const state = session.get()
    if (mountSessionBusy(state)) {
      toast({ title: 'Wait for the design to finish saving, then open Edit handmade mount.' })
      return
    }
    const selected = ids.filter((id) => !customMountPartIssue(state.confirmed, id))
    if (selected.length === 0) {
      toast({ title: 'The selected parts changed. Select eligible imported bodies again.' })
      return
    }
    setSheet(null)
    setMountEditor({
      pieceId,
      orgId: org?.id,
      design: state.confirmed,
      ids: selected,
      version: state.version,
    })
  }

  const saveMesh = (positions: VertexPositions, component: ComponentKind) => {
    if (!session || readOnly || meshEditor?.pieceId !== pieceId)
      throw new Error('This design is read-only.')
    const latest = session.get()
    const node = latest.view.nodes[meshEditor.node.id]
    if (
      latest.pieceId !== pieceId ||
      latest.version !== meshEditor.version ||
      latest.pending.length ||
      latest.gesture ||
      hasGap(latest) ||
      !isImportedMesh(node) ||
      node.source.assetId !== meshEditor.node.source.assetId ||
      !sameJson(node.meshEdits, meshEditor.node.meshEdits)
    )
      throw new Error('The design changed. Close this editor and reopen to edit the saved mesh.')
    session.commit(
      [
        {
          t: 'update',
          id: node.id,
          patch: { meshEdits: { assetId: node.source.assetId, vertices: positions } },
        },
      ],
      {
        label: `Moved a mesh ${component.toLowerCase()}`,
        baseVersion: latest.version,
      },
    )
    setMeshEditor(null)
  }

  const drawProfile = () => {
    if (!curve) setProfile({})
  }
  const drawCurve = () => {
    if (!profile && !curve) setCurve({})
  }
  const revolveCurve = (id: string) => {
    if (!readOnly && !curve && !profile) setRevolveSource({ pieceId, id })
  }
  const selectedProfile =
    revolveSource?.pieceId === pieceId ? view.nodes[revolveSource.id] : undefined

  const makeRingBand = (curveId: string) => {
    if (!session || readOnly || curve || profile) return
    const current = session.get().view
    const source = current.nodes[curveId]
    if (source?.kind !== 'curve' || ringBandProfileError(source)) return
    const id = newId('revolve')
    session.commit(
      addPrepared(current, {
        kind: 'revolve',
        id,
        curve: curveId,
        size: { system: 'us', value: 6 },
      }),
      { label: 'Made a custom ring band' },
    )
    ws().select([id])
    if (!dockInspector) setSheet('inspector')
  }

  const makeWire = (id: string) => {
    if (!session || readOnly || profile || curve || session.get().view.nodes[id]?.kind !== 'curve')
      return
    add('pipe', id)
    if (!dockInspector) setSheet('inspector')
  }
  const saveCurve = (
    definition: Pick<NodeOf<'curve'>, 'plane' | 'planeOffset' | 'points' | 'closed'>,
  ) => {
    if (!session || readOnly) throw new Error('This design is read-only.')
    const original = curve?.original
    if (!original) {
      const id = newId('curve')
      session.commit(addPrepared(view, { id, kind: 'curve', ...definition }), {
        label: 'Drew a construction curve',
      })
      ws().select([id])
    } else {
      const current = session.get().view.nodes[original.id]
      if (
        current?.kind !== 'curve' ||
        current.plane !== original.plane ||
        (current.planeOffset ?? 0) !== (original.planeOffset ?? 0) ||
        current.closed !== original.closed ||
        !sameJson(current.points, original.points)
      )
        throw new Error(
          'This curve changed while it was open. Reopen it to edit the latest version.',
        )
      if (
        current.plane !== definition.plane ||
        (current.planeOffset ?? 0) !== (definition.planeOffset ?? 0) ||
        current.closed !== definition.closed ||
        !sameJson(current.points, definition.points)
      )
        session.commit([{ t: 'update', id: original.id, patch: definition }], {
          label: 'Edited construction curve points',
        })
    }
    setCurve(null)
  }
  const saveProfile = (source: DrawnProfile, thickness: number) => {
    if (!session || readOnly) throw new Error('This design is read-only.')
    const original = profile?.original
    if (!original) {
      const node = profileNode(source, thickness)
      session.commit(addPrepared(view, node), { label: 'Extruded a drawn profile' })
      ws().select([node.id])
      return
    }
    const current = session.get().view.nodes[original.id]
    if (
      !isProfileNode(current) ||
      current.thickness !== original.thickness ||
      JSON.stringify(current.source) !== JSON.stringify(original.source)
    )
      throw new Error(
        'This profile changed while it was open. Reopen it to edit the latest version.',
      )
    if (
      current.thickness === thickness &&
      JSON.stringify(current.source) === JSON.stringify(source)
    )
      return
    session.commit(
      [setField(original.id, ['source'], source), setField(original.id, ['thickness'], thickness)],
      { label: 'Edited a drawn profile' },
    )
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

  const renderSavedDesign = async () => {
    if (!session || readOnly || renderBlocked || !isCurrent()) return
    const sourceVersion = version
    setQueuingRender(true)
    try {
      const shot = await queueCadRender(pieceId, view.kind, sourceVersion, () => {
        if (!isCurrent()) return false
        const current = session.get()
        if (current.version !== sourceVersion || current.save.status !== 'saved' || hasGap(current))
          throw new Error('The design changed. Wait for it to save, then click Render again.')
        return true
      })
      if (shot && isCurrent()) {
        selectShotNext(pieceId, shot.id)
        await navigate({ to: '/pieces/$id/render', params: { id: pieceId } })
      }
    } catch (err) {
      if (isCurrent() && !reportPlanLimit(err))
        toast.error(
          'Couldn’t start the render',
          err instanceof Error ? err.message : 'Try Render again.',
        )
    } finally {
      if (isCurrent()) setQueuingRender(false)
    }
  }

  useCadCommands({
    session,
    viewer,
    design: view,
    readOnly,
    canUndo: undoable,
    canRedo: redoable,
    crashed: kernel.status === 'crashed',
    formats,
    kinds: kernel.kinds,
    issues,
    steps,
    hasRun: !!run,
    openAddMenu: () => setAddOpen(true),
    drawProfile,
    drawCurve,
    makeWire,
    makeRingBand,
    revolveCurve,
    openSectionTool,
    canRenderSavedDesign: !readOnly && renderBlocked === null,
    renderSavedDesign: () => void renderSavedDesign(),
    renderThisView: () => {
      const camera = viewer.current?.shotCamera()
      if (!camera) return
      void renderThisView(piece.id, view.kind, camera)
        .then(() => {
          if (isCurrent()) void navigate({ to: '/pieces/$id/render', params: { id: piece.id } })
        })
        .catch((e: Error) => toast.error('Couldn’t copy the view to a shot', e.message))
    },
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

  const subjectOf = (nodeId: string | null, stoneId?: string) =>
    subjectFor(
      pieceId,
      view,
      nodeId === null ? null : { nodeId, ...(stoneId && { stoneId }) },
      evaluation,
    )

  /**
   * The view's context menu. A right-click selects what it is on, as in every CAD tool, so the
   * menu and the highlight agree; from the keyboard it is about the selection and opens where
   * the selection is on screen.
   */
  const openViewportMenu = (
    p: NodePick | null,
    at: { x: number; y: number },
    source: 'pointer' | 'keyboard',
  ) => {
    let pick = p
    let anchor = at
    if (source === 'keyboard') {
      const { selection: ids, stone: picked, part: pickedPart } = ws()
      const id = ids.length === 1 ? ids[0]! : null
      pick = id
        ? {
            nodeId: id,
            ...(picked ? { stoneId: picked } : {}),
            ...(pickedPart ? { partId: pickedPart } : {}),
          }
        : null
      const box = id ? viewer.current?.screenBounds([id]) : null
      const rect = viewport.current?.getBoundingClientRect()
      if (box && rect)
        anchor = { x: rect.left + (box.x0 + box.x1) / 2, y: rect.top + (box.y0 + box.y1) / 2 }
    } else ws().selectForMenu(p?.nodeId ?? null, p?.stoneId, p?.partId)
    setMenuSubject(subjectFor(pieceId, view, pick, evaluation))
    menu.current?.openAt(anchor.x, anchor.y)
  }

  const viewerState = useMemo<ViewerState>(
    () => ({
      display,
      selection,
      stone,
      part,
      hover,
      hidden,
      hiddenStones,
      hiddenParts,
      isolated,
      xray,
      aiTint,
    }),
    [
      display,
      selection,
      stone,
      part,
      hover,
      hidden,
      hiddenStones,
      hiddenParts,
      isolated,
      xray,
      aiTint,
    ],
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
  const owner = selection.length === 1 ? view.nodes[selection[0]!] : undefined
  const ownerStones =
    stone && owner ? evaluation?.stones.filter((s) => s.nodeId === owner.id) : undefined
  const selectedOrdinal = ownerStones?.findIndex((s) => s.id === stone)
  useEffect(() => {
    if (backdrop) viewerHandle?.refreshTheme()
  }, [viewerHandle, backdrop])
  const shell = metalShellOf(part)
  const selectedTitle =
    owner && typeof selectedOrdinal === 'number' && selectedOrdinal >= 0 && owner.kind !== 'gem'
      ? `Stone ${selectedOrdinal + 1} of ${ownerStones?.length} · ${nodeTitle(owner)}`
      : owner && shell
        ? `Part ${shell.index + 1} · ${nodeTitle(owner)}`
        : selection.length
          ? selection.map((id) => (view.nodes[id] ? nodeTitle(view.nodes[id]!) : id)).join(', ')
          : 'Nothing'

  const targets = selectedTargets({ selection, stone, part })
  const allHidden =
    targets.length > 0 &&
    targets.every((t) => targetHidden({ hidden, hiddenStones, hiddenParts }, t))
  const hasHidden = Boolean(hidden.length || hiddenStones.length || hiddenParts.length)
  const kindLabel =
    selection.length > 1
      ? 'selection'
      : stone || owner?.kind === 'gem'
        ? 'stone'
        : owner?.kind === 'curve' || owner?.kind === 'nurbsCurve'
          ? 'curve'
          : 'part'
  const outliner = (
    <Outliner
      design={view}
      stones={evaluation?.stones ?? []}
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
              onAdd={(kind, tool) => (tool ? openSectionTool(tool) : add(kind))}
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
      pieceId={pieceId}
      design={view}
      session={session}
      evaluation={evaluation}
      prior={run?.prior ?? null}
      readOnly={readOnly}
      onDelete={requestDelete}
      onEditMesh={editMesh}
      onEditMount={editMount}
      onReviewRhinoRole={openRhinoRoleReview}
      onEditProfile={(original) => setProfile({ original })}
      onLocateProng={(at) => {
        setSheet(null)
        setMarker({ at, level: 'info', key: Date.now() })
      }}
      onEditCurve={(original) => {
        if (!curve && !profile) {
          setSheet(null)
          setCurve({ original })
        }
      }}
      onRevolve={revolveCurve}
      onMakeRingBand={makeRingBand}
      onEditSectionFeature={(node) => openSectionTool(sectionToolFor(node), node)}
      canEditSectionFeature={(node) => kernel.kinds.includes(node.kind)}
      onMakeWire={makeWire}
      empty={
        <PiecePanel
          piece={piece}
          design={view}
          figures={figures}
          session={session}
          readOnly={readOnly}
        />
      }
    />
  )

  return (
    <div ref={root} className="absolute inset-0 flex min-h-0">
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
          className={backdrop === 'studio' ? 'cad-studio-backdrop' : 'cad-dark-backdrop'}
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
          <CurveOverlay viewer={viewerHandle} curves={curves} selected={selection} />
          {curve && !readOnly && (
            <CurveEditor
              viewer={viewerHandle}
              snapSources={curves}
              {...(curve.original ? { original: curve.original } : {})}
              onSave={saveCurve}
              onCancel={() => setCurve(null)}
            />
          )}
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
          <ImagePlanes
            viewer={viewerHandle}
            pieceId={pieceId}
            bounds={evaluation ? displayBounds(evaluation) : null}
            readOnly={readOnly}
            stoneMm={evaluation?.stones.find((x) => x.role === 'center')?.dims.width ?? null}
          />
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
          {/* On a phone the two toolbars do not fit one row: saving and export wrap below. */}
          {!curve && (
            <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-wrap items-start justify-between gap-2 [&>*]:pointer-events-auto">
              <div className="flex min-w-0 items-center gap-2">
                {!dockOutliner && (
                  <Button
                    icon={PanelLeft}
                    aria-label="Features"
                    title="Features"
                    onClick={() => setSheet('outliner')}
                    className="glass h-9 shrink-0 rounded-lg px-2.5 shadow-sm"
                  >
                    <span className="hidden sm:inline">Features</span>
                  </Button>
                )}
                <ViewToolbar
                  canUndo={undoable}
                  canRedo={redoable}
                  compact={compact}
                  {...(!empty && !readOnly
                    ? { onDrawProfile: drawProfile, onDrawCurve: drawCurve }
                    : {})}
                />
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <FileToolbar
                  save={save}
                  formats={formats}
                  canSaveFile={!empty}
                  simplified={simplified}
                  compact={compact}
                  render={readOnly ? undefined : { blocked: renderBlocked, pending: queuingRender }}
                  onImportModel={readOnly ? undefined : () => openModelImport()}
                  onReviewRhinoRoles={
                    !readOnly && session && hasRhinoBodies ? () => openRhinoRoleReview() : undefined
                  }
                />
                {!dockInspector && (
                  <Button
                    icon={PanelRight}
                    aria-label="Inspector"
                    title="Inspector"
                    onClick={() => setSheet('inspector')}
                    className="glass h-9 shrink-0 rounded-lg px-2.5 shadow-sm"
                  >
                    <span className="hidden sm:inline">Inspector</span>
                  </Button>
                )}
              </div>
            </div>
          )}
          {!curve && workingRunId && (
            <div className="pointer-events-none absolute inset-x-0 top-16 z-30 flex justify-center">
              <div
                role="status"
                data-assistant-working={workingRunId}
                className="glass pointer-events-auto flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm shadow-sm"
              >
                <AiMark className="size-3.5 animate-pulse" />
                <span className="max-w-72 truncate">{workingLabel}</span>
                <span aria-hidden className="text-fg-subtle">
                  ·
                </span>
                <button
                  type="button"
                  className="font-medium hover:underline"
                  onClick={() => stopRun.mutate({ runId: workingRunId })}
                >
                  Stop
                </button>
              </div>
            </div>
          )}
          {!curve && run && !workingRunId && (
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
          {empty && !curve ? (
            <EmptyDesign
              pieceId={pieceId}
              design={view}
              assistantAvailable={auth.capabilities.assistant}
              onBuild={buildFromSpec}
              onImport={importNode}
              {...(!readOnly
                ? {
                    onDrawProfile: drawProfile,
                    onDrawCurve: drawCurve,
                    onImportModel: openModelImport,
                  }
                : {})}
            />
          ) : !empty ? (
            <StageStatus
              status={status}
              coverAssetId={piece.coverAssetId}
              error={kernel.error}
              failure={failure}
              hasEvaluation={!!evaluation}
              onRetry={retry}
            />
          ) : null}
          {!empty && !curve && (
            <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex items-end justify-between gap-3 [&>*]:pointer-events-auto">
              <div className="flex min-w-0 flex-wrap items-end gap-1.5">
                {(targets.length > 0 || isolated.length > 0 || hasHidden) && (
                  <fieldset
                    aria-label="Selection visibility"
                    className="glass flex max-w-full flex-wrap items-center gap-1 rounded-lg p-1 shadow-sm"
                  >
                    {targets.length > 0 && (
                      <>
                        <span
                          className="max-w-36 truncate px-1.5 text-xs font-medium"
                          title={selectedTitle}
                        >
                          {selectedTitle}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => runCommand('design.hideSelected')}
                        >
                          {allHidden ? 'Show' : 'Hide'} {kindLabel}
                        </Button>
                        {!isolated.length && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => runCommand('view.isolateSelected')}
                          >
                            Isolate {kindLabel}
                          </Button>
                        )}
                      </>
                    )}
                    {isolated.length > 0 && (
                      <Button size="sm" onClick={() => runCommand('view.exitIsolation')}>
                        Exit isolation
                      </Button>
                    )}
                    {hasHidden && !isolated.length && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Show all hidden features"
                        onClick={() => runCommand('view.showAll')}
                      >
                        Show all
                      </Button>
                    )}
                  </fieldset>
                )}
                {!compact &&
                  !targets.length &&
                  !isolated.length &&
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
                <QualityIndicator source={viewerHandle} className="self-end" />
              </div>
              <Hud
                design={view}
                figures={figures}
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
      {profile && !readOnly && (
        <ProfileEditor
          {...(profile.original
            ? {
                original: profile.original.source,
                initialDepth: profile.original.thickness,
              }
            : {})}
          onClose={() => setProfile(null)}
          onSave={saveProfile}
        />
      )}
      {selectedProfile?.kind === 'curve' && !readOnly && (
        <RevolveDialog
          key={pieceId + '/' + selectedProfile.id}
          source={selectedProfile}
          onClose={() => setRevolveSource(null)}
          onSave={(settings) => {
            if (!session || session.get().view.nodes[selectedProfile.id]?.kind !== 'curve') return
            const id = newId('revolve')
            session.commit(
              addPrepared(session.get().view, {
                kind: 'revolve',
                id,
                curve: selectedProfile.id,
                ...settings,
              }),
              { label: 'Revolved a construction curve' },
            )
            ws().select([id])
            setRevolveSource(null)
            if (!dockInspector) setSheet('inspector')
          }}
        />
      )}
      {!readOnly && session && sectionEditor?.pieceId === pieceId && (
        <SectionFeatureDialog
          key={`${pieceId}/${sectionEditor.original?.id ?? sectionEditor.tool.id}`}
          design={view}
          tool={sectionEditor.tool}
          initial={sectionEditor.initial}
          editing={!!sectionEditor.original}
          onClose={() => setSectionEditor(null)}
          onSave={async (draft, signal) => {
            const current = session.get().view
            const { tool, original } = sectionEditor
            const { id, ops } = saveSectionFeature(current, tool, draft, original)
            if (ops.length) {
              const candidate = applyOps(current, ops).design
              const result = await evaluationScheduler('draft').request(
                `${pieceId}:section-feature`,
                candidate,
              )
              if (signal.aborted || !isCurrent()) return
              if (!result) throw new Error('The geometry check was interrupted. Try again.')
              const issue = result.diagnostics.find((d) => d.nodeId === id && d.level === 'error')
              if (issue) throw new Error(issue.message)
              const latest = session.get().view
              if (latest !== current && !sameJson(latest, current))
                throw new Error('The design changed during the geometry check. Try again.')
              session.commit(ops, {
                label: original ? `Edited ${tool.title.toLowerCase()}` : tool.title,
              })
            }
            setSectionEditor(null)
            ws().select([id])
            if (!dockInspector) setSheet('inspector')
          }}
        />
      )}
      {!readOnly &&
        session &&
        mountEditor?.pieceId === pieceId &&
        mountEditor.orgId === org?.id && (
          <MountEditor
            key={pieceId}
            pieceId={pieceId}
            design={mountEditor.design}
            initialIds={mountEditor.ids}
            baseVersion={mountEditor.version}
            session={session}
            isCurrent={isCurrent}
            onClose={() => setMountEditor(null)}
          />
        )}
      {!readOnly && session && meshEditor?.pieceId === pieceId && (
        <MeshEditor
          key={`${pieceId}/${meshEditor.node.id}`}
          node={meshEditor.node}
          stale={version !== meshEditor.version || save?.status !== 'saved' || syncing}
          onClose={() => setMeshEditor(null)}
          onSave={saveMesh}
        />
      )}
      {!readOnly &&
        session &&
        rhinoReview?.pieceId === pieceId &&
        rhinoReview.orgId === org?.id && (
          <RhinoRoleReview
            key={pieceId}
            design={rhinoReview.design}
            initialId={rhinoReview.initialId}
            onClose={() => setRhinoReview(null)}
            onSelect={(body) => selectRhinoRoleBody(body.id, session.get().view)}
            onSave={confirmRhinoRoles}
            onRecover={recoverRhinoLabels}
          />
        )}
      {!readOnly && session && modelImport?.pieceId === pieceId && (
        <ModelImport
          key={pieceId}
          initialFile={modelImport.file}
          onClose={() => setModelImport(null)}
          onImport={importModel}
        />
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
