// Run against a disposable local server: pnpm exec tsx apps/studio/e2e/model-import.ts <base>
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import type { CommandOutput, Design, Piece } from '@pave/schema'
import { parseStl } from '../../../packages/kernel/src/mesh/parse/stl'
import { boundsOfPositions } from '../../../packages/kernel/src/solid/meshing'

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

// Two closed tetrahedra, in inches, with different sizes and a shared off-origin placement.
const doc = new rhino.File3dm()
doc.settings().modelUnitSystem = rhino.UnitSystem.Inches
const layers = doc.layers()
const addLayer = (name: string) => {
  const layer = new rhino.Layer()
  layer.name = name
  return layers.add(layer)
}
const jewelry = addLayer('Jewelry')
const lights = addLayer('Lights')
const objects = doc.objects()
const faces = [
  [0, 2, 1],
  [0, 1, 3],
  [0, 3, 2],
  [1, 2, 3],
]
for (const [name, x, size, layer] of [
  ['Mount', 0.25, 0.25, jewelry],
  ['Bail', 1, 0.5, jewelry],
  ['Distant stage', 10, 0.5, lights],
] as const) {
  const mesh = new rhino.Mesh()
  const vertices = mesh.vertices()
  vertices.add(x, 0.125, -0.25)
  vertices.add(x + size, 0.125, -0.25)
  vertices.add(x, 0.125 + size, -0.25)
  vertices.add(x, 0.125, -0.25 + size)
  for (const face of faces) mesh.faces().addTriFace(...face)
  const attrs = new rhino.ObjectAttributes()
  attrs.name = name
  attrs.layerIndex = layer
  assert.ok(objects.addMesh(mesh, attrs))
}
const guide = new rhino.ObjectAttributes()
guide.name = 'Sizing guide'
guide.layerIndex = jewelry
objects.addLine([0, 0, 0], [1, 1, 1], guide)
const rhinoFile = {
  name: 'pendant.3dm',
  mimeType: 'application/octet-stream',
  buffer: Buffer.from(doc.toByteArray()),
}

const stlFile = {
  name: 'offset.stl',
  mimeType: 'model/stl',
  buffer: Buffer.from(
    [
      'solid offset',
      ...faces.flatMap((face) => [
        'facet normal 0 0 0',
        'outer loop',
        ...face.map((i) => `vertex ${['1 2 3', '2 2 3', '1 3 3', '1 2 4'][i]}`),
        'endloop',
        'endfacet',
      ]),
      'endsolid offset',
    ].join('\n'),
  ),
}

