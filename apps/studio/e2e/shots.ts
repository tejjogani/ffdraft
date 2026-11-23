/**
 * Visual check of the studio shell: serves the fixture workspace through request interception
 * and saves 1440×900 screenshots in light and dark.
 *
 *   pnpm --filter @pave/studio dev          # in one terminal
 *   tsx apps/studio/e2e/shots.ts <outDir>   # in another
 */
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Browser, Page } from 'playwright'
import { handlers } from './fixtures'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const BASE = process.env.STUDIO_URL ?? 'http://localhost:5173'
const OUT = process.argv[2] ?? 'shots'
const ONLY = process.argv[3]
mkdirSync(OUT, { recursive: true })

async function open(browser: Browser, theme: 'light' | 'dark'): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: theme })
  await ctx.addInitScript((t) => localStorage.setItem('pave:theme', JSON.stringify(t)), theme)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.error('pageerror:', e.message))
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && console.error('console:', m.text()))
  await page.route('**/api/rpc/*', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop()! as keyof typeof handlers
    const handler = handlers[name]
    if (!handler) return route.fulfill({ status: 501, json: { error: { code: 'not_implemented', message: `${name} is not in the fixtures` } } })
    try {
      return route.fulfill({ json: handler(route.request().postDataJSON() ?? {}) })
    } catch (e) {
      const err = e as Error & { status?: number }
      return route.fulfill({ status: err.status ?? 500, json: { error: { code: 'error', message: err.message } } })
    }
  })
  await page.route('**/api/events', (route) => route.fulfill({ status: 204 }))
  return page
}

type Shot = [name: string, path: string, act?: (p: Page) => Promise<void>]
const SHOTS: Shot[] = [
  ['home', '/'],
  ['pieces-gallery', '/pieces'],
  ['pieces-table', '/pieces?view=table'],
  ['pieces-grouped', '/pieces?group=stage'],
  ['piece-overview', '/pieces/p_oval-pave'],
  ['piece-history', '/pieces/p_oval-pave/history', async (p) => {
    await p.getByRole('button', { name: /operations?$/ }).first().click()
  }],
  ['piece-design', '/pieces/p_oval-pave/design'],
  ['library-metals', '/library'],
  ['library-cuts', '/library?tab=cuts'],
  ['library-sizes', '/library?tab=sizes'],
  ['settings-usage', '/settings/usage'],
  ['settings-traces', '/settings/traces'],
  ['settings-integrations', '/settings/integrations'],
  ['palette', '/pieces', async (p) => {
    await p.keyboard.press('Control+k')
    await p.waitForTimeout(250)
    await p.keyboard.type('ov')
  }],
  ['menu', '/pieces/p_oval-pave', async (p) => {
    await p.getByRole('button', { name: 'Piece options' }).click()
    await p.getByRole('menuitem', { name: 'Move to collection' }).hover()
  }],
  ['workspace-menu', '/', async (p) => {
    await p.getByRole('button', { name: /Atelier Moreau/ }).click()
  }],
  ['assistant-dock', '/pieces/p_oval-pave', async (p) => {
    await p.keyboard.press('Control+j')
  }],
]

const browser = await chromium.launch()
for (const theme of ['light', 'dark'] as const) {
  const page = await open(browser, theme)
  for (const [name, path, act] of SHOTS) {
    if (ONLY && !name.includes(ONLY)) continue
    await page.goto(BASE + path)
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => document.fonts.ready)
    if (act) await act(page)
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/${name}-${theme}.png` })
    // Leave overlays and panels closed for the next shot.
    await page.keyboard.press('Escape')
    await page.evaluate(() => localStorage.removeItem('pave:assistant'))
  }
  await page.context().close()
}
await browser.close()
console.log(`saved to ${OUT}`)
