import { cn } from '../cn'
import { isMac } from '../platform'

const GLYPHS: Record<string, [mac: string, other: string]> = {
  mod: ['⌘', 'Ctrl'],
  shift: ['⇧', 'Shift'],
  alt: ['⌥', 'Alt'],
  ctrl: ['⌃', 'Ctrl'],
  enter: ['↵', 'Enter'],
  backspace: ['⌫', 'Backspace'],
  delete: ['⌦', 'Del'],
  escape: ['Esc', 'Esc'],
  arrowup: ['↑', '↑'],
  arrowdown: ['↓', '↓'],
  arrowleft: ['←', '←'],
  arrowright: ['→', '→'],
}

/** "mod+shift+k" → ["⌘", "⇧", "K"] (or Ctrl/Shift on other platforms). */
export function shortcutKeys(shortcut: string): string[] {
  return shortcut.split('+').map((k) => {
    const g = GLYPHS[k.toLowerCase()]
    if (g) return isMac ? g[0] : g[1]
    // Letters and function keys read as printed on the key: "A", "F2".
    return k.length === 1 || /^f\d{1,2}$/i.test(k) ? k.toUpperCase() : k
  })
}

export interface KbdProps {
  /** Registry notation, e.g. "mod+k". */
  shortcut?: string
  children?: string
  tone?: 'default' | 'inverse'
  className?: string
}

export function Kbd({ shortcut, children, tone = 'default', className }: KbdProps) {
  const keys = shortcut ? shortcutKeys(shortcut) : children ? [children] : []
  return (
    <kbd
      className={cn(
        'inline-flex items-center gap-0.5 font-sans text-2xs leading-none tabular select-none',
        tone === 'inverse' ? 'text-ink-fg/60' : 'text-fg-subtle',
        className,
      )}
    >
      {keys.map((k, i) => (
        <span
          key={i}
          className={cn(
            'inline-flex h-4 min-w-4 items-center justify-center rounded-xs px-1',
            tone === 'inverse' ? 'bg-ink-fg/12' : 'bg-bg-muted shadow-[inset_0_-1px_0_var(--line)]',
          )}
        >
          {k}
        </span>
      ))}
    </kbd>
  )
}
