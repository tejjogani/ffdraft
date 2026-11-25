// @ts-nocheck — a driver script, run with tsx; not part of the app's type graph.
/**
 * The founder's journeys, with Claude in the loop: the real server and studio, pointed at the
 * fake Claude API in agent mode (packages/agent/src/testing/fake-api/cli.ts serve), so every
 * model turn is answered by Claude writing a reply file. This driver plays the designer: it
 * clicks, types, answers quick questions with Go, approves what a run asks, edits by hand mid-job,
 * and takes a screenshot at each stage. It waits as long as a turn takes (Claude is in the loop).
 *
 *   PORT=8811 PAVE_DATA_DIR=<dir> ANTHROPIC_BASE_URL=http://127.0.0.1:4801 PAVE_PLAN=pro \
 *     PAVE_PYTHON=<bpy venv python> tsx apps/server/src/main.ts
 *   tsx apps/studio/e2e/harness.ts http://127.0.0.1:8811 <outDir> <journey> [light|dark] [width]
 *
 * Journeys (each a separate run of this script; later ones use the pieces earlier ones made,
 * kept in <outDir>/state.json): f-key, a-directions, b-cad-job, c-chat-edit, d-photo, e-render,
 * g-tiers. Each writes <outDir>/<journey>.outcome.json: the design, its changes, takes, costs and
 * run events, read back through the API, which the replay tests compare against.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const [BASE, OUT, JOURNEY, THEME = 'light', WIDTH = '1440'] = process.argv.slice(2)
const width = Number(WIDTH)
const tag = `${THEME}-${WIDTH}`
const PHOTO = process.env.HARNESS_PHOTO
const LONG = 45 * 60_000
mkdirSync(OUT, { recursive: true })
const stateFile = `${OUT}/state.json`
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {}
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2))

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme: THEME })
await ctx.addInitScript((t) => localStorage.setItem('pave:theme', JSON.stringify(t)), THEME)
const page = await ctx.newPage()
page.on('pageerror', (e) => console.error('pageerror:', e.message))

let shotN = 0
const shot = async (name: string) => {
  await page.waitForTimeout(600)
  const file = `${OUT}/${JOURNEY}-${String(++shotN).padStart(2, '0')}-${name}.${tag}.png`
  await page.screenshot({ path: file })
  console.log('shot', file)
}
const rpc = async (name: string, input: unknown) => {
  const r = await page.request.post(`${BASE}/api/rpc/${name}`, { data: input })
  if (!r.ok()) throw new Error(`${name}: ${r.status()} ${await r.text()}`)
  return r.json()
}
const dock = () => page.locator('aside[aria-label="Assistant"]')
const composer = () => dock().getByRole('textbox', { name: 'Message the assistant' })
const openDock = async () => {
  for (let i = 0; i < 4 && !(await dock().isVisible()); i++) {
    await page.keyboard.press('Control+j')
    await dock().waitFor({ timeout: 3000 }).catch(() => {})
  }
  await dock().waitFor()
}
const closeDock = async () => {
  if (await dock().isVisible()) await dock().getByRole('button', { name: 'Close assistant' }).click()
}
const foldPlan = async () => {
  const hide = page.getByRole('button', { name: 'Hide the job’s plan' })
  if (await hide.isVisible().catch(() => false)) await hide.click()
}

/** Every run, newest first. */
const runs = async () => (await rpc('traces.runs', { limit: 50 })) as { id: string; status: string; job: unknown }[]
const LIVE = ['running', 'awaiting-approval', 'waiting']

/**
 * Waits for `done()`, playing the designer meanwhile: quick questions get Go (defaults kept),
 * approval cards get approved, each after a screenshot. Claude is in the loop, so no hurry.
 */
