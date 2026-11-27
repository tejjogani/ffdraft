// Run against a disposable local server: pnpm exec tsx apps/studio/e2e/rhino-end-face.ts <base>
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { APIRequestContext } from 'playwright'
import { makeCappedPrismFixture } from '../../../packages/kernel/test-fixtures/capped-prism'
import type { CommandInput, CommandName, CommandOutput } from '../../../packages/schema/src/index'

const { chromium, webkit } = createRequire(import.meta.url)(
  'playwright',
) as typeof import('playwright')
const base = process.argv[2]
if (!base) throw new Error('Pass the URL of a disposable local server.')
const browser =
  process.env.PAVE_TEST_BROWSER === 'webkit'
    ? await webkit.launch()
    : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 930 } })
  const otherWindow = await browser.newContext()
  page.setDefaultTimeout(20_000)
  const rpc = async <N extends CommandName>(
    name: N,
    data: CommandInput<N>,
    request: APIRequestContext = page.request,
  ): Promise<CommandOutput<N>> => {
    const response = await request.post(`${base}/api/rpc/${name}`, { data })
    assert.ok(response.ok(), `${name}: ${response.status()} ${await response.text()}`)
    return response.json()
  }

  const project = await rpc('pieces.create', { title: 'Rhino end-face proof', kind: 'other' })
  const pieceId = project.id
  const cad = `${base}/pieces/${pieceId}/design`
  const button = (name: string) => page.getByRole('button', { name, exact: true })
  await page.goto(cad)
  await button('Import model').click()
  const importDialog = page.getByRole('dialog', { name: 'Import model' })
  await importDialog.locator('input[type=file]').setInputFiles({
    name: 'Sleeve.3dm',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(await makeCappedPrismFixture()),
  })
  await button('Import 1 part').click()
  await importDialog.waitFor({ state: 'hidden' })
  const sleeve = page.getByRole('treeitem', { name: /Sleeve/ })
  await sleeve.click()
  const piece = () => rpc('pieces.get', { id: pieceId })
  const imported = await piece()
  const nodeId = imported.design.order[0]!
  const ref = { pieceId, nodeId }
  const read = () => rpc('design.rhinoCapFaces', ref)
  const initial = await read()
  assert.ok(initial.nativeAssetId)
  assert.equal(initial.faces.length, 2)
  async function assertSpan(span: number) {
    await page.waitForFunction(
      async ({ ref, span }) => {
        const reply = await fetch('/api/rpc/design.rhinoCapFaces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ref),
        })
        if (!reply.ok) return false
        const { faces }: CommandOutput<'design.rhinoCapFaces'> = await reply.json()
        return (
          faces.length === 2 &&
          faces.every((f) => f.innerLoops === 1 && Math.abs(f.spanMm - span) < 1e-6) &&
          faces.some((f) => f.normal[2] > 0.99 && Math.abs(f.center[2] - span) < 1e-6) &&
          faces.some((f) => f.normal[2] < -0.99 && Math.abs(f.center[2]) < 1e-6)
        )
      },
      { ref, span },
    )
  }

  const dialog = page.getByRole('dialog', { name: 'Move end face' })
  const offset = dialog.getByLabel('Offset (mm)', { exact: true })
  const move = dialog.getByRole('button', { name: 'Move face', exact: true })
  const close = (name = 'Cancel') => dialog.getByRole('button', { name, exact: true })
  const top = dialog.getByRole('radio', { name: /Top \(\+Z\)/ })
  const bottom = dialog.getByRole('radio', { name: /Bottom/ })
  const fixedFace = dialog.getByRole('definition').filter({ hasText: /^Top \(\+Z\)$/ })

  await button('Move end face').click()
  await bottom.check()
  assert.ok(await bottom.isChecked())
  await fixedFace.waitFor()
  await offset.fill('0.25')
  await close().click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal((await piece()).version, imported.version)
  await assertSpan(2)

  await button('Move end face').click()
  assert.ok(await top.isChecked({ timeout: 20_000 }))
  await offset.fill('-2')
  assert.ok(await move.isDisabled())
  await offset.fill('0.25')
  await dialog.getByText('2 mm → 2.25 mm', { exact: true }).waitFor()
  if (process.env.PAVE_CAP_SCREENSHOT)
    await page.screenshot({ path: process.env.PAVE_CAP_SCREENSHOT, animations: 'disabled' })
  await move.click()
  await dialog.waitFor({ state: 'hidden' })
  await assertSpan(2.25)
  const edited = await read()
  assert.ok(edited.nativeAssetId && edited.nativeAssetId !== initial.nativeAssetId)
  await button('Undo').click()
  await assertSpan(2)
  assert.equal((await read()).nativeAssetId, initial.nativeAssetId)
  await button('Redo').click()
  await assertSpan(2.25)
  assert.equal((await read()).nativeAssetId, edited.nativeAssetId)

  await page.reload()
  await sleeve.click()
  await button('Move end face').click()
  await dialog.getByText('2.25 mm → 2.25 mm', { exact: true }).waitFor()
  await offset.fill('0.25')
  const offsetRoute = '**/api/rpc/design.offsetRhinoCap'
  await page.route(
    offsetRoute,
    async (route) => {
      await rpc(
        'design.apply',
        {
          pieceId,
          label: 'Rename sleeve',
          ops: [{ t: 'update', id: nodeId, patch: { name: 'Renamed sleeve' } }],
        },
        otherWindow.request,
      )
      await route.continue()
    },
    { times: 1 },
  )
  const staleResponse = page.waitForResponse((response) =>
    response.url().endsWith('/design.offsetRhinoCap'),
  )
  await move.click()
  assert.equal((await staleResponse).status(), 409)
  await dialog.getByRole('alert').filter({ hasText: 'The design changed' }).waitFor()
  assert.ok(await move.isDisabled())
  await assertSpan(2.25)
  assert.equal((await read()).nativeAssetId, edited.nativeAssetId)
  await close().click()
  await dialog.waitFor({ state: 'hidden' })

  // Lose the response after commit. Retrying must recover the same change and its Undo.
  await button('Move end face').click()
  await offset.fill('-0.25')
  const beforeRetry = await piece()
  await page.route(
    offsetRoute,
    async (route) => {
      const committed = await route.fetch()
      assert.ok(committed.ok(), await committed.text())
      await route.abort()
    },
    { times: 1 },
  )
  await move.click()
  await dialog.getByRole('button', { name: 'Retry save', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await assertSpan(2)
  assert.equal((await piece()).version, beforeRetry.version + 1)
  await button('Undo').click()
  await assertSpan(2.25)
  assert.ok(await button('Undo').isDisabled())

  const destinationTitle = `Switch away from sleeve ${pieceId.slice(-5)}`
  const destination = await rpc('pieces.create', { title: destinationTitle, kind: 'other' })
  const beforeSwitch = await piece()
  await button('Move end face').click()
  await offset.fill('0.25')
  await button('Switch project').press('Enter')
  await page
    .getByRole('dialog', { name: 'Switch project' })
    .getByRole('link', { name: destinationTitle })
    .click()
  await page.waitForURL(`${base}/pieces/${destination.id}/design`)
  await dialog.waitFor({ state: 'hidden' })
  assert.equal((await piece()).version, beforeSwitch.version)

  // Mesh shaping makes the retained source ineligible, and the tool explains the empty result.
  await rpc(
    'design.apply',
    { pieceId, label: 'Smooth sleeve', ops: [{ t: 'update', id: nodeId, patch: { smooth: 1 } }] },
    otherWindow.request,
  )
  await page.goto(cad)
  await page.getByRole('treeitem', { name: /Renamed sleeve/ }).click()
  await button('Move end face').click()
  await dialog.getByText(/Undo mesh shaping/).waitFor()
  assert.ok(!(await move.isVisible()))
  await close().click()
  await dialog.waitFor({ state: 'hidden' })

  console.log(
    'Verified Rhino cap selection, cancel, signed offset, Undo, Redo, reopen, stale write, save retry, project switch and an ineligible native part.',
  )
} finally {
  await browser.close()
}
