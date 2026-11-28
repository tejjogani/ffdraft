// Run against a disposable local server: pnpm exec tsx apps/studio/e2e/mesh-edit.ts <base>
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { parseStl } from '../../../packages/kernel/src/mesh/parse/stl'
import { boundsOfPositions } from '../../../packages/kernel/src/solid/meshing'

const base = process.argv[2]
if (!base) throw Error('Pass the URL of a disposable local server.')

const { chromium, webkit } = createRequire(import.meta.url)(
  'playwright',
) as typeof import('playwright')
const browser =
  process.env.PAVE_TEST_BROWSER === 'webkit'
    ? await webkit.launch()
    : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })

// A pre-existing, offset 10 × 10 × 5 mm box. The first top face visits vertex IDs 4, 5, 6.
// From above, another face and three distinct vertices sit directly behind the top face.
const corners = [
  [10, 30, 4],
  [20, 30, 4],
  [20, 40, 4],
  [10, 40, 4],
  [10, 30, 9],
  [20, 30, 9],
  [20, 40, 9],
  [10, 40, 9],
]
const faces = [
  [0, 2, 1],
  [0, 3, 2],
  [4, 5, 6],
  [4, 6, 7],
  [0, 1, 5],
  [0, 5, 4],
  [1, 2, 6],
  [1, 6, 5],
  [2, 3, 7],
  [2, 7, 6],
  [3, 0, 4],
  [3, 4, 7],
]
const box = Buffer.alloc(84 + 50 * faces.length)
box.writeUInt32LE(faces.length, 80)
for (const [faceIndex, face] of faces.entries())
  for (const [i, vertex] of face.entries())
    for (const [axis, mm] of corners[vertex!]!.entries())
      box.writeFloatLE(mm, 84 + 50 * faceIndex + 12 + 12 * i + 4 * axis)

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  page.on('pageerror', (error) => console.error(error.message))
  const rpc = async (name: string, data: object) => {
    const response = await page.request.post(`${base}/api/rpc/${name}`, { data })
    assert.ok(response.ok(), `${name}: ${response.status()} ${await response.text()}`)
    return response.json()
  }
  const { id } = await rpc('pieces.create', { title: 'Mesh editing proof', kind: 'pendant' })
  const upload = await page.request.post(`${base}/api/assets`, {
    multipart: { file: { name: 'box.stl', mimeType: 'model/stl', buffer: box } },
  })
  assert.ok(upload.ok(), await upload.text())
  const assetId = (await upload.json()).id
  await rpc('design.apply', {
    pieceId: id,
    label: 'Imported sample',
    ops: [
      {
        t: 'add',
        node: {
          id: 'box',
          kind: 'meshBody',
          name: 'Sample box',
          source: { type: 'asset', assetId },
          keepSourcePlacement: true,
          transform: { position: [1, 2, 30], rotation: [0, 0, 0], scale: 1 },
        },
      },
    ],
  })
  const piece = () => rpc('pieces.get', { id })
  const atVersion = async (version: number) => {
    const end = Date.now() + 12_000
    while (Date.now() < end) {
      const result = await piece()
      if (result.version === version) return result.design.nodes.box
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.fail(`Mesh edit did not reach version ${version}`)
  }
  const exportedTop = async () => {
    const { asset } = await rpc('design.export', { pieceId: id, format: 'stl' })
    const response = await page.request.get(`${base}${asset.url}`)
    assert.ok(response.ok())
    return boundsOfPositions(parseStl(await response.body()).positions).max[2]
  }
  const dialog = page.getByRole('dialog', { name: 'Edit mesh' })
  const picker = dialog.getByRole('img', { name: 'Mesh component viewport' })
  const button = (name: string) => dialog.getByRole('button', { name, exact: true })
  const openEditor = async () => {
    await page.getByText('Sample box', { exact: true }).first().click()
    await page.getByRole('button', { name: 'Edit mesh', exact: true }).click()
    await picker.waitFor()
  }
  const pickFace = async (view: string) => {
    await button(view).click()
    await button('Face').click()
    const bounds = await picker.boundingBox()
    assert.ok(bounds)
    await page.mouse.click(bounds.x + bounds.width * 0.62, bounds.y + bounds.height * 0.5)
  }

  await page.goto(`${base}/pieces/${id}/design`)
  await openEditor()
  await pickFace('Bottom')
  await dialog.getByText('Face 1 · vertices 0, 3, 1', { exact: true }).waitFor()
  await pickFace('Top')
  await dialog.getByText('Face 2 · vertices 4, 5, 6', { exact: true }).waitFor()
  const canvas = await picker.boundingBox()
  assert.ok(canvas)
  // Top view fits the box's 15 mm diagonal with 18% margin along the shorter canvas side.
  const halfSide = (Math.min(canvas.width, canvas.height) * 10) / (2 * 15 * 1.18)
  const cx = canvas.x + canvas.width / 2
  const cy = canvas.y + canvas.height / 2
  await button('Edge').click()
  await page.mouse.click(cx, cy + halfSide - 3)
  await dialog.getByText('Edge · vertices 4, 5', { exact: true }).waitFor()
  await button('Vertex').click()
  await page.mouse.click(cx + halfSide - 3, cy + halfSide - 3)
  await dialog.getByText('Vertex 5', { exact: true }).waitFor()
  await pickFace('Top')
  await dialog.getByLabel('Z displacement (mm)', { exact: true }).fill('0.5')
  await dialog.getByText('Preview', { exact: true }).waitFor()
  if (process.env.PAVE_MESH_SCREENSHOT)
    await page.screenshot({ path: process.env.PAVE_MESH_SCREENSHOT })
  assert.equal((await piece()).version, 1)
  await button('Cancel').click()

  await openEditor()
  await pickFace('Top')
  await dialog.getByLabel('Z displacement (mm)', { exact: true }).fill('0.5')
  await button('Save mesh edit').click()
  const edited = await atVersion(2)
  assert.deepEqual(edited.meshEdits, {
    assetId,
    vertices: { '4': [10, 30, 9.5], '5': [20, 30, 9.5], '6': [20, 40, 9.5] },
  })
  assert.equal(await exportedTop(), 39.5)
  const history = await rpc('design.history', { pieceId: id, limit: 5 })
  assert.equal(history.length, 2)

  const reopened = await context.newPage()
  await reopened.goto(`${base}/pieces/${id}/design`)
  await reopened.getByText('Sample box', { exact: true }).first().click()
  await reopened.getByRole('button', { name: 'Edit mesh', exact: true }).click()
  const reopenedDialog = reopened.getByRole('dialog', { name: 'Edit mesh' })
  await reopenedDialog.getByLabel('Vertex ID', { exact: true }).fill('4')
  await reopenedDialog.getByRole('button', { name: 'Select vertex' }).click()
  await reopenedDialog.getByText('X 10 · Y 30 · Z 9.5 mm', { exact: true }).waitFor()
  await reopened.close()

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  assert.equal((await atVersion(3)).meshEdits, undefined)
  assert.equal(await exportedTop(), 39)
  await openEditor()
  await pickFace('Top')
  await dialog.getByLabel('Z displacement (mm)', { exact: true }).fill('0.5')
  await rpc('design.apply', {
    pieceId: id,
    label: 'Concurrent rename',
    ops: [{ t: 'update', id: 'box', patch: { name: 'Updated box' } }],
  })
  await dialog.getByRole('alert').filter({ hasText: 'The design changed' }).waitFor()
  assert.ok(await button('Save mesh edit').isDisabled())
  await button('Cancel').click()
  assert.equal((await atVersion(4)).meshEdits, undefined)

  await page.setViewportSize({ width: 390, height: 844 })
  const inspector = page.getByRole('button', { name: 'Inspector', exact: true })
  const inspectorSheet = page.locator('[role="dialog"]:has([data-region="inspector"])')
  // Control when the Inspector unmounts so we can test typing across the focus handoff.
  await page.addStyleTag({
    content: `
      @keyframes inspector-exit { from { opacity: 1; } to { opacity: 0; } }
      [role="dialog"]:has([data-region="inspector"])[data-ending-style] {
        animation: inspector-exit 1s paused;
      }
    `,
  })
  await inspector.click()
  await page.getByRole('button', { name: 'Edit mesh', exact: true }).click()
  await picker.waitFor()
  const mobile = await dialog.boundingBox()
  assert.ok(mobile && mobile.x >= 0 && mobile.x + mobile.width <= 390)
  const vertexId = dialog.getByLabel('Vertex ID', { exact: true })
  await vertexId.focus()
  const finishedAnimations = await inspectorSheet.evaluate((element) => {
    const animations = element.getAnimations()
    for (const animation of animations) animation.finish()
    return animations.length
  })
  assert.ok(finishedAnimations, 'The Inspector sheet is still closing')
  await inspectorSheet.waitFor({ state: 'detached' })
  await page.keyboard.insertText('4')
  assert.equal(await vertexId.inputValue(), '4', 'The mesh editor must keep keyboard focus')
  await button('Select vertex').click()
  await dialog.getByText('X 10 · Y 30 · Z 9 mm', { exact: true }).waitFor()
  await button('Cancel').click()
  await inspector.and(page.locator(':focus')).waitFor()

  console.log(
    'Passed viewport vertex, edge and face picking, preview, cancel, save, reopen, undo, version fencing and the mobile inspector.',
  )
} finally {
  await browser.close()
}
