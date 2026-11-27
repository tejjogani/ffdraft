// Run against a disposable local server with the built Studio and Playwright.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setTimeout } from 'node:timers/promises'
import type { EvaluationSummary, Piece } from '@pave/schema'

const base = process.argv[2]
assert.ok(base, 'Pass the URL of a disposable local server.')
const { chromium, webkit } = createRequire(import.meta.url)(
  'playwright',
) as typeof import('playwright')
const browser =
  process.env.PAVE_TEST_BROWSER === 'webkit'
    ? await webkit.launch()
    : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })

try {
  const context = await browser.newContext({ viewport: { width: 1536, height: 960 } })
  await context.addInitScript(`Object.defineProperty(window, 'showSaveFilePicker', {
    value: async (options) => ({
      createWritable: async () => ({
        write: async (blob) => { window.step = { name: options.suggestedName, text: await blob.text() } },
        close: async () => {},
      }),
    }),
  })`)
  const page = await context.newPage()
  const rpc = async <T>(name: string, data: object): Promise<T> => {
    const res = await page.request.post(`${base}/api/rpc/${name}`, { data })
    assert.ok(res.ok(), `${name} ${await res.text()}`)
    return res.json()
  }
  const { id } = await rpc<Piece>('pieces.create', {
    kind: 'ring',
    title: 'Custom ring band browser proof',
  })
  const piece = () => rpc<Piece>('pieces.get', { id })
  const untilVersion = async (minVersion: number) => {
    const deadline = Date.now() + 30_000
    let current = await piece()
    while (current.version < minVersion && Date.now() < deadline) {
      await setTimeout(100)
      current = await piece()
    }
    assert.equal(current.version, minVersion)
    return current
  }
  const check = async (bore: number, thickness: number) => {
    const facts = await rpc<EvaluationSummary>('design.evaluate', {
      pieceId: id,
      detail: 'production',
    })
    assert.deepEqual(
      facts.diagnostics.filter((d) => d.level === 'error'),
      [],
    )
    assert.ok(Math.abs(facts.boundsMm.y - 4) < 0.01)
    assert.ok(Math.abs(facts.boundsMm.x - (bore + 2 * thickness)) < 0.01)
    assert.ok(
      Math.abs(facts.metals[0]!.volumeMm3 - 4 * Math.PI * thickness * (bore + thickness)) < 0.01,
    )
  }
  const button = (name: string) => page.getByRole('button', { name, exact: true })

  await page.goto(`${base}/pieces/${id}/design`)
  await button('Draw curve').click()
  const draw = page.getByRole('region', { name: 'Draw curve' })
  await draw.getByText('Right', { exact: true }).click()
  for (const [y, z] of [
    ['-2', '-1'],
    ['2', '-1'],
    ['2', '1'],
    ['-2', '1'],
  ]) {
    await draw.getByRole('spinbutton', { name: 'Y (mm)' }).fill(y!)
    await draw.getByRole('spinbutton', { name: 'Z (mm)' }).fill(z!)
    await draw.getByRole('button', { name: 'Add point', exact: true }).click()
  }
  await draw.getByRole('button', { name: 'Closed curve', exact: true }).click()
  await draw.getByRole('button', { name: 'Save curve', exact: true }).click()
  const sourceId = (await untilVersion(1)).design.order[0]!

  await button('Make ring band').click()
  const built = await untilVersion(2)
  const bandId = built.design.order[1]!
  assert.equal(built.design.nodes[bandId]?.kind, 'revolve')
  await check(16.5068, 2)

  const size = page.getByRole('combobox', { name: 'Ring size (US)', exact: true })
  await size.click()
  await page.getByRole('option', { name: 'US 7', exact: true }).click()
  await untilVersion(3)
  await check(17.3196, 2)

  const source = page.locator(`[data-node="${sourceId}"]`)
  if (!(await source.isVisible()))
    await page.getByRole('treeitem', { name: /^Construction curves/ }).press('ArrowRight')
  await source.click()
  await button('Edit points').click()
  const edit = page.getByRole('region', { name: 'Edit curve points' })
  for (const point of [3, 4]) {
    await edit.getByRole('button', { name: new RegExp(`^Point ${point} ·`) }).click()
    await edit.getByRole('spinbutton', { name: 'Z (mm)' }).fill('2')
    await edit.getByRole('button', { name: 'Move point', exact: true }).click()
  }
  await edit.getByRole('button', { name: 'Save curve', exact: true }).click()
  await untilVersion(4)
  await check(17.3196, 3)
  await button('Undo').click()
  await untilVersion(5)

  await page.reload()
  await page.getByRole('treeitem', { name: /Custom ring band/ }).click()
  await size.getByText('US 7', { exact: true }).waitFor()
  const reopened = (await piece()).design.nodes[bandId]
  assert.ok(reopened?.kind === 'revolve')
  assert.equal(reopened.curve, sourceId)
  assert.deepEqual(reopened.size, { system: 'us', value: 7 })
  await check(17.3196, 2)

  await page
    .getByRole('button', { name: /^Export/ })
    .first()
    .click()
  await page.getByRole('menuitem', { name: /For another CAD/ }).click()
  const step = await page.waitForFunction(
    () => (window as unknown as { step?: { name: string; text: string } }).step ?? null,
  )
  const file = await step.jsonValue()
  assert.match(file.name, /\.step$/i)
  assert.match(file.text, /MANIFOLD_SOLID_BREP/)
  console.log(
    'Studio drew and closed the source, resized the solid, rebuilt and undid a source edit, reopened and exported an exact STEP band.',
    id,
  )
} finally {
  await browser.close()
}
