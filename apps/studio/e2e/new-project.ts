// Run against an unkeyed, disposable local Studio server with the built frontend and Playwright.
// pnpm exec tsx apps/studio/e2e/new-project.ts http://127.0.0.1:8787
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { CommandInput, CommandName, CommandOutput } from '@pave/schema'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const [base] = process.argv.slice(2)
if (!base) throw new Error('Pass a disposable local server URL.')

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true })
  const name = dialog.getByRole('textbox', { name: 'Project name' })
  const folderPicker = dialog.getByRole('combobox', { name: 'Folder' })
  const template = dialog.getByRole('combobox', { name: 'Template' })
  const create = dialog.getByRole('button', { name: 'Create project', exact: true })
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' })
  const sidebarNew = sidebar.getByRole('button', { name: /^New project/ })
  const main = page.getByRole('main')
  const suffix = crypto.randomUUID().slice(0, 8)

  async function rpc<N extends CommandName>(
    command: N,
    data: CommandInput<N>,
  ): Promise<CommandOutput<N>> {
    const response = await page.request.post(`${base}/api/rpc/${command}`, { data })
    assert.ok(response.ok(), `${command} returned ${response.status()}`)
    return response.json()
  }
  const byTitle = async (title: string) =>
    (await rpc('pieces.list', { q: title })).filter((piece) => piece.title === title)

  assert.equal((await rpc('session.get', {})).capabilities.assistant, false)
  await page.goto(base)
  await sidebarNew.click()
  const nameId = await name.getAttribute('id')
  await page.waitForFunction((id) => document.activeElement?.id === id, nameId)
  assert.equal(await folderPicker.textContent(), 'Default folder')
  assert.equal(await create.isDisabled(), true)
  const canceled = `Canceled project ${suffix}`
  await name.fill(canceled)
  await name.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.deepEqual(await byTitle(canceled), [])

  const mod = await page.evaluate(() => (/Mac/.test(navigator.platform) ? 'Meta' : 'Control'))
  await page.keyboard.press(`${mod}+n`)
  await name.fill(canceled)
  await page.goBack()
  await dialog.waitFor({ state: 'hidden' })
  assert.deepEqual(await byTitle(canceled), [])
  await main.getByRole('button', { name: 'New project', exact: true }).click()
  await name.fill(canceled)
  await cancel.click()
  await dialog.waitFor({ state: 'hidden' })
  assert.deepEqual(await byTitle(canceled), [])

  const folder = await rpc('collections.create', { name: `Commissions ${suffix}` })
  const selected = await rpc('collections.create', { name: `In progress ${suffix}` })
  const folderPath = `/collections/${folder.id}`
  await page.goto(base + folderPath)
  await main.getByRole('button', { name: 'New project', exact: true }).first().click()
  await folderPicker.getByText(folder.name, { exact: true }).waitFor()
  await folderPicker.click()
  await page.getByRole('option', { name: selected.name, exact: true }).click()
  await template.click()
  await page.getByRole('option', { name: 'Classic solitaire', exact: true }).click()
  const title = `Named solitaire ${suffix}`
  await name.fill(title)

  // Commit the first write, then simulate the browser losing the response before it can navigate.
  let requests = 0
  await page.route('**/api/rpc/pieces.create', async (route) => {
    requests++
    if (requests > 1) return route.continue()
    assert.ok((await route.fetch()).ok())
    await route.abort('connectionreset')
  })
  await create.click()
  await dialog.getByText('Can’t reach the Pavé server.').waitFor()
  assert.equal(await name.inputValue(), title)
  assert.equal(await folderPicker.textContent(), selected.name)
  assert.equal(await template.textContent(), 'Classic solitaire')
  const [saved] = await byTitle(title)
  assert.ok(saved)
  await create.evaluate((button: HTMLButtonElement) => {
    button.click()
    button.click()
  })
  await page.waitForURL(`**/pieces/${saved.id}`)
  assert.equal(requests, 2)
  assert.equal((await byTitle(title)).length, 1)
  const piece = await rpc('pieces.get', { id: saved.id })
  assert.equal(piece.collectionId, selected.id)
  assert.equal(piece.spec?.archetype, 'solitaire')
  await page.unroute('**/api/rpc/pieces.create')

  await page.goto(base + folderPath)
  await sidebarNew.click()
  const fromBrief = dialog.getByRole('button', { name: 'Design from a brief' })
  await name.fill(canceled)
  await fromBrief.click()
  await main.getByRole('heading', { name: canceled, exact: true }).waitFor()
  await main.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.waitForURL((url) => url.pathname === folderPath)
  assert.deepEqual(await byTitle(canceled), [])

  await sidebarNew.click()
  const intakeTitle = `Reference project ${suffix}`
  const brief = 'Platinum ring with a pear cut centre'
  await name.fill(intakeTitle)
  await fromBrief.click()
  await main.getByRole('textbox', { name: 'Design brief' }).fill(brief)
  await main.locator('input[type=file]').setInputFiles({
    name: 'ring-reference.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="12"/></svg>',
    ),
  })
  await main.getByRole('img', { name: 'ring-reference.svg' }).waitFor()
  await main.getByRole('button', { name: 'Start design intake' }).click()
  await page.waitForURL((url) => url.searchParams.has('intake'))
  await main.getByText('Manual design intake', { exact: true }).waitFor()
  assert.equal(await page.getByRole('complementary', { name: 'Assistant' }).count(), 0)
  const id = new URL(page.url()).searchParams.get('intake')!
  const intake = await rpc('pieces.get', { id })
  assert.equal(intake.title, intakeTitle)
  assert.equal(intake.collectionId, folder.id)
  assert.equal(intake.brief, brief)
  const [board] = await rpc('boards.list', { pieceId: id })
  assert.ok(board)
  assert.ok(
    (await rpc('boards.get', { id: board.id })).references.some(
      (reference) => reference.title === 'ring-reference.svg',
    ),
  )
  console.log(
    'Verified project cancellation, template creation, retry and full-screen design intake.',
  )
} finally {
  await browser.close()
}
