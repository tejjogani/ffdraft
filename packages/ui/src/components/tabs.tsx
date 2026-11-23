import { Tabs as Base } from '@base-ui/react/tabs'
import type { ReactElement, ReactNode } from 'react'
import { cn } from '../cn'

/** Underline tab style, shared by in-page tabs and router-link tab bars. */
export const tabClass =
  'relative inline-flex h-9 items-center gap-1.5 px-0.5 text-sm text-fg-muted select-none whitespace-nowrap ' +
  'outline-none transition-colors duration-120 hover:text-fg ' +
  'data-active:text-fg aria-[current=page]:text-fg aria-selected:text-fg ' +
  'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:rounded-xs [&_svg]:size-3.5'

export const tabListClass = 'relative flex items-center gap-5 border-b border-line'

export interface TabItem<V extends string> {
  value: V
  label: ReactNode
  /** Render the tab as another element, e.g. a router link (sets nativeButton=false). */
  render?: ReactElement
}

export interface TabsProps<V extends string> {
  value: V
  onChange?: (value: V) => void
  items: TabItem<V>[]
  className?: string
  /** Panels, as <TabPanel value=…/> children. Omit for navigation-only tab bars. */
  children?: ReactNode
}

export function Tabs<V extends string>({
  value,
  onChange,
  items,
  className,
  children,
}: TabsProps<V>) {
  return (
    <Base.Root value={value} onValueChange={(v) => onChange?.(v as V)} className={className}>
      <Base.List className={tabListClass}>
        {items.map((t) => (
          <Base.Tab
            key={t.value}
            value={t.value}
            className={tabClass}
            {...(t.render ? { render: t.render, nativeButton: false } : {})}
          >
            {t.label}
          </Base.Tab>
        ))}
        <Base.Indicator
          className={cn(
            'absolute bottom-[-1px] left-0 h-px w-(--active-tab-width) translate-x-(--active-tab-left) bg-fg',
            'transition-[translate,width] duration-180 ease-out',
          )}
        />
      </Base.List>
      {children}
    </Base.Root>
  )
}

export function TabPanel({
  value,
  children,
  className,
}: {
  value: string
  children: ReactNode
  className?: string
}) {
  return (
    <Base.Panel value={value} className={cn('outline-none', className)}>
      {children}
    </Base.Panel>
  )
}
