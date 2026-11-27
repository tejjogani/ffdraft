/** The floating controls over the viewport: history, display, framing, x-ray; and on the right, saving and export. */
import type { ExportFormat } from '@pave/kernel'
import { exportCounts } from '@pave/schema'
import {
  Button,
  cn,
  IconButton,
  Menu,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  Segmented,
  Tooltip,
} from '@pave/ui'
import {
  Camera,
  ChevronDown,
  Crosshair,
  Download,
  FileUp,
  Focus,
  Gauge,
  ListChecks,
  PencilRuler,
  Redo2,
  ScanEye,
  Spline,
  Undo2,
} from 'lucide-react'
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

/** The view's tools. `compact` (a narrow view) moves "Render this view" into the Views menu. */
export function ViewToolbar({
  canUndo,
  canRedo,
  compact = false,
  onDrawProfile,
  onDrawCurve,
}: {
  canUndo: boolean
  canRedo: boolean
  compact?: boolean
  onDrawProfile?(): void
  onDrawCurve?(): void
}) {
  const display = useWorkspace((s) => s.display)
  const xray = useWorkspace((s) => s.xray)
  return (
    <Cluster>
      {onDrawCurve &&
        (compact ? (
          <IconButton icon={Spline} label="Draw curve" onClick={onDrawCurve} />
        ) : (
          <Button variant="ghost" size="sm" icon={Spline} onClick={onDrawCurve}>
            Draw curve
          </Button>
        ))}
      {onDrawProfile && (
        <>
          {compact ? (
            <IconButton icon={PencilRuler} label="Draw profile" onClick={onDrawProfile} />
          ) : (
            <Button variant="ghost" size="sm" icon={PencilRuler} onClick={onDrawProfile}>
              Draw profile
            </Button>
          )}
          <Divider />
        </>
      )}
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
        {compact && (
          <>
            <MenuSeparator />
            <MenuItem icon={Camera} onClick={() => runCommand('view.renderThis')}>
              Render this view
            </MenuItem>
          </>
        )}
      </Menu>
      {!compact && (
        <IconButton
          icon={Camera}
          label="Render this view"
          onClick={() => runCommand('view.renderThis')}
        />
      )}
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
  canSaveFile,
  simplified,
  compact,
  onImportModel,
  onReviewRhinoRoles,
}: {
  save: SaveState | null
  formats: readonly ExportFormat[]
  canSaveFile: boolean
  simplified: boolean
  compact: boolean
  onImportModel?: (() => void) | undefined
  onReviewRhinoRoles?: (() => void) | undefined
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
        {onImportModel &&
          (compact ? (
            <IconButton icon={FileUp} label="Import model" onClick={onImportModel} />
          ) : (
            <Button size="sm" variant="ghost" icon={FileUp} onClick={onImportModel}>
              Import model
            </Button>
          ))}
        {onReviewRhinoRoles &&
          (compact ? (
            <IconButton icon={ListChecks} label="Review Rhino roles" onClick={onReviewRhinoRoles} />
          ) : (
            <Button size="sm" variant="ghost" icon={ListChecks} onClick={onReviewRhinoRoles}>
              Review Rhino roles
            </Button>
          ))}
        {canSaveFile && (
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
            {/* The native file first: everything about the piece, and never counted. */}
            <MenuGroup label="Pavé">
              <MenuItem
                description="Design, history, references and shots · Always free"
                tag="PAVE"
                onClick={() => runCommand('piece.saveFile')}
              >
                Pavé file
              </MenuItem>
            </MenuGroup>
            {formats.length > 0 && <MenuSeparator />}
            {formats.length > 0 && (
              <MenuGroup label="Download">
                {formats.map((f) => (
                  <MenuItem
                    key={f}
                    description={`${EXPORT_PURPOSE[f].hint} · ${
                      !exportCounts(f)
                        ? 'Free'
                        : cadLeft !== null
                          ? `${cadLeft} of ${cadLimit} free left this month`
                          : 'Counted on your plan'
                    }`}
                    tag={f.toUpperCase()}
                    onClick={() => runCommand(`design.export.${f}`)}
                  >
                    {EXPORT_PURPOSE[f].label}
                  </MenuItem>
                ))}
              </MenuGroup>
            )}
          </Menu>
        )}
      </Cluster>
    </div>
  )
}
