// Run with PAVE_ASSISTANT=scripted:dock-tour on a disposable local server: pnpm exec tsx apps/studio/e2e/project-navigation.ts <base>
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { chromium as chromiumType } from 'playwright'

const { chromium } = createRequire(import.meta.url)('playwright') as {
  chromium: typeof chromiumType
}
const base = process.argv[2]
if (!base) throw Error('Pass the URL of a disposable local server.')
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(8000)
  const rpc = async (name: string, input: object) => {
    const res = await page.request.post(base + '/api/rpc/' + name, { data: input })
    assert.ok(res.ok(), name + ' ' + res.status())
    return res.json()
  }
  const stamp = Date.now()
  const a = await rpc('pieces.create', { title: 'Solitaire ' + stamp })
  const b = await rpc('pieces.create', { title: 'Studs ' + stamp })
  const areas = ['directions', 'design', 'render', 'sourcing', 'history', 'on-model', 'production']
  await page.goto(base + '/pieces/' + a.id)
  const menu = page.getByRole('navigation', { name: 'Project tools' })
  await menu.waitFor()
  const checkToolGrid = async () => {
    await menu.getByRole('link').last().waitFor()
    const boxes = await menu.getByRole('link').evaluateAll((links) =>
      links.map((link) => {
        const { x, y, bottom } = link.getBoundingClientRect()
        return { x, y, bottom }
      }),
    )
    assert.equal(boxes.length, 7)
    assert.ok(
      boxes.every((box, i) =>
        i % 2
          ? box.y === boxes[i - 1]!.y && box.x > boxes[0]!.x
          : box.x === boxes[0]!.x && (!i || box.y >= boxes[i - 2]!.bottom),
      ),
      'Project tool cards must form two columns',
    )
  }
  await checkToolGrid()
  const hrefs = await menu
    .getByRole('link')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')).sort())
  assert.deepEqual(hrefs, areas.map((area) => '/pieces/' + a.id + '/' + area).sort())
  assert.equal(await page.getByRole('navigation', { name: 'Piece sections' }).count(), 0)
  for (const area of areas) {
    await menu.locator('a[href$="/' + area + '"]').click()
    await page.getByRole('button', { name: 'Switch project' }).click()
    const picker = page.getByRole('dialog', { name: 'Switch project' })
    await picker.getByRole('textbox').fill(b.title)
    await picker.getByRole('link', { name: b.title, exact: false }).click()
    await page.waitForURL('**/pieces/' + b.id + '/' + area)
    const toolNav = page.getByRole('navigation', { name: 'Tools in this project' })
    await toolNav.getByRole('link', { name: b.title, exact: true }).waitFor()
    const toolLinks = await toolNav
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')))
    assert.deepEqual(toolLinks, [
      '/pieces/' + b.id,
      ...areas.map((path) => '/pieces/' + b.id + '/' + path),
    ])
    await page.reload()
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByText(b.title, { exact: true })
      .waitFor()
    if (area === 'directions') {
      await page.getByRole('button', { name: 'Start the design board' }).click()
      await page.getByRole('button', { name: 'Unlink board' }).waitFor()
      assert.equal((await rpc('boards.list', { pieceId: a.id })).length, 0)
      assert.equal((await rpc('boards.list', { pieceId: b.id })).length, 1)
    }
    await page.goBack()
    await page.waitForURL('**/pieces/' + a.id + '/' + area)
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: a.title })
      .click()
    await menu.waitFor()
  }
  await menu.getByRole('link', { name: 'CAD builder', exact: true }).click()
  const projectTools = page.getByRole('navigation', { name: 'Tools in this project' })
  await projectTools.getByRole('link', { name: 'History' }).click()
  await page.waitForURL('**/pieces/' + a.id + '/history')
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog')
  await palette.getByRole('combobox').fill('Sourcing')
  await palette.getByRole('option', { name: 'Sourcing', exact: true }).click()
  await page.waitForURL('**/pieces/' + a.id + '/sourcing')
  const boardB = (await rpc('boards.list', { pieceId: b.id }))[0]
  await page.goto(base + '/ideas')
  await page
    .getByRole('list', { name: 'Boards' })
    .locator('a[href*="' + boardB.id + '"]')
    .click()
  await page.waitForURL('**/pieces/' + b.id + '/directions?board=' + boardB.id)
  await page.goto(base + '/pieces/' + a.id + '/directions?board=' + boardB.id)
  await page.getByRole('button', { name: 'Start the design board' }).waitFor()
  await page.getByRole('button', { name: 'Project AI', exact: true }).click()
  const composer = page.getByRole('textbox', { name: 'Message the assistant' })
  await composer.fill('Solitaire draft')
  await page.getByRole('button', { name: 'Switch project' }).click()
  await page.getByRole('dialog').getByRole('link', { name: b.title }).click()
  await page.waitForURL('**/pieces/' + b.id + '/directions')
  assert.equal(await composer.inputValue(), '')
  await page.goBack()
  await page.getByRole('button', { name: 'Start the design board' }).waitFor()
  assert.equal(await composer.inputValue(), 'Solitaire draft')
  await page.getByRole('button', { name: 'Close assistant' }).click()
  await page.goto(base + '/pieces/' + a.id)
  // A duplicate started in A may finish after the jeweler has moved on to B.
  let releaseDuplicate!: () => void
  const hold = new Promise<void>((resolve) => {
    releaseDuplicate = resolve
  })
  let duplicateRequested!: () => void
  const started = new Promise<void>((resolve) => {
    duplicateRequested = resolve
  })
  await page.route('**/api/rpc/pieces.duplicate', async (route) => {
    const response = await route.fetch()
    duplicateRequested()
    await hold
    await route.fulfill({ response })
  })
  await page.getByRole('button', { name: 'Piece options' }).click()
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await started
  await page.getByRole('button', { name: 'Switch project' }).click()
  await page.getByRole('dialog').getByRole('link', { name: b.title }).click()
  await page.waitForURL('**/pieces/' + b.id)
  const delivered = page.waitForResponse('**/api/rpc/pieces.duplicate')
  releaseDuplicate()
  await (await delivered).finished()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  assert.equal(new URL(page.url()).pathname, '/pieces/' + b.id)
  await page.goto(base + '/pieces/' + a.id)
  await page.setViewportSize({ width: 390, height: 844 })
  await checkToolGrid()
  await menu.locator('a[href$="/history"]').click()
  await page.getByRole('button', { name: 'Switch project' }).click()
  await page.getByRole('dialog').getByRole('link', { name: b.title }).click()
  await page.waitForURL('**/pieces/' + b.id + '/history')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  console.log(
    'Passed seven tool round trips, desktop and mobile two-column menus, sidebar and palette navigation, board and assistant isolation, delayed duplicate, reload and Back.',
  )
} finally {
  await browser.close()
}
