// @ts-nocheck — a driver script, run with tsx; not part of the app's type graph.
/**
 * Plans and allowances in the studio, against the real server and kernel, with the scripted
 * assistant standing in for Claude: Settings, Plan as the month is used; the export menu saying
 * what is left; the upgrade card when the last free Rhino or STEP export is used (claimed from
 * the server before the browser exports); the same card for renders with Blender (a take past
 * the limit, with "Preview in the browser"); the Upgrade screen; and the calm card inline in
 * the dock when the assistant's export hits the limit. Saves screenshots.
 *
 *   pnpm --filter @pave/studio build
 *   PORT=8799 PAVE_DATA_DIR=$(mktemp -d) PAVE_ASSISTANT=scripted:plan-limit \
 *     [PAVE_PYTHON=<bpy venv python>] tsx apps/server/src/main.ts
 *   tsx apps/studio/e2e/plans.ts http://127.0.0.1:8799 <outDir> light 1440
 */
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const [BASE, OUT, THEME = 'light', WIDTH = '1440'] = process.argv.slice(2)
const width = Number(WIDTH)
const mobile = width < 600
const tag = `${THEME}-${WIDTH}`
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
// A headless browser cannot answer the native save dialog (it reads as canceled, which gives the
// export back). Stand in for a person who saves: the picker hands back a writer that discards.
// A string, not a function: tsx would wrap a function in helpers the page does not have.
await ctx.addInitScript(`Object.defineProperty(window, 'showSaveFilePicker', {
  value: async () => ({ createWritable: async () => ({ write: async () => {}, close: async () => {} }) }),
})`)
const page = await ctx.newPage()
page.on('pageerror', (e) => console.error('pageerror:', e.message))
page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()))
// The allowance calls the studio makes, so a run's log shows each claim and how it settled.
page.on('response', (r) => {
  const name = r.url().match(/\/api\/rpc\/(plan\.\w+|design\.export)/)?.[1]
  if (name) console.log('rpc', name, r.status())
})

const shot = async (name: string, full = false) => {
  await page.waitForTimeout(500)
  if (mobile)
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('*')) if (el.scrollLeft) el.scrollLeft = 0
    })
  await page.screenshot({ path: `${OUT}/${name}.${tag}.png`, fullPage: full })
  console.log('shot', name)
}
const rpc = async (name: string, input: unknown, ok = true) => {
  const r = await page.request.post(`${BASE}/api/rpc/${name}`, { data: input })
  if (ok && !r.ok()) throw new Error(`${name}: ${r.status()} ${await r.text()}`)
  return r.json()
}
const dock = () => page.locator('aside[aria-label="Assistant"]')
const composer = () => dock().getByRole('textbox', { name: 'Message the assistant' })
const openDock = async () => {
  for (let i = 0; i < 3 && !(await dock().isVisible()); i++) {
    await page.keyboard.press('Control+j')
    await dock()
      .waitFor({ timeout: 3000 })
      .catch(() => {})
  }
  await dock().waitFor()
}
const card = () => page.getByRole('dialog', { name: /Your free|fair-use/ })
const exportsUsed = async () =>
  (await rpc('plan.get', {})).allowances.find((a) => a.allowance === 'export').used
/** Uses `n` Rhino or STEP exports, as earlier exports from the studio would have. */
const spendExports = async (pieceId: string, n: number) => {
  for (let i = 0; i < n; i++) {
    const { claimId } = await rpc('plan.claim', {
      pieceId,
      format: 'step',
      key: `e2e-earlier-${Date.now()}-${i}`,
    })
    await rpc('plan.settle', { claimId, delivered: true })
  }
}

