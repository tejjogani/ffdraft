/**
 * The client command registry. Every user action is registered here once — id, title,
 * shortcut, run — and both the ⌘K palette and keyboard shortcuts read from it. There are no
 * ad-hoc key handlers elsewhere. Shortcuts are platform-neutral ("mod+k" = ⌘K on macOS,
 * Ctrl+K elsewhere); <Kbd/> renders them for the current platform.
 */
import { isMac } from '@pave/ui'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useRef, useSyncExternalStore } from 'react'

export type CommandGroup = 'Navigate' | 'Create' | 'Piece' | 'View' | 'Preferences' | 'Assistant'

export interface Command {
  id: string
  title: string
  group: CommandGroup
  icon?: LucideIcon
  shortcut?: string
  keywords?: string[]
  /** Hidden from the palette (shortcut-only commands). */
  hidden?: boolean
  run: () => void
}

const registry = new Map<string, Command>()
const listeners = new Set<() => void>()
let snapshot: Command[] = []

function changed() {
  snapshot = [...registry.values()]
  for (const l of listeners) l()
}

/** Registers commands; later registrations with the same id win until they unregister. */
export function registerCommands(commands: Command[]): () => void {
  const previous = commands.map((c) => registry.get(c.id))
  for (const c of commands) registry.set(c.id, c)
  changed()
  return () => {
    commands.forEach((c, i) => {
      if (registry.get(c.id) !== c) return
      const prev = previous[i]
      if (prev) registry.set(c.id, prev)
      else registry.delete(c.id)
    })
    changed()
  }
}

/**
 * Register commands for as long as the calling component is mounted. The registry is only
 * touched when ids or titles change; `run` always calls the latest closure.
 */
export function useRegisterCommands(commands: Command[]): void {
  const latest = useRef(commands)
  latest.current = commands
  const signature = commands
    .map((c) => `${c.id}\u0000${c.title}\u0000${c.shortcut ?? ''}`)
    .join('\u0001')
  // biome-ignore lint/correctness/useExhaustiveDependencies: `signature` captures everything the registry shows
  useEffect(
    () =>
      registerCommands(
        latest.current.map((c) => ({
          ...c,
          run: () => latest.current.find((x) => x.id === c.id)?.run(),
        })),
      ),
    [signature],
  )
}

export function useCommands(): Command[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snapshot,
  )
}

export const runCommand = (id: string): void => registry.get(id)?.run()

interface Chord {
  key: string
  mod: boolean
  shift: boolean
  alt: boolean
}

const parse = (shortcut: string): Chord => {
  const parts = shortcut.toLowerCase().split('+')
  return {
    key: parts[parts.length - 1]!,
    mod: parts.includes('mod'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
  }
}

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

function matches(e: KeyboardEvent, c: Chord): boolean {
  const mod = isMac ? e.metaKey : e.ctrlKey
  // `code` keeps letter shortcuts working on non-Latin layouts and with ⌥ held on macOS.
  const key = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.key.toLowerCase()
  return key === c.key && mod === c.mod && e.shiftKey === c.shift && e.altKey === c.alt
}

/** One global keydown listener dispatching to the registry. */
export function useShortcutListener(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      for (const cmd of registry.values()) {
        if (!cmd.shortcut) continue
        const chord = parse(cmd.shortcut)
        // Bare-key shortcuts never fire while typing.
        if (!chord.mod && isEditable(e.target)) continue
        if (matches(e, chord)) {
          e.preventDefault()
          cmd.run()
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
