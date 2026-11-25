// @ts-nocheck — a driver script, run with tsx; not part of the app's type graph.
/**
 * One flow, by hand or with the AI (step 11), against the real server and kernel with the
 * scripted assistant (fixture `flow`) standing in for Claude.
 *
 * By hand, no AI anywhere: an empty CAD, the reference window popped out as a floating glass
 * window, a sketch drawn on its Sketch tab, saved as a reference and laid in the front view as an
 * image plane, the piece modelled from a template by hand, an STL exported, and the Render tab's
 * viewfinder framing it.
 *
 * With the AI: the assistant docked, then floating; the CAD job asks its quick questions and
 * Go answers them; collapsed to a pill while the job runs; the answers in the job's plan; the
 * window dragged back into the sidebar; "update the design to this picture" from a pin, undone in
 * one step; a shot reference copied by the Render job, shown beside its framing capture. Every
 * window's place is checked again after a reload. Saves screenshots and a report.
 *
 *   pnpm --filter @pave/studio build
 *   PORT=8799 PAVE_DATA_DIR=$(mktemp -d) PAVE_ASSISTANT=scripted:flow PAVE_PLAN=pro \
 *     PAVE_RENDER_NONE=1 tsx apps/server/src/main.ts
 *   tsx apps/studio/e2e/flow.ts http://127.0.0.1:8799 <outDir> <fixtureDir> light 1440
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const [BASE, OUT, FIXTURE, THEME = 'light', WIDTH = '1440'] = process.argv.slice(2)
const width = Number(WIDTH)
const mobile = width < 600
const height = mobile ? 844 : 900
const tag = `${THEME}-${WIDTH}`
mkdirSync(OUT, { recursive: true })

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
// A headless browser cannot answer the native save dialog: stand in for a person who saves.
await ctx.addInitScript(`Object.defineProperty(window, 'showSaveFilePicker', {
  value: async () => ({ createWritable: async () => ({ write: async () => {}, close: async () => {} }) }),
})`)
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
const until = async (what: string, test: () => Promise<boolean>, ms = 180_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await test().catch(() => false)) return
    await page.waitForTimeout(500)
  }
  throw new Error(`timed out waiting for ${what}`)
}
const pinsOf = async (pieceId: string) => (await rpc('references.pins', { pieceId })).references
const latestRun = async () => {
  const threads = await rpc('threads.list', {})
  return threads.length ? (await rpc('threads.get', { id: threads[0].id })).run : null
}
const runSettled = async (status = 'done') => {
  const r = await latestRun()
  return r?.status === status
}

// The windows, in each of their forms.
const chatDocked = () => page.locator('aside[aria-label="Assistant"]')
const chatFloating = () => page.locator('section[data-floating-window="Assistant"]')
const chat = () =>
  page.locator('aside[aria-label="Assistant"], section[data-floating-window="Assistant"]')
const pill = () => page.locator('[data-assistant-pill]')
const refsDocked = () => page.locator('aside[aria-label="References"]')
const refsFloating = () => page.locator('section[data-floating-window="References"]')
const refsSheet = () => page.getByRole('dialog', { name: 'References' })
const refs = () => (mobile ? refsSheet() : refsFloating().or(refsDocked()))
const rectOf = (l) =>
  l.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    }
  })
/** Drags a floating window by its title bar. */
const dragTitle = async (win, dx: number, dy: number, toX?: number) => {
  const box = await win.getByRole('toolbar').first().boundingBox()
  const x = box.x + 24
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  const tx = toX ?? x + dx
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + ((tx - x) * i) / 8, y + (dy * i) / 8)
  await page.mouse.up()
}
const openRefs = async () => {
  if (
    await refs()
      .first()
      .isVisible()
      .catch(() => false)
  )
    return
  await page
    .getByRole('button', { name: /^Show references/ })
    .first()
    .click()
  await refs().first().waitFor()
}
const foldPlan = async () => {
  const hide = page.getByRole('button', { name: 'Hide the job’s plan' })
  if (await hide.isVisible().catch(() => false)) await hide.click()
}

