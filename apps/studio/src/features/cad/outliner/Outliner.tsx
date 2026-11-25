/**
 * The feature list: an ARIA tree of the design's nodes, named from the schema ("Ring band",
 * never `ringShank`), nested by what each attaches to. Arrow keys move and fold, Enter selects,
 * F2 renames; Shift+F10 or the Menu key opens a row's menu; the eye hides a feature from view
 * only; diagnostics show as a dot.
 */
import type { Diagnostic } from '@pave/kernel'
import { type Design, nodeTitle } from '@pave/schema'
import {
  AiMark,
  ContextMenu,
  cn,
  IconButton,
  Input,
  MenuItem,
  MenuSeparator,
  ScrollArea,
} from '@pave/ui'
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Eye,
  EyeOff,
  PencilLine,
  Scale,
  Trash2,
} from 'lucide-react'
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { runCommand } from '../../../lib/commands'
import type { DesignSession } from '../../../lib/design-session/store'
import { AskAiSection } from '../../assistant/AskAiSection'
import type { Subject } from '../../assistant/quick-intents'
import { KIND_ICON } from '../kindIcon'
import { rename } from '../ops'
import { useWorkspace } from '../state/workspace'
import { diagnosticLevels, treeRows } from './tree'

export interface OutlinerProps {
  design: Design
  diagnostics: readonly Diagnostic[]
  session: DesignSession | null
  /** Nodes the assistant's latest run touched. */
  aiTouched: ReadonlySet<string>
  readOnly: boolean
  onDelete(ids: string[]): void
  /** What a row's menu is about: a stone (a gem, or a whole row, halo or pavé) or a part. */
  subjectOf(nodeId: string): Subject
  header: React.ReactNode
}

