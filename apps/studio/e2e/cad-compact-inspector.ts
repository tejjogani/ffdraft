// pnpm exec tsx apps/studio/e2e/cad-compact-inspector.ts <disposable loopback Studio dev URL>
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { Piece } from '@pave/schema'
import type { Viewer } from '../src/components/stage/viewer'

declare global {
  interface Window {
    paveViewer?: Viewer
  }
}

const url = process.argv[2]
assert.ok(url, 'Pass the Studio dev URL for a disposable local server.')
const base = new URL(url)
assert.ok(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))
const { chromium, webkit, expect } = createRequire(import.meta.url)(
  'playwright/test',
) as typeof import('playwright/test')

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch(
    engine.name() === 'webkit'
      ? {}
      : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  )
  try {
    const page = await browser.newPage({
      viewport: { width: 1550, height: 950 },
      reducedMotion: 'reduce',
      hasTouch: true,
    })
    const rpc = async <T>(name: string, data: object): Promise<T> => {
      const response = await page.request.post(new URL(`/api/rpc/${name}`, base).href, { data })
      assert.ok(response.ok(), `${name}: ${response.status()} ${await response.text()}`)
      return response.json()
    }
    const { id } = await rpc<Piece>('pieces.create', {
      title: 'Compact Inspector proof',
      templateId: 'oval-pave',
    })
    const upload = await page.request.post(new URL('/api/assets', base).href, {
      multipart: {
        file: {
          name: 'claw.obj',
          mimeType: 'model/obj',
          buffer: Buffer.from(
            'v 12 -3 12\nv 16 -3 12\nv 12 1 12\nv 12 -3 16\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4',
          ),
        },
      },
    })
    assert.ok(upload.ok(), await upload.text())
    const asset = await upload.json()
    await rpc('design.apply', {
      pieceId: id,
      label: 'Add an imported claw',
      ops: [
        {
          t: 'add',
          node: {
            id: 'claw',
            name: 'Imported claw',
            kind: 'meshBody',
            keepSourcePlacement: true,
            source: {
              type: 'asset',
              assetId: asset.id,
              rhinoLayer: 'Workshop metal',
              rhinoContext: { material: 'White Gold', groups: [], placements: [] },
            },
          },
        },
      ],
    })
    const saved = () => rpc<Piece>('pieces.get', { id })
    const before = await saved()
    await page.goto(new URL(`/pieces/${id}/design`, base).href, { waitUntil: 'domcontentloaded' })
    const canvas = page.getByRole('application', { name: /^3D view of the piece/ })
    const inspector = page.getByRole('dialog', { name: 'Inspector' })
    const docked = page.getByRole('complementary', { name: 'Inspector' })
    const summary = page.getByRole('region', { name: 'Selected details' })
    const details = summary.getByRole('button', { name: 'Inspect', exact: true })
    const fit = async () => {
      await canvas.focus()
      await page.keyboard.press('f')
      await expect(page.getByRole('slider', { name: 'Viewport zoom' })).toHaveAttribute(
        'aria-valuetext',
        '100% of fitted view',
      )
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          }),
      )
    }
    const point = async (nodeId: string, requireStone = false) => {
      const found = await page.evaluate(
        ({ nodeId, requireStone }) => {
          const viewer = window.paveViewer!
          const bounds = viewer.screenBounds([nodeId])
          if (!bounds) return null
          const rect = viewer.canvas.getBoundingClientRect()
          for (let y = Math.ceil(bounds.y0); y <= bounds.y1; y += 4) {
            for (let x = Math.ceil(bounds.x0); x <= bounds.x1; x += 4) {
              if (document.elementFromPoint(rect.x + x, rect.y + y) !== viewer.canvas) continue
              const pick = viewer.pick(x, y, false)
              const inside = [
                [x - 1, y],
                [x + 1, y],
                [x, y - 1],
                [x, y + 1],
              ].every(([px, py]) => {
                const hit = viewer.pick(px!, py!, false)
                return hit?.nodeId === nodeId && hit.stoneId === pick?.stoneId
              })
              if (pick?.nodeId === nodeId && (!requireStone || pick.stoneId) && inside)
                return { x: rect.x + x, y: rect.y + y }
            }
          }
          return null
        },
        { nodeId, requireStone },
      )
      assert.ok(found, `No visible pick target for ${nodeId}.`)
      return found
    }

    await expect(docked).toBeVisible({ timeout: 45_000 })
    await expect(page.getByRole('slider', { name: 'Viewport zoom' })).toBeVisible({
      timeout: 45_000,
    })
    await fit()
    let stone = await point('row', true)
    await page.mouse.click(stone.x, stone.y)
    await expect(docked.getByText('This stone', { exact: true })).toBeVisible()
    await expect(summary).toBeHidden()
    await page.mouse.dblclick(stone.x, stone.y)
    await expect(inspector).toBeHidden()

    await page.setViewportSize({ width: 1024, height: 850 })
    await expect(docked).toBeHidden()
    await fit()
    stone = await point('row', true)
    await page.mouse.click(stone.x, stone.y)
    await expect(summary.getByText(/Stone \d+ of \d+/)).toBeVisible()
    await expect(summary.getByText(/mm.*ct/)).toBeVisible()
    await expect(inspector).toBeHidden()
    await page.mouse.dblclick(stone.x, stone.y)
    await expect(inspector.getByText('This stone', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(inspector).toBeHidden()
    await expect(canvas).toBeFocused()
    const selectedStone = await summary.getByText(/Stone \d+ of \d+/).textContent()
    const azimuth = () => page.evaluate(() => window.paveViewer?.controls.azimuthAngle)
    const beforeDrag = await azimuth()
    await page.mouse.move(stone.x, stone.y)
    await page.mouse.down()
    await page.mouse.move(stone.x - 30, stone.y + 5, { steps: 5 })
    await page.mouse.up()
    await expect.poll(azimuth).not.toBe(beforeDrag)
    await expect(summary.getByText(/Stone \d+ of \d+/)).toHaveText(selectedStone ?? '')
    await expect(inspector).toBeHidden()
    await page.waitForFunction(() => window.paveViewer?.isMoving === false)
    const claw = await point('claw')
    await page.keyboard.down('Shift')
    await page.mouse.click(claw.x, claw.y)
    await page.keyboard.up('Shift')
    await expect(summary.getByText('2 selected', { exact: true })).toBeVisible()
    await expect(inspector).toBeHidden()

    await page.setViewportSize({ width: 390, height: 760 })
    await expect
      .poll(async () => (await canvas.boundingBox())?.width, { timeout: 15_000 })
      .toBe(390)
    await fit()
    const imported = await point('claw')
    await page.touchscreen.tap(imported.x, imported.y)
    await expect(summary.getByText('Imported claw', { exact: true })).toBeVisible()
    await expect(summary.getByText(/Source material.*White Gold/)).toBeVisible()
    await expect(summary.getByText(/Workshop metal/)).toBeVisible()
    await details.press('Enter')
    await expect(inspector.getByRole('heading', { name: 'Imported claw' })).toBeVisible()
    await expect(inspector.getByText(/Rhino layer.*Workshop metal/)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(inspector).toBeHidden()
    await expect(details).toBeFocused()

    const featuresButton = page.getByRole('button', { name: 'Features', exact: true })
    await featuresButton.click()
    const features = page.getByRole('dialog', { name: 'Features' })
    await features.getByRole('treeitem', { name: /^Band\b/ }).click()
    await features.getByRole('button', { name: 'Inspect', exact: true }).click()
    await expect(
      inspector.getByRole('heading', { name: 'Band', exact: true, level: 2 }),
    ).toBeVisible()
    await expect(features).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(inspector).toBeHidden()
    await expect(featuresButton).toBeFocused()

    const after = await saved()
    assert.equal(after.version, before.version)
    assert.deepEqual(after.design, before.design)
    console.log(`${engine.name()}: desktop, intermediate and touch Inspector passed.`)
  } finally {
    await browser.close()
  }
}
