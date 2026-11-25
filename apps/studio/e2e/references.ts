// @ts-nocheck — a driver script, run with tsx; not part of the app's type graph.
/**
 * The reference panel beside CAD, end to end against the real server and kernel, with the museum
 * answers played from a recording (the museums cannot be reached here; their picture addresses
 * are served from the fixture's files to the browser too): search the three collections, read a
 * result's provenance, pin results, a link and a dropped picture, reorder, then drag the picture
 * onto the front view, scale it by two clicks and a typed distance, fade, lock, move, undo and
 * redo, take it out and undo that, and see the panel beside the Render tab and on a phone.
 *
 *   pnpm --filter @pave/studio build
 *   tsx apps/studio/e2e/references-fixture.ts <fixtureDir>
 *   PORT=8799 PAVE_DATA_DIR=$(mktemp -d) PAVE_SEARCH_FIXTURES=<fixtureDir>/recording.json \
 *     tsx apps/server/src/main.ts
 *   tsx apps/studio/e2e/references.ts http://127.0.0.1:8799 <outDir> <fixtureDir> light 1440
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright') as typeof import('playwright')
const [BASE, OUT, FIXTURE, THEME = 'light', WIDTH = '1440'] = process.argv.slice(2)
const width = Number(WIDTH)
const mobile = width < 600
const tag = `${THEME}-${WIDTH}`
mkdirSync(OUT, { recursive: true })
const recording = JSON.parse(readFileSync(join(FIXTURE, 'recording.json'), 'utf8'))

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const ctx = await browser.newContext({
  viewport: { width, height: mobile ? 844 : 900 },
  deviceScaleFactor: 1,
  colorScheme: THEME,
})
// The museums' picture hosts, answered from the fixture's files.
await ctx.route(
  /^https:\/\/(images\.metmuseum\.org|www\.artic\.edu|openaccess-cdn\.clevelandart\.org)\//,
  (route) => {
    const file = recording.images[route.request().url()]
    if (!file) return route.fulfill({ status: 404, body: '' })
    return route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      body: readFileSync(join(FIXTURE, file)),
    })
  },
)
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

const shot = async (name: string) => {
  await page.waitForTimeout(600)
  if (mobile)
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('*')) if (el.scrollLeft) el.scrollLeft = 0
    })
  await page.screenshot({ path: `${OUT}/${name}.${tag}.png` })
  console.log('shot', name)
}
const rpc = async (name: string, input: unknown) => {
  const r = await page.request.post(`${BASE}/api/rpc/${name}`, { data: input })
  if (!r.ok()) throw new Error(`${name}: ${r.status()} ${await r.text()}`)
  return r.json()
}
const until = async (what: string, test: () => Promise<boolean>, ms = 60_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await test()) return
    await page.waitForTimeout(250)
  }
  throw new Error(`timed out waiting for ${what}`)
}
const pinsOf = async (pieceId: string) => (await rpc('references.pins', { pieceId })).references
const panel = () =>
  mobile
    ? page.getByRole('dialog', { name: 'References' })
    : page.locator('aside[aria-label="References"]')

const report: Record<string, unknown> = {}
try {
  await page.goto(`${BASE}/`)
  await page.locator('#main').waitFor()
  const piece = await rpc('pieces.create', { templateId: 'solitaire', title: 'Solitaire, 1 ct' })

  // ── 1. The panel beside CAD ──────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/pieces/${piece.id}/design`)
  await page.locator('[data-region="viewport"]').waitFor()
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Show references' }).first().click()
  await panel().waitFor()
  await shot('01-panel-empty')

  // ── 2. Search the museums ────────────────────────────────────────────────────────────────
  await panel().getByRole('button', { name: 'Search', exact: true }).first().click()
  await panel().getByRole('textbox', { name: 'Search museum collections' }).fill('ring')
  await panel().getByRole('textbox', { name: 'Search museum collections' }).press('Enter')
  await until(
    'three providers',
    async () => (await panel().locator('section[aria-label] article').count()) >= 8,
  )
  await page.waitForTimeout(1200)
  await shot('02-search')

  // ── 3. Provenance of a view-only result ──────────────────────────────────────────────────
  const modern = panel().locator('article[aria-label="Modern ring"]')
  await modern.scrollIntoViewIfNeeded()
  await modern.getByRole('button', { name: /comes from/ }).click()
  const pop = page.getByRole('dialog', { name: /Where “Modern ring” comes from/ })
  await pop.waitFor()
  report.provenance = await pop.textContent()
  await shot('03-provenance')
  await page.keyboard.press('Escape')

  // ── 4. Pin results, a link and a dropped picture ─────────────────────────────────────────
  for (const title of ['Posy ring', 'Modern ring', 'Ring with a cushion-cut sapphire']) {
    const tile = panel().locator(`article[aria-label="${title}"]`)
    await tile.scrollIntoViewIfNeeded()
    await tile.getByRole('button', { name: 'Pin' }).click()
    await tile.getByRole('button', { name: 'Pinned' }).waitFor()
  }
  await panel()
    .getByRole('button', { name: /^Pinned \d/ })
    .click()
  await panel()
    .getByLabel('Paste a link or a picture')
    .fill('https://www.pinterest.com/pin/1234567890/')
  await panel().getByLabel('Paste a link or a picture').press('Enter')
  await until('link pinned', async () => (await pinsOf(piece.id)).length === 4)
  await panel().locator('input[type="file"]').setInputFiles(join(FIXTURE, 'ring-front.png'))
  await until('picture pinned', async () => (await pinsOf(piece.id)).length === 5)
  // Bring the drawing to the top of the list.
  for (let i = 0; i < 4; i++) {
    await panel()
      .locator('article[aria-label="Pinned: ring-front.png"]')
      .getByRole('button', { name: /Actions for/ })
      .click()
    await page.getByRole('menuitem', { name: 'Move up' }).click()
    await page.waitForTimeout(300)
  }
  const pins = await pinsOf(piece.id)
  report.pins = pins.map((r) => ({
    title: r.title,
    rights: r.rights,
    stored: !!r.assetId,
    provider: r.source?.provider,
  }))
  await shot('04-pinned')

  // ── 5. Lay the drawing in the front view ─────────────────────────────────────────────────
  const drawing = pins.find((r) => r.title === 'ring-front.png')
  const tile = panel().locator('article[aria-label="Pinned: ring-front.png"]')
  if (!mobile) {
    const from = await tile.boundingBox()
    await page.mouse.move(from.x + 30, from.y + 30)
    await page.mouse.down()
    await page.mouse.move(from.x + 60, from.y + 40, { steps: 4 })
    const zone = page.locator('[data-drop-view="front"]')
    await zone.waitFor({ timeout: 5000 })
    const to = await zone.boundingBox()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 })
    await shot('05-drop-zones')
    await page.mouse.up()
  } else {
    await tile.getByRole('button', { name: /Actions for/ }).click()
    await page.getByRole('menuitem', { name: 'Front view' }).click()
  }
  await until(
    'placed',
    async () => !!(await pinsOf(piece.id)).find((r) => r.id === drawing.id)?.plane,
  )
  await page.getByRole('toolbar', { name: /Picture in the front view/ }).waitFor()
  await page.waitForTimeout(2500)
  report.placed = (await pinsOf(piece.id)).find((r) => r.id === drawing.id).plane
  await shot('06-plane-front')

  // ── 6. Scale by two points: the band's inside edges are 16.5 mm apart ────────────────────
  await page.getByRole('button', { name: 'Scale', exact: true }).click()
  await page.waitForTimeout(1500)
  const rect = async () =>
    (await page.locator('[data-plane-screen]').getAttribute('data-plane-screen'))
      .split(',')
      .map(Number)
  const [x0, y0, x1, y1] = await rect()
  const canvas = await page
    .locator('[data-region="viewport"] canvas[role="application"]')
    .boundingBox()
  const at = (fx: number, fy: number) => [
    canvas.x + x0 + (x1 - x0) * fx,
    canvas.y + y0 + (y1 - y0) * fy,
  ]
  // In the drawing (800 px): the inside of the band spans x 235…565 at y 470.
  const [ax, ay] = at(235 / 800, 470 / 800)
  const [bx, by] = at(565 / 800, 470 / 800)
  await page.mouse.click(ax, ay)
  await page.mouse.click(bx, by)
  await page
    .getByRole('dialog', { name: 'Scale the picture' })
    .getByLabel('Real distance')
    .fill('16.5')
  await page
    .getByRole('dialog', { name: 'Scale the picture' })
    .getByLabel('Real distance')
    .press('Tab')
  await shot('07-scale-points')
  await page.getByRole('button', { name: 'Scale the picture' }).click()
  await until('scaled', async () => {
    const p = (await pinsOf(piece.id)).find((r) => r.id === drawing.id).plane
    return p && p.width !== report.placed.width
  })
  await page.waitForTimeout(2500)
  const scaled = (await pinsOf(piece.id)).find((r) => r.id === drawing.id).plane
  // 330 px of the 800 px drawing are 16.5 mm, so the whole drawing is 40 mm wide.
  report.scaled = { width: scaled.width, expected: 40, error: Math.abs(scaled.width - 40) / 40 }
  await shot('08-scaled-front')

  // ── 7. Fade, lock, move by dragging, undo and redo ───────────────────────────────────────
  const toolbar = page.getByRole('toolbar', { name: /Picture in the front view/ })
  await toolbar.getByRole('slider', { name: 'Opacity' }).focus()
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(800)
  const faded = (await pinsOf(piece.id)).find((r) => r.id === drawing.id).plane
  const [mx0, my0, mx1, my1] = await rect()
  // Drag the drawing so its ring sits on the CAD ring: the drawing's ring centre (400, 470 px of
  // 800) goes to the finger axis (x 0, z 0). Grab it at a spot left of the ring, clear of the
  // toolbars.
  const pxPerMm = (mx1 - mx0) / faded.width
  const H = faded.width // the drawing is square
  const off = [(400 / 800 - 0.5) * faded.width, (0.5 - 470 / 800) * H]
  const need = [0 - faded.center[0] - off[0], 0 - faded.center[1] - off[1]]
  const sx = canvas.x + mx0 + (mx1 - mx0) * 0.06
  const sy = canvas.y + my0 + (my1 - my0) * 0.35
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(sx + need[0] * pxPerMm, sy - need[1] * pxPerMm, { steps: 8 })
  await page.mouse.up()
  await until('moved', async () => {
    const p = (await pinsOf(piece.id)).find((r) => r.id === drawing.id).plane
    return p.center[0] !== faded.center[0]
  })
  report.alignedBy = need
  const moved = (await pinsOf(piece.id)).find((r) => r.id === drawing.id).plane
  await toolbar.getByRole('button', { name: 'Undo the picture change' }).click()
  await until('undone', async () => {
    const p = (await pinsOf(piece.id)).find((r) => r.id === drawing.id).plane
    return p.center[0] === faded.center[0]
  })
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z')
  await until('redone', async () => {
    const p = (await pinsOf(piece.id)).find((r) => r.id === drawing.id).plane
    return p.center[0] === moved.center[0]
  })
  await toolbar.getByRole('button', { name: 'Lock the picture' }).click()
  await toolbar.getByRole('button', { name: 'Unlock the picture' }).waitFor()
  report.edits = { faded: faded.opacity, moved: [faded.center, moved.center], locked: true }
  await page.waitForTimeout(1500)
  await shot('09-aligned-locked')

  // ── 8. Out of the view, and back with Undo ───────────────────────────────────────────────
  await toolbar.getByRole('button', { name: 'Take the picture out of the view' }).click()
  await until(
    'removed',
    async () => !(await pinsOf(piece.id)).find((r) => r.id === drawing.id).plane,
  )
  // The toast's Undo (the CAD toolbar's Undo is an icon without text).
  await page.locator('button', { hasText: /^Undo$/ }).click()
  await until(
    'restored',
    async () => !!(await pinsOf(piece.id)).find((r) => r.id === drawing.id).plane,
  )
  report.restored = (await pinsOf(piece.id)).find((r) => r.id === drawing.id).plane

  // ── 9. Beside the Render tab ─────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/pieces/${piece.id}/render`)
  await page.waitForTimeout(5000)
  if (mobile) await page.getByRole('button', { name: 'Show references' }).first().click()
  await panel().waitFor()
  await shot('10-render-panel')
  if (mobile) await page.keyboard.press('Escape')

  // ── 10. Settings, Integrations ───────────────────────────────────────────────────────────
  await page.goto(`${BASE}/settings/integrations`)
  await page.getByText('Web image search').waitFor()
  await shot('11-integrations')
} catch (e) {
  console.error(e)
  await page.screenshot({ path: `${OUT}/error.${tag}.png` })
  process.exitCode = 1
} finally {
  writeFileSync(`${OUT}/report.${tag}.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}
