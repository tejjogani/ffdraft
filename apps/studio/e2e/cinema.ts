// @ts-nocheck — a driver script, run with tsx; not part of the app's type graph.
/**
 * The AI cinematographer end to end against the real server, kernel and Blender, with the
 * scripted assistant (fixture `cinema`) standing in for Claude: the Render job starts, looks at
 * the ring, asks its quick questions with defaults picked (one Go answers), places every camera
 * from the server's measured suggestions, checks the framing through each camera and fixes the
 * one that cuts the ring off, then renders three stills and a 24-frame turntable that plays in
 * the filmstrip. The viewfinder scrubs the motion; the Motion control shows its settings. A
 * person then stars a take, sets the cover and moves a camera, and the run's feedback is read
 * back. Saves screenshots, the takes and a report.
 *
 *   pnpm --filter @pave/studio build
 *   PORT=8799 PAVE_DATA_DIR=$(mktemp -d) PAVE_ASSISTANT=scripted:cinema PAVE_PLAN=pro \
 *     PAVE_PYTHON=<bpy venv python> tsx apps/server/src/main.ts
 *   tsx apps/studio/e2e/cinema.ts http://127.0.0.1:8799 <outDir> light 1440
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
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
const dock = () => page.locator('aside[aria-label="Assistant"]')
const takes = () => page.getByRole('region', { name: 'Takes' })
const shotsNav = () => page.getByRole('navigation', { name: 'Shots' })
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
const foldPlan = async () => {
  const hide = page.getByRole('button', { name: 'Hide the job’s plan' })
  if (await hide.isVisible().catch(() => false)) await hide.click()
}
const until = async (what: string, test: () => Promise<boolean>, ms = 900_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await test()) return
    await page.waitForTimeout(1000)
  }
  throw new Error(`timed out waiting for ${what}`)
}
const allTakes = (pieceId: string) => rpc('renders.list', { pieceId, limit: 200 })

const report: Record<string, unknown> = {}
try {
  await page.goto(`${BASE}/`)
  await page.locator('#main').waitFor()
  const piece = await rpc('pieces.create', { templateId: 'solitaire', title: 'Solitaire, 1 ct' })
  await page.goto(`${BASE}/pieces/${piece.id}/render`)
  await shotsNav().waitFor()
  await page.waitForTimeout(3000)

  // The job: what it will do first, then Start.
  await page.getByRole('button', { name: 'Render with AI' }).click()
  await page.getByRole('button', { name: 'Start job' }).waitFor()
  await page.waitForTimeout(1200)
  await shot('01-job-start')
  await page.getByRole('button', { name: 'Start job' }).click()

  // It looks, then asks: quick replies with the defaults picked.
  await openDock()
  const questions = dock().getByRole('region', { name: 'Quick questions' })
  await questions.waitFor({ timeout: 120_000 })
  await page.waitForTimeout(800)
  await shot('02-questions')
  report.picked = await questions
    .locator('button[aria-pressed="true"]')
    .evaluateAll((b) => b.map((x) => x.textContent?.trim()))
  await questions.getByRole('button', { name: 'Go' }).click()

  // Cameras placed, framing checked, one fixed, then the takes start.
  await until('the takes to start', async () => (await allTakes(piece.id)).length >= 4, 240_000)
  await page.waitForTimeout(2500)
  // The framing check: the pictures through each camera, and the fix it made.
  const check = dock()
    .getByRole('button', { name: /Checked the framing of 4 shots/ })
    .first()
  await check.scrollIntoViewIfNeeded()
  await check.click()
  await page.waitForTimeout(1500)
  await check.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(800)
  await shot('03-dock-framing')
  await closeDock()
  await page.waitForTimeout(1200)
  await shot('04-job-panel')
  await foldPlan()

  // Real Blender: wait for the set, then the critique.
  await until('every take to finish', async () =>
    (await allTakes(piece.id)).every((t) => !['queued', 'running'].includes(t.status)),
  )
  await openDock()
  await dock().getByText('The set is in.').waitFor({ timeout: 120_000 })
  await page.waitForTimeout(2500)
  await shot('05-dock-done')
  await closeDock()
  await foldPlan()

  // The turntable plays in the filmstrip.
  await shotsNav()
    .getByRole('button', { name: /^Turntable/ })
    .click()
  await page.waitForTimeout(2500)
  const tile = takes().getByRole('article').first()
  const video = tile.locator('video')
  await video.waitFor({ timeout: 30_000 })
  await video.hover()
  await page.waitForTimeout(1500)
  report.filmstripVideo = await video.evaluate((v) => ({
    readyState: v.readyState,
    duration: v.duration,
    currentTime: v.currentTime,
    paused: v.paused,
    width: v.videoWidth,
    height: v.videoHeight,
    loop: v.loop,
  }))
  await shot('06-animation-take')
  // Large, with controls.
  await tile.getByRole('button', { name: /^Show / }).click()
  await page.waitForTimeout(2000)
  const large = page.locator('figure video')
  report.largeVideo = await large.evaluate((v) => ({
    controls: v.controls,
    paused: v.paused,
    currentTime: v.currentTime,
    duration: v.duration,
  }))
  await shot('07-animation-large')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)

  // The viewfinder scrubs the motion before any render; the Motion control shows it.
  await shotsNav()
    .getByRole('button', { name: /^Turntable/ })
    .click()
  await page.waitForTimeout(800)
  const close = page.getByRole('button', { name: /Back to the viewfinder|Close/ }).first()
  if (await close.isVisible().catch(() => false)) await close.click()
  const scrub = page.getByRole('slider', { name: 'Motion frame' })
  await scrub.waitFor({ timeout: 60_000 })
  await scrub.fill('12')
  await page.waitForTimeout(1500)
  report.scrubbedTo = await scrub.inputValue()
  await shot('08-scrub')
  // The inspector's Motion section (on a phone the inspector sits below the picture).
  await page
    .getByRole('heading', { name: 'Motion', exact: true })
    .evaluate((el) => el.scrollIntoView({ block: 'start' }))
    .catch(() => {})
  await page.waitForTimeout(600)
  await shot('09-motion-control')

  // A person acts on what the assistant made: star the hero, make it the cover, move the
  // profile's camera.
  await shotsNav().getByRole('button', { name: /^Hero/ }).click()
  await page.waitForTimeout(1500)
  const heroTile = takes().getByRole('article').first()
  await heroTile.getByRole('button', { name: 'Star' }).click()
  await heroTile.getByRole('button', { name: 'Take options' }).click()
  await page.getByRole('menuitem', { name: 'Set as cover' }).click()
  await page.waitForTimeout(800)
  await shotsNav()
    .getByRole('button', { name: /^Profile/ })
    .click()
  await page.waitForTimeout(2500)
  await page.locator('[role="application"][data-scene-hash]').first().focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(2500)
  await shot('10-person-edits')

  // The run's feedback, as the traces keep it.
  const threads = await rpc('threads.list', {})
  const list0 = Array.isArray(threads) ? threads : threads.threads
  const thread = await rpc('threads.get', { id: list0[0].id })
  const trace = await rpc('traces.run', { id: thread.run.id })
  report.job = trace.run.job
  report.feedback = trace.feedback.map((f) => ({
    kind: f.kind,
    target: f.target,
    detail: f.detail,
  }))
  report.steps = trace.steps.map((s) => `${s.name}:${s.status}${s.isError ? ' (error)' : ''}`)

  const list = await allTakes(piece.id)
  report.takes = list.map((t) => ({
    title: t.title,
    status: t.status,
    engine: t.engine,
    seconds: t.seconds,
    device: t.device,
    animation: t.scene.animation ?? null,
    camera: t.scene.camera,
    assets: t.assetIds,
    actor: t.actor.type,
    starred: t.starred,
  }))
  // The takes themselves, to be looked at: stills, and the video, poster and GIF.
  for (const t of list.filter((x) => x.status === 'done')) {
    const name = t.title.replace(/\W+/g, '-')
    const ext = t.scene.animation ? ['mp4', 'png', 'gif'] : ['png']
    for (const [i, assetId] of t.assetIds.entries()) {
      const r = await page.request.get(`${BASE}/api/assets/${assetId}`)
      const file = `${OUT}/take-${name}-${i}.${tag}.${ext[i] ?? 'bin'}`
      writeFileSync(file, await r.body())
      if (ext[i] === 'mp4') {
        report.ffprobe = execFileSync('ffprobe', [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_name,width,height,nb_frames,r_frame_rate,pix_fmt',
          '-of',
          'json',
          file,
        ]).toString()
        execFileSync('ffmpeg', [
          '-v',
          'error',
          '-y',
          '-i',
          file,
          '-vf',
          'select=eq(n\\,12)',
          '-vframes',
          '1',
          `${OUT}/take-${name}-frame12.${tag}.png`,
        ])
      }
    }
  }
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
