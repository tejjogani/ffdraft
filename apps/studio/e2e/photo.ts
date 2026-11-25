// @ts-nocheck — a driver script, run with tsx; not part of the app's type graph.
/**
 * Photo to design in the studio, end to end against the real server, with the scripted
 * assistant standing in for Claude (no key, no network): a photo is attached in the dock, the
 * assistant reads it (a scripted structured read), builds the piece through the canon, opens it,
 * fits it to the photo's outline in a kernel worker (real), looks at it through this window's
 * viewport (real client-tool round trip), makes a targeted edit and reports. Saves screenshots.
 *
 *   pnpm --filter @pave/studio build
 *   PORT=8798 PAVE_DATA_DIR=$(mktemp -d) PAVE_ASSISTANT=scripted:photo-to-ring tsx apps/server/src/main.ts
 *   tsx apps/studio/e2e/photo.ts http://127.0.0.1:8798 <outDir> <photo.jpg> light 1440
 */
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const [BASE, OUT, PHOTO, THEME = 'light', WIDTH = '1440'] = process.argv.slice(2)
const width = Number(WIDTH)
const tag = `${THEME}-${WIDTH}`
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const ctx = await browser.newContext({
  viewport: { width, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: THEME,
})
await ctx.addInitScript((t) => localStorage.setItem('pave:theme', JSON.stringify(t)), THEME)
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
const openDock = async () => {
  await page.locator('#main').waitFor()
  for (let i = 0; i < 3 && !(await dock().isVisible()); i++) {
    await page.keyboard.press('Control+j')
    await dock()
      .waitFor({ timeout: 3000 })
      .catch(() => {})
  }
  await dock().waitFor()
}

try {
  await page.goto(`${BASE}/`)
  await openDock()
  await dock().locator('input[type="file"]').setInputFiles(PHOTO)
  await dock().getByRole('list', { name: 'Attached photos' }).locator('img').waitFor()
  await composer().fill('Make this ring in Pavé')
  await shot('01-photo-attached')
  await composer().press('Enter')

  await dock().getByText('Let me read the photo first').waitFor({ timeout: 30_000 })
  await page.waitForTimeout(600)
  await shot('02-reading-the-photo')

  // The assistant builds the piece and opens it in this window (ui.navigate).
  await page.waitForURL(/\/pieces\/[^/]+\/design$/, { timeout: 60_000 })
  await page.locator('[data-region="viewport"] canvas').first().waitFor({ timeout: 60_000 })
  await dock().getByText('Fitting the design to the photo').first().waitFor({ timeout: 30_000 })
  await page.waitForTimeout(2500)
  await shot('03-built-and-fitting')

  await dock().getByText('Done. It now matches', { exact: false }).waitFor({ timeout: 180_000 })
  await page.waitForTimeout(2500)
  await shot('04-report')

  // What happened, from the run's trace: the fit and the two looks (through this window).
  const pieceId = page.url().match(/\/pieces\/([^/]+)\//)[1]
  const runs = await rpc('traces.runs', { limit: 5 })
  const detail = await rpc('traces.run', { id: runs[0].id })
  const step = (name: string) => detail.steps.filter((s) => s.name === name)
  const fit = step('match.fit')[0]?.output?.value
  const captures = step('viewport.capture').map((s) => s.output?.value)
  const read = step('references.read')[0]?.output?.value
  const piece = await rpc('pieces.get', { id: pieceId })
  console.log(
    JSON.stringify(
      {
        status: detail.run.status,
        tier: detail.run.tier,
        model: detail.run.model,
        read: read && {
          archetype: read.read.archetype,
          cutout: read.cutout,
          assumed: read.assumed,
        },
        fit: fit && {
          quality: fit.quality,
          overlap: fit.overlap,
          params: fit.params,
          seconds: fit.seconds,
          stopped: fit.stopped,
        },
        captures: captures.map(
          (c) => c && { source: c.source, version: c.version, images: c.images.length },
        ),
        prongCount: piece.design.nodes.head?.prongCount,
        band: {
          top: piece.design.nodes.band?.widthTop,
          bottom: piece.design.nodes.band?.widthBottom,
        },
        errors: detail.steps.filter((s) => s.isError).map((s) => [s.name, s.output]),
      },
      null,
      2,
    ),
  )
  if (detail.run.status !== 'done') throw new Error(`run ended ${detail.run.status}`)
  if (captures.some((c) => c?.source !== 'studio'))
    throw new Error('a capture was not drawn by the window')

  // The photo beside the window's last capture from the same angle, as the model compared them.
  const photoAsset = piece.origin?.sourceAssetIds?.[0]
  const last = captures.at(-1)
  const side = await ctx.newPage()
  await side.setViewportSize({ width: 1440, height: 760 })
  await side.goto(`${BASE}/`)
  await side.setContent(`<!doctype html><html><body style="margin:0;background:#fff;font:14px system-ui;display:flex;gap:24px;padding:24px">
    <figure style="margin:0"><img src="${BASE}/api/assets/${photoAsset}" style="width:680px;height:680px;object-fit:contain;border:1px solid #ddd"><figcaption>The photo</figcaption></figure>
    <figure style="margin:0"><img src="${BASE}/api/assets/${last.images[0].assetId}" style="width:680px;height:680px;object-fit:contain;border:1px solid #ddd"><figcaption>Capture after the fit and the edit (three-quarter, clay, version ${last.version})</figcaption></figure>
  </body></html>`)
  await side.waitForLoadState('networkidle')
  await side.screenshot({ path: `${OUT}/05-photo-vs-capture.${tag}.png` })
  console.log('shot', '05-photo-vs-capture')
  await side.close()

  // The CAD job can start from a photo too: its plan, with the photo attached.
  await dock().getByRole('button', { name: 'Close assistant' }).click()
  await page.getByRole('button', { name: 'Make the CAD with AI' }).click()
  await page.getByText('You can pause, take over or stop it').waitFor()
  await page.locator('input[aria-label="Photo of a piece to rebuild"]').setInputFiles(PHOTO)
  await page.getByRole('img', { name: /To rebuild/ }).waitFor({ timeout: 30_000 })
  await page.waitForTimeout(500)
  await shot('06-cad-job-from-a-photo')
} catch (e) {
  console.error('FAILED:', e.message)
  await page.screenshot({ path: `${OUT}/zz-failure.${tag}.png` })
  process.exitCode = 1
} finally {
  await browser.close()
}
