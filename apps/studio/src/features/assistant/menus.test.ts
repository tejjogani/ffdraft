/**
 * The rule of docs/plans/targeted-edits.md §7: every context menu in the app ends with the
 * Ask AI section. Read from the source, so a new menu without it fails here; a menu about
 * something that has no design (a collection) says why in a `no AskAiSection:` comment just
 * before it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '../..')
/** The element, not `ContextMenuHandle` in a type argument. */
const OPEN = /<ContextMenu[\s>]/g
const EXEMPT = /no AskAiSection: \w/

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return path.endsWith('.tsx') ? [path] : []
  })
}

/** Every `<ContextMenu` element in a file: where it opens and what lies up to its close. */
function menusIn(source: string): { at: number; body: string; before: string }[] {
  return [...source.matchAll(OPEN)].map((m) => {
    const at = m.index
    const close = source.indexOf('</ContextMenu>', at)
    // A self-closing menu has no body to search; it fails the rule unless exempt.
    return {
      at,
      body: source.slice(at, close < 0 ? at : close),
      before: source.slice(Math.max(0, at - 200), at),
    }
  })
}

describe('context menus', () => {
  const files = sources(SRC).filter((p) => menusIn(readFileSync(p, 'utf8')).length)

  it('are the sidebar, the feature list and the 3D view (a new one is listed here on purpose)', () => {
    expect(files.map((p) => p.slice(SRC.length + 1)).sort()).toEqual([
      'app/Sidebar.tsx',
      'features/cad/outliner/Outliner.tsx',
      'features/cad/viewport/ViewportMenu.tsx',
    ])
  })

  it.each(files.map((p) => [p.slice(SRC.length + 1), p]))(
    'every menu in %s ends with AskAiSection, or says why not',
    (_, path) => {
      for (const menu of menusIn(readFileSync(path, 'utf8')))
        expect(
          menu.body.includes('<AskAiSection') || EXEMPT.test(menu.before),
          `menu at offset ${menu.at}`,
        ).toBe(true)
    },
  )

  it('exempts only menus that have no design behind them', () => {
    const exempt = files.flatMap((p) =>
      menusIn(readFileSync(p, 'utf8'))
        .filter((m) => !m.body.includes('<AskAiSection'))
        .map(() => p.slice(SRC.length + 1)),
    )
    expect(exempt).toEqual(['app/Sidebar.tsx'])
  })
})
