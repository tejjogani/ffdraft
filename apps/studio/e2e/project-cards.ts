// Exercise the default reading and editing views on a disposable local studio.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const base = process.argv[2]
if (!base) throw Error('Pass a disposable server URL')
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const response = await page.request.post(base + '/api/rpc/pieces.create', {
    data: { templateId: 'solitaire', title: 'Spec reading sample' },
  })
  assert.ok(response.ok())
  const piece = await response.json()
  await page.goto(base + '/pieces/' + piece.id)
  const tools = page.getByRole('navigation', { name: 'Project tools', exact: true })
  const entry = tools.getByRole('link', { name: 'Design board & spec' })
  await entry.waitFor()
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, scheme)
    const painted = await tools.getByRole('link').evaluateAll((links) => {
      const pageColor = getComputedStyle(document.body).backgroundColor
      return links.every((link) => {
        const color = getComputedStyle(link).backgroundColor
        return color !== 'rgba(0, 0, 0, 0)' && color !== pageColor
      })
    })
    assert.ok(painted, `Every tool needs a full card surface in ${scheme} mode`)
  }
  const dimensions = await tools.getByRole('link').evaluateAll((links) =>
    links.map((link) => {
      const { top, bottom, height } = link.getBoundingClientRect()
      return { top, bottom, height }
    }),
  )
  assert.equal(dimensions.length, 7)
  assert.ok(
    dimensions.every(
      (d, i) =>
        d.height >= 64 &&
        (i % 2 ? d.top === dimensions[i - 1]!.top : !i || d.top - dimensions[i - 2]!.bottom >= 8),
    ),
  )
  await entry.click()
  const card = page.getByRole('region', { name: 'Spec', exact: true })
  await card.getByRole('heading', { name: 'Design specification' }).waitFor()
  await card.getByText('1 ct round brilliant diamond', { exact: true }).waitFor()
  await card.getByText('US 6', { exact: true }).waitFor()
  assert.equal(await card.getByRole('textbox').count(), 0)
  await card.getByRole('button', { name: 'Edit specification' }).click()
  const summary = card.getByRole('textbox', { name: 'Summary' })
  await summary.fill('A four-prong platinum solitaire for the client.')
  await card.getByRole('button', { name: 'Done editing' }).click()
  await card.getByText('A four-prong platinum solitaire for the client.').waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await card.getByText('A four-prong platinum solitaire for the client.').waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await card.getByRole('button', { name: 'Open current CAD' }).click()
  await page.waitForURL('**/pieces/' + piece.id + '/design')
  console.log(
    'Passed card spacing, specification hierarchy, edits, mobile reload and scoped CAD handoff.',
  )
} finally {
  await browser.close()
}