const browser =
  process.env.PAVE_TEST_BROWSER === 'webkit'
    ? await webkit.launch()
    : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const rpc = async (name: string, data: object) => {
    const response = await page.request.post(`${base}/api/rpc/${name}`, { data })
    assert.ok(response.ok(), `${name}: ${response.status()} ${await response.text()}`)
    return response.json()
  }
  const payload = async (url: string) => {
    const response = await page.request.get(`${base}${url}`)
    assert.ok(response.ok(), `${url}: ${response.status()}`)
    return response.body()
  }
  const until = async (condition: () => Promise<boolean>) => {
    const end = Date.now() + 15_000
    while (Date.now() < end) {
      if (await condition()) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.fail('CAD change did not settle')
  }
  const { id } = await rpc('pieces.create', { title: 'Rhino migration', kind: 'pendant' })
  const open = (pieceId = id) => page.goto(`${base}/pieces/${pieceId}/design`)
  const piece = () => rpc('pieces.get', { id })
  const dialog = page.getByRole('dialog', { name: 'Import model' })
  const choose = async (file: typeof rhinoFile) => {
    await page.getByRole('button', { name: 'Import model', exact: true }).click()
    await dialog.locator('input[type=file]').setInputFiles(file)
  }
  const uncheck = (layer: string) => dialog.getByRole('checkbox', { name: layer }).uncheck()
  const previewBounds = (size: string) => dialog.getByText(size, { exact: true }).waitFor()
  const undo = () => page.getByRole('button', { name: 'Undo', exact: true }).click()

  await page.setViewportSize({ width: 390, height: 844 })
  await open()
  await choose(rhinoFile)
  await previewBounds('260.35 × 12.7 × 12.7 mm')
  const dialogBox = await dialog.boundingBox()
  assert.ok(dialogBox && dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= 390)
  await dialog.getByText('inches', { exact: true }).waitFor()
  await dialog.getByText('Sizing guide', { exact: true }).waitFor()
  await uncheck('Lights')
  await previewBounds('31.75 × 12.7 × 12.7 mm')
  await uncheck('Jewelry')
  assert.ok(await dialog.getByRole('button', { name: 'Import', exact: true }).isDisabled())
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal((await piece()).version, 0)

  await page.setViewportSize({ width: 1440, height: 900 })
  await choose(rhinoFile)
  await uncheck('Lights')
  let uploadAttempts = 0
  await page.route('**/api/assets', async (route) => {
    if (route.request().method() === 'POST' && uploadAttempts++ === 0) {
      await route.abort()
    } else await route.continue()
  })
  await dialog.getByRole('button', { name: 'Import 2 parts' }).click()
  await dialog.getByRole('alert').waitFor()
  assert.equal((await piece()).version, 0)
  await dialog.getByRole('button', { name: 'Import 2 parts' }).click()
  await until(async () => (await piece()).design.order.length === 2)
  await page.unroute('**/api/assets')
  assert.equal(uploadAttempts, 3)
  const imported = await piece()
  assert.equal(imported.version, 1)
  const byName = (design: Design) => design.order.map((nodeId) => design.nodes[nodeId]!.name)
  const roles = (design: Design) =>
    design.order.map((nodeId) => {
      const node = design.nodes[nodeId]
      assert.ok(node?.kind === 'meshBody')
      return node.importRole
    })
  assert.deepEqual(byName(imported.design), ['Mount', 'Bail'])
  assert.deepEqual(roles(imported.design), ['unassigned', 'unassigned'])
  await undo()
  await until(async () => (await piece()).design.order.length === 0)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await until(async () => (await piece()).design.order.length === 2)
  await page.reload()
  await page.getByText('Bail', { exact: true }).first().waitFor()
  assert.deepEqual(byName((await piece()).design), ['Mount', 'Bail'])

  const archive = await rpc('pieces.saveFile', { id })
  const saved = await payload(archive.asset.url)
  const uploaded = await page.request.post(`${base}/api/assets`, {
    multipart: {
      file: { name: 'pendant.pave', mimeType: 'application/octet-stream', buffer: saved },
    },
  })
  assert.ok(uploaded.ok())
  const reopened = (await rpc('pieces.openFile', {
    assetId: (await uploaded.json()).id,
  })) as CommandOutput<'pieces.openFile'>
  assert.deepEqual(byName(reopened.piece.design), ['Mount', 'Bail'])
  assert.deepEqual(roles(reopened.piece.design), ['unassigned', 'unassigned'])
  for (const node of Object.values(reopened.piece.design.nodes)) {
    assert.ok(node.kind === 'meshBody' && node.source.type === 'asset')
    assert.equal(node.source.rhinoLayer, 'Jewelry')
  }
  await open(reopened.piece.id)
  await page.getByText('Bail', { exact: true }).first().waitFor()
  await page.getByText('Bail', { exact: true }).first().click()
  await page.getByText('Rhino layer · Jewelry', { exact: true }).waitFor()

  const pieceId = reopened.piece.id
  const readReopened = async () => (await rpc('pieces.get', { id: pieceId })) as Piece
  const noMetal = await rpc('design.evaluate', { pieceId, detail: 'production' })
  assert.equal(noMetal.metalMassG, 0)
  const unassignedExport = await page.request.post(`${base}/api/rpc/design.export`, {
    data: { pieceId, format: 'stl', stones: false },
  })
  assert.equal(unassignedExport.status(), 409)
  assert.match(await unassignedExport.text(), /Nothing to export.*no metal/)

  const review = page.getByRole('dialog', { name: 'Review Rhino roles' })
  for (const [index, name] of ['Mount', 'Bail'].entries()) {
    await page.getByRole('treeitem', { name: new RegExp(name) }).click()
    await page.getByText('Rhino role · Unassigned', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Review role', exact: true }).click()
    await review.getByRole('combobox', { name: 'Role', exact: true }).click()
    await page.getByRole('option', { name: 'Metal', exact: true }).click()
    const confirm = review.getByRole('button', { name: 'Confirm role', exact: true })
    assert.ok(await confirm.isDisabled(), 'A casting alloy must be chosen explicitly.')
    await review.getByRole('combobox', { name: 'Alloy', exact: true }).click()
    await page.getByRole('option', { name: '18k Yellow Gold', exact: true }).click()
    await confirm.click()
    await review.waitFor({ state: 'hidden' })
    await until(async () => roles((await readReopened()).design)[index] === 'metal')
  }
  const classified = await readReopened()
  assert.deepEqual(roles(classified.design), ['metal', 'metal'])
  for (const nodeId of classified.design.order) {
    const original = reopened.piece.design.nodes[nodeId]
    const current = classified.design.nodes[nodeId]
    assert.ok(original?.kind === 'meshBody' && current?.kind === 'meshBody')
    assert.deepEqual(current.source, original.source)
  }
  const metal = await rpc('design.evaluate', { pieceId, detail: 'production' })
  assert.ok(metal.metalMassG > 0)
  const cast = await rpc('design.export', { pieceId, format: 'stl', stones: false })
  const triangles = parseStl(await payload(cast.asset.url))
  assert.equal(triangles.indices.length, 24)
  const bounds = boundsOfPositions(triangles.positions)
  const rounded = (xs: ArrayLike<number>) => Array.from(xs, (x) => Number(x.toFixed(3)))
  assert.deepEqual(rounded(bounds.min), [6.35, 3.175, -6.35])
  assert.deepEqual(rounded(bounds.max), [38.1, 15.875, 6.35])
  const xCoordinates = new Set(rounded(triangles.positions.filter((_, i) => i % 3 === 0)))
  assert.deepEqual(
    [...xCoordinates].sort((a, b) => a - b),
    [6.35, 12.7, 25.4, 38.1],
  )

  await open()
  await choose(stlFile)
  await dialog.getByText('1 × 1 × 1 mm', { exact: true }).waitFor()
  await dialog.getByLabel('STL source units').click()
  await page.getByRole('option', { name: 'Inches', exact: true }).click()
  await dialog.getByText('25.4 × 25.4 × 25.4 mm', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: 'Import 1 part' }).click()
  await until(async () => (await piece()).design.order.length === 3)
  const withStl = (await piece()).design
  assert.deepEqual(byName(withStl), ['Mount', 'Bail', 'offset'])
  assert.deepEqual(roles(withStl), ['unassigned', 'unassigned', undefined])
  assert.ok((await rpc('design.evaluate', { pieceId: id, detail: 'production' })).metalMassG > 0)
  const importedStl = await payload(`/api/assets/${withStl.nodes[withStl.order[2]].source.assetId}`)
  const stlBounds = boundsOfPositions(parseStl(importedStl).positions)
  assert.deepEqual(rounded(stlBounds.min), [25.4, 50.8, 76.2])
  assert.deepEqual(rounded(stlBounds.max), [50.8, 76.2, 101.6])

  await undo()
  await until(async () => (await piece()).design.order.length === 2)
  console.log(
    'Passed Rhino and STL import preview, cancel, named assembly, reopen, role confirmation, STL readback and grouped undo.',
  )
} finally {
  await browser.close()
}
