// Run with a disposable local server: pnpm exec tsx apps/studio/e2e/moodboards.ts <base>
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { chromium as chromiumType } from 'playwright'

const { chromium } = createRequire(import.meta.url)('playwright') as {
  chromium: typeof chromiumType
}
const base = process.argv[2]
if (!base) throw new Error('Pass the URL of a disposable local server.')
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(8000)
  const rpc = async (name: string, data: object) => {
    const response = await page.request.post(`${base}/api/rpc/${name}`, { data })
    assert.ok(response.ok(), `${name}: ${response.status()}`)
    return response.json()
  }
  const from = await rpc('pieces.create', { title: 'Project A' })
  const to = await rpc('pieces.create', { title: 'Project B' })
  const stamp = Date.now()
  const library = page.getByRole('list', { name: 'Moodboards' })
  await page.goto(base + '/ideas')
  await page.waitForURL('**/moodboards')
  await page.getByRole('button', { name: 'New moodboard' }).click()
  await page.getByRole('textbox', { name: 'Moodboard name' }).fill('Art Deco ' + stamp)
  await page.getByRole('button', { name: 'Create moodboard' }).click()
  await page.waitForURL('**/moodboards/*')
  const moodboardId = new URL(page.url()).pathname.split('/').at(-1)!
  await page.goto(base + '/ideas/' + moodboardId)
  await page.waitForURL('**/moodboards/' + moodboardId)
  await page.getByRole('button', { name: 'Write a note' }).click()
  await page.getByRole('textbox', { name: 'Write a note' }).fill('Use stepped shoulders.')
  await page.getByRole('button', { name: 'Add the note' }).click()
  await page.getByText('Use stepped shoulders.').waitFor()

  const importBoard = async () => {
    await page.getByRole('button', { name: 'Import moodboard' }).click()
    const picker = page.getByRole('dialog', { name: 'Import moodboard' })
    await picker.getByRole('textbox', { name: 'Search moodboards' }).fill(String(stamp))
    await picker.getByRole('button', { name: new RegExp('Art Deco ' + stamp) }).click()
    await picker.getByRole('button', { name: 'Import references' }).click()
    await picker.waitFor({ state: 'hidden' })
    await page.getByText('Use stepped shoulders.').waitFor()
  }

  await page.goto(`${base}/pieces/${from.id}/directions`)
  await importBoard()
  await importBoard()
  const [a] = await rpc('boards.list', { pieceId: from.id })
  assert.equal(a.referenceCount, 1)
  await page.goto(`${base}/pieces/${to.id}/directions`)
  await importBoard()
  const [b] = await rpc('boards.list', { pieceId: to.id })
  assert.equal(b.referenceCount, 1)
  const [sourceRef] = (await rpc('boards.get', { id: moodboardId })).references
  const [aRef] = (await rpc('boards.get', { id: a.id })).references
  const [bRef] = (await rpc('boards.get', { id: b.id })).references
  assert.notEqual(aRef.id, bRef.id)
  assert.notEqual(aRef.id, sourceRef.id)
  await rpc('references.update', { id: aRef.id, note: 'Edited only in project A.' })
  assert.equal((await rpc('boards.get', { id: b.id })).references[0].note, 'Use stepped shoulders.')
  assert.equal(
    (await rpc('boards.get', { id: moodboardId })).references[0].note,
    'Use stepped shoulders.',
  )

  await page.goto(base + '/ideas/' + a.id)
  await page.waitForURL('**/pieces/' + from.id + '/directions?board=' + a.id)
  await page.getByText('Edited only in project A.').waitFor()
  await page.goto(base + '/moodboards')
  await library.getByRole('link', { name: new RegExp('Art Deco ' + stamp) }).waitFor()
  assert.equal(await library.locator(`a[href*="${a.id}"],a[href*="${b.id}"]`).count(), 0)
  console.log(
    'Passed moodboard creation, legacy links, two-project import, retry, and source independence.',
  )
} finally {
  await browser.close()
}
