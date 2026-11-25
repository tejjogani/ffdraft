import type { Collection } from '@pave/schema'
import {
  Avatar,
  ContextMenu,
  cn,
  IconButton,
  Input,
  Kbd,
  Menu,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  useTheme,
} from '@pave/ui'
import { Link, type LinkProps, useNavigate } from '@tanstack/react-router'
import {
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  ChevronsLeft,
  ChevronsUpDown,
  Folder,
  Gem,
  Home,
  Image,
  Laptop,
  Lightbulb,
  LogOut,
  type LucideIcon,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  Sparkles,
  SquarePen,
  Sun,
  Palette as ThemeIcon,
  Trash2,
  Truck,
  User,
  Users,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { AskAiSection } from '../features/assistant/AskAiSection'
import { runCommand } from '../lib/commands'
import { usd } from '../lib/format'
import { useRpc, useRpcMutation } from '../lib/query'
import { activeOrg, auth, useSession } from '../lib/session'
import { useUI } from '../stores/ui'

const row =
  'group relative flex h-7 w-full items-center gap-2 rounded-sm px-2 text-sm text-fg-muted select-none outline-none ' +
  'transition-colors duration-120 hover:bg-bg-hover hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 ' +
  'data-[status=active]:bg-bg-active data-[status=active]:text-fg [&_svg]:shrink-0'

function NavLink({
  to,
  icon: Icon,
  children,
  exact,
}: {
  to: LinkProps['to']
  icon: LucideIcon
  children: ReactNode
  exact?: boolean
}) {
  return (
    <Link to={to} activeOptions={{ exact }} className={row}>
      <Icon className="size-4 text-fg-subtle group-data-[status=active]:text-fg" aria-hidden />
      <span className="truncate">{children}</span>
    </Link>
  )
}

function ActionRow({
  icon: Icon,
  children,
  shortcut,
  onClick,
}: {
  icon: LucideIcon
  children: ReactNode
  shortcut?: string
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className={row}>
      <Icon className="size-4 text-fg-subtle" aria-hidden />
      <span className="flex-1 truncate text-left">{children}</span>
      {shortcut && <Kbd shortcut={shortcut} className="hover-reveal" />}
    </button>
  )
}

/** The frosted sidebar: workspace, quick actions, navigation, collections, library & settings. */
export function Sidebar({ drawer = false }: { drawer?: boolean }) {
  const toggle = useUI((s) => s.toggleSidebar)
  return (
    <aside
      aria-label="Sidebar"
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-glass-line',
        // Over the page on a phone it is read, not glanced at: the strong glass.
        drawer ? 'glass-strong w-[min(280px,86vw)] border-y-0 border-l-0' : 'glass-pane w-[248px]',
      )}
    >
      <div className="app-drag h-(--chrome-top) shrink-0" />
      <div className="flex items-center gap-1 px-2">
        <WorkspaceSwitcher />
        <IconButton
          icon={ChevronsLeft}
          label={drawer ? 'Close navigation' : 'Hide sidebar'}
          shortcut="mod+\"
          onClick={toggle}
          size="sm"
          className={drawer ? undefined : 'hover-reveal'}
        />
      </div>

      <div className="mt-2 flex flex-col gap-px px-2">
        <ActionRow icon={Search} shortcut="mod+k" onClick={() => runCommand('palette.open')}>
          Search
        </ActionRow>
        <ActionRow icon={Sparkles} shortcut="mod+j" onClick={() => runCommand('assistant.toggle')}>
          Assistant
        </ActionRow>
        <ActionRow icon={SquarePen} shortcut="mod+n" onClick={() => runCommand('piece.new')}>
          New piece
        </ActionRow>
      </div>

      <nav aria-label="Main" className="mt-4 flex flex-col gap-px px-2">
        <NavLink to="/" icon={Home} exact>
          Home
        </NavLink>
        <NavLink to="/ideas" icon={Lightbulb}>
          Ideas
        </NavLink>
        <NavLink to="/pieces" icon={Gem}>
          Projects
        </NavLink>
        <NavLink to="/renders" icon={Image}>
          Renders
        </NavLink>
        <NavLink to="/models" icon={User}>
          Models
        </NavLink>
        <NavLink to="/sourcing" icon={Truck}>
          Sourcing
        </NavLink>
      </nav>

      <Collections />

      <div className="mt-auto flex flex-col gap-px px-2 pt-2 pb-2">
        <NavLink to="/library" icon={BookOpen}>
          Library
        </NavLink>
        <NavLink to="/settings" icon={Settings}>
          Settings
        </NavLink>
        <UsageMeter />
      </div>
    </aside>
  )
}

