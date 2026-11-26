// Run against a disposable local server without an on-model provider.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright')
const base = process.argv[2]
if (!base) throw Error('Pass a disposable server URL')
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const rpc = async (name: string, data: object) => {
    const response = await page.request.post(base + '/api/rpc/' + name, { data })
    assert.ok(response.ok(), name + ' ' + (await response.text()))
    return response.json()
  }
  const a = await rpc('pieces.create', { title: 'Shoot A' })
  const b = await rpc('pieces.create', { title: 'Shoot B' })
  await page.goto(base + '/pieces/' + a.id + '/on-model')
  await page.getByRole('heading', { name: 'On-model studio' }).waitFor()
  await page.getByRole('button', { name: 'Create a model card' }).click()
  await page.getByLabel('Model name').fill('Editorial sample')
  await page
    .getByLabel('Appearance and styling')
    .fill('Fictional adult with short curls and a white shirt.')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Save model card' }).click()
  await page.getByRole('button', { name: 'Approve model for shoots' }).click()
  await page.getByText(/Ages 25-34 · Approved for shoots/).waitFor()
  await page.getByLabel('Shot direction').fill('Soft daylight at a casting bench.')
  await page.getByRole('button', { name: 'Save shot setup' }).click()
  await page.getByRole('status').getByText('Shot setup saved on this device.').waitFor()
  await page.reload()
  assert.equal(
    await page.getByLabel('Shot direction').inputValue(),
    'Soft daylight at a casting bench.',
  )
  await page.getByRole('button', { name: 'Switch project' }).click()
  await page.getByRole('dialog').getByRole('textbox').fill(b.title)
  await page.getByRole('dialog').getByRole('link', { name: b.title }).first().click()
  await page.waitForURL('**/pieces/' + b.id + '/on-model')
  assert.equal(await page.getByLabel('Shot direction').inputValue(), '')
  assert.equal(await page.getByRole('button', { name: 'Generate image' }).count(), 0)
  await page.getByText(/Image generation is unavailable on this server/).waitFor()
  assert.equal((await rpc('shots.list', { pieceId: a.id })).length, 0)
  console.log(
    'PASS synthetic model card, approval, saved setup, reload, project switch and unavailable imaging.',
  )
} finally {
  await browser.close()
}
