// Run against a disposable local server: pnpm exec tsx apps/studio/e2e/manual-cad.ts <base>
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { chromium as chromiumType, Locator } from 'playwright'

const { chromium } = createRequire(import.meta.url)('playwright') as {
  chromium: typeof chromiumType
}
const base = process.argv[2]
if (!base) throw new Error('Pass the URL of a disposable local server.')
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  const rpc = async (name: string, data: object) => {
    const response = await page.request.post(`${base}/api/rpc/${name}`, {
      data,
      maxRetries: name === 'pieces.get' || name === 'design.evaluate' ? 1 : 0,
    })
    assert.ok(response.ok(), `${name}: ${response.status()} ${await response.text()}`)
    return response.json()
  }
  const { id } = await rpc('pieces.create', { title: 'Manual CAD proof', templateId: 'solitaire' })
  const url = `${base}/pieces/${id}/design`
  const design = async () => (await rpc('pieces.get', { id })).design
  const facts = () => rpc('design.evaluate', { pieceId: id })
  const until = async (condition: () => Promise<boolean>) => {
    for (let i = 0; i < 100; i++) {
      if (await condition()) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.fail('CAD edit did not settle')
  }
  const select = (name: RegExp) => page.getByRole('treeitem', { name }).first().click()
  const setNumber = async (field: Locator, value: string) => {
    await field.fill(value)
    await field.press('Enter')
  }
  const inspector = page.getByRole('complementary', { name: 'Inspector' })
  const carat = inspector.getByRole('textbox', { name: 'Carat weight in carats', exact: true })
  const width = inspector.getByRole('textbox', { name: 'Width in millimetres', exact: true })
  const undo = page.getByRole('button', { name: 'Undo', exact: true })
  await rpc('design.apply', {
    pieceId: id,
    label: 'Start with a 1.5 mm base',
    ops: [{ t: 'update', id: 'band', patch: { thicknessBottom: 1.5 } }],
  })
  const baseline = await design()
  await page.goto(url)
  await select(/Centre stone/)
  await inspector.getByText('Carat weight', { exact: true }).waitFor()
  const originalWidth = Number(await width.inputValue())
  await setNumber(carat, '1.25')
  await until(async () => (await design()).nodes.center.width > originalWidth)
  const larger = await design()
  const resized = await facts()
  assert.ok(Math.abs(resized.caratTotal - 1.25) < 0.015, `Evaluated ${resized.caratTotal} ct`)
  assert.ok(
    resized.lots.some(
      (lot: { role: string; width: number }) =>
        lot.role === 'center' && lot.width === larger.nodes.center.width,
    ),
  )
  const reopened = await context.newPage()
  try {
    await reopened.goto(url)
    await reopened.reload()
    await reopened
      .getByRole('treeitem', { name: /Centre stone/ })
      .first()
      .click()
    assert.equal(
      Number(await reopened.getByRole('textbox', { name: 'Carat weight in carats' }).inputValue()),
      1.25,
    )
  } finally {
    await reopened.close()
  }
  await undo.click()
  await until(async () => (await design()).nodes.center.width === originalWidth)

  await select(/^Band/)
  const thickness = inspector.getByRole('textbox', { name: 'Thickness at base', exact: true })
  assert.equal(Number(await thickness.inputValue()), 1.5)
  const preBand = await facts()
  await setNumber(thickness, '1.8')
  await until(async () => (await design()).nodes.band.thicknessBottom === 1.8)
  const thicker = await design()
  assert.equal(thicker.nodes.band.thicknessTop, baseline.nodes.band.thicknessTop)
  assert.deepEqual(thicker.nodes.band.size, baseline.nodes.band.size)
  const postBand = await facts()
  assert.ok(
    postBand.metalMassG > preBand.metalMassG,
    `${postBand.metalMassG}g ≤ ${preBand.metalMassG}g`,
  )

  await select(/^Head/)
  await inspector.getByRole('combobox', { name: 'Style', exact: true }).click()
  await page.getByRole('option', { name: 'Basket', exact: true }).click()
  await until(async () => (await design()).nodes.head.style === 'basket')
  await setNumber(inspector.getByRole('textbox', { name: 'Gallery rails', exact: true }), '2')
  await until(async () => (await design()).nodes.head.rails === 2)
  const basket = await design()
  assert.equal(basket.nodes.head.gem, baseline.nodes.head.gem)
  assert.deepEqual(basket.nodes.center, baseline.nodes.center)
  await undo.click()
  await until(async () => (await design()).nodes.head.rails === baseline.nodes.head.rails)
  await undo.click()
  await until(async () => (await design()).nodes.head.style === 'prong')

  const fit = {
    provider: 'diaex',
    sku: 'MANUAL-CAD',
    measured: { length: 6.68, width: 6.63, depth: 4.1 },
  }
  await rpc('design.replaceStone', { pieceId: id, target: { nodeId: 'center' }, change: { fit } })
  await page.reload()
  await select(/Centre stone/)
  assert.ok(await carat.isDisabled())
  assert.ok(await width.isDisabled())
  assert.equal(Number(await width.inputValue()), fit.measured.width)
  await inspector.getByText(/width and carat weight are fixed/i).waitFor()
  await inspector.getByRole('link', { name: 'Change fitted diamond' }).waitFor()

  const halo = await rpc('pieces.create', { title: 'Melee CAD proof', templateId: 'halo' })
  await page.goto(`${base}/pieces/${halo.id}/design`)
  await select(/^Halo/)
  await inspector.getByText('ct ea.', { exact: true }).waitFor()
  assert.equal(await carat.count(), 0)
  assert.ok(await inspector.getByRole('textbox', { name: 'Stone size in millimetres' }).isEnabled())
  console.log(
    `Manual CAD passed: 1.25 ct persisted and undone; base thickness added ${(postBand.metalMassG - preBand.metalMassG).toFixed(3)}g; basket rails and fitted/melee controls verified.`,
  )
} finally {
  await browser.close()
}
