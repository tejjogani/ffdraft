// Run against a disposable local server: pnpm exec tsx apps/studio/e2e/construction-curves.ts <base>
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { NodeOf } from '@pave/schema'
import type { chromium as chromiumType } from 'playwright'

const { chromium } = createRequire(import.meta.url)('playwright') as {
  chromium: typeof chromiumType
}
const base = process.argv[2]
if (!base) throw Error('Pass the URL of a disposable local server.')
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(`Object.defineProperty(window, 'showSaveFilePicker', {
    value: async (options) => ({
      createWritable: async () => ({
        write: async (blob) => { window.saved = { name: options.suggestedName, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) } },
        close: async () => {},
      }),
    }),
  })`)
  const page = await context.newPage()
  const rpc = async (name: string, data: object) => {
    const response = await page.request.post(`${base}/api/rpc/${name}`, { data })
    assert.ok(response.ok(), `${name}: ${response.status()}`)
    return response.json()
  }
  let { id } = await rpc('pieces.create', { title: 'Construction curves', kind: 'other' })
  const piece = () => rpc('pieces.get', { id })
  const cad = () => page.goto(`${base}/pieces/${id}/design`)
  const until = async (condition: () => Promise<boolean>) => {
    for (let i = 0; i < 80; i++) {
      if (await condition()) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.fail('CAD change did not settle')
  }
  const draw = () => page.getByRole('button', { name: 'Draw curve', exact: true }).click()
  const editor = (name = 'Draw curve') => page.getByRole('region', { name, exact: true })
  const savedCurves = () => page.locator('[data-construction-curve]')
  await cad()
  await draw()
  await editor().getByRole('button', { name: 'Cancel' }).click()
  assert.equal((await piece()).version, 0)

  await draw()
  for (const x of ['-8', '8']) {
    await editor().getByRole('spinbutton', { name: 'X (mm)' }).fill(x)
    await editor().getByRole('spinbutton', { name: 'Z (mm)' }).fill('0')
    await editor().getByRole('button', { name: 'Add point' }).click()
  }
  await editor().getByRole('button', { name: 'Save curve' }).click()
  await until(async () => (await piece()).design.order.length === 1)
  await savedCurves().first().waitFor({ state: 'attached' })

  await draw()
  const surface = editor().locator('[data-curve-drawing-area]')
  const bounds = (await surface.boundingBox())!
  const path = (await savedCurves().first().locator('path').first().getAttribute('d'))!
  const [aX, aY, bX, bY] = path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number)
  for (const [x, y, label] of [
    [(aX! + bX!) / 2, (aY! + bY!) / 2, 'Midpoint'],
    [bX!, bY!, 'Endpoint'],
  ] as const) {
    await page.mouse.move(bounds.x + x + 2, bounds.y + y + 2)
    await editor().getByText(label, { exact: true }).waitFor()
    await page.mouse.click(bounds.x + x + 2, bounds.y + y + 2)
  }
  await editor().getByRole('button', { name: 'Save curve' }).click()
  await until(async () => (await piece()).design.order.length === 2)
  const original = (await piece()).design
  const secondId = original.order[1]
  const positions = (node: NodeOf<'curve'>) => node.points.map(({ u, v }) => [u, v])
  assert.deepEqual(positions(original.nodes[secondId]), [
    [0, 0],
    [8, 0],
  ])

  await page.getByRole('button', { name: 'Edit points' }).click()
  const edits = editor('Edit curve points')
  await edits.getByRole('button', { name: /^Point 2/ }).click()
  await edits.getByRole('spinbutton', { name: 'Z (mm)' }).fill('4')
  await edits.getByRole('button', { name: 'Move point', exact: true }).click()
  await edits.getByRole('button', { name: 'Save curve' }).click()
  await until(async () => (await piece()).design.nodes[secondId].points[1].v === 4)
  const changed = (await piece()).design
  assert.equal(changed.nodes[secondId].points[1].id, original.nodes[secondId].points[1].id)
  assert.deepEqual(positions(changed.nodes[secondId]), [
    [0, 0],
    [8, 4],
  ])
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await until(async () => (await piece()).design.nodes[secondId].points[1].v === 0)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await until(async () => (await piece()).design.nodes[secondId].points[1].v === 4)

  await page
    .getByRole('button', { name: /^Export/ })
    .first()
    .click()
  assert.equal(await page.getByRole('menuitem', { name: /For casting/ }).count(), 0)
  await page.getByRole('menuitem', { name: /Pavé file/ }).click()
  const handle = await page.waitForFunction(
    () => (window as unknown as { saved?: { name: string; bytes: number[] } }).saved ?? null,
  )
  const file = await handle.jsonValue()
  await page.goto(`${base}/pieces`)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open Pavé file' }).click()
  await (await chooser).setFiles({
    name: file.name,
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(file.bytes),
  })
  await page.waitForURL(/\/pieces\/pc_/)
  id = new URL(page.url()).pathname.split('/')[2]
  assert.deepEqual((await piece()).design, changed)
  await cad()
  await savedCurves().nth(1).waitFor({ state: 'attached' })
  assert.equal(await savedCurves().count(), 2)
  const scripted = {
    id: 'curve_by_script',
    kind: 'curve',
    plane: 'right',
    closed: true,
    points: [
      { id: 'a', u: 0, v: 2 },
      { id: 'b', u: 8, v: 3 },
      { id: 'c', u: 9, v: 7 },
    ],
  }
  await rpc('design.apply', {
    pieceId: id,
    label: 'Draw a curve from a script',
    ops: [{ t: 'add', node: scripted }],
  })
  await until(async () => (await piece()).design.order.length === 3)
  assert.deepEqual((await piece()).design.nodes[scripted.id].points, scripted.points)
  await savedCurves().nth(2).waitFor({ state: 'attached' })
  console.log(
    'Passed viewport drawing and snapping, keyed point edits, Undo/Redo, and Pavé curve save/reopen, plus a scripted design.apply curve.',
  )
} finally {
  await browser.close()
}
