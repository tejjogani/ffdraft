// @ts-nocheck — a driver script, run with tsx; not part of the app's type graph.
/**
 * Concept images on the design board (step 18), against the real server with the scripted
 * assistant (fixture `imagegen`, made from the recorded Claude replies of journey h) standing in
 * for Claude and the test image provider handing out the pictures in PAVE_FAKE_IMAGES (the four
 * live OpenAI images of that journey).
 *
 * A pendant's board with two pictures (a trophy, a pendant): the request with both as references,
 * Claude's enhanced prompt, four checked images, a refused request (a real person's likeness), a
 * generated image taken to CAD, and Settings, AI with the image providers. `nokey` mode instead
 * shows the board's calm no-key line and the key forms. Saves screenshots and a report.
 *
 *   pnpm --filter @pave/studio build
 *   PORT=8799 PAVE_DATA_DIR=$(mktemp -d) PAVE_ASSISTANT=scripted:imagegen PAVE_IMAGE_GEN=fake \
 *     PAVE_FAKE_IMAGES=<dir> PAVE_RENDER_NONE=1 tsx apps/server/src/main.ts
 *   tsx apps/studio/e2e/imagegen.ts http://127.0.0.1:8799 <outDir> <refsDir> light 1440 [full|nokey]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const [BASE, OUT, REFS, THEME = 'light', WIDTH = '1440', MODE = 'full'] = process.argv.slice(2)
const width = Number(WIDTH)
const mobile = width < 600
const height = mobile ? 844 : 900
const tag = `${MODE === 'nokey' ? 'nokey-' : ''}${THEME}-${WIDTH}`
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const ctx = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: 1,
  colorScheme: THEME,
})
await ctx.addInitScript(([t]) => localStorage.setItem('pave:theme', JSON.stringify(t)), [THEME])
const page = await ctx.newPage()
const errors: string[] = []
page.on('pageerror', (e) => {
  errors.push(e.message)
  console.error('pageerror:', e.message)
})
page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()))

const shot = async (name: string, opts: { full?: boolean } = {}) => {
  await page.waitForTimeout(700)
  if (mobile)
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('*')) if (el.scrollLeft) el.scrollLeft = 0
    })
  await page.screenshot({ path: `${OUT}/${name}.${tag}.png`, fullPage: !!opts.full })
  console.log('shot', name)
}
const rpc = async (name: string, input: unknown) => {
  const r = await page.request.post(`${BASE}/api/rpc/${name}`, { data: input })
  if (!r.ok()) throw new Error(`${name}: ${r.status()} ${await r.text()}`)
  return r.json()
}
const upload = async (file: string, name: string) => {
  const r = await page.request.post(`${BASE}/api/assets`, {
    multipart: {
      file: { name, mimeType: 'image/jpeg', buffer: (await import('node:fs')).readFileSync(file) },
    },
  })
  return r.json()
}
const panel = () => page.getByRole('region', { name: 'Generate concepts' })
const board = () => page.getByRole('region', { name: 'Design board' })
/** Scrolls the page's own scroller (#main) so `el` sits near the top. */
const reveal = async (locator) => {
  // Below the sticky header and tab row, which would otherwise cover the top of it.
  await locator.evaluate((el) => {
    el.scrollIntoView({ block: 'start' })
    document.querySelector('#main')?.scrollBy(0, -130)
  })
  await page.waitForTimeout(300)
}
const collapseAssistant = async () => {
  const collapse = page.getByRole('button', { name: 'Collapse to a pill' })
  if (await collapse.isVisible().catch(() => false)) await collapse.click().catch(() => {})
}
const report: Record<string, unknown> = { tag }

