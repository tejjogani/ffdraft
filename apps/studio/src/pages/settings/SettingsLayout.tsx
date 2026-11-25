import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { Activity, BadgeCheck, Blocks, Box, Settings, Shield, Sparkles, Users } from 'lucide-react'
import { PageHeader } from '../../components/Page'

const NAV = [
  { to: '/settings/general', label: 'General', icon: Settings },
  { to: '/settings/members', label: 'Members', icon: Users },
  { to: '/settings/ai', label: 'AI', icon: Sparkles },
  { to: '/settings/plan', label: 'Plan', icon: BadgeCheck },
  { to: '/settings/usage', label: 'Usage', icon: Activity },
  { to: '/settings/traces', label: 'Traces', icon: Box },
  { to: '/settings/privacy', label: 'Data & privacy', icon: Shield },
  { to: '/settings/integrations', label: 'Integrations', icon: Blocks },
] as const

export function SettingsLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const current = NAV.find((n) => path.startsWith(n.to))
  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Settings', link: { to: '/settings/general' } },
          { label: current?.label ?? '' },
        ]}
      />
      {/* On a phone the section list is a row of pills under the header, scrolled sideways.
          shrink-0: in the page's flex column a scrolling row would otherwise collapse. */}
      <nav
        aria-label="Settings sections"
        className="scroll-fade-x sticky top-11 z-10 flex shrink-0 gap-1 overflow-x-auto bg-bg px-4 py-2 md:hidden"
      >
        {NAV.map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            className="flex h-7 shrink-0 items-center rounded-full px-3 text-sm text-fg-muted shadow-[inset_0_0_0_1px_var(--line)] data-[status=active]:bg-ink data-[status=active]:text-ink-fg data-[status=active]:shadow-none"
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="mx-auto flex w-full max-w-[1080px] gap-10 px-4 pt-6 pb-24 sm:px-12 md:pt-10">
        <nav
          aria-label="Settings"
          className="sticky top-21 hidden w-44 shrink-0 self-start md:block"
        >
          <ul className="flex flex-col gap-px">
            {NAV.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <Link
                  to={to}
                  className="group flex h-7 items-center gap-2 rounded-sm px-2 text-sm text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg data-[status=active]:bg-bg-active data-[status=active]:text-fg"
                >
                  <Icon
                    className="size-4 text-fg-subtle group-data-[status=active]:text-fg"
                    aria-hidden
                  />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </>
  )
}

/** Title + description at the top of each settings section. */
export function SettingsTitle({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-8 flex items-end justify-between gap-6">
      <div>
        <h1 className="font-serif text-title">{title}</h1>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      {actions}
    </div>
  )
}

/** A group of settings rows separated by hairlines. */
export function SettingsGroup({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <section className="mb-10">
      {title && <h2 className="mb-2 text-sm font-medium">{title}</h2>}
      <div className="divide-y divide-line border-y border-line">{children}</div>
    </section>
  )
}

export function SettingsRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    // A phone stacks the control under its label instead of squeezing both onto one line.
    <div className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div className="min-w-0">
        <div className="text-sm text-fg">{label}</div>
        {description && <div className="mt-0.5 text-xs text-fg-subtle">{description}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}
