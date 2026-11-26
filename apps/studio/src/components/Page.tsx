import { cn, IconButton } from '@pave/ui'
import { Link, type LinkProps } from '@tanstack/react-router'
import { ChevronLeft, Menu as MenuIcon, PanelLeft } from 'lucide-react'
import { Fragment, type ReactNode, type Ref } from 'react'
import { useNarrow } from '../lib/narrow'
import { isDockedOpen, useAssistant } from '../stores/assistant'
import { useUI } from '../stores/ui'

export interface Crumb {
  label: ReactNode
  /** Omit on the current page. */
  link?: LinkProps
  icon?: ReactNode
}

/**
 * Each page's quiet header: breadcrumb left, actions right. It doubles as the window drag area
 * on desktop and keeps clear of the platform's window controls via the chrome insets.
 */
export function PageHeader({
  crumbs,
  actions,
  className,
}: {
  crumbs: Crumb[]
  actions?: ReactNode
  className?: string
}) {
  const narrow = useNarrow()
  // On a phone the sidebar is always a drawer, so the header always offers it.
  const collapsed = useUI((s) => s.sidebarCollapsed) || narrow
  const toggle = useUI((s) => s.toggleSidebar)
  // On a phone only the current page is named, with a way back to its parent: a full trail
  // would truncate every crumb into nothing.
  const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2] : undefined
  // With the dock open, the window controls sit above the dock, not this header.
  const dockOpen = useAssistant(isDockedOpen)
  return (
    <header
      className={cn(
        'app-drag sticky top-0 z-20 flex h-11 shrink-0 items-center gap-2 bg-bg',
        dockOpen ? 'pr-3' : 'pr-[calc(12px+var(--chrome-right))]',
        collapsed ? 'pl-[calc(12px+var(--chrome-left))]' : 'pl-4',
        className,
      )}
    >
      {collapsed && (
        <IconButton
          icon={narrow ? MenuIcon : PanelLeft}
          label={narrow ? 'Open navigation' : 'Show sidebar'}
          shortcut="mod+\"
          onClick={toggle}
          className="app-no-drag"
        />
      )}
      {narrow && parent?.link && (
        <Link
          {...parent.link}
          aria-label={`Back to ${typeof parent.label === 'string' ? parent.label : 'the previous page'}`}
          className="app-no-drag -ml-1 flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
      )}
      <nav aria-label="Breadcrumb" className="app-no-drag flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="text-fg-faint select-none max-md:hidden">/</span>}
            {c.link ? (
              <Link
                {...c.link}
                className={cn(
                  'flex min-w-0 items-center gap-1.5 rounded-xs px-1 py-0.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg',
                  // Earlier crumbs give way first, so the current page keeps its name.
                  'shrink-[2]',
                  i < crumbs.length - 1 && 'max-md:hidden',
                )}
              >
                {c.icon}
                <span className="truncate">{c.label}</span>
              </Link>
            ) : (
              <span
                aria-current="page"
                className={cn(
                  'flex min-w-0 items-center gap-1.5 px-1 font-medium text-fg md:font-normal',
                  i < crumbs.length - 1 && 'max-md:hidden',
                )}
              >
                {c.icon}
                <span className="truncate">{c.label}</span>
              </span>
            )}
          </Fragment>
        ))}
      </nav>
      <div className="app-no-drag ml-auto flex shrink-0 items-center gap-1">{actions}</div>
    </header>
  )
}

/** Centred reading column used by document-like pages. */
export function Column({
  children,
  wide,
  className,
}: {
  children: ReactNode
  wide?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-6 pb-24 sm:px-12',
        wide ? 'max-w-[1180px]' : 'max-w-[880px]',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** A serif page title with an optional one-line description. */
export function PageTitle({
  title,
  description,
  actions,
  headingRef,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  headingRef?: Ref<HTMLHeadingElement>
}) {
  return (
    <div className="flex items-end justify-between gap-6 pt-10 pb-6">
      <div className="min-w-0">
        <h1
          ref={headingRef}
          tabIndex={headingRef ? -1 : undefined}
          className="studio-title text-fg"
        >
          {title}
        </h1>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

/** A quiet section heading inside a page. */
export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex h-7 items-center justify-between gap-4">
      <h2 className="text-sm font-medium text-fg">{children}</h2>
      {actions}
    </div>
  )
}