try {
  await page.goto(`${BASE}/`)
  await page.waitForLoadState('networkidle')
  const piece = await rpc('pieces.create', {
    kind: 'pendant',
    title: 'Trophy pendant',
    brief: 'A pendant made from a trophy, for a team captain.',
  })
  const designBoard = await rpc('boards.forPiece', { pieceId: piece.id })
  const trophy = await upload(join(REFS, 'trophy.jpg'), 'trophy.jpg')
  const pendant = await upload(join(REFS, 'pendant.jpg'), 'pendant.jpg')
  await rpc('references.save', {
    boardId: designBoard.id,
    items: [
      { assetId: trophy.id, title: 'The trophy' },
      { assetId: pendant.id, title: 'A pendant I like' },
    ],
  })
  report.pieceId = piece.id

  await page.goto(`${BASE}/pieces/${piece.id}/directions`)
  await board().waitFor({ timeout: 60_000 })
  await board().getByRole('button', { name: 'Generate concepts' }).click()
  await panel().waitFor()

  if (MODE === 'nokey') {
    await page.locator('[data-no-image-key]').waitFor()
    await reveal(panel())
    await shot('01-no-image-key')
    await page.goto(`${BASE}/settings/ai`)
    await page.locator('[data-image-provider="openai"]').waitFor({ timeout: 30_000 })
    await reveal(page.getByRole('heading', { name: 'Image generation' }))
    await shot('02-settings-keys')
    report.ok = true
  } else {
    // 1. The request, with both board pictures as references (trophy = subject, pendant = style).
    await panel().getByRole('button', { name: 'Use The trophy' }).click()
    await panel().getByRole('button', { name: 'Use A pendant I like' }).click()
    await panel()
      .getByRole('textbox', { name: 'What do you want?' })
      .fill('This trophy as a pendant, in the style of this pendant.')
    await reveal(panel())
    await shot('01-request-with-references')

    // 2. Claude's brief: understood, allowed, and the enhanced prompt shown before paying.
    await panel().getByRole('button', { name: 'Write the prompt' }).click()
    await panel().locator('[data-brief="allow"]').waitFor({ timeout: 60_000 })
    report.prompt = await panel().getByRole('textbox', { name: 'Enhanced prompt' }).inputValue()
    await reveal(panel())
    await shot('02-enhanced-prompt')

    // 3. Four images, each checked before it was kept.
    await panel()
      .getByRole('button', { name: /^Generate 4/ })
      .click()
    await panel().locator('[data-generated]').nth(3).waitFor({ timeout: 120_000 })
    report.generated = await panel().locator('[data-generated]').count()
    report.cost = await panel().locator('[data-generation-cost]').innerText()
    await reveal(panel().getByRole('region', { name: 'Generated images' }))
    await shot('03-four-generations')
    await reveal(board().locator('[data-board-item="generated"]').first())
    await shot('03b-board-with-generations')

    // 4. A refused request: a real person's likeness.
    await reveal(panel())
    await panel().getByRole('button', { name: 'Use The trophy' }).click()
    await panel()
      .getByRole('textbox', { name: 'What do you want?' })
      .fill(
        'A pendant with a portrait of Taylor Swift engraved in the centre, like the pendant on the board.',
      )
    await panel().getByRole('button', { name: 'Write it again' }).click()
    await panel().locator('[data-brief-refused]').waitFor({ timeout: 60_000 })
    report.refusal = await panel().locator('[data-brief-refused]').innerText()
    await reveal(panel())
    await shot('04-refusal')

    // 5. A generated image taken to CAD: pinned beside CAD, the CAD job starts from it.
    await panel().getByRole('button', { name: 'Close' }).click()
    const tile = board().locator('[data-board-item="generated"]').first()
    await reveal(tile)
    await tile.locator('button[aria-pressed]').first().click()
    const bar = page.getByRole('region', { name: 'Selected item' })
    await bar.getByRole('button', { name: 'Take to CAD' }).click()
    await page.waitForURL(/\/pieces\/[^/]+\/design/, { timeout: 60_000 })
    await page.waitForTimeout(4000)
    // Fold the job's plan and open the reference window, where the picture is pinned.
    if (mobile) await collapseAssistant()
    const hide = page.getByRole('button', { name: 'Hide the job’s plan' })
    if (await hide.isVisible().catch(() => false)) await hide.click().catch(() => {})
    const refs = page.getByRole('button', { name: /^Show references/ }).first()
    if (await refs.isVisible().catch(() => false)) {
      if ((await refs.getAttribute('aria-pressed')) !== 'true') await refs.click().catch(() => {})
    }
    await page.waitForTimeout(1500)
    const pins = await rpc('references.pins', { pieceId: piece.id })
    report.pinned = pins.references.filter((r) => r.type === 'generated').length
    await shot('05-taken-to-cad')

    // 6. Settings, AI: the image providers beside the Claude key.
    await page.goto(`${BASE}/settings/ai`)
    await page.locator('[data-image-provider="openai"]').waitFor({ timeout: 30_000 })
    await reveal(page.getByRole('heading', { name: 'Image generation' }))
    await shot('06-settings-image-providers')
    report.ok = true
  }
} catch (e) {
  report.error = String(e)
  console.error(e)
  await page.screenshot({ path: `${OUT}/error.${tag}.png` }).catch(() => {})
} finally {
  report.errors = errors
  writeFileSync(`${OUT}/report.${tag}.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
