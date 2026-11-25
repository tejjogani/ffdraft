// @ts-nocheck — a driver script, run with tsx; not part of the app's type graph.
/**
 * The Pavé file in the studio, against the real server and kernel: the CAD export menu (Pavé
 * file and STL free, Rhino and STEP with the month's allowance), saving a piece as .pave from
 * it, opening the file from the Pieces page, its provenance on the Overview, and dropping the
 * file on the window. Checks the allowance never moves. Saves screenshots and a report.
 *
 *   pnpm --filter @pave/studio build
 *   PORT=8799 PAVE_DATA_DIR=$(mktemp -d) PAVE_RENDER_NONE=1 tsx apps/server/src/main.ts
 *   tsx apps/studio/e2e/pavefile.ts http://127.0.0.1:8799 <outDir> light 1440
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const sharp = createRequire(import.meta.url)('sharp')
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
// A headless browser cannot answer the native save dialog: stand in for a person who saves,
// keeping the bytes so the driver can open the very file the studio saved.
// A string, not a function: tsx would wrap a function in helpers the page does not have.
await ctx.addInitScript(`Object.defineProperty(window, 'showSaveFilePicker', {
  value: async (opts) => ({
    createWritable: async () => ({
      write: async (blob) => {
        window.__saved = { name: opts.suggestedName, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) }
      },
      close: async () => {},
    }),
  }),
})`)
const page = await ctx.newPage()
page.on('pageerror', (e) => console.error('pageerror:', e.message))
page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()))
page.on('response', (r) => {
  const name = r
    .url()
    .match(/\/api\/rpc\/(pieces\.(saveFile|openFile)|plan\.\w+|design\.export)/)?.[1]
  if (name) console.log('rpc', name, r.status())
})

const shot = async (name: string, full = false) => {
  await page.waitForTimeout(600)
  if (mobile)
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('*')) if (el.scrollLeft) el.scrollLeft = 0
    })
  await page.screenshot({ path: `${OUT}/${name}.${tag}.png`, fullPage: full })
  console.log('shot', name)
}
const rpc = async (name: string, input: unknown) => {
  const r = await page.request.post(`${BASE}/api/rpc/${name}`, { data: input })
  if (!r.ok()) throw new Error(`${name}: ${r.status()} ${await r.text()}`)
  return r.json()
}
const exportsUsed = async () =>
  (await rpc('plan.get', {})).allowances.find((a) => a.allowance === 'export').used
const report: Record<string, unknown> = { tag }

try {
  await page.goto(`${BASE}/`)
  await page.locator('#main').waitFor()

  // A piece with some life in it: an edit, a pinned picture laid in the front view, a shot.
  const piece = await rpc('pieces.create', { templateId: 'halo', title: 'Cushion halo, rose gold' })
  const shank = Object.values(piece.design.nodes).find((n) => n.kind === 'ringShank')
  await rpc('design.apply', {
    pieceId: piece.id,
    label: 'Band 2.4 mm',
    ops: [{ t: 'update', id: shank.id, patch: { widthTop: 2.4 } }],
  })
  const png = await sharp({
    create: { width: 400, height: 300, channels: 3, background: '#b08d57' },
  })
    .png()
    .toBuffer()
  const up = await page.request.post(`${BASE}/api/assets`, {
    multipart: { file: { name: 'sketch.png', mimeType: 'image/png', buffer: png } },
  })
  const asset = await up.json()
  const [pin] = await rpc('references.pin', {
    pieceId: piece.id,
    items: [{ assetId: asset.id, title: 'Front sketch' }],
  })
  await rpc('references.place', {
    id: pin.id,
    plane: { view: 'front', center: [0, 0], width: 30, opacity: 0.5, locked: false },
  })
  await rpc('scenes.create', { pieceId: piece.id, title: 'Hero', scene: { look: 'catalog-white' } })
  // Part of the month used, so the menu shows what is left of the paid formats.
  for (let i = 0; i < 3; i++) {
    const { claimId } = await rpc('plan.claim', {
      pieceId: piece.id,
      format: 'step',
      key: `e2e-earlier-${Date.now()}-${i}`,
    })
    await rpc('plan.settle', { claimId, delivered: true })
  }
  report.exportsBefore = await exportsUsed()

  // The export menu: Pavé file first and free, STL free, Rhino and STEP with the allowance.
  await page.goto(`${BASE}/pieces/${piece.id}/design`)
  await page.locator('canvas').first().waitFor()
  await page.waitForTimeout(5000)
  const exportButton = page.getByRole('button', { name: /^Export/ }).first()
  await exportButton.click()
  const paveItem = page.getByRole('menuitem', { name: /Pavé file/ })
  await paveItem.waitFor()
  await page
    .getByRole('menuitem', { name: /STEP/ })
    .getByText(/2 of 5 free left this month/)
    .waitFor()
  await page
    .getByRole('menuitem', { name: /For casting/ })
    .getByText(/Free$/)
    .waitFor()
  await shot('01-export-menu')
  report.menu = await page.getByRole('menu').innerText()

  // Save it: the studio's own save goes through the (stubbed) save dialog.
  await paveItem.click()
  await page.getByText('Saved as a Pavé file').waitFor({ timeout: 150_000 })
  await shot('02-saved')
  const saved = await page.evaluate(() => window.__saved)
  const file = `${OUT}/${saved.name}`
  writeFileSync(file, Buffer.from(saved.bytes))
  report.savedName = saved.name
  report.savedBytes = saved.bytes.length
  report.savedStartsWithZip = saved.bytes[0] === 0x50 && saved.bytes[1] === 0x4b

  // Open it from the Pieces page.
  await page.goto(`${BASE}/pieces`)
  const openButton = page.getByRole('button', { name: 'Open Pavé file' })
  await openButton.waitFor()
  await shot('03-pieces-open')
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), openButton.click()])
  await chooser.setFiles(file)
  await page.waitForURL(/\/pieces\/pc_/, { timeout: 60_000 })
  await page.getByText(/^Opened “Cushion halo, rose gold”/).waitFor({ timeout: 60_000 })
  const openedId = page.url().match(/\/pieces\/(pc_[^/?#]+)/)[1]
  report.openedId = openedId
  await shot('04-opened-toast')
  const where = page.getByRole('region', { name: 'Where this piece came from' })
  await where.waitFor()
  await where.scrollIntoViewIfNeeded()
  await shot('05-provenance')
  report.provenanceText = await where.innerText()

  const [a, b] = await Promise.all([
    rpc('pieces.get', { id: piece.id }),
    rpc('pieces.get', { id: openedId }),
  ])
  report.sameDesign = JSON.stringify(a.design) === JSON.stringify(b.design)
  report.sameVersion = a.version === b.version
  const pins = await rpc('references.pins', { pieceId: openedId })
  report.planeKept =
    JSON.stringify(pins.references[0]?.plane) ===
    JSON.stringify((await rpc('references.pins', { pieceId: piece.id })).references[0].plane)
  report.history = (await rpc('design.history', { pieceId: openedId })).map((c) => c.label)

  // The opened piece's CAD shows the pinned picture in the front view, as it was.
  await page.goto(`${BASE}/pieces/${openedId}/design`)
  await page.locator('canvas').first().waitFor()
  await page.waitForTimeout(6000)
  await shot('06-opened-cad')

  // Drop the file on the window: it opens as another piece.
  const before = (await rpc('pieces.list', {})).length
  await page.goto(`${BASE}/pieces`)
  await openButton.waitFor()
  await page.evaluate(
    ({ bytes, name }) => {
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array(bytes)], name))
      const target = document.querySelector('#main') ?? document.body
      target.dispatchEvent(
        new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }),
      )
      target.dispatchEvent(
        new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }),
      )
    },
    { bytes: saved.bytes, name: saved.name },
  )
  await page.waitForURL((u) => /\/pieces\/pc_/.test(u.pathname) && !u.pathname.includes(openedId), {
    timeout: 60_000,
  })
  await page.getByText(/^Opened “Cushion halo, rose gold”/).waitFor({ timeout: 60_000 })
  await shot('07-dropped')
  report.piecesAddedByDrop = (await rpc('pieces.list', {})).length - before

  report.exportsAfter = await exportsUsed()
  if (report.exportsAfter !== report.exportsBefore)
    throw new Error(`the allowance moved: ${report.exportsBefore} → ${report.exportsAfter}`)
  if (!report.sameDesign || !report.sameVersion || !report.planeKept)
    throw new Error(`the reopened piece differs: ${JSON.stringify(report)}`)
  console.log('report', JSON.stringify(report, null, 1))
  writeFileSync(`${OUT}/report.${tag}.json`, JSON.stringify(report, null, 1))
} catch (e) {
  await page.screenshot({ path: `${OUT}/error.${tag}.png` }).catch(() => {})
  console.error(e)
  process.exitCode = 1
} finally {
  await browser.close()
}
