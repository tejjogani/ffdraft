// @ts-nocheck — a driver script, run with tsx; not part of the app's type graph.
/**
 * Framing a shot by hand, end to end against the real server, kernel and (when set up) Blender:
 * "Render this view" from the CAD workspace, the viewfinder (orbit, pan, closer, roll, the
 * frame-safe overlay and grid), Undo and Redo, the camera lock, a Blender take of the framed
 * view whose silhouette is compared with the viewfinder's own pixels, a repeat render compared
 * byte for byte, and a house shot reused on another piece. Saves screenshots and prints the
 * measurements.
 *
 *   pnpm --filter @pave/studio build
 *   PORT=8799 PAVE_DATA_DIR=$(mktemp -d) PAVE_PLAN=pro PAVE_PYTHON=<bpy python> \
 *     tsx apps/server/src/main.ts
 *   tsx apps/studio/e2e/framing.ts http://127.0.0.1:8799 <outDir> light 1440 [full|look]
 *
 * `look` only takes the screenshots (no Blender takes), for the other themes and widths.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { RenderJob } from '@pave/schema'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright') as typeof import('playwright')
// sharp is the server's; it decodes and resamples the two pictures for the comparison.
const sharp = createRequire(new URL('../../server/package.json', import.meta.url))('sharp')
const [BASE, OUT, THEME = 'light', WIDTH = '1440', MODE = 'full'] = process.argv.slice(2)
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
const page = await ctx.newPage()
page.on('pageerror', (e) => console.error('pageerror:', e.message))
page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()))

const shot = async (name: string) => {
  await page.waitForTimeout(500)
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
const until = async (what: string, test: () => Promise<boolean>, ms = 600_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await test()) return
    await page.waitForTimeout(1000)
  }
  throw new Error(`timed out waiting for ${what}`)
}
const viewfinder = () => page.locator('canvas[aria-label^="Live preview"]')
const settle = () => page.waitForTimeout(2500)
const shotsOf = async (pieceId: string) => rpc('scenes.list', { pieceId })

/** A drag across the viewfinder, with modifier keys held. */
async function dragBy(dx: number, dy: number, keys: string[] = [], button = 'left') {
  const box = await viewfinder().boundingBox()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  for (const k of keys) await page.keyboard.down(k)
  await page.mouse.move(x, y)
  await page.mouse.down({ button })
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y + (dy * i) / 8)
  await page.mouse.up({ button })
  for (const k of keys) await page.keyboard.up(k)
}

/** The piece's coverage (alpha ≥ 50 %) in a PNG, resampled to `n`×`n`. */
async function coverage(png: Buffer, n = 256): Promise<Uint8Array> {
  const alpha = await sharp(png)
    .ensureAlpha()
    .extractChannel('alpha')
    .resize(n, n, { fit: 'fill', kernel: 'cubic' })
    .raw()
    .toBuffer()
  return Uint8Array.from(alpha, (a) => (a >= 128 ? 1 : 0))
}
const iou = (a: Uint8Array, b: Uint8Array) => {
  let both = 0
  let either = 0
  for (let i = 0; i < a.length; i++) {
    both += a[i] & b[i]
    either += a[i] | b[i]
  }
  return either ? both / either : 1
}

