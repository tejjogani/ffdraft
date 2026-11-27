/**
 * The feature list: an ARIA tree of the design's nodes, named from the schema ("Ring band",
 * never `ringShank`), nested by what each attaches to. Arrow keys move and fold, Enter selects,
 * F2 renames; Shift+F10 or the Menu key opens a row's menu; the eye hides a feature from view
 * only; diagnostics show as a dot.
 */
import type { Diagnostic, Evaluation } from '@pave/kernel'
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
  Gem,
  type LucideIcon,
  PencilLine,
  Scale,
  Scan,
  Trash2,
} from 'lucide-react'
import {
  Fragment,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createViewVisibility } from '../../../components/stage/visibility'
import { runCommand } from '../../../lib/commands'
import type { DesignSession } from '../../../lib/design-session/store'
import { AskAiSection } from '../../assistant/AskAiSection'
import type { Subject } from '../../assistant/quick-intents'
import { KIND_ICON } from '../kindIcon'
import { rename } from '../ops'
import { type NodePick, useWorkspace } from '../state/workspace'
import { diagnosticLevels, featureRowKey, featureTree, stoneRowKey, type TreeRow } from './tree'

export interface OutlinerProps {
  design: Design
  diagnostics: readonly Diagnostic[]
  stones: readonly Evaluation['stones'][number][]
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
  stones,
  session,
  aiTouched,
  readOnly,
  onDelete,
  subjectOf,
  header,
}: OutlinerProps) {
  const selection = useWorkspace((s) => s.selection)
  const stone = useWorkspace((s) => s.stone)
  const hidden = useWorkspace((s) => s.hidden)
  const hiddenStones = useWorkspace((s) => s.hiddenStones)
  const hiddenParts = useWorkspace((s) => s.hiddenParts)
  const isolated = useWorkspace((s) => s.isolated)
  const hover = useWorkspace((s) => s.hover)
  const renaming = useWorkspace((s) => s.renaming)
  const ws = useWorkspace.getState
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set())
  const [focusId, setFocusId] = useState<string | null>(null)
  const tree = useMemo(() => featureTree(design, stones), [design, stones])
  const rows = useMemo(() => tree.rows(flipped), [tree, flipped])
  const levels = useMemo(() => diagnosticLevels(diagnostics), [diagnostics])
  const visible = useMemo(
    () => createViewVisibility({ hidden, hiddenStones, hiddenParts, isolated }),
    [hidden, hiddenStones, hiddenParts, isolated],
  )
  const visibleComponentOwners = new Set(
    isolated
      .filter((target) => (target.stoneId || target.partId) && visible(target))
      .map((target) => target.nodeId),
  )
  const list = useRef<HTMLDivElement>(null)
  const revealed = useRef<string | null>(null)
  const selectedNode = selection.at(-1)
  const selectedStone = selectedNode && stone && tree.ancestors(selectedNode, stone) ? stone : null
  const selectedKey = selectedStone
    ? stoneRowKey(selectedStone)
    : selectedNode
      ? featureRowKey(selectedNode)
      : null
  const selectedVisible = rows.some((row) => row.key === selectedKey) ? selectedKey : null
  const active =
    focusId && rows.some((row) => row.key === focusId) ? focusId : (selectedVisible ?? rows[0]?.key)
  const elementFor = useCallback(
    (key: string) =>
      list.current?.querySelector<HTMLElement>(`[data-tree-row="${CSS.escape(key)}"]`),
    [],
  )

  // A new viewport selection may sit inside a folded disclosure. Reveal its path once so a
  // deliberate collapse stays closed even when the viewport reevaluates.
  useEffect(() => {
    if (revealed.current === selectedKey) return
    revealed.current = selectedKey
    const ancestors = selectedNode && tree.ancestors(selectedNode, selectedStone ?? undefined)
    if (!ancestors?.length) return
    setFlipped((previous) => {
      const next = new Set(previous)
      for (const key of ancestors) {
        if (tree.defaultsOpen(key)) next.delete(key)
        else next.add(key)
      }
      return next
    })
  }, [selectedKey, selectedNode, selectedStone, tree])

  useEffect(() => {
    if (selectedVisible) elementFor(selectedVisible)?.scrollIntoView({ block: 'nearest' })
  }, [elementFor, selectedVisible])

  const focusRow = (key: string | undefined) => {
    if (!key) return
    setFocusId(key)
    requestAnimationFrame(() => elementFor(key)?.focus())
  }
  const toggle = (row: TreeRow, open = !row.expanded) =>
    setFlipped((previous) => {
      const next = new Set(previous)
      if (open === tree.defaultsOpen(row.key)) next.delete(row.key)
      else next.add(row.key)
      return next
    })

  const activate = (row: TreeRow, additive = false) => {
    if (row.kind === 'stone') ws().select([row.nodeId], row.id)
    else if (row.kind === 'feature') ws().pick({ nodeId: row.id }, additive)
    else toggle(row)
  }

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const row = rows[index]!
    switch (e.key) {
      case 'ArrowDown':
        focusRow(rows[index + 1]?.key)
        break
      case 'ArrowUp':
        focusRow(rows[index - 1]?.key)
        break
      case 'Home':
        focusRow(rows[0]?.key)
        break
      case 'End':
        focusRow(rows.at(-1)?.key)
        break
      case 'ArrowRight':
        if (row.hasChildren && !row.expanded) toggle(row, true)
        else if (row.expanded) focusRow(rows[index + 1]?.key)
        break
      case 'ArrowLeft':
        if (row.expanded) toggle(row, false)
        else focusRow(row.parent ?? undefined)
        break
      case 'Enter':
      case ' ':
        activate(row, e.shiftKey || e.metaKey || e.ctrlKey)
        break
      case 'F2':
        if (!readOnly && row.kind === 'feature') ws().setRenaming(row.id)
        break
      default:
        return
    }
    e.preventDefault()
  }

  const constructionTargets = tree.constructionIds.map((nodeId) => ({ nodeId }))
  const constructionHidden = constructionTargets.every(({ nodeId }) => hidden.includes(nodeId))
  const toggleConstruction = () => ws().setTargetsHidden(constructionTargets, !constructionHidden)

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
            const rowProps = {
              'data-tree-row': row.key,
              'aria-level': row.depth + 1,
              'aria-posinset': row.position,
              'aria-setsize': row.siblings,
              'aria-expanded': row.hasChildren ? row.expanded : undefined,
              onFocus: () => setFocusId(row.key),
              style: { paddingLeft: 6 + Math.min(row.depth, 6) * 12 },
            }
            const onRowKey = (e: KeyboardEvent) =>
              e.target === e.currentTarget && onKeyDown(e, index)
            const chevron = row.hasChildren ? (
              <button
                type="button"
                tabIndex={-1}
                aria-hidden
                onClick={(e) => {
                  e.stopPropagation()
                  toggle(row)
                  focusRow(row.key)
                }}
                className="flex size-4 shrink-0 items-center justify-center text-fg-subtle"
              >
                <ChevronRight
                  className={cn(
                    'size-3 transition-transform duration-120',
                    row.expanded && 'rotate-90',
                  )}
                />
              </button>
            ) : (
              <span aria-hidden className="size-4 shrink-0" />
            )

            if (row.kind === 'construction' || row.kind === 'stones') {
              const construction = row.kind === 'construction'
              const Icon = construction ? KIND_ICON.curve : Gem
              const label = constructionHidden
                ? 'Show construction curves in view'
                : 'Hide construction curves in view'
              const EyeIcon = constructionHidden ? EyeOff : Eye
              const item = (
                <div
                  {...rowProps}
                  role="treeitem"
                  tabIndex={row.key === active ? 0 : -1}
                  onKeyDown={onRowKey}
                  aria-label={
                    construction ? `Construction curves, ${row.count}` : `Stones, ${row.count}`
                  }
                  className={itemClass(false, false)}
                  onClick={() => toggle(row)}
                >
                  {chevron}
                  <Icon aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
                  <span className="min-w-0 truncate">
                    {construction ? 'Construction curves' : 'Stones'}
                  </span>
                  <span className="flex-1 text-xs text-fg-subtle tabular-nums">{row.count}</span>
                  {construction && (
                    <RowAction icon={EyeIcon} label={label} onAction={toggleConstruction} />
                  )}
                </div>
              )
              if (!construction) return <Fragment key={row.key}>{item}</Fragment>
              return (
                <ContextMenu
                  key={row.key}
                  content={
                    <MenuItem icon={EyeIcon} onClick={toggleConstruction}>
                      {label}
                    </MenuItem>
                  }
                >
                  {item}
                </ContextMenu>
              )
            }

            if (row.kind === 'stone') {
              const target: NodePick = { nodeId: row.nodeId, stoneId: row.id }
              const selected = row.id === selectedStone
              const isHidden = hidden.includes(row.nodeId) || hiddenStones.includes(row.id)
              const isIsolated = isolated.length === 1 && isolated[0]?.stoneId === row.id
              const name = `Stone ${row.number}`
              const isolateLabel = isIsolated ? 'Exit isolation' : `Isolate ${name.toLowerCase()}`
              const hideLabel = `${isHidden ? 'Show' : 'Hide'} ${name.toLowerCase()} in view`
              const toggleHidden = () => ws().toggleTarget(target)
              const toggleIsolation = () =>
                isIsolated ? ws().exitIsolation() : ws().isolateTargets([target])
              return (
                <ContextMenu
                  key={row.key}
                  onOpenChange={(open) => open && ws().selectForMenu(row.nodeId, row.id)}
                  content={
                    <>
                      <MenuItem icon={isHidden ? Eye : EyeOff} onClick={toggleHidden}>
                        {hideLabel}
                      </MenuItem>
                      <MenuItem icon={Scan} onClick={toggleIsolation}>
                        {isolateLabel}
                      </MenuItem>
                    </>
                  }
                >
                  <div
                    {...rowProps}
                    role="treeitem"
                    tabIndex={row.key === active ? 0 : -1}
                    onKeyDown={onRowKey}
                    data-stone={row.id}
                    aria-label={`${name} of ${nodeTitle(design.nodes[row.nodeId]!)}`}
                    aria-selected={selected}
                    className={itemClass(selected, hover?.stoneId === row.id)}
                    onClick={() => activate(row)}
                    onPointerEnter={() => ws().setHover(target)}
                    onPointerLeave={() => ws().setHover(null)}
                  >
                    {chevron}
                    <Gem
                      aria-hidden
                      className={cn(
                        'size-3.5 shrink-0',
                        selected ? 'text-select' : 'text-fg-subtle',
                      )}
                    />
                    <span
                      className={cn('min-w-0 flex-1 truncate', !visible(target) && 'opacity-45')}
                    >
                      {name}
                    </span>
                    <RowAction
                      icon={Scan}
                      label={isolateLabel}
                      active={isIsolated}
                      onAction={toggleIsolation}
                    />
                    <RowAction
                      icon={isHidden ? EyeOff : Eye}
                      label={hideLabel}
                      onAction={toggleHidden}
                    />
                  </div>
                </ContextMenu>
              )
            }

            const node = design.nodes[row.id]!
            const Icon = KIND_ICON[node.kind]
            const selected = selection.includes(row.id)
            const featureSelected = selected && selectedStone === null
            const isHidden = hidden.includes(row.id)
            const inView = visible({ nodeId: row.id }) || visibleComponentOwners.has(row.id)
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
                {...rowProps}
                role="treeitem"
                tabIndex={row.key === active ? 0 : -1}
                onKeyDown={onRowKey}
                data-node={row.id}
                aria-selected={featureSelected}
                onClick={(e) => activate(row, e.shiftKey || e.metaKey || e.ctrlKey)}
                onDoubleClick={() => !readOnly && ws().setRenaming(row.id)}
                onPointerEnter={() => ws().setHover({ nodeId: row.id })}
                onPointerLeave={() => ws().setHover(null)}
                className={itemClass(featureSelected, hover?.nodeId === row.id && !hover.stoneId)}
              >
                {chevron}
                <Icon
                  className={cn(
                    'size-3.5 shrink-0',
                    featureSelected ? 'text-select' : 'text-fg-subtle',
                  )}
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
                      focusRow(row.key)
                    }}
                  />
                ) : (
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      (!inView || excluded) && 'opacity-45',
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
                <RowAction
                  icon={isHidden ? EyeOff : Eye}
                  label={isHidden ? 'Show in view' : 'Hide in view'}
                  onAction={() => ws().toggleTarget({ nodeId: row.id })}
                  className={!isHidden ? 'hover-reveal' : undefined}
                />
              </div>
            )
            return (
              <ContextMenu
                key={row.key}
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
                    <MenuItem icon={Scan} onClick={onRow('view.isolateSelected')}>
                      Isolate
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

function RowAction({
  icon,
  label,
  onAction,
  active,
  className,
}: {
  icon: LucideIcon
  label: string
  onAction(): void
  active?: boolean
  className?: string
}) {
  return (
    <IconButton
      icon={icon}
      label={label}
      title={label}
      size="sm"
      tabIndex={-1}
      tooltip={false}
      active={active}
      onClick={(e) => {
        e.stopPropagation()
        onAction()
      }}
      className={cn('size-5 [&_svg]:size-3.5', className)}
    />
  )
}

function itemClass(selected: boolean, hovered: boolean) {
  return cn(
    'group flex h-7 shrink-0 items-center gap-1.5 rounded-sm pr-1 text-sm outline-none select-none',
    'focus-visible:shadow-[inset_0_0_0_1px_var(--select)]',
    selected
      ? 'bg-select-soft text-fg'
      : hovered
        ? 'bg-bg-hover text-fg'
        : 'text-fg-muted hover:bg-bg-hover hover:text-fg',
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