try {
  await page.goto(`${BASE}/`)
  await page.locator('#main').waitFor()
  const piece = await rpc('pieces.create', { templateId: 'solitaire', title: 'Solitaire, 1 ct' })

  // Settings, Plan with part of the month used.
  await spendExports(piece.id, 3)
  await page.goto(`${BASE}/settings/plan`)
  await page.getByRole('heading', { name: 'Plan' }).waitFor()
  await page.getByText('Rhino and STEP exports').first().waitFor()
  await shot('01-settings-plan', true)

  // The CAD tab's export menu says what is left; the last free one goes, then the card.
  await spendExports(piece.id, 1)
  await page.goto(`${BASE}/pieces/${piece.id}/design`)
  await page.locator('canvas').first().waitFor()
  await page.waitForTimeout(5000)
  const exportButton = page.getByRole('button', { name: /^Export/ }).first()
  await exportButton.click()
  const counted = page.getByRole('menuitem', { name: /STEP|3DM/ }).first()
  await counted.waitFor()
  await shot('02-export-menu')
  await counted.click()
  // The fifth export: the browser exports after the server's claim (a save dialog may not show
  // in a headless browser; the claim is what counts).
  const until = async (what: string, test: () => Promise<boolean>, ms = 120_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (await test()) return
      await page.waitForTimeout(500)
    }
    throw new Error(`timed out waiting for ${what}`)
  }
  await until('the fifth export to be claimed', async () => (await exportsUsed()) === 5)
  // Let the browser finish it (and settle the claim) before asking for a sixth.
  await page
    .getByText(/^Preparing (STEP|3DM)/)
    .waitFor({ state: 'hidden', timeout: 180_000 })
    .catch(() => console.log('the fifth export was still preparing'))
  await page.waitForTimeout(1000)
  if ((await exportsUsed()) !== 5) throw new Error('the saved fifth export was not counted')
  await page.keyboard.press('Escape')
  await exportButton.click()
  await page
    .getByRole('menuitem', { name: /STEP|3DM/ })
    .first()
    .click()
  await card().waitFor()
  await page.getByText('You have used your 5 free Rhino or STEP exports this month').waitFor()
  await shot('03-upgrade-card-export')
  if ((await exportsUsed()) !== 5) throw new Error('the refused export was counted')

  // Renders with Blender: five takes held while they render use the month; the sixth is refused.
  const engine = await rpc('renders.engine', {})
  if (engine.available) {
    await card().getByRole('button', { name: 'Not now' }).click()
    const queued = []
    for (let i = 0; i < 5; i++)
      queued.push(
        await rpc('renders.create', {
          pieceId: piece.id,
          title: `Hold ${i + 1}`,
          // Each a different scene: identical ones would come from the render cache, uncounted.
          scene: {
            camera: { focalLength: 80 + i * 5 },
            output: { width: 256, height: 256, quality: 'preview' },
          },
        }),
      )
    await page.goto(`${BASE}/pieces/${piece.id}/render`)
    await page.getByRole('navigation', { name: 'Shots' }).waitFor()
    await page.waitForTimeout(3000)
    await page.getByRole('button', { name: 'Render', exact: true }).click()
    await card().waitFor()
    await page.getByText('You have used your 5 free renders this month').waitFor()
    await shot('04-upgrade-card-render')
    for (const t of queued) await rpc('renders.cancel', { id: t.id }, false)
    // Canceled before they finished: given back.
    const renders = (await rpc('plan.get', {})).allowances.find((a) => a.allowance === 'render')
    const states = (await rpc('renders.list', { pieceId: piece.id, limit: 50 })).map(
      (t) => t.status,
    )
    console.log('takes:', states.join(', '), '· renders counted after the cancels:', renders.used)
    if (renders.used !== states.filter((x) => x === 'done').length)
      throw new Error('the count does not match the finished takes')
    await card().getByRole('button', { name: 'Not now' }).click()
    await page.goto(`${BASE}/pieces/${piece.id}/design`)
    await page.locator('canvas').first().waitFor()
    await page.waitForTimeout(3000)
  } else console.log('no Blender here: the render card is covered by the server tests only')

  // The assistant's export past the limit: the same calm card, inline in the dock.
  if (await card().isVisible()) await card().getByRole('button', { name: 'Not now' }).click()
  await openDock()
  await composer().fill('Export the STEP file for the setter')
  await composer().press('Enter')
  await dock().getByText('Your free Rhino or STEP exports for this month are used').waitFor({
    timeout: 60_000,
  })
  await dock().getByText('An STL is always free').waitFor({ timeout: 60_000 })
  await shot('05-dock-limit')
  await dock().getByRole('link', { name: 'See Pro' }).click()

  // The Upgrade screen.
  await page.getByRole('heading', { name: 'Plans' }).waitFor()
  await page.getByText('Payments are not part of this build yet').waitFor()
  if (await dock().isVisible())
    await dock().getByRole('button', { name: 'Close assistant' }).click()
  await page.waitForTimeout(600)
  await shot('06-upgrade')
  await page.locator('#main').evaluate((el) => el.scrollTo(0, el.scrollHeight))
  await shot('06b-upgrade-bottom')

  await page.goto(`${BASE}/settings/plan`)
  await page.getByRole('heading', { name: 'Plan' }).waitFor()
  await page.getByText('None left this month.').first().waitFor()
  await shot('07-settings-plan-used', true)
} catch (e) {
  await page.screenshot({ path: `${OUT}/zz-failure.${tag}.png` })
  console.error(e)
  process.exitCode = 1
} finally {
  await browser.close()
}
