// Run against a disposable local server: pnpm exec tsx apps/studio/e2e/handmade-mount.ts <base>
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { Piece } from '@pave/schema'
import { holdInspectorClose } from './inspector-focus'

const base = process.argv[2]
if (!base) throw Error('Pass the URL of a disposable local server.')
const { chromium, webkit } = createRequire(import.meta.url)(
  'playwright',
) as typeof import('playwright')
const browser =
  process.env.PAVE_TEST_BROWSER === 'webkit'
    ? await webkit.launch()
    : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })

// Watertight 2 × 4 × 3 mm box with known source bounds.
const obj = `v 0 0 0
v 2 0 0
v 2 4 0
v 0 4 0
v 0 0 3
v 2 0 3
v 2 4 3
v 0 4 3
f 1 3 2
f 1 4 3
f 5 6 7
f 5 7 8
f 1 2 6
f 1 6 5
f 2 3 7
f 2 7 6
f 3 4 8
f 3 8 7
f 4 1 5
f 4 5 8`

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  const rpc = async (name: string, data: object) => {
    const response = await page.request.post(`${base}/api/rpc/${name}`, { data })
    assert.ok(response.ok(), `${name}: ${response.status()} ${await response.text()}`)
    return response.json()
  }
  const { id: pieceId } = await rpc('pieces.create', {
    title: 'Handmade mount editor proof',
    kind: 'ring',
  })
  const upload = await page.request.post(`${base}/api/assets`, {
    multipart: {
      file: { name: 'studio-mount-proof.obj', mimeType: 'model/obj', buffer: Buffer.from(obj) },
    },
  })
  assert.ok(upload.ok(), await upload.text())
  const assetId = (await upload.json()).id
  const part = (
    id: string,
    name: string,
    x: number,
    importRole: string,
    layer = 'Workshop mount',
    group?: string,
  ) => ({
    t: 'add',
    node: {
      id,
      kind: 'meshBody',
      name,
      importRole,
      keepSourcePlacement: true,
      transform: { position: [x, 0, 0] },
      source: {
        type: 'asset',
        assetId,
        rhinoLayer: layer,
        rhinoContext: group && { groups: [{ id: group, name: group }], placements: [] },
      },
    },
  })
  const transform = { position: [4, 2, 2.5], rotation: [0, 0, 0], scale: 1 }
  await rpc('design.apply', {
    pieceId,
    label: 'Independent workshop mount parts and diamond',
    ops: [
      part('left', 'Workshop left claw', 0, 'unassigned'),
      part('right', 'Workshop right claw', 6, 'metal'),
      part('other', 'Separate metal shank', 12, 'metal'),
      part('stone', 'Crown source', 3, 'stone'),
      part('member-a', 'First gallery bar', 16, 'metal', 'Gallery rails', 'Group100'),
      part('member-b', 'Second gallery bar', 20, 'metal', 'Head bars', 'Group100'),
      ...Array.from({ length: 12 }, (_, i) =>
        part(`spare-${i}`, `Spare metal ${i + 1}`, 24 + 4 * i, 'metal'),
      ),
      {
        t: 'add',
        node: {
          id: 'crown',
          kind: 'gem',
          name: 'Workshop diamond',
          cut: 'oval',
          width: 4,
          transform,
          importSourceId: 'stone',
          importSourceFit: { width: 4, length: 5, depth: 3, cut: 'oval', transform },
          sourcing: {
            provider: 'diaex',
            sku: 'MOUNT-FIXTURE',
            measured: { width: 5, length: 6, depth: 3.5 },
          },
        },
      },
    ],
  })
  const getPiece = (): Promise<Piece> => rpc('pieces.get', { id: pieceId })
  const before = await getPiece()
  const selected = ['Workshop left claw', 'Workshop right claw']
  const dialog = page.getByRole('dialog', { name: 'Edit handmade mount' })
  const open = () => page.getByRole('button', { name: 'Edit handmade mount', exact: true }).click()
  const button = (name: string) => dialog.getByRole('button', { name, exact: true })
  const option = async (menu: string, choice: string) => {
    await dialog.getByRole('combobox', { name: menu }).click()
    await page.getByRole('option', { name: choice, exact: true }).click()
  }
  const viewport = dialog.getByRole('img', { name: 'Mount cage viewport' })
  const atVersion = async (expected: number) => {
    const end = Date.now() + 12_000
    while (Date.now() < end) {
      const piece = await getPiece()
      if (piece.version === expected) return piece
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.fail(`Design did not reach version ${expected}`)
  }

  await page.goto(`${base}/pieces/${pieceId}/design`)
  await page.getByText(selected[0]!, { exact: true }).first().click()
  await page
    .getByText(selected[1]!, { exact: true })
    .first()
    .click({ modifiers: ['Shift'] })
  await open()
  await viewport.waitFor()
  assert.equal(await dialog.getByRole('checkbox', { name: /^Workshop .* claw$/ }).count(), 2)
  for (const name of selected) assert.ok(await dialog.getByRole('checkbox', { name }).isChecked())
  const search = dialog.getByRole('searchbox', { name: 'Search mount bodies' })
  await search.fill('Group100')
  await dialog.getByRole('status').filter({ hasText: '2 matching bodies' }).waitFor()
  const matches = dialog.getByRole('checkbox')
  assert.equal(await matches.count(), 2)
  assert.deepEqual(await dialog.getByText(/^(First|Second) gallery bar$/).allTextContents(), [
    'First gallery bar',
    'Second gallery bar',
  ])
  for (const checkbox of await matches.all()) assert.ok(!(await checkbox.isChecked()))
  const onlySelected = button('Selected only')
  await onlySelected.focus()
  await onlySelected.press('Space')
  assert.equal(await onlySelected.getAttribute('aria-pressed'), 'true')
  assert.equal(await matches.count(), 2)
  for (const name of selected) assert.ok(await dialog.getByRole('checkbox', { name }).isChecked())
  await onlySelected.press('Space')
  assert.equal(await search.inputValue(), 'Group100')
  await search.fill('Gallery rails')
  await dialog.getByRole('status').filter({ hasText: '1 matching body' }).waitFor()
  assert.equal(await matches.count(), 1)
  await search.fill('no such layer')
  await dialog.getByRole('status').filter({ hasText: 'No matching bodies' }).waitFor()
  await search.fill('')
  await dialog.getByRole('checkbox', { name: 'Separate metal shank' }).check()
  await dialog.getByText('14 × 4 × 3 mm', { exact: true }).waitFor()
  await dialog.getByRole('checkbox', { name: 'Separate metal shank' }).uncheck()
  await dialog.getByText('8 × 4 × 3 mm', { exact: true }).waitFor()

  await button('Top').click()
  const canvas = await viewport.boundingBox()
  assert.ok(canvas)
  const unitsToPx = Math.min(canvas.width, canvas.height) / (Math.hypot(8, 4, 3) * 1.2)
  const x = canvas.x + canvas.width / 2 + 4 * unitsToPx
  const y = canvas.y + canvas.height / 2 - 2 * unitsToPx
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 15, y, { steps: 4 })
  await page.mouse.up()
  await dialog
    .getByRole('combobox', { name: 'Cage handles' })
    .getByText('Right / Back / Top')
    .waitFor()
  assert.ok(await button('Undo draft').isEnabled())
  await button('Undo draft').click()
  assert.ok(await button('Undo draft').isDisabled())
  assert.equal((await getPiece()).version, before.version)

  await option('Deformation mode', 'Bend across parts')
  await option('Cage handles', 'Top (+Z)')
  const z = dialog.getByRole('textbox', { name: 'Z move (mm)' })
  await z.fill('0.5')
  await z.press('Enter')
  await option('Linked imported stone', 'Workshop diamond')
  await dialog.getByText('Supplier dimensions', { exact: true }).waitFor()
  await dialog.getByText('5 × 6 × 3.5 mm', { exact: true }).waitFor()
  assert.ok(await button('Save mount edit').isDisabled())
  await option('Mount alloy', 'Platinum 950')
  await button('Fitted view').click()
  await dialog.getByRole('img', { name: 'Fitted mount viewport' }).waitFor()
  if (process.env.PAVE_MOUNT_SCREENSHOT)
    await page.screenshot({ path: process.env.PAVE_MOUNT_SCREENSHOT, animations: 'disabled' })
  await button('Save mount edit').click()
  await dialog.waitFor({ state: 'hidden' })
  const edited = await atVersion(before.version + 1)
  const left = edited.design.nodes.left
  const right = edited.design.nodes.right
  assert.equal(left?.kind, 'meshBody')
  assert.equal(right?.kind, 'meshBody')
  assert.deepEqual(left.mountCage, right.mountCage)
  assert.equal(left.mountCage?.mode, 'freeform')
  assert.deepEqual(left.mountCage?.offsets[4], [0, 0, 0.5])
  assert.equal(left.mountFit?.gem, 'crown')
  assert.equal(left.material, 'pt950')
  assert.deepEqual(edited.design.nodes.other, before.design.nodes.other)
  assert.deepEqual(left.source, (before.design.nodes.left as typeof left).source)

  await open()
  await viewport.waitFor()
  await button('Restore original').click()
  await button('Save mount edit').click()
  await dialog.waitFor({ state: 'hidden' })
  const restored = await atVersion(before.version + 2)
  const restoredLeft = restored.design.nodes.left
  assert.equal(restoredLeft?.kind, 'meshBody')
  assert.equal(restoredLeft.mountCage, undefined)
  assert.equal(restoredLeft.mountFit, undefined)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  assert.deepEqual((await atVersion(before.version + 3)).design, edited.design)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  assert.deepEqual((await atVersion(before.version + 4)).design, before.design)
  // The server can commit Undo before the CAD window receives its acknowledgment.
  await page
    .getByRole('status')
    .filter({ hasText: /^Saved$/ })
    .waitFor()

  await open()
  await viewport.waitFor()
  await z.fill('1')
  await rpc('design.apply', {
    pieceId,
    label: 'Concurrent rename',
    ops: [{ t: 'update', id: 'left', patch: { name: 'Renamed left claw' } }],
  })
  await dialog.getByRole('alert').filter({ hasText: 'The design changed' }).waitFor()
  assert.ok(await button('Save mount edit').isDisabled())
  await button('Cancel').click()

  await page.setViewportSize({ width: 390, height: 844 })
  const inspector = page.getByRole('button', { name: 'Inspector', exact: true })
  const finishInspectorClose = await holdInspectorClose(page)
  await inspector.click()
  await open()
  await viewport.waitFor()
  const mobile = await dialog.boundingBox()
  assert.ok(mobile && mobile.x >= 0 && mobile.x + mobile.width <= 390)
  await search.focus()
  await finishInspectorClose()
  await page.keyboard.insertText('Group100')
  assert.equal(await search.inputValue(), 'Group100', 'The mount editor must keep keyboard focus')
  await option('Cage handles', 'All corners')
  await z.fill('0.5')
  await z.press('Enter')
  await button('Cancel').click()
  await inspector.and(page.locator(':focus')).waitFor()

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.locator('[data-node="right"]').click()
  await page.setViewportSize({ width: 390, height: 844 })
  const finishReviewHandoff = await holdInspectorClose(page)
  await inspector.click()
  const inspectorSheet = page.getByRole('dialog', { name: 'Inspector' })
  await inspectorSheet.getByRole('button', { name: 'Review materials', exact: true }).click()
  const review = page.getByRole('dialog', { name: 'Review materials' })
  const filter = review.getByRole('searchbox', { name: 'Filter Rhino bodies' })
  await filter.and(page.locator(':focus')).waitFor()
  await finishReviewHandoff()
  await page.keyboard.insertText('Workshop')
  assert.equal(
    await filter.inputValue(),
    'Workshop',
    'The material review must keep keyboard focus',
  )
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  await inspector.and(page.locator(':focus')).waitFor()

  assert.equal((await getPiece()).version, before.version + 5)
  console.log(
    'Passed multi-body mount search and picking, cage drag, millimetre offsets, refit, restore, Undo, version guard and mobile controls.',
  )
} finally {
  await browser.close()
}
