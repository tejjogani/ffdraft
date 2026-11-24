/**
 * Every action of the Design tab as a registered command: the palette, shortcuts, toolbar and
 * menus all run these. Shortcuts are platform-neutral; none uses Alt (it opens menus on Windows
 * and Linux and types symbols on macOS), and `mod+z` leaves text fields their own undo.
 */
import type { ExportFormat } from '@pave/kernel'
import type { CameraPreset } from '@pave/render'
import {
  Box,
  Crosshair,
  Download,
  Eye,
  Focus,
  Gem,
  PencilRuler,
  Plus,
  RefreshCw,
  Redo2,
  ScanEye,
  SlidersHorizontal,
  Trash2,
  Undo2,
} from 'lucide-react'
import type { RefObject } from 'react'
import type { Viewer } from '../../components/stage/viewer'
import { type Command, useRegisterCommands } from '../../lib/commands'
import type { DesignSession } from '../../lib/design-session/store'
import { restartKernel } from '../../lib/kernel/client'
import { EXPORT_PURPOSE } from './export'
import { type DisplayMode, useWorkspace } from './state/workspace'

export interface CadCommandContext {
  session: DesignSession | null
  viewer: RefObject<Viewer | null>
  readOnly: boolean
  canUndo: boolean
  canRedo: boolean
  crashed: boolean
  formats: readonly ExportFormat[]
  openAddMenu(): void
  requestDelete(ids: string[]): void
  exportAs(format: ExportFormat): void
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
const REGIONS = ['[data-region="outliner"]', '[data-region="viewport"]', '[data-region="inspector"]']

function cycleRegion(backwards: boolean) {
  const els = REGIONS.map((s) => document.querySelector<HTMLElement>(s)).filter((e) => e !== null)
  const at = els.findIndex((el) => el.contains(document.activeElement))
  const next = els[(at + (backwards ? -1 : 1) + els.length) % els.length]
  const target = next?.querySelector<HTMLElement>('[tabindex="0"], button, input, canvas') ?? next
  target?.focus()
}

const inViewport = () => !!document.activeElement?.closest('[data-region="viewport"]')

export function useCadCommands(c: CadCommandContext): void {
  const ws = useWorkspace.getState
  const hasSelection = () => ws().selection.length > 0
  const orbit = (az: number, el: number) => () => c.viewer.current?.orbit(az, el)
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
      shortcut: 'f2',
      when: () => !c.readOnly && ws().selection.length === 1,
      run: () => ws().setRenaming(ws().selection[0]!),
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
        title: `Export ${EXPORT_PURPOSE[f].label.toLowerCase()} — ${f.toUpperCase()}`,
        group: 'Design',
        icon: Download,
        keywords: ['download', f],
        run: () => c.exportAs(f),
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
