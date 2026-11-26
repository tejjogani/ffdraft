// @ts-nocheck — a driver script, run with tsx; not part of the app's type graph.
/**
 * The assistant dock, AI jobs and Settings, AI, end to end against the real server, with the
 * scripted assistant standing in for Claude (no key, no network). Saves screenshots of every
 * state a person meets.
 *
 *   pnpm --filter @pave/studio build
 *   # scripted conversation and jobs:
 *   PORT=8795 PAVE_DATA_DIR=$(mktemp -d) PAVE_ASSISTANT=scripted:dock-tour tsx apps/server/src/main.ts
 *   tsx apps/studio/e2e/dock.ts http://127.0.0.1:8795 <outDir> scripted light 1440
 *   # no key (a server without PAVE_ASSISTANT or a key), then a key in .env:
 *   tsx apps/studio/e2e/dock.ts http://127.0.0.1:8796 <outDir> nokey light 1440
 *   tsx apps/studio/e2e/dock.ts http://127.0.0.1:8797 <outDir> envkey light 1440
 *
 * The scripted pass plays apps/server/src/assistant/fixtures/dock-tour.json run by run, so it
 * needs a fresh server (and data dir) each time.
 */
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const [BASE, OUT, PHASE, THEME = 'light', WIDTH = '1440'] = process.argv.slice(2)
const width = Number(WIDTH)
const mobile = width < 640
const tag = `${THEME}-${WIDTH}`
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const ctx = await browser.newContext({
  viewport: { width, height: mobile ? 844 : 900 },
  deviceScaleFactor: 1,
  colorScheme: THEME,
  reducedMotion: 'no-preference',
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

const shot = async (name: string) => {
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${OUT}/${name}.${tag}.png` })
  console.log('shot', name)
}
const rpc = async (name: string, input: unknown) => {
  const r = await page.request.post(`${BASE}/api/rpc/${name}`, { data: input })
  if (!r.ok()) throw new Error(`${name}: ${r.status()} ${await r.text()}`)
  return r.json()
}
const dock = () => page.locator('aside[aria-label="Assistant"]')
const composer = () => dock().getByRole('textbox', { name: 'Message the assistant' })
const say = async (text: string) => {
  await composer().fill(text)
  await composer().press('Enter')
}
const openDock = async () => {
  // The shortcut listener mounts with the shell; press once it is there, and again if missed.
  await page.locator('#main').waitFor()
  for (let i = 0; i < 3 && !(await dock().isVisible()); i++) {
    await page.keyboard.press('ControlOrMeta+j')
    await dock()
      .waitFor({ timeout: 3000 })
      .catch(() => {})
  }
  await dock().waitFor()
}
const closeDock = async () => {
  if (await dock().isVisible())
    await dock().getByRole('button', { name: 'Close assistant' }).click()
  await dock().waitFor({ state: 'detached' })
}

try {
  if (PHASE === 'scripted') {
    await page.goto(`${BASE}/`)
    await openDock()
    await shot('01-dock-empty')

    await dock()
      .getByRole('button', { name: /^Model tier/ })
      .click()
    await page.getByRole('menu').waitFor()
    await shot('02-tier-picker')
    await page.keyboard.press('Escape')

    // A brief becomes a piece: the answer streams, then the spec waits for "Build it".
    await say('A cushion halo engagement ring in 18k white gold, about 1.2 ct')
    await dock().getByText('A cushion centre in a single halo', { exact: false }).waitFor()
    await page.waitForTimeout(1200)
    await shot('03-streaming')
    await dock().getByText('Ready to build from this spec').waitFor({ timeout: 30_000 })
    await page.waitForTimeout(400)
    await shot('04-spec-card-approval')
    await dock().getByRole('button', { name: 'Build it' }).click()
    await dock().getByText('Want a thinner band', { exact: false }).waitFor({ timeout: 30_000 })
    await page.waitForTimeout(600)
    await shot('05-tool-chips')

    // An error from Claude's API, then the run cap.
    await say('Make it rose gold')
    await dock()
      .getByRole('alert')
      .getByText('Claude is busy right now')
      .waitFor({ timeout: 30_000 })
    await shot('06-error')
    await say('Add a hidden halo under the centre')
    await dock().getByText('Paused at').waitFor({ timeout: 30_000 })
    await shot('07-cap-pill')

    // A live CAD edit with the touched stone tinted, while the run goes on.
    const threads = await rpc('threads.list', { limit: 5 })
    const pieceId = threads[0].context.pieceId
    await page.goto(`${BASE}/pieces/${pieceId}/design`)
    await page.locator('[data-region="viewport"] canvas').first().waitFor({ timeout: 60_000 })
    await page.waitForTimeout(5000)
    await openDock()
    await say('Make the centre stone bigger')
    if (mobile) await closeDock()
    // The pill shows from the run's start; the edit lands about half a second later and its
    // parts glow for 1.8 s.
    await page.locator('[data-assistant-working]').waitFor({ timeout: 30_000 })
    await page.waitForTimeout(1100)
    await shot('08-live-cad-tint')
    await page.locator('[data-assistant-working]').waitFor({ state: 'detached', timeout: 60_000 })

    // The three stages, then a CAD job: planned, running, paused by an edit, ready for review.
    if (!mobile) await closeDock()
    await page.goto(`${BASE}/pieces/${pieceId}`)
    await page
      .getByRole('navigation', { name: 'Project tools' })
      .getByRole('link', { name: 'CAD', exact: true })
      .waitFor()
    await shot('09-project-tools')
    await page.goto(`${BASE}/pieces/${pieceId}/design`)
    await page.locator('[data-region="viewport"] canvas').first().waitFor({ timeout: 60_000 })
    await page.waitForTimeout(3000)
    await page.getByRole('button', { name: 'Make the CAD with AI' }).click()
    await page.getByText('You can pause, take over or stop it').waitFor()
    await page.waitForTimeout(700)
    await shot('10-job-planned')
    await page.getByRole('button', { name: 'Start job' }).click()
    await page
      .getByRole('listitem', { name: /Build the CAD.*under way/ })
      .waitFor({ timeout: 30_000 })
    await page.waitForTimeout(1500)
    await shot('11-job-running')
    await rpc('design.apply', {
      pieceId,
      label: 'Widened the band to 2.2 mm',
      ops: [{ t: 'update', id: 'band', patch: { widthTop: 2.2, widthBottom: 2.2 } }],
    })
    await page
      .locator('[data-job]')
      .getByText('Paused', { exact: true })
      .waitFor({ timeout: 30_000 })
    await page.waitForTimeout(1500)
    await shot('12-job-paused-after-edit')
    await page.locator('[data-job]').getByRole('button', { name: 'Resume' }).click()
    await page.locator('[data-job]').getByText('Ready for review').waitFor({ timeout: 30_000 })
    await page.waitForTimeout(1500)
    await shot('13-job-review')
    await page.locator('[data-job]').getByRole('button', { name: 'Change by chat' }).click()
    await dock()
      .getByText('Look it over and accept it', { exact: false })
      .waitFor({ timeout: 30_000 })
    await page.waitForTimeout(600)
    await shot('14-job-in-dock')
  }

  if (PHASE === 'nokey') {
    await page.goto(`${BASE}/`)
    await openDock()
    await dock().getByText('Connect Claude').waitFor()
    await shot('20-nokey-dock')
    await closeDock()
    await page.goto(`${BASE}/settings/ai`)
    await page.getByRole('textbox', { name: 'Claude API key' }).waitFor()
    await shot('21-settings-ai-nokey')
    await page
      .getByRole('textbox', { name: 'Claude API key' })
      .fill('sk-ant-api03-FAKE-not-a-real-key-000000000000000000000000-wxyz')
    await page.getByRole('button', { name: 'Test' }).click()
    await page.getByRole('status').first().waitFor({ timeout: 60_000 })
    await shot('22-settings-ai-test-fake-key')
    await page.getByRole('button', { name: 'Save' }).click()
    await page.getByText('Saved key ending').waitFor({ timeout: 30_000 })
    await page.waitForTimeout(800)
    await shot('23-settings-ai-saved-key')
  }

  if (PHASE === 'envkey') {
    await page.goto(`${BASE}/settings/ai`)
    await page.getByText('apps/server/.env', { exact: false }).first().waitFor()
    await shot('24-settings-ai-env-key')
  }
} catch (e) {
  console.error('FAILED:', e.message)
  await page.screenshot({ path: `${OUT}/zz-failure.${PHASE}.${tag}.png` })
  process.exitCode = 1
} finally {
  await browser.close()
}
