// @ts-nocheck — a driver script, run with tsx; not part of the app's type graph.
/**
 * The Design stage in the studio, end to end against the real server and kernel, with the
 * scripted assistant standing in for Claude (no key, no network): a brief, the Design job
 * proposing three built directions (cards on the piece and in the dock), a mix by chat, the mix
 * dialog by hand, the pick by chat, and a chat edit on the chosen one in CAD. Saves screenshots.
 *
 *   pnpm --filter @pave/studio build
 *   PORT=8799 PAVE_DATA_DIR=$(mktemp -d) PAVE_ASSISTANT=scripted:design-directions tsx apps/server/src/main.ts
 *   tsx apps/studio/e2e/design.ts http://127.0.0.1:8799 <outDir> light 1440
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
    // The app's sidebar does not fold itself on a phone; fold it as a person would.
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
  await page.waitForTimeout(300)
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
const card = (letter: string) =>
  page
    .getByRole('region', { name: 'Directions' })
    .getByRole('article', { name: new RegExp(`^Direction ${letter}:`) })
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
const say = async (text: string, until: string) => {
  await openDock()
  await composer().fill(text)
  await composer().press('Enter')
  const reply = dock().getByText(until, { exact: false }).last()
  await reply.waitFor({ timeout: 120_000 })
  await page.waitForTimeout(800)
  await reply.scrollIntoViewIfNeeded()
}
/** The job's plan opens over the page when a job wants review; fold it to see the cards. */
const foldPlan = async () => {
  const hide = page.getByRole('button', { name: 'Hide the job’s plan' })
  if (await hide.isVisible().catch(() => false)) await hide.click()
}

try {
  await page.goto(`${BASE}/`)
  await page.locator('#main').waitFor()
  const piece = await rpc('pieces.create', {
    title: 'Tenth anniversary ring',
    brief:
      'A ring for our tenth anniversary. About a carat, size 6. She works with her hands, so nothing that catches. Budget around $4,000.',
  })
  await page.goto(`${BASE}/pieces/${piece.id}/directions`)
  await page.getByText('No directions yet').waitFor()
  await shot('01-empty')

  // The Design job: its plan first, then three built directions.
  await page.getByRole('button', { name: 'Propose directions with AI' }).click()
  await page.getByRole('button', { name: 'Start job' }).waitFor()
  await shot('02-job-plan')
  await page.getByRole('button', { name: 'Start job' }).click()
  await card('C').waitFor({ timeout: 120_000 })
  await page.locator('article img').nth(2).waitFor()
  await page.waitForTimeout(1200)
  await closeDock()
  await foldPlan()
  await card('A').scrollIntoViewIfNeeded()
  await shot('03-directions')
  await shot('03-directions-full', true)

  // The same round in the dock, side by side.
  await openDock()
  await dock().getByText('Which one, or a mix?').waitFor({ timeout: 60_000 })
  await dock().getByRole('list', { name: 'Directions' }).scrollIntoViewIfNeeded()
  await shot('04-dock-cards')

  // A mix by chat: the head of A on the band of B.
  await say('Put the head of A on the band of B', 'Choose it on its card')
  await shot('05-dock-mix')
  await closeDock()
  await foldPlan()
  await card('D').waitFor()
  await card('D').scrollIntoViewIfNeeded()
  await shot('06-mixed-card')

  // The mix dialog by hand (cancelled; the fixture's next turn is the pick).
  await card('A').getByRole('button', { name: 'Mix…' }).click()
  await page.getByRole('dialog').waitFor()
  await shot('07-mix-dialog')
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()

  // The pick, by chat; the card says Chosen and the piece moves to CAD.
  await say('Go with D', 'the piece is in CAD')
  await shot('08-dock-chosen')
  await closeDock()
  await foldPlan()
  await card('D').getByText('Chosen').waitFor({ timeout: 30_000 })
  await card('D').scrollIntoViewIfNeeded()
  await shot('08-chosen-card')

  // A chat edit on the chosen one, watched in CAD.
  await page.goto(`${BASE}/pieces/${piece.id}/design`)
  await page.locator('[data-region="viewport"] canvas').first().waitFor({ timeout: 60_000 })
  await say('Make the band 3 mm wide', 'Widened the band to 3 mm')
  await page.waitForTimeout(2000)
  await shot('09-edit-in-cad')

  const after = await rpc('pieces.get', { id: piece.id })
  const runs = await rpc('traces.runs', { pieceId: piece.id, limit: 10 })
  console.log(
    JSON.stringify(
      {
        directions: after.directions.map((d) => ({
          letter: d.letter,
          name: d.name,
          origin: d.origin,
          basis: d.basis,
          facts: d.facts,
          notes: d.notes.length,
          previews: d.previewAssetIds.length,
        })),
        chosen: after.directions.find((d) => d.id === after.chosenDirectionId)?.letter,
        stage: after.stage,
        band: after.design.nodes.band?.widthTop,
        runs: runs.map((r) => [r.status, r.job?.stage ?? null, r.job?.review ?? null]),
      },
      null,
      2,
    ),
  )
  if (after.directions.length !== 4) throw new Error('expected four directions')
  if (after.design.nodes.band?.widthTop !== 3) throw new Error('the chat edit did not land')
} catch (e) {
  console.error('FAILED:', e.message)
  await page.screenshot({ path: `${OUT}/zz-failure.${tag}.png` })
  process.exitCode = 1
} finally {
  await browser.close()
}