const report: Record<string, unknown> = {}
try {
  await page.goto(`${BASE}/`)
  await page.locator('#main').waitFor()

  // ── By hand: an empty CAD, a sketch as an image plane, a template, STL, the viewfinder ────
  const hand = await rpc('pieces.create', { title: 'By hand', kind: 'ring' })
  await page.goto(`${BASE}/pieces/${hand.id}/design`)
  await page.locator('[data-region="viewport"]').waitFor()
  await page.waitForTimeout(3000)
  await openRefs()
  if (!mobile) {
    // Pulled out of the column: a floating glass window, moved by its title bar.
    await refsDocked().getByRole('button', { name: 'Pop out as a floating window' }).click()
    await refsFloating().waitFor()
    await dragTitle(refsFloating(), -40, 24)
    report.refsFloatingRect = await rectOf(refsFloating())
  }
  await shot('01-reference-window-references')

  await refs().getByRole('button', { name: 'Sketch', exact: true }).click()
  const pad = refs().locator('canvas[data-sketch-pad]')
  await pad.waitFor()
  const b = await pad.boundingBox()
  // A ring seen from the front, a head on top, and a crossed-out stroke erased.
  const cx = b.x + b.width / 2
  const cy = b.y + b.height * 0.58
  const r = b.width * 0.28
  await page.mouse.move(cx + r, cy)
  await page.mouse.down()
  for (let i = 1; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2
    await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a))
  }
  await page.mouse.up()
  await page.mouse.move(cx - r * 0.35, cy - r)
  await page.mouse.down()
  for (const [dx, dy] of [
    [-0.2, -1.5],
    [0.2, -1.5],
    [0.35, -1],
  ])
    await page.mouse.move(cx + r * dx, cy + r * dy, { steps: 6 })
  await page.mouse.up()
  await page.mouse.move(cx - r * 1.3, cy + r * 1.2)
  await page.mouse.down()
  await page.mouse.move(cx - r * 0.9, cy + r * 1.35, { steps: 6 })
  await page.mouse.up()
  // Undo the stray stroke.
  await refs().getByRole('button', { name: 'Undo stroke' }).click()
  await shot('02-reference-window-sketch')

  await refs().getByRole('button', { name: 'Save and lay in a view' }).click()
  await page.getByRole('menuitem', { name: 'Front view' }).click()
  await until('the sketch pinned and laid in the front view', async () =>
    (await pinsOf(hand.id)).some((p) => p.title === 'Sketch 1' && p.plane?.view === 'front'),
  )
  const sketchPin = (await pinsOf(hand.id)).find((p) => p.title === 'Sketch 1')
  report.sketch = { rights: sketchPin.rights, plane: sketchPin.plane, assetId: !!sketchPin.assetId }
  if (mobile) await page.keyboard.press('Escape')
  await page.waitForTimeout(1500)
  // Modelled by hand from a template, with the sketch behind it.
  // On a phone the sticky page header can sit over these: click them as a tap would land.
  await page.getByRole('button', { name: 'Browse templates' }).dispatchEvent('click')
  await page
    .getByRole('button', { name: /solitaire/i })
    .first()
    .dispatchEvent('click')
  await until('the piece built by hand', async () => {
    const p = await rpc('pieces.get', { id: hand.id })
    return p.design.order.length > 0
  })
  await page.waitForTimeout(5000)
  await shot('03-by-hand-sketch-plane-and-cad')

  // STL needs no AI and no allowance. The reference window is closed to get at the toolbar.
  if (!mobile) await refsFloating().getByRole('button', { name: 'Close references' }).click()
  await page
    .getByRole('button', { name: /^Export/ })
    .first()
    .click()
  const stl = page.getByRole('menuitem', { name: /STL/ }).first()
  await stl.waitFor()
  await stl.click()
  await page.waitForTimeout(4000)
  report.stlExported = true

  await page.goto(`${BASE}/pieces/${hand.id}/render`)
  await page.locator('[role="application"][data-scene-hash]').first().waitFor({ timeout: 120_000 })
  await page.waitForTimeout(4000)
  await shot('04-by-hand-viewfinder')
  report.manualAiCalls = (await rpc('threads.list', {})).length

  // ── With the AI ───────────────────────────────────────────────────────────────────────────
  const piece = await rpc('pieces.create', { templateId: 'solitaire', title: 'Solitaire, 1 ct' })
  await page.goto(`${BASE}/pieces/${piece.id}/design`)
  await page.locator('[data-region="viewport"]').waitFor()
  await page.waitForTimeout(3000)
  // Close the reference window so the CAD shows whole.
  if (
    !mobile &&
    (await refsFloating()
      .isVisible()
      .catch(() => false))
  )
    await refsFloating().getByRole('button', { name: 'Close references' }).click()

  await page.keyboard.press('Control+j')
  await chat().first().waitFor()
  await page.waitForTimeout(800)
  await shot('05-chat-docked')

  if (!mobile) {
    await chatDocked().getByRole('button', { name: 'Pop out as a floating window' }).click()
    await chatFloating().waitFor()
    await dragTitle(chatFloating(), -120, 10)
  }

  // The CAD job asks before acting. (On a phone the assistant fills the screen: fold it first.)
  if (mobile) await chat().getByRole('button', { name: 'Collapse to a pill' }).first().click()
  await page.getByRole('button', { name: 'Make the CAD with AI' }).first().click()
  await page.getByRole('button', { name: 'Start job' }).click()
  if (mobile)
    await pill()
      .getByRole('button', { name: /Open the assistant/ })
      .click()
  const questions = chat().getByRole('region', { name: 'Quick questions' })
  await questions.waitFor({ timeout: 120_000 })
  await page.waitForTimeout(800)
  await shot('06-chat-floating-questions')
  await questions.getByRole('button', { name: 'Go' }).click()

  // Folded to a pill while the job works: it shows the job and its step.
  await chat().getByRole('button', { name: 'Collapse to a pill' }).first().click()
  await pill().waitFor()
  await until('the pill to show the job working', async () =>
    /CAD job/.test((await pill().textContent()) ?? ''),
  )
  await page.waitForTimeout(2500)
  report.pillWhileRunning = await pill().textContent()
  await shot('07-chat-pill-running-job')

  await until('the CAD job to finish', () => runSettled('done'), 240_000)
  const cadRun = await latestRun()
  report.cadJobAnswers = cadRun.job.answers
  await page.waitForTimeout(2000)
  report.pillAfter = await pill().textContent()
  // The plan, with the answers under the step that asked.
  const showPlan = page.getByRole('button', { name: 'Show the job’s plan' })
  if (await showPlan.isVisible().catch(() => false)) await showPlan.click()
  await page.getByRole('list', { name: 'Plan' }).first().waitFor()
  await page.waitForTimeout(800)
  await shot('08-job-plan-with-answers')
  await foldPlan()

  // Open again from the pill; then drag it into the sidebar.
  await pill()
    .getByRole('button', { name: /Open the assistant/ })
    .click()
  await chat().first().waitFor()
  if (!mobile) {
    await dragTitle(chatFloating(), 0, 0, width - 4)
    await chatDocked().waitFor()
    report.snappedIntoSidebar = true
    // And out again, where it floated before.
    await chatDocked().getByRole('button', { name: 'Pop out as a floating window' }).click()
    await chatFloating().waitFor()
    report.chatFloatingRect = await rectOf(chatFloating())
  }

  // Update the design to a newly pinned picture: a CAD job, undone in one step.
  if (await chat().first().isVisible())
    await chat().getByRole('button', { name: 'Collapse to a pill' }).first().click()
  await openRefs()
  if (
    !mobile &&
    (await refsFloating()
      .isVisible()
      .catch(() => false))
  )
    await refsFloating().getByRole('button', { name: 'Dock beside the CAD' }).click()
  await refs().getByRole('button', { name: 'References', exact: true }).click()
  await refs()
    .getByRole('button', { name: /^Pinned/ })
    .first()
    .click()
  await refs()
    .locator('input[type="file"]')
    .first()
    .setInputFiles(join(FIXTURE, 'new-reference.jpg'))
  await until('the new reference pinned', async () => (await pinsOf(piece.id)).length === 1)
  await page.waitForTimeout(1200)
  await refs()
    .locator('article[aria-label="Pinned: new-reference.jpg"]')
    .getByRole('button', { name: /Actions for/ })
    .click()
  await page.getByRole('menuitem', { name: 'Update the design to this picture' }).click()
  await until(
    'the update job to finish',
    async () => {
      const r = await latestRun()
      return r?.job?.stage === 'cad' && r.status === 'done' && r.id !== cadRun.id
    },
    240_000,
  )
  const updateRun = await latestRun()
  const claws = async () => (await rpc('pieces.get', { id: piece.id })).design.nodes.head.prongCount
  report.clawsAfterUpdate = await claws()
  if (mobile) await page.keyboard.press('Escape')
  await page.waitForTimeout(800)
  if (
    await pill()
      .isVisible()
      .catch(() => false)
  )
    await pill()
      .getByRole('button', { name: /Open the assistant/ })
      .click()
  await chat().first().waitFor()
  // Moved over the viewport, so the docked reference window shows beside it.
  if (!mobile && (await chatFloating().isVisible())) await dragTitle(chatFloating(), -420, 0)
  await chat().getByText('Updated to the new reference').waitFor({ timeout: 60_000 })
  await page.waitForTimeout(3000)
  await shot('09-update-to-new-reference')
  await chat()
    .getByRole('button', { name: /Undo all/ })
    .first()
    .click()
  await until('the update undone', async () => (await claws()) === 4, 60_000)
  report.clawsAfterUndoAll = await claws()
  report.updateRun = { stage: updateRun.job.stage, review: updateRun.job.review }

  // A shot reference for the Render job, read into its camera and shown beside its framing.
  if (mobile && (await chat().first().isVisible()))
    await chat().getByRole('button', { name: 'Collapse to a pill' }).first().click()
  await refs()
    .first()
    .isVisible()
    .then(async (v) => {
      if (!v) await openRefs()
    })
  await refs()
    .locator('input[type="file"]')
    .first()
    .setInputFiles(join(FIXTURE, 'profile-reference.png'))
  await until('the shot reference pinned', async () => (await pinsOf(piece.id)).length === 2)
  if (mobile) await page.keyboard.press('Escape')
  if (await chat().first().isVisible())
    await chat().getByRole('button', { name: 'Collapse to a pill' }).first().click()
  await page.goto(`${BASE}/pieces/${piece.id}/render`)
  await page.locator('[role="application"][data-scene-hash]').first().waitFor({ timeout: 120_000 })
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Render with AI' }).first().click()
  await page.getByRole('button', { name: 'Shot reference: profile-reference.png' }).click()
  await page.waitForTimeout(500)
  await shot('10-render-job-shot-reference-picked')
  await page.getByRole('button', { name: 'Start job' }).click()
  await until(
    'the shot-reference job to finish',
    async () => {
      const r = await latestRun()
      return r?.job?.stage === 'render' && r.status === 'done'
    },
    240_000,
  )
  if (
    await pill()
      .isVisible()
      .catch(() => false)
  )
    await pill()
      .getByRole('button', { name: /Open the assistant/ })
      .click()
  const pair = chat().getByRole('region', { name: 'Shot references beside the framing' })
  await pair.waitFor({ timeout: 60_000 })
  await pair.scrollIntoViewIfNeeded()
  await page.waitForTimeout(2500)
  await shot('11-shot-reference-beside-framing')
  const shots = await rpc('scenes.list', { pieceId: piece.id })
  report.shotReferenceScene = shots.map((s) => ({ title: s.title, camera: s.scene.camera }))

  // Every window remembers where it was.
  const before = {
    chat: await page.evaluate(() => JSON.parse(localStorage.getItem('pave:assistant')).state),
    refs: await page.evaluate(() => JSON.parse(localStorage.getItem('pave:references')).state),
  }
  await page.reload()
  await page.locator('#main').waitFor()
  await page.waitForTimeout(2500)
  report.afterReload = {
    chatLayout: before.chat.layout,
    chatRect: before.chat.rect,
    chatVisible: await chat().first().isVisible(),
    chatRectNow: !mobile && before.chat.layout === 'floating' ? await rectOf(chatFloating()) : null,
    refsLayout: before.refs.layout,
    refsTab: before.refs.tab,
  }
  await shot('12-after-reload')
  writeFileSync(`${OUT}/report.${tag}.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} catch (e) {
  console.error('FAILED:', e.message)
  await page.screenshot({ path: `${OUT}/zz-failure.${tag}.png` })
  writeFileSync(`${OUT}/report.${tag}.json`, JSON.stringify(report, null, 2))
  process.exitCode = 1
} finally {
  await browser.close()
}
