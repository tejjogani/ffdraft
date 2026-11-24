// @ts-nocheck — a driver script, run with tsx; not part of the app's type graph.
/**
 * The Design tab, end to end, against the real server and kernel: every seeded piece, display
 * modes, selection, scrubbing, the linked stone and ring-size controls, undo/redo, the add menu,
 * a remote assistant edit arriving over SSE, diagnostics with a one-click fix, STL and STEP
 * downloads, viewport.capture, the empty state and the trophy → iced pendant flow, plus
 * performance numbers. Saves 1440×900 screenshots and a results JSON.
 *
 *   PAVE_DATA_DIR=$(mktemp -d) tsx apps/studio/e2e/cad-server.ts   # terminal 1
 *   pnpm --filter @pave/studio dev                                  # terminal 2
 *   tsx apps/studio/e2e/cad.ts <outDir> [light|dark] [stepFilter]   # terminal 3
 *
 * WebGL runs in software here (SwiftShader), so frame times are a floor, not a target.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const BASE = process.env.STUDIO_URL ?? 'http://localhost:5173'
const API = process.env.API_URL ?? 'http://localhost:8787'
const OUT = process.argv[2] ?? 'shots/cad'
const DL = `${OUT}/downloads`
mkdirSync(DL, { recursive: true })
const theme = process.argv[3] ?? 'light'
const only = process.argv[4]
const results = {}

const rpc = async (name, input) => {
  const r = await fetch(`${API}/api/rpc/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`${name}: ${JSON.stringify(j)}`)
  return j
}

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: theme,
  acceptDownloads: true,
})
await ctx.addInitScript((t) => {
  localStorage.setItem('pave:theme', JSON.stringify(t))
  localStorage.setItem(
    'pave:cad',
    JSON.stringify({
      state: { display: 'rendered', displayChosen: true, fineTune: false, ringSystem: null },
      version: 0,
    }),
  )
  // Downloads instead of the native save dialog, so the test can read the files.
  delete window.showSaveFilePicker
  window.showSaveFilePicker = undefined
}, theme)
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror:', e.message))
page.on(
  'console',
  (m) =>
    m.type() === 'error' &&
    !m.text().includes('404') &&
    console.log('console:', m.text().slice(0, 300)),
)

const shot = async (name) => {
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/${name}-${theme}.png` })
  console.log('shot', name)
}
const evaluationOf = () => page.evaluate(() => window.paveViewer?.evaluation)
async function open(id, settle = 2500) {
  await page.goto(`${BASE}/pieces/${id}/design`)
  const t0 = Date.now()
  await page.waitForFunction(
    () => window.paveViewer?.frameTimes.length > 0 && window.paveViewer.evaluation,
    null,
    { timeout: 120000 },
  )
  const first = Date.now() - t0
  await page.waitForTimeout(settle)
  return first
}
async function step(name, fn) {
  if (only && !name.includes(only)) return
  try {
    await fn()
  } catch (e) {
    console.log(`STEP FAILED ${name}:`, e.message.split('\n')[0])
    await page.keyboard.press('Escape').catch(() => {})
  }
}
const tree = (name) => page.getByRole('treeitem', { name: new RegExp(name) }).first()

// ── Pieces: the seeded workspace plus the templates it does not seed ─────────────────────
let pieces = await rpc('pieces.list', {})
for (const templateId of ['studs', 'pendant-solitaire', 'name-pendant']) {
  if (!pieces.some((p) => p.title === templateId))
    await rpc('pieces.create', { templateId, title: templateId })
}
pieces = await rpc('pieces.list', {})
const byTitle = (t) => pieces.find((p) => p.title === t || p.title.includes(t))?.id

await step('pieces', async () => {
  for (const p of pieces) {
    const first = await open(p.id, 4000)
    const e = await page.evaluate(() => {
      const e = window.paveViewer.evaluation
      return {
        ms: Math.round(e.ms),
        stones: e.stones.length,
        parts: e.parts.length,
        diag: e.diagnostics.length,
      }
    })
    results[p.title] = { firstFrameMs: first, ...e }
    await shot(`piece-${p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)
  }
})

const solitaire = byTitle('Classic solitaire')
const halo = byTitle('Cushion halo')
const trophy = byTitle('Iced-out trophy')

await step('display', async () => {
  await open(byTitle('Oval with pav'))
  for (const mode of ['Rendered', 'Clay', 'Technical']) {
    await page.getByRole('button', { name: mode, exact: true }).click()
    await page.waitForTimeout(mode === 'Rendered' ? 4000 : 2000)
    await shot(`display-${mode.toLowerCase()}`)
  }
  await page.getByRole('button', { name: 'Rendered', exact: true }).click()
})

const expect = (ok, what) => {
  console.log(ok ? 'ok' : 'FAILED', what)
  results.checks ??= {}
  results.checks[what] = ok
}
const camera = () =>
  page.evaluate(() => window.paveViewer.camera.position.toArray().map((v) => +v.toFixed(2)))
const selectedText = () => page.locator('main[data-region=viewport] .sr-only').textContent()

await step('navigation', async () => {
  await open(solitaire)
  const box = await page.locator('canvas').boundingBox()
  const before = await camera()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2, { steps: 4 })
  // Two frames: a camera move must be drawn while the gesture is still going on.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  )
  const during = await camera()
  await page.mouse.up()
  expect(JSON.stringify(before) !== JSON.stringify(during), 'a drag moves the camera at once')
  await page.locator('canvas').focus()
  await page.keyboard.press('4')
  await page.waitForTimeout(1200)
  const [x, y, z] = await camera()
  expect(Math.abs(x) < 0.5 && Math.abs(z) < 0.5 && y > 0, 'key 4 reaches the top view')
  // Keyboard only: F6 cycles to the 3D view, whose arrow keys orbit.
  await page.keyboard.press('1')
  await page.locator('body').click({ position: { x: 4, y: 4 } })
  let onCanvas = false
  for (let i = 0; i < 4 && !onCanvas; i++) {
    await page.keyboard.press('F6')
    onCanvas = await page.evaluate(() => document.activeElement?.tagName === 'CANVAS')
  }
  expect(onCanvas, 'F6 reaches the 3D view')
  const c0 = await camera()
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(800)
  expect(JSON.stringify(c0) !== JSON.stringify(await camera()), 'arrow keys orbit the 3D view')
})

await step('toolbar', async () => {
  await open(solitaire)
  await tree('Band').click()
  for (const name of ['Fit to view', 'Clay', 'X-ray metal', 'X-ray metal', 'Rendered'])
    await page.getByRole('button', { name, exact: true }).click()
  expect((await selectedText())?.includes('Band'), 'toolbar clicks keep the selection')
})

await step('chips', async () => {
  // Each next-step chip, on a fresh copy of a template it is offered on, must not end in red.
  for (const [templateId, label] of [
    ['solitaire', 'Pavé the band'],
    ['name-pendant', 'Ice it out'],
  ]) {
    const piece = await rpc('pieces.create', { templateId, title: `Chip: ${label}` })
    await open(piece.id)
    const rows = await page.getByRole('treeitem').count()
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.waitForFunction((n) => document.querySelectorAll('[role=treeitem]').length > n, rows)
    await page.waitForFunction(() => !document.body.innerText.includes('Updating…'), null, {
      timeout: 120000,
    })
    const errors = await page.evaluate(
      () => window.paveViewer.evaluation.diagnostics.filter((d) => d.level === 'error').length,
    )
    expect(errors === 0, `"${label}" leaves no problems`)
  }
})

await step('select', async () => {
  await open(halo)
  await tree('Band').click()
  await page.waitForTimeout(1500)
  await shot('select-part')
  await page.getByRole('button', { name: /^Ring size: .* Edit$/ }).click()
  await page.waitForTimeout(600)
  await shot('dimension-chip')
  await page.keyboard.press('Escape')
  // A stone of the shoulder row: first click selects the row, the second picks that stone.
  const pt = await page.evaluate(() => {
    const v = window.paveViewer
    const stones = v.evaluation.stones.filter((x) => x.role !== 'center' && x.nodeId !== 'halo')
    const s = stones[Math.floor(stones.length / 2)]
    const m = s.matrix
    // The table: a fifth of a girdle width above the girdle, along the stone's own axis.
    const p = v.project([m[12] + m[8] * 0.2, m[13] + m[9] * 0.2, m[14] + m[10] * 0.2])
    const r = v.canvas.getBoundingClientRect()
    return { x: r.left + p.x, y: r.top + p.y }
  })
  await page.mouse.click(pt.x, pt.y)
  await page.waitForTimeout(800)
  await page.mouse.click(pt.x, pt.y)
  await page.waitForTimeout(1500)
  await shot('select-stone')
})

await step('scrub', async () => {
  await open(solitaire)
  await tree('Band').click()
  await page.waitForTimeout(800)
  const label = page.locator('label', { hasText: /^Width at top$/ }).first()
  const input = page.getByRole('textbox', { name: 'Width at top' })
  const before = await evaluationOf().then(() => page.evaluate(() => window.paveViewer.evaluation))
  const box = await page.getByText('Width at top', { exact: true }).first().boundingBox()
  // Keyboard steps are the reliable scrub in headless Chromium (pointer lock is unavailable).
  await input.click()
  const t0 = Date.now()
  for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowUp')
  await page.waitForFunction((b) => window.paveViewer.evaluation !== b, before, { timeout: 30000 })
  results.scrubToPixelsMs = Date.now() - t0
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2000)
  await shot('scrub-band-width')
  void box
  void label
  // Stone size in carats: the linked control writes the width.
  await tree('Centre stone').click()
  await page.waitForTimeout(800)
  const ct = page.getByRole('textbox', { name: /in carats/ })
  await ct.fill('1.75')
  await ct.press('Enter')
  await page.waitForTimeout(3500)
  await shot('stone-size-carats')
  // Undo / redo
  await page.locator('canvas').click({ position: { x: 20, y: 400 } })
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(2500)
  await shot('undo')
  await page.keyboard.press('Control+Shift+z')
  await page.waitForTimeout(2500)
  await shot('redo')
  const history = await rpc('design.history', { pieceId: solitaire, limit: 5 })
  results.historyLabels = history.map((c) => c.label)
})

await step('ringsize', async () => {
  await open(solitaire)
  await tree('Band').click()
  await page.getByRole('button', { name: 'UK', exact: true }).click()
  await page.waitForTimeout(800)
  await shot('ring-size-uk')
  await page.getByRole('button', { name: 'US', exact: true }).click()
})

await step('inspectors', async () => {
  for (const [piece, node, name] of [
    [halo, 'Halo', 'inspector-halo'],
    [halo, 'Shoulder stones', 'inspector-stone-row'],
    [trophy, 'Pav|Ice', 'inspector-pave'],
    [byTitle('name-pendant'), 'Name|Outline|Text', 'inspector-outline'],
    [byTitle('Miami Cuban'), 'Chain|Cuban', 'inspector-chain'],
  ]) {
    await open(piece)
    await tree(node).click()
    await page.waitForTimeout(1500)
    await shot(name)
  }
  await page.getByRole('button', { name: /Fine-tune/ }).click()
  await page.waitForTimeout(600)
  await shot('inspector-fine-tune')
  await page.getByRole('button', { name: /Fewer settings/ }).click()
})

await step('addmenu', async () => {
  await open(byTitle('Court wedding band'))
  await tree('Band').click()
  await page.locator('canvas').click({ position: { x: 20, y: 400 } })
  await page.keyboard.press('a')
  await page.waitForTimeout(700)
  await shot('add-menu')
  await page
    .getByRole('menuitem', { name: /^Stone/ })
    .first()
    .click()
  await page.waitForTimeout(3500)
  await shot('added-stone')
})

await step('remote', async () => {
  await open(halo)
  const piece = await rpc('pieces.get', { id: halo })
  const band = piece.design.order.find((id) => piece.design.nodes[id].kind === 'ringShank')
  const haloNode = piece.design.order.find((id) => piece.design.nodes[id].kind === 'halo')
  const t0 = Date.now()
  await fetch(`${API}/__agent/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      pieceId: halo,
      label: 'Slimmed the band, doubled the halo',
      ops: [
        { t: 'update', id: band, patch: { widthTop: 1.7, widthBottom: 1.6 } },
        { t: 'update', id: haloNode, patch: { rows: 2 } },
      ],
    }),
  })
  await page.getByText('Slimmed the band').waitFor({ timeout: 30000 })
  results.remoteToChipMs = Date.now() - t0
  await page.waitForTimeout(600)
  await shot('remote-sweep')
  await page.waitForTimeout(3500)
  await tree('Band').click()
  await page.waitForTimeout(1500)
  await shot('remote-change')
  await page.getByRole('button', { name: 'Undo', exact: true }).last().click()
  await page.waitForTimeout(3500)
  await shot('remote-undone')
})

await step('diagnostics', async () => {
  // A piece with something to check: a band thinned below what daily wear needs.
  const id = byTitle('Court wedding band')
  const piece = await rpc('pieces.get', { id })
  const band = piece.design.order.find((n) => piece.design.nodes[n].kind === 'ringShank')
  await rpc('design.apply', {
    pieceId: id,
    label: 'Thin band for the check',
    ops: [{ t: 'update', id: band, patch: { thicknessTop: 0.95, thicknessBottom: 1.0 } }],
  })
  await open(id)
  await page.getByRole('button', { name: /things? to check/ }).waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: /things? to check/ }).click()
  await page.waitForTimeout(800)
  await shot('diagnostics')
  await page
    .getByRole('button', { name: /Thicken the band/ })
    .first()
    .click()
  await page.waitForTimeout(4000)
  await shot('diagnostics-fixed')
})

await step('export', async () => {
  await open(solitaire)
  await page.getByRole('button', { name: /^Export/ }).click()
  await page.waitForTimeout(600)
  await shot('export-menu')
  for (const f of ['STL', 'STEP']) {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 180000 }),
      (async () => {
        if (!(await page.getByRole('menu').count()))
          await page.getByRole('button', { name: /^Export/ }).click()
        // Each row reads "For casting · Watertight metal, per alloy · STL": the format tag ends it.
        await page.getByRole('menuitem', { name: new RegExp(`${f}$`) }).click()
      })(),
    ])
    const path = `${DL}/${download.suggestedFilename()}`
    await download.saveAs(path)
    const { readFileSync } = await import('node:fs')
    const head = readFileSync(path).subarray(0, 80).toString('latin1')
    results[`export${f}`] = {
      file: path,
      bytes: readFileSync(path).length,
      head: head.slice(0, 30).replace(/[^\x20-\x7e]/g, '.'),
    }
    await page.waitForTimeout(1500)
  }
  await shot('exported')
})

await step('capture', async () => {
  await open(solitaire)
  const out = await page.evaluate(
    (pieceId) =>
      window.paveClientTools.run('viewport.capture', {
        pieceId,
        views: ['hero', 'top'],
        mode: 'clay',
        size: 512,
      }),
    solitaire,
  )
  results.capture = {
    version: out.version,
    images: out.images.length,
    metalMassG: out.summary.metalMassG,
  }
  const sel = await page.evaluate(
    (pieceId) => window.paveClientTools.run('viewport.select', { pieceId, nodeIds: ['head'] }),
    solitaire,
  )
  results.select = sel
  await page.waitForTimeout(1000)
  await shot('assistant-select')
})

await step('empty', async () => {
  const piece = await rpc('pieces.create', { title: 'Empty piece' })
  await page.goto(`${BASE}/pieces/${piece.id}/design`)
  await page.getByText('Start this piece').waitFor({ timeout: 60000 })
  await page.waitForTimeout(800)
  await shot('empty')
  await page.getByRole('button', { name: 'Browse templates' }).click()
  await page.waitForTimeout(600)
  await shot('empty-templates')
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Quick start' }).first().click()
  await page.waitForTimeout(500)
  await shot('empty-quick-start')
  await page.getByRole('button', { name: 'Back' }).click()
  // Built-in trophy → iced pendant in four clicks.
  await page.getByRole('button', { name: 'Trophy' }).click()
  await page.waitForFunction(() => window.paveViewer?.evaluation?.parts.length > 0, null, {
    timeout: 120000,
  })
  await page.waitForTimeout(2000)
  await shot('trophy-imported')
  for (const label of ['Ice it out', 'Add a bail', 'Hang on a chain']) {
    const b = page.getByRole('button', { name: label })
    if (await b.count()) {
      await b.click()
      await page.waitForTimeout(6000)
    }
  }
  await page.waitForTimeout(4000)
  await shot('trophy-iced')
})

await step('perf', async () => {
  await open(trophy, 3000)
  results.perf = await page.evaluate(() => {
    const v = window.paveViewer
    return {
      evalMs: Math.round(v.evaluation.ms),
      stones: v.evaluation.stones.length,
      frameMs: Math.round(v.benchmark(5)),
      tier: v.tier,
    }
  })
  await page.getByRole('button', { name: 'Clay', exact: true }).click()
  await page.waitForTimeout(1000)
  results.perf.clayFrameMs = await page.evaluate(() => Math.round(window.paveViewer.benchmark(10)))
  // Idle frames: nothing should draw while nothing moves.
  results.perf.idleFrames = await page.evaluate(async () => {
    const v = window.paveViewer
    const n = v.frameTimes.length
    const before = [...v.frameTimes]
    await new Promise((r) => setTimeout(r, 2000))
    return v.frameTimes.length === n && v.frameTimes.every((x, i) => x === before[i]) ? 0 : 'drew'
  })
})

writeFileSync(`${OUT}/results-${theme}.json`, JSON.stringify(results, null, 2))
console.log(JSON.stringify(results, null, 2))
await browser.close()
