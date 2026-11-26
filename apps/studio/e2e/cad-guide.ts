// Run against a disposable local server: pnpm exec tsx apps/studio/e2e/cad-guide.ts <base>
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { chromium as chromiumType } from 'playwright'

const { chromium } = createRequire(import.meta.url)('playwright') as {
  chromium: typeof chromiumType
}
const base = process.argv[2]
if (!base) throw new Error('Pass the URL of a disposable local server.')
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(15_000)
  const rpc = async (name: string, data: object) => {
    const response = await page.request.post(`${base}/api/rpc/${name}`, { data })
    assert.ok(response.ok(), `${name}: ${response.status()} ${await response.text()}`)
    return response.json()
  }
  const blank = await rpc('pieces.create', { title: 'Blank CAD guide', kind: 'other' })
  const template = await rpc('pieces.create', { title: 'Built CAD guide', templateId: 'solitaire' })
  const guide = readFileSync(new URL('../../../docs/first-time-cad.md', import.meta.url), 'utf8')
  const titles = Array.from(guide.matchAll(/^## (.+)$/gm), ([, title]) => title.trim())
  assert.ok(titles.length >= 2, 'Expected multiple guide steps')

  const trigger = page.getByRole('button', { name: 'CAD guide', exact: true })
  const dialog = page.getByRole('dialog', { name: 'CAD guide', exact: true })
  const back = dialog.getByRole('button', { name: 'Back', exact: true })
  const next = dialog.getByRole('button', { name: 'Next', exact: true })
  const checkStep = async (step: number) => {
    await dialog.getByText(`Step ${step + 1} of ${titles.length}`, { exact: true }).waitFor()
    await dialog.getByRole('heading', { name: titles[step], exact: true }).waitFor()
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    for (const { id } of [blank, template]) {
      const before = await rpc('pieces.get', { id })
      await page.goto(`${base}/pieces/${id}/design`)
      await trigger.waitFor()
      assert.equal(await dialog.isVisible(), false)
      await trigger.focus()
      await page.keyboard.press('Enter')
      await checkStep(0)
      assert.equal(await back.isDisabled(), true)
      await next.click()
      await checkStep(1)
      await back.click()
      await checkStep(0)
      await next.click()
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      await trigger.and(page.locator(':focus')).waitFor()
      await trigger.click()
      await checkStep(0)
      for (let step = 1; step < titles.length; step++) {
        await next.click()
        await checkStep(step)
      }
      await dialog.getByRole('button', { name: 'Done', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      await trigger.and(page.locator(':focus')).waitFor()
      await trigger.click()
      await checkStep(0)
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      const after = await rpc('pieces.get', { id })
      assert.equal(after.version, before.version)
      assert.deepEqual(after.design, before.design)
    }
    await page.goto(`${base}/pieces/${blank.id}/design`)
    await page.getByRole('button', { name: 'Draw curve', exact: true }).click()
    const editor = page.getByRole('region', { name: 'Draw curve', exact: true })
    await editor.waitFor()
    await trigger.click()
    await checkStep(0)
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
    console.log(`CAD guide passed on blank and built pieces and during curve drawing at ${width}px`)
  }
} finally {
  await browser.close()
}
