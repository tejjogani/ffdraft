/** The floating controls over the viewport: history, display, framing, x-ray; and on the right, saving and export. */
import type { ExportFormat } from '@pave/kernel'
import { exportCounts } from '@pave/schema'
import { Button, cn, IconButton, Menu, MenuGroup, MenuItem, Segmented, Tooltip } from '@pave/ui'
import { ChevronDown, Crosshair, Download, Focus, Gauge, Redo2, ScanEye, Undo2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { runCommand } from '../../../lib/commands'
import type { SaveState } from '../../../lib/design-session/store'
import { useRpc } from '../../../lib/query'
import { DISPLAY_MODES } from '../commands'
import { EXPORT_PURPOSE } from '../export'
import { SavePill } from '../hud/SavePill'
import { useWorkspace } from '../state/workspace'

function Cluster({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('glass shadow-sm flex h-9 items-center gap-0.5 rounded-lg px-1', className)}>
      {children}
    </div>
  )
}

const Divider = () => <span aria-hidden className="mx-1 h-4 w-px bg-line-strong" />

export function ViewToolbar({ canUndo, canRedo }: { canUndo: boolean; canRedo: boolean }) {
  const display = useWorkspace((s) => s.display)
  const xray = useWorkspace((s) => s.xray)
  return (
    <Cluster>
      <IconButton
        icon={Undo2}
        label="Undo"
        shortcut="mod+z"
        disabled={!canUndo}
        onClick={() => runCommand('design.undo')}
      />
      <IconButton
        icon={Redo2}
        label="Redo"
        shortcut="mod+shift+z"
        disabled={!canRedo}
        onClick={() => runCommand('design.redo')}
      />
      <Divider />
      <Segmented
        value={display}
        aria-label="Display"
        onChange={(m) => runCommand(`view.display.${m}`)}
        options={DISPLAY_MODES.map((m) => ({ value: m.id, label: m.title, icon: m.icon }))}
      />
      <Divider />
      <IconButton
        icon={Focus}
        label="Fit to view"
        shortcut="f"
        onClick={() => runCommand('view.fit')}
      />
      <Menu
        trigger={<IconButton icon={Crosshair} label="Views" />}
        align="start"
        className="min-w-44"
      >
        {(['hero', 'front', 'side', 'top'] as const).map((v, i) => (
          <MenuItem key={v} shortcut={String(i + 1)} onClick={() => runCommand(`view.${v}`)}>
            {v === 'hero' ? 'Hero' : v[0]!.toUpperCase() + v.slice(1)}
          </MenuItem>
        ))}
      </Menu>
      <IconButton
        icon={ScanEye}
        label="X-ray metal"
        shortcut="x"
        active={xray}
        onClick={() => runCommand('view.xray')}
      />
    </Cluster>
  )
}

/** Saving and export. `compact` (a narrow view) keeps their icons and drops their words. */
export function FileToolbar({
  save,
  formats,
  simplified,
  compact,
}: {
  save: SaveState | null
  formats: readonly ExportFormat[]
  simplified: boolean
  compact: boolean
}) {
  // Rhino and STEP count against the plan; the menu says what is left before anyone asks.
  const plan = useRpc('plan.get', {})
  const cad = plan.data?.allowances.find((a) => a.allowance === 'export')
  const cadLimit = cad?.limit ?? null
  const cadLeft = cad && cadLimit !== null ? cad.left : null
  return (
    <div className="flex items-center gap-2">
      {simplified && (
        <Tooltip content="Simplified graphics: this device draws 3D in software, so the viewport uses lighter materials. The design is unaffected.">
          <span
            role="img"
            aria-label="Simplified graphics"
            className="glass flex size-9 items-center justify-center rounded-lg text-fg-subtle shadow-sm"
          >
            <Gauge className="size-4" aria-hidden />
          </span>
        </Tooltip>
      )}
      <Cluster className="pr-1 pl-0.5">
        {save && <SavePill save={save} compact={compact} />}
        {formats.length > 0 && (
          <Menu
            align="end"
            className="w-72"
            trigger={
              <Button
                variant="ghost"
                size="sm"
                icon={Download}
                aria-label={compact ? 'Export' : undefined}
                className="shrink-0 text-fg"
              >
                {!compact && 'Export'}
                <ChevronDown className="size-3.5! text-fg-subtle" aria-hidden />
              </Button>
            }
          >
            <MenuGroup label="Download">
              {formats.map((f) => (
                <MenuItem
                  key={f}
                  description={
                    exportCounts(f) && cadLeft !== null
                      ? `${EXPORT_PURPOSE[f].hint} · ${cadLeft} of ${cadLimit} free left this month`
                      : EXPORT_PURPOSE[f].hint
                  }
                  tag={f.toUpperCase()}
                  onClick={() => runCommand(`design.export.${f}`)}
                >
                  {EXPORT_PURPOSE[f].label}
                </MenuItem>
              ))}
            </MenuGroup>
          </Menu>
        )}
      </Cluster>
    </div>
  )
}
