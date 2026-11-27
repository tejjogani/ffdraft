// Run with the URL of a disposable local server.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { delimiter } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { makeCappedPrismFixture } from '../../../packages/kernel/test-fixtures/capped-prism'

const { chromium, webkit } = createRequire(import.meta.url)(
  'playwright',
) as typeof import('playwright')
const base = process.argv[2]
if (!base) throw Error('Pass a disposable local server URL.')
const browser =
  process.env.PAVE_TEST_BROWSER === 'webkit'
    ? await webkit.launch()
    : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  page.setDefaultTimeout(12000)
  const rpc = async (n: string, data: object) => {
    const r = await page.request.post(base + '/api/rpc/' + n, { data })
    assert.ok(r.ok(), n + ' ' + r.status())
    return r.json()
  }
  const { id } = await rpc('pieces.create', { title: 'Duplicate a rim', kind: 'other' })
  const button = (n: string) => page.getByRole('button', { name: n, exact: true })
  await page.goto(base + '/pieces/' + id + '/design')
  await button('Import model').click()
  const modal = page.getByRole('dialog')
  await modal.locator('input[type=file]').setInputFiles({
    name: 'Sleeve.3dm',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(await makeCappedPrismFixture()),
  })
  await button('Import 1 part').click()
  await modal.waitFor({ state: 'hidden' })
  await page.getByRole('treeitem', { name: /Sleeve/ }).click()
  await button('Copy edge as curve').click()
  const dialog = page.getByRole('dialog', { name: 'Copy edge as curve' })
  await dialog.locator('path[data-edge-index]').first().waitFor({ state: 'attached' })
  await dialog.getByRole('button', { name: 'Top', exact: true }).click()
  const pick = await dialog.locator('svg').evaluate((svg) => {
    for (const path of svg.querySelectorAll<SVGPathElement>('path[data-edge-index]')) {
      const screen = path.getScreenCTM()
      if (!screen || !path.getTotalLength()) continue
      const point = path.getPointAtLength(path.getTotalLength() * 0.37).matrixTransform(screen)
      const hit = document.elementFromPoint(point.x, point.y)?.getAttribute('data-edge-index')
      if (hit && Number(hit) > 0) return { x: point.x, y: point.y, index: Number(hit) }
    }
    return null
  })
  assert.ok(pick)
  await page.mouse.click(pick.x, pick.y)
  assert.equal(await dialog.getByLabel('Edge number').inputValue(), String(pick.index + 1))
  await dialog.getByLabel('Edge number').fill('1')
  await dialog.getByLabel('Edge number').press('Tab')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal((await rpc('pieces.get', { id })).version, 1)
  await button('Copy edge as curve').click()
  await dialog.locator('path[data-edge-index]').first().waitFor({ state: 'attached' })
  await dialog.getByRole('button', { name: 'Copy curve', exact: true }).click()
  const start = Date.now()
  let p = await rpc('pieces.get', { id })
  while (p.design.order.length < 2 && Date.now() - start < 12000) {
    await setTimeout(80)
    p = await rpc('pieces.get', { id })
  }
  assert.equal(p.version, 2)
  assert.equal(p.design.order.length, 2)
  const source = p.design.nodes[p.design.order[0]]
  const curve = p.design.nodes[p.design.order[1]]
  assert.equal(curve.kind, 'nurbsCurve')
  assert(curve.controlPoints.length >= 2)
  assert(!curve.sourceObjectId)
  const listed = await rpc('design.rhinoEdges', { pieceId: id, nodeId: source.id, edgeIndex: 0 })
  assert.deepEqual(curve.knots, listed.curve.knots)
  assert.deepEqual(curve.controlPoints, listed.curve.controlPoints)
  const curves = page.getByRole('treeitem', { name: /^Construction curves/ })
  const curveRow = page.locator(`[data-node="${curve.id}"]`)
  await curves.press('ArrowRight')
  await curveRow.waitFor({ state: 'attached' })
  await button('Undo').click()
  await curveRow.waitFor({ state: 'detached' })
  await button('Redo').click()
  await curves.press('ArrowRight')
  await curveRow.waitFor({ state: 'attached' })
  await page.reload()
  await curves.press('ArrowRight')
  await curveRow.click()
  await button('Edit control points').click()
  await page.getByRole('dialog', { name: 'Edit control points' }).waitFor()
  const sdk = fileURLToPath(new URL('../../../packages/pave-python/src', import.meta.url))
  const smoke = fileURLToPath(
    new URL('../../../packages/pave-python/tests/rhino_native_smoke.py', import.meta.url),
  )
  execFileSync(
    process.env.PAVE_TEST_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'),
    [smoke, base, id, source.id],
    {
      stdio: 'inherit',
      timeout: 60_000,
      env: {
        ...process.env,
        PYTHONPATH: [sdk, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
      },
    },
  )
  await page.reload()
  await page.locator('[data-node="' + source.id + '"]').click()
  await button('Copy edge as curve').click()
  await dialog.locator('path[data-edge-index]').first().waitFor({ state: 'attached' })
  const previous = await rpc('pieces.get', { id })
  await rpc('design.apply', {
    pieceId: id,
    label: 'Rename the source in another session',
    ops: [{ t: 'update', id: source.id, patch: { name: 'Updated sleeve' } }],
  })
  await dialog.getByRole('button', { name: 'Copy curve' }).click()
  await dialog
    .getByRole('alert')
    .filter({ hasText: 'This project changed. Reopen the edge picker.' })
    .waitFor()
  assert(await dialog.getByRole('button', { name: 'Copy curve' }).isDisabled())
  const latest = await rpc('pieces.get', { id })
  assert.deepEqual(latest.design.order, previous.design.order)
  assert.equal(latest.version, previous.version + 1)
  console.log(
    'Copied a native Rhino edge, checked its exact curve, source provenance, undo/redo and editable control points after reopening.',
  )
} finally {
  await browser.close()
}
