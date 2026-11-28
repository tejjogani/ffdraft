// Run against a disposable local server. Uses the same guide file offered in the jeweler trial.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { CommandInput, CommandName, CommandOutput } from '@pave/schema'
import type { BrowserType } from 'playwright'

const base = process.argv[2]
if (!base) throw new Error('Pass a disposable server URL.')
const { chromium }: { chromium: BrowserType } = createRequire(import.meta.url)('playwright')
const browser = await chromium.launch()
try {
  const page = await browser.newPage({
    viewport: { width: 1450, height: 900 },
    reducedMotion: 'reduce',
  })
  page.setDefaultTimeout(90000)
  async function rpc<N extends CommandName>(
    method: N,
    data: CommandInput<N>,
  ): Promise<CommandOutput<N>> {
    const res = await page.request.post(`${base}/api/rpc/${method}`, { data })
    assert.ok(res.ok(), await res.text())
    return res.json()
  }
  const { id } = await rpc('pieces.create', { kind: 'ring', title: 'Closed shank guide test' })
  const button = (name: string) => page.getByRole('button', { name, exact: true })
  await page.goto(`${base}/pieces/${id}/design`, { waitUntil: 'domcontentloaded' })
  await button('Import model').click()
  const importer = page.getByRole('dialog', { name: 'Import model' })
  await importer
    .locator('input[type=file]')
    .setInputFiles(fileURLToPath(new URL('../public/examples/shank-guides.3dm', import.meta.url)))
  await importer.getByRole('checkbox', { name: /Include editable curves/ }).check()
  await importer.getByRole('button', { name: /^Import(?: |$)/ }).click()
  await importer.waitFor({ state: 'hidden' })
  await button('Add feature').click()
  await page.getByRole('menuitem', { name: 'Sweep 2 rails', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Sweep 2 rails' })
  for (const [field, name] of [
    ['Rail 1', 'Inner rail'],
    ['Rail 2', 'Outer rail'],
    ['Section 1', 'Band section'],
  ] as const) {
    const input = dialog.getByRole('combobox', { name: field, exact: true })
    await input.click()
    const list = await input
      .and(page.locator('[aria-expanded=true][aria-controls]'))
      .getAttribute('aria-controls')
    assert.ok(list)
    await page
      .locator(`[id=${JSON.stringify(list)}]`)
      .getByRole('option', { name: new RegExp(name) })
      .click()
  }
  await dialog.getByRole('button', { name: 'Create feature' }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const { design, version } = await rpc('pieces.get', { id })
  assert.equal(Object.values(design.nodes).filter((n) => n.kind === 'railSweep').length, 1)
  const facts = await rpc('design.evaluate', { pieceId: id, detail: 'production' })
  assert.deepEqual(
    facts.diagnostics.filter((d) => d.level === 'error'),
    [],
  )
  assert.ok(Math.abs(facts.metals[0]!.volumeMm3 - 120 * Math.PI) < 0.5)
  const { asset } = await rpc('design.export', { pieceId: id, format: 'step' })
  assert.ok(asset.id)
  console.log(
    'Imported 3 named curves, built watertight shank, reopened version',
    version,
    'volume',
    facts.metals[0]!.volumeMm3,
    'mm³; STEP exported.',
  )
} finally {
  await browser.close()
}