const handled = new Set<string>()
async function play(what: string, done: () => Promise<boolean>, ms = LONG) {
  const end = Date.now() + ms
  let lastDebug = 0
  while (Date.now() < end) {
    if (await done()) return
    if (Date.now() - lastDebug > 20_000) {
      lastDebug = Date.now()
      await page.screenshot({ path: `${OUT}/debug-${JOURNEY}.png` }).catch(() => {})
    }
    if (await dock().isVisible().catch(() => false)) {
      const q = dock().getByRole('region', { name: 'Quick questions' }).last()
      if (await q.isVisible().catch(() => false)) {
        const go = q.getByRole('button', { name: 'Go', exact: true })
        const key = `q:${await q.textContent().catch(() => '')}`
        if (!handled.has(key) && (await go.isEnabled().catch(() => false))) {
          handled.add(key)
          await q.scrollIntoViewIfNeeded().catch(() => {})
          await shot('questions')
          await go.click()
        }
      }
      for (const name of [/^Build it$/, /^Approve$/, /^Render \d+ takes?$/]) {
        const b = dock().getByRole('button', { name }).last()
        if (await b.isVisible().catch(() => false)) {
          await b.scrollIntoViewIfNeeded().catch(() => {})
          await shot('approval')
          await b.click().catch(() => {})
          await page.waitForTimeout(1000)
        }
      }
    }
    await page.waitForTimeout(1500)
  }
  throw new Error(`timed out waiting for ${what}`)
}
/** Until the newest run has stopped (done, failed, canceled, paused). */
const runStopped = async () => {
  const [r] = await runs()
  return !!r && !LIVE.includes(r.status)
}
async function say(text: string) {
  await openDock()
  await composer().fill(text)
  await composer().press('Enter')
  await page.waitForTimeout(1500)
}

/** What the journey left behind, through the API: compared by the replay tests. */
async function outcome(pieceIds: string[]) {
  const out: Record<string, unknown> = { journey: JOURNEY, pieces: [] }
  for (const id of pieceIds) {
    const p = await rpc('pieces.get', { id })
    const history = await rpc('design.history', { pieceId: id }).catch(() => [])
    const takes = await rpc('renders.list', { pieceId: id, limit: 100 }).catch(() => [])
    ;(out.pieces as unknown[]).push({
      title: p.title,
      kind: p.kind,
      stage: p.stage,
      version: p.version,
      spec: p.spec,
      design: p.design,
      directions: (p.directions ?? []).map((d) => ({ letter: d.letter, name: d.name, origin: d.origin })),
      changes: (Array.isArray(history) ? history : history.changes ?? []).map((c) => ({ actor: c.actor?.type, label: c.label, ops: c.ops?.length })),
      takes: takes.map((t) => ({ title: t.title, status: t.status, engine: t.engine, animation: t.scene?.animation?.type ?? null, metal: t.scene?.metal ?? null })),
    })
  }
  const all = await runs()
  const mine = all.filter((r) => (state.runsBefore ?? []).indexOf(r.id) < 0)
  out.runs = []
  for (const r of mine.reverse()) {
    const d = await rpc('traces.run', { id: r.id })
    ;(out.runs as unknown[]).push({
      status: d.run.status,
      model: d.run.model,
      tier: d.run.tier,
      costUsd: d.run.costUsd,
      tokens: d.run.tokens,
      job: d.run.job ? { stage: d.run.job.stage, review: d.run.job.review, pausedBy: d.run.job.pausedBy, plan: d.run.job.plan.map((s) => `${s.id}:${s.state}`) } : null,
      steps: d.steps.map((s) => `${s.kind}:${s.name}:${s.status}${s.isError ? ':error' : ''}`),
    })
  }
  writeFileSync(`${OUT}/${JOURNEY}.outcome.json`, JSON.stringify(out, null, 2))
  return out
}

