/**
 * Visual check of the studio shell: saves 1440×900 screenshots in light and dark.
 *
 *   pnpm --filter @pave/studio dev                       # in one terminal
 *   tsx apps/studio/e2e/shots.ts <outDir> [nameFilter]   # in another
 *
 * By default the fixture workspace is served through request interception. With LIVE=1 the
 * pages talk to the real server behind the dev proxy instead.
 */
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Browser, Page } from 'playwright'
import { handlers } from './fixtures'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const BASE = process.env.STUDIO_URL ?? 'http://localhost:5173'
const OUT = process.argv[2] ?? 'shots'
const ONLY = process.argv[3]
const LIVE = process.env.LIVE === '1'
mkdirSync(OUT, { recursive: true })

async function open(browser: Browser, theme: 'light' | 'dark'): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: theme,
  })
  await ctx.addInitScript((t) => localStorage.setItem('pave:theme', JSON.stringify(t)), theme)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.error('pageerror:', e.message))
  page.on(
    'console',
    (m) => m.type() === 'error' && !m.text().includes('404') && console.error('console:', m.text()),
  )
  if (LIVE) return page
  await page.route('**/api/rpc/*', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop()! as keyof typeof handlers
    const handler = handlers[name]
    if (!handler)
      return route.fulfill({
        status: 501,
        json: { error: { code: 'not_implemented', message: `${name} is not in the fixtures` } },
      })
    try {
      return route.fulfill({ json: handler(route.request().postDataJSON() ?? {}) })
    } catch (e) {
      const err = e as Error & { status?: number }
      return route.fulfill({
        status: err.status ?? 500,
        json: { error: { code: 'error', message: err.message } },
      })
    }
  })
  await page.route('**/api/events', (route) => route.fulfill({ status: 204 }))
  return page
}

/** The piece and collection to feature: fixed in fixtures, discovered on a live server. */
async function subjects(
  page: Page,
): Promise<{ piece: string; collection: { id: string; name: string } }> {
  if (!LIVE) return { piece: 'p_oval-pave', collection: { id: 'c_bridal', name: 'Bridal 2027' } }
  const call = async (name: string) =>
    (await page.request.post(`${BASE}/api/rpc/${name}`, { data: { limit: 50 } })).json()
  const pieces = (await call('pieces.list')) as { id: string; stage: string }[]
  const collections = (await call('collections.list')) as { id: string; name: string }[]
  return {
    piece: (pieces.find((p) => p.stage !== 'idea') ?? pieces[0])!.id,
    collection: collections[0]!,
  }
}

type Shot = [name: string, path: string, act?: (p: Page) => Promise<void>]
const shots = (piece: string, collection: { id: string; name: string }): Shot[] => [
  ['home', '/'],
  ['pieces-gallery', '/pieces'],
  ['pieces-table', '/pieces?view=table'],
  ['pieces-grouped', '/pieces?group=stage'],
  ['piece-overview', `/pieces/${piece}`],
  [
    'piece-history',
    `/pieces/${piece}/history`,
    async (p) => {
      const expand = p.getByRole('button', { name: /operations?$/ }).first()
      if (await expand.count()) await expand.click()
    },
  ],
  ['piece-design', `/pieces/${piece}/design`],
  ['library-metals', '/library'],
  ['library-cuts', '/library?tab=cuts'],
  ['library-sizes', '/library?tab=sizes'],
  ['settings-usage', '/settings/usage'],
  ['settings-traces', '/settings/traces'],
  ['settings-integrations', '/settings/integrations'],
  [
    'palette',
    '/pieces',
    async (p) => {
      await p.keyboard.press('Control+k')
      await p.waitForTimeout(250)
    },
  ],
  [
    'menu',
    `/pieces/${piece}`,
    async (p) => {
      await p.getByRole('button', { name: 'Piece options' }).click()
      await p.getByRole('menuitem', { name: 'Move to collection' }).hover()
    },
  ],
  [
    'workspace-menu',
    '/',
    async (p) => {
      await p.getByRole('button', { name: /^Workspace/ }).click()
    },
  ],
  [
    'assistant-dock',
    `/pieces/${piece}`,
    async (p) => {
      await p.keyboard.press('Control+j')
    },
  ],
  [
    'sidebar-collapsed',
    `/pieces/${piece}/history`,
    async (p) => {
      await p.getByRole('button', { name: `Expand ${collection.name}` }).click()
      await p.keyboard.press('Control+\\')
    },
  ],
  [
    'collection',
    `/collections/${collection.id}`,
    async (p) => {
      await p.getByRole('button', { name: `Expand ${collection.name}` }).click()
    },
  ],
  [
    'auth',
    '/?signed-out',
    async (p) => {
      await p.route('**/api/rpc/session.get', (r) =>
        r.fulfill({ status: 401, json: { error: { code: 'unauthorized', message: 'Sign in' } } }),
      )
      await p.reload()
      await p.waitForLoadState('networkidle')
    },
  ],
]

const browser = await chromium.launch()
for (const theme of ['light', 'dark'] as const) {
  const page = await open(browser, theme)
  const { piece, collection } = await subjects(page)
  for (const [name, path, act] of shots(piece, collection)) {
    if (ONLY && !name.includes(ONLY)) continue
    await page.goto(BASE + path)
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => document.fonts.ready)
    if (act) await act(page)
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/${name}-${theme}.png` })
    // Leave overlays and panels closed for the next shot.
    await page.keyboard.press('Escape')
    await page.unroute('**/api/rpc/session.get')
    await page.evaluate(() => {
      localStorage.removeItem('pave:assistant')
      localStorage.removeItem('pave:ui')
    })
  }
  await page.context().close()
}
await browser.close()
console.log(`saved to ${OUT}`)
