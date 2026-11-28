// Run against a disposable server: pnpm exec tsx apps/studio/e2e/rhino-face-borders.ts <base>
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setTimeout } from 'node:timers/promises'
import { type Piece, pointOnNurbs } from '@pave/schema'
import { makeCappedPrismFixture } from '../../../packages/kernel/test-fixtures/capped-prism'

const base = process.argv[2]
assert.ok(base, 'Pass a disposable local server URL.')
const { chromium, webkit } = createRequire(import.meta.url)(
  'playwright',
) as typeof import('playwright')
const browser =
  process.env.PAVE_TEST_BROWSER === 'webkit'
    ? await webkit.launch()
    : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  page.setDefaultTimeout(12_000)
  const rpc = async <T>(name: string, data: object): Promise<T> => {
    const response = await page.request.post(`${base}/api/rpc/${name}`, {
      data,
      maxRetries: name === 'pieces.get' ? 1 : 0,
    })
    assert.ok(response.ok(), `${name}: HTTP ${response.status()}`)
    return response.json()
  }
  const { id } = await rpc<Piece>('pieces.create', {
    title: 'Copy sleeve face borders',
    kind: 'other',
  })
  const get = () => rpc<Piece>('pieces.get', { id })
  const version = async (expected: number) => {
    const deadline = Date.now() + 12_000
    while (Date.now() < deadline) {
      const piece = await get()
      if (piece.version === expected) return piece
      assert.ok(piece.version < expected, 'The action consumed more than one edit.')
      await setTimeout(100)
    }
    assert.fail(`The project did not reach version ${expected}.`)
  }
  const button = (name: string) => page.getByRole('button', { name, exact: true })
  const selectNode = (nodeId: string) => page.locator(`[data-node="${nodeId}"]`).click()
  await page.goto(`${base}/pieces/${id}/design`)
  await button('Import model').click()
  const importDialog = page.getByRole('dialog', { name: 'Import model' })
  await importDialog.locator('input[type=file]').setInputFiles({
    name: 'Sleeve.3dm',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(await makeCappedPrismFixture()),
  })
  await button('Import 1 part').click()
  const original = await version(1)
  const sourceId = original.design.order[0]!
  const solid = original.design.nodes[sourceId]!
  assert.equal(solid.kind, 'meshBody')
  assert.equal(solid.source.type, 'asset')
  assert.ok(solid.source.nativeAssetId)
  await selectNode(sourceId)

  const dialog = page.getByRole('dialog', { name: 'Copy face borders' })
  const copy = dialog.getByRole('button', { name: 'Copy borders', exact: true })
  const chooseFace = async () => {
    await button('Copy face borders').click()
    const selector = dialog.getByRole('combobox', { name: 'Rhino face' })
    await selector.click()
    assert.ok(await copy.isDisabled())
    assert.equal(await page.getByRole('option', { name: /^Face [12] / }).count(), 0)
    await page.getByRole('option', { name: 'Face 4 · 1 hole', exact: true }).click()
    const preview = dialog.getByRole('img', { name: 'Face 4 border preview' })
    await preview.waitFor()
    assert.equal(await preview.locator('path[data-loop-kind="outer"]').count(), 1)
    assert.equal(await preview.locator('path[data-loop-kind="inner"]').count(), 1)
  }
  await chooseFace()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal((await get()).version, 1)
  await chooseFace()
  await copy.click()
  const added = await version(2)
  const curves = added.design.order.slice(1).map((nodeId) => added.design.nodes[nodeId]!)
  assert.equal(curves.length, 2)
  assert.deepEqual(added.design.nodes[sourceId], solid)
  for (const [i, curve] of curves.entries()) {
    assert.equal(curve.kind, 'nurbsCurve')
    assert.equal(curve.sourceObjectId, undefined)
    const a = curve.knots[curve.degree - 1]!
    const b = curve.knots[curve.controlPoints.length - 1]!
    const start = pointOnNurbs(curve, a)
    assert.ok(Math.hypot(...start.map((v, axis) => v - pointOnNurbs(curve, b)[axis]!)) < 1e-8)
    for (const [x, y, z] of [0, 0.17, 0.51, 0.83].map((u) =>
      pointOnNurbs(curve, a + (b - a) * u),
    )) {
      const radius = i === 0 ? 3 : 1
      assert.ok(Math.abs(Math.hypot(x, y) - radius) < 1e-8, 'The exact sampled radius changed.')
      assert.ok(Math.abs(z - 2) < 1e-8, 'The copied loop belongs on the selected upper face.')
    }
  }
  await button('Undo').click()
  assert.deepEqual((await version(3)).design, original.design)
  await button('Redo').click()
  assert.deepEqual((await version(4)).design, added.design)
  await page.reload()
  await page.getByRole('treeitem', { name: /^Construction curves/ }).press('ArrowRight')
  await selectNode(curves[1]!.id)
  await button('Edit control points').click()
  const edit = page.getByRole('dialog', { name: 'Edit control points' })
  await edit.waitFor()
  await edit.getByRole('button', { name: 'Cancel', exact: true }).click()

  await selectNode(sourceId)
  await chooseFace()
  await rpc('design.apply', {
    pieceId: id,
    label: 'Rename the solid in another session',
    ops: [{ t: 'update', id: sourceId, patch: { name: 'Updated sleeve' } }],
  })
  await dialog.getByRole('alert').filter({ hasText: 'The design changed' }).waitFor()
  assert.ok(await copy.isDisabled())
  assert.deepEqual((await version(5)).design.order, added.design.order)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()

  await page.setViewportSize({ width: 390, height: 844 })
  await button('Inspector').click()
  await chooseFace()
  const mobile = await dialog.boundingBox()
  assert.ok(mobile && mobile.x >= 0 && mobile.x + mobile.width <= 390)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal((await get()).version, 5)
  console.log(
    'Copied exact sleeve borders in one edit, verified undo/redo and stale preview handling, and checked the mobile picker.',
  )
} finally {
  await browser.close()
}
