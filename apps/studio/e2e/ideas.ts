// @ts-nocheck — a driver script, run with tsx; not part of the app's type graph.
/**
 * The Design stage as an image board, and projects and folders with their costs (step 17),
 * against the real server and kernel with the scripted assistant (fixture `ideas`) standing in
 * for Claude.
 *
 * A project in a sub-folder: its design board filled from every source (an upload
 * of a photo, a scanned sketch sheet and a 3D model, a pasted Pinterest link, a note, a sketch
 * drawn in the app), in Grid and Arrange by hand. The photo goes to CAD: the CAD job asks the five
 * specs with the picture's defaults, Go answers, the spec card shows the estimate, Build it builds,
 * and the picture lies in the front view as an image plane. The CAD reference window shows the
 * linked board; Try variants adds a variant in CAD; the model opens as CAD. Then the project page
 * with its three sections and costs, the folder with its sub-folder's totals, the sub-folder's
 * projects with stage progress and cost, and a studio moodboard with Start CAD. Saves screenshots
 * and a report.
 *
 *   pnpm --filter @pave/studio build
 *   PORT=8799 PAVE_DATA_DIR=$(mktemp -d) PAVE_ASSISTANT=scripted:ideas PAVE_PLAN=pro \
 *     PAVE_RENDER_NONE=1 tsx apps/server/src/main.ts
 *   tsx apps/studio/e2e/ideas.ts http://127.0.0.1:8799 <outDir> <photo.jpg> light 1440
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const [BASE, OUT, PHOTO, THEME = 'light', WIDTH = '1440'] = process.argv.slice(2)
const width = Number(WIDTH)
const mobile = width < 600
const height = mobile ? 844 : 900
const tag = `${THEME}-${WIDTH}`
mkdirSync(OUT, { recursive: true })
const FILES = join(OUT, `files-${tag}`)
mkdirSync(FILES, { recursive: true })

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const ctx = await browser.newContext({
  viewport: { width, height },
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
const errors: string[] = []
page.on('pageerror', (e) => {
  errors.push(e.message)
  console.error('pageerror:', e.message)
})
page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()))

const shot = async (name: string) => {
  await page.waitForTimeout(700)
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
const until = async (what: string, test: () => Promise<boolean>, ms = 180_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await test().catch(() => false)) return
    await page.waitForTimeout(500)
  }
  throw new Error(`timed out waiting for ${what}`)
}
const latestRun = async () => {
  const threads = await rpc('threads.list', {})
  return threads.length ? (await rpc('threads.get', { id: threads[0].id })).run : null
}
const chat = () =>
  page.locator('aside[aria-label="Assistant"], section[data-floating-window="Assistant"]')
const board = () => page.getByRole('region', { name: 'Design board' })
const items = () => board().locator('[data-board-item]')
const foldPlan = async () => {
  // On a phone the assistant covers the page while open; the plan is folded once it is closed.
  const hide = page.getByRole('button', { name: 'Hide the job’s plan' })
  if (await hide.isVisible().catch(() => false)) await hide.click({ timeout: 3000 }).catch(() => {})
}
const report: Record<string, unknown> = { tag }

try {
  await page.goto(`${BASE}/`)
  await page.waitForLoadState('networkidle')

  // A client folder holding a collection, and a project in it.
  const top = await rpc('collections.create', { name: 'Client: Rowe' })
  const sub = await rpc('collections.create', { name: 'Anniversary', parentId: top.id })
  const piece = await rpc('pieces.create', {
    title: 'Ring from the board',
    kind: 'ring',
    collectionId: sub.id,
    brief: 'A ring like the one in the photo, for a tenth anniversary.',
  })
  const other = await rpc('pieces.create', {
    title: 'Pendant, later',
    kind: 'pendant',
    collectionId: sub.id,
  })
  report.pieceId = piece.id

  // Files to bring in: a 3D model (an STL the kernel exports), a scanned sketch sheet.
  const halo = await rpc('pieces.create', { templateId: 'halo', title: 'model source' })
  const { asset: stl } = await rpc('design.export', {
    pieceId: halo.id,
    format: 'stl',
    stones: false,
  })
  const stlBytes = await (await page.request.get(`${BASE}${stl.url}`)).body()
  writeFileSync(join(FILES, 'halo-ring.stl'), stlBytes)
  await rpc('pieces.delete', { id: halo.id })
  await page.setContent(
    '<canvas id="c" width="900" height="640"></canvas><script>const c=document.getElementById("c").getContext("2d");c.fillStyle="#f4f1ea";c.fillRect(0,0,900,640);c.strokeStyle="#3a3630";c.lineWidth=3;for(const [x,y,r] of [[200,240,90],[470,250,70],[700,260,110]]){c.beginPath();c.arc(x,y,r,0,7);c.stroke();c.beginPath();c.arc(x,y-r-22,22,0,7);c.stroke()}c.font="28px serif";c.fillStyle="#3a3630";c.fillText("Anniversary ring — three ideas",40,560)</script>',
  )
  const sheet = await page.locator('#c').evaluate((el) => el.toDataURL('image/png'))
  writeFileSync(join(FILES, 'sketch-sheet.png'), Buffer.from(sheet.split(',')[1], 'base64'))

  // The first photo opens the native file picker and creates the board when it is saved.
  await page.goto(`${BASE}/pieces/${piece.id}/directions`)
  const upload = page.getByRole('button', { name: 'Add reference photo' })
  await upload.waitFor({ timeout: 60_000 })
  await shot('01-design-empty')
  const chosen = page.waitForEvent('filechooser')
  await upload.click()
  await (await chosen).setFiles(PHOTO)
  await until('first photo on the board', async () => (await items().count()) === 1)

  // Bring in a scanned sketch sheet and a 3D model.
  await board()
    .locator('input[aria-label="Pictures or 3D models to add"]')
    .setInputFiles([join(FILES, 'sketch-sheet.png'), join(FILES, 'halo-ring.stl')])
  await until('three uploads on the board', async () => (await items().count()) >= 3)
  // A pasted Pinterest link (view-only), a note, and a sketch drawn in the app.
  const addMenu = async (name: string) => {
    await board().getByRole('button', { name: /^Add/ }).click()
    await page.getByRole('menuitem', { name: new RegExp(`^${name}`) }).click()
  }
  await addMenu('Paste a link')
  await page
    .getByRole('textbox', { name: 'Paste a link' })
    .fill('https://www.pinterest.com/pin/1234567890/')
  await page.getByRole('button', { name: 'Add the link' }).click()
  await addMenu('Write a note')
  await page
    .getByRole('textbox', { name: 'Write a note' })
    .fill('Like the photo, but a little lower; six claws; she works with her hands.')
  await page.getByRole('button', { name: 'Add the note' }).click()
  await addMenu('Sketch')
  const pad = page.locator('canvas[data-sketch-pad]')
  await pad.waitFor()
  const box = await pad.boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx - box.width * 0.25, cy)
  await page.mouse.down()
  for (let a = 0; a <= 64; a++) {
    const t = (a / 64) * Math.PI * 2
    await page.mouse.move(cx + Math.cos(t) * box.width * 0.25, cy + Math.sin(t) * box.width * 0.25)
  }
  await page.mouse.up()
  await page.mouse.move(cx, cy - box.width * 0.25)
  await page.mouse.down()
  for (let a = 0; a <= 24; a++) {
    const t = (a / 24) * Math.PI * 2
    await page.mouse.move(
      cx + Math.cos(t) * box.width * 0.07,
      cy - box.width * 0.3 + Math.sin(t) * box.width * 0.07,
    )
  }
  await page.mouse.up()
  await page.getByRole('button', { name: 'Save to the board' }).click()
  await until('six items on the board', async () => (await items().count()) >= 6)
  await page.waitForTimeout(1500)
  report.boardItems = await items().evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-board-item')),
  )
  const boardRow = (await rpc('boards.list', { pieceId: piece.id }))[0]
  const saved = (await rpc('boards.get', { id: boardRow.id })).references
  report.rights = saved.map((r) => `${r.type}:${r.rights}`)
  await until(
    'the model viewer',
    async () => (await board().locator('[data-model-viewer="ready"]').count()) > 0,
    60_000,
  ).catch(() => {
    report.modelViewer = 'not ready'
  })
  await shot('02-design-board')
  await board().getByRole('button', { name: 'Arrange by hand', exact: true }).click()
  await page.waitForTimeout(1200)
  await shot('03-design-board-canvas')
  await board().getByRole('button', { name: 'Grid', exact: true }).click()

  // Take the photo to CAD: the CAD job asks the five specs first.
  const photoName = PHOTO.split('/')
    .pop()
    .replace(/\.[^.]+$/, '')
  await board()
    .getByRole('button', { name: `Select ${photoName}` })
    .click()
  await page
    .getByRole('region', { name: 'Selected item' })
    .getByRole('button', { name: 'Take to CAD' })
    .click()
  await page.waitForURL(/\/design$/, { timeout: 60_000 })
  const questions = chat().getByRole('region', { name: 'Quick questions' })
  await questions.waitFor({ timeout: 120_000 })
  await foldPlan()
  await shot('04-take-to-cad-questions')
  await questions.getByRole('button', { name: 'Go', exact: true }).click()

  // The estimate on the spec card, before anything is built.
  const estimate = chat().locator('[data-spec-estimate]')
  await estimate.waitFor({ timeout: 120_000 })
  await until('the estimate', async () => /g/.test((await estimate.textContent()) ?? ''), 120_000)
  report.estimate = await estimate.textContent()
  await estimate.scrollIntoViewIfNeeded()
  await shot('05-take-to-cad-estimate')
  await chat().getByRole('button', { name: 'Build it' }).click()
  await until('the CAD job to finish', async () => (await latestRun())?.status === 'done', 240_000)
  const run = await latestRun()
  report.run = {
    status: run.status,
    stage: run.stage,
    job: run.job?.plan.map((s) => `${s.id}:${s.state}`),
    costUsd: run.costUsd,
  }
  const pins = (await rpc('references.pins', { pieceId: piece.id })).references
  report.plane = pins.map((p) => p.plane)
  const after = await rpc('pieces.get', { id: piece.id })
  report.nodes = Object.keys(after.design.nodes).length

  // The CAD built from the picture, with the picture in the front view.
  await foldPlan()
  const collapse = chat().getByRole('button', { name: 'Collapse to a pill' }).first()
  if (await collapse.isVisible().catch(() => false)) await collapse.click()
  await foldPlan()
  await page.waitForTimeout(4000)
  await shot('06-cad-from-image')
  // The picture is scaled to the build, so the ring hides the ring in it. A click on the
  // picture beside the piece selects it: its frame and its toolbar show where it lies.
  const stage = await page.locator('[data-region="viewport"] canvas').first().boundingBox()
  await page.mouse.click(stage.x + stage.width * 0.12, stage.y + stage.height * 0.5)
  await page.waitForTimeout(800)
  report.planeToolbar = await page
    .getByRole('toolbar', { name: /Picture in the front view/ })
    .isVisible()
    .catch(() => false)
  const look = page.getByRole('button', { name: 'Look straight at the front view' })
  if (await look.isVisible().catch(() => false)) await look.click()
  await page.waitForTimeout(2500)
  await shot('06b-cad-from-image-plane')
  const xray = page.getByRole('button', { name: 'X-ray metal' }).first()
  if (
    await xray.click({ timeout: 5000 }).then(
      () => true,
      () => false,
    )
  ) {
    await page.waitForTimeout(2500)
    await shot('06c-cad-from-image-plane-xray')
    await xray.click({ timeout: 5000 }).catch(() => {})
  }
  await page.keyboard.press('Escape')

  // The CAD reference window shows the linked design board.
  await page.getByRole('button', { name: 'Show references' }).first().click()
  await page.getByRole('button', { name: 'This piece', exact: true }).first().click()
  await page.waitForTimeout(1500)
  await shot('07-cad-linked-board')
  await page.keyboard.press('Escape')
  const hide = page.getByRole('button', { name: 'Hide references' }).first()
  if (await hide.isVisible().catch(() => false)) await hide.click()

  // Try variants: off the main path, in CAD.
  await page.getByRole('button', { name: 'Try variants' }).first().click()
  const variants = page.getByRole('dialog', { name: 'Variants' })
  await variants.waitFor()
  await variants.getByRole('button', { name: /Add from a template/ }).click()
  await page.getByRole('menuitem').first().click()
  await until('a variant', async () => (await variants.locator('article').count()) > 0, 120_000)
  await page.waitForTimeout(1500)
  await shot('08-cad-try-variants')
  await page.keyboard.press('Escape')

  // A STEP export of the project (counted against the plan) and a render-free project page.
  await rpc('design.export', { pieceId: piece.id, format: 'step' })

  // The 3D model from the board opens as CAD in a project of its own... the board is linked, so
  // it joins this project's CAD as a sculpted body.
  await page.goto(`${BASE}/pieces/${piece.id}/directions`)
  await board().waitFor()
  await board()
    .getByRole('button', { name: /Actions for halo-ring/ })
    .click()
  await page.getByRole('menuitem', { name: 'Open as CAD' }).click()
  await page.waitForURL(/\/design$/, { timeout: 60_000 })
  await page.waitForTimeout(5000)
  await foldPlan()
  report.afterModel = Object.values((await rpc('pieces.get', { id: piece.id })).design.nodes)
    .filter((n) => n.kind === 'meshBody')
    .map((n) => n.name)
  await shot('09-open-model-as-cad')

  // The project page: three sections with what each holds and costs.
  await page.goto(`${BASE}/pieces/${piece.id}`)
  await page.locator('[data-stage-section="design"]').waitFor({ timeout: 60_000 })
  await page.locator('[data-stage-section="design"]').scrollIntoViewIfNeeded()
  report.project = (await rpc('projects.summary', { pieceIds: [piece.id] })).projects[0]
  await shot('10-project-sections')

  // The folders: the client folder with its sub-folder's totals, then the sub-folder's projects.
  await page.goto(`${BASE}/collections/${top.id}`)
  await page.getByRole('region', { name: 'Folders' }).waitFor({ timeout: 60_000 })
  report.folders = (await rpc('projects.summary', { collectionId: top.id })).folders.filter((f) =>
    [top.id, sub.id].includes(f.collectionId),
  )
  await shot('11-folder-with-totals')
  await page.goto(`${BASE}/collections/${sub.id}?view=table`)
  await page.locator('[data-stage-progress]').first().waitFor({ timeout: 60_000 })
  await shot('12-subfolder-projects')
  await page.goto(`${BASE}/collections/${sub.id}`)
  await page.locator('[data-project-cost]').first().waitFor({ timeout: 60_000 })
  await shot('12b-subfolder-gallery')

  // A studio moodboard with Start CAD.
  const loose = await rpc('boards.create', { title: 'Trophy pendant ideas' })
  await rpc('references.save', {
    boardId: loose.id,
    items: [{ note: 'The club’s trophy, on a pendant: about 30 mm, a plain bail.' }],
  })
  await page.goto(`${BASE}/moodboards`)
  await page.getByRole('list', { name: 'Moodboards' }).waitFor({ timeout: 60_000 })
  await shot('13-ideas')
  await page.goto(`${BASE}/moodboards/${loose.id}`)
  await board().waitFor()
  await page.getByRole('button', { name: 'Start CAD' }).click()
  await page.waitForTimeout(600)
  await shot('14-ideas-start-cad')
  await page.keyboard.press('Escape')
  report.other = other.id
} catch (e) {
  report.error = String(e?.stack ?? e)
  console.error(e)
  await page.screenshot({ path: `${OUT}/zz-failure.${tag}.png` }).catch(() => {})
} finally {
  report.pageErrors = errors
  writeFileSync(`${OUT}/report.${tag}.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
if (report.error) process.exit(1)
