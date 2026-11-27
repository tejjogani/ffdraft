// pnpm exec tsx apps/studio/e2e/large-model-import.ts <disposable loopback server>
// To check a local file, append its path, the expected part count, and the expected curve count.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import type { Design, NodeOf, Piece } from '@pave/schema'
import { MAX_MODEL_IMPORT_OPS } from '@pave/schema'

const [server, localPath, expectedParts, expectedCurves] = process.argv.slice(2)
assert.ok(server, 'Pass the URL of a disposable local server.')
const base = new URL(server)
assert.ok(
  base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname),
  'The regression requires a loopback server.',
)
const parts = localPath ? Number(expectedParts) : 2
const curves = localPath ? Number(expectedCurves) : 501
assert.ok(Number.isInteger(parts) && parts > 0, 'Pass a positive expected part count.')
assert.ok(Number.isInteger(curves) && curves > 0, 'Pass a positive expected curve count.')

const require = createRequire(import.meta.url)
const { chromium, webkit } = require('playwright') as typeof import('playwright')
const kernelRequire = createRequire(
  new URL('../../../packages/kernel/package.json', import.meta.url),
)
const rhino = await kernelRequire('rhino3dm')({
  wasmBinary: await readFile(kernelRequire.resolve('rhino3dm/rhino3dm.wasm')),
})

function makeFixture(meshes: number, constructionCurves: number) {
  const doc = new rhino.File3dm()
  doc.settings().modelUnitSystem = rhino.UnitSystem.Millimeters
  const table = doc.objects()
  const attrs = new rhino.ObjectAttributes()
  for (let i = 0; i < meshes; i++) {
    const mesh = new rhino.Mesh()
    const vertices = mesh.vertices()
    for (const [x, y, z] of [
      [0, 0, 0],
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2],
    ])
      vertices.add(x! + 4 * i, y!, z!)
    const faces = mesh.faces()
    for (const face of [
      [0, 2, 1],
      [0, 1, 3],
      [0, 3, 2],
      [1, 2, 3],
    ])
      faces.addTriFace(...face)
    attrs.name = `Test part ${i + 1}`
    table.addMesh(mesh, attrs)
  }
  for (let i = 0; i < constructionCurves; i++) {
    const x = i % 40
    const y = Math.floor(i / 40) * 2
    attrs.name = `Test curve ${i + 1}`
    table.addLine([x, y, 0], [x, y + 1, 1], attrs)
  }
  return Buffer.from(doc.toByteArray())
}

const source = localPath ? await readFile(localPath) : makeFixture(parts, curves)
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const browser =
  process.env.PAVE_TEST_BROWSER === 'webkit'
    ? await webkit.launch()
    : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })

const bodyNodes = (design: Design) =>
  Object.values(design.nodes).filter((node): node is NodeOf<'meshBody'> => node.kind === 'meshBody')

function checkCounts(design: Design) {
  assert.equal(design.order.length, parts + curves)
  assert.equal(bodyNodes(design).length, parts)
  assert.equal(
    Object.values(design.nodes).filter(({ kind }) => kind === 'nurbsCurve').length,
    curves,
  )
}

function bodyMetadata(design: Design) {
  return bodyNodes(design).map((body) => {
    assert.equal(body.source.type, 'asset')
    const { assetId, nativeAssetId, nativeMeshAssetId, ...provenance } = body.source
    return {
      ...body,
      source: {
        ...provenance,
        nativeSourceSaved: !!nativeAssetId,
        meshMatchesNativeSource: nativeMeshAssetId === assetId,
      },
    }
  })
}

function checkNativeReuse(design: Design) {
  const groups = new Map<string, Set<string>>()
  for (const { source } of bodyNodes(design)) {
    if (source.type !== 'asset' || !source.rhinoObjectId || !source.nativeAssetId) continue
    const assets = groups.get(source.rhinoObjectId) ?? new Set<string>()
    assets.add(source.nativeAssetId)
    groups.set(source.rhinoObjectId, assets)
  }
  assert.ok(
    [...groups.values()].every((assets) => assets.size === 1),
    'Native sources were duplicated.',
  )
}