export function Outliner({
  design,
  diagnostics,
  session,
  aiTouched,
  readOnly,
  onDelete,
  subjectOf,
  header,
}: OutlinerProps) {
  const selection = useWorkspace((s) => s.selection)
  const hidden = useWorkspace((s) => s.hidden)
  const hover = useWorkspace((s) => s.hover)
  const renaming = useWorkspace((s) => s.renaming)
  const ws = useWorkspace.getState
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [focusId, setFocusId] = useState<string | null>(null)
  const rows = useMemo(() => treeRows(design, collapsed), [design, collapsed])
  const levels = useMemo(() => diagnosticLevels(diagnostics), [diagnostics])
  const list = useRef<HTMLDivElement>(null)
  const active =
    focusId && rows.some((r) => r.id === focusId) ? focusId : (selection[0] ?? rows[0]?.id)

  // Keep the selected row in view when the selection comes from the viewport.
  useEffect(() => {
    const id = selection.at(-1)
    if (id)
      list.current
        ?.querySelector(`[data-node="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
  }, [selection])

  const focusRow = (id: string | undefined) => {
    if (!id) return
    setFocusId(id)
    requestAnimationFrame(() =>
      list.current?.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"]`)?.focus(),
    )
  }
  const toggle = (id: string, open?: boolean) =>
    setCollapsed((c) => {
      const next = new Set(c)
      const isOpen = !c.has(id)
      if (open ?? !isOpen) next.delete(id)
      else next.add(id)
      return next
    })

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const row = rows[index]!
    switch (e.key) {
      case 'ArrowDown':
        focusRow(rows[index + 1]?.id)
        break
      case 'ArrowUp':
        focusRow(rows[index - 1]?.id)
        break
      case 'Home':
        focusRow(rows[0]?.id)
        break
      case 'End':
        focusRow(rows.at(-1)?.id)
        break
      case 'ArrowRight':
        if (row.hasChildren && !row.expanded) toggle(row.id, true)
        else if (row.expanded) focusRow(rows[index + 1]?.id)
        break
      case 'ArrowLeft':
        if (row.expanded) toggle(row.id, false)
        else focusRow(row.parent ?? undefined)
        break
      case 'Enter':
      case ' ':
        ws().pick({ nodeId: row.id }, e.shiftKey)
        break
      case 'F2':
        if (!readOnly) ws().setRenaming(row.id)
        break
      default:
        return
    }
    e.preventDefault()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <ScrollArea className="flex-1">
        <div
          ref={list}
          role="tree"
          aria-label="Features"
          aria-multiselectable
          className="flex flex-col px-2 pb-4"
        >
          {rows.map((row, index) => {
            const node = design.nodes[row.id]!
            const Icon = KIND_ICON[node.kind]
            const selected = selection.includes(row.id)
            const isHidden = hidden.includes(row.id)
            const excluded = node.visible === false
            const level = levels.get(row.id)
            const order = design.order.indexOf(row.id)
            // The menu acts on the row it was opened on, or on the whole selection when the row
            // is part of it, through the same commands as the palette. Rename is one row only.
            const onRow = (command: string) => () => {
              ws().selectForMenu(row.id)
              runCommand(command)
            }
            const menuIds = selected ? selection : [row.id]
            const item = (
              <div
                data-node={row.id}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-selected={selected}
                aria-expanded={row.hasChildren ? row.expanded : undefined}
                tabIndex={row.id === active ? 0 : -1}
                onFocus={() => setFocusId(row.id)}
                onKeyDown={(e) => e.target === e.currentTarget && onKeyDown(e, index)}
                onClick={(e) => ws().pick({ nodeId: row.id }, e.shiftKey || e.metaKey || e.ctrlKey)}
                onDoubleClick={() => !readOnly && ws().setRenaming(row.id)}
                onPointerEnter={() => ws().setHover({ nodeId: row.id })}
                onPointerLeave={() => ws().setHover(null)}
                style={{ paddingLeft: 6 + row.depth * 14 }}
                className={cn(
                  'group flex h-7 shrink-0 items-center gap-1.5 rounded-sm pr-1 text-sm outline-none select-none',
                  'focus-visible:shadow-[inset_0_0_0_1px_var(--select)]',
                  selected
                    ? 'bg-select-soft text-fg'
                    : hover?.nodeId === row.id
                      ? 'bg-bg-hover text-fg'
                      : 'text-fg-muted hover:bg-bg-hover hover:text-fg',
                )}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden
                  onClick={(e) => {
                    e.stopPropagation()
                    toggle(row.id)
                  }}
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center text-fg-subtle',
                    !row.hasChildren && 'invisible',
                  )}
                >
                  <ChevronRight
                    className={cn(
                      'size-3 transition-transform duration-120',
                      row.expanded && 'rotate-90',
                    )}
                  />
                </button>
                <Icon
                  className={cn('size-3.5 shrink-0', selected ? 'text-select' : 'text-fg-subtle')}
                  aria-hidden
                />
                {renaming === row.id ? (
                  <RenameInput
                    initial={node.name ?? ''}
                    placeholder={nodeTitle({ kind: node.kind })}
                    onDone={(name) => {
                      ws().setRenaming(null)
                      if (name !== null && name !== (node.name ?? ''))
                        session?.commit([rename(row.id, name)])
                      focusRow(row.id)
                    }}
                  />
                ) : (
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      (isHidden || excluded) && 'opacity-45',
                      excluded && 'line-through',
                    )}
                  >
                    {nodeTitle(node)}
                  </span>
                )}
                {aiTouched.has(row.id) && <AiMark className="size-2.5" />}
                {level && level !== 'info' && (
                  <span
                    role="img"
                    aria-label={level === 'error' ? 'Has a problem' : 'Has a warning'}
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      level === 'error' ? 'bg-danger' : 'bg-warn',
                    )}
                  />
                )}
                <IconButton
                  icon={isHidden ? EyeOff : Eye}
                  label={isHidden ? 'Show in view' : 'Hide in view'}
                  size="sm"
                  tabIndex={-1}
                  tooltip={false}
                  onClick={(e) => {
                    e.stopPropagation()
                    ws().toggleHidden(row.id)
                  }}
                  className={cn('size-5 [&_svg]:size-3.5', !isHidden && 'hover-reveal')}
                />
              </div>
            )
            return (
              <ContextMenu
                key={row.id}
                content={
                  <>
                    <MenuItem
                      icon={PencilLine}
                      disabled={readOnly}
                      onClick={() => {
                        ws().select([row.id])
                        runCommand('design.rename')
                      }}
                      shortcut="f2"
                    >
                      Rename
                    </MenuItem>
                    <MenuItem
                      icon={isHidden ? Eye : EyeOff}
                      onClick={onRow('design.hideSelected')}
                      shortcut="h"
                    >
                      {isHidden ? 'Show in view' : 'Hide in view'}
                    </MenuItem>
                    <MenuItem
                      icon={Scale}
                      disabled={readOnly}
                      onClick={onRow('design.excludeSelected')}
                    >
                      {excluded ? 'Count in weight and export' : 'Leave out of weight and export'}
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem
                      icon={ArrowUp}
                      disabled={readOnly || order <= 0}
                      onClick={onRow('design.moveUp')}
                    >
                      Move up
                    </MenuItem>
                    <MenuItem
                      icon={ArrowDown}
                      disabled={readOnly || order >= design.order.length - 1}
                      onClick={onRow('design.moveDown')}
                    >
                      Move down
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem
                      icon={Trash2}
                      danger
                      disabled={readOnly}
                      onClick={() => onDelete(menuIds)}
                      shortcut="delete"
                    >
                      {menuIds.length > 1 ? `Delete ${menuIds.length} features` : 'Delete'}
                    </MenuItem>
                    <AskAiSection subject={subjectOf(row.id)} />
                  </>
                }
                // Opening the menu selects its row, as a right-click in the view does, so the
                // inspector shows what the menu is about.
                onOpenChange={(open) => open && ws().selectForMenu(row.id)}
              >
                {item}
              </ContextMenu>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}

function RenameInput({
  initial,
  placeholder,
  onDone,
}: {
  initial: string
  placeholder: string
  onDone(name: string | null): void
}) {
  const [value, setValue] = useState(initial)
  // Enter and the blur that follows it must not both finish the rename.
  const done = useRef(false)
  const finish = (name: string | null) => {
    if (done.current) return
    done.current = true
    onDone(name)
  }
  return (
    <Input
      bare
      autoFocus
      value={value}
      placeholder={placeholder}
      aria-label="Feature name"
      maxLength={80}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(value)
        if (e.key === 'Escape') finish(null)
      }}
      className="h-6 flex-1 px-1 text-sm shadow-[inset_0_0_0_1px_var(--select)]"
    />
  )
}
