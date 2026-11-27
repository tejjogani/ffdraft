// pnpm exec tsx apps/studio/e2e/cad-zoom.ts <Studio dev URL backed by a disposable server>
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { Piece } from '@pave/schema'
import type { Viewer } from '../src/components/stage/viewer'

declare global {
  interface Window {
    paveViewer?: Viewer
  }
}

const server = process.argv[2]
assert.ok(server, 'Pass the Studio dev URL backed by a disposable local server.')
const base = new URL(server)
assert.ok(
  base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname),
  'The regression requires a loopback server.',
)
const require = createRequire(import.meta.url)
const { chromium, webkit, expect } = require('playwright/test') as typeof import('playwright/test')
const detail: [number, number, number] = [16, -3, 12]

for (const engine of [chromium, webkit]) {
  const isWebKit = engine.name() === 'webkit'
  const browser = await engine.launch(
    isWebKit ? {} : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  )
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
      reducedMotion: 'reduce',
    })
    const rpc = async <T>(name: string, data: object): Promise<T> => {
      const response = await page.request.post(new URL(`/api/rpc/${name}`, base).href, { data })
      assert.ok(response.ok(), `${name} returned ${response.status()}: ${await response.text()}`)
      return response.json()
    }
    const piece = await rpc<Piece>('pieces.create', {
      title: 'CAD zoom check',
      templateId: 'oval-pave',
    })
    await rpc('design.apply', {
      pieceId: piece.id,
      label: 'Add an off-centre detail to inspect',
      ops: [
        {
          t: 'add',
          node: { id: 'offset-stone', kind: 'gem', width: 2, transform: { position: detail } },
        },
      ],
    })
    const saved = await rpc<Piece>('pieces.get', { id: piece.id })
    const open = (id: string) => page.goto(new URL(`/pieces/${id}/design`, base).href)
    const canvas = page.getByRole('application', { name: /^3D view of the piece/ })
    const slider = page.getByRole('slider', { name: 'Viewport zoom' })
    const percent = async () =>
      Number.parseInt((await slider.getAttribute('aria-valuetext')) ?? '', 10)
    const scaleIs = (n: number) => expect.poll(percent).toBe(n)
    const camera = () =>
      page.evaluate((point) => {
        const viewer = window.paveViewer!
        const detail = viewer.project(point)
        const { width } = viewer.canvas.getBoundingClientRect()
        const bounds = viewer.screenBounds(['offset-stone'])
        return {
          detail,
          width,
          distance: viewer.controls.distance,
          detailWidth: bounds ? bounds.x1 - bounds.x0 : 0,
        }
      }, detail)
    const fit = async () => {
      await canvas.focus()
      await page.keyboard.press('f')
      await scaleIs(100)
    }

    await open(piece.id)
    await expect(slider).toBeVisible({ timeout: 45_000 })
    await page.waitForFunction(() => window.paveViewer?.frameTimes.length)
    await fit()
    const start = await camera()
    const track = await slider.boundingBox()
    assert.ok(track)
    const x = track.x + 7 + (Number(await slider.inputValue()) / 100) * (track.width - 14)
    const y = track.y + track.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 7, y, { steps: 8 })
    await expect.poll(percent).toBeGreaterThan(140)
    assert.ok((await camera()).distance < start.distance * 0.72)
    await page.mouse.move(x, y, { steps: 8 })
    await page.mouse.up()
    await expect.poll(percent).toBeLessThan(115)

    await fit()
    await slider.press('ArrowRight')
    await expect.poll(percent).toBeGreaterThan(100)
    await slider.press('Home')
    await expect(slider).toHaveValue('0')
    await slider.press('End')
    await expect(slider).toHaveValue('100')
    await fit()
    await page.keyboard.press('Equal')
    await scaleIs(125)
    await page.keyboard.press('Minus')
    await scaleIs(100)

    const anchor = await camera()
    assert.ok(anchor.detail.visible && Math.abs(anchor.detail.x - anchor.width / 2) > 70)
    assert.ok(anchor.detailWidth > 0, 'The test stone is in view.')
    const prevented = await canvas.evaluate(
      (el, { point, isWebKit }) => {
        const rect = el.getBoundingClientRect()
        const event = {
          bubbles: true,
          cancelable: true,
          clientX: rect.x + point.x,
          clientY: rect.y + point.y,
        }
        if (!isWebKit)
          return !el.dispatchEvent(
            new WheelEvent('wheel', { ...event, ctrlKey: true, deltaY: -18 }),
          )
        return ['gesturestart', 'gesturechange', 'gestureend']
          .map((name) => {
            const gesture = new MouseEvent(name, event)
            Object.defineProperty(gesture, 'scale', { value: name === 'gesturestart' ? 1 : 1.13 })
            return !el.dispatchEvent(gesture)
          })
          .every(Boolean)
      },
      { point: anchor.detail, isWebKit },
    )
    assert.ok(prevented, 'The pinch stays in the viewport.')
    await expect.poll(percent).toBeGreaterThan(140)
    const close = await camera()
    assert.ok(close.distance < anchor.distance * 0.72)
    assert.ok(close.detailWidth > anchor.detailWidth * 1.3, 'The detail grows in the viewport.')
    const drift = Math.hypot(close.detail.x - anchor.detail.x, close.detail.y - anchor.detail.y)
    assert.ok(close.detail.visible && drift < 20, `The off-centre detail drifted ${drift} px.`)

    await page.setViewportSize({ width: 390, height: 760 })
    await expect
      .poll(async () => {
        const box = await slider.boundingBox()
        const view = await canvas.boundingBox()
        return !!box && view?.width === 390 && box.x >= 0 && box.x + box.width <= 390
      })
      .toBe(true)
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
    await expect.poll(percent).toBeLessThan(125)

    const after = await rpc<Piece>('pieces.get', { id: piece.id })
    assert.equal(after.version, saved.version)
    assert.deepEqual(after.design, saved.design)
    const other = await rpc<Piece>('pieces.create', {
      title: 'Second zoom project',
      templateId: 'halo',
    })
    await open(other.id)
    await expect(slider).toBeVisible({ timeout: 45_000 })
    await scaleIs(100)
    console.log(
      `${engine.name()}: CAD zoom passed (off-centre pinch drift ${drift.toFixed(1)} px).`,
    )
  } finally {
    await browser.close()
  }
}
