// @ts-nocheck — a driver script, run with tsx; not part of the app's type graph.
/**
 * The Render stage in the studio, end to end against the real server, kernel and (when set up)
 * Blender, with the scripted assistant standing in for Claude: the Render tab's default shots
 * and live preview, the engine dialog, the Render job (its plan, two shots rendered and looked
 * at, one re-rendered), variants by chat with one go-ahead, star, cover, compare, a stale take
 * after a design change, and a take by hand with progress and Cancel. Saves screenshots.
 *
 *   pnpm --filter @pave/studio build
 *   PORT=8799 PAVE_DATA_DIR=$(mktemp -d) PAVE_ASSISTANT=scripted:render-studio \
 *     PAVE_PYTHON=<bpy venv python> tsx apps/server/src/main.ts
 *   tsx apps/studio/e2e/render.ts http://127.0.0.1:8799 <outDir> light 1440 [full|browser]
 *
 * `browser` is the pass without Blender: takes are drawn by the window, "Preview quality".
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const [BASE, OUT, THEME = 'light', WIDTH = '1440', MODE = 'full'] = process.argv.slice(2)
const width = Number(WIDTH)
const mobile = width < 600
const tag = `${THEME}-${WIDTH}${MODE === 'browser' ? '-browser' : ''}`
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const ctx = await browser.newContext({
  viewport: { width, height: mobile ? 844 : 900 },
  deviceScaleFactor: 1,
  colorScheme: THEME,
})
await ctx.addInitScript(
  ([t, narrow]) => {
    localStorage.setItem('pave:theme', JSON.stringify(t))
    if (narrow && !localStorage.getItem('pave:ui'))
      localStorage.setItem(
        'pave:ui',
        JSON.stringify({ state: { sidebarCollapsed: true, expandedCollections: [] }, version: 0 }),
      )
  },
  [THEME, mobile],
)
const page = await ctx.newPage()
page.on('pageerror', (e) => console.error('pageerror:', e.message))
page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()))

const shot = async (name: string, full = false) => {
  await page.waitForTimeout(400)
  // Clicking into a sideways-scrolling row (the shot list, the piece's tabs on a phone) scrolls
  // its ancestors sideways too; put them back, as a person's view would be.
  if (mobile)
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('*')) if (el.scrollLeft) el.scrollLeft = 0
      window.scrollTo(0, window.scrollY)
    })
  await page.screenshot({ path: `${OUT}/${name}.${tag}.png`, fullPage: full })
  console.log('shot', name)
}
const rpc = async (name: string, input: unknown) => {
  const r = await page.request.post(`${BASE}/api/rpc/${name}`, { data: input })
  if (!r.ok()) throw new Error(`${name}: ${r.status()} ${await r.text()}`)
  return r.json()
}
const dock = () => page.locator('aside[aria-label="Assistant"]')
const composer = () => dock().getByRole('textbox', { name: 'Message the assistant' })
const takes = () => page.getByRole('region', { name: 'Takes' })
const openDock = async () => {
  for (let i = 0; i < 3 && !(await dock().isVisible()); i++) {
    await page.keyboard.press('Control+j')
    await dock()
      .waitFor({ timeout: 3000 })
      .catch(() => {})
  }
  await dock().waitFor()
}
const closeDock = async () => {
  if (await dock().isVisible())
    await dock().getByRole('button', { name: 'Close assistant' }).click()
}
const foldPlan = async () => {
  const hide = page.getByRole('button', { name: 'Hide the job’s plan' })
  if (await hide.isVisible().catch(() => false)) await hide.click()
}
const until = async (what: string, test: () => Promise<boolean>, ms = 600_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await test()) return
    await page.waitForTimeout(1000)
  }
  throw new Error(`timed out waiting for ${what}`)
}
const allTakes = (pieceId: string) => rpc('renders.list', { pieceId, limit: 200 })
const settled = (list) => list.every((t) => !['queued', 'running'].includes(t.status))

try {
  await page.goto(`${BASE}/`)
  await page.locator('#main').waitFor()
  const piece = await rpc('pieces.create', { templateId: 'solitaire', title: 'Solitaire, 1 ct' })
  await page.goto(`${BASE}/pieces/${piece.id}/render`)
  await page.getByRole('navigation', { name: 'Shots' }).waitFor()
  await page.locator('canvas[aria-label^="Live preview"]').waitFor()
  await page.waitForTimeout(4000)
  await shot('01-render-tab')

  await page
    .getByRole('button', { name: /Blender|Preview quality/ })
    .first()
    .click()
  await page.getByRole('dialog').waitFor()
  await page.waitForTimeout(800)
  await shot('02-engine-dialog')
  await page.keyboard.press('Escape')

  // The Render job: its plan, then two shots, looked at, one re-rendered.
  await page.getByRole('button', { name: 'Render with AI' }).click()
  await page.getByRole('button', { name: 'Start job' }).waitFor()
  await page.waitForTimeout(1500)
  await shot('03-job-plan')
  await page.getByRole('button', { name: 'Start job' }).click()
  await until(
    'the first takes to start',
    async () => (await allTakes(piece.id)).length >= 2,
    120_000,
  )
  await page.waitForTimeout(MODE === 'browser' ? 300 : 3000)
  await closeDock()
  await foldPlan()
  await shot('04-rendering')
  await openDock()
  await page.waitForTimeout(800)
  await shot('05-dock-waiting')
  await dock().getByText('The brighter key fixed the Top').waitFor({ timeout: 900_000 })
  await page.waitForTimeout(2500)
  await shot('06-dock-critique')
  await closeDock()
  await foldPlan()
  await page
    .getByRole('navigation', { name: 'Shots' })
    .getByRole('button', { name: /^Top/ })
    .click()
  await page.waitForTimeout(1500)
  await shot('07-takes')

  // The person accepts the set; a new request is then a conversation of its own (inside the job
  // its takes were approved with the plan, outside it they need a go-ahead).
  await page.getByRole('button', { name: 'Accept' }).first().click()
  await page.waitForTimeout(1000)

  // Variants by chat: one go-ahead for both, then both pictures in the conversation.
  await openDock()
  await composer().fill('Render it in rose gold and platinum')
  await composer().press('Enter')
  const approve = dock().getByRole('button', { name: 'Render 2 takes' })
  await approve.waitFor({ timeout: 60_000 })
  await shot('08-batch-approval')
  await approve.click()
  await dock().getByText('Both metals are in.').waitFor({ timeout: 900_000 })
  await page.waitForTimeout(2500)
  await shot('09-dock-variants')
  await closeDock()

  // By hand: star, cover, compare the two Top takes.
  const tiles = takes().getByRole('article')
  await tiles.first().getByRole('button', { name: 'Star' }).click()
  await tiles.first().getByRole('button', { name: 'Take options' }).click()
  await page.getByRole('menuitem', { name: 'Set as cover' }).click()
  await page.waitForTimeout(800)
  await tiles.nth(1).getByRole('button', { name: 'Take options' }).click()
  await page.getByRole('menuitem', { name: 'Compare…' }).click()
  await page.waitForTimeout(1500)
  await shot('10-compare')
  await page.getByRole('button', { name: 'Done' }).click()

  // A design change makes the takes stale.
  const full = await rpc('pieces.get', { id: piece.id })
  const band = full.design.nodes.band
    ? 'band'
    : full.design.order.find((id) => full.design.nodes[id].type === 'band')
  if (band)
    await rpc('design.apply', {
      pieceId: piece.id,
      label: 'Widen the band',
      ops: [{ t: 'update', id: band, patch: { widthTop: 2.6 } }],
    })
  await page.waitForTimeout(2500)
  await shot('11-stale')

  // A take by hand of the Hero shot.
  await page
    .getByRole('navigation', { name: 'Shots' })
    .getByRole('button', { name: /^Hero/ })
    .click()
  if (MODE === 'browser') {
    await page.getByRole('button', { name: 'Render preview' }).click()
    await until('the browser take', async () => settled(await allTakes(piece.id)), 120_000)
    await page.waitForTimeout(2000)
    await shot('12-browser-take')
  } else {
    // At draft quality: its progress, then Cancel.
    await page.getByRole('button', { name: 'Draft', exact: true }).click()
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: 'Render', exact: true }).click()
    await until('the hand take to start rendering', async () =>
      (await allTakes(piece.id)).some((t) => t.status === 'running' && t.actor.type === 'user'),
    )
    await page.waitForTimeout(4000)
    await shot('12-progress')
    await takes().getByRole('button', { name: 'Cancel' }).first().click()
    await page.waitForTimeout(2000)
    await shot('13-canceled')
  }

  // The renders page across pieces.
  await page.goto(`${BASE}/renders`)
  await page.getByRole('heading', { name: 'Renders' }).first().waitFor()
  await page.waitForTimeout(1500)
  await shot('14-renders-page')

  const list = await allTakes(piece.id)
  const report = list.map((t) => ({
    title: t.title,
    status: t.status,
    engine: t.engine,
    seconds: t.seconds,
    device: t.device,
    group: t.groupId,
    variant: t.variantLabel,
    retryOf: !!t.retryOf,
    note: t.note,
    stale: t.stale,
    actor: t.actor.type,
    starred: t.starred,
    assets: t.assetIds,
  }))
  writeFileSync(`${OUT}/takes.${tag}.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  // The takes themselves, to be looked at.
  for (const t of list.filter((x) => x.status === 'done')) {
    const r = await page.request.get(`${BASE}/api/assets/${t.assetIds[0]}`)
    writeFileSync(
      `${OUT}/take-${(t.variantLabel ?? t.title).replace(/\W+/g, '-')}-${t.id.slice(-4)}.${tag}.png`,
      await r.body(),
    )
  }
} catch (e) {
  console.error('FAILED:', e.message)
  await page.screenshot({ path: `${OUT}/zz-failure.${tag}.png` })
  process.exitCode = 1
} finally {
  await browser.close()
}