try {
  await page.goto(`${BASE}/`)
  await page.locator('#main').waitFor()
  state.runsBefore = (await runs()).map((r) => r.id)

  if (JOURNEY === 'f-key') {
    // The no-key panel, then Settings › AI: a wrong key, the right one, Save.
    await openDock()
    await page.waitForTimeout(800)
    await shot('no-key-panel')
    await closeDock()
    await page.goto(`${BASE}/settings/ai`)
    const main = page.locator('#main')
    const field = main.getByLabel('Claude API key')
    await field.waitFor()
    await field.fill('sk-ant-wrong-key-0000000000')
    await main.getByRole('button', { name: 'Test', exact: true }).click()
    await main.getByText(/did not accept/i).first().waitFor({ timeout: 30_000 })
    await shot('test-wrong-key')
    await field.fill('sk-ant-api03-fake-harness-key-0000')
    await main.getByRole('button', { name: 'Test', exact: true }).click()
    await main.getByText(/works|can use/i).first().waitFor({ timeout: 30_000 })
    await shot('test-ok')
    await main.getByRole('button', { name: 'Save', exact: true }).click()
    await main.getByText(/-key|••••|ending/i).first().waitFor({ timeout: 30_000 })
    await page.waitForTimeout(1500)
    await shot('saved')
    const setup = await rpc('assistant.setup.get', {})
    writeFileSync(`${OUT}/${JOURNEY}.outcome.json`, JSON.stringify({ journey: JOURNEY, setup }, null, 2))
    if (setup.key?.source !== 'app' && setup.source !== 'app' && !JSON.stringify(setup).includes('"app"'))
      console.warn('setup:', JSON.stringify(setup))
  }

  if (JOURNEY === 'a-directions') {
    const piece = await rpc('pieces.create', {
      title: 'Tenth anniversary ring',
      brief:
        'A ring for our tenth anniversary. About a carat, size 6. She works with her hands, so nothing that catches. Budget around $4,000.',
    })
    state.directionsPiece = piece.id
    save()
    await page.goto(`${BASE}/pieces/${piece.id}/directions`)
    await page.getByText('No directions yet').waitFor()
    await page.getByRole('button', { name: 'Propose directions with AI' }).click()
    await page.getByRole('button', { name: 'Start job' }).waitFor()
    await shot('job-plan')
    await page.getByRole('button', { name: 'Start job' }).click()
    await openDock()
    const card = (l: string) =>
      page.getByRole('region', { name: 'Directions' }).getByRole('article', { name: new RegExp(`^Direction ${l}:`) })
    await play('three directions', async () => (await card('C').count()) > 0 && (await runStopped()))
    await shot('directions-in-dock')
    await closeDock()
    await foldPlan()
    await card('A').scrollIntoViewIfNeeded()
    await shot('direction-cards')
    await say('Put the head of A on the band of B')
    await play('the mix', async () => (await card('D').count()) > 0 && (await runStopped()))
    await shot('mix-in-dock')
    await say('Go with D')
    await play('the pick', async () => (await rpc('pieces.get', { id: piece.id })).chosenDirectionId !== null && (await runStopped()))
    await shot('picked-in-dock')
    await closeDock()
    await foldPlan()
    await shot('chosen-card')
    await outcome([piece.id])
  }

  if (JOURNEY === 'b-cad-job') {
    const id = state.directionsPiece
    await page.goto(`${BASE}/pieces/${id}/design`)
    await page.locator('[data-region="viewport"] canvas').first().waitFor({ timeout: 120_000 })
    const start = (await rpc('pieces.get', { id })).version
    await page.getByRole('button', { name: 'Make the CAD with AI' }).click()
    await page.getByRole('button', { name: 'Start job' }).waitFor()
    await shot('job-plan')
    await page.getByRole('button', { name: 'Start job' }).click()
    await openDock()
    // Mid-job, once the assistant has changed the design, the designer edits by hand.
    await play('the job’s first change', async () => (await rpc('pieces.get', { id })).version > start)
    await shot('job-working')
    const p = await rpc('pieces.get', { id })
    const band = p.design.order.find((n) => p.design.nodes[n].kind === 'band') ?? 'band'
    await rpc('design.apply', { pieceId: id, label: 'My band, by hand', ops: [{ t: 'update', id: band, patch: { widthTop: 2.6 } }] })
    await play('the job to pause', async () => (await runs())[0]?.status === 'paused')
    await page.waitForTimeout(1500)
    await shot('paused-by-edit')
    await closeDock()
    const resume = page.getByRole('button', { name: 'Resume' }).first()
    await resume.waitFor({ timeout: 60_000 })
    await resume.click()
    await openDock()
    await play('the resumed job to finish', async () => {
      const [r] = await runs()
      return !!r && !LIVE.includes(r.status) && (r.job as { review?: string } | null)?.review === 'pending'
    })
    await shot('ready-for-review')
    await closeDock()
    const accept = page.getByRole('button', { name: 'Accept' }).first()
    await accept.waitFor({ timeout: 60_000 })
    await accept.click()
    await page.waitForTimeout(2000)
    await shot('accepted')
    await outcome([id])
  }

  if (JOURNEY === 'c-chat-edit') {
    const id = state.directionsPiece
    await page.goto(`${BASE}/pieces/${id}/design`)
    await page.locator('[data-region="viewport"] canvas').first().waitFor({ timeout: 120_000 })
    await openDock()
    await dock().getByRole('button', { name: 'New conversation' }).click()
    await say('Make the band 2.2 mm wide, keep everything else.')
    await play('the edit', runStopped)
    await shot('chat-edit')
    // A question about one stone: select it in the features list, then mod+j brings it along.
    await closeDock()
    const tree = page.getByRole('tree', { name: 'Features' })
    await tree.waitFor({ timeout: 30_000 })
    const stone = tree.getByRole('treeitem').filter({ hasText: /centre|center|stone|gem/i }).first()
    await stone.click()
    await page.waitForTimeout(800)
    await page.keyboard.press('Control+j')
    await dock().waitFor()
    await page.waitForTimeout(800)
    await shot('stone-selected')
    await composer().fill('Is this stone safe for someone who works with her hands? How is it held?')
    await composer().press('Enter')
    await page.waitForTimeout(1500)
    await play('the answer', runStopped)
    await shot('stone-answer')
    await outcome([id])
  }

  if (JOURNEY === 'd-photo') {
    if (!PHOTO) throw new Error('HARNESS_PHOTO must name the photo to send')
    await openDock()
    await dock().getByRole('button', { name: 'New conversation' }).click()
    await dock().locator('input[type="file"]').setInputFiles(PHOTO)
    await dock().getByRole('list', { name: 'Attached photos' }).locator('img').waitFor()
    await composer().fill('Make this ring in Pavé')
    await shot('photo-attached')
    await composer().press('Enter')
    await play('the photo read and build', runStopped)
    await page.waitForTimeout(2500)
    await shot('photo-result')
    const m = page.url().match(/\/pieces\/([^/]+)\//)
    const [r] = await runs()
    const d = await rpc('traces.run', { id: r.id })
    state.photoPiece = m?.[1] ?? d.run.pieceId
    save()
    await outcome([state.photoPiece])
  }

  if (JOURNEY === 'e-render') {
    const id = state.directionsPiece
    await page.goto(`${BASE}/pieces/${id}/render`)
    await page.getByRole('navigation', { name: 'Shots' }).waitFor({ timeout: 120_000 })
    await page.waitForTimeout(2000)
    await page.getByRole('button', { name: 'Render with AI' }).click()
    await page.getByRole('button', { name: 'Start job' }).waitFor()
    await shot('job-plan')
    await page.getByRole('button', { name: 'Start job' }).click()
    await openDock()
    await play('the render job', async () => {
      const [r] = await runs()
      return !!r && !LIVE.includes(r.status)
    }, 3 * LONG)
    await shot('critique')
    await closeDock()
    await foldPlan()
    await page.waitForTimeout(1500)
    await shot('takes')
    await say('Re-render the hero in 18k rose gold.')
    await play('the rose gold take', async () => {
      const [r] = await runs()
      const takes = await rpc('renders.list', { pieceId: id, limit: 100 })
      return !!r && !LIVE.includes(r.status) && takes.every((t) => !['queued', 'running'].includes(t.status))
    }, 2 * LONG)
    await shot('rose-gold')
    await closeDock()
    await foldPlan()
    await shot('takes-after')
    await outcome([id])
  }

  if (JOURNEY === 'g-tiers') {
    // Light points at Haiku in Settings › AI; then one edit on each tier.
    await rpc('org.settings.update', { assistantModels: { light: 'claude-haiku-5-5' } })
    await page.goto(`${BASE}/settings/ai`)
    await page.waitForTimeout(1500)
    await shot('settings-tiers')
    const id = state.directionsPiece
    await page.goto(`${BASE}/pieces/${id}/design`)
    await page.locator('[data-region="viewport"] canvas').first().waitFor({ timeout: 120_000 })
    await openDock()
    await dock().getByRole('button', { name: 'New conversation' }).click()
    const steps = [
      ['Power', 'Make the band 2.4 mm wide.'],
      ['Standard', 'Now 2.3 mm.'],
      ['Light', 'And back to 2.2 mm, please.'],
    ]
    for (const [tier, text] of steps) {
      await dock().getByRole('button', { name: /^Model tier:/ }).click()
      await page.getByRole('menuitem', { name: new RegExp(`^${tier}`) }).click()
      await page.waitForTimeout(500)
      await say(text)
      await play(`the ${tier} run`, runStopped)
      await shot(`tier-${tier.toLowerCase()}`)
    }
    await outcome([id])
  }
  console.log(`journey ${JOURNEY} done`)
} catch (e) {
  console.error('FAILED:', e.message)
  await page.screenshot({ path: `${OUT}/${JOURNEY}-zz-failure.${tag}.png` }).catch(() => {})
  process.exitCode = 1
} finally {
  save()
  await browser.close()
}