try {
  const context = await browser.newContext({ viewport: { width: 1250, height: 800 } })
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === base.origin) await route.continue()
    else await route.abort()
  })
  const page = await context.newPage()
  const rpc = async (name: string, data: object) => {
    const response = await context.request.post(new URL(`/api/rpc/${name}`, base).href, {
      data,
      maxRedirects: 0,
    })
    assert.ok(response.ok(), `${name} failed with HTTP ${response.status()}.`)
    return response.json()
  }
  const { id } = (await rpc('pieces.create', {
    title: 'Large model import check',
    kind: 'other',
  })) as Piece
  const piece = async () => (await rpc('pieces.get', { id })) as Piece
  const designUrl = (pieceId = id) => new URL(`/pieces/${pieceId}/design`, base).href
  const waitVersion = async (version: number) => {
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      const current = await piece()
      if (current.version === version) return current
      assert.ok(current.version < version, 'The edit consumed more than one project version.')
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    assert.fail(`The project did not reach version ${version}.`)
  }
  const dialog = page.getByRole('dialog', { name: 'Import model' })
  const choose = async (buffer: Buffer) => {
    await page.getByRole('button', { name: 'Import model', exact: true }).click()
    await dialog.locator('input[type=file]').setInputFiles({
      name: 'assembly.3dm',
      mimeType: 'application/octet-stream',
      buffer,
    })
    await dialog.getByRole('checkbox', { name: /Include editable curves/ }).check()
    await dialog.getByText('Rhino file units', { exact: true }).waitFor()
  }
  await page.goto(designUrl())
  if (!localPath) {
    await choose(makeFixture(0, MAX_MODEL_IMPORT_OPS + 1))
    await dialog
      .getByText(`Select layers with up to ${MAX_MODEL_IMPORT_OPS} items`, { exact: false })
      .waitFor()
    assert.equal(await dialog.getByRole('button', { name: /^Import / }).isDisabled(), true)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    assert.equal((await piece()).version, 0)
  }

  const requestBytes: number[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/rpc/design.apply') {
      requestBytes.push(Buffer.byteLength(request.postData() ?? ''))
    }
  })
  await choose(source)
  const start = Date.now()
  await dialog
    .getByRole('button', {
      name: `Import ${parts} ${parts === 1 ? 'part' : 'parts'} and ${curves} ${curves === 1 ? 'curve' : 'curves'}`,
      exact: true,
    })
    .click()
  const imported = await waitVersion(1)
  const importSeconds = (Date.now() - start) / 1000
  checkCounts(imported.design)
  checkNativeReuse(imported.design)
  await page.getByRole('button', { name: 'Undo', exact: true }).click({ timeout: 90_000 })
  assert.equal((await waitVersion(2)).design.order.length, 0)
  await page.getByRole('button', { name: 'Redo', exact: true }).click({ timeout: 90_000 })
  assert.deepEqual((await waitVersion(3)).design, imported.design)
  assert.equal(requestBytes.length, 3, 'Import, undo and redo should each use one RPC request.')
  await page.reload()
  await page.getByRole('button', { name: 'Import model', exact: true }).waitFor({ timeout: 90_000 })
  assert.deepEqual((await piece()).design, imported.design)

  const saved = await rpc('pieces.saveFile', { id })
  const archiveUrl = new URL(saved.asset.url, base)
  assert.equal(
    archiveUrl.origin,
    base.origin,
    'A disposable server must serve the archive locally.',
  )
  const archiveResponse = await context.request.get(archiveUrl.href, { maxRedirects: 0 })
  assert.ok(archiveResponse.ok(), 'Could not read the saved project archive.')
  const uploaded = await context.request.post(new URL('/api/assets', base).href, {
    maxRedirects: 0,
    multipart: {
      file: {
        name: 'assembly.pave',
        mimeType: 'application/octet-stream',
        buffer: await archiveResponse.body(),
      },
    },
  })
  assert.ok(uploaded.ok(), 'Could not upload the archive to the disposable project server.')
  const reopened = await rpc('pieces.openFile', { assetId: (await uploaded.json()).id })
  checkCounts(reopened.piece.design)
  checkNativeReuse(reopened.piece.design)
  assert.deepEqual(bodyMetadata(reopened.piece.design), bodyMetadata(imported.design))
  const reopenedCurves = Object.values(reopened.piece.design.nodes).filter(
    (node): node is NodeOf<'nurbsCurve'> => (node as NodeOf<'nurbsCurve'>).kind === 'nurbsCurve',
  )
  assert.deepEqual(
    reopenedCurves,
    Object.values(imported.design.nodes).filter(({ kind }) => kind === 'nurbsCurve'),
  )
  await page.goto(designUrl(reopened.piece.id))
  await page.getByRole('button', { name: 'Import model', exact: true }).waitFor({ timeout: 90_000 })
  if (localPath)
    assert.equal(digest(await readFile(localPath)), digest(source), 'Source archive changed.')
  console.log(
    JSON.stringify({
      parts,
      curves,
      importSeconds,
      requestBytes: { import: requestBytes[0], undo: requestBytes[1], redo: requestBytes[2] },
    }),
  )
} finally {
  await browser.close()
}
