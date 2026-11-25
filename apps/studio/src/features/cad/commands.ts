/**
 * Every action of the Design tab as a registered command: the palette, shortcuts, toolbar and
 * menus all run these. Shortcuts are platform-neutral; none uses Alt (it opens menus on Windows
 * and Linux and types symbols on macOS), and `mod+z` leaves text fields their own undo.
 */
import type { Diagnostic, ExportFormat } from '@pave/kernel'
import type { CameraPreset } from '@pave/render'
import type { Design } from '@pave/schema'
import {
  ArrowDown,
  ArrowUp,
  Box,
  Camera,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  Focus,
  Gem,
  Mouse,
  PencilLine,
  PencilRuler,
  Plus,
  Redo2,
  RefreshCw,
  Scale,
  ScanEye,
  SlidersHorizontal,
  Trash2,
  Undo2,
  Wrench,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { RefObject } from 'react'
import type { Viewer } from '../../components/stage/viewer'
import type { WheelDevice } from '../../components/stage/wheel'
import { type Command, useRegisterCommands } from '../../lib/commands'
import type { DesignSession } from '../../lib/design-session/store'
import { restartKernel } from '../../lib/kernel/client'
import { EXPORT_PURPOSE } from './export'
import type { Issue } from './hud/issues'
import { move, setIncluded } from './ops'
import type { NextStep } from './outliner/suggestions'
import { type DisplayMode, useWorkspace } from './state/workspace'

export interface CadCommandContext {
  session: DesignSession | null
  viewer: RefObject<Viewer | null>
  /** The design as the window shows it. */
  design: Design
  readOnly: boolean
  canUndo: boolean
  canRedo: boolean
  crashed: boolean
  formats: readonly ExportFormat[]
  /** The checks list, problems first. */
  issues: readonly Issue[]
  /** The next-step suggestions currently offered. */
  steps: readonly NextStep[]
  /** Whether the assistant's latest run is on show (and can be undone). */
  hasRun: boolean
  openAddMenu(): void
  requestDelete(ids: string[]): void
  exportAs(format: ExportFormat): void
  show(d: Diagnostic): void
  fix(d: Diagnostic): void
  addStep(step: NextStep): void
  undoRun(): void
  /** Copies this view's camera into a new shot and opens it in the Render tab. */
  renderThisView(): void
}

const VIEWS: { id: CameraPreset; title: string; key: string }[] = [
  { id: 'hero', title: 'Hero view', key: '1' },
  { id: 'front', title: 'Front view', key: '2' },
  { id: 'side', title: 'Side view', key: '3' },
  { id: 'top', title: 'Top view', key: '4' },
]

export const DISPLAY_MODES: { id: DisplayMode; title: string; key: string; icon: typeof Gem }[] = [
  { id: 'rendered', title: 'Rendered', key: 'shift+1', icon: Gem },
  { id: 'clay', title: 'Clay', key: 'shift+2', icon: Box },
  { id: 'technical', title: 'Technical', key: 'shift+3', icon: PencilRuler },
]

/** The focusable regions F6 cycles through, in order. */
const REGIONS = [
  '[data-region="outliner"]',
  '[data-region="viewport"]',
  '[data-region="inspector"]',
]

function cycleRegion(backwards: boolean) {
  const els = REGIONS.map((s) => document.querySelector<HTMLElement>(s)).filter((e) => e !== null)
  const at = els.findIndex((el) => el.contains(document.activeElement))
  const next = els[(at + (backwards ? -1 : 1) + els.length) % els.length]
  if (!next) return
  // The region's first control that can actually take focus; else the region itself.
  for (const el of next.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    el.focus()
    if (document.activeElement === el) return
  }
  if (!next.hasAttribute('tabindex')) next.tabIndex = -1
  next.focus()
}

const FOCUSABLE =
  '[tabindex="0"]:not([disabled]), button:not([disabled]), input:not([disabled]), select:not([disabled])'

/** The arrow keys orbit while the 3D view itself has the keyboard. */
const inViewport = () => document.activeElement?.getAttribute('role') === 'application'

/** "For another CAD" → "Export for another CAD — STEP": only the first letter changes case. */
const exportTitle = (f: ExportFormat) => {
  const label = EXPORT_PURPOSE[f].label
  return `Export ${label[0]!.toLowerCase()}${label.slice(1)} — ${f.toUpperCase()}`
}

export const WHEEL_DEVICES: { id: WheelDevice; title: string }[] = [
  { id: 'auto', title: 'Scroll wheel: detect mouse or trackpad' },
  { id: 'mouse', title: 'Scroll wheel: mouse (scroll zooms)' },
  { id: 'trackpad', title: 'Scroll wheel: trackpad (swipe orbits, pinch zooms)' },
]

export function useCadCommands(c: CadCommandContext): void {
  const ws = useWorkspace.getState
  const hasSelection = () => ws().selection.length > 0
  const orbit = (az: number, el: number) => () => c.viewer.current?.orbit(az, el)
  const selected = () => ws().selection.filter((id) => c.design.nodes[id])
  const editable = () => !c.readOnly && !!c.session
  /** The single selected feature's position in the list, for moving it. */
  const position = () => {
    const ids = selected()
    return ids.length === 1 ? c.design.order.indexOf(ids[0]!) : -1
  }
  const allHidden = () => selected().every((id) => ws().hidden.includes(id))
  const allExcluded = () => selected().every((id) => c.design.nodes[id]!.visible === false)
  const firstFix = () => c.issues.find((i) => i.d.fix)?.d
  const commands: Command[] = [
    {
      id: 'design.undo',
      title: 'Undo',
      group: 'Design',
      icon: Undo2,
      shortcut: 'mod+z',
      inEditable: false,
      when: () => c.canUndo,
      run: () => c.session?.undo(),
    },
    {
      id: 'design.redo',
      title: 'Redo',
      group: 'Design',
      icon: Redo2,
      shortcut: 'mod+shift+z',
      inEditable: false,
      when: () => c.canRedo,
      run: () => c.session?.redo(),
    },
    {
      id: 'design.redo.alt',
      title: 'Redo',
      group: 'Design',
      shortcut: 'mod+y',
      inEditable: false,
      hidden: true,
      when: () => c.canRedo,
      run: () => c.session?.redo(),
    },
    {
      id: 'design.add',
      title: 'Add a feature…',
      group: 'Design',
      icon: Plus,
      shortcut: 'a',
      when: () => !c.readOnly,
      run: c.openAddMenu,
    },
    {
      id: 'design.delete',
      title: 'Delete selected feature',
      group: 'Design',
      icon: Trash2,
      shortcut: 'delete',
      when: () => !c.readOnly && hasSelection(),
      run: () => c.requestDelete(ws().selection),
    },
    {
      id: 'design.delete.alt',
      title: 'Delete selected feature',
      group: 'Design',
      shortcut: 'backspace',
      hidden: true,
      when: () => !c.readOnly && hasSelection(),
      run: () => c.requestDelete(ws().selection),
    },
    {
      id: 'design.rename',
      title: 'Rename feature',
      group: 'Design',
      icon: PencilLine,
      shortcut: 'f2',
      when: () => !c.readOnly && ws().selection.length === 1,
      run: () => ws().setRenaming(ws().selection[0]!),
    },
    {
      id: 'design.hideSelected',
      title: allHidden() && hasSelection() ? 'Show selected in view' : 'Hide selected in view',
      group: 'Design',
      icon: allHidden() && hasSelection() ? Eye : EyeOff,
      shortcut: 'h',
      keywords: ['visibility'],
      when: hasSelection,
      run: () => {
        const show = allHidden()
        const hidden = new Set(ws().hidden)
        for (const id of selected()) show ? hidden.delete(id) : hidden.add(id)
        useWorkspace.setState({ hidden: [...hidden] })
      },
    },
    {
      id: 'design.excludeSelected',
      title:
        allExcluded() && hasSelection()
          ? 'Count selected in weight and export'
          : 'Leave selected out of weight and export',
      group: 'Design',
      icon: Scale,
      keywords: ['exclude', 'include', 'part of the piece'],
      when: () => editable() && hasSelection(),
      run: () => {
        const include = allExcluded()
        c.session?.commit(selected().map((id) => setIncluded(id, include)))
      },
    },
    {
      id: 'design.moveUp',
      title: 'Move feature up',
      group: 'Design',
      icon: ArrowUp,
      when: () => editable() && position() > 0,
      run: () => c.session?.commit([move(selected()[0]!, position() - 1)]),
    },
    {
      id: 'design.moveDown',
      title: 'Move feature down',
      group: 'Design',
      icon: ArrowDown,
      when: () => editable() && position() >= 0 && position() < c.design.order.length - 1,
      run: () => c.session?.commit([move(selected()[0]!, position() + 1)]),
    },
    {
      id: 'design.showNextIssue',
      title: 'Show the next thing to check',
      group: 'Design',
      icon: Crosshair,
      keywords: ['diagnostics', 'problems', 'checks'],
      when: () => c.issues.some((i) => i.d.nodeId || i.d.at),
      run: () => {
        const located = c.issues.filter((i) => i.d.nodeId || i.d.at)
        const current = located.findIndex((i) => i.d.nodeId === ws().selection[0])
        c.show(located[(current + 1) % located.length]!.d)
      },
    },
    {
      id: 'design.fixNext',
      title: firstFix()?.fix ? `Fix: ${firstFix()!.fix!.label}` : 'Fix the next problem',
      group: 'Design',
      icon: Wrench,
      keywords: ['repair', 'diagnostics', 'checks'],
      when: () => editable() && !!firstFix(),
      run: () => {
        const d = firstFix()
        if (d) c.fix(d)
      },
    },
    ...c.steps.map(
      (step, i): Command => ({
        id: `design.next.${i}`,
        title: step.label,
        group: 'Design',
        icon: Plus,
        keywords: ['next step', 'suggestion'],
        when: editable,
        run: () => c.addStep(step),
      }),
    ),
    {
      id: 'assistant.undoRun',
      title: 'Undo the assistant’s last change',
      group: 'Assistant',
      icon: Undo2,
      when: () => c.hasRun && editable(),
      run: c.undoRun,
    },
    {
      id: 'design.deselect',
      title: 'Clear selection',
      group: 'Design',
      shortcut: 'escape',
      hidden: true,
      when: hasSelection,
      run: () => ws().select([]),
    },
    {
      id: 'design.fineTune',
      title: 'Show fine-tuning settings',
      group: 'Design',
      icon: SlidersHorizontal,
      run: () => ws().setFineTune(!ws().fineTune),
    },
    {
      id: 'view.fit',
      title: 'Fit to view',
      group: 'View',
      icon: Focus,
      shortcut: 'f',
      run: () => c.viewer.current?.frameAll(true, ws().selection),
    },
    {
      id: 'view.renderThis',
      title: 'Render this view',
      group: 'View',
      icon: Camera,
      run: () => c.renderThisView(),
    },
    {
      id: 'view.zoomIn',
      title: 'Zoom in',
      group: 'View',
      icon: ZoomIn,
      shortcut: '=',
      run: () => c.viewer.current?.zoom(1.25),
    },
    {
      id: 'view.zoomOut',
      title: 'Zoom out',
      group: 'View',
      icon: ZoomOut,
      shortcut: '-',
      run: () => c.viewer.current?.zoom(0.8),
    },
    ...VIEWS.map(
      (v): Command => ({
        id: `view.${v.id}`,
        title: v.title,
        group: 'View',
        icon: Crosshair,
        shortcut: v.key,
        run: () => c.viewer.current?.view(v.id),
      }),
    ),
    ...DISPLAY_MODES.map(
      (m): Command => ({
        id: `view.display.${m.id}`,
        title: `Display: ${m.title}`,
        group: 'View',
        icon: m.icon,
        shortcut: m.key,
        run: () => ws().setDisplay(m.id),
      }),
    ),
    {
      id: 'view.xray',
      title: 'X-ray metal',
      group: 'View',
      icon: ScanEye,
      shortcut: 'x',
      run: () => ws().toggleXray(),
    },
    {
      id: 'view.showAll',
      title: 'Show all hidden features',
      group: 'View',
      icon: Eye,
      when: () => ws().hidden.length > 0,
      run: () => useWorkspace.setState({ hidden: [] }),
    },
    {
      id: 'view.regions',
      title: 'Next region',
      group: 'View',
      shortcut: 'f6',
      inEditable: true,
      hidden: true,
      run: () => cycleRegion(false),
    },
    {
      id: 'view.regions.back',
      title: 'Previous region',
      group: 'View',
      shortcut: 'shift+f6',
      inEditable: true,
      hidden: true,
      run: () => cycleRegion(true),
    },
    ...(
      [
        ['left', 'arrowleft', 15, 0],
        ['right', 'arrowright', -15, 0],
        ['up', 'arrowup', 0, 10],
        ['down', 'arrowdown', 0, -10],
      ] as const
    ).map(
      ([dir, key, az, el]): Command => ({
        id: `view.orbit.${dir}`,
        title: `Orbit ${dir}`,
        group: 'View',
        shortcut: key,
        hidden: true,
        when: inViewport,
        run: orbit(az, el),
      }),
    ),
    ...c.formats.map(
      (f): Command => ({
        id: `design.export.${f}`,
        title: exportTitle(f),
        group: 'Design',
        icon: Download,
        keywords: ['download', f],
        run: () => c.exportAs(f),
      }),
    ),
    ...WHEEL_DEVICES.map(
      (w): Command => ({
        id: `view.wheel.${w.id}`,
        title: w.title,
        group: 'Preferences',
        icon: Mouse,
        keywords: ['mouse', 'trackpad', 'touchpad', 'zoom', 'orbit'],
        when: () => ws().wheel !== w.id,
        run: () => ws().setWheel(w.id),
      }),
    ),
    {
      id: 'design.restartKernel',
      title: 'Restart geometry engine',
      group: 'Design',
      icon: RefreshCw,
      when: () => c.crashed,
      run: restartKernel,
    },
  ]
  useRegisterCommands(commands)
}
