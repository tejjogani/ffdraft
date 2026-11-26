import { Dialog as Base } from '@base-ui/react/dialog'
import { Command } from 'cmdk'
import { ArrowRight, type LucideIcon, Search } from 'lucide-react'
import { isValidElement, type ReactNode, useEffect, useMemo, useState } from 'react'
import { cn } from '../cn'
import { readStored, writeStored } from '../storage'
import { floatingRow } from './floating'
import { Kbd } from './kbd'

export interface PaletteItem {
  id: string
  title: string
  group: string
  icon?: LucideIcon | ReactNode
  shortcut?: string
  keywords?: string[]
  /** Muted trailing text, e.g. a piece's stage. */
  hint?: string
  onSelect: () => void
}

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: PaletteItem[]
  /** Groups are shown in this order; unlisted groups follow. */
  groupOrder?: string[]
  placeholder?: string
  /** Offered for any typed query (and the only option when nothing matches), e.g. “Ask the assistant”. */
  fallback?: (query: string) => {
    title: string
    icon?: ReactNode
    onSelect: () => void
    /** Why it cannot be used yet: the row stays, dimmed, with the reason beside it. */
    disabled?: string
  } | null
}

const RECENTS_KEY = 'pave:palette-recents'
const MAX_RECENTS = 5

const renderIcon = (icon: PaletteItem['icon']) =>
  !icon
    ? null
    : isValidElement(icon)
      ? icon
      : (() => {
          const Icon = icon as LucideIcon
          return <Icon aria-hidden />
        })()

/** ⌘K. Grouped, fuzzy, with recents when the query is empty and a fallback when nothing matches. */
export function CommandPalette({
  open,
  onOpenChange,
  items,
  groupOrder = [],
  placeholder = 'Search or run a command…',
  fallback,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [recents, setRecents] = useState<string[]>(() => readStored<string[]>(RECENTS_KEY, []))

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const groups = useMemo(() => {
    const map = new Map<string, PaletteItem[]>()
    for (const it of items) map.set(it.group, [...(map.get(it.group) ?? []), it])
    const rank = (g: string) => {
      const i = groupOrder.indexOf(g)
      return i < 0 ? groupOrder.length : i
    }
    return [...map.entries()].sort((a, b) => rank(a[0]) - rank(b[0]))
  }, [items, groupOrder])

  const recentItems = recents
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is PaletteItem => i !== undefined)

  const run = (item: PaletteItem) => {
    const next = [item.id, ...recents.filter((r) => r !== item.id)].slice(0, MAX_RECENTS)
    setRecents(next)
    writeStored(RECENTS_KEY, next)
    onOpenChange(false)
    item.onSelect()
  }

  const fb = query.trim() && fallback ? fallback(query.trim()) : null

  const row = (item: PaletteItem, prefix = '') => (
    <Command.Item
      key={prefix + item.id}
      value={prefix + item.id}
      keywords={[item.title, ...(item.keywords ?? [])]}
      onSelect={() => run(item)}
      className={cn(
        floatingRow,
        'h-8 [@media(any-pointer:coarse)]:min-h-11 data-[selected=true]:bg-bg-active data-[disabled=true]:opacity-40',
      )}
    >
      {renderIcon(item.icon)}
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      {item.hint && <span className="text-xs text-fg-subtle">{item.hint}</span>}
      {item.shortcut && <Kbd shortcut={item.shortcut} />}
    </Command.Item>
  )

  return (
    <Base.Root open={open} onOpenChange={(o) => onOpenChange(o)}>
      <Base.Portal>
        <Base.Backdrop className="fixed inset-0 z-50 bg-[rgba(20,18,15,0.08)] dark:bg-black/30 transition-opacity duration-150 data-starting-style:opacity-0 data-ending-style:opacity-0" />
        <Base.Popup
          aria-label="Command palette"
          className={cn(
            'glass-strong shadow-pop fixed top-[14vh] left-1/2 z-50 w-[min(620px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-xl text-fg outline-none',
            'transition-[opacity,scale] duration-150 ease-out data-starting-style:scale-[0.98] data-starting-style:opacity-0',
            'data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:duration-100',
          )}
        >
          <Command loop label="Command palette" className="flex flex-col">
            <div className="flex h-12 items-center gap-2.5 border-b border-glass-line px-4">
              <Search className="size-4 shrink-0 text-fg-subtle" aria-hidden />
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder={placeholder}
                className="h-full flex-1 bg-transparent text-base text-fg placeholder:text-fg-subtle outline-none focus-visible:outline-none"
              />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="max-h-[min(420px,60vh)] scroll-py-2 overflow-y-auto p-1.5">
              <Command.Empty className="px-2 py-6 text-center text-sm text-fg-subtle">
                No results
              </Command.Empty>
              {!query && recentItems.length > 0 && (
                <Command.Group heading="Recent" className={groupClass}>
                  {recentItems.map((i) => row(i, 'recent:'))}
                </Command.Group>
              )}
              {groups.map(([group, list]) => (
                <Command.Group key={group} heading={group} className={groupClass}>
                  {list.map((i) => row(i))}
                </Command.Group>
              ))}
              {fb && (
                // Always offered while typing, last; it is the only match when nothing else is.
                <Command.Group heading="Ask" forceMount className={groupClass}>
                  <Command.Item
                    forceMount
                    value={`fallback:${query}`}
                    disabled={!!fb.disabled}
                    onSelect={() => {
                      onOpenChange(false)
                      fb.onSelect()
                    }}
                    className={cn(
                      floatingRow,
                      'h-8 [@media(any-pointer:coarse)]:min-h-11 data-[selected=true]:bg-bg-active data-[disabled=true]:text-fg-subtle',
                    )}
                  >
                    {fb.icon}
                    <span className="min-w-0 flex-1 truncate">{fb.title}</span>
                    {fb.disabled ? (
                      <span className="shrink-0 text-xs text-fg-subtle">{fb.disabled}</span>
                    ) : (
                      <ArrowRight aria-hidden />
                    )}
                  </Command.Item>
                </Command.Group>
              )}
            </Command.List>
            {/* Keyboard hints: nothing to show on a touch screen. */}
            <div className="flex h-9 items-center gap-4 border-t border-glass-line px-4 text-2xs text-fg-subtle pointer-coarse:hidden">
              <span className="flex items-center gap-1.5">
                <Kbd shortcut="arrowup" />
                <Kbd shortcut="arrowdown" /> navigate
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd shortcut="enter" /> run
              </span>
            </div>
          </Command>
        </Base.Popup>
      </Base.Portal>
    </Base.Root>
  )
}

const groupClass =
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 ' +
  '[&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-subtle'
