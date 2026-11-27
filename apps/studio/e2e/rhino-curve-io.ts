// Run against a disposable local server: pnpm exec tsx apps/studio/e2e/rhino-curve-io.ts <base>
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { readRhino3dm } from '../../../packages/kernel/src/import/rhino'
import { MAX_MODEL_IMPORT_OPS, type Piece } from '../../../packages/schema/src/index'

const require = createRequire(import.meta.url)
const { chromium, webkit } = require('playwright') as typeof import('playwright')
const kernelRequire = createRequire(
  new URL('../../../packages/kernel/package.json', import.meta.url),
)
const rhino = await kernelRequire('rhino3dm')({
  wasmBinary: await readFile(kernelRequire.resolve('rhino3dm/rhino3dm.wasm')),
})
const base = process.argv[2]
if (!base) throw Error('Pass the URL of a disposable local server.')

function fixture(curveCount: number) {
  const doc = new rhino.File3dm()
  doc.settings().modelUnitSystem = rhino.UnitSystem.Centimeters
  const table = doc.objects()
  const layers = doc.layers()
  const addLayer = (name: string) => {
    const layer = new rhino.Layer()
    layer.name = name
    return layers.add(layer)
  }
  const attributes = (name: string, layer: number) => {
    const attrs = new rhino.ObjectAttributes()
    attrs.name = name
    attrs.layerIndex = layer
    return attrs
  }
  const mounts = addLayer('Mounts')
  const rails = addLayer('Rail curves')
  const mesh = new rhino.Mesh()
  const vertices = mesh.vertices()
  const faces = mesh.faces()
  for (const point of [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ] as const)
    vertices.add(...point)
  for (const face of [
    [0, 2, 1],
    [0, 1, 3],
    [0, 3, 2],
    [1, 2, 3],
  ] as const)
    faces.addTriFace(...face)
  table.addMesh(mesh, attributes('Mount', mounts))
  for (let i = 0; i < curveCount; i++)
    table.addLine([2, 0, i], [2, 3, i + 1], attributes(`Rail ${i + 1}`, rails))
  return {
    name: 'Generated curves.3dm',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(doc.toByteArray()),
  }
}

const browser =
  process.env.PAVE_TEST_BROWSER === 'webkit'
    ? await webkit.launch()
    : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const rpc = async <T>(name: string, data: object): Promise<T> => {
    const response = await page.request.post(`${base}/api/rpc/${name}`, { data })
    assert.ok(response.ok(), `${name}: ${response.status()} ${await response.text()}`)
    return response.json()
  }
  const openEmptyProject = async () => {
    const { id } = await rpc<{ id: string }>('pieces.create', {
      title: 'Generated curve proof',
      kind: 'pendant',
    })
    await page.goto(`${base}/pieces/${id}/design`)
    return id
  }
  const dialog = page.getByRole('dialog', { name: 'Import model' })
  const chooseFile = async (curveCount: number) => {
    await page.getByRole('button', { name: 'Import model', exact: true }).click()
    await dialog.locator('input[type=file]').setInputFiles(fixture(curveCount))
  }
  const includeCurves = dialog.getByRole('checkbox', { name: /Include editable curves/ })
  const awaitPartCount = async (id: string, count: number): Promise<Piece> => {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const piece = await rpc<Piece>('pieces.get', { id })
      if (piece.design.order.length === count) return piece
      await new Promise((resolve) => setTimeout(resolve, 75))
    }
    assert.fail(`Import or undo did not settle at ${count} nodes`)
  }
  const exportFile = async (id: string) => {
    const { asset } = await rpc<{ asset: { url: string } }>('design.export', {
      pieceId: id,
      format: '3dm',
    })
    const response = await page.request.get(`${base}${asset.url}`)
    assert.ok(response.ok())
    return readRhino3dm(await response.body(), { includeCurves: true })
  }

  const id = await openEmptyProject()
  await chooseFile(1)
  await dialog.getByRole('heading', { name: 'Skipped 1 object' }).waitFor()
  assert.equal(await includeCurves.isChecked(), false)
  await includeCurves.check()
  await dialog.getByText('Converted to NURBS', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: 'Import 1 part and 1 curve', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  const imported = await awaitPartCount(id, 2)
  assert.equal(imported.version, 1)
  const nodes = Object.values(imported.design.nodes)
  assert.deepEqual(
    nodes.map(({ kind }) => kind),
    ['meshBody', 'nurbsCurve'],
  )
  const curve = nodes[1]!
  assert.equal(curve.kind, 'nurbsCurve')
  assert.deepEqual(curve.controlPoints, [
    [20, 0, 0, 1],
    [20, 30, 10, 1],
  ])
  const mixed = await exportFile(id)
  assert.equal(mixed.objects.length, 1)
  assert.equal(mixed.curves.length, 1)
  assert.deepEqual(mixed.curves[0]?.controlPoints, curve.controlPoints)
  assert.equal(mixed.curves[0]?.layer, 'Rail curves')

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await awaitPartCount(id, 0)

  await chooseFile(1)
  await includeCurves.check()
  await dialog.getByRole('checkbox', { name: 'Mounts' }).uncheck()
  await dialog.getByRole('button', { name: 'Import 1 curve', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  const curvesOnly = await awaitPartCount(id, 1)
  assert.deepEqual(
    Object.values(curvesOnly.design.nodes).map(({ kind }) => kind),
    ['nurbsCurve'],
  )
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByText('For Rhino', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  const reopened = await exportFile(id)
  assert.equal(reopened.objects.length, 0)
  assert.equal(reopened.curves.length, 1)

  await openEmptyProject()
  await chooseFile(MAX_MODEL_IMPORT_OPS)
  const displayedLimit = await page.evaluate(
    (limit) => limit.toLocaleString(),
    MAX_MODEL_IMPORT_OPS,
  )
  await dialog.getByRole('heading', { name: `Skipped ${displayedLimit} objects` }).waitFor()
  await includeCurves.check()
  await dialog.getByText(`Select layers with up to ${MAX_MODEL_IMPORT_OPS} items`).waitFor()
  assert.equal(
    await dialog
      .getByRole('button', { name: `Import 1 part and ${displayedLimit} curves` })
      .isDisabled(),
    true,
  )
  await dialog.getByRole('checkbox', { name: 'Mounts' }).uncheck()
  assert.equal(
    await dialog.getByRole('button', { name: `Import ${displayedLimit} curves` }).isEnabled(),
    true,
  )
  console.log(
    `Verified opt-in and mixed Rhino curve import, one-edit undo, exact exports, and the ${MAX_MODEL_IMPORT_OPS}-item limit.`,
  )
} finally {
  await browser.close()
}
