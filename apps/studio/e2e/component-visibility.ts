// pnpm exec tsx apps/studio/e2e/component-visibility.ts --disposable http://127.0.0.1:<port>
// The server must use a throwaway PAVE_DATA_DIR and serve a built Studio.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import type { Piece } from '@pave/schema'

const [flag, base] = process.argv.slice(2)
if (flag !== '--disposable' || !base) throw new Error('Supply --disposable and a test server URL.')
const { chromium, webkit } = createRequire(import.meta.url)(
  'playwright',
) as typeof import('playwright')
const testWebkit = process.env.PAVE_TEST_BROWSER === 'webkit'
const browser = testWebkit
  ? await webkit.launch()
  : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'light',
  })
  page.setDefaultTimeout(10_000)
  // WebKit cannot automate the OS save picker. Capture the file handed to that boundary.
  await page.addInitScript(
    testWebkit
      ? `window.showSaveFilePicker = async () => ({
        createWritable: async () => ({
          write: async (blob) => { window.savedAssembly = blob },
          close: async () => {},
        }),
      })`
      : 'window.showSaveFilePicker = undefined',
  )
  const rpc = async (name: string, data: object) => {
    const res = await page.request.post(`${base}/api/rpc/${name}`, { data })
    assert.ok(res.ok(), `${name}: ${res.status()} ${await res.text()}`)
    return res.json()
  }
  const stamp = Date.now()
  const createRing = async (title: string): Promise<Piece> =>
    rpc('pieces.create', { title: `${title} ${stamp}`, templateId: 'oval-pave' })
  const ring = await createRing('Visibility ring')
  const other = await createRing('Another visibility ring')
  const upload = await page.request.post(`${base}/api/assets`, {
    multipart: {
      file: {
        name: 'tiny-claw.obj',
        mimeType: 'model/obj',
        buffer: Buffer.from(
          'v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4',
        ),
      },
    },
  })
  assert.ok(upload.ok(), await upload.text())
  const asset = await upload.json()
  await rpc('design.apply', {
    pieceId: ring.id,
    label: 'Add construction guides',
    // An imported Rhino polyline runs across the tables of the six positive-X shoulder
    // stones in the oval-pavé template. The second curve shares its reference layer.
    ops: [
      {
        t: 'add',
        node: {
          id: 'claw',
          name: 'Reference claw',
          kind: 'meshBody',
          importRole: 'metal',
          keepSourcePlacement: true,
          source: { type: 'asset', assetId: asset.id, rhinoLayer: 'Workshop metal' },
        },
      },
      ...[
        // The measured table centres of this template's right shoulder, in millimetres.
        [
          [6.361, 0, 11.217],
          [7.418, 0, 9.749],
          [8.009, 0, 8.015],
          [8.37, 0, 6.379],
          [8.811, 0, 5.005],
          [9.359, 0, 3.76],
        ],
        // The endpoint is inside the separate 1 mm test claw.
        [
          [0, 0, 0],
          [0.25, 0.25, 0.25],
        ],
      ].map((points, index) => ({
        t: 'add',
        node: {
          id: `guide-${index + 1}`,
          name: `Workshop guide ${index + 1}`,
          kind: 'nurbsCurve',
          sourceObjectId: `synthetic-guide-${index + 1}`,
          rhinoLayer: 'Workshop references',
          degree: 1,
          knots: points.map((_, i) => i),
          controlPoints: points.map((p) => [...p, 1]),
        },
      })),
    ],
  })
  const saved = (): Promise<Piece> => rpc('pieces.get', { id: ring.id })
  const before = await saved()
  await rpc('design.apply', {
    pieceId: other.id,
    label: 'Add a shoulder reference',
    ops: [{ t: 'add', node: before.design.nodes['guide-1'] }],
  })
  await page.goto(`${base}/pieces/${ring.id}/design`)
  const canvas = page.locator('canvas[role=application]')
  await canvas.waitFor()
  const tree = page.getByRole('tree', { name: 'Features' })
  const curves = tree.getByRole('treeitem', { name: /construction curves/i })
  const guide = tree.getByRole('treeitem', { name: /Workshop guide 1/i })
  await curves.waitFor()
  assert.equal(await curves.getAttribute('aria-expanded'), 'false')
  assert.equal(await guide.count(), 0)
  await curves.focus()
  await page.keyboard.press('ArrowRight')
  await guide.waitFor()
  await curves.focus()
  await page.keyboard.press('ArrowLeft')
  await guide.waitFor({ state: 'hidden' })

  // Chromium reads the downloaded GLB, including all gem instances. WebKit exercises
  // native project export and checks the archived design, excluding the zip timestamp.
  async function exportAssembly() {
    await page.getByRole('button', { name: /^Export/ }).click()
    const pending = testWebkit
      ? page
          .waitForFunction(
            () => (window as Window & { savedAssembly?: Blob }).savedAssembly ?? null,
            null,
            { timeout: 60000 },
          )
          .then(async (handle) => {
            const bytes = await handle.evaluate(async (blob) => [
              ...new Uint8Array(await blob.arrayBuffer()),
            ])
            await page.evaluate(
              () => delete (window as Window & { savedAssembly?: Blob }).savedAssembly,
            )
            return Buffer.from(bytes)
          })
      : page.waitForEvent('download', { timeout: 60_000 }).then(async (file) => {
          const path = await file.path()
          assert.ok(path)
          return readFile(path)
        })
    await page
      .getByRole('menuitem', { name: testWebkit ? /Pavé file/ : /For the web and AR/ })
      .click()
    const bytes = await pending
    if (testWebkit) {
      const { unzipSync } = createRequire(new URL('../../server/package.json', import.meta.url))(
        'fflate',
      ) as typeof import('fflate')
      const record = unzipSync(bytes)['piece.json']
      assert.ok(record)
      const design = JSON.parse(Buffer.from(record).toString('utf8')).design
      assert.deepEqual(design, before.design)
      return record
    }
    const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)))
    assert.equal(
      json.nodes.filter((n: { extras?: { role?: string } }) => n.extras?.role === 'gem').length,
      13,
    )
    return bytes
  }
  const assembly = await exportAssembly()
  const box = await canvas.boundingBox()
  assert.ok(box)
  type Point = { x: number; y: number }
  // Relative HUD-free space for a background click and the centre of a solo frame.
  const landmark = (x: number, y: number): Point => ({
    x: Math.round(box.x + box.width * x),
    y: Math.round(box.y + box.height * y),
  })
  const blank = landmark(0.12, 0.33)
  const menu = page.getByRole('menu', { name: '', exact: true })
  const command = (name: string) => menu.getByRole('menuitem', { name: new RegExp(`^${name}\\b`) })
  async function openMenu(p: Point) {
    await page.mouse.click(p.x, p.y, { button: 'right' })
    await menu.waitFor()
  }
  async function closeMenu() {
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'hidden' })
  }
  async function actAt(p: Point, name: string) {
    await openMenu(p)
    await command(name).click()
    await menu.waitFor({ state: 'hidden' })
  }
  async function assertHit(p: Point, name: string, present: boolean) {
    await openMenu(p)
    assert.equal(
      await command(name).isVisible(),
      present,
      `Expected ${name} at ${JSON.stringify(p)}: ${present}`,
    )
    await closeMenu()
  }
  async function colors(p: Point) {
    // A compositor screenshot reads the pixels actually drawn on screen, including overlays.
    await page.mouse.click(blank.x, blank.y)
    await page.mouse.move(0, 0)
    const bytes = await page.screenshot({ clip: { x: p.x - 3, y: p.y - 3, width: 7, height: 7 } })
    return page.evaluate(async (base64) => {
      const image = new Image()
      image.src = `data:image/png;base64,${base64}`
      await image.decode()
      const ctx = document.createElement('canvas').getContext('2d')!
      ctx.drawImage(image, 0, 0)
      return [...ctx.getImageData(0, 0, 7, 7).data]
    }, bytes.toString('base64'))
  }
  const delta = (a: number[], b: number[]) =>
    a.reduce((sum, v, i) => sum + Math.abs(v - b[i]!), 0) / (a.length * 0.75)

  await curves.getByRole('button', { name: 'Show construction curves in view' }).click()
  const path = page.locator('[data-construction-curve="guide-1"] path').first()
  await path.waitFor({ state: 'attached' })
  // Read endpoints of the SVG's projected M/L segments at the current viewport size.
  async function guideVertices(id: string) {
    return page
      .locator(`[data-construction-curve="${id}"] path`)
      .first()
      .evaluate((p) => {
        const coords = p
          .getAttribute('d')!
          .match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!
          .map(Number)
        const rect = p.closest('svg')!.getBoundingClientRect()
        return coords
          .filter((_, i) => i % 4 === 2)
          .map((x, n) => ({
            x: Math.round(rect.left + x),
            y: Math.round(rect.top + coords[n * 4 + 3]!),
          }))
      })
  }
  const rowPoints = await guideVertices('guide-1')
  const stone = rowPoints[1]!
  const neighbor = rowPoints[3]!
  const [claw] = await guideVertices('guide-2')
  assert.ok(claw)
  await page.mouse.click(stone.x, stone.y)
  const selectedInstance = tree.getByRole('treeitem', {
    name: /^Stone \d+ of Shoulder stones$/,
    selected: true,
  })
  await selectedInstance.waitFor()
  await assertHit(stone, 'Hide stone', true)
  await curves.getByRole('button', { name: 'Hide construction curves in view' }).click()
  await path.waitFor({ state: 'detached' })
  await page.mouse.click(stone.x, stone.y)
  await selectedInstance.waitFor()
  const stoneName = await selectedInstance.getAttribute('aria-label')
  await page.mouse.click(neighbor.x, neighbor.y)
  await selectedInstance.waitFor()
  assert.notEqual(await selectedInstance.getAttribute('aria-label'), stoneName)
  await assertHit(stone, 'Hide stone', true)
  await assertHit(neighbor, 'Hide stone', true)
  await assertHit(claw, 'Hide part', true)
  const visible = await colors(stone)
  const neighborVisible = await colors(neighbor)
  await actAt(stone, 'Hide stone')
  const hidden = await colors(stone)
  assert.ok(delta(visible, hidden) > 4, 'The clicked stone must disappear in the rendered pixels')
  assert.ok(
    delta(neighborVisible, await colors(neighbor)) < 2,
    'A sibling stone must keep its rendered facets',
  )
  await assertHit(stone, 'Hide stone', false)
  await assertHit(neighbor, 'Isolate stone', true)
  await actAt(neighbor, 'Isolate stone')
  await assertHit(landmark(0.5, 0.5), 'Hide stone', true)
  assert.deepEqual(
    await exportAssembly(),
    assembly,
    'A solo view must export the complete assembly',
  )
  await actAt(blank, 'Exit isolation')
  await assertHit(stone, 'Hide stone', false)
  await assertHit(neighbor, 'Hide stone', true)
  await actAt(blank, 'Show all hidden features')
  await assertHit(stone, 'Hide stone', true)
  // Show all also restores the reference drawn through this stone. Compare the same layers.
  await curves.getByRole('button', { name: 'Hide construction curves in view' }).click()
  await path.waitFor({ state: 'detached' })
  const restored = await colors(stone)
  assert.ok(
    delta(visible, restored) < delta(visible, hidden) / 4,
    'Restoring the stone must bring back its facets at the original location',
  )

  const metalVisible = await colors(claw)
  await actAt(claw, 'Hide part')
  assert.ok(delta(metalVisible, await colors(claw)) > 4, 'The clicked metal must disappear')
  await assertHit(claw, 'Hide part', false)
  await assertHit(stone, 'Hide stone', true)
  await actAt(blank, 'Show all hidden features')
  await actAt(claw, 'Isolate part')
  await assertHit(neighbor, 'Hide stone', false)
  await actAt(blank, 'Exit isolation')
  await assertHit(claw, 'Hide part', true)
  await actAt(stone, 'Hide stone')

  // Client-side navigation retains the JS runtime, so this exercises project-switch cleanup.
  await page.getByRole('button', { name: 'Switch project' }).click()
  await page.getByRole('dialog').getByRole('link', { name: other.title }).click()
  await page.waitForURL(`**/pieces/${other.id}/design`)
  await tree.getByText('Shoulder stones', { exact: true }).waitFor()
  const otherPoints = await guideVertices('guide-1')
  await assertHit(otherPoints[1]!, 'Hide stone', true)
  await assertHit(blank, 'Show all hidden features', false)
  const after = await saved()
  assert.deepEqual(after.design, before.design)
  assert.equal(after.version, before.version)
  console.log(
    'Passed canvas picking, stone and part visibility, curve disclosure, project switching, unchanged design and unchanged exported assembly.',
  )
} finally {
  await browser.close()
}
