// Use a disposable Pavé server with geometry enabled. Only the inventory replies are fixtures.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const { chromium, webkit } = createRequire(import.meta.url)(
  'playwright',
) as typeof import('playwright')
const base = process.argv[2]
if (!base) throw Error('Pass a disposable server URL')
const browser = await (process.env.PAVE_TEST_BROWSER === 'webkit' ? webkit : chromium).launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(15000)
  const rpc = async (method: string, input: object) => {
    const reply = await page.request.post(`${base}/api/rpc/${method}`, { data: input })
    assert.ok(reply.ok(), `${method} ${await reply.text()}`)
    return reply.json()
  }
  const a = await rpc('pieces.create', { templateId: 'solitaire', title: 'Sourcing sample A' })
  const b = await rpc('pieces.create', { templateId: 'halo', title: 'Sourcing sample B' })
  const stones = Array.from({ length: 7 }, (_, i) => ({
    sku: `TEST-${i + 1}`,
    url: `https://console.thediaex.com/browse?stone=TEST-${i + 1}`,
    measured: { length: 6.46 + i * 0.03, width: 6.42 + i * 0.03, depth: 4 + i * 0.02 },
    color: i === 6 ? 'H' : 'G',
    clarity: 'VS1',
    carat: 1.02 + i * 0.01,
    origin: 'natural',
  }))
  let recommendationsUnavailable = false
  const fallback = 'https://console.thediaex.com/browse?f=%7B%22shapes%22%3A%5B%22round%22%5D%7D'
  await page.route('**/api/rpc/sourcing.search', (route) => {
    const { pieceId, nodeId, color, sku } = route.request().postDataJSON()
    assert.equal(pieceId, a.id)
    assert.equal(nodeId, 'center')
    if (recommendationsUnavailable && !sku)
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: 'provider_unavailable',
            message: 'Diaex inventory is unavailable in Pavé right now. Open Diaex to browse.',
            searchUrl: fallback,
          },
        },
      })
    return route.fulfill({
      json: {
        candidates: stones.filter((s) => (!color || s.color === color) && (!sku || s.sku === sku)),
        searchUrl: 'https://console.thediaex.com/browse',
      },
    })
  })
  let unavailable = false
  await page.route('**/api/rpc/sourcing.stone', (route) => {
    const { pieceId, nodeId, sku } = route.request().postDataJSON()
    assert.equal(pieceId, a.id)
    assert.equal(nodeId, 'center')
    return unavailable
      ? route.fulfill({
          status: 409,
          json: { error: { code: 'conflict', message: 'This stone is no longer available.' } },
        })
      : route.fulfill({ json: stones.find((s) => s.sku === sku) })
  })
  await page.goto(`${base}/pieces/${a.id}/sourcing`)
  await page.getByRole('button', { name: 'Find diamonds' }).first().click()
  await page.getByText('Recommended', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: /Preview TEST-/ }).count(), 7)
  await page.getByRole('button', { name: 'Preview TEST-1', exact: true }).click()
  const screenshotDir = process.env.PAVE_E2E_SCREENSHOTS
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true })
    await page.getByRole('region', { name: 'Fit preview' }).waitFor()
    await page.screenshot({ path: join(screenshotDir, 'desktop-fit.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('complementary', { name: 'Sidebar' }).waitFor({ state: 'hidden' })
    await page.screenshot({ path: join(screenshotDir, 'mobile-fit.png'), fullPage: true })
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  await page.getByRole('button', { name: 'Fit this stone' }).click()
  await page.getByText('Fitted stone · TEST-1', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Change diamond' }).first().click()
  await page.getByLabel('Color grade').selectOption('H')
  await page.getByRole('button', { name: 'Search inventory' }).click()
  await page.getByRole('button', { name: 'Preview TEST-7' }).click()
  assert.equal(await page.getByRole('button', { name: /Preview TEST-/ }).count(), 1)
  unavailable = true
  await page.getByRole('button', { name: 'Fit this stone' }).click()
  await page.getByText('This stone is no longer available.').first().waitFor()
  assert.equal((await rpc('pieces.get', { id: a.id })).design.nodes.center.sourcing.sku, 'TEST-1')
  unavailable = false
  stones[6]!.measured.depth = 4.2
  await page.getByRole('button', { name: 'Fit this stone' }).click()
  await page
    .getByText('Diaex updated this listing. Review the new fit before applying it.')
    .waitFor()
  assert.equal((await rpc('pieces.get', { id: a.id })).design.nodes.center.sourcing.sku, 'TEST-1')
  await page.getByRole('button', { name: 'Fit this stone' }).click()
  await page.getByText('Fitted stone · TEST-7', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Change diamond' }).waitFor()
  const fittedToast = page.getByText('TEST-7', { exact: true }).locator('..')
  await fittedToast.getByRole('button', { name: 'Undo', exact: true }).click()
  await page.getByText('Fitted stone · TEST-1', { exact: true }).waitFor()

  recommendationsUnavailable = true
  await page.getByRole('button', { name: 'Change diamond' }).click()
  await page.getByText(/Diaex inventory is unavailable/).waitFor()
  assert.equal(
    await page.getByRole('link', { name: 'Browse Diaex' }).getAttribute('href'),
    fallback,
  )
  await page.getByLabel('Diaex public ID or link').fill(stones[6]!.url)
  await page.getByRole('button', { name: 'Search inventory' }).click()
  await page.getByRole('button', { name: 'Preview TEST-7' }).click()
  assert.equal(await page.getByRole('button', { name: /Preview TEST-/ }).count(), 1)
  await page.getByRole('button', { name: 'Fit this stone' }).click()
  await page.getByText('Fitted stone · TEST-7', { exact: true }).waitFor()
  await page.reload()
  await page.getByText('Fitted stone · TEST-7', { exact: true }).waitFor()
  const fitted = await rpc('pieces.get', { id: a.id })
  assert.deepEqual(fitted.design.nodes.center.sourcing.measured, stones[6]!.measured)
  assert.equal(fitted.design.nodes.center.sourcing.listedCarat, stones[6]!.carat)
  assert.deepEqual((await rpc('pieces.get', { id: b.id })).design, b.design)
  await page.goto(`${base}/sourcing`)
  await page.getByLabel('Project', { exact: true }).selectOption(b.id)
  await page.getByText('This setting uses a group of stones.').first().waitFor()
  assert.equal(await page.getByText('Fitted stone · TEST-7', { exact: true }).count(), 0)
  await page.getByLabel('Project', { exact: true }).selectOption(a.id)
  await page.getByText('Fitted stone · TEST-7', { exact: true }).waitFor()
  await page.getByRole('link', { name: 'Open project CAD' }).click()
  await page.waitForURL(`**/pieces/${a.id}/design`)
  await page.locator('[data-region="viewport"] canvas').first().waitFor({ timeout: 60000 })
  await page
    .getByRole('treeitem', { name: /Centre stone/ })
    .first()
    .click()
  assert.equal(
    await page.getByRole('link', { name: 'TEST-7', exact: true }).getAttribute('href'),
    stones[6]!.url,
  )
  console.log(
    'PASS ranking, color and exact-ID search, outage fallback, refit and undo, drift and availability checks, project scope, and CAD listing.',
  )
} finally {
  await browser.close()
}