const report: Record<string, unknown> = {}
try {
  await page.goto(`${BASE}/`)
  await page.locator('#main').waitFor()
  const piece = await rpc('pieces.create', { templateId: 'solitaire', title: 'Solitaire, 1 ct' })

  // ── 1. Render this view, from the CAD workspace ──────────────────────────────────────────
  await page.goto(`${BASE}/pieces/${piece.id}/design`)
  const cad = page.locator('[data-region="viewport"]')
  await cad.waitFor()
  await page.waitForTimeout(5000)
  // Turn the CAD view a little, so the copied camera is not a preset.
  await cad.locator('[role="application"]').first().focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(1500)
  await shot('01-cad-view')
  if (mobile) {
    // A narrow view keeps it in the Views menu.
    await page.getByRole('button', { name: 'Views' }).click()
    await page.getByRole('menuitem', { name: 'Render this view' }).click()
  } else await page.getByRole('button', { name: 'Render this view' }).click()
  await page.waitForURL(/\/render$/)
  await viewfinder().waitFor()
  await settle()
  await settle()
  const fromCad = (await shotsOf(piece.id)).find((s) => s.title === 'CAD view')
  report.cadView = fromCad?.scene.camera
  await shot('02-render-this-view')

  // ── 2. Frame it by hand ──────────────────────────────────────────────────────────────────
  await dragBy(-60, 25) // orbit
  await settle()
  await dragBy(20, -12, ['Shift']) // pan
  await settle()
  const box = await viewfinder().boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -120) // closer
  await page.waitForTimeout(1200)
  await dragBy(40, 0, ['Alt']) // roll
  await settle()
  await page.getByRole('button', { name: 'Rule-of-thirds grid' }).click()
  await settle()
  const framed = (await shotsOf(piece.id)).find((s) => s.id === fromCad.id)
  report.framed = framed.scene.camera
  const history = await rpc('scenes.history', { id: fromCad.id })
  report.changes = history.length
  await shot('03-viewfinder-overlay')

  // ── 3. Undo, redo ────────────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Undo the last shot change' }).click()
  await settle()
  report.afterUndoRoll = (await shotsOf(piece.id)).find(
    (s) => s.id === fromCad.id,
  ).scene.camera.roll
  await shot('04-after-undo')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await settle()
  report.afterRedoRoll = (await shotsOf(piece.id)).find(
    (s) => s.id === fromCad.id,
  ).scene.camera.roll

  // ── 4. Lock ──────────────────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Lock camera' }).click()
  await settle()
  await dragBy(80, 0)
  await page.waitForTimeout(300)
  await shot('05-locked')
  report.lockedStill =
    JSON.stringify(
      (await shotsOf(piece.id)).find((s) => s.id === fromCad.id).scene.camera.position,
    ) === JSON.stringify(framed.scene.camera.position) || 'moved'
  await page.getByRole('button', { name: 'Unlock camera' }).click()
  await settle()

  // Saved as a house shot as framed, before the comparison below changes its backdrop.
  await page.getByRole('button', { name: 'Add shot' }).click()
  await page.getByRole('menuitem', { name: /as a house shot/ }).click()
  await page.waitForTimeout(1200)

  if (MODE === 'full') {
    // ── 5. A Blender take of exactly this view, compared with the viewfinder ──────────────
    // Transparent backdrop and no ground, so both pictures' alpha is the piece's silhouette.
    await rpc('scenes.update', {
      id: fromCad.id,
      patch: {
        environment: { background: 'transparent' },
        ground: 'none',
        output: { width: 640, height: 640, quality: 'preview' },
      },
    })
    await page.reload()
    await viewfinder().waitFor()
    await page.getByRole('navigation', { name: 'Shots' }).getByText('CAD view').click()
    await settle()
    await settle()
    const dataUrl = await viewfinder().evaluate((c: HTMLCanvasElement) => c.toDataURL('image/png'))
    const preview = Buffer.from(dataUrl.split(',')[1], 'base64')
    writeFileSync(`${OUT}/viewfinder-canvas.png`, preview)
    // The viewfinder's own fingerprint (the take tiles show theirs too).
    const liveHash = await page.locator('[data-scene-hash]').getAttribute('data-scene-hash')

    await page.getByRole('button', { name: 'Render', exact: true }).click()
    let take: RenderJob | undefined
    await until('the take', async () => {
      const list = await rpc('renders.list', { pieceId: piece.id })
      take = list.find((t) => t.sceneId === fromCad.id)
      return take && ['done', 'failed', 'canceled'].includes(take.status)
    })
    if (take.status !== 'done') throw new Error(`take ${take.status}: ${take.error}`)
    const png = Buffer.from(
      await (await page.request.get(`${BASE}/api/assets/${take.assetIds[0]}`)).body(),
    )
    writeFileSync(`${OUT}/blender-take.png`, png)
    report.take = { seconds: take.seconds, device: take.device, sceneHash: take.sceneHash }
    report.liveHash = liveHash
    report.hashesMatch = liveHash === take.sceneHash
    report.silhouetteIoU = iou(await coverage(preview), await coverage(png))
    await settle()
    await shot('06-take-matches-view')

    // ── 6. The same scene again: identical pixels? ─────────────────────────────────────────
    await rpc('renders.create', {
      pieceId: piece.id,
      sceneId: fromCad.id,
      retryOf: take.id,
      note: 'Repeat, to compare',
    })
    let again: RenderJob | undefined
    await until('the repeat take', async () => {
      const list = await rpc('renders.list', { pieceId: piece.id })
      again = list.find((t) => t.retryOf === take.id)
      return again && ['done', 'failed', 'canceled'].includes(again.status)
    })
    const png2 = Buffer.from(
      await (await page.request.get(`${BASE}/api/assets/${again.assetIds[0]}`)).body(),
    )
    const [a, b] = await Promise.all([sharp(png).raw().toBuffer(), sharp(png2).raw().toBuffer()])
    let differing = 0
    let worst = 0
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - b[i])
      if (d) differing++
      worst = Math.max(worst, d)
    }
    report.repeat = {
      sameHash: again.sceneHash === take.sceneHash,
      identicalFile: png.equals(png2),
      differingChannels: differing,
      worstChannelDelta: worst,
      seconds: again.seconds,
    }
  }

  // ── 7. The house shot, reused on another piece ───────────────────────────────────────────
  const halo = await rpc('pieces.create', { templateId: 'halo', title: 'Halo, cushion' })
  await page.goto(`${BASE}/pieces/${halo.id}/render`)
  await viewfinder().waitFor()
  await settle()
  await page.getByRole('button', { name: 'Add shot' }).click()
  await page.waitForTimeout(400)
  await shot('07-house-shots-menu')
  await page.getByRole('menuitem', { name: 'CAD view' }).click()
  await settle()
  await settle()
  report.houseOnHalo = (await shotsOf(halo.id)).map((s) => s.title)
  await shot('08-house-shot-on-halo')
  console.log(JSON.stringify(report, null, 2))
  writeFileSync(`${OUT}/report.${tag}.json`, JSON.stringify(report, null, 2))
} catch (e) {
  console.error(e)
  console.log(JSON.stringify(report, null, 2))
  await page.screenshot({ path: `${OUT}/error.${tag}.png` }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