function WorkspaceSwitcher() {
  const session = useSession()
  const org = activeOrg(session)
  const navigate = useNavigate()
  const { preference, setTheme } = useTheme()
  const name = org?.name ?? 'Workspace'
  return (
    <Menu
      trigger={
        <button
          type="button"
          aria-label={`Workspace: ${name}`}
          className="app-no-drag flex h-8 min-w-0 flex-1 items-center gap-2 rounded-sm px-1.5 text-sm font-medium text-fg outline-none hover:bg-bg-hover data-popup-open:bg-bg-active"
        >
          <Avatar
            name={name}
            src={org?.logo}
            size="sm"
            shape="square"
            className="bg-ink! text-ink-fg!"
          />
          <span className="truncate">{name}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
        </button>
      }
      className="w-60"
    >
      <div className="flex items-center gap-2.5 px-2 py-2">
        <Avatar name={session.user.name} src={session.user.image} size="md" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{session.user.name}</div>
          <div className="truncate text-xs text-fg-subtle">{session.user.email}</div>
        </div>
      </div>
      <MenuSeparator />
      <MenuItem icon={Users} onClick={() => void navigate({ to: '/settings/members' })}>
        Members
      </MenuItem>
      <MenuItem icon={Settings} onClick={() => void navigate({ to: '/settings/general' })}>
        Settings
      </MenuItem>
      <MenuSub label="Theme" icon={ThemeIcon}>
        <MenuRadioGroup value={preference} onChange={setTheme}>
          <MenuRadioItem value="system" icon={Laptop}>
            System
          </MenuRadioItem>
          <MenuRadioItem value="light" icon={Sun}>
            Light
          </MenuRadioItem>
          <MenuRadioItem value="dark" icon={Moon}>
            Dark
          </MenuRadioItem>
        </MenuRadioGroup>
      </MenuSub>
      <MenuSeparator />
      <MenuItem icon={LogOut} onClick={() => void auth.signOut().finally(auth.refresh)}>
        Sign out
      </MenuItem>
    </Menu>
  )
}

function Collections() {
  const { data } = useRpc('collections.list', {})
  const [adding, setAdding] = useState(false)
  const create = useRpcMutation('collections.create')
  const collections = [...(data ?? [])].sort((a, b) => a.position - b.position)
  // Folders nest one level: each top-level folder, then the folders inside it.
  const top = collections.filter(
    (c) => !c.parentId || !collections.some((x) => x.id === c.parentId),
  )
  const inside = (id: string) => collections.filter((c) => c.parentId === id)
  return (
    <section aria-label="Collections" className="mt-5 flex min-h-0 flex-col px-2">
      <div className="group flex h-7 items-center justify-between pr-1 pl-2">
        <h2 className="text-xs font-medium text-fg-subtle">Folders</h2>
        <IconButton
          icon={Plus}
          label="New folder"
          size="sm"
          className="hover-reveal"
          onClick={() => setAdding(true)}
        />
      </div>
      <div className="-mx-2 min-h-0 overflow-y-auto px-2">
        {top.map((c) => (
          <div key={c.id}>
            <CollectionRow collection={c} />
            {inside(c.id).map((child) => (
              <CollectionRow key={child.id} collection={child} depth={1} />
            ))}
          </div>
        ))}
        {adding && (
          <InlineName
            initial=""
            placeholder="Folder name"
            onDone={(name) => {
              setAdding(false)
              if (name) create.mutate({ name })
            }}
          />
        )}
        {!adding && collections.length === 0 && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={cn(row, 'text-fg-subtle')}
          >
            <Plus className="size-4" aria-hidden />
            New folder
          </button>
        )}
      </div>
    </section>
  )
}

function CollectionIcon({ c }: { c: Collection }) {
  return c.icon ? (
    <span className="flex size-4 items-center justify-center text-sm leading-none">{c.icon}</span>
  ) : (
    <Folder className="size-4 text-fg-subtle" aria-hidden />
  )
}

