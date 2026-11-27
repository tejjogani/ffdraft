// pnpm exec tsx apps/studio/e2e/cad-panes.ts <Studio URL backed by a disposable local server>
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { Piece } from '@pave/schema'

const server = process.argv[2]
assert.ok(server, 'Pass the Studio URL backed by a disposable local server.')
const base = new URL(server)
assert.ok(
  base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname),
  'The regression requires a loopback server.',
)
const { chromium, webkit, expect } = createRequire(import.meta.url)(
  'playwright/test',
) as typeof import('playwright/test')

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch(
    engine.name() === 'chromium'
      ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
      : {},
  )
  try {
    const page = await browser.newPage({
      viewport: { width: 1550, height: 950 },
      reducedMotion: 'reduce',
    })
    const rpc = async <T>(name: string, data: object): Promise<T> => {
      const response = await page.request.post(new URL(`/api/rpc/${name}`, base).href, { data })
      assert.ok(response.ok(), `${name} returned ${response.status()}: ${await response.text()}`)
      return response.json()
    }
    const original = await rpc<Piece>('pieces.create', {
      title: 'CAD panes check',
      templateId: 'solitaire',
    })
    const other = await rpc<Piece>('pieces.create', {
      title: 'Second CAD project',
      templateId: 'halo',
    })
    const open = (id: string) =>
      page.goto(new URL(`/pieces/${id}/design`, base).href, { waitUntil: 'domcontentloaded' })
    const viewport = page.getByRole('main', { name: 'Viewport' })
    const width = async () => (await viewport.boundingBox())?.width
    const button = (name: string) => page.getByRole('button', { name, exact: true })
    const features = page.getByRole('complementary', { name: 'Feature list' })
    const sidebar = page.getByRole('complementary', { name: 'Sidebar' })
    const featureSheet = page.getByRole('dialog', { name: 'Features' })
    const desktop = { width: 1550, height: 950 }
    const compact = { width: 390, height: 760 }

    await open(original.id)
    await expect(features).toBeVisible({ timeout: 45_000 })
    await expect(button('Hide sidebar')).toHaveCSS('opacity', '1', { timeout: 2500 })
    await expect(button('Hide Features')).toHaveAttribute('aria-expanded', 'true')
    const initial = await width()
    const featureWidth = (await features.boundingBox())!.width
    const sidebarWidth = (await sidebar.boundingBox())!.width
    assert.ok(initial)

    await button('Hide Features').press('Enter')
    await expect(features).toBeHidden()
    await expect(button('Show Features')).toBeFocused()
    await expect(button('Show Features')).toHaveAttribute('aria-expanded', 'false')
    await expect.poll(width).toBe(initial + featureWidth)

    await button('Hide sidebar').press('Enter')
    await expect(button('Show sidebar')).toBeFocused()
    await expect(sidebar).toBeHidden({ timeout: 15_000 })
    await expect.poll(width).toBe(initial + featureWidth + sidebarWidth)
    await page.keyboard.press('ControlOrMeta+Backslash')
    await expect(sidebar).toBeVisible()
    await expect(button('Hide sidebar')).toBeFocused()
    await expect.poll(width).toBe(initial + featureWidth)

    await open(other.id)
    await expect(button('Show Features')).toBeVisible({ timeout: 45_000 })
    await expect(features).toBeHidden()
    await button('Show Features').press('Enter')
    await expect(features).toBeVisible()
    await expect(button('Hide Features')).toBeFocused()
    await expect.poll(width).toBe(initial)

    await page.setViewportSize(compact)
    await expect(button('Features')).toBeVisible()
    await expect.poll(width, { timeout: 15_000 }).toBeCloseTo(compact.width, 0)
    await button('Features').press('Enter')
    await expect(featureSheet).toBeVisible()
    await expect(featureSheet.getByRole('tree', { name: 'Features' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(featureSheet).toBeHidden()
    await expect(button('Features')).toBeFocused()
    await button('Features').press('Enter')
    await expect(featureSheet).toBeVisible()
    await page.setViewportSize(desktop)
    await expect(features).toBeVisible()
    await expect(featureSheet).toBeHidden()
    await page.setViewportSize(compact)
    await expect(button('Features')).toBeVisible()
    await expect(featureSheet).toBeHidden()
    await button('Open navigation').click()
    await expect(sidebar).toBeVisible()
    await sidebar.getByRole('button', { name: 'Close navigation', exact: true }).click()
    await expect(sidebar).toBeHidden()

    for (const before of [original, other]) {
      const after = await rpc<Piece>('pieces.get', { id: before.id })
      assert.equal(after.version, before.version)
      assert.deepEqual(after.design, before.design)
    }
    console.log(
      `${engine.name()}: ${initial} px to ${initial + featureWidth + sidebarWidth} px, both panels and keyboard passed.`,
    )
  } finally {
    await browser.close()
  }
}
