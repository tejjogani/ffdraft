// Run against a disposable local server: pnpm exec tsx apps/studio/e2e/draw-profile.ts <base>
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
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
    assert.ok(response.ok(), `${name}: ${response.status()} ${await response.text()}`)
    return response.json()
  }
  let { id } = await rpc('pieces.create', { title: 'Measured cap', kind: 'other' })
  const design = () => rpc('pieces.get', { id })
  const cad = () => page.goto(`${base}/pieces/${id}/design`)
  const until = async (condition: () => Promise<boolean>) => {
    for (let i = 0; i < 80; i++) {
      if (await condition()) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.fail('CAD change did not settle')
  }
  await cad()
  await page.getByRole('button', { name: 'Draw profile', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'Draw a profile' })
  const canvas = dialog.getByLabel('Profile drawing area, front plane')
  await canvas.click({ position: { x: 100, y: 80 } })
  await canvas.click({ position: { x: 190, y: 80 } })
  await canvas.click({ position: { x: 190, y: 130 } })
  await dialog.getByRole('list', { name: 'Profile points' }).getByRole('listitem').last().waitFor()
  assert.equal(await dialog.getByRole('listitem').count(), 3)
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  assert.deepEqual((await design()).design.order, [])
  assert.equal((await design()).version, 0)

  await page.getByRole('button', { name: 'Draw profile', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Draw a profile' })
  await dialog.getByRole('button', { name: 'Rectangle', exact: true }).click()
  await dialog.getByRole('button', { name: 'Top', exact: true }).click()
  await dialog.getByRole('spinbutton', { name: 'Horizontal origin (mm)' }).fill('2')
  await dialog.getByRole('spinbutton', { name: 'Vertical origin (mm)' }).fill('3')
  await dialog.getByRole('spinbutton', { name: 'Width (mm)' }).fill('12')
  await dialog.getByRole('spinbutton', { name: 'Height (mm)' }).fill('7')
  await dialog.getByRole('spinbutton', { name: 'Extrusion depth (mm)' }).fill('2.5')
  await dialog.getByRole('button', { name: 'Extrude profile' }).click()
  await until(async () => (await design()).design.order.length === 1)
  const initial = (await design()).design
  const nodeId = initial.order[0]
  assert.deepEqual(initial.nodes[nodeId].source, {
    type: 'profile',
    mode: 'rectangle',
    plane: 'top',
    points: [
      [2, 3],
      [14, 3],
      [14, 10],
      [2, 10],
    ],
  })
  assert.equal(initial.nodes[nodeId].thickness, 2.5)

  await page.getByRole('button', { name: 'Draw profile', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Draw a profile' })
    .getByRole('button', { name: 'Cancel' })
    .click()
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click()
  const edit = page.getByRole('dialog', { name: 'Edit profile' })
  assert.equal(await edit.getByRole('spinbutton', { name: 'Width (mm)' }).inputValue(), '12')
  assert.equal(await edit.getByRole('spinbutton', { name: 'Height (mm)' }).inputValue(), '7')
  await edit.getByRole('spinbutton', { name: 'Width (mm)' }).fill('14')
  await edit.getByRole('spinbutton', { name: 'Extrusion depth (mm)' }).fill('3')
  await edit.getByRole('button', { name: 'Save profile' }).click()
  await until(async () => (await design()).design.nodes[nodeId]?.thickness === 3)
  const modified = (await design()).design
  assert.deepEqual(modified.nodes[nodeId].source.points, [
    [2, 3],
    [16, 3],
    [16, 10],
    [2, 10],
  ])
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await until(async () => (await design()).design.nodes[nodeId]?.thickness === 2.5)
  assert.deepEqual((await design()).design, initial)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await until(async () => (await design()).design.nodes[nodeId]?.thickness === 3)
  assert.deepEqual((await design()).design, modified)

  const savedFile = async (label: RegExp, extension: string) => {
    await page
      .getByRole('button', { name: /^Export/ })
      .first()
      .click()
    await page.getByRole('menuitem', { name: label }).click()
    const handle = await page.waitForFunction(
      (suffix) =>
        (window as unknown as { saved?: { name: string; bytes: number[] } }).saved?.name.endsWith(
          suffix,
        )
          ? (window as unknown as { saved: { name: string; bytes: number[] } }).saved
          : null,
      extension,
      { timeout: 60_000 },
    )
    const file = await handle.jsonValue()
    return { name: file.name, buffer: Buffer.from(file.bytes) }
  }

  const projectFile = await savedFile(/Pavé file/, '.pave')
  await page.goto(`${base}/pieces`)
  const chooseFile = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open Pavé file' }).click()
  await (await chooseFile).setFiles({ ...projectFile, mimeType: 'application/octet-stream' })
  await page.waitForURL(/\/pieces\/pc_/)
  const previous = id
  id = new URL(page.url()).pathname.split('/')[2]
  assert.notEqual(id, previous)
  assert.deepEqual((await design()).design, modified)
  await cad()

  const used = async () =>
    (await rpc('plan.get', {})).allowances.find(({ allowance }) => allowance === 'export').used
  const before = await used()
  const { buffer } = await savedFile(/For casting/, '.stl')
  assert.equal(await used(), before)
  const triangles = buffer.readUInt32LE(80)
  assert.ok(triangles > 0)
  assert.equal(buffer.length, 84 + 50 * triangles)
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < triangles; i++) {
    for (let vertex = 0; vertex < 3; vertex++) {
      for (let axis = 0; axis < 3; axis++) {
        const value = buffer.readFloatLE(84 + i * 50 + 12 + vertex * 12 + axis * 4)
        min[axis] = Math.min(min[axis]!, value)
        max[axis] = Math.max(max[axis]!, value)
      }
    }
  }
  assert.deepEqual(min, [2, 3, 0])
  assert.deepEqual(max, [16, 10, 3])
  await page.getByRole('button', { name: 'Draw profile', exact: true }).click()
  const added = page.getByRole('dialog', { name: 'Draw a profile' })
  await added.getByRole('button', { name: 'Right', exact: true }).click()
  const addedCanvas = added.getByLabel('Profile drawing area, right plane')
  for (const [x, y] of [
    [125, 100],
    [225, 100],
    [205, 155],
  ] as const)
    await addedCanvas.click({ position: { x, y } })
  await added.getByRole('button', { name: 'Extrude profile' }).click()
  await until(async () => (await design()).design.order.length === 2)
  const afterDrawing = (await design()).design
  const drawn = afterDrawing.nodes[afterDrawing.order[1]]
  assert.equal(drawn.source.plane, 'right')
  assert.equal(drawn.source.mode, 'polyline')
  assert.equal(drawn.source.points.length, 3)
  assert.deepEqual(afterDrawing.nodes[nodeId], modified.nodes[nodeId])
  console.log(
    'Passed measured drawing, cancellation, profile edits, Undo and Redo, Pavé save and reopen, and free STL dimensions.',
  )
} finally {
  await browser.close()
}