function CollectionRow({ collection: c, depth = 0 }: { collection: Collection; depth?: 0 | 1 }) {
  const expanded = useUI((s) => s.expandedCollections.includes(c.id))
  const toggle = useUI((s) => s.toggleCollection)
  const [renaming, setRenaming] = useState(false)
  const [adding, setAdding] = useState(false)
  const update = useRpcMutation('collections.update')
  const remove = useRpcMutation('collections.delete')
  const create = useRpcMutation('collections.create')
  const pieces = useRpc('pieces.list', { collectionId: c.id }, { enabled: expanded })

  if (renaming)
    return (
      <InlineName
        initial={c.name}
        onDone={(name) => {
          setRenaming(false)
          if (name && name !== c.name) update.mutate({ id: c.id, name })
        }}
      />
    )

  const actions = (
    <>
      <MenuItem icon={Pencil} onClick={() => setRenaming(true)}>
        Rename
      </MenuItem>
      {depth === 0 && (
        <MenuItem icon={Plus} onClick={() => setAdding(true)}>
          New folder inside
        </MenuItem>
      )}
      <MenuItem icon={Trash2} danger onClick={() => remove.mutate({ id: c.id })}>
        Delete folder
      </MenuItem>
    </>
  )

  return (
    <div>
      {/* no AskAiSection: a collection holds pieces but has no design to ask about */}
      <ContextMenu content={actions}>
        <div className="group relative">
          <Link
            to="/collections/$id"
            params={{ id: c.id }}
            className={cn(row, depth ? 'pl-12' : 'pl-8')}
            onDoubleClick={(e) => {
              e.preventDefault()
              setRenaming(true)
            }}
          >
            <span className="flex-1 truncate">{c.name}</span>
            <span className="hover-reveal text-xs text-fg-subtle tabular group-focus-within:mr-6 group-hover:mr-6 pointer-coarse:mr-6">
              {c.pieceCount}
            </span>
          </Link>
          {/* The icon doubles as the disclosure toggle; on hover-capable devices it shows a chevron. */}
          <button
            type="button"
            aria-label={expanded ? `Collapse ${c.name}` : `Expand ${c.name}`}
            aria-expanded={expanded}
            onClick={() => toggle(c.id)}
            className={cn(
              'absolute top-1.5 flex size-4 items-center justify-center rounded-xs text-fg-subtle hover:bg-bg-active',
              depth ? 'left-6' : 'left-2',
            )}
          >
            <span className="group-hover:hidden">
              <CollectionIcon c={c} />
            </span>
            <ChevronRight
              className={cn(
                'hidden size-3.5 transition-transform duration-120 group-hover:block',
                expanded && 'rotate-90',
              )}
              aria-hidden
            />
          </button>
          <Menu
            trigger={
              <button
                type="button"
                aria-label={`${c.name} options`}
                className="hover-reveal absolute top-1 right-1 flex size-5 items-center justify-center rounded-xs text-fg-subtle hover:bg-bg-active hover:text-fg"
              >
                <MoreHorizontal className="size-3.5" aria-hidden />
              </button>
            }
            className="min-w-44"
          >
            {actions}
          </Menu>
        </div>
      </ContextMenu>
      {adding && (
        <div className="pl-6">
          <InlineName
            initial=""
            placeholder="Folder name"
            onDone={(name) => {
              setAdding(false)
              if (name) create.mutate({ name, parentId: c.id })
            }}
          />
        </div>
      )}
      {expanded && (
        <div className="flex flex-col gap-px">
          {pieces.data?.map((p) => (
            // A piece row's menu is about the whole piece: its quick edits, then Ask AI.
            <ContextMenu
              key={p.id}
              content={
                <>
                  <MenuItem
                    icon={ArrowUpRight}
                    render={<Link to="/pieces/$id" params={{ id: p.id }} />}
                  >
                    Open
                  </MenuItem>
                  <AskAiSection subject={{ type: 'piece', pieceId: p.id }} />
                </>
              }
            >
              <Link
                to="/pieces/$id"
                params={{ id: p.id }}
                className={cn(row, 'h-6.5 pl-8 text-xs')}
              >
                <span className="size-1 shrink-0 rounded-full bg-fg-faint" aria-hidden />
                <span className="truncate">{p.title || 'Untitled'}</span>
              </Link>
            </ContextMenu>
          ))}
          {pieces.data?.length === 0 && (
            <div className="h-6.5 pl-8 text-xs leading-6.5 text-fg-subtle">No projects yet</div>
          )}
        </div>
      )}
    </div>
  )
}

function InlineName({
  initial,
  placeholder,
  onDone,
}: {
  initial: string
  placeholder?: string
  onDone: (name: string | null) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <div className="flex h-7 items-center gap-2 rounded-sm bg-bg px-2 shadow-[inset_0_0_0_1px_var(--select)]">
      <Folder className="size-4 shrink-0 text-fg-subtle" aria-hidden />
      <Input
        bare
        autoFocus
        value={value}
        placeholder={placeholder}
        aria-label="Folder name"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onDone(value.trim() || null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') onDone(null)
        }}
        className="text-sm"
      />
    </div>
  )
}

/** This month's spend, for admins, when metering is available. */
function UsageMeter() {
  const session = useSession()
  const role = activeOrg(session)?.role
  const isAdmin = role === 'owner' || role === 'admin'
  const days = new Date().getDate()
  const usage = useRpc('usage.summary', { days }, { enabled: isAdmin, retry: false })
  const settings = useRpc('org.settings.get', {}, { enabled: isAdmin, retry: false })
  if (!usage.data) return null
  const budget = settings.data?.monthlyBudgetUsd ?? null
  const pct = budget ? Math.min(1, usage.data.totalUsd / budget) : null
  return (
    <Link
      to="/settings/usage"
      className="mt-1 rounded-sm px-2 py-1.5 transition-colors hover:bg-bg-hover"
    >
      <div className="flex items-center justify-between text-xs">
        <span className="text-fg-subtle">Spend this month</span>
        <span className="font-mono text-2xs text-fg-muted tabular">
          {usd(usage.data.totalUsd)}
          {budget ? <span className="text-fg-subtle"> / {usd(budget)}</span> : null}
        </span>
      </div>
      {pct !== null && (
        <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-bg-inset">
          <div
            className={cn('h-full rounded-full', pct > 0.9 ? 'bg-warn' : 'bg-fg-muted')}
            style={{ width: `${pct * 100}%` }}
          />
        </div>
      )}
    </Link>
  )
}
