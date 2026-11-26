// @ts-nocheck — a driver script, run with tsx; not part of the app's type graph.
/**
 * The design pass's eyes: one screenshot of every screen and state, against the real server and
 * kernel, with the scripted assistant standing in for Claude. Run it before and after a visual
 * change and look at the two folders side by side. A failing screen is logged and skipped, so one
 * broken selector never hides the rest.
 *
 *   pnpm --filter @pave/studio build
 *   PORT=8799 PAVE_DATA_DIR=$(mktemp -d) PAVE_RENDER_NONE=1 \
 *     PAVE_ASSISTANT=scripted:design-directions tsx apps/server/src/main.ts
 *   tsx apps/studio/e2e/polish.ts http://127.0.0.1:8799 <outDir> light 1440 [normal|reduced|nokey]
 *
 * `reduced` asks for reduced motion and reduced transparency; `nokey` is a server started
 * without PAVE_ASSISTANT and captures the key form in the dock and in Settings, AI.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const [BASE, OUT, THEME = 'light', WIDTH = '1440', MODE = 'normal'] = process.argv.slice(2)
const width = Number(WIDTH)
const mobile = width < 600
const tag = `${THEME}-${WIDTH}${MODE === 'normal' ? '' : `-${MODE}`}`
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const ctx = await browser.newContext({
  viewport: { width, height: mobile ? 844 : 900 },
  deviceScaleFactor: 1,
  colorScheme: THEME,
  reducedMotion: MODE === 'reduced' ? 'reduce' : 'no-preference',
  hasTouch: mobile,
})
await ctx.addInitScript((t) => localStorage.setItem('pave:theme', JSON.stringify(t)), THEME)
const page = await ctx.newPage()
if (MODE === 'reduced') {
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-reduced-motion', value: 'reduce' },
      { name: 'prefers-reduced-transparency', value: 'reduce' },
    ],
  })
}
const errors: string[] = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))

const shots: string[] = []
const failed: Record<string, string> = {}
const overflow: Record<string, number> = {}
const shot = async (name: string, full = false) => {
  await page.waitForTimeout(500)
  // Sideways scroll on a phone is a layout bug: measure it before anything hides it.
  const wide = await page.evaluate(() => {
    const main = document.querySelector('#main')
    const doc = document.scrollingElement
    return Math.max(
      (main?.scrollWidth ?? 0) - (main?.clientWidth ?? 0),
      (doc?.scrollWidth ?? 0) - (doc?.clientWidth ?? 0),
    )
  })
  if (wide > 1) overflow[name] = wide
  await page.screenshot({ path: `${OUT}/${name}.${tag}.png`, fullPage: full })
  shots.push(name)
  console.log('shot', name, wide > 1 ? `(sideways ${wide}px)` : '')
}
const step = async (name: string, fn: () => Promise<void>) => {
  try {
    await fn()
  } catch (e) {
    failed[name] = String(e.message ?? e).split('\n')[0]
    console.error('FAILED', name, failed[name])
    await page.keyboard.press('Escape').catch(() => {})
  }
}
const rpc = async (name: string, input: unknown) => {
  const r = await page.request.post(`${BASE}/api/rpc/${name}`, { data: input })
  if (!r.ok()) throw new Error(`${name}: ${r.status()} ${await r.text()}`)
  return r.json()
}
const go = async (path: string) => {
  await page.goto(`${BASE}${path}`)
  await page.locator('#main').waitFor()
  await page.waitForLoadState('networkidle').catch(() => {})
}
const dock = () => page.locator('aside[aria-label="Assistant"], section[aria-label="Assistant"]')
const closeAssistant = async () => {
  const close = page.getByRole('button', { name: 'Close assistant' }).first()
  if (await close.isVisible().catch(() => false)) await close.click()
}
const foldPlan = async () => {
  const hide = page.getByRole('button', { name: 'Hide the job’s plan' })
  if (await hide.isVisible().catch(() => false)) await hide.click()
}
const canvasReady = async () => {
  await page.locator('[data-region="viewport"] canvas, canvas').first().waitFor({ timeout: 60_000 })
  await page.waitForTimeout(4000)
}

try {
  await go('/')
  if (MODE === 'nokey') {
    await step('k1-dock-nokey', async () => {
      await page.keyboard.press('Control+j')
      await dock().first().waitFor()
      await shot('k1-dock-nokey')
      await closeAssistant()
    })
    await step('k2-settings-ai-nokey', async () => {
      await go('/settings/ai')
      await page.getByRole('heading').first().waitFor()
      await shot('k2-settings-ai-nokey', true)
    })
    throw 'done'
  }

  await step('01-home-empty', async () => {
    await shot('01-home-empty')
  })
  await step('02-pieces-empty', async () => {
    await go('/pieces')
    await shot('02-pieces-empty')
  })
  await step('03-renders-empty', async () => {
    await go('/renders')
    await page.waitForTimeout(800)
    await shot('03-renders-empty')
  })

  // A small studio: a piece with a brief for the Design job, and finished pieces for the lists.
  const piece = await rpc('pieces.create', {
    title: 'Tenth anniversary ring',
    brief:
      'A ring for our tenth anniversary. About a carat, size 6. She works with her hands, so nothing that catches. Budget around $4,000.',
  })
  const halo = await rpc('pieces.create', { templateId: 'halo', title: 'Cushion halo, rose gold' })
  await rpc('pieces.create', { templateId: 'solitaire', title: 'Classic solitaire, 1 ct' })
  const collection = await rpc('collections.create', { name: 'Bridal 2027' })
  await rpc('pieces.update', { id: halo.id, collectionId: collection.id })

  await step('04-home', async () => {
    await go('/')
    await shot('04-home')
  })
  await step('05-pieces-gallery', async () => {
    await go('/pieces')
    await page.waitForTimeout(1500)
    await shot('05-pieces-gallery')
  })
  await step('06-pieces-table', async () => {
    await go('/pieces?view=table')
    await shot('06-pieces-table')
  })
  await step('07-piece-overview', async () => {
    await go(`/pieces/${halo.id}`)
    await page.waitForTimeout(1500)
    await shot('07-piece-overview')
  })
  await step('08-design-empty', async () => {
    await go(`/pieces/${piece.id}/directions`)
    await page.getByText('No directions yet').waitFor()
    await shot('08-design-empty')
  })
  await step('09-job-plan', async () => {
    await page.getByRole('button', { name: 'Propose directions with AI' }).first().click()
    await page.getByRole('button', { name: 'Start job' }).waitFor()
    await shot('09-job-plan')
  })
  await step('10-design-directions', async () => {
    await page.getByRole('button', { name: 'Start job' }).click()
    await page
      .getByRole('region', { name: 'Directions' })
      .getByRole('article', { name: /^Direction C:/ })
      .waitFor({ timeout: 180_000 })
    await page.locator('article img').nth(2).waitFor({ timeout: 60_000 })
    await page.waitForTimeout(1500)
    await shot('11-job-panel')
    await closeAssistant()
    await foldPlan()
    await page.getByRole('region', { name: 'Directions' }).scrollIntoViewIfNeeded()
    await shot('10-design-directions')
  })
  await step('12-assistant-docked', async () => {
    await page.keyboard.press('Control+j')
    await dock().first().waitFor()
    await page.waitForTimeout(800)
    await shot('12-assistant-docked')
  })
  await step('13-assistant-floating', async () => {
    if (mobile) return
    await page.getByRole('button', { name: 'Pop out as a floating window' }).click()
    await page.waitForTimeout(600)
    await shot('13-assistant-floating')
  })
  await step('14-assistant-pill', async () => {
    await page.getByRole('button', { name: 'Collapse to a pill' }).first().click()
    await page.waitForTimeout(600)
    await shot('14-assistant-pill')
    // Back to the docked default for the rest of the pass.
    await page.locator('[data-assistant-pill] button').first().click()
    const dockBtn = page.getByRole('button', { name: 'Dock in the sidebar' })
    if (await dockBtn.isVisible().catch(() => false)) await dockBtn.click()
    await closeAssistant()
  })
  await step('15-cad', async () => {
    await go(`/pieces/${halo.id}/design`)
    await canvasReady()
    await foldPlan()
    await shot('15-cad')
  })
  await step('16-references', async () => {
    const show = page.getByRole('button', { name: /^Show references/ }).first()
    if (await show.isVisible().catch(() => false)) await show.click()
    await page.locator('[data-region="references"]').first().waitFor({ timeout: 10_000 })
    await page.waitForTimeout(600)
    await shot('16-references')
    await page
      .locator('[data-region="references"]')
      .getByRole('button', { name: 'Search', exact: true })
      .first()
      .click()
      .catch(() => {})
    await page.waitForTimeout(400)
    await shot('17-references-search')
    await page
      .locator('[data-region="references"]')
      .getByRole('button', { name: 'Sketch', exact: true })
      .first()
      .click()
    await page.waitForTimeout(600)
    await shot('18-sketch')
    await page
      .locator('[data-region="references"]')
      .getByRole('button', { name: 'References', exact: true })
      .first()
      .click()
    const hide = page.getByRole('button', { name: /^(Hide|Close) references/ }).first()
    if (await hide.isVisible().catch(() => false)) await hide.click()
  })
  await step('19-render', async () => {
    await go(`/pieces/${halo.id}/render`)
    // The shot list changes shape on a phone; the render button is there at every width.
    await page
      .getByRole('button', { name: /^Render preview$|^Render$/ })
      .first()
      .waitFor({ timeout: 60_000 })
    await page.waitForTimeout(5000)
    await shot('19-render')
  })
  await step('20-render-take', async () => {
    await page
      .getByRole('button', { name: /^Render preview$|^Render$/ })
      .first()
      .click()
    await page.waitForTimeout(1500)
    await shot('20a-render-progress')
    for (let i = 0; i < 90; i++) {
      const list = await rpc('renders.list', { pieceId: halo.id, limit: 20 })
      if (list.length && list.every((t) => ['done', 'failed', 'canceled'].includes(t.status))) break
      await page.waitForTimeout(1000)
    }
    await page.waitForTimeout(1500)
    await shot('20-render-take')
  })
  await step('21-engine-dialog', async () => {
    await page
      .getByRole('button', { name: /Blender|Preview quality/ })
      .first()
      .click()
    await page.getByRole('dialog').waitFor()
    await shot('21-engine-dialog')
    await page.keyboard.press('Escape')
  })
  for (const [name, path] of [
    ['22-settings-ai', '/settings/ai'],
    ['23-settings-plan', '/settings/plan'],
    ['24-settings-usage', '/settings/usage'],
    ['25-settings-general', '/settings/general'],
    ['26-settings-integrations', '/settings/integrations'],
    ['27-settings-traces', '/settings/traces'],
    ['28-upgrade', '/upgrade'],
    ['29-renders', '/renders'],
    ['30-library', '/library'],
    ['31-moodboards', '/moodboards'],
    ['32-history', `/pieces/${halo.id}/history`],
    ['33-notfound', '/no-such-page'],
    ['34-piece-notfound', '/pieces/pc_missing'],
  ] as const)
    await step(name, async () => {
      await go(path)
      await page.waitForTimeout(800)
      await shot(name)
    })
  await step('35-palette', async () => {
    await go('/pieces')
    await page.keyboard.press('Control+k')
    await page.getByRole('dialog').first().waitFor()
    await page.keyboard.type('ren')
    await shot('35-palette')
    await page.keyboard.press('Escape')
  })
  await step('36-loading', async () => {
    // Hold the list back to see what a slow server looks like.
    await page.route('**/api/rpc/pieces.list', async (r) => {
      await new Promise((ok) => setTimeout(ok, 4000))
      await r.continue().catch(() => {})
    })
    await page.goto(`${BASE}/pieces`)
    await page.locator('#main').waitFor()
    await page.waitForTimeout(700)
    await shot('36-loading')
    await page.unroute('**/api/rpc/pieces.list')
  })
  await step('37-error', async () => {
    await page.route('**/api/rpc/pieces.list', (r) =>
      r.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'The database is busy.' } }),
      }),
    )
    await page.goto(`${BASE}/pieces`)
    await page.locator('#main').waitFor()
    await page.waitForTimeout(4000)
    await shot('37-error')
    await page.unroute('**/api/rpc/pieces.list')
  })
  if (mobile)
    await step('38-mobile-nav', async () => {
      await go('/pieces')
      const open = page.getByRole('button', { name: /Show sidebar|Open navigation/ }).first()
      await open.click()
      await page.waitForTimeout(500)
      await shot('38-mobile-nav')
      await page.keyboard.press('Escape')
    })
} catch (e) {
  if (e !== 'done') {
    console.error('ABORTED:', e.message ?? e)
    await page.screenshot({ path: `${OUT}/zz-failure.${tag}.png` })
    process.exitCode = 1
  }
} finally {
  writeFileSync(
    `${OUT}/report.${tag}.json`,
    JSON.stringify({ tag, shots, failed, overflow, errors: errors.slice(0, 40) }, null, 2),
  )
  console.log(JSON.stringify({ failed, overflow, errors: errors.length }))
  await browser.close()
}
